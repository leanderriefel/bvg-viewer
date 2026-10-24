import type { LngLat } from "@/lib/geo";
import type { TransitVehicle } from "@/map/transit/model";

const METRES_PER_DEGREE = 111_320;
const MAX_CORRECTION_MS = 30_000;
const MAX_DISTANCE_M = 20;

/** Find a nearby point on the new forecast without cutting across a route bend. */
export function forecastCorrectionMs(
  vehicle: TransitVehicle,
  position: LngLat,
  now: number
): number {
  const longitudeScale =
    METRES_PER_DEGREE * Math.cos((position[1] * Math.PI) / 180);
  let bestDistance = Infinity;
  let bestTime = now;
  for (let index = 1; index < vehicle.frames.length; index += 1) {
    const from = vehicle.frames[index - 1];
    const to = vehicle.frames[index];
    const east = (to.coordinates[0] - from.coordinates[0]) * longitudeScale;
    const north = (to.coordinates[1] - from.coordinates[1]) * METRES_PER_DEGREE;
    const lengthSquared = east * east + north * north;
    if (lengthSquared < 1) {
      continue;
    }
    const positionEast = (position[0] - from.coordinates[0]) * longitudeScale;
    const positionNorth =
      (position[1] - from.coordinates[1]) * METRES_PER_DEGREE;
    const fraction = Math.max(
      0,
      Math.min(1, (positionEast * east + positionNorth * north) / lengthSquared)
    );
    const distance =
      (positionEast - fraction * east) ** 2 +
      (positionNorth - fraction * north) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestTime = from.at + (to.at - from.at) * fraction;
    }
  }
  const offset = bestTime - now;
  return bestDistance <= MAX_DISTANCE_M ** 2 &&
    Math.abs(offset) <= MAX_CORRECTION_MS
    ? offset
    : 0;
}
