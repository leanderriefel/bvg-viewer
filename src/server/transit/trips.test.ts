import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  MAX_ROUTE_POINTS,
  normalizeTripRoute,
  readTransitRoute,
} from "@/map/transit/route";

import {
  TRIP_REQUEST_SPACING_MS,
  TRIP_ROUTE_TTL_MS,
  TripRoutes,
} from "./trips";

afterEach(() => vi.useRealTimers());

function uninitializedResponse(_response: Response): never {
  throw new Error("Deferred route response was not initialized");
}

function deferredResponse() {
  let complete: (response: Response) => void = uninitializedResponse;
  // oxlint-disable-next-line promise/avoid-new -- Controlled responses verify overlapping rate-limit failures.
  const promise = new Promise<Response>((resolve) => {
    complete = resolve;
  });
  return { promise, resolve: (response: Response) => complete(response) };
}

function fakeTimerSleep(milliseconds: number): Promise<void> {
  // oxlint-disable-next-line promise/avoid-new -- Fake timers must control route request scheduling too.
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function trip(id = "trip-1") {
  return {
    trip: {
      id,
      polyline: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { name: "U First" },
            geometry: { type: "Point", coordinates: [13.4, 52.5] },
          },
          {
            type: "Feature",
            properties: {},
            geometry: { type: "Point", coordinates: [13.4005, 52.501] },
          },
          {
            type: "Feature",
            properties: { name: "U Last" },
            geometry: { type: "Point", coordinates: [13.402, 52.502] },
          },
        ],
      },
    },
  };
}

function setup(responses: Response[], capacity = 64) {
  let now = 1_000_000;
  const requestedAt: number[] = [];
  const request = vi.fn<typeof fetch>(() => {
    requestedAt.push(now);
    const response = responses.shift();
    if (!response) {
      throw new Error("No route response configured");
    }
    return Promise.resolve(response);
  });
  const service = new TripRoutes({
    request,
    capacity,
    now: () => now,
    sleep: (milliseconds) => {
      now += milliseconds;
      return Promise.resolve();
    },
  });
  return {
    service,
    request,
    requestedAt,
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
  };
}

describe("full trip route shapes", () => {
  it("preserves intermediate geometry and station points with browser validation", () => {
    const route = normalizeTripRoute(trip(), "trip-1", "U9", 1_000_000);
    expect(route.coordinates).toHaveLength(3);
    expect(route.coordinates[1]).toEqual([13.4005, 52.501]);
    expect(route.stops.map((stop) => stop.name)).toEqual(["U First", "U Last"]);
    expect(readTransitRoute(route)).toEqual(route);
  });

  it("rejects wrong trips, missing geographic shapes, and invalid points", () => {
    expect(() =>
      normalizeTripRoute(trip("different"), "trip-1", "U9", 0)
    ).toThrow("different trip");
    expect(() =>
      normalizeTripRoute({ trip: { stopovers: [] } }, "trip-1", "U9", 0)
    ).toThrow("geographic route shape");
    const invalid = trip();
    invalid.trip.polyline.features[1].geometry.coordinates = [999, 52.5];
    expect(() => normalizeTripRoute(invalid, "trip-1", "U9", 0)).toThrow(
      "invalid route coordinates"
    );
    expect(
      readTransitRoute({
        tripId: "trip-1",
        line: "U9",
        updatedAt: 0,
        coordinates: [
          [13.4, 52.5],
          [999, 52.5],
        ],
        stops: [],
      })
    ).toBeNull();
  });

  it("bounds route size and rejects malformed route identities", async () => {
    const oversized = trip();
    oversized.trip.polyline.features = Array.from(
      { length: MAX_ROUTE_POINTS + 1 },
      () => oversized.trip.polyline.features[0]
    );
    expect(() => normalizeTripRoute(oversized, "trip-1", "U9", 0)).toThrow(
      "route shape size"
    );
    const { service, request } = setup([]);
    await expect(service.get("x".repeat(513), "U9")).rejects.toMatchObject({
      status: 400,
    });
    await expect(service.get("trip\n1", "U9")).rejects.toMatchObject({
      status: 400,
    });
    await expect(service.get("trip-1", "")).rejects.toMatchObject({
      status: 400,
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("shares in-flight requests and caches a route across readers", async () => {
    const { service, request } = setup([Response.json(trip())]);
    const [first, second] = await Promise.all([
      service.get("trip-1", "U9"),
      service.get("trip-1", "U9"),
    ]);
    expect(second).toBe(first);
    expect(await service.get("trip-1", "U9")).toBe(first);
    expect(request).toHaveBeenCalledOnce();
    const [[url]] = request.mock.calls;
    expect(String(url)).toContain("polyline=true");
  });

  it("spaces distinct routes and refreshes expired cached geometry", async () => {
    const { service, request, requestedAt, advance } = setup([
      Response.json(trip()),
      Response.json(trip("trip-2")),
      Response.json(trip()),
    ]);
    await service.get("trip-1", "U9");
    await service.get("trip-2", "U2");
    expect(requestedAt[1] - requestedAt[0]).toBeGreaterThanOrEqual(
      TRIP_REQUEST_SPACING_MS
    );
    advance(TRIP_ROUTE_TTL_MS);
    await service.get("trip-1", "U9");
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("evicts old route entries when the bounded cache fills", async () => {
    const { service, request } = setup(
      [
        Response.json(trip()),
        Response.json(trip("trip-2")),
        Response.json(trip("trip-3")),
        Response.json(trip()),
      ],
      2
    );
    await service.get("trip-1", "U9");
    await service.get("trip-2", "U2");
    await service.get("trip-3", "U3");
    await service.get("trip-1", "U9");
    expect(request).toHaveBeenCalledTimes(4);
  });

  it("honors route Retry-After without repeating upstream requests", async () => {
    const { service, request, advance } = setup([
      new Response(null, { status: 429, headers: { "retry-after": "90" } }),
      Response.json(trip()),
    ]);
    await expect(service.get("trip-1", "U9")).rejects.toMatchObject({
      status: 429,
      retryAfter: 90,
    });
    advance(89_000);
    await expect(service.get("trip-2", "U2")).rejects.toMatchObject({
      status: 429,
    });
    expect(request).toHaveBeenCalledOnce();
    advance(1000);
    const recovered = await service.get("trip-1", "U9");
    expect(recovered.tripId).toBe("trip-1");
  });

  it("preserves the longest cooldown when in-flight route requests return 429", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const first = deferredResponse();
    const second = deferredResponse();
    const request = vi
      .fn<typeof fetch>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockResolvedValue(Response.json(trip("trip-3")));
    const service = new TripRoutes({ request, sleep: fakeTimerSleep });
    const firstFailure = expect(
      service.get("trip-1", "U9")
    ).rejects.toMatchObject({ status: 429, retryAfter: 120 });
    const secondFailure = expect(
      service.get("trip-2", "U2")
    ).rejects.toMatchObject({ status: 429, retryAfter: 119 });
    await vi.advanceTimersByTimeAsync(TRIP_REQUEST_SPACING_MS);
    expect(request).toHaveBeenCalledTimes(2);

    first.resolve(
      new Response(null, { status: 429, headers: { "retry-after": "120" } })
    );
    await firstFailure;
    await vi.advanceTimersByTimeAsync(1000);
    second.resolve(
      new Response(null, { status: 429, headers: { "retry-after": "30" } })
    );
    await secondFailure;

    await vi.advanceTimersByTimeAsync(60_000);
    await expect(service.get("trip-3", "U3")).rejects.toMatchObject({
      status: 429,
      retryAfter: 59,
    });
    expect(request).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(59_000);
    const recovered = await service.get("trip-3", "U3");
    expect(recovered.tripId).toBe("trip-3");
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("recovers from oversized Retry-After headers after the bounded wait", async () => {
    const { service, request, advance } = setup([
      new Response(null, { status: 429, headers: { "retry-after": "1e308" } }),
      Response.json(trip()),
    ]);
    await expect(service.get("trip-1", "U9")).rejects.toMatchObject({
      status: 429,
      retryAfter: 300,
    });
    advance(299_999);
    await expect(service.get("trip-2", "U2")).rejects.toMatchObject({
      status: 429,
      retryAfter: 1,
    });
    expect(request).toHaveBeenCalledOnce();
    advance(1);
    const recovered = await service.get("trip-1", "U9");
    expect(recovered.tripId).toBe("trip-1");
    expect(request).toHaveBeenCalledTimes(2);
  });

  it.each([Response.json({ trip: {} }), new Response(null, { status: 502 })])(
    "returns a recoverable error instead of constructing a station chord",
    async (response) => {
      const { service } = setup([response]);
      await expect(service.get("trip-1", "U9")).rejects.toMatchObject({
        status: 503,
      });
    }
  );
});
