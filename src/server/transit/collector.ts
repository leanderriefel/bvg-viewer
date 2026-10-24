// Workers share a request budget, but each area owns its refresh/retry schedule.
/* oxlint-disable eslint/no-await-in-loop */
import { setTimeout as pause } from "node:timers/promises";

import { BERLIN_BBOX } from "@/lib/geo";
import type { BBox } from "@/lib/geo";
import { MAX_VEHICLE_AGE_MS, normalizeRadar } from "@/map/transit/model";
import type { TransitSnapshot, TransitVehicle } from "@/map/transit/model";

import type { TransitStorage } from "./storage";

export const TRANSIT_POLL_INTERVAL_MS = 30_000;
// At most 48 radar + 40 route requests/minute, including retries and splits.
export const REQUEST_SPACING_MS = 1250;
export const RADAR_RESULTS = 512;
export const RADAR_TIMEOUT_MS = 45_000;
export const AREA_RETRY_MS = 5000;
export const MAX_RADAR_CELLS = 256;
export const MAX_RADAR_DEPTH = 6;
const MAX_RETRY_AFTER_MS = 300_000;

/** Small areas avoid the city-wide endpoint silently truncating at its result cap. */
export function createRadarCells(bounds: BBox): BBox[] {
  const [west, south, east, north] = bounds;
  const cells: BBox[] = [];
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      cells.push([
        west + ((east - west) * column) / 4,
        south + ((north - south) * row) / 4,
        west + ((east - west) * (column + 1)) / 4,
        south + ((north - south) * (row + 1)) / 4,
      ]);
    }
  }
  return cells;
}

interface RadarCell {
  bounds: BBox;
  depth: number;
  nextAt: number;
  inFlight: boolean;
  failures: number;
  error: string | null;
  updatedAt: number;
  succeeded: boolean;
  capped: boolean;
}

function radarCell(bounds: BBox, depth = 0, nextAt = 0): RadarCell {
  return {
    bounds,
    depth,
    nextAt,
    inFlight: false,
    failures: 0,
    error: null,
    updatedAt: 0,
    succeeded: false,
    capped: false,
  };
}

function splitBounds([west, south, east, north]: BBox): BBox[] {
  const middleLongitude = (west + east) / 2;
  const middleLatitude = (south + north) / 2;
  return [
    [west, south, middleLongitude, middleLatitude],
    [middleLongitude, south, east, middleLatitude],
    [west, middleLatitude, middleLongitude, north],
    [middleLongitude, middleLatitude, east, north],
  ];
}

interface CollectorOptions {
  storage: TransitStorage;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  cells?: BBox[];
  concurrency?: number;
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return pause(milliseconds, undefined, { signal, ref: false });
}

export function retryAfterMilliseconds(
  value: string | null,
  now: number
): number {
  const header = value?.trim();
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) {
      if (seconds < 0) {
        return 60_000;
      }
      return Math.min(
        MAX_RETRY_AFTER_MS,
        Math.max(TRANSIT_POLL_INTERVAL_MS, seconds * 1000)
      );
    }
    const date = Date.parse(header);
    if (Number.isFinite(date)) {
      return Math.min(
        MAX_RETRY_AFTER_MS,
        Math.max(TRANSIT_POLL_INTERVAL_MS, date - now)
      );
    }
  }
  return 60_000;
}

export class TransitCollector {
  private readonly storage: TransitStorage;
  private readonly request: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: NonNullable<CollectorOptions["sleep"]>;
  private readonly cells: Set<RadarCell>;
  private readonly concurrency: number;
  private readonly controller = new AbortController();
  private readonly vehicles = new Map<string, TransitVehicle>();
  private snapshot: TransitSnapshot;
  private running = false;
  private started = false;
  private nextRequestAt = 0;
  private lastRequestAt = -Infinity;
  private backoffUntil = 0;
  private fatalError: string | null = null;

  constructor(options: CollectorOptions) {
    this.storage = options.storage;
    this.request = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? wait;
    this.cells = new Set(
      (options.cells ?? createRadarCells(BERLIN_BBOX)).map((bounds) =>
        radarCell(bounds)
      )
    );
    this.concurrency = options.concurrency ?? 4;
    if (
      !Number.isInteger(this.concurrency) ||
      this.concurrency < 1 ||
      this.concurrency > 4
    ) {
      throw new Error(
        "Transit collection concurrency must be an integer between 1 and 4"
      );
    }
    this.snapshot = {
      vehicles: [],
      updatedAt: null,
      realtimeDataUpdatedAt: null,
      coverage: { total: this.cells.size, succeeded: 0, capped: 0 },
      status: "starting",
      error: null,
      storage: "memory",
      pollIntervalMs: TRANSIT_POLL_INTERVAL_MS,
    };
  }

  /** Starts once per server process; readers never create their own upstream loops. */
  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    void this.run();
  }

  stop(): void {
    this.controller.abort();
  }

  getSnapshot(): TransitSnapshot {
    this.publish();
    return this.snapshot;
  }

  private publish(): void {
    const now = this.now();
    for (const [id, vehicle] of this.vehicles) {
      if (now - vehicle.observedAt > MAX_VEHICLE_AGE_MS) {
        this.vehicles.delete(id);
      }
    }
    let succeeded = 0;
    let capped = 0;
    let error = this.fatalError;
    for (const cell of this.cells) {
      if (cell.succeeded && now - cell.updatedAt <= MAX_VEHICLE_AGE_MS) {
        succeeded += 1;
      }
      capped += Number(cell.capped);
      error ??= cell.error;
    }
    let status: TransitSnapshot["status"] = "degraded";
    if (this.snapshot.updatedAt === null) {
      status = error ? "offline" : "starting";
    } else if (now - this.snapshot.updatedAt > MAX_VEHICLE_AGE_MS) {
      status = "offline";
    } else if (succeeded === this.cells.size && capped === 0 && !error) {
      status = "live";
    }
    this.snapshot = {
      ...this.snapshot,
      vehicles: [...this.vehicles.values()],
      coverage: { total: this.cells.size, succeeded, capped },
      status,
      error,
    };
  }

  private async restore(): Promise<void> {
    const previous = await this.storage.load();
    if (!previous) {
      return;
    }
    this.snapshot = {
      ...previous,
      storage: "disk",
      error: "Refreshing saved transit data",
    };
    for (const vehicle of previous.vehicles) {
      this.vehicles.set(vehicle.id, vehicle);
    }
    this.publish();
  }

  private async run(): Promise<void> {
    try {
      await this.restore();
      await Promise.all([this.collect(true), this.persistPeriodically()]);
    } catch {
      // stop() interrupts sleep/fetch; an unexpected loop failure is visible to readers.
      if (!this.controller.signal.aborted) {
        this.fatalError =
          "Transit collection stopped; restart the server to retry";
        this.controller.abort();
        this.publish();
      }
    }
  }

  /** Drain due areas and their new children once; start() refreshes continuously. */
  async sweep(): Promise<void> {
    if (
      this.running ||
      this.controller.signal.aborted ||
      this.now() < this.backoffUntil
    ) {
      return;
    }
    await this.collect(false);
  }

  private nextCell(attempted: Set<RadarCell> | null): RadarCell | undefined {
    let next: RadarCell | undefined;
    for (const cell of this.cells) {
      if (
        !cell.inFlight &&
        !attempted?.has(cell) &&
        (!next || cell.nextAt < next.nextAt)
      ) {
        next = cell;
      }
    }
    return next;
  }

  private async collect(continuous: boolean): Promise<void> {
    this.running = true;
    const attempted = continuous ? null : new Set<RadarCell>();
    try {
      const worker = async () => {
        while (!this.controller.signal.aborted) {
          const cell = this.nextCell(attempted);
          const dueAt = Math.max(cell?.nextAt ?? Infinity, this.backoffUntil);
          if (!cell || dueAt > this.now()) {
            if (!continuous) {
              return;
            }
            // Recheck soon: another worker can add children or finish an area.
            await this.sleep(
              Math.min(1000, dueAt - this.now()),
              this.controller.signal
            );
            continue;
          }
          // Claim before awaiting the shared request slot.
          cell.inFlight = true;
          attempted?.add(cell);
          try {
            await this.collectCell(cell);
          } finally {
            cell.inFlight = false;
          }
        }
      };
      await Promise.all(Array.from({ length: this.concurrency }, worker));
      if (!continuous) {
        await this.persist();
      }
    } finally {
      this.running = false;
    }
  }

  private async collectCell(cell: RadarCell): Promise<void> {
    const observedAt = await this.waitForRequestSlot();
    if (observedAt === null) {
      return;
    }
    try {
      const data = await this.fetchCell(cell.bounds);
      if (this.controller.signal.aborted) {
        return;
      }
      for (const vehicle of normalizeRadar(data, observedAt)) {
        const previous = this.vehicles.get(vehicle.id);
        if (!previous || previous.observedAt <= vehicle.observedAt) {
          this.vehicles.set(vehicle.id, vehicle);
        }
      }
      cell.updatedAt = observedAt;
      cell.succeeded = true;
      cell.capped = data.movements.length >= RADAR_RESULTS;
      cell.error = null;
      cell.failures = 0;
      cell.nextAt = Math.max(
        this.now() + 1000,
        observedAt + TRANSIT_POLL_INTERVAL_MS
      );
      if (
        cell.capped &&
        cell.depth < MAX_RADAR_DEPTH &&
        this.cells.size + 3 <= MAX_RADAR_CELLS
      ) {
        this.cells.delete(cell);
        for (const bounds of splitBounds(cell.bounds)) {
          const child = radarCell(bounds, cell.depth + 1, this.now());
          // Until all children respond, the parent's truncated result is incomplete.
          child.capped = true;
          this.cells.add(child);
        }
      }
      this.snapshot = {
        ...this.snapshot,
        // Completion order can differ from request order; every response changes the ETag.
        updatedAt: Math.max(this.now(), (this.snapshot.updatedAt ?? 0) + 1),
        realtimeDataUpdatedAt:
          typeof data.realtimeDataUpdatedAt === "number" &&
          Number.isFinite(data.realtimeDataUpdatedAt) &&
          data.realtimeDataUpdatedAt >= 0
            ? Math.max(
                this.snapshot.realtimeDataUpdatedAt ?? 0,
                data.realtimeDataUpdatedAt * 1000
              )
            : this.snapshot.realtimeDataUpdatedAt,
      };
    } catch (error) {
      if (this.controller.signal.aborted) {
        return;
      }
      cell.succeeded = false;
      cell.error =
        error instanceof Error ? error.message : "Could not read VBB movements";
      cell.failures += 1;
      cell.nextAt =
        this.now() +
        Math.min(
          MAX_RETRY_AFTER_MS,
          AREA_RETRY_MS * 2 ** Math.min(cell.failures - 1, 6)
        );
    }
    this.publish();
  }

  private async persist(): Promise<void> {
    this.publish();
    try {
      await this.storage.save({ ...this.snapshot, storage: "disk" });
      // Requests keep publishing while disk writes are pending.
      this.snapshot = { ...this.snapshot, storage: "disk" };
    } catch {
      this.snapshot = { ...this.snapshot, storage: "memory" };
    }
  }

  private async persistPeriodically(): Promise<void> {
    while (!this.controller.signal.aborted) {
      await this.sleep(TRANSIT_POLL_INTERVAL_MS, this.controller.signal);
      if (!this.controller.signal.aborted) {
        await this.persist();
      }
    }
  }

  private async waitForRequestSlot(): Promise<number | null> {
    // Reserve before the first await: simultaneous workers share one schedule.
    const scheduledAt = Math.max(this.now(), this.nextRequestAt);
    this.nextRequestAt = scheduledAt + REQUEST_SPACING_MS;
    let delay = scheduledAt - this.now();
    try {
      while (delay > 0) {
        await this.sleep(delay, this.controller.signal);
        if (this.controller.signal.aborted || this.now() < this.backoffUntil) {
          return null;
        }
        // An event-loop stall can wake several reserved timers together. Check
        // actual starts too, preserving the quota when those timers run late.
        delay = this.lastRequestAt + REQUEST_SPACING_MS - this.now();
      }
    } catch (error) {
      if (this.controller.signal.aborted) {
        return null;
      }
      throw error;
    }
    if (this.controller.signal.aborted || this.now() < this.backoffUntil) {
      return null;
    }
    const observedAt = this.now();
    this.lastRequestAt = observedAt;
    this.nextRequestAt = Math.max(
      this.nextRequestAt,
      observedAt + REQUEST_SPACING_MS
    );
    return observedAt;
  }

  private async fetchCell([west, south, east, north]: BBox): Promise<{
    movements: unknown[];
    realtimeDataUpdatedAt: unknown;
  }> {
    const url = new URL("https://v6.vbb.transport.rest/radar");
    url.search = new URLSearchParams({
      west: String(west),
      south: String(south),
      east: String(east),
      north: String(north),
      duration: "120",
      frames: "30",
      polylines: "true",
      results: String(RADAR_RESULTS),
      pretty: "false",
    }).toString();
    const response = await this.request(url, {
      // The public gateway stalled with our custom agent during live checks.
      headers: { accept: "application/json" },
      signal: AbortSignal.any([
        this.controller.signal,
        AbortSignal.timeout(RADAR_TIMEOUT_MS),
      ]),
    });
    if (response.status === 429) {
      this.backoffUntil = Math.max(
        this.backoffUntil,
        this.now() +
          retryAfterMilliseconds(
            response.headers.get("retry-after"),
            this.now()
          )
      );
      throw new Error("VBB request limit reached; waiting before retrying");
    }
    if (!response.ok) {
      throw new Error(`VBB movements unavailable (HTTP ${response.status})`);
    }
    const data: unknown = await response.json();
    if (
      typeof data !== "object" ||
      data === null ||
      !("movements" in data) ||
      !Array.isArray(data.movements)
    ) {
      throw new Error("VBB returned an invalid movement response");
    }
    return {
      movements: data.movements,
      realtimeDataUpdatedAt:
        "realtimeDataUpdatedAt" in data ? data.realtimeDataUpdatedAt : null,
    };
  }
}
