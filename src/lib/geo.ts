/** Berlin-wide geographic constants shared by the map, tile pipeline and search. */

export type LngLat = [number, number];
export type BBox = [number, number, number, number];

/** Bounding box of Berlin plus a thin ring of Brandenburg: [w, s, e, n]. */
export const BERLIN_BBOX: BBox = [13.0883, 52.3383, 13.7612, 52.6755];

/** A slightly padded box used to clamp the camera so users cannot drift away. */
export const BERLIN_MAX_BOUNDS: BBox = [12.9383, 52.2683, 13.9112, 52.7455];

/** Mitte, looking over the Spree towards the Fernsehturm. */
export const BERLIN_CENTER: LngLat = [13.405, 52.52];

export const BERLIN_TIMEZONE = "Europe/Berlin";

export const DEFAULT_CAMERA = {
  bearing: -18,
  center: BERLIN_CENTER,
  pitch: 55,
  zoom: 14.2,
} as const;

/** Zoom at which the flat fills hand over to real extruded geometry. */
export const EXTRUSION_MIN_ZOOM = 14;

export function isInsideBerlin([lng, lat]: LngLat): boolean {
  const [w, s, e, n] = BERLIN_MAX_BOUNDS;
  return lng >= w && lng <= e && lat >= s && lat <= n;
}

/** Metres per pixel at a given latitude and zoom, for Web Mercator. */
export function metersPerPixel(lat: number, zoom: number): number {
  return (156_543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(meters < 10_000 ? 1 : 0)} km`;
}

const EARTH_RADIUS_M = 6_371_008.8;

const toRad = (degrees: number) => (degrees * Math.PI) / 180;

/** Great-circle distance in metres. */
export function haversine(a: LngLat, b: LngLat): number {
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** Formats a coordinate pair the way Google Maps does. */
export function formatLngLat([lng, lat]: LngLat, precision = 5): string {
  return `${lat.toFixed(precision)}, ${lng.toFixed(precision)}`;
}
