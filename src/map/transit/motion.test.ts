import { describe, expect, it } from "vite-plus/test";

import type { TransitVehicle } from "./model";
import { MAX_VEHICLE_AGE_MS } from "./model";
import { routeBearing, sampleVehicle, smoothBearing } from "./motion";
import type { TransitPose } from "./motion";

const OBSERVED_AT = 1_000_000;

function vehicle(): TransitVehicle {
  return {
    id: "trip",
    line: "M10",
    product: "tram",
    direction: "Warschauer Straße",
    operator: "BVG",
    location: [13.4, 52.5],
    observedAt: OBSERVED_AT,
    delay: null,
    nextStop: null,
    route: [
      [13.4, 52.5],
      [13.401, 52.5],
      [13.401, 52.501],
    ],
    frames: [
      { at: OBSERVED_AT, coordinates: [13.4, 52.5] },
      { at: OBSERVED_AT + 10_000, coordinates: [13.401, 52.5] },
      { at: OBSERVED_AT + 20_000, coordinates: [13.401, 52.501] },
    ],
  };
}

describe("predicted vehicle motion", () => {
  it("keeps speed continuous across uneven forecast segments without leaving the path", () => {
    const transit = vehicle();
    transit.frames = [0, 0.0001, 0.0004, 0.0005].map((offset, index) => ({
      at: OBSERVED_AT + index * 10_000,
      coordinates: [13.4 + offset, 52.5],
    }));
    const longitude = (offset: number) =>
      sampleVehicle(transit, OBSERVED_AT + offset)?.coordinates[0] ?? 0;
    const vertex = longitude(10_000);
    const incoming = vertex - longitude(9999);
    const outgoing = longitude(10_001) - vertex;
    expect(incoming).toBeGreaterThan(0);
    expect(outgoing / incoming).toBeCloseTo(1, 3);
    for (let index = 0; index < transit.frames.length - 1; index += 1) {
      let [previous] = transit.frames[index].coordinates;
      for (let step = 0; step <= 100; step += 1) {
        const pose = sampleVehicle(
          transit,
          OBSERVED_AT + index * 10_000 + step * 100
        );
        expect(pose?.coordinates[1]).toBe(52.5);
        expect(pose?.coordinates[0]).toBeGreaterThanOrEqual(previous);
        expect(pose?.coordinates[0]).toBeLessThanOrEqual(
          transit.frames[index + 1].coordinates[0]
        );
        previous = pose?.coordinates[0] ?? previous;
      }
    }
  });

  it("eases into and out of a dwell without creeping through the stop", () => {
    const transit = vehicle();
    transit.frames = [0, 0.001, 0.001, 0.002].map((offset, index) => ({
      at: OBSERVED_AT + index * 10_000,
      coordinates: [13.4 + offset, 52.5],
    }));
    expect(sampleVehicle(transit, OBSERVED_AT + 15_000)?.coordinates).toEqual([
      13.401, 52.5,
    ]);
    const before = sampleVehicle(transit, OBSERVED_AT + 9990);
    const after = sampleVehicle(transit, OBSERVED_AT + 20_010);
    expect(Math.abs((before?.coordinates[0] ?? 0) - 13.401)).toBeLessThan(1e-8);
    expect(Math.abs((after?.coordinates[0] ?? 0) - 13.401)).toBeLessThan(1e-8);
  });

  it("samples long forecasts accurately across forward and backward seeks", () => {
    const transit = vehicle();
    transit.frames = Array.from({ length: 129 }, (_, index) => ({
      at: OBSERVED_AT + index * 100,
      coordinates: [13.4 + index * 0.0001, 52.5],
    }));
    for (const offset of [12_750, 250, 6400, 0, 12_600]) {
      const pose = sampleVehicle(transit, OBSERVED_AT + offset);
      expect(pose?.coordinates[0]).toBeCloseTo(13.4 + offset * 0.000001, 10);
      expect(pose?.coordinates[1]).toBe(52.5);
      expect(pose?.bearing).toBeCloseTo(90);
    }
  });

  it("follows successive route segments without cutting across their corner", () => {
    const transit = vehicle();
    const eastbound = sampleVehicle(transit, OBSERVED_AT + 5000);
    expect(eastbound?.coordinates[0]).toBeCloseTo(13.4005);
    expect(eastbound?.coordinates[1]).toBe(52.5);
    expect(eastbound?.bearing).toBeCloseTo(90);
    const northbound = sampleVehicle(transit, OBSERVED_AT + 15_000);
    expect(northbound?.coordinates[0]).toBe(13.401);
    expect(northbound?.coordinates[1]).toBeCloseTo(52.5005);
    expect(northbound?.bearing).toBeCloseTo(0);
  });

  it("clamps outside the forecast horizon and removes stale vehicles", () => {
    const transit = vehicle();
    expect(sampleVehicle(transit, OBSERVED_AT - 1000)?.coordinates).toEqual([
      13.4, 52.5,
    ]);
    expect(sampleVehicle(transit, OBSERVED_AT + 40_000)?.coordinates).toEqual([
      13.401, 52.501,
    ]);
    expect(
      sampleVehicle(transit, OBSERVED_AT + MAX_VEHICLE_AGE_MS + 1)
    ).toBeNull();
    expect(sampleVehicle(transit, Number.NaN)).toBeNull();
  });

  it("preserves dwell stops and finds the next heading", () => {
    const transit = vehicle();
    transit.frames[1].coordinates = [13.4, 52.5];
    transit.frames[2].coordinates = [13.401, 52.5];
    expect(sampleVehicle(transit, OBSERVED_AT + 5000)).toEqual({
      coordinates: [13.4, 52.5],
      bearing: 90,
    });
    transit.frames[2].coordinates = [13.4, 52.5];
    expect(sampleVehicle(transit, OBSERVED_AT + 5000)).toEqual({
      coordinates: [13.4, 52.5],
      bearing: 0,
    });
  });

  it("can mutate a reusable pose without allocating the output or coordinate array", () => {
    const pose: TransitPose = { coordinates: [0, 0], bearing: 0 };
    const { coordinates } = pose;
    expect(sampleVehicle(vehicle(), OBSERVED_AT + 15_000, pose)).toBe(pose);
    expect(pose.coordinates).toBe(coordinates);
    expect(pose.coordinates[1]).toBeCloseTo(52.5005);
  });

  it("keeps vehicles with no prediction stationary until their observation expires", () => {
    const transit = vehicle();
    transit.frames = [transit.frames[0]];
    expect(sampleVehicle(transit, OBSERVED_AT + 30_000)).toEqual({
      coordinates: [13.4, 52.5],
      bearing: 0,
    });
    transit.frames = [];
    expect(sampleVehicle(transit, OBSERVED_AT)).toBeNull();
  });

  it("continues sampling the supplied forecast during several missed refreshes", () => {
    const transit = vehicle();
    transit.frames = [
      { at: OBSERVED_AT, coordinates: [13.4, 52.5] },
      { at: OBSERVED_AT + 120_000, coordinates: [13.412, 52.5] },
    ];
    expect(
      sampleVehicle(transit, OBSERVED_AT + 90_000)?.coordinates[0]
    ).toBeCloseTo(13.409);
    expect(sampleVehicle(transit, OBSERVED_AT + 140_000)?.coordinates).toEqual([
      13.412, 52.5,
    ]);
    expect(
      sampleVehicle(transit, OBSERVED_AT + MAX_VEHICLE_AGE_MS + 1)
    ).toBeNull();
  });

  it("preserves the last reliable heading through stationary updates and tiny coordinate jitter", () => {
    const transit = vehicle();
    transit.frames = [
      { at: OBSERVED_AT, coordinates: [13.4, 52.5] },
      { at: OBSERVED_AT + 10_000, coordinates: [13.400001, 52.5] },
    ];
    const pose: TransitPose = { coordinates: [0, 0], bearing: 135 };
    expect(sampleVehicle(transit, OBSERVED_AT + 5000, pose)?.bearing).toBe(135);
  });
});

describe("route-aware vehicle orientation", () => {
  it("blends over the shortest heading arc", () => {
    expect(smoothBearing(359, 1, 0.5)).toBe(0);
    expect(smoothBearing(1, 359, 0.5)).toBe(0);
    expect(smoothBearing(90, 180, 0.5)).toBe(135);
  });

  it("uses the local route tangent without changing vehicle coordinates", () => {
    const point: [number, number] = [13.4005, 52.5001];
    expect(
      routeBearing(
        [
          [13.4, 52.5],
          [13.401, 52.5],
          [13.401, 52.501],
        ],
        point
      )
    ).toBeCloseTo(90);
    expect(point).toEqual([13.4005, 52.5001]);
    expect(
      routeBearing(
        [
          [13.4, 52.5],
          [13.401, 52.5],
        ],
        [13.4, 52.51]
      )
    ).toBeNull();
    expect(
      routeBearing(
        [
          [13.4, 52.5],
          [13.4, 52.5],
        ],
        point
      )
    ).toBeNull();
  });

  it("favours the established direction where supplied route segments cross", () => {
    const route: [number, number][] = [
      [13.399, 52.5],
      [13.401, 52.5],
      [13.4, 52.499],
      [13.4, 52.501],
    ];
    expect(routeBearing(route, [13.4, 52.5], 0)).toBeCloseTo(0);
    expect(routeBearing(route, [13.4, 52.5], 90)).toBeCloseTo(90);
  });
});
