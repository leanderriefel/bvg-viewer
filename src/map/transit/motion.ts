import type { LngLat } from "@/lib/geo";

import type { TransitFrame, TransitVehicle } from "./model";
import { MAX_VEHICLE_AGE_MS } from "./model";

export interface TransitPose {
  coordinates: [number, number];
  bearing: number;
}

const forecastSpeeds = new WeakMap<TransitFrame[], Float64Array>();

function segmentSpeeds(frames: TransitFrame[]): Float64Array {
  const cached = forecastSpeeds.get(frames);
  if (cached) {
    return cached;
  }
  const speeds = new Float64Array(Math.max(0, frames.length - 1));
  for (let index = 0; index < speeds.length; index += 1) {
    const from = frames[index];
    const to = frames[index + 1];
    const east =
      (to.coordinates[0] - from.coordinates[0]) *
      111_320 *
      Math.cos(((from.coordinates[1] + to.coordinates[1]) * Math.PI) / 360);
    const north = (to.coordinates[1] - from.coordinates[1]) * 111_320;
    const distance = Math.hypot(east, north);
    speeds[index] =
      distance < 1 || to.at <= from.at ? 0 : distance / (to.at - from.at);
  }
  forecastSpeeds.set(frames, speeds);
  return speeds;
}

/** Blend speed along each supplied segment, retaining every bend and dwell. */
export function forecastTravelFraction(
  frames: TransitFrame[],
  index: number,
  fraction: number
): number {
  const speeds = segmentSpeeds(frames);
  const speed = speeds[index];
  if (!speed || fraction === 0 || fraction === 1) {
    return fraction;
  }
  const previous = speeds[index - 1] ?? speed;
  const next = speeds[index + 1] ?? speed;
  // Harmonic means give adjacent segments the same speed at their shared
  // vertex, reach zero at dwell frames, and keep progress monotone.
  const incoming = (2 * previous) / (previous + speed);
  const outgoing = (2 * next) / (next + speed);
  const remaining = 1 - fraction;
  return (
    fraction * fraction * (3 - 2 * fraction) +
    incoming * fraction * remaining * remaining -
    outgoing * fraction * fraction * remaining
  );
}

function heading(from: TransitFrame, to: TransitFrame): number {
  const midLatitude =
    ((from.coordinates[1] + to.coordinates[1]) * Math.PI) / 360;
  const east =
    (to.coordinates[0] - from.coordinates[0]) * Math.cos(midLatitude);
  const north = to.coordinates[1] - from.coordinates[1];
  return ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360;
}

function samePosition(a: TransitFrame, b: TransitFrame): boolean {
  const north = (b.coordinates[1] - a.coordinates[1]) * 111_320;
  const east =
    (b.coordinates[0] - a.coordinates[0]) *
    111_320 *
    Math.cos((a.coordinates[1] * Math.PI) / 180);
  // Sub-metre coordinate noise should not turn a stopped vehicle around.
  return north * north + east * east < 1;
}

/** Interpolate a heading over the shortest arc, including the 359° → 1° seam. */
export function smoothBearing(
  from: number,
  to: number,
  fraction: number
): number {
  if (
    !(Number.isFinite(from) && Number.isFinite(to) && Number.isFinite(fraction))
  ) {
    return from;
  }
  const difference = ((((to - from + 540) % 360) + 360) % 360) - 180;
  return (
    (((from + difference * Math.max(0, Math.min(1, fraction))) % 360) + 360) %
    360
  );
}

/** A nearby supplied route can orient a stopped vehicle without snapping its position. */
export function routeBearing(
  coordinates: LngLat[],
  point: LngLat,
  previousBearing?: number
): number | null {
  const longitudeScale = 111_320 * Math.cos((point[1] * Math.PI) / 180);
  let nearestScore = Infinity;
  let nearestHeading: number | null = null;
  for (let index = 1; index < coordinates.length; index += 1) {
    const from = coordinates[index - 1];
    const to = coordinates[index];
    const east = (to[0] - from[0]) * longitudeScale;
    const north = (to[1] - from[1]) * 111_320;
    const lengthSquared = east * east + north * north;
    if (lengthSquared < 1) {
      continue;
    }
    const fromEast = (from[0] - point[0]) * longitudeScale;
    const fromNorth = (from[1] - point[1]) * 111_320;
    const fraction = Math.max(
      0,
      Math.min(1, -(fromEast * east + fromNorth * north) / lengthSquared)
    );
    const distance = Math.hypot(
      fromEast + east * fraction,
      fromNorth + north * fraction
    );
    if (distance > 80) {
      continue;
    }
    const bearing = ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360;
    const difference =
      previousBearing === undefined
        ? 0
        : Math.abs(((bearing - previousBearing + 540) % 360) - 180);
    // Prefer continuity at crossings and nearby parallel tracks, while distance
    // remains dominant. The supplied route retains its direction of travel.
    const score = distance + (difference / 180) * 8;
    if (score < nearestScore) {
      nearestScore = score;
      nearestHeading = bearing;
    }
  }
  return nearestHeading;
}

/** Sample only inside the supplied prediction horizon; never extrapolate. */
export function sampleVehicle(
  vehicle: TransitVehicle,
  now: number,
  target?: TransitPose
): TransitPose | null {
  if (!Number.isFinite(now) || now - vehicle.observedAt > MAX_VEHICLE_AGE_MS) {
    return null;
  }
  const { frames } = vehicle;
  const [first] = frames;
  const last = frames.at(-1);
  if (!(first && last)) {
    return null;
  }
  let index = 0;
  let upper = Math.max(0, frames.length - 2);
  while (index < upper) {
    const middle = Math.ceil((index + upper) / 2);
    if (frames[middle].at <= now) {
      index = middle;
    } else {
      upper = middle - 1;
    }
  }
  const from = frames[index];
  const to = frames[index + 1] ?? from;
  const linearFraction =
    to.at > from.at
      ? Math.max(0, Math.min(1, (now - from.at) / (to.at - from.at)))
      : 0;
  const fraction = forecastTravelFraction(frames, index, linearFraction);
  const result = target ?? { coordinates: [0, 0], bearing: 0 };
  result.coordinates[0] =
    from.coordinates[0] + (to.coordinates[0] - from.coordinates[0]) * fraction;
  result.coordinates[1] =
    from.coordinates[1] + (to.coordinates[1] - from.coordinates[1]) * fraction;
  if (!samePosition(from, to)) {
    result.bearing = heading(from, to);
    return result;
  }
  // Dwell frames share a position. Preserve the next direction of travel, or
  // the final incoming direction if the vehicle has reached the horizon.
  for (let next = index + 1; next < frames.length; next += 1) {
    if (!samePosition(from, frames[next])) {
      result.bearing = heading(from, frames[next]);
      return result;
    }
  }
  for (let previous = index - 1; previous >= 0; previous -= 1) {
    if (!samePosition(frames[previous], from)) {
      result.bearing = heading(frames[previous], from);
      return result;
    }
  }
  // A supplied output pose carries the last reliable heading through a dwell
  // or an update that contains no movement information.
  result.bearing = target?.bearing ?? 0;
  return result;
}
