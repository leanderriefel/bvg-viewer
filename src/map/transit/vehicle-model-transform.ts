/* oxlint-disable eslint/prefer-destructuring -- Index tuple inputs directly to avoid iterator allocation in the per-frame transform. */
import { MercatorCoordinate } from "maplibre-gl";
import type { Matrix4 } from "three";

export interface VehicleModelOrigin {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly unitsPerMeter: number;
  readonly latitudeCosine: number;
}

/** Share one nearby origin between every instance and its projection matrix. */
export function createVehicleModelOrigin(coordinates: {
  lng: number;
  lat: number;
}): VehicleModelOrigin {
  const mercator = MercatorCoordinate.fromLngLat(coordinates);
  return {
    x: mercator.x,
    y: mercator.y,
    z: mercator.z,
    unitsPerMeter: mercator.meterInMercatorCoordinateUnits(),
    latitudeCosine: Math.cos((coordinates.lat * Math.PI) / 180),
  };
}

const DEFAULT_ORIGIN = createVehicleModelOrigin({ lng: 13.405, lat: 52.52 });
const MAX_MERCATOR_LATITUDE = 85.0511287798066;

/**
 * Places a metre-sized GLB with Y up, +Z forward and its origin at ground centre.
 * The output scene axes are X east, Y up and Z north, in origin-scaled metres.
 * Model size and altitude include Mercator's latitude-dependent metre scale.
 *
 * The renderer must apply the same scene-to-Mercator anchor to its camera:
 * T(mercatorOrigin) * S(originUnitsPerMeter) * Rx(+PI/2). In components this is
 * (origin.x + s*x, origin.y - s*z, s*y). Apply that axis conversion exactly once;
 * do not also rotate or reflect the model. Compass bearing 0 faces north (+Z),
 * and 90 faces east (+X). The target and its element storage are reused.
 */
export function setVehicleModelMatrix(
  target: Matrix4,
  coordinates: readonly [number, number],
  bearingDegrees: number,
  altitudeMeters = 0,
  origin: VehicleModelOrigin = DEFAULT_ORIGIN
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
  const east = (mercatorX - origin.x) / origin.unitsPerMeter;
  const north = (origin.y - mercatorY) / origin.unitsPerMeter;
  const scale = origin.latitudeCosine / Math.cos(latitudeRadians);
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
