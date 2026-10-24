import { describe, expect, it } from "vite-plus/test";

import type { TransitVehicle } from "./model";
import { MAX_VEHICLE_AGE_MS } from "./model";
import { sampleVehicle } from "./motion";
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
});
