import { expect, it } from "vite-plus/test";

import { tileZoomFor } from "@/map/tile-lod";

const QUALITIES = ["performance", "balanced", "quality"] as const;
const CAMERA_ZOOM = 14.2;
const VERTICAL_FOV = 36.86989764584402;

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
