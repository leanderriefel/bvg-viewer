/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-unsafe-dictionary-type -- This module validates untrusted route JSON at the server and browser boundary. */
import type { LngLat } from "@/lib/geo";

export const MAX_ROUTE_POINTS = 20_000;

export interface TransitRoute {
  tripId: string;
  line: string;
  coordinates: LngLat[];
  stops: { name: string; coordinates: LngLat }[];
  updatedAt: number;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function label(value: unknown, max = 512): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= max &&
    // oxlint-disable-next-line eslint/no-control-regex -- Reject control characters at the external input boundary.
    !/[\u0000-\u001F\u007F]/u.test(value)
  );
}

function point(value: unknown): LngLat | null {
  if (!Array.isArray(value) || value.length !== 2) {
    return null;
  }
  const [longitude, latitude] = value;
  return typeof longitude === "number" &&
    Number.isFinite(longitude) &&
    Math.abs(longitude) <= 180 &&
    typeof latitude === "number" &&
    Number.isFinite(latitude) &&
    Math.abs(latitude) <= 90
    ? [longitude, latitude]
    : null;
}

export function validRouteIdentity(tripId: string, line: string): boolean {
  return label(tripId) && label(line, 128);
}

/** Trip shapes contain intermediate track/road points, not just station centres. */
export function normalizeTripRoute(
  value: unknown,
  tripId: string,
  line: string,
  updatedAt: number
): TransitRoute {
  if (
    !validRouteIdentity(tripId, line) ||
    !Number.isFinite(updatedAt) ||
    updatedAt < 0
  ) {
    throw new Error("Invalid trip route identity or timestamp");
  }
  if (
    !(
      record(value) &&
      record(value.trip) &&
      record(value.trip.polyline) &&
      Array.isArray(value.trip.polyline.features)
    )
  ) {
    throw new Error("VBB did not return a geographic route shape");
  }
  const { trip } = value;
  if (typeof trip.id === "string" && trip.id !== tripId) {
    throw new Error("VBB returned a different trip route");
  }
  const { features } = value.trip.polyline;
  if (features.length < 2 || features.length > MAX_ROUTE_POINTS) {
    throw new Error("VBB returned an invalid route shape size");
  }
  const coordinates: LngLat[] = [];
  const stops: TransitRoute["stops"] = [];
  for (const feature of features) {
    if (
      !(
        record(feature) &&
        record(feature.geometry) &&
        feature.geometry.type === "Point"
      )
    ) {
      throw new Error("VBB returned an invalid route point");
    }
    const coordinates_ = point(feature.geometry.coordinates);
    if (!coordinates_) {
      throw new Error("VBB returned invalid route coordinates");
    }
    coordinates.push(coordinates_);
    if (record(feature.properties) && label(feature.properties.name)) {
      stops.push({ name: feature.properties.name, coordinates: coordinates_ });
    }
  }
  return { tripId, line, coordinates, stops: stops.slice(0, 1000), updatedAt };
}

export function readTransitRoute(value: unknown): TransitRoute | null {
  if (
    !(
      record(value) &&
      label(value.tripId) &&
      label(value.line, 128) &&
      typeof value.updatedAt === "number" &&
      Number.isFinite(value.updatedAt) &&
      value.updatedAt >= 0 &&
      Array.isArray(value.coordinates) &&
      value.coordinates.length >= 2 &&
      value.coordinates.length <= MAX_ROUTE_POINTS &&
      Array.isArray(value.stops) &&
      value.stops.length <= 1000
    )
  ) {
    return null;
  }
  const coordinates: LngLat[] = [];
  for (const coordinate of value.coordinates) {
    const parsed = point(coordinate);
    if (!parsed) {
      return null;
    }
    coordinates.push(parsed);
  }
  const stops: TransitRoute["stops"] = [];
  for (const stop of value.stops) {
    if (!(record(stop) && label(stop.name))) {
      return null;
    }
    const parsed = point(stop.coordinates);
    if (!parsed) {
      return null;
    }
    stops.push({ name: stop.name, coordinates: parsed });
  }
  return {
    tripId: value.tripId,
    line: value.line,
    coordinates,
    stops,
    updatedAt: value.updatedAt,
  };
}
