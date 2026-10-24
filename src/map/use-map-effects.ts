import * as maplibregl from "maplibre-gl";
import type { MapGeoJSONFeature, Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";

import { BERLIN_MAX_BOUNDS, DEFAULT_CAMERA } from "@/lib/geo";
import type { LngLat } from "@/lib/geo";
import { exposeMapForDebugging } from "@/map/debug";
import { DRAG_ROTATE_OPTIONS } from "@/map/navigation";
import {
  BUILDING_SOURCE_ID,
  MIN_BUILDING_TILE_ZOOM,
  OPENFREEMAP_SOURCE,
  SOURCE_ID,
  detectTileSource,
  registerPmtilesProtocol,
} from "@/map/sources";
import type { TileSource } from "@/map/sources";
import { decodeCameraHash, encodeCameraHash, useMapStore } from "@/map/store";
import type { Selection } from "@/map/store";
import { buildStyle, PIXEL_RATIO_BY_QUALITY } from "@/map/theme/build-style";
import type { QualityLevel, ViewMode } from "@/map/theme/build-style";
import { getPalette } from "@/map/theme/palette";
import { tileZoomFor } from "@/map/tile-lod";

/**
 * The imperative half of the map, split out of the component so each concern -
 * creation, restyling, camera sync, counters, interaction - is readable on its
 * own instead of as one very long effect list.
 */

type MapRef = RefObject<MapLibreMap | null>;

/** Properties worth surfacing in the inspector, in the order we want them. */
const INSPECTOR_KEYS = [
  "class",
  "subclass",
  "colour",
  "brunnel",
  "network",
  "ref",
  "surface",
  "oneway",
] as const;

/** Source layers whose features are worth opening the inspector for. */
const INSPECTABLE_LAYERS = new Set([
  "building",
  "poi",
  "place",
  "transportation_name",
  "park",
  "water",
]);

export function readSelection(
  feature: MapGeoJSONFeature,
  center: LngLat
): Selection {
  const p = feature.properties ?? {};
  const details: [string, string][] = [];

  for (const key of INSPECTOR_KEYS) {
    const value = p[key];
    if (value !== undefined && value !== null && value !== "") {
      details.push([key, String(value)]);
    }
  }

  const height =
    typeof p.render_height === "number" ? p.render_height : undefined;

  return {
    center,
    details,
    featureId: feature.id,
    height,
    housenumber: p.housenumber as string | undefined,
    kind: feature.sourceLayer === "building" ? "building" : "place",
    levels: height ? Math.max(1, Math.round(height / 3.2)) : undefined,
    name:
      (p["name:de"] as string) ??
      (p.name as string) ??
      (p.housenumber as string),
    street: p.street as string | undefined,
  };
}

/** Resolves the local extract if it has been built, else the hosted planet. */
export function useTileSource(): TileSource | null {
  const [source, setSource] = useState<TileSource | null>(null);
  const setTileSource = useMapStore((s) => s.setTileSource);

  useEffect(() => {
    registerPmtilesProtocol();
    const ctrl = new AbortController();

    const resolve = async () => {
      try {
        const found = await detectTileSource(ctrl.signal);
        setSource(found);
        setTileSource(found.kind);
      } catch {
        setSource(OPENFREEMAP_SOURCE);
        setTileSource(OPENFREEMAP_SOURCE.kind);
      }
    };

    void resolve();
    return () => ctrl.abort();
  }, [setTileSource]);

  return source;
}

/** Rebuilds the style only when something it actually depends on changes. */
export function useMapStyle(source: TileSource | null) {
  const palette = useMapStore((s) => s.palette);
  const view = useMapStore((s) => s.view);
  const quality = useMapStore((s) => s.quality);
  const showHousenumbers = useMapStore((s) => s.showHousenumbers);
  const showPois = useMapStore((s) => s.showPois);
  const showStreetNames = useMapStore((s) => s.showStreetNames);

  const paletteSpec = getPalette(palette);

  return useMemo(() => {
    if (!source) {
      return null;
    }
    return buildStyle({
      palette: paletteSpec,
      quality,
      showHousenumbers,
      showPois,
      showStreetNames,
      source,
      view,
    });
  }, [
    source,
    paletteSpec,
    view,
    quality,
    showHousenumbers,
    showPois,
    showStreetNames,
  ]);
}

type Style = NonNullable<ReturnType<typeof useMapStyle>>;

/**
 * Creates the map. Recreated when `quality` changes, because antialiasing is
 * fixed at WebGL context creation time; the camera survives via the URL hash.
 */
export function useMapInstance(args: {
  containerRef: RefObject<HTMLDivElement | null>;
  mapRef: RefObject<MapLibreMap | null>;
  appliedStyleRef: RefObject<Style | null>;
  style: Style | null;
  source: TileSource | null;
  quality: QualityLevel;
}): { map: MapLibreMap | null; ready: boolean } {
  const { containerRef, mapRef, appliedStyleRef, style, source, quality } =
    args;
  const [ready, setReady] = useState(false);
  const [instance, setInstance] = useState<MapLibreMap | null>(null);

  // The map is constructed with whatever style is current, but a later style
  // change must not tear the map down - that is what `useRestyle` is for.
  // The latest-ref pattern. The map is built from whichever style is current
  // at creation time; a later style change must go through `setStyle` rather
  // than tearing the map down and rebuilding it, so the style deliberately is
  // not a dependency of the creation effect below.
  const styleRef = useRef(style);
  // oxlint-disable-next-line react/refs
  styleRef.current = style;

  useEffect(() => {
    const container = containerRef.current;
    const initialStyle = styleRef.current;
    if (!(container && initialStyle)) {
      return;
    }

    const fromHash =
      typeof window === "undefined"
        ? null
        : decodeCameraHash(window.location.hash);
    const start = fromHash ?? {
      ...DEFAULT_CAMERA,
      center: [...DEFAULT_CAMERA.center] as LngLat,
    };
    const initialView = useMapStore.getState().view;

    const map = new maplibregl.Map({
      container,
      style: initialStyle,
      center: start.center,
      zoom: start.zoom,
      pitch: initialView === "flat" ? 0 : start.pitch,
      bearing: initialView === "flat" ? 0 : start.bearing,
      dragRotate: DRAG_ROTATE_OPTIONS,
      maxBounds: [
        [BERLIN_MAX_BOUNDS[0], BERLIN_MAX_BOUNDS[1]],
        [BERLIN_MAX_BOUNDS[2], BERLIN_MAX_BOUNDS[3]],
      ],
      // The extract stops at Berlin's edge, so zooming out past the point where
      // the city fills the screen just frames it as a small island in an empty
      // plane. 11 is roughly where Berlin spans a desktop viewport.
      minZoom: 11,
      maxZoom: 20,
      maxPitch: initialView === "flat" ? 0 : 78,
      attributionControl: false,
      // Cross-fading symbols repaint the whole label plane on every zoom
      // step; a hard cut is free and reads fine at map speeds.
      fadeDuration: 0,
      refreshExpiredTiles: false,
      // Generous for every preset. A small cache is not a performance setting:
      // measured, trimming it to 200 tiles made the *fastest* preset the
      // slowest, because rotating the camera kept evicting tiles that were
      // about to be needed again and every one of them had to be re-parsed.
      maxTileCacheSize: 800,
      canvasContextAttributes: {
        antialias: quality === "quality",
        powerPreference: "high-performance",
        preserveDrawingBuffer: false,
      },
    });

    // Fragment cost scales with the square of the resolution, and a 3D city
    // is fragment-bound. Capping the drawing buffer per quality tier buys far
    // more than any geometry tweak; `quality` keeps the display's native
    // density. Safe to call once here - a quality change rebuilds the map.
    map.setPixelRatio(PIXEL_RATIO_BY_QUALITY[quality]());

    appliedStyleRef.current = initialStyle;
    mapRef.current = map;
    setInstance(map);

    map.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      "bottom-right"
    );

    const onLoad = () => setReady(true);

    // The LOD functions live on the source instances, so they can only be
    // attached once the style has created them. Buildings retain at least z13
    // even when the basemap switches to tiles without building geometry.
    const applyLod = () => {
      for (const id of [SOURCE_ID, BUILDING_SOURCE_ID]) {
        const src = map.getSource<maplibregl.Source>(id);
        if (!src) {
          continue;
        }
        src.calculateTileZoom = tileZoomFor(
          quality,
          id === BUILDING_SOURCE_ID ? MIN_BUILDING_TILE_ZOOM : 0
        );
      }
    };

    // MapLibre swallows tile and style failures unless something is listening,
    // which turns "the map is blank" into a silent mystery.
    const onError = (e: maplibregl.ErrorEvent) => {
      // biome-ignore lint/suspicious/noConsole: surfacing map failures is the point
      console.error("[map]", e.error?.message ?? e);
    };

    map.on("load", onLoad);
    map.on("styledata", applyLod);
    map.on("error", onError);

    exposeMapForDebugging(map);

    return () => {
      map.off("load", onLoad);
      map.off("styledata", applyLod);
      map.off("error", onError);
      map.remove();
      mapRef.current = null;
      setInstance(null);
      setReady(false);
    };
  }, [source, quality, containerRef, mapRef, appliedStyleRef]);

  return { map: instance, ready };
}

/** Applies a new style in place, keeping the camera and the loaded tiles. */
export function useRestyle(
  mapRef: MapRef,
  style: Style | null,
  appliedStyleRef: RefObject<Style | null>
): void {
  useEffect(() => {
    const map = mapRef.current;
    if (!(map && style) || appliedStyleRef.current === style) {
      return;
    }

    // Re-applying the style the map was constructed with would abort the load
    // already in flight and leave the map permanently blank, so the first pass
    // is always a no-op.
    const apply = () => {
      appliedStyleRef.current = style;
      // `diff: true` lets MapLibre patch paint properties instead of tearing
      // the style down, so changing theme re-downloads no tiles at all.
      map.setStyle(style, { diff: true });
    };

    if (map.isStyleLoaded()) {
      apply();
      return;
    }

    // Switching theme while the first style is still loading has to wait, or
    // the diff has nothing to diff against.
    map.once("idle", apply);
    return () => {
      map.off("idle", apply);
    };
  }, [style, mapRef, appliedStyleRef]);
}

/** Pitch and bearing follow the 2D/3D toggle. */
export function useViewMode(mapRef: MapRef, view: ViewMode): void {
  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    if (view === "flat") {
      map.easeTo({ bearing: 0, duration: 450, pitch: 0 });
      map.setMaxPitch(0);
    } else {
      map.setMaxPitch(78);
      map.easeTo({ duration: 450, pitch: DEFAULT_CAMERA.pitch });
    }
  }, [view, mapRef]);
}

/** Mirrors the camera into the store and the URL hash. */
export function useCameraSync(mapRef: MapRef, ready: boolean): void {
  const setCamera = useMapStore((s) => s.setCamera);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    let raf = 0;
    const sync = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const c = map.getCenter();
        const cam = {
          bearing: map.getBearing(),
          center: [c.lng, c.lat] as LngLat,
          pitch: map.getPitch(),
          zoom: map.getZoom(),
        };
        setCamera(cam);
        // replaceState keeps the back button useful instead of filling history
        // with one entry per mouse-wheel tick.
        window.history.replaceState(null, "", encodeCameraHash(cam));
      });
    };

    // Seed the store from the map's actual starting camera, otherwise the
    // read-out shows the default until the user first moves.
    sync();

    map.on("moveend", sync);
    return () => {
      map.off("moveend", sync);
      cancelAnimationFrame(raf);
    };
  }, [setCamera, ready, mapRef]);
}

/** Frame rate and tile counters for the status strip. */
export function usePerfCounters(mapRef: MapRef): void {
  const setFps = useMapStore((s) => s.setFps);
  const setLoadedTiles = useMapStore((s) => s.setLoadedTiles);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    let frames = 0;
    let last = performance.now();
    let alive = true;

    const onRender = () => {
      frames += 1;
      const now = performance.now();
      if (now - last >= 500) {
        setFps(Math.round((frames * 1000) / (now - last)));
        frames = 0;
        last = now;
      }
    };

    // When the map is idle it stops painting, and a stalled counter reads as a
    // hang. Show "idle" instead once frames stop arriving.
    const idle = window.setInterval(() => {
      if (alive && performance.now() - last > 1200) {
        setFps(0);
      }
    }, 1000);

    // The count is only a read-out, so it is flushed on a timer: writing to the
    // store on every tile would re-render the HUD dozens of times a second
    // during a pan, which is real main-thread work spent on a number nobody
    // can read that fast.
    let tiles = 0;
    let flushed = 0;
    const onData = (e: maplibregl.MapSourceDataEvent) => {
      if (e.sourceId === SOURCE_ID && e.tile && e.isSourceLoaded !== false) {
        tiles += 1;
      }
    };

    const flush = window.setInterval(() => {
      if (tiles !== flushed) {
        flushed = tiles;
        setLoadedTiles(tiles);
      }
    }, 500);

    map.on("render", onRender);
    map.on("sourcedata", onData);

    return () => {
      alive = false;
      window.clearInterval(idle);
      window.clearInterval(flush);
      map.off("render", onRender);
      map.off("sourcedata", onData);
    };
  }, [setFps, setLoadedTiles, mapRef]);
}

function isInspectable(feature: MapGeoJSONFeature): boolean {
  return INSPECTABLE_LAYERS.has(feature.sourceLayer ?? "");
}

/** Click-to-inspect. Hover highlighting was removed: queryRenderedFeatures on
 * every mouse frame was a constant tax on a dense 3D scene for pure fluff. */
export function useFeatureInteraction(mapRef: MapRef, ready: boolean): void {
  const setSelection = useMapStore((s) => s.setSelection);

  useEffect(() => {
    const map = mapRef.current;
    if (!(map && ready)) {
      return;
    }

    const onClick = (e: maplibregl.MapMouseEvent) => {
      const hits = map.queryRenderedFeatures(e.point);
      // The live transport layer owns its vehicle inspector. Do not select a
      // building underneath the same click, regardless of listener ordering.
      if (hits.some((feature) => feature.source?.startsWith("live-transit"))) {
        setSelection(null);
        return;
      }
      // Prefer a real footprint over the coarse horizon massing that shares
      // its geometry; the massing hit is still worth something out where no
      // detailed tile exists.
      const useful =
        hits.find(
          (f) => f.layer.id !== "building-massing" && isInspectable(f)
        ) ?? hits.find(isInspectable);

      setSelection(
        useful ? readSelection(useful, [e.lngLat.lng, e.lngLat.lat]) : null
      );
    };

    map.on("click", onClick);
    return () => {
      map.off("click", onClick);
    };
  }, [ready, setSelection, mapRef]);
}

/** The pin dropped by a search result. */
export function useSearchMarker(mapRef: MapRef): void {
  const marker = useMapStore((s) => s.marker);

  useEffect(() => {
    const map = mapRef.current;
    if (!(map && marker)) {
      return;
    }

    const el = document.createElement("div");
    el.className = "berlin-pin";
    el.innerHTML =
      '<span class="berlin-pin__dot"></span><span class="berlin-pin__pulse"></span>';

    const pin = new maplibregl.Marker({ anchor: "center", element: el })
      .setLngLat(marker.center)
      .addTo(map);

    return () => {
      pin.remove();
    };
  }, [marker, mapRef]);
}
