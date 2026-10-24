import {
  createPropertyExpression,
  featureFilter,
  latest,
  validateStyleMin,
} from "@maplibre/maplibre-gl-style-spec";
import type {
  Feature,
  StylePropertyExpression,
  StylePropertySpecification,
} from "@maplibre/maplibre-gl-style-spec";
import type { FillExtrusionLayerSpecification } from "maplibre-gl";
import { expect, it } from "vite-plus/test";

import { OPENFREEMAP_SOURCE, SOURCE_ID } from "@/map/sources";
import { buildStyle } from "@/map/theme/build-style";
import type { QualityLevel } from "@/map/theme/build-style";
import { getPalette, PALETTE_ORDER } from "@/map/theme/palette";
import type { PaletteId } from "@/map/theme/palette";
import { tileZoomFor } from "@/map/tile-lod";

const QUALITIES = ["performance", "balanced", "quality"] as const;
const BUILDING_DATA_ZOOM = 13;
const CAMERA_ZOOM = 14.2;
const CAMERA_HEIGHT = 0.00034;
const CAMERA_PITCH = (70 * Math.PI) / 180;
const CENTER_DISTANCE = CAMERA_HEIGHT / Math.cos(CAMERA_PITCH);
const VERTICAL_FOV = 36.86989764584402;

function perspectiveStyle(
  quality: QualityLevel,
  paletteId: PaletteId = "daylight"
) {
  return buildStyle({
    palette: getPalette(paletteId),
    quality,
    showHousenumbers: true,
    showPois: true,
    showStreetNames: true,
    source: OPENFREEMAP_SOURCE,
    view: "perspective",
  });
}

function extrusionLayer(
  quality: QualityLevel,
  paletteId: PaletteId = "daylight"
): FillExtrusionLayerSpecification {
  const layer = perspectiveStyle(quality, paletteId).layers.find(
    (candidate) => candidate.id === "building-3d"
  );
  if (layer?.type !== "fill-extrusion") {
    throw new Error(
      "The perspective style must include building-3d extrusions"
    );
  }
  return layer;
}

type BuildingProperty =
  | "fill-extrusion-height"
  | "fill-extrusion-base"
  | "fill-extrusion-color";

function buildingExpression(
  layer: FillExtrusionLayerSpecification,
  property: BuildingProperty
) {
  const expression = createPropertyExpression(
    layer.paint?.[property],
    `building-3d.paint.${property}`,
    // The reference JSON widens literal strings in its generated typings.
    latest["paint_fill-extrusion"][property] as StylePropertySpecification
  );
  if (expression.result === "error") {
    throw new Error(
      `Invalid building expression: ${JSON.stringify(expression.value)}`
    );
  }
  return expression.value;
}

function numericBuildingValue(
  expression: StylePropertyExpression,
  zoom: number,
  feature: Feature
): number {
  const value: unknown = expression.evaluate({ zoom }, feature);
  if (typeof value !== "number") {
    throw new TypeError("Building heights and bases must evaluate to numbers");
  }
  return value;
}

function buildingFeature(
  properties: Record<string, number | boolean> = {}
): Feature {
  return { type: "Polygon", properties };
}

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
  "%s keeps one extrusion layer and its existing source coverage",
  (quality) => {
    const style = perspectiveStyle(quality);
    const layers = style.layers.filter(
      (layer) => layer.type === "fill-extrusion"
    );

    expect(layers).toHaveLength(1);
    expect(layers[0].id).toBe("building-3d");
    for (const layer of layers) {
      // MapLibre skips a layer in the tile worker below its minimum zoom.
      expect(layer.minzoom).toBe(BUILDING_DATA_ZOOM);
      expect(layer.source).not.toBe(SOURCE_ID);
      expect(style.sources[layer.source]).toMatchObject({
        maxzoom: 14,
        minzoom: BUILDING_DATA_ZOOM,
        type: "vector",
      });
    }
  }
);

it.each(QUALITIES)(
  "%s produces valid opaque styles with feature-only building attributes",
  (quality) => {
    for (const paletteId of PALETTE_ORDER) {
      const style = perspectiveStyle(quality, paletteId);
      expect(validateStyleMin(style).map((error) => error.message)).toEqual([]);
      const layer = extrusionLayer(quality, paletteId);
      expect(layer.paint?.["fill-extrusion-opacity"]).toBe(1);
      for (const property of [
        "fill-extrusion-height",
        "fill-extrusion-base",
        "fill-extrusion-color",
      ] as const) {
        expect(buildingExpression(layer, property).kind).toBe("source");
      }
    }
  }
);

it.each(QUALITIES)(
  "%s preserves coarse fallback heights and actual detailed building heights",
  (quality) => {
    const expression = buildingExpression(
      extrusionLayer(quality),
      "fill-extrusion-height"
    );
    // Coarse z13 union polygons have no height attributes.
    expect(numericBuildingValue(expression, 13, buildingFeature())).toBe(12);
    for (const height of [0, 5, 60]) {
      const feature = buildingFeature({ render_height: height });
      expect(numericBuildingValue(expression, 14, feature)).toBe(height);
    }
  }
);

it.each(QUALITIES)(
  "%s keeps elevated roofs at or above their unchanged bases",
  (quality) => {
    const layer = extrusionLayer(quality);
    const roof = buildingExpression(layer, "fill-extrusion-height");
    const base = buildingExpression(layer, "fill-extrusion-base");
    for (const [feature, expectedRoof] of [
      [buildingFeature({ render_height: 60, render_min_height: 35 }), 60],
      [buildingFeature({ render_height: 20, render_min_height: 35 }), 35],
      [buildingFeature({ render_min_height: 35 }), 35],
    ] as const) {
      const roofHeight = numericBuildingValue(roof, 14, feature);
      const baseHeight = numericBuildingValue(base, 14, feature);
      expect(baseHeight).toBe(35);
      expect(roofHeight).toBe(expectedRoof);
      expect(roofHeight).toBeGreaterThanOrEqual(baseHeight);
    }
  }
);

it.each(QUALITIES)(
  "%s filters footprints covered by separate 3D building parts",
  (quality) => {
    const layer = extrusionLayer(quality);
    const { filter } = featureFilter(layer.filter, "building-3d.filter");
    expect(filter({ zoom: 14 }, buildingFeature({ hide_3d: true }))).toBe(
      false
    );
    expect(filter({ zoom: 14 }, buildingFeature({ hide_3d: false }))).toBe(
      true
    );
    expect(filter({ zoom: 14 }, buildingFeature())).toBe(true);
  }
);
