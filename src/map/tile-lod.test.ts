import { afterEach, expect, it, vi } from "vite-plus/test";

import {
  createCalculateTileZoom,
  LOD_BY_QUALITY,
  tileZoomFor,
} from "@/map/tile-lod";
import type { CalculateTileZoom } from "@/map/tile-lod";

const QUALITIES = ["performance", "balanced", "quality"] as const;
const VERTICAL_FOV = 36.86989764584402;
const radians = (degrees: number) => (degrees * Math.PI) / 180;

afterEach(() => {
  vi.restoreAllMocks();
});

// The uncached MapLibre equation is the reference for numerical equivalence.
// Keep its operation order: even a tiny zoom change can change tile selection.
function referenceZoom(
  detail: number,
  ratio: number,
  [zoom, distance, height, centerDistance, fov]: Parameters<CalculateTileZoom>
): number {
  const behavior =
    2 *
    ((detail - 1) /
      Math.log2(Math.cos(radians(89.25 - fov)) / Math.cos(radians(89.25))) -
      1);
  const integrate = (from: number, to: number) => {
    const dx = (to - from) / 10;
    let sum = 0;
    for (let index = 0; index < 10; index += 1) {
      const x = from + ((index + 0.5) / 10) * (to - from);
      sum += dx * Math.cos(x) ** (behavior - 1);
    }
    return sum;
  };
  const centerPitch = Math.acos(height / centerDistance);
  const baselineCount = 2 * integrate(0, radians(fov / 2));
  const highestPitch = Math.min(radians(89.25), centerPitch + radians(fov / 2));
  const lowestPitch = Math.min(highestPitch, centerPitch - radians(fov / 2));
  const tileCount = integrate(lowestPitch, highestPitch);
  let result = zoom;
  result += Math.log2(
    centerDistance /
      Math.hypot(distance, height) /
      Math.max(0.5, Math.cos(radians(fov / 2)))
  );
  result += (behavior * Math.log2(Math.cos(Math.atan(distance / height)))) / 2;
  result -= Math.log2(Math.max(1, tileCount / baselineCount / ratio)) / 2;
  return result;
}

it.each(QUALITIES)(
  "%s preserves the equation across tile batches, camera changes and invalid inputs",
  (quality) => {
    const rawZoom = createCalculateTileZoom(LOD_BY_QUALITY[quality], 4.5);
    const buildingZoom = tileZoomFor(quality, 13);
    const cameras = [
      [0.00034, 0, VERTICAL_FOV],
      [0.00034, 60, VERTICAL_FOV],
      [0.00034, 66, VERTICAL_FOV],
      [0.00034, 78, VERTICAL_FOV],
      [0.00034, 89.9, 20],
      [0.0006, 78, 65],
      [0.00034, 78, VERTICAL_FOV],
      [0.00034, 78, Number.NaN],
      [0.00034, Number.NaN, VERTICAL_FOV],
      [0.00034, 78, VERTICAL_FOV],
    ];

    for (const [height, pitch, fov] of cameras) {
      const centerDistance = height / Math.cos(radians(pitch));
      for (const distance of [0, 0.0001, 0.003, 0.03, 1]) {
        const args: Parameters<CalculateTileZoom> = [
          14.2,
          distance,
          height,
          centerDistance,
          fov,
        ];
        const expected = referenceZoom(LOD_BY_QUALITY[quality], 4.5, args);
        expect(rawZoom(...args)).toBe(expected);

        const cameraPitch =
          Math.acos(Math.min(1, height / centerDistance)) * (180 / Math.PI);
        const start = Math.min(60, Math.max(0, 78.5 - fov / 2));
        const progress = Math.max(0, Math.min(1, (cameraPitch - start) / 12));
        const blend = progress * progress * (3 - 2 * progress);
        expect(buildingZoom(...args)).toBe(
          Math.max(14.2 + (expected - 14.2) * blend, 13)
        );
      }
    }

    for (const args of [
      [14, 0, 0, 0, VERTICAL_FOV],
      [14, 0, -0, -0, VERTICAL_FOV],
      [14, 1, 1, Number.POSITIVE_INFINITY, VERTICAL_FOV],
      [14, 1, 1, 2, Number.POSITIVE_INFINITY],
      [14, 1, 1, 2, VERTICAL_FOV],
    ] satisfies Parameters<CalculateTileZoom>[]) {
      expect(rawZoom(...args)).toBe(
        referenceZoom(LOD_BY_QUALITY[quality], 4.5, args)
      );
    }
  }
);

it("reuses camera integrals for every other candidate tile", () => {
  const calculateZoom = createCalculateTileZoom(12);
  const cos = vi.spyOn(Math, "cos");
  const acos = vi.spyOn(Math, "acos");

  calculateZoom(14, 1, 1, 4, VERTICAL_FOV);
  expect(cos.mock.calls.length).toBeGreaterThan(20);
  cos.mockClear();
  acos.mockClear();

  calculateZoom(15, 2, 1, 4, VERTICAL_FOV);
  expect(cos).toHaveBeenCalledTimes(1);
  expect(acos).not.toHaveBeenCalled();

  cos.mockClear();
  calculateZoom(15, 2, 1, 5, VERTICAL_FOV);
  expect(cos).toHaveBeenCalledTimes(11);
  expect(acos).toHaveBeenCalledTimes(1);
});

const CAMERA_ZOOM = 14.2;

it.each(QUALITIES)(
  "%s eases into variable tile detail at the pitch cutoff",
  (quality) => {
    const calculateZoom = tileZoomFor(quality);

    for (const degrees of [55, 60, 60.01]) {
      const pitch = (degrees * Math.PI) / 180;
      const zoom = calculateZoom(
        CAMERA_ZOOM,
        Math.tan(pitch),
        1,
        1 / Math.cos(pitch),
        VERTICAL_FOV
      );

      expect(zoom).toBeCloseTo(CAMERA_ZOOM, 3);
    }
  }
);

it.each(QUALITIES)(
  "%s retains more detail nearby and coarsens gradually with distance",
  (quality) => {
    const calculateZoom = tileZoomFor(quality);
    const pitch = (78 * Math.PI) / 180;
    const centerDistance = 1 / Math.cos(pitch);
    const nearDistance = Math.tan(pitch);
    const nearZoom = calculateZoom(
      CAMERA_ZOOM,
      nearDistance,
      1,
      centerDistance,
      VERTICAL_FOV
    );
    const fartherZoom = calculateZoom(
      CAMERA_ZOOM,
      nearDistance * 1.1,
      1,
      centerDistance,
      VERTICAL_FOV
    );

    expect(fartherZoom).toBeLessThan(nearZoom);
    expect(nearZoom - fartherZoom).toBeLessThan(0.5);
  }
);
