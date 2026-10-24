/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-unsafe-dictionary-type -- This module is the schema boundary that narrows untrusted API and disk JSON before use. */
import type { LngLat } from "@/lib/geo";

export const MAX_VEHICLE_AGE_MS = 90_000;
export const TRANSIT_PRODUCTS = [
  "suburban",
  "subway",
  "tram",
  "bus",
  "ferry",
  "regional",
  "express",
  "unknown",
] as const;

export type TransitProduct = (typeof TRANSIT_PRODUCTS)[number];

export const PRODUCT_LABELS: Record<TransitProduct, string> = {
  suburban: "S-Bahn",
  subway: "U-Bahn",
  tram: "Tram",
  bus: "Bus",
  ferry: "Ferry",
  regional: "Regional",
  express: "IC / ICE",
  unknown: "Other",
};

export const PRODUCT_COLORS: Record<TransitProduct, string> = {
  suburban: "#168345",
  subway: "#1767ad",
  tram: "#ce313f",
  bus: "#a13a90",
  ferry: "#168ba2",
  regional: "#e06e21",
  express: "#5e56b6",
  unknown: "#667085",
};

export interface TransitFrame {
  at: number;
  coordinates: LngLat;
}

/** Radar positions are upstream predictions, including any available delay. */
export interface TransitVehicle {
  id: string;
  line: string;
  product: TransitProduct;
  direction: string;
  operator: string | null;
  location: LngLat;
  observedAt: number;
  delay: number | null;
  nextStop: string | null;
  route: LngLat[];
  frames: TransitFrame[];
}

export interface TransitSnapshot {
  vehicles: TransitVehicle[];
  updatedAt: number | null;
  realtimeDataUpdatedAt: number | null;
  coverage: { total: number; succeeded: number; capped: number };
  status: "starting" | "live" | "degraded" | "offline";
  error: string | null;
  storage: "disk" | "memory";
  pollIntervalMs: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 512
    ? value
    : null;
}

function coordinate(value: unknown): LngLat | null {
  if (!Array.isArray(value) || value.length !== 2) {
    return null;
  }
  const [lng, lat] = value;
  return finite(lng) &&
    finite(lat) &&
    Math.abs(lng) <= 180 &&
    Math.abs(lat) <= 90
    ? [lng, lat]
    : null;
}

function location(value: unknown): LngLat | null {
  return isRecord(value) ? coordinate([value.longitude, value.latitude]) : null;
}

function product(value: unknown): TransitProduct {
  return TRANSIT_PRODUCTS.find((candidate) => candidate === value) ?? "unknown";
}

function readFrames(movement: Record<string, unknown>, observedAt: number) {
  const frames: TransitFrame[] = [];
  const { polyline } = movement;
  const rawFrames = movement.frames;
  // HAFAS radar's polyline is a sequence of predicted positions, one per
  // frame. Origin/destination in a frame are stops, not vehicle coordinates.
  // https://github.com/public-transport/hafas-client/blob/6/parse/movement.js
  if (
    !(
      isRecord(polyline) &&
      Array.isArray(polyline.features) &&
      Array.isArray(rawFrames) &&
      polyline.features.length === rawFrames.length &&
      rawFrames.length <= 121
    )
  ) {
    return frames;
  }
  let lastOffset = -1;
  for (let i = 0; i < rawFrames.length; i += 1) {
    const frame: unknown = rawFrames[i];
    const feature: unknown = polyline.features[i];
    if (!(isRecord(frame) && isRecord(feature) && isRecord(feature.geometry))) {
      return [];
    }
    const point = coordinate(feature.geometry.coordinates);
    if (
      !(
        feature.geometry.type === "Point" &&
        point &&
        finite(frame.t) &&
        frame.t >= 0 &&
        frame.t <= 120_000 &&
        frame.t > lastOffset
      )
    ) {
      return [];
    }
    frames.push({ at: observedAt + frame.t, coordinates: point });
    lastOffset = frame.t;
  }
  return frames;
}

function nextStopover(movement: Record<string, unknown>, observedAt: number) {
  if (!Array.isArray(movement.nextStopovers)) {
    return null;
  }
  const firstFrame: unknown = Array.isArray(movement.frames)
    ? movement.frames[0]
    : null;
  const destination =
    isRecord(firstFrame) && isRecord(firstFrame.destination)
      ? firstFrame.destination
      : null;
  const stopovers = movement.nextStopovers.filter(isRecord);
  // Some upstream responses begin with the trip's first stop; do not report
  // its old delay as the delay at the next stop.
  const match = stopovers.find((stopover) =>
    isRecord(stopover.stop) && destination && text(destination.id)
      ? stopover.stop.id === destination.id
      : false
  );
  if (match) {
    return match;
  }
  return (
    stopovers.find((stopover) => {
      const when = text(stopover.arrival) ?? text(stopover.departure);
      return when !== null && Date.parse(when) >= observedAt;
    }) ?? null
  );
}

function normalizeMovement(
  value: unknown,
  observedAt: number
): TransitVehicle | null {
  if (!isRecord(value) || !isRecord(value.line)) {
    return null;
  }
  const id = text(value.tripId);
  const point = location(value.location);
  const line = text(value.line.name) ?? text(value.line.id);
  if (!(id && point && line) || value.cancelled === true) {
    return null;
  }
  const frames = readFrames(value, observedAt);
  const next = nextStopover(value, observedAt);
  const delay = next?.arrivalDelay ?? next?.departureDelay;
  return {
    id,
    line,
    product: product(value.line.product),
    direction: text(value.direction) ?? "Unknown destination",
    operator: isRecord(value.line.operator)
      ? text(value.line.operator.name)
      : null,
    location: point,
    observedAt,
    delay: finite(delay) && Math.abs(delay) <= 86_400 ? delay : null,
    nextStop: next && isRecord(next.stop) ? text(next.stop.name) : null,
    route: frames.map((frame) => frame.coordinates),
    frames:
      frames.length > 0 ? frames : [{ at: observedAt, coordinates: point }],
  };
}

/** Reject invalid responses; malformed individual movements are ignored. */
export function normalizeRadar(
  value: unknown,
  observedAt: number
): TransitVehicle[] {
  if (!finite(observedAt) || observedAt < 0) {
    throw new Error("Radar observation time must be a finite Unix timestamp.");
  }
  if (
    !(isRecord(value) && Array.isArray(value.movements)) ||
    value.movements.length > 4096
  ) {
    throw new Error("VBB radar returned an invalid movements response.");
  }
  const vehicles = new Map<string, TransitVehicle>();
  for (const movement of value.movements) {
    const vehicle = normalizeMovement(movement, observedAt);
    if (vehicle) {
      vehicles.set(vehicle.id, vehicle);
    }
  }
  return [...vehicles.values()];
}

function nullableTimestamp(value: unknown): value is number | null {
  return value === null || (finite(value) && value >= 0);
}

function nullableText(value: unknown): value is string | null {
  return value === null || text(value) !== null;
}

function readStoredFrames(
  value: unknown,
  observedAt: number
): TransitFrame[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 121) {
    return null;
  }
  const frames: TransitFrame[] = [];
  let previousAt = -1;
  for (const frame of value) {
    if (!isRecord(frame)) {
      return null;
    }
    const framePoint = coordinate(frame.coordinates);
    if (
      !(
        framePoint &&
        finite(frame.at) &&
        frame.at >= observedAt &&
        frame.at <= observedAt + 120_000 &&
        frame.at > previousAt
      )
    ) {
      return null;
    }
    frames.push({ at: frame.at, coordinates: framePoint });
    previousAt = frame.at;
  }
  return frames;
}

function readRoute(value: unknown): LngLat[] | null {
  if (!Array.isArray(value) || value.length > 121) {
    return null;
  }
  const route: LngLat[] = [];
  for (const routePoint of value) {
    const parsed = coordinate(routePoint);
    if (!parsed) {
      return null;
    }
    route.push(parsed);
  }
  return route;
}

function readStoredVehicle(value: unknown): TransitVehicle | null {
  if (!isRecord(value)) {
    return null;
  }
  const point = coordinate(value.location);
  if (
    !(
      text(value.id) &&
      text(value.line) &&
      text(value.direction) &&
      nullableText(value.operator) &&
      nullableText(value.nextStop) &&
      finite(value.observedAt) &&
      value.observedAt >= 0 &&
      (value.delay === null ||
        (finite(value.delay) && Math.abs(value.delay) <= 86_400)) &&
      point &&
      TRANSIT_PRODUCTS.some((candidate) => candidate === value.product)
    )
  ) {
    return null;
  }
  const frames = readStoredFrames(value.frames, value.observedAt);
  const route = readRoute(value.route);
  if (!(frames && route)) {
    return null;
  }
  // Every field has been checked above; rebuilding prevents foreign fields
  // from entering the browser store or a persisted snapshot.
  return {
    id: String(value.id),
    line: String(value.line),
    product: product(value.product),
    direction: String(value.direction),
    operator: value.operator,
    location: point,
    observedAt: value.observedAt,
    delay: value.delay,
    nextStop: value.nextStop,
    route,
    frames,
  };
}

function readCoverage(value: unknown): TransitSnapshot["coverage"] | null {
  if (!isRecord(value)) {
    return null;
  }
  const { total, succeeded, capped } = value;
  if (
    !(
      finite(total) &&
      Number.isInteger(total) &&
      total > 0 &&
      total <= 256 &&
      finite(succeeded) &&
      Number.isInteger(succeeded) &&
      succeeded >= 0 &&
      succeeded <= total &&
      finite(capped) &&
      Number.isInteger(capped) &&
      capped >= 0 &&
      capped <= total
    )
  ) {
    return null;
  }
  return { total, succeeded, capped };
}

function snapshotStatus(value: unknown): TransitSnapshot["status"] | null {
  const statuses: TransitSnapshot["status"][] = [
    "starting",
    "live",
    "degraded",
    "offline",
  ];
  return statuses.find((candidate) => candidate === value) ?? null;
}

function snapshotStorage(value: unknown): TransitSnapshot["storage"] | null {
  return value === "disk" || value === "memory" ? value : null;
}

/** Shared validation for the disk cache and the same-origin browser endpoint. */
export function readTransitSnapshot(value: unknown): TransitSnapshot | null {
  if (!isRecord(value)) {
    return null;
  }
  const coverage = readCoverage(value.coverage);
  const status = snapshotStatus(value.status);
  const storage = snapshotStorage(value.storage);
  if (
    !(
      Array.isArray(value.vehicles) &&
      value.vehicles.length <= 16_384 &&
      nullableTimestamp(value.updatedAt) &&
      nullableTimestamp(value.realtimeDataUpdatedAt) &&
      coverage &&
      status &&
      storage &&
      (value.error === null ||
        (typeof value.error === "string" && value.error.length <= 2048)) &&
      finite(value.pollIntervalMs) &&
      value.pollIntervalMs >= 1000 &&
      value.pollIntervalMs <= 3_600_000
    )
  ) {
    return null;
  }
  const vehicles: TransitVehicle[] = [];
  for (const candidate of value.vehicles) {
    const vehicle = readStoredVehicle(candidate);
    if (!vehicle) {
      return null;
    }
    vehicles.push(vehicle);
  }
  return {
    vehicles,
    updatedAt: value.updatedAt,
    realtimeDataUpdatedAt: value.realtimeDataUpdatedAt,
    coverage,
    status,
    error: value.error,
    storage,
    pollIntervalMs: value.pollIntervalMs,
  };
}
