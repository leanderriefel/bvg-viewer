import { describe, expect, it, vi } from "vite-plus/test";

import { BERLIN_BBOX } from "@/lib/geo";
import type { BBox } from "@/lib/geo";
import { MAX_VEHICLE_AGE_MS, normalizeRadar } from "@/map/transit/model";
import type { TransitSnapshot } from "@/map/transit/model";

import {
  RADAR_RESULTS,
  REQUEST_SPACING_MS,
  TransitCollector,
  createRadarCells,
  retryAfterMilliseconds,
} from "./collector";

const CELL: BBox = [13.3, 52.4, 13.4, 52.5];

function radar(id = "trip-1", count = 1) {
  return {
    movements: Array.from({ length: count }, () => ({
      tripId: id,
      location: { longitude: 13.35, latitude: 52.45 },
      line: { name: "S1", product: "suburban" },
    })),
    realtimeDataUpdatedAt: 1000,
  };
}

function setup(responses: Response[], cells = [CELL]) {
  let now = 1_000_000;
  const requestedAt: number[] = [];
  const request = vi.fn(() => {
    requestedAt.push(now);
    const response = responses.shift();
    if (!response) {
      throw new Error("No test response configured");
    }
    return Promise.resolve(response);
  });
  const storage = {
    load: vi.fn(() => Promise.resolve(null)),
    save: vi.fn(() => Promise.resolve()),
  };
  const collector = new TransitCollector({
    storage,
    cells,
    fetch: request,
    now: () => now,
    sleep: (milliseconds) => {
      now += milliseconds;
      return Promise.resolve();
    },
  });
  return {
    collector,
    request,
    storage,
    requestedAt,
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
  };
}

describe("shared Berlin transit collection", () => {
  it("covers Berlin with a 4 by 4 grid without gaps", () => {
    const cells = createRadarCells(BERLIN_BBOX);
    expect(cells).toHaveLength(16);
    expect(cells[0].slice(0, 2)).toEqual(BERLIN_BBOX.slice(0, 2));
    expect(cells.at(-1)?.slice(2)).toEqual(BERLIN_BBOX.slice(2));
    expect(cells[0][2]).toBe(cells[1][0]);
    expect(cells[0][3]).toBe(cells[4][1]);
  });

  it("shares snapshots, spaces upstream requests, and deduplicates adjacent cells", async () => {
    const { collector, request, requestedAt, storage } = setup(
      [Response.json(radar()), Response.json(radar())],
      [CELL, CELL]
    );
    await collector.sweep();
    const snapshot = collector.getSnapshot();
    expect(snapshot.vehicles).toHaveLength(1);
    expect(snapshot.vehicles[0].observedAt).toBe(1_001_000);
    expect(snapshot.status).toBe("live");
    expect(snapshot.coverage).toEqual({ total: 2, succeeded: 2, capped: 0 });
    expect(requestedAt[1] - requestedAt[0]).toBeGreaterThanOrEqual(
      REQUEST_SPACING_MS
    );
    collector.getSnapshot();
    collector.getSnapshot();
    expect(request).toHaveBeenCalledTimes(2);
    expect(storage.save).toHaveBeenCalledTimes(1);
  });

  it("does not overlap sweeps when concurrent readers start collection", async () => {
    const storage = {
      load: () => Promise.resolve(null),
      save: () => Promise.resolve(),
    };
    const request = vi.fn(async () => {
      await collector.sweep();
      return Response.json(radar());
    });
    const collector = new TransitCollector({
      storage,
      fetch: request,
      cells: [CELL],
    });
    await collector.sweep();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("keeps last known vehicles on failures and expires them after 90 seconds", async () => {
    const { collector, advance } = setup([
      Response.json(radar()),
      new Response(null, { status: 503 }),
    ]);
    await collector.sweep();
    advance(30_000);
    await collector.sweep();
    expect(collector.getSnapshot()).toMatchObject({
      status: "degraded",
      coverage: { succeeded: 0 },
    });
    expect(collector.getSnapshot().vehicles).toHaveLength(1);
    advance(MAX_VEHICLE_AGE_MS);
    expect(collector.getSnapshot()).toMatchObject({
      status: "offline",
      vehicles: [],
    });
  });

  it("marks truncated cells as partial coverage", async () => {
    const { collector } = setup([
      Response.json(radar("trip-1", RADAR_RESULTS)),
    ]);
    await collector.sweep();
    expect(collector.getSnapshot()).toMatchObject({
      status: "degraded",
      coverage: { capped: 1 },
    });
  });

  it("rejects malformed upstream data instead of reporting a successful empty area", async () => {
    const { collector } = setup([
      Response.json({ error: "upstream unavailable" }),
    ]);
    await collector.sweep();
    expect(collector.getSnapshot()).toMatchObject({
      status: "offline",
      coverage: { succeeded: 0 },
    });
  });

  it("honors a global Retry-After and stops remaining cells for that sweep", async () => {
    const { collector, request, advance } = setup(
      [
        new Response(null, { status: 429, headers: { "retry-after": "120" } }),
        Response.json(radar()),
        Response.json(radar()),
      ],
      [CELL, CELL]
    );
    await collector.sweep();
    expect(request).toHaveBeenCalledTimes(1);
    advance(119_000);
    await collector.sweep();
    expect(request).toHaveBeenCalledTimes(1);
    advance(1000);
    await collector.sweep();
    expect(request).toHaveBeenCalledTimes(3);
    expect(collector.getSnapshot().status).toBe("live");
  });

  it("supports HTTP-date Retry-After and a conservative missing-header default", () => {
    expect(retryAfterMilliseconds("Thu, 01 Jan 1970 00:02:00 GMT", 0)).toBe(
      120_000
    );
    expect(retryAfterMilliseconds(null, 0)).toBe(60_000);
    expect(retryAfterMilliseconds("0", 0)).toBe(30_000);
  });

  it("continues publishing in memory if durable storage is unavailable", async () => {
    const { collector, storage } = setup([Response.json(radar())]);
    storage.save.mockRejectedValueOnce(new Error("Read-only filesystem"));
    await collector.sweep();
    expect(collector.getSnapshot()).toMatchObject({
      status: "live",
      storage: "memory",
    });
    expect(collector.getSnapshot().vehicles).toHaveLength(1);
  });

  it("uses no upstream requests after disposal", async () => {
    const { collector, request } = setup([Response.json(radar())]);
    collector.stop();
    await collector.sweep();
    expect(request).not.toHaveBeenCalled();
  });

  it("starts only one worker and exposes restored data before refreshing it", async () => {
    const observedAt = Date.now();
    const saved: TransitSnapshot = {
      vehicles: normalizeRadar(radar("saved-trip"), observedAt),
      updatedAt: observedAt,
      realtimeDataUpdatedAt: null,
      coverage: { total: 1, succeeded: 1, capped: 0 },
      status: "live",
      error: null,
      storage: "disk",
      pollIntervalMs: 30_000,
    };
    const storage = {
      load: vi.fn(() => Promise.resolve(saved)),
      save: () => Promise.resolve(),
    };
    let restoredId: string | undefined;
    const request = vi.fn(() => {
      restoredId = collector.getSnapshot().vehicles[0]?.id;
      collector.stop();
      return Promise.resolve(Response.json(radar()));
    });
    const collector = new TransitCollector({
      storage,
      fetch: request,
      cells: [CELL],
    });
    collector.start();
    collector.start();
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    expect(storage.load).toHaveBeenCalledTimes(1);
    expect(restoredId).toBe("saved-trip");
  });
});
