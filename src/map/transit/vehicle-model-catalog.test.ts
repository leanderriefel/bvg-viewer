import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { TransitProduct } from "./model";
import type { VehicleModelMode } from "./vehicle-model-catalog";
import {
  loadVehicleModelCatalog,
  parseVehicleModelCatalog,
  resolveVehicleModel,
} from "./vehicle-model-catalog";

function model(id: string, mode: VehicleModelMode) {
  return {
    id,
    name: id,
    mode,
    modelUrl: `/models/vehicles/${id}.glb`,
    cars: 1,
    dimensions: { width: 2.5, length: 12, height: 3.2 },
    segments: [
      { node: `${id}.segment-01`, length: 12, offset: [0, 0, 0], role: "car" },
    ],
  };
}

function fixture() {
  return {
    schemaVersion: 1,
    coordinates: {
      unit: "meter",
      up: "+Y",
      forward: "+Z",
      origin: "ground-center",
    },
    models: [
      model("bus-bvg-solo", "bus"),
      model("bus-regional", "bus"),
      model("bus-airport-coach", "bus"),
      model("sbahn-481", "s-bahn"),
      model("ubahn-h", "u-bahn"),
      model("tram-flexity-long", "tram"),
      model("db-regio-dosto", "regional"),
      model("odeg-desiro-hc", "regional"),
      model("rail-generic", "long-distance"),
      model("ice-4", "long-distance"),
      model("ferry-faehrbaer", "ferry"),
    ],
    services: [
      {
        mode: "bus",
        line: "M1",
        defaultModel: "bus-regional",
        alternatives: [],
        confidence: "unknown",
      },
      {
        mode: "bus",
        line: "S41",
        defaultModel: "bus-bvg-solo",
        alternatives: [],
        confidence: "representative",
      },
      {
        mode: "bus",
        line: "U6",
        defaultModel: "bus-bvg-solo",
        alternatives: [],
        confidence: "representative",
      },
      {
        mode: "bus",
        line: "100",
        defaultModel: "bus-bvg-solo",
        alternatives: ["bus-regional"],
        confidence: "representative",
      },
      {
        mode: "bus",
        line: "300",
        defaultModel: "bus-bvg-solo",
        alternatives: [],
        confidence: "representative",
      },
      {
        mode: "bus",
        line: "BER2",
        defaultModel: "bus-airport-coach",
        alternatives: [],
        confidence: "representative",
      },
      {
        mode: "s-bahn",
        line: "S41",
        defaultModel: "sbahn-481",
        alternatives: [],
        confidence: "representative",
      },
      {
        mode: "u-bahn",
        line: "U6",
        defaultModel: "ubahn-h",
        alternatives: [],
        confidence: "representative",
      },
      {
        mode: "tram",
        line: "M1",
        defaultModel: "tram-flexity-long",
        alternatives: [],
        confidence: "representative",
      },
      {
        mode: "regional",
        line: "RE1",
        defaultModel: "odeg-desiro-hc",
        alternatives: [],
        confidence: "family",
      },
      {
        mode: "long-distance",
        line: "1236",
        defaultModel: "rail-generic",
        alternatives: [],
        confidence: "unknown",
      },
      {
        mode: "long-distance",
        line: "ICE509",
        defaultModel: "ice-4",
        alternatives: [],
        confidence: "representative",
      },
    ],
  };
}

function resolve(
  product: TransitProduct,
  line: string,
  operator: string | null = null
) {
  return resolveVehicleModel(parseVehicleModelCatalog(fixture()), {
    product,
    line,
    operator,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("vehicle model catalog validation", () => {
  it("parses the published file without bundling its JSON into application code", () => {
    const value: unknown = JSON.parse(
      readFileSync(
        new URL(
          "../../../public/models/vehicles/catalog.json",
          import.meta.url
        ),
        "utf-8"
      )
    );
    const catalog = parseVehicleModelCatalog(value);
    expect(catalog.models.size).toBe(49);
    expect(catalog.services.size).toBe(266);
    expect(catalog.models.get("ice-4")?.segments).toHaveLength(12);
  });

  it.each([
    null,
    [],
    {},
    { ...fixture(), schemaVersion: 2 },
    { ...fixture(), coordinates: { unit: "centimeter" } },
  ])("rejects unsupported schema %#", (value) => {
    expect(() => parseVehicleModelCatalog(value)).toThrow(
      "Invalid vehicle model catalog"
    );
  });

  it.each([
    {
      ...model("bus-regional", "bus"),
      modelUrl: "https://example.com/model.glb",
    },
    {
      ...model("bus-regional", "bus"),
      modelUrl: "/models/vehicles/../model.glb",
    },
    {
      ...model("bus-regional", "bus"),
      modelUrl: "/models/vehicles/bus-regional.glb?remote=1",
    },
    { ...model("../bus", "bus") },
    {
      ...model("bus-regional", "bus"),
      dimensions: { width: Number.NaN, length: 12, height: 3 },
    },
    {
      ...model("bus-regional", "bus"),
      dimensions: { width: 2, length: Infinity, height: 3 },
    },
    {
      ...model("bus-regional", "bus"),
      dimensions: { width: 0, length: 12, height: 3 },
    },
    { ...model("bus-regional", "bus"), cars: 2 },
    { ...model("bus-regional", "bus"), cars: 1.5 },
    { ...model("bus-regional", "bus"), mode: "aircraft" },
    {
      ...model("bus-regional", "bus"),
      segments: [
        { node: "a", role: "car", length: 12, offset: [0, Infinity, 0] },
      ],
    },
    {
      ...model("bus-regional", "bus"),
      cars: 2,
      segments: [
        model("bus-regional", "bus").segments[0],
        model("bus-regional", "bus").segments[0],
      ],
    },
  ])("rejects unsafe or malformed model %#", (value) => {
    expect(() =>
      parseVehicleModelCatalog({ ...fixture(), models: [value], services: [] })
    ).toThrow("Invalid vehicle model catalog");
  });

  it("rejects duplicates, missing references, cross-mode references, and unsupported confidence", () => {
    const original = fixture();
    expect(() =>
      parseVehicleModelCatalog({
        ...original,
        models: [...original.models, original.models[0]],
      })
    ).toThrow("duplicate model");
    expect(() =>
      parseVehicleModelCatalog({
        ...original,
        services: [...original.services, original.services[0]],
      })
    ).toThrow("duplicate service");
    for (const patch of [
      { defaultModel: "absent" },
      { alternatives: ["absent"] },
      { defaultModel: "ubahn-h" },
      { confidence: "exact" },
    ]) {
      expect(() =>
        parseVehicleModelCatalog({
          ...original,
          services: [{ ...original.services[0], ...patch }],
        })
      ).toThrow("Invalid vehicle model catalog");
    }
  });

  it("copies validated metadata away from mutable input", () => {
    const raw = fixture();
    const catalog = parseVehicleModelCatalog(raw);
    raw.models[0].dimensions.height = 999;
    raw.models[0].segments[0].offset[0] = 999;
    expect(catalog.models.get("bus-bvg-solo")?.dimensions.height).toBe(3.2);
    expect(catalog.models.get("bus-bvg-solo")?.segments[0].offset).toEqual([
      0, 0, 0,
    ]);
  });
});

describe("representative vehicle selection", () => {
  it.each([
    ["suburban", " 41 ", "sbahn-481"],
    ["suburban", "S-Bahn 41", "sbahn-481"],
    ["subway", " u 6 ", "ubahn-h"],
    ["subway", "U-Bahn 6", "ubahn-h"],
    ["tram", "Tram M 1", "tram-flexity-long"],
    ["regional", " RE 1 ", "odeg-desiro-hc"],
    ["express", "ICE 509", "ice-4"],
    ["bus", "Bus S 41", "bus-bvg-solo"],
  ] satisfies [TransitProduct, string, string][])(
    "normalizes %s / %s",
    (product, line, id) => {
      expect(resolve(product, line)?.id).toBe(id);
    }
  );

  it.each(["M1", "S41", "U6"])(
    "keeps replacement BUS %s in the bus family",
    (line) => {
      expect(resolve("bus", line)?.mode).toBe("bus");
    }
  );

  it("uses neutral 1236 and leaves unknown products as markers", () => {
    expect(resolve("express", "1236")?.id).toBe("rail-generic");
    expect(resolve("unknown", "ICE509")).toBeNull();
  });

  it.each([
    ["suburban", "sbahn-481"],
    ["subway", "ubahn-h"],
    ["tram", "tram-flexity-long"],
    ["regional", "db-regio-dosto"],
    ["express", "rail-generic"],
    ["bus", "bus-regional"],
    ["ferry", "ferry-faehrbaer"],
  ] satisfies [TransitProduct, string][])(
    "uses a %s fallback for unlisted services",
    (product, id) => {
      expect(resolve(product, "NEW999")?.id).toBe(id);
    }
  );

  it("does not assign yellow BVG buses to explicit other agencies sharing labels", () => {
    expect(resolve("bus", "100", "ViP Potsdam")?.id).toBe("bus-regional");
    expect(resolve("bus", "300", "BBG")?.id).toBe("bus-regional");
    expect(resolve("bus", "300", "BVG")?.id).toBe("bus-bvg-solo");
    expect(resolve("bus", "100", "Berliner Verkehrsbetriebe (BVG)")?.id).toBe(
      "bus-bvg-solo"
    );
    expect(resolve("bus", "100")?.id).toBe("bus-bvg-solo");
    expect(resolve("bus", "BER2", "Anger Busgesellschaft mbH")?.id).toBe(
      "bus-airport-coach"
    );
    expect(resolve("bus", "BER2", "Unrelated operator")?.id).toBe(
      "bus-regional"
    );
  });
});

describe("vehicle catalog loading", () => {
  it("fetches the static catalog with the caller's abort signal", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(fixture()));
    vi.stubGlobal("fetch", fetcher);
    const controller = new AbortController();
    const catalog = await loadVehicleModelCatalog(controller.signal);
    expect(fetcher).toHaveBeenCalledWith("/models/vehicles/catalog.json", {
      signal: controller.signal,
    });
    expect(catalog.models.get("rail-generic")?.id).toBe("rail-generic");
  });

  it("reports HTTP failures and rejects invalid fetched JSON", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response("{}"));
    vi.stubGlobal("fetch", fetcher);
    await expect(loadVehicleModelCatalog()).rejects.toThrow("HTTP 503");
    await expect(loadVehicleModelCatalog()).rejects.toThrow(
      "Invalid vehicle model catalog"
    );
  });

  it("propagates cancellation so an obsolete load cannot become renderer state", async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(controller.signal.reason));
    await expect(loadVehicleModelCatalog(controller.signal)).rejects.toBe(
      controller.signal.reason
    );
  });
});
