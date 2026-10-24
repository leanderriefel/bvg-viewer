import { expect, it } from "vite-plus/test";

import type { LngLat } from "@/lib/geo";
import type { TransitVehicle } from "@/map/transit/model";
import { sampleVehicle } from "@/map/transit/motion";

import {
  forecastCorrectionMs,
  remainingForecastCorrection,
} from "./reconciliation";

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
  expect(offset).toBeLessThan(0);
  const first = sampleVehicle(train, now + offset);
  expect(first?.coordinates[0]).toBeCloseTo(13.40005, 10);
  expect(first?.coordinates[1]).toBe(52.5);
  // Halfway through the correction, the vehicle has rounded the corner.
  // Blending coordinates directly would instead cut diagonally across it.
  const elapsed = Math.max(4000, Math.abs(offset) * 3) / 2;
  const halfway = sampleVehicle(
    train,
    now + elapsed + remainingForecastCorrection(offset, elapsed)
  );
  expect(halfway?.coordinates[0]).toBe(13.4001);
  expect(halfway?.coordinates[1]).toBeGreaterThan(52.5);
  expect(halfway?.coordinates[1]).toBeLessThanOrEqual(52.5001);
});

it("keeps correction clocks moving forward at a bounded speed and eases both endpoints", () => {
  for (const offset of [-30_000, -10_000, 10_000, 30_000]) {
    const duration = Math.max(4000, Math.abs(offset) * 3);
    expect(remainingForecastCorrection(offset, 0)).toBe(offset);
    expect(remainingForecastCorrection(offset, duration)).toBe(0);
    expect(remainingForecastCorrection(offset, duration + 1000)).toBe(0);
    let previous = offset;
    for (let elapsed = 100; elapsed <= duration; elapsed += 100) {
      const time = elapsed + remainingForecastCorrection(offset, elapsed);
      expect(time - previous).toBeGreaterThanOrEqual(49.99);
      expect(time - previous).toBeLessThanOrEqual(150.01);
      previous = time;
    }
    expect(remainingForecastCorrection(offset, 1)).toBeCloseTo(offset, 3);
    expect(remainingForecastCorrection(offset, duration - 1)).toBeCloseTo(0, 3);
  }
});

it("finds the recent passage through a loop instead of rejecting an older exact match", () => {
  const train = vehicle([
    [13.4, 52.5],
    [13.4001, 52.5],
    [13.4, 52.5],
    [13.4001, 52.5],
  ]);
  train.frames[2].at = OBSERVED_AT + 100_000;
  train.frames[3].at = OBSERVED_AT + 110_000;
  const position: LngLat = [13.40005, 52.5];
  const now = OBSERVED_AT + 107_000;
  const offset = forecastCorrectionMs(train, position, now);
  expect(Math.abs(offset)).toBeLessThan(10_000);
  expect(sampleVehicle(train, now + offset)?.coordinates[0]).toBeCloseTo(
    position[0],
    10
  );
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

it("keeps a stopped vehicle on its current dwell time when predictions refresh", () => {
  const train = vehicle([
    [13.4, 52.5],
    [13.4001, 52.5],
    [13.4001, 52.5],
    [13.4002, 52.5],
  ]);
  expect(
    forecastCorrectionMs(train, [13.4001, 52.5], OBSERVED_AT + 15_000)
  ).toBe(0);
});
