import type {
  ExpressionSpecification,
  LayerSpecification,
  StyleSpecification,
} from "maplibre-gl";

import {
  BUILDING_SOURCE_ID,
  MIN_BUILDING_TILE_ZOOM,
  SOURCE_ID,
} from "@/map/sources";
import type { TileSource } from "@/map/sources";

import type { Palette } from "./palette";

/**
 * Turns a palette into a complete MapLibre style over the OpenMapTiles schema.
 *
 * The layer list here is deliberately short. MapLibre does work per layer *per
 * tile* - building a bucket, uploading buffers, issuing a draw call - so a
 * style with a separate layer per road class costs several times what the same
 * picture costs when one layer paints every class through a `match` on its
 * attributes. Roads collapse from 24 layers to 3 that way, and landcover plus
 * landuse from 11 to 2, which is most of the difference between a map that
 * stutters while panning and one that does not.
 */

export type ViewMode = "perspective" | "flat";

export type QualityLevel = "performance" | "balanced" | "quality";

export interface BuildStyleOptions {
  palette: Palette;
  source: TileSource;
  view: ViewMode;
  quality: QualityLevel;
  /** Draw house numbers when zoomed right in. Costs a symbol layer. */
  showHousenumbers: boolean;
  /** Draw POI dots and names. */
  showPois: boolean;
  /** Draw street name labels. */
  showStreetNames: boolean;
}

const FONT_REGULAR = ["Noto Sans Regular"];
const FONT_BOLD = ["Noto Sans Bold"];

/** Height used for the z13 massing blobs, which carry no height attribute. */
const MASSING_HEIGHT = 12;

/** Names come out of the tiles in several locales; prefer German, then plain. */
const LABEL_FIELD: ExpressionSpecification = [
  "coalesce",
  ["get", "name:de"],
  ["get", "name"],
  ["get", "name:en"],
  "",
];

/** Exponential zoom ramp - the standard way to size roads so they feel stable. */
function zoomRamp(
  stops: [number, number][],
  base = 1.4
): ExpressionSpecification {
  const out: unknown[] = ["interpolate", ["exponential", base], ["zoom"]];
  for (const [z, v] of stops) {
    out.push(z, v);
  }
  return out as ExpressionSpecification;
}

// ---------------------------------------------------------------------------
// Roads
// ---------------------------------------------------------------------------

type RoadClass =
  | "motorway"
  | "trunk"
  | "primary"
  | "secondary"
  | "tertiary"
  | "minor"
  | "service"
  | "path"
  | "track";

/** OMT `class` values that map onto each of our buckets. */
const ROAD_CLASS_VALUES: Record<RoadClass, string[]> = {
  minor: ["minor"],
  motorway: ["motorway"],
  path: ["path", "pedestrian"],
  primary: ["primary"],
  secondary: ["secondary"],
  service: ["service"],
  tertiary: ["tertiary"],
  track: ["track"],
  trunk: ["trunk"],
};

const ROAD_ORDER: RoadClass[] = [
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "tertiary",
  "minor",
  "service",
  "path",
  "track",
];

/** Width curve per class as [zoom, px] control points. */
const ROAD_CURVE: Record<RoadClass, [number, number][]> = {
  minor: [
    [12, 0.3],
    [14, 1],
    [16, 3.4],
    [18, 9],
    [20, 18],
  ],
  motorway: [
    [5, 0.5],
    [10, 2],
    [13, 4],
    [16, 12],
    [20, 44],
  ],
  path: [
    [14, 0.4],
    [16, 1.2],
    [18, 2.6],
    [20, 6],
  ],
  primary: [
    [8, 0.4],
    [11, 1.2],
    [14, 3.2],
    [16, 9],
    [20, 32],
  ],
  secondary: [
    [10, 0.4],
    [12, 1],
    [14, 2.6],
    [16, 7],
    [20, 26],
  ],
  service: [
    [14, 0.3],
    [16, 1.6],
    [18, 5],
    [20, 12],
  ],
  tertiary: [
    [11, 0.4],
    [13, 1],
    [15, 2.4],
    [17, 7],
    [20, 22],
  ],
  track: [
    [14, 0.4],
    [16, 1.2],
    [18, 2.6],
    [20, 6],
  ],
  trunk: [
    [6, 0.4],
    [10, 1.6],
    [13, 3.4],
    [16, 10],
    [20, 36],
  ],
};

/** Shared zoom stops for the single combined width expression. */
const ROAD_STOPS = [5, 8, 10, 12, 13, 14, 15, 16, 18, 20];

/** Sample a class's curve at an arbitrary zoom; 0 before the curve starts. */
function widthAt(curve: [number, number][], zoom: number): number {
  const [first] = curve;
  const last = curve.at(-1) as [number, number];

  // Below its first control point a road simply is not drawn yet.
  if (zoom < first[0]) {
    return 0;
  }
  if (zoom >= last[0]) {
    return last[1];
  }

  for (let i = 0; i < curve.length - 1; i += 1) {
    const [z0, w0] = curve[i];
    const [z1, w1] = curve[i + 1];
    if (zoom >= z0 && zoom <= z1) {
      const t = z1 === z0 ? 0 : (zoom - z0) / (z1 - z0);
      return w0 + (w1 - w0) * t;
    }
  }
  return 0;
}

/**
 * One width expression covering every road class.
 *
 * `casing` widens each line by a constant so the outline pass can share the
 * same curve, and roads that are not drawn yet stay at exactly 0 so they cost
 * nothing.
 */
function roadWidth(casing: boolean): ExpressionSpecification {
  const out: unknown[] = ["interpolate", ["exponential", 1.4], ["zoom"]];

  for (const zoom of ROAD_STOPS) {
    const match: unknown[] = ["match", ["get", "class"]];

    for (const cls of ROAD_ORDER) {
      const w = widthAt(ROAD_CURVE[cls], zoom);
      const width = w > 0 && casing ? w + Math.max(0.6, w * 0.32) : w;
      match.push(ROAD_CLASS_VALUES[cls], width);
    }

    match.push(0);
    out.push(zoom, match);
  }

  return out as ExpressionSpecification;
}

function roadColor(p: Palette): ExpressionSpecification {
  return [
    "match",
    ["get", "class"],
    ["motorway"],
    p.motorway,
    ["trunk"],
    p.trunk,
    ["primary"],
    p.primary,
    ["secondary", "tertiary"],
    p.secondary,
    ["service"],
    p.service,
    ["path", "pedestrian", "track"],
    p.path,
    p.minor,
  ];
}

/** Everything we actually paint, so ferries and aerialways never get bucketed. */
const DRAWN_ROAD_CLASSES = ROAD_ORDER.flatMap((c) => ROAD_CLASS_VALUES[c]);

const isRoad: ExpressionSpecification = [
  "match",
  ["get", "class"],
  DRAWN_ROAD_CLASSES,
  true,
  false,
];

const isNotTunnel: ExpressionSpecification = [
  "!=",
  ["get", "brunnel"],
  "tunnel",
];

function roadLayers(palette: Palette): LayerSpecification[] {
  const fillWidth = roadWidth(false);
  const casingWidth = roadWidth(true);

  return [
    {
      // Tunnels draw exactly like surface roads: a separate dashed pass cost
      // one more layer over every tile to encode a detail nobody reads at
      // this fidelity.
      filter: isRoad,
      id: "road-casing",
      layout: { "line-cap": "round", "line-join": "round" },
      // Casings are invisible below ~1px road widths; skipping them for the
      // coarse horizon tiles removes half of all road geometry there.
      minzoom: 12,
      paint: {
        "line-color": palette.casing,
        "line-width": casingWidth,
      },
      source: SOURCE_ID,
      "source-layer": "transportation",
      type: "line",
    },
    {
      filter: isRoad,
      id: "road-fill",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": roadColor(palette),
        "line-width": fillWidth,
      },
      source: SOURCE_ID,
      "source-layer": "transportation",
      type: "line",
    },
    {
      filter: [
        "all",
        isNotTunnel,
        ["match", ["get", "class"], ["rail", "transit"], true, false],
      ],
      id: "rail",
      minzoom: 11,
      paint: {
        "line-color": palette.rail,
        "line-width": zoomRamp([
          [11, 0.6],
          [14, 1.6],
          [18, 5],
          [20, 9],
        ]),
      },
      source: SOURCE_ID,
      "source-layer": "transportation",
      type: "line",
    },
  ];
}

// ---------------------------------------------------------------------------
// Ground cover
// ---------------------------------------------------------------------------

function landcoverColor(p: Palette): ExpressionSpecification {
  return [
    "match",
    ["get", "class"],
    ["wood", "forest"],
    p.forest,
    ["grass", "farmland"],
    p.grass,
    ["wetland"],
    p.wetland,
    ["sand", "beach"],
    p.sand,
    p.grass,
  ];
}

function landuseColor(p: Palette): ExpressionSpecification {
  return [
    "match",
    ["get", "class"],
    ["residential", "suburb", "quarter", "neighbourhood"],
    p.residential,
    ["commercial", "retail"],
    p.commercial,
    ["industrial", "railway"],
    p.industrial,
    ["hospital"],
    p.hospital,
    ["school", "university", "kindergarten", "college"],
    p.school,
    ["cemetery", "grave_yard"],
    p.cemetery,
    ["pitch", "stadium", "playground", "track"],
    p.pitch,
    p.residential,
  ];
}

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------

/**
 * Roof colour as a function of height. Even in the restrained themes this
 * carries a lot of the readability: it is what makes a skyline look like a
 * skyline instead of a field of identical blocks.
 */
function buildingColor(palette: Palette): ExpressionSpecification {
  return [
    "interpolate",
    ["linear"],
    ["coalesce", ["get", "render_height"], MASSING_HEIGHT],
    0,
    palette.buildingLow,
    12,
    palette.buildingLow,
    30,
    palette.buildingMid,
    70,
    palette.buildingHigh,
    150,
    palette.buildingLandmark,
  ];
}

/** z13 massing blobs have no attributes, so they fall back to a flat height. */
const BUILDING_HEIGHT: ExpressionSpecification = [
  "coalesce",
  ["get", "render_height"],
  MASSING_HEIGHT,
];

const BUILDING_BASE: ExpressionSpecification = [
  "coalesce",
  ["get", "render_min_height"],
  0,
];

function buildingLayers(
  palette: Palette,
  view: ViewMode,
  quality: QualityLevel
): LayerSpecification[] {
  if (view === "flat") {
    return [
      {
        id: "building-flat",
        minzoom: 13,
        paint: {
          "fill-antialias": true,
          "fill-color": palette.buildingFlat,
        },
        source: BUILDING_SOURCE_ID,
        "source-layer": "building",
        type: "fill",
      },
      {
        id: "building-flat-outline",
        minzoom: 16,
        paint: {
          "line-color": palette.buildingHigh,
          "line-opacity": 0.7,
          "line-width": zoomRamp([
            [16, 0.2],
            [19, 1],
          ]),
        },
        source: BUILDING_SOURCE_ID,
        "source-layer": "building",
        type: "line",
      },
    ];
  }

  return [
    {
      id: "building-3d",
      type: "fill-extrusion",
      source: BUILDING_SOURCE_ID,
      "source-layer": "building",
      // Coarse tiles must build the bucket even when the basemap loses detail.
      minzoom: MIN_BUILDING_TILE_ZOOM,
      // `hide_3d` footprints are already covered by separate building parts.
      filter: ["!=", ["get", "hide_3d"], true],
      paint: {
        "fill-extrusion-color": buildingColor(palette),
        // Keep every paint attribute feature-only. Coarse blobs use the
        // fallback height; elevated parts keep their roof at or above the base.
        "fill-extrusion-height": ["max", BUILDING_HEIGHT, BUILDING_BASE],
        "fill-extrusion-base": BUILDING_BASE,
        // Even slight extrusion transparency requires a second complete draw.
        "fill-extrusion-opacity": 1,
        // The per-wall gradient is an extra shader branch on every fragment
        // of the most overdraw-heavy layer on the map; the height colour ramp
        // already separates walls from ground, so lower tiers skip it.
        "fill-extrusion-vertical-gradient": quality === "quality",
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

function labelLayers(
  palette: Palette,
  opts: BuildStyleOptions
): LayerSpecification[] {
  const layers: LayerSpecification[] = [];

  if (opts.showStreetNames) {
    layers.push({
      filter: [
        "match",
        ["get", "class"],
        ["motorway", "trunk", "primary", "secondary", "tertiary", "minor"],
        true,
        false,
      ],
      id: "label-road",
      layout: {
        "symbol-placement": "line",
        "symbol-spacing": 300,
        "text-field": LABEL_FIELD,
        "text-font": FONT_REGULAR,
        "text-max-angle": 30,
        "text-padding": 2,
        "text-size": zoomRamp([
          [14, 10],
          [18, 13],
        ]),
      },
      minzoom: 14,
      paint: {
        "text-color": palette.textSecondary,
        "text-halo-color": palette.textHalo,
        "text-halo-width": 1.2,
      },
      source: SOURCE_ID,
      "source-layer": "transportation_name",
      type: "symbol",
    });
  }

  layers.push({
    id: "label-water",
    layout: {
      "symbol-placement": "line",
      "text-field": LABEL_FIELD,
      "text-font": FONT_REGULAR,
      "text-letter-spacing": 0.15,
      "text-size": zoomRamp([
        [11, 10],
        [16, 14],
      ]),
    },
    minzoom: 11,
    paint: {
      "text-color": palette.textWater,
      "text-halo-color": palette.textHalo,
      "text-halo-width": 1,
    },
    source: SOURCE_ID,
    "source-layer": "water_name",
    type: "symbol",
  });

  if (opts.showPois) {
    layers.push(
      {
        filter: ["<=", ["coalesce", ["get", "rank"], 30], 24],
        id: "poi-dot",
        minzoom: 15,
        paint: {
          "circle-color": palette.poi,
          "circle-opacity": 0.85,
          "circle-radius": zoomRamp([
            [15, 1.6],
            [18, 3.2],
          ]),
        },
        source: SOURCE_ID,
        "source-layer": "poi",
        type: "circle",
      },
      {
        filter: ["<=", ["coalesce", ["get", "rank"], 30], 18],
        id: "label-poi",
        layout: {
          "text-anchor": "top",
          "text-field": LABEL_FIELD,
          "text-font": FONT_REGULAR,
          "text-max-width": 8,
          "text-offset": [0, 0.6],
          "text-optional": true,
          "text-size": zoomRamp([
            [16, 10],
            [19, 12],
          ]),
        },
        minzoom: 16,
        paint: {
          "text-color": palette.poi,
          "text-halo-color": palette.textHalo,
          "text-halo-width": 1.1,
        },
        source: SOURCE_ID,
        "source-layer": "poi",
        type: "symbol",
      }
    );
  }

  if (opts.showHousenumbers) {
    layers.push({
      id: "label-housenumber",
      layout: {
        "text-field": ["get", "housenumber"],
        "text-font": FONT_REGULAR,
        "text-optional": true,
        "text-padding": 1,
        "text-size": zoomRamp([
          [17.5, 9],
          [20, 11],
        ]),
      },
      minzoom: 17.5,
      paint: {
        "text-color": palette.textSecondary,
        "text-halo-color": palette.textHalo,
        "text-halo-width": 1,
        "text-opacity": 0.8,
      },
      source: SOURCE_ID,
      "source-layer": "housenumber",
      type: "symbol",
    });
  }

  layers.push(
    {
      filter: [
        "match",
        ["get", "class"],
        ["neighbourhood", "quarter", "hamlet"],
        true,
        false,
      ],
      id: "label-neighbourhood",
      layout: {
        "text-field": LABEL_FIELD,
        "text-font": FONT_REGULAR,
        "text-letter-spacing": 0.08,
        "text-max-width": 8,
        "text-size": zoomRamp([
          [12.5, 10],
          [16, 13],
        ]),
        "text-transform": "uppercase",
      },
      maxzoom: 16.5,
      minzoom: 12.5,
      paint: {
        "text-color": palette.textSecondary,
        "text-halo-color": palette.textHalo,
        "text-halo-width": 1.2,
      },
      source: SOURCE_ID,
      "source-layer": "place",
      type: "symbol",
    },
    {
      filter: ["==", ["get", "class"], "suburb"],
      id: "label-suburb",
      layout: {
        "text-field": LABEL_FIELD,
        "text-font": FONT_BOLD,
        "text-letter-spacing": 0.05,
        "text-max-width": 8,
        "text-size": zoomRamp([
          [10.5, 11],
          [14, 15],
        ]),
      },
      maxzoom: 15,
      minzoom: 10.5,
      paint: {
        "text-color": palette.textPrimary,
        "text-halo-color": palette.textHalo,
        "text-halo-width": 1.4,
      },
      source: SOURCE_ID,
      "source-layer": "place",
      type: "symbol",
    },
    {
      filter: [
        "match",
        ["get", "class"],
        ["city", "town", "village"],
        true,
        false,
      ],
      id: "label-city",
      layout: {
        "text-field": LABEL_FIELD,
        "text-font": FONT_BOLD,
        "text-max-width": 8,
        "text-size": zoomRamp([
          [4, 11],
          [10, 18],
        ]),
      },
      maxzoom: 12,
      paint: {
        "text-color": palette.textPrimary,
        "text-halo-color": palette.textHalo,
        "text-halo-width": 1.6,
      },
      source: SOURCE_ID,
      "source-layer": "place",
      type: "symbol",
    }
  );

  return layers;
}

// ---------------------------------------------------------------------------

export function buildStyle(opts: BuildStyleOptions): StyleSpecification {
  const { palette, source, view, quality } = opts;

  const layers: LayerSpecification[] = [
    // OpenMapTiles has no land polygon at city zooms - the ground *is* the
    // background, with water and green space painted over it.
    {
      id: "background",
      paint: { "background-color": palette.earth },
      type: "background",
    },
    {
      id: "landcover",
      paint: {
        "fill-color": landcoverColor(palette),
        // Ground cover sits under everything; edge quality is invisible here
        // and antialiasing every polygon boundary is not free.
        "fill-antialias": false,
        "fill-opacity": zoomRamp([
          [6, 0],
          [8, 1],
        ]),
      },
      source: SOURCE_ID,
      "source-layer": "landcover",
      type: "fill",
    },
    {
      id: "landuse",
      minzoom: 9,
      paint: {
        "fill-antialias": false,
        "fill-color": landuseColor(palette),
      },
      source: SOURCE_ID,
      "source-layer": "landuse",
      type: "fill",
    },
    {
      id: "park",
      minzoom: 8,
      paint: {
        "fill-antialias": false,
        "fill-color": palette.park,
        "fill-opacity": 0.85,
      },
      source: SOURCE_ID,
      "source-layer": "park",
      type: "fill",
    },
    {
      filter: ["!=", ["get", "brunnel"], "tunnel"],
      id: "water",
      paint: {
        "fill-antialias": true,
        "fill-color": [
          "match",
          ["get", "class"],
          ["ocean", "lake"],
          palette.waterDeep,
          palette.water,
        ],
      },
      source: SOURCE_ID,
      "source-layer": "water",
      type: "fill",
    },
    {
      filter: ["!=", ["get", "brunnel"], "tunnel"],
      id: "waterway",
      layout: { "line-cap": "round", "line-join": "round" },
      minzoom: 8,
      paint: {
        "line-color": palette.waterway,
        "line-width": zoomRamp([
          [8, 0.6],
          [12, 1.6],
          [16, 6],
          [20, 22],
        ]),
      },
      source: SOURCE_ID,
      "source-layer": "waterway",
      type: "line",
    },
    {
      id: "aeroway",
      minzoom: 11,
      paint: {
        "line-color": palette.aerodrome,
        "line-width": zoomRamp([
          [11, 1],
          [16, 14],
          [20, 60],
        ]),
      },
      source: SOURCE_ID,
      "source-layer": "aeroway",
      type: "line",
    },
    ...roadLayers(palette),
    {
      filter: ["<=", ["get", "admin_level"], 8],
      id: "boundary",
      paint: {
        "line-color": palette.boundary,
        "line-dasharray": [3, 2],
        "line-opacity": 0.6,
        "line-width": zoomRamp([
          [4, 0.5],
          [10, 1.4],
          [16, 2.4],
        ]),
      },
      source: SOURCE_ID,
      "source-layer": "boundary",
      type: "line",
    },
    ...buildingLayers(palette, view, quality),
    ...labelLayers(palette, opts),
  ];

  const style: StyleSpecification = {
    version: 8,
    name: `Berlin — ${palette.label}`,
    glyphs: "/fonts/{fontstack}/{range}.pbf",
    sources: {
      [SOURCE_ID]: source.spec,
      // Only building layers use this source, preserving their tile detail
      // without increasing the cost of every road, land and label layer.
      [BUILDING_SOURCE_ID]: {
        ...source.spec,
        minzoom: MIN_BUILDING_TILE_ZOOM,
      },
    },
    // Directional light drives the extrusion shading; a low intensity keeps
    // the walls readable without washing out the roof colours.
    light: {
      anchor: "viewport",
      color: palette.lightColor,
      intensity: palette.lightIntensity,
      position: [1.4, 210, 30],
    },
    layers,
  };

  if (view === "perspective") {
    style.sky = {
      // The atmosphere haze is a full-viewport blended pass; the fog and sky
      // gradient alone already soften the horizon, so the blend stays off.
      "atmosphere-blend": 0,
      "fog-color": palette.skyHorizon,
      "fog-ground-blend": 0.02,
      "horizon-color": palette.skyHorizon,
      "horizon-fog-blend": 0.6,
      "sky-color": palette.skyTop,
      "sky-horizon-blend": 0.6,
    };
    style.projection = { type: "mercator" };
  }

  return style;
}

/**
 * Drawing-buffer resolution cap per quality tier, as a function so `quality`
 * can read the display's real density at map-creation time.
 *
 * A pitched 3D city is fragment-bound: cost scales with the square of the
 * rendered pixel count, so rendering "balanced" at 1.5x instead of a retina
 * 3x saves over half of every shaded pixel while staying crisp on laptops.
 */
export const PIXEL_RATIO_BY_QUALITY: Record<QualityLevel, () => number> = {
  balanced: () => Math.min(window.devicePixelRatio || 1, 1.5),
  performance: () => 1,
  quality: () => window.devicePixelRatio || 1,
};
