import type { QualityLevel } from "@/map/theme/build-style";

/**
 * Level of detail for tiles at high pitch.
 *
 * A pitched camera sees an enormous amount of ground, and MapLibre has to pick
 * a zoom level for every tile in that wedge. Its default keeps distant tiles
 * fairly detailed, which looks lovely and is the single largest cost in a 3D
 * view: measured here, dropping *all* buildings only bought ~3fps, while
 * halving the tile count bought far more. Tile count dominates because every
 * layer pays for every tile.
 *
 * This is a port of MapLibre's own `createCalculateTileZoomFunction` with the
 * tuning constant exposed. The formula is reproduced rather than imported
 * because MapLibre keeps it internal; keeping the shape identical means the
 * behaviour stays sane at the extremes (near-horizontal frustums), and only the
 * detail falloff changes.
 *
 * `maxZoomLevelsOnScreen` is the knob: higher means fewer, coarser tiles
 * towards the horizon. MapLibre's default is 9.314.
 */

const MAX_MERCATOR_HORIZON_ANGLE = 89.25;

/** Match MapLibre's variable-zoom cutoff, then ease into its LOD over 12°. */
const MAX_CONSTANT_ZOOM_PITCH = 60;
const VARIABLE_ZOOM_PITCH_OFFSET = 78.5;
const LOD_TRANSITION_DEGREES = 12;

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** MapLibre's `scaleZoom`: how many zoom levels a scale factor corresponds to. */
const scaleZoom = (scale: number) => Math.log2(scale);

/** Numeric integral of cos(x)^p over [x1, x2], matching MapLibre's sampling. */
function integralOfCosXByP(p: number, x1: number, x2: number): number {
  const numPoints = 10;
  const dx = (x2 - x1) / numPoints;
  let sum = 0;
  for (let i = 0; i < numPoints; i += 1) {
    const x = x1 + ((i + 0.5) / numPoints) * (x2 - x1);
    sum += dx * Math.cos(x) ** p;
  }
  return sum;
}

export type CalculateTileZoom = (
  requestedCenterZoom: number,
  distanceToTile2D: number,
  distanceToTileZ: number,
  distanceToCenter3D: number,
  cameraVerticalFOV: number
) => number;

export function createCalculateTileZoom(
  maxZoomLevelsOnScreen: number,
  tileCountMaxMinRatio = 3
): CalculateTileZoom {
  return (
    requestedCenterZoom,
    distanceToTile2D,
    distanceToTileZ,
    distanceToCenter3D,
    cameraVerticalFOV
  ) => {
    const pitchTileLoadingBehavior =
      2 *
      ((maxZoomLevelsOnScreen - 1) /
        scaleZoom(
          Math.cos(toRad(MAX_MERCATOR_HORIZON_ANGLE - cameraVerticalFOV)) /
            Math.cos(toRad(MAX_MERCATOR_HORIZON_ANGLE))
        ) -
        1);

    const centerPitch = Math.acos(distanceToTileZ / distanceToCenter3D);
    const tileCountPitch0 =
      2 *
      integralOfCosXByP(
        pitchTileLoadingBehavior - 1,
        0,
        toRad(cameraVerticalFOV / 2)
      );

    const highestPitch = Math.min(
      toRad(MAX_MERCATOR_HORIZON_ANGLE),
      centerPitch + toRad(cameraVerticalFOV / 2)
    );
    const lowestPitch = Math.min(
      highestPitch,
      centerPitch - toRad(cameraVerticalFOV / 2)
    );
    const tileCount = integralOfCosXByP(
      pitchTileLoadingBehavior - 1,
      lowestPitch,
      highestPitch
    );

    const thisTilePitch = Math.atan(distanceToTile2D / distanceToTileZ);
    const distanceToTile3D = Math.hypot(distanceToTile2D, distanceToTileZ);

    let z = requestedCenterZoom;
    z += scaleZoom(
      distanceToCenter3D /
        distanceToTile3D /
        Math.max(0.5, Math.cos(toRad(cameraVerticalFOV / 2)))
    );
    z += (pitchTileLoadingBehavior * scaleZoom(Math.cos(thisTilePitch))) / 2;
    z -=
      scaleZoom(
        Math.max(1, tileCount / tileCountPitch0 / tileCountMaxMinRatio)
      ) / 2;

    return z;
  };
}

/**
 * Per-quality detail falloff, coarser than MapLibre's default (9.314) but tuned
 * for stability: past a point, aggressive values make the ideal tile set swing
 * wildly with every degree of rotation, which both pops tiles and thrashes the
 * cache (the microstutter source). Buildings have a separate source whose
 * minimum tile detail preserves their geometry along the horizon.
 */
export const LOD_BY_QUALITY: Record<QualityLevel, number> = {
  balanced: 12,
  performance: 14,
  quality: 10,
};

export function tileZoomFor(
  quality: QualityLevel,
  minimumTileZoom = 0
): CalculateTileZoom {
  // A ratio above MapLibre's default 3 softens the falloff: the horizon loses
  // detail in smaller steps, which reads as gradual decay instead of visible
  // rings where whole tiles change level at once.
  const calculateZoom = createCalculateTileZoom(LOD_BY_QUALITY[quality], 4.5);

  return (...zoomArgs) => {
    const [requestedCenterZoom, , height, centerDistance, verticalFov] =
      zoomArgs;
    const pitch =
      Math.acos(Math.min(1, height / centerDistance)) * (180 / Math.PI);
    const startPitch = Math.min(
      MAX_CONSTANT_ZOOM_PITCH,
      Math.max(0, VARIABLE_ZOOM_PITCH_OFFSET - verticalFov / 2)
    );
    const progress = Math.max(
      0,
      Math.min(1, (pitch - startPitch) / LOD_TRANSITION_DEGREES)
    );
    const blend = progress * progress * (3 - 2 * progress);
    // MapLibre switches from uniform to variable tile zoom at about 60°.
    // Applying the full falloff immediately replaces whole regions at once.
    const desiredZoom =
      requestedCenterZoom +
      (calculateZoom(...zoomArgs) - requestedCenterZoom) * blend;

    // Coarse OpenMapTiles tiles contain no buildings. Keep their source above
    // that cutoff, without forcing city detail into zoomed-out views.
    return Math.max(
      desiredZoom,
      Math.min(minimumTileZoom, requestedCenterZoom)
    );
  };
}
