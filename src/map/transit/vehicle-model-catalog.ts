/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-unsafe-dictionary-type -- This module validates external catalog JSON before the renderer uses it. */
import type { TransitProduct, TransitVehicle } from "./model";
import { displayTransitLine } from "./network";

const MODES = [
  "s-bahn",
  "u-bahn",
  "tram",
  "bus",
  "regional",
  "long-distance",
  "ferry",
] as const;
export type VehicleModelMode = (typeof MODES)[number];
export type VehicleModelConfidence = "family" | "representative" | "unknown";

export interface VehicleModelSegment {
  node: string;
  length: number;
  offset: readonly [number, number, number];
  role: string;
}

/** A representative visual family, never a claim about dispatched stock. */
export interface VehicleModelAsset {
  id: string;
  name: string;
  mode: VehicleModelMode;
  modelUrl: string;
  dimensions: { width: number; length: number; height: number };
  segments: readonly VehicleModelSegment[];
  cars: number;
}

export interface VehicleModelService {
  mode: VehicleModelMode;
  line: string;
  defaultModel: string;
  alternatives: readonly string[];
  confidence: VehicleModelConfidence;
}

export interface VehicleModelCatalog {
  models: ReadonlyMap<string, VehicleModelAsset>;
  services: ReadonlyMap<string, VehicleModelService>;
  fallbacks: ReadonlyMap<VehicleModelMode, VehicleModelAsset>;
}

const PRODUCT_MODE: Record<TransitProduct, VehicleModelMode | null> = {
  suburban: "s-bahn",
  subway: "u-bahn",
  tram: "tram",
  bus: "bus",
  regional: "regional",
  express: "long-distance",
  ferry: "ferry",
  unknown: null,
};
const MODE_PRODUCT: Record<VehicleModelMode, TransitProduct> = {
  "s-bahn": "suburban",
  "u-bahn": "subway",
  tram: "tram",
  bus: "bus",
  regional: "regional",
  "long-distance": "express",
  ferry: "ferry",
};
const LABEL_PREFIX: Record<TransitProduct, RegExp> = {
  suburban: /^s-?bahn\s+/iu,
  subway: /^u-?bahn\s+/iu,
  tram: /^(?:tram|straßenbahn|strassenbahn)\s+/iu,
  bus: /^bus\s+/iu,
  regional: /^(?:regionalbahn|regionalexpress)\s+/iu,
  express: /^(?:express)\s+/iu,
  ferry: /^(?:ferry|fähre)\s+/iu,
  unknown: /^$/u,
};
const FALLBACK_IDS: Record<VehicleModelMode, string> = {
  "s-bahn": "sbahn-481",
  "u-bahn": "ubahn-h",
  tram: "tram-flexity-long",
  bus: "bus-regional",
  regional: "db-regio-dosto",
  "long-distance": "rail-generic",
  ferry: "ferry-faehrbaer",
};
const BVG_OPERATOR = /^(?:bvg|berliner verkehrsbetriebe)(?:$|[\s(])/iu;
const AIRPORT_OPERATOR = /\banger\b/iu;
const LABEL_WHITESPACE = /\s+/gu;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): value is string {
  return (
    typeof value === "string" && value.trim().length > 0 && value.length <= 256
  );
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function positive(value: unknown): value is number {
  return finite(value) && value > 0;
}

function fail(detail: string): never {
  throw new Error(`Invalid vehicle model catalog: ${detail}.`);
}

function mode(value: unknown): VehicleModelMode {
  return (
    MODES.find((candidate) => candidate === value) ?? fail("unsupported mode")
  );
}

function lineLabel(line: string, product: TransitProduct): string {
  return displayTransitLine({
    product,
    line: line
      .trim()
      .replace(LABEL_PREFIX[product], "")
      .replaceAll(LABEL_WHITESPACE, ""),
  }).toUpperCase();
}

function readSegment(value: unknown): VehicleModelSegment {
  if (
    !(
      record(value) &&
      text(value.node) &&
      text(value.role) &&
      positive(value.length)
    )
  ) {
    return fail("invalid segment");
  }
  const { offset } = value;
  if (!(Array.isArray(offset) && offset.length === 3)) {
    return fail("segment offset must contain three finite numbers");
  }
  const [x, y, z]: unknown[] = offset;
  if (!(finite(x) && finite(y) && finite(z))) {
    return fail("segment offset must contain three finite numbers");
  }
  return {
    node: value.node,
    role: value.role,
    length: value.length,
    offset: [x, y, z],
  };
}

function readModel(value: unknown): VehicleModelAsset {
  if (
    !(
      record(value) &&
      text(value.id) &&
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value.id) &&
      text(value.name)
    )
  ) {
    return fail("invalid model identity");
  }
  if (value.modelUrl !== `/models/vehicles/${value.id}.glb`) {
    return fail(`unsafe model URL for ${value.id}`);
  }
  const { dimensions, cars, segments } = value;
  if (
    !(
      record(dimensions) &&
      positive(dimensions.width) &&
      positive(dimensions.length) &&
      positive(dimensions.height)
    )
  ) {
    return fail(`invalid dimensions for ${value.id}`);
  }
  if (
    !(
      positive(cars) &&
      Number.isInteger(cars) &&
      cars <= 32 &&
      Array.isArray(segments) &&
      segments.length === cars
    )
  ) {
    return fail(`invalid segment count for ${value.id}`);
  }
  const parsedSegments = segments.map(readSegment);
  if (new Set(parsedSegments.map(({ node }) => node)).size !== cars) {
    return fail(`duplicate segment names for ${value.id}`);
  }
  return {
    id: value.id,
    name: value.name,
    mode: mode(value.mode),
    modelUrl: value.modelUrl,
    dimensions: {
      width: dimensions.width,
      length: dimensions.length,
      height: dimensions.height,
    },
    cars,
    segments: parsedSegments,
  };
}

function readService(value: unknown): VehicleModelService {
  if (
    !(
      record(value) &&
      text(value.line) &&
      text(value.defaultModel) &&
      Array.isArray(value.alternatives) &&
      value.alternatives.length <= 256 &&
      value.alternatives.every(text)
    )
  ) {
    return fail("invalid service");
  }
  const confidence = ["family", "representative", "unknown"] as const;
  const parsedConfidence = confidence.find(
    (candidate) => candidate === value.confidence
  );
  if (!parsedConfidence) {
    return fail("unsupported confidence");
  }
  const serviceMode = mode(value.mode);
  return {
    mode: serviceMode,
    line: lineLabel(value.line, MODE_PRODUCT[serviceMode]),
    defaultModel: value.defaultModel,
    alternatives: [...value.alternatives],
    confidence: parsedConfidence,
  };
}

function supportedCoordinates(value: unknown): boolean {
  return (
    record(value) &&
    value.unit === "meter" &&
    value.up === "+Y" &&
    value.forward === "+Z" &&
    value.origin === "ground-center"
  );
}

export function parseVehicleModelCatalog(value: unknown): VehicleModelCatalog {
  if (
    !(
      record(value) &&
      value.schemaVersion === 1 &&
      supportedCoordinates(value.coordinates) &&
      Array.isArray(value.models) &&
      value.models.length > 0 &&
      value.models.length <= 256 &&
      Array.isArray(value.services) &&
      value.services.length <= 4096
    )
  ) {
    return fail("unsupported schema or coordinates");
  }
  const models = new Map<string, VehicleModelAsset>();
  const services = new Map<string, VehicleModelService>();
  const fallbacks = new Map<VehicleModelMode, VehicleModelAsset>();
  for (const candidate of value.models) {
    const model = readModel(candidate);
    if (models.has(model.id)) {
      return fail(`duplicate model ${model.id}`);
    }
    models.set(model.id, model);
    if (!fallbacks.has(model.mode) || model.id === FALLBACK_IDS[model.mode]) {
      fallbacks.set(model.mode, model);
    }
  }
  for (const candidate of value.services) {
    const service = readService(candidate);
    const key = `${service.mode}:${service.line}`;
    if (services.has(key)) {
      return fail(`duplicate service ${key}`);
    }
    const references = [service.defaultModel, ...service.alternatives];
    if (
      new Set(references).size !== references.length ||
      references.some((id) => models.get(id)?.mode !== service.mode)
    ) {
      return fail(`invalid model references for ${key}`);
    }
    services.set(key, service);
  }
  return { models, services, fallbacks };
}

export async function loadVehicleModelCatalog(
  signal?: AbortSignal
): Promise<VehicleModelCatalog> {
  const response = await fetch("/models/vehicles/catalog.json", { signal });
  if (!response.ok) {
    throw new Error(
      `Unable to load vehicle model catalog (HTTP ${response.status}).`
    );
  }
  const value: unknown = await response.json();
  return parseVehicleModelCatalog(value);
}

/** Route defaults depict a family; mode and explicit agency outrank a short label. */
export function resolveVehicleModel(
  catalog: VehicleModelCatalog,
  vehicle: Pick<TransitVehicle, "product" | "line" | "operator">
): VehicleModelAsset | null {
  const vehicleMode = PRODUCT_MODE[vehicle.product];
  if (!vehicleMode) {
    return null;
  }
  const line = lineLabel(vehicle.line, vehicle.product);
  if (vehicle.product === "bus" && vehicle.operator?.trim()) {
    const isBvg = BVG_OPERATOR.test(vehicle.operator.trim());
    const isAirportOperator =
      line === "BER2" && AIRPORT_OPERATOR.test(vehicle.operator);
    if (!(isBvg || isAirportOperator)) {
      return catalog.models.get("bus-regional") ?? null;
    }
  }
  const service = catalog.services.get(`${vehicleMode}:${line}`);
  return (
    (service
      ? catalog.models.get(service.defaultModel)
      : catalog.fallbacks.get(vehicleMode)) ?? null
  );
}
