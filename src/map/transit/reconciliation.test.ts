import { expect, it } from "vite-plus/test";

import type { LngLat } from "@/lib/geo";
import type { TransitVehicle } from "@/map/transit/model";
import { sampleVehicle } from "@/map/transit/motion";

import { forecastCorrectionMs } from "./reconciliation";

const OBSERVED_AT = 1_000_000;

function vehicle(coordinates: LngLat[]): TransitVehicle {
  return {
    id: "trip",
    line: "S1",
    product: "suburban",
    direction: "Wannsee",
    operator: null,
    location: coordinates[0],
    observedAt: OBSERVED_AT,
    delay: null,
    nextStop: null,
    route: coordinates,
    frames: coordinates.map((position, index) => ({
      at: OBSERVED_AT + index * 10_000,
      coordinates: position,
    })),
  };
}

it("reconciles a changed observation by sampling along the route through a bend", () => {
  const train = vehicle([
    [13.4, 52.5],
    [13.4001, 52.5],
    [13.4001, 52.5001],
  ]);
  const now = OBSERVED_AT + 15_000;
  const offset = forecastCorrectionMs(train, [13.40005, 52.5], now);
  expect(offset).toBeCloseTo(-10_000, 4);
  const first = sampleVehicle(train, now + offset);
  expect(first?.coordinates[0]).toBeCloseTo(13.40005);
  expect(first?.coordinates[1]).toBe(52.5);
  // Halfway through the correction, the vehicle has rounded the corner.
  // Blending coordinates directly would instead cut diagonally across it.
  const halfway = sampleVehicle(train, now + 1000 + offset * 0.5);
  expect(halfway?.coordinates[0]).toBe(13.4001);
  expect(halfway?.coordinates[1]).toBeCloseTo(52.50001);
});

it("does not reconcile an old location to a distant parallel route", () => {
  const train = vehicle([
    [13.4, 52.5],
    [13.4001, 52.5],
  ]);
  expect(
    forecastCorrectionMs(train, [13.401, 52.501], OBSERVED_AT + 5000)
  ).toBe(0);
});

it("rejects large time shifts rather than racing through a whole trip", () => {
  const train = vehicle([
    [13.4, 52.5],
    [13.4001, 52.5],
  ]);
  expect(
    forecastCorrectionMs(train, [13.4001, 52.5], OBSERVED_AT + 60_000)
  ).toBe(0);
});

it("leaves stationary forecasts and sub-metre jitter alone", () => {
  const train = vehicle([
    [13.4, 52.5],
    [13.400001, 52.5],
  ]);
  expect(forecastCorrectionMs(train, [13.4, 52.5], OBSERVED_AT + 5000)).toBe(0);
});
