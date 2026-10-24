import { describe, expect, it } from "vite-plus/test";

import { normalizeRadar, readTransitSnapshot } from "./model";
import type { TransitSnapshot } from "./model";

const OBSERVED_AT = Date.parse("2026-10-24T09:35:00Z");

function radarMovement() {
  return {
    tripId: "1|85140|0|86|24102026",
    line: { name: "U2", product: "subway", operator: { name: "BVG" } },
    direction: "U Olympia-Stadion (Berlin)",
    location: { latitude: 52.50548, longitude: 13.37578 },
    nextStopovers: [
      { stop: { id: "first", name: "Pankow" }, departureDelay: 600 },
      {
        stop: { id: "next", name: "Mendelssohn-Bartholdy-Park" },
        arrivalDelay: 0,
        departureDelay: 60,
      },
    ],
    frames: [
      { origin: { id: "previous" }, destination: { id: "next" }, t: 0 },
      { origin: { id: "previous" }, destination: { id: "next" }, t: 1000 },
      { origin: { id: "previous" }, destination: { id: "next" }, t: 2000 },
    ],
    polyline: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [13.37578, 52.50548] },
        },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [13.37542, 52.50487] },
        },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [13.37542, 52.50487] },
        },
      ],
    },
  };
}

function snapshot(): TransitSnapshot {
  return {
    vehicles: normalizeRadar({ movements: [radarMovement()] }, OBSERVED_AT),
    updatedAt: OBSERVED_AT,
    realtimeDataUpdatedAt: OBSERVED_AT - 1000,
    coverage: { total: 16, succeeded: 16, capped: 0 },
    status: "live",
    error: null,
    storage: "disk",
    pollIntervalMs: 30_000,
  };
}

describe("VBB radar normalization", () => {
  it("pairs forecast points with their frame times and preserves dwell positions", () => {
    const [vehicle] = normalizeRadar(
      { movements: [radarMovement()] },
      OBSERVED_AT
    );
    expect(vehicle).toMatchObject({
      id: "1|85140|0|86|24102026",
      line: "U2",
      product: "subway",
      operator: "BVG",
      delay: 0,
      nextStop: "Mendelssohn-Bartholdy-Park",
      observedAt: OBSERVED_AT,
    });
    expect(vehicle.frames).toEqual([
      { at: OBSERVED_AT, coordinates: [13.37578, 52.50548] },
      { at: OBSERVED_AT + 1000, coordinates: [13.37542, 52.50487] },
      { at: OBSERVED_AT + 2000, coordinates: [13.37542, 52.50487] },
    ]);
  });

  it("keeps a stationary observation when point and time counts differ", () => {
    const movement = radarMovement();
    movement.polyline.features.pop();
    const [vehicle] = normalizeRadar({ movements: [movement] }, OBSERVED_AT);
    expect(vehicle.frames).toEqual([
      { at: OBSERVED_AT, coordinates: [13.37578, 52.50548] },
    ]);
    expect(vehicle.route).toEqual([]);
  });

  it("does not animate a corrupt or unordered prediction path", () => {
    const movement = radarMovement();
    movement.frames[1].t = -1;
    const [vehicle] = normalizeRadar({ movements: [movement] }, OBSERVED_AT);
    expect(vehicle.frames).toHaveLength(1);
    movement.frames[1].t = 0;
    expect(
      normalizeRadar({ movements: [movement] }, OBSERVED_AT)[0].frames
    ).toHaveLength(1);
  });

  it("ignores malformed movements and deduplicates trips", () => {
    expect(
      normalizeRadar(
        { movements: [null, {}, radarMovement(), radarMovement()] },
        OBSERVED_AT
      )
    ).toHaveLength(1);
    const invalid = radarMovement();
    invalid.location.latitude = Number.NaN;
    expect(normalizeRadar({ movements: [invalid] }, OBSERVED_AT)).toEqual([]);
  });

  it("uses unknown for new products and keeps unknown delay distinct from zero", () => {
    const movement = {
      ...radarMovement(),
      line: { name: "Future", product: "new-product" },
      nextStopovers: [],
    };
    expect(
      normalizeRadar({ movements: [movement] }, OBSERVED_AT)[0]
    ).toMatchObject({ product: "unknown", delay: null, nextStop: null });
  });

  it("finds a future stopover when radar destination metadata is absent", () => {
    const movement = {
      ...radarMovement(),
      frames: [],
      nextStopovers: [
        {
          stop: { name: "Old stop" },
          departure: "2026-10-24T09:00:00Z",
          departureDelay: 600,
        },
        {
          stop: { name: "Next stop" },
          arrival: "2026-10-24T09:37:00Z",
          arrivalDelay: 120,
        },
      ],
    };
    expect(
      normalizeRadar({ movements: [movement] }, OBSERVED_AT)[0]
    ).toMatchObject({ delay: 120, nextStop: "Next stop" });
  });

  it("rejects an upstream error document rather than treating it as an empty fleet", () => {
    expect(() =>
      normalizeRadar({ error: true, msg: "Unavailable" }, OBSERVED_AT)
    ).toThrow("invalid movements");
    expect(() => normalizeRadar({ movements: [] }, Number.NaN)).toThrow(
      "observation time"
    );
    expect(normalizeRadar({ movements: [] }, OBSERVED_AT)).toEqual([]);
  });
});

describe("snapshot validation", () => {
  it("roundtrips the documented data and rebuilds untrusted objects", () => {
    const original = snapshot();
    const parsed = readTransitSnapshot({ ...original, foreign: "discard" });
    expect(parsed).toEqual(original);
    expect(parsed).not.toBe(original);
    expect(parsed?.vehicles[0]).not.toBe(original.vehicles[0]);
  });

  it.each([
    { coverage: { total: 16, succeeded: 17, capped: 0 } },
    { coverage: { total: 16, succeeded: 16, capped: -1 } },
    { updatedAt: "yesterday" },
    { status: "invented" },
    { storage: "invented" },
    { pollIntervalMs: 1 },
  ])("rejects corrupt metadata %j", (patch) => {
    expect(readTransitSnapshot({ ...snapshot(), ...patch })).toBeNull();
  });

  it("rejects invalid vehicle coordinates, timestamps and products", () => {
    const original = snapshot();
    const [vehicle] = original.vehicles;
    for (const patch of [
      { location: [13.4, 999] },
      { product: "invented" },
      { frames: [{ at: OBSERVED_AT - 1, coordinates: [13.4, 52.5] }] },
      { frames: [{ at: OBSERVED_AT + 999_999, coordinates: [13.4, 52.5] }] },
      { frames: [] },
    ]) {
      expect(
        readTransitSnapshot({
          ...original,
          vehicles: [{ ...vehicle, ...patch }],
        })
      ).toBeNull();
    }
  });
});
