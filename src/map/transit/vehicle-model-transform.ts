/* oxlint-disable eslint/prefer-destructuring -- Index tuple inputs directly to avoid iterator allocation in the per-frame transform. */
import { MercatorCoordinate } from "maplibre-gl";
import type { Matrix4 } from "three";

/** Fixed for the lifetime of the scene; camera movements never change it. */
export const VEHICLE_MODEL_ORIGIN = Object.freeze([13.405, 52.52] as const);

const origin = MercatorCoordinate.fromLngLat([
  VEHICLE_MODEL_ORIGIN[0],
  VEHICLE_MODEL_ORIGIN[1],
]);

export const VEHICLE_MODEL_MERCATOR_ORIGIN = Object.freeze({
  x: origin.x,
  y: origin.y,
  z: origin.z,
});
export const VEHICLE_MODEL_ORIGIN_UNITS_PER_METER =
  origin.meterInMercatorCoordinateUnits();

const ORIGIN_LATITUDE_COSINE = Math.cos(
  (VEHICLE_MODEL_ORIGIN[1] * Math.PI) / 180
);
const MAX_MERCATOR_LATITUDE = 85.0511287798066;

/**
 * Places a metre-sized GLB with Y up, +Z forward and its origin at ground centre.
 * The output scene axes are X east, Y up and Z north, in origin-scaled metres.
 * Model size and altitude include Mercator's latitude-dependent metre scale.
 *
 * The renderer must apply the same fixed scene-to-Mercator anchor to its camera:
 * T(mercatorOrigin) * S(originUnitsPerMeter) * Rx(+PI/2). In components this is
 * (origin.x + s*x, origin.y - s*z, s*y). Apply that axis conversion exactly once;
 * do not also rotate or reflect the model. Compass bearing 0 faces north (+Z),
 * and 90 faces east (+X). The target and its element storage are reused.
 */
export function setVehicleModelMatrix(
  target: Matrix4,
  coordinates: readonly [number, number],
  bearingDegrees: number,
  altitudeMeters = 0
): Matrix4 {
  const longitude = coordinates[0];
  const latitude = coordinates[1];
  if (
    !(
      Number.isFinite(longitude) &&
      Math.abs(longitude) <= 180 &&
      Number.isFinite(latitude) &&
      Math.abs(latitude) <= MAX_MERCATOR_LATITUDE &&
      Number.isFinite(bearingDegrees) &&
      Number.isFinite(altitudeMeters)
    )
  ) {
    throw new Error(
      "Vehicle transform requires finite Web Mercator coordinates, bearing and altitude."
    );
  }

  const latitudeRadians = (latitude * Math.PI) / 180;
  const mercatorX = (180 + longitude) / 360;
  const mercatorY =
    (180 -
      (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + latitudeRadians / 2))) /
    360;
  const east =
    (mercatorX - VEHICLE_MODEL_MERCATOR_ORIGIN.x) /
    VEHICLE_MODEL_ORIGIN_UNITS_PER_METER;
  const north =
    (VEHICLE_MODEL_MERCATOR_ORIGIN.y - mercatorY) /
    VEHICLE_MODEL_ORIGIN_UNITS_PER_METER;
  const scale = ORIGIN_LATITUDE_COSINE / Math.cos(latitudeRadians);
  const yaw = (bearingDegrees * Math.PI) / 180;
  const cosine = Math.cos(yaw) * scale;
  const sine = Math.sin(yaw) * scale;

  return target.set(
    cosine,
    0,
    sine,
    east,
    0,
    scale,
    0,
    altitudeMeters * scale,
    -sine,
    0,
    cosine,
    north,
    0,
    0,
    0,
    1
  );
}
