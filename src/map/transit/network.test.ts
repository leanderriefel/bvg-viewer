import { describe, expect, it } from "vite-plus/test";

import type { TransitProduct, TransitVehicle } from "./model";
import { MAX_VEHICLE_AGE_MS } from "./model";
import {
  displayTransitLine,
  formatDelay,
  groupTransitLines,
  summarizeTransit,
} from "./network";

const NOW = 1_000_000;
const FILTERS: Record<TransitProduct, boolean> = {
  suburban: true,
  subway: true,
  tram: true,
  bus: true,
  ferry: true,
  regional: true,
  express: true,
  unknown: true,
};

function vehicle(
  id: string,
  fields: Partial<TransitVehicle> = {}
): TransitVehicle {
  return {
    id,
    line: "U9",
    product: "subway",
    direction: "Rathaus Steglitz",
    operator: "BVG",
    location: [13.4, 52.5],
    observedAt: NOW,
    delay: null,
    nextStop: "Spichernstraße",
    frames: [{ at: NOW, coordinates: [13.4, 52.5] }],
    route: [],
    ...fields,
  };
}

describe("network line presentation", () => {
  it("normalizes numeric rail labels without changing bus names or raw observations", () => {
    const bare = vehicle("bare", { line: " 1 ", product: "suburban" });
    expect(displayTransitLine(bare)).toBe("S1");
    expect(bare.line).toBe(" 1 ");
    expect(displayTransitLine({ line: "9", product: "subway" })).toBe("U9");
    expect(displayTransitLine({ line: "1", product: "bus" })).toBe("1");
    expect(displayTransitLine({ line: "1", product: "unknown" })).toBe("1");
    expect(displayTransitLine({ line: " S1 ", product: "suburban" })).toBe(
      "S1"
    );
    expect(displayTransitLine({ line: "RE1", product: "regional" })).toBe(
      "RE1"
    );
  });

  it("groups and searches bare and prefixed rail labels as the same service", () => {
    const observations = [
      vehicle("bare", { line: "1", product: "suburban" }),
      vehicle("prefixed", { line: "S1", product: "suburban" }),
      vehicle("bus", { line: "1", product: "bus" }),
    ];
    const groups = groupTransitLines(observations, FILTERS, "", NOW);
    expect(groups.map((line) => line.line)).toEqual(["S1", "1"]);
    expect(groups[0].vehicles).toHaveLength(2);
    const matches = groupTransitLines(observations, FILTERS, "s1", NOW);
    expect(matches).toHaveLength(1);
    expect(matches[0].vehicles.map((item) => item.id)).toEqual([
      "bare",
      "prefixed",
    ]);
    expect(summarizeTransit(observations, NOW)).toMatchObject({
      vehicleCount: 3,
      lineCount: 2,
    });
  });

  it("shows one line with destination groups instead of repeated dropdown options", () => {
    const lines = groupTransitLines(
      [
        vehicle("south-2"),
        vehicle("north", { direction: "Osloer Straße" }),
        vehicle("south-1"),
      ],
      FILTERS,
      "",
      NOW
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].vehicles.map((item) => item.id)).toEqual([
      "north",
      "south-1",
      "south-2",
    ]);
    expect(
      lines[0].directions.map((direction) => [
        direction.name,
        direction.vehicles.length,
      ])
    ).toEqual([
      ["Osloer Straße", 1],
      ["Rathaus Steglitz", 2],
    ]);
  });

  it("keeps same-name services from different transport modes separate", () => {
    const lines = groupTransitLines(
      [
        vehicle("rail", { line: "M10", product: "tram" }),
        vehicle("replacement", { line: "M10", product: "bus" }),
      ],
      FILTERS,
      "",
      NOW
    );
    expect(lines.map((line) => line.product)).toEqual(["tram", "bus"]);
    expect(new Set(lines.map((line) => line.key)).size).toBe(2);
  });

  it("sorts line numbers naturally and keeps trip order stable", () => {
    const lines = groupTransitLines(
      [
        vehicle("trip-10", { line: "S25", product: "suburban" }),
        vehicle("trip-2", {
          line: "S2",
          product: "suburban",
          nextStop: "Westkreuz",
        }),
        vehicle("trip-1", {
          line: "S2",
          product: "suburban",
          nextStop: "Anhalter Bahnhof",
        }),
      ],
      FILTERS,
      "",
      NOW
    );
    expect(lines.map((line) => line.line)).toEqual(["S2", "S25"]);
    expect(lines[0].vehicles.map((item) => item.id)).toEqual([
      "trip-1",
      "trip-2",
    ]);
  });

  it("uses the freshest duplicate trip and removes expired observations", () => {
    const observations = [
      vehicle("same", { delay: 120, observedAt: NOW - 1000 }),
      vehicle("same", { delay: 0 }),
      vehicle("expired", { observedAt: NOW - MAX_VEHICLE_AGE_MS - 1 }),
      vehicle("boundary", { observedAt: NOW - MAX_VEHICLE_AGE_MS }),
    ];
    const [line] = groupTransitLines(observations, FILTERS, "", NOW);
    expect(line.vehicles).toHaveLength(2);
    expect(line.vehicles.find((item) => item.id === "same")?.delay).toBe(0);
    expect(line.delayedCount).toBe(0);
    expect(summarizeTransit(observations, NOW).vehicleCount).toBe(2);
  });

  it("filters hidden modes and searches line, destination and stop text", () => {
    const observations = [
      vehicle("south"),
      vehicle("north", {
        direction: "Osloer Straße",
        nextStop: "Güntzelstraße",
      }),
      vehicle("bus", { line: "M29", product: "bus" }),
    ];
    expect(
      groupTransitLines(observations, { ...FILTERS, bus: false }, "", NOW).map(
        (line) => line.line
      )
    ).toEqual(["U9"]);
    expect(
      groupTransitLines(observations, FILTERS, " u9 ", NOW)[0].vehicles
    ).toHaveLength(2);
    expect(
      groupTransitLines(
        observations,
        FILTERS,
        "osloer strasse",
        NOW
      )[0].vehicles.map((item) => item.id)
    ).toEqual(["north"]);
    expect(
      groupTransitLines(observations, FILTERS, "guntzel", NOW)[0].vehicles.map(
        (item) => item.id
      )
    ).toEqual(["north"]);
    expect(
      groupTransitLines(observations, FILTERS, "not a station", NOW)
    ).toEqual([]);
  });

  it.each(["ferry", "ferries", "Fähre", "fahren", "boat"])(
    "finds ferry services using the mode keyword %s",
    (query) => {
      const observations = [
        vehicle("ferry", {
          line: "F10",
          product: "ferry",
          direction: "Wannsee",
        }),
        vehicle("bus", {
          line: "100",
          product: "bus",
          direction: "Alexanderplatz",
        }),
      ];
      expect(
        groupTransitLines(observations, FILTERS, query, NOW).map(
          (line) => line.line
        )
      ).toEqual(["F10"]);
    }
  );

  it("requires each keyword across mode, line, destination and operator", () => {
    const observations = [
      vehicle("ferry-wannsee", {
        line: "F10",
        product: "ferry",
        direction: "Wannsee",
      }),
      vehicle("ferry-other", {
        line: "F11",
        product: "ferry",
        direction: "Wilhelmstrand",
      }),
      vehicle("bus-100", {
        line: "100",
        product: "bus",
        direction: "Alexanderplatz",
        operator: "Berliner Verkehrsbetriebe",
      }),
      vehicle("bus-other", {
        line: "200",
        product: "bus",
        direction: "Alexanderplatz",
      }),
      vehicle("subway-south"),
      vehicle("subway-north", { direction: "Osloer Straße" }),
    ];
    expect(
      groupTransitLines(observations, FILTERS, "ferry Wannsee", NOW).map(
        (line) => line.line
      )
    ).toEqual(["F10"]);
    expect(
      groupTransitLines(observations, FILTERS, "bus 100", NOW).map(
        (line) => line.line
      )
    ).toEqual(["100"]);
    expect(
      groupTransitLines(
        observations,
        FILTERS,
        "U9 Rathaus",
        NOW
      )[0].vehicles.map((item) => item.id)
    ).toEqual(["subway-south"]);
    expect(
      groupTransitLines(
        observations,
        FILTERS,
        "  Berliner   verkehrsbetriebe  ",
        NOW
      ).map((line) => line.line)
    ).toEqual(["100"]);
  });

  it.each(["train", "trains", "rail"])(
    "matches all rail modes and excludes buses for %s",
    (query) => {
      const observations = [
        vehicle("suburban", { product: "suburban", line: "S1" }),
        vehicle("subway", { product: "subway", line: "U9" }),
        vehicle("regional", { product: "regional", line: "RE1" }),
        vehicle("express", { product: "express", line: "ICE42" }),
        vehicle("bus", { product: "bus", line: "100" }),
        vehicle("tram", { product: "tram", line: "M10" }),
      ];
      expect(
        groupTransitLines(observations, FILTERS, query, NOW).map(
          (line) => line.product
        )
      ).toEqual(["suburban", "subway", "regional", "express"]);
    }
  );

  it("does not match short rail abbreviations inside ordinary operator or stop text", () => {
    const observations = [
      vehicle("regional", { product: "regional", line: "RE1" }),
      vehicle("express", { product: "express", line: "ICE42" }),
      vehicle("bus", {
        product: "bus",
        line: "100",
        operator: "Berliner Verkehrsbetriebe",
      }),
    ];
    expect(
      groupTransitLines(observations, FILTERS, "RE", NOW).map(
        (line) => line.line
      )
    ).toEqual(["RE1"]);
    expect(
      groupTransitLines(observations, FILTERS, "IC", NOW).map(
        (line) => line.line
      )
    ).toEqual(["ICE42"]);
  });

  it("keeps unknown delays distinct from on-time and early vehicles", () => {
    const observations = [
      vehicle("unknown"),
      vehicle("on-time", { delay: 0 }),
      vehicle("early", { delay: -120 }),
      vehicle("late", { delay: 60 }),
      vehicle("seconds", { delay: 59 }),
    ];
    const [line] = groupTransitLines(observations, FILTERS, "", NOW);
    const summary = summarizeTransit(observations, NOW);
    expect(line).toMatchObject({ delayedCount: 1, knownDelayCount: 4 });
    expect(summary).toMatchObject({
      vehicleCount: 5,
      lineCount: 1,
      delayedCount: 1,
      knownDelayCount: 4,
    });
    expect(summary.byProduct.subway).toBe(5);
    expect(summary.byProduct.bus).toBe(0);
  });

  it("does not mutate the source array while sorting groups", () => {
    const observations = [vehicle("b"), vehicle("a")];
    const before = [...observations];
    groupTransitLines(observations, FILTERS, "", NOW);
    expect(observations).toEqual(before);
  });

  it("formats delays without turning missing or sub-minute data into on time", () => {
    expect(formatDelay(null)).toBe("No delay data");
    expect(formatDelay(0)).toBe("On time");
    expect(formatDelay(120)).toBe("+2 min");
    expect(formatDelay(-120)).toBe("−2 min");
    expect(formatDelay(20)).toBe("+<1 min");
  });
});
