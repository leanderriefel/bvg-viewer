import type { LngLat } from "@/lib/geo";
import type { TransitVehicle } from "@/map/transit/model";
import { forecastTravelFraction } from "@/map/transit/motion";

const METRES_PER_DEGREE = 111_320;
const MAX_CORRECTION_MS = 30_000;
const MAX_DISTANCE_M = 20;

/** Ease a clock offset away without reversing or racing along the forecast. */
export function remainingForecastCorrection(
  offset: number,
  elapsed: number
): number {
  // Smoothstep has a maximum slope of 1.5. Taking at least three times the
  // offset keeps the corrected clock between half and 1.5 times real speed.
  const duration = Math.max(4000, Math.abs(offset) * 3);
  const progress = Math.max(0, Math.min(1, elapsed / duration));
  if (progress === 1 || offset === 0) {
    return 0;
  }
  return offset * (1 - progress * progress * (3 - 2 * progress));
}

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
  let bestIndex = 0;
  let bestFraction = 0;
  for (let index = 1; index < vehicle.frames.length; index += 1) {
    const from = vehicle.frames[index - 1];
    const to = vehicle.frames[index];
    // Repeated coordinates at loops must not hide a valid nearby-in-time match.
    const start = Math.max(from.at, now - MAX_CORRECTION_MS);
    const end = Math.min(to.at, now + MAX_CORRECTION_MS);
    if (start > end) {
      continue;
    }
    const east = (to.coordinates[0] - from.coordinates[0]) * longitudeScale;
    const north = (to.coordinates[1] - from.coordinates[1]) * METRES_PER_DEGREE;
    const lengthSquared = east * east + north * north;
    if (lengthSquared < 1) {
      const distance =
        ((position[0] - from.coordinates[0]) * longitudeScale) ** 2 +
        ((position[1] - from.coordinates[1]) * METRES_PER_DEGREE) ** 2;
      const at = Math.max(start, Math.min(end, now));
      if (
        distance < bestDistance ||
        (distance === bestDistance &&
          Math.abs(at - now) < Math.abs(bestTime - now))
      ) {
        bestDistance = distance;
        bestTime = at;
        bestIndex = -1;
      }
      continue;
    }
    const positionEast = (position[0] - from.coordinates[0]) * longitudeScale;
    const positionNorth =
      (position[1] - from.coordinates[1]) * METRES_PER_DEGREE;
    const fraction = Math.max(
      forecastTravelFraction(
        vehicle.frames,
        index - 1,
        (start - from.at) / (to.at - from.at)
      ),
      Math.min(
        forecastTravelFraction(
          vehicle.frames,
          index - 1,
          (end - from.at) / (to.at - from.at)
        ),
        (positionEast * east + positionNorth * north) / lengthSquared
      )
    );
    const distance =
      (positionEast - fraction * east) ** 2 +
      (positionNorth - fraction * north) ** 2;
    const at = from.at + (to.at - from.at) * fraction;
    if (
      distance < bestDistance ||
      (distance === bestDistance &&
        Math.abs(at - now) < Math.abs(bestTime - now))
    ) {
      bestDistance = distance;
      bestTime = at;
      bestIndex = index - 1;
      bestFraction = fraction;
    }
  }
  if (bestDistance > MAX_DISTANCE_M ** 2) {
    return 0;
  }
  if (bestIndex === -1) {
    return bestTime - now;
  }
  // Invert the monotone speed curve so a refresh starts at the projected
  // position even when the new forecast accelerates or decelerates there.
  let low = 0;
  let high = 1;
  for (let step = 0; step < 32; step += 1) {
    const middle = (low + high) / 2;
    if (
      forecastTravelFraction(vehicle.frames, bestIndex, middle) < bestFraction
    ) {
      low = middle;
    } else {
      high = middle;
    }
  }
  const from = vehicle.frames[bestIndex];
  const to = vehicle.frames[bestIndex + 1];
  const offset = from.at + (to.at - from.at) * ((low + high) / 2) - now;
  return Math.abs(offset) <= MAX_CORRECTION_MS ? offset : 0;
}
