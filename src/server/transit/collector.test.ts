import { afterEach, describe, expect, it, vi } from "vite-plus/test";

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

afterEach(() => vi.useRealTimers());

function uninitializedResponse(_response: Response): never {
  throw new Error("Deferred response was not initialized");
}

function fakeTimerSleep(milliseconds: number): Promise<void> {
  // oxlint-disable-next-line promise/avoid-new -- Fake timers advance every worker against one wall clock.
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function deferredResponse() {
  let complete: (response: Response) => void = uninitializedResponse;
  // oxlint-disable-next-line promise/avoid-new -- A controlled unresolved fetch proves the in-flight bound.
  const promise = new Promise<Response>((resolve) => {
    complete = resolve;
  });
  return { promise, resolve: (response: Response) => complete(response) };
}

function concurrentSetup(cellCount: number) {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  const responses: ReturnType<typeof deferredResponse>[] = [];
  const requestedAt: number[] = [];
  let active = 0;
  let peak = 0;
  const request = vi.fn(async () => {
    const response = deferredResponse();
    responses.push(response);
    requestedAt.push(Date.now());
    active += 1;
    peak = Math.max(peak, active);
    try {
      return await response.promise;
    } finally {
      active -= 1;
    }
  });
  const collector = new TransitCollector({
    storage: {
      load: () => Promise.resolve(null),
      save: () => Promise.resolve(),
    },
    fetch: request,
    cells: Array.from({ length: cellCount }, () => CELL),
    sleep: fakeTimerSleep,
  });
  return { collector, responses, requestedAt, request, peak: () => peak };
}

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
  const requestedUrls: URL[] = [];
  const request = vi.fn((input: RequestInfo | URL) => {
    requestedAt.push(now);
    requestedUrls.push(new URL(String(input)));
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
    concurrency: 1,
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
    requestedUrls,
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
    const { collector, request, requestedAt, requestedUrls, storage } = setup(
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
    const [radarUrl] = requestedUrls;
    expect(radarUrl.searchParams.get("duration")).toBe("120");
    expect(radarUrl.searchParams.get("frames")).toBe("30");
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

  it("keeps last known vehicles on failures and expires them after the freshness window", async () => {
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

  it("bounds concurrent requests, spaces every start, and accepts out-of-order results monotonically", async () => {
    const fixture = concurrentSetup(6);
    const sweep = fixture.collector.sweep();
    await vi.advanceTimersByTimeAsync(3000);
    expect(fixture.request).toHaveBeenCalledTimes(4);
    expect(fixture.peak()).toBe(4);
    await fixture.collector.sweep();
    expect(fixture.request).toHaveBeenCalledTimes(4);

    fixture.responses[3].resolve(Response.json(radar()));
    await vi.advanceTimersByTimeAsync(0);
    const newer = fixture.collector.getSnapshot();
    expect(newer.vehicles[0].observedAt).toBe(fixture.requestedAt[3]);

    fixture.responses[0].resolve(Response.json(radar()));
    await vi.advanceTimersByTimeAsync(0);
    const olderCompletedLater = fixture.collector.getSnapshot();
    expect(olderCompletedLater.updatedAt).toBeGreaterThan(newer.updatedAt ?? 0);
    expect(olderCompletedLater.vehicles[0].observedAt).toBe(
      fixture.requestedAt[3]
    );

    await vi.advanceTimersByTimeAsync(2000);
    expect(fixture.request).toHaveBeenCalledTimes(6);
    for (const response of fixture.responses) {
      response.resolve(Response.json(radar()));
    }
    await sweep;
    expect(fixture.peak()).toBe(4);
    for (let index = 1; index < fixture.requestedAt.length; index += 1) {
      expect(
        fixture.requestedAt[index] - fixture.requestedAt[index - 1]
      ).toBeGreaterThanOrEqual(REQUEST_SPACING_MS);
    }
    expect(fixture.collector.getSnapshot().coverage.succeeded).toBe(6);
  });

  it("cancels reserved starts and unclaimed cells after a global 429", async () => {
    const fixture = concurrentSetup(8);
    const sweep = fixture.collector.sweep();
    await vi.advanceTimersByTimeAsync(0);
    expect(fixture.request).toHaveBeenCalledTimes(1);
    fixture.responses[0].resolve(
      new Response(null, {
        status: 429,
        headers: { "retry-after": "120" },
      })
    );
    await vi.advanceTimersByTimeAsync(4000);
    await sweep;
    await fixture.collector.sweep();
    expect(fixture.request).toHaveBeenCalledTimes(1);
    expect(fixture.collector.getSnapshot().coverage.succeeded).toBe(0);
  });

  it("allows requests already in flight to settle after a global 429 without claiming more work", async () => {
    const fixture = concurrentSetup(8);
    const sweep = fixture.collector.sweep();
    await vi.advanceTimersByTimeAsync(3000);
    fixture.responses[0].resolve(
      new Response(null, {
        status: 429,
        headers: { "retry-after": "120" },
      })
    );
    await vi.advanceTimersByTimeAsync(0);
    // Another already-sent request can also be throttled. Its shorter retry
    // must not shorten the first response's process-wide cooldown.
    fixture.responses[1].resolve(
      new Response(null, {
        status: 429,
        headers: { "retry-after": "30" },
      })
    );
    for (const response of fixture.responses.slice(2)) {
      response.resolve(Response.json(radar()));
    }
    await sweep;
    expect(fixture.request).toHaveBeenCalledTimes(4);
    expect(fixture.collector.getSnapshot()).toMatchObject({
      status: "degraded",
      coverage: { total: 8, succeeded: 2 },
    });
    await vi.advanceTimersByTimeAsync(60_000);
    await fixture.collector.sweep();
    expect(fixture.request).toHaveBeenCalledTimes(4);
  });
});
