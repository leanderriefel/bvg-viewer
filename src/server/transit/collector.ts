// Each worker waits for a shared request slot; sweep timers cannot overlap.
/* oxlint-disable eslint/no-await-in-loop */
import { setTimeout as pause } from "node:timers/promises";

import { BERLIN_BBOX } from "@/lib/geo";
import type { BBox } from "@/lib/geo";
import { MAX_VEHICLE_AGE_MS, normalizeRadar } from "@/map/transit/model";
import type { TransitSnapshot, TransitVehicle } from "@/map/transit/model";

import type { TransitStorage } from "./storage";

export const TRANSIT_POLL_INTERVAL_MS = 30_000;
export const REQUEST_SPACING_MS = 1000;
export const RADAR_RESULTS = 512;
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

interface CellState {
  updatedAt: number;
  succeeded: boolean;
  capped: boolean;
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
  private readonly cells: BBox[];
  private readonly concurrency: number;
  private readonly controller = new AbortController();
  private readonly vehicles = new Map<string, TransitVehicle>();
  private readonly cellState = new Map<number, CellState>();
  private snapshot: TransitSnapshot;
  private running = false;
  private started = false;
  private nextRequestAt = 0;
  private lastRequestAt = -Infinity;
  private backoffUntil = 0;
  private failedSweeps = 0;

  constructor(options: CollectorOptions) {
    this.storage = options.storage;
    this.request = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? wait;
    this.cells = options.cells ?? createRadarCells(BERLIN_BBOX);
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
      coverage: { total: this.cells.length, succeeded: 0, capped: 0 },
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
    for (const cell of this.cellState.values()) {
      if (cell.succeeded && now - cell.updatedAt <= MAX_VEHICLE_AGE_MS) {
        succeeded += 1;
        capped += Number(cell.capped);
      }
    }
    let status: TransitSnapshot["status"] = "degraded";
    if (this.snapshot.updatedAt === null) {
      status = this.snapshot.error ? "offline" : "starting";
    } else if (now - this.snapshot.updatedAt > MAX_VEHICLE_AGE_MS) {
      status = "offline";
    } else if (
      succeeded === this.cells.length &&
      capped === 0 &&
      !this.snapshot.error
    ) {
      status = "live";
    }
    this.snapshot = {
      ...this.snapshot,
      vehicles: [...this.vehicles.values()],
      coverage: { total: this.cells.length, succeeded, capped },
      status,
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
      while (!this.controller.signal.aborted) {
        const startedAt = this.now();
        await this.sweep();
        const delay = Math.max(
          1000,
          startedAt + TRANSIT_POLL_INTERVAL_MS - this.now(),
          this.backoffUntil - this.now()
        );
        await this.sleep(delay, this.controller.signal);
      }
    } catch {
      // stop() interrupts sleep/fetch; an unexpected loop failure is visible to readers.
      if (!this.controller.signal.aborted) {
        this.snapshot = {
          ...this.snapshot,
          error: "Transit collection stopped; restart the server to retry",
        };
      }
    }
  }

  /** Public for deterministic verification and an optional external scheduler. */
  async sweep(): Promise<void> {
    if (
      this.running ||
      this.controller.signal.aborted ||
      this.now() < this.backoffUntil
    ) {
      return;
    }
    this.running = true;
    let successes = 0;
    let error: string | null = null;
    let nextCell = 0;
    try {
      const worker = async () => {
        while (
          !this.controller.signal.aborted &&
          this.now() >= this.backoffUntil
        ) {
          // Claim synchronously before waiting so workers never repeat a cell.
          const index = nextCell;
          nextCell += 1;
          const cell = this.cells[index];
          if (!cell) {
            return;
          }
          const observedAt = await this.waitForRequestSlot();
          if (observedAt === null) {
            return;
          }
          try {
            const data = await this.fetchCell(cell);
            const movements = normalizeRadar(data, observedAt);
            for (const vehicle of movements) {
              const previous = this.vehicles.get(vehicle.id);
              if (!previous || previous.observedAt <= vehicle.observedAt) {
                this.vehicles.set(vehicle.id, vehicle);
              }
            }
            const capped = data.movements.length >= RADAR_RESULTS;
            this.cellState.set(index, {
              updatedAt: observedAt,
              succeeded: true,
              capped,
            });
            successes += 1;
            this.snapshot = {
              ...this.snapshot,
              // Completion order differs from request order. Every accepted
              // response must advance the HTTP snapshot's cache identity.
              updatedAt: Math.max(
                this.now(),
                (this.snapshot.updatedAt ?? 0) + 1
              ),
              realtimeDataUpdatedAt:
                typeof data.realtimeDataUpdatedAt === "number" &&
                Number.isFinite(data.realtimeDataUpdatedAt) &&
                data.realtimeDataUpdatedAt >= 0
                  ? Math.max(
                      this.snapshot.realtimeDataUpdatedAt ?? 0,
                      data.realtimeDataUpdatedAt * 1000
                    )
                  : this.snapshot.realtimeDataUpdatedAt,
              error,
            };
            this.publish();
          } catch (error_) {
            this.cellState.set(index, {
              updatedAt: observedAt,
              succeeded: false,
              capped: false,
            });
            error =
              error_ instanceof Error
                ? error_.message
                : "Could not read VBB movements";
            this.snapshot = { ...this.snapshot, error };
            this.publish();
          }
        }
      };
      await Promise.all(
        Array.from(
          { length: Math.min(this.concurrency, this.cells.length) },
          worker
        )
      );
      if (successes === 0) {
        this.failedSweeps += 1;
        this.backoffUntil = Math.max(
          this.backoffUntil,
          this.now() +
            Math.min(
              MAX_RETRY_AFTER_MS,
              TRANSIT_POLL_INTERVAL_MS * 2 ** this.failedSweeps
            )
        );
      } else {
        this.failedSweeps = 0;
      }
      this.snapshot = { ...this.snapshot, error };
      this.publish();
      try {
        const persisted = { ...this.snapshot, storage: "disk" as const };
        await this.storage.save(persisted);
        this.snapshot = persisted;
      } catch {
        this.snapshot = { ...this.snapshot, storage: "memory" };
      }
    } finally {
      this.running = false;
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
        AbortSignal.timeout(10_000),
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
