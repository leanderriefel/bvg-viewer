import type { TransitFrame, TransitVehicle } from "./model";
import { MAX_VEHICLE_AGE_MS } from "./model";

export interface TransitPose {
  coordinates: [number, number];
  bearing: number;
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
  return (
    a.coordinates[0] === b.coordinates[0] &&
    a.coordinates[1] === b.coordinates[1]
  );
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
  while (index < frames.length - 2 && frames[index + 1].at <= now) {
    index += 1;
  }
  const from = frames[index];
  const to = frames[index + 1] ?? from;
  const fraction =
    to.at > from.at
      ? Math.max(0, Math.min(1, (now - from.at) / (to.at - from.at)))
      : 0;
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
  result.bearing = 0;
  return result;
}
