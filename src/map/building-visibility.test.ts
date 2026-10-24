import { expect, it } from "vite-plus/test";

import { OPENFREEMAP_SOURCE, SOURCE_ID } from "@/map/sources";
import { buildStyle } from "@/map/theme/build-style";
import { getPalette } from "@/map/theme/palette";
import { tileZoomFor } from "@/map/tile-lod";

const QUALITIES = ["performance", "balanced", "quality"] as const;
const BUILDING_DATA_ZOOM = 13;
const CAMERA_ZOOM = 14.2;
const CAMERA_HEIGHT = 0.00034;
const CAMERA_PITCH = (70 * Math.PI) / 180;
const CENTER_DISTANCE = CAMERA_HEIGHT / Math.cos(CAMERA_PITCH);
const VERTICAL_FOV = 36.86989764584402;

it.each(QUALITIES)(
  "%s keeps building data available when pitched basemap tiles lose detail",
  (quality) => {
    const basemapZoom = tileZoomFor(quality);
    const buildingZoom = tileZoomFor(quality, BUILDING_DATA_ZOOM);

    for (const distance of [0.003, 0.01, 0.03]) {
      const args = [
        CAMERA_ZOOM,
        distance,
        CAMERA_HEIGHT,
        CENTER_DISTANCE,
        VERTICAL_FOV,
      ] as const;

      expect(basemapZoom(...args)).toBeLessThan(BUILDING_DATA_ZOOM);
      expect(buildingZoom(...args)).toBeGreaterThanOrEqual(BUILDING_DATA_ZOOM);
    }

    // Nearby tiles must still retain individual footprints and real heights.
    expect(
      buildingZoom(CAMERA_ZOOM, 0, CAMERA_HEIGHT, CENTER_DISTANCE, VERTICAL_FOV)
    ).toBeGreaterThanOrEqual(14);
  }
);

it.each(QUALITIES)(
  "%s avoids forcing city detail when the camera is zoomed out",
  (quality) => {
    const buildingZoom = tileZoomFor(quality, BUILDING_DATA_ZOOM);

    expect(
      buildingZoom(11, 0.01, CAMERA_HEIGHT, CENTER_DISTANCE, VERTICAL_FOV)
    ).toBe(11);
  }
);

it.each(QUALITIES)(
  "%s builds extrusion geometry for the coarsest building tiles",
  (quality) => {
    const style = buildStyle({
      palette: getPalette("daylight"),
      quality,
      showHousenumbers: true,
      showPois: true,
      showStreetNames: true,
      source: OPENFREEMAP_SOURCE,
      view: "perspective",
    });
    const layers = style.layers.filter(
      (layer) => layer.type === "fill-extrusion"
    );

    expect(layers.length).toBeGreaterThan(0);
    for (const layer of layers) {
      // MapLibre skips a layer in the tile worker below its minimum zoom.
      expect(layer.minzoom ?? 0).toBeLessThanOrEqual(BUILDING_DATA_ZOOM);
      expect(layer.source).not.toBe(SOURCE_ID);
      expect(style.sources[layer.source]).toMatchObject({
        maxzoom: 14,
        minzoom: BUILDING_DATA_ZOOM,
        type: "vector",
      });
    }
  }
);
