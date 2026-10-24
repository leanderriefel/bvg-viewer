import * as maplibregl from "maplibre-gl";
import type { MapGeoJSONFeature, Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";

import { BERLIN_MAX_BOUNDS, DEFAULT_CAMERA } from "@/lib/geo";
import type { LngLat } from "@/lib/geo";
import { exposeMapForDebugging } from "@/map/debug";
import { installDistanceHaze } from "@/map/distance-haze";
import { trackMapLoadingHealth } from "@/map/loading-health";
import { DRAG_ROTATE_OPTIONS } from "@/map/navigation";
import { INITIAL_PREPARATION, prepareMap } from "@/map/preparation";
import type { PreparationProgress } from "@/map/preparation";
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
import {
  TRANSIT_POINT_SOURCE_ID,
  TRANSIT_SOURCE_ID,
} from "@/map/transit/use-transit-layer";

/**
 * The imperative half of the map, split out of the component so each concern -
 * creation, restyling, camera sync, counters, interaction - is readable on its
 * own instead of as one very long effect list.
 */

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
        if (ctrl.signal.aborted) {
          return;
        }
        setSource(found);
        setTileSource(found.kind);
      } catch {
        if (ctrl.signal.aborted) {
          return;
        }
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

/** Keep atmospheric softening in sync with the theme and map lifecycle. */
export function useDistanceHaze(map: MapLibreMap | null, view: ViewMode): void {
  const palette = useMapStore((s) => s.palette);
  useEffect(() => {
    if (!map || view !== "perspective") {
      return;
    }
    return installDistanceHaze(map, getPalette(palette).skyHorizon);
  }, [map, palette, view]);
}

type Style = NonNullable<ReturnType<typeof useMapStyle>>;

function getTileCacheSize(width: number): number {
  const memory =
    "deviceMemory" in navigator && typeof navigator.deviceMemory === "number"
      ? navigator.deviceMemory
      : 8;
  if (memory <= 2) {
    return 128;
  }
  if (memory <= 4 || width < 768) {
    return 256;
  }
  return 512;
}

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
}): MapLibreMap | null {
  const { containerRef, mapRef, appliedStyleRef, style, source, quality } =
    args;
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
    const cacheSize = getTileCacheSize(container.clientWidth);

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
      // Rapid zoom gestures should spend workers on the destination tiles,
      // rather than finish requests for zoom levels the camera has left.
      cancelPendingTileRequestsWhileZooming: true,
      // Size is only a ceiling: MapLibre also multiplies viewport tile count
      // by zoom levels (default 5). Raise both to retain the warmed geometry.
      maxTileCacheSize: cacheSize,
      maxTileCacheZoomLevels: 128,
      pixelRatio: PIXEL_RATIO_BY_QUALITY[quality](),
      canvasContextAttributes: {
        antialias: quality === "quality",
        powerPreference: "high-performance",
        preserveDrawingBuffer: false,
      },
    });
    const stopTrackingHealth = trackMapLoadingHealth(map);

    appliedStyleRef.current = initialStyle;
    mapRef.current = map;
    setInstance(map);

    map.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      "bottom-right"
    );

    // The LOD functions live on the source instances, so they can only be
    // attached once the style has created them. Buildings retain at least z13
    // even when the basemap switches to tiles without building geometry.
    const basemapZoom = tileZoomFor(quality);
    const buildingZoom = tileZoomFor(quality, MIN_BUILDING_TILE_ZOOM);
    const applyLod = () => {
      for (const id of [SOURCE_ID, BUILDING_SOURCE_ID]) {
        const src = map.getSource<maplibregl.Source>(id);
        if (!src) {
          continue;
        }
        src.calculateTileZoom =
          id === BUILDING_SOURCE_ID ? buildingZoom : basemapZoom;
      }
    };

    // MapLibre swallows tile and style failures unless something is listening,
    // which turns "the map is blank" into a silent mystery.
    const onError = (e: maplibregl.ErrorEvent) => {
      // biome-ignore lint/suspicious/noConsole: surfacing map failures is the point
      console.error("[map]", e.error?.message ?? e);
    };

    map.on("styledata", applyLod);
    map.on("error", onError);

    exposeMapForDebugging(map);

    return () => {
      stopTrackingHealth();
      map.off("styledata", applyLod);
      map.off("error", onError);
      map.remove();
      mapRef.current = null;
      setInstance(null);
    };
  }, [source, quality, containerRef, mapRef, appliedStyleRef]);

  return instance;
}

/** Applies a new style in place, keeping the camera and the loaded tiles. */
export function useRestyle(
  map: MapLibreMap | null,
  style: Style | null,
  appliedStyleRef: RefObject<Style | null>
): void {
  useEffect(() => {
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

    // Animated transit can keep its GeoJSON workers busy indefinitely. Once
    // the style definition exists, diff it without waiting for those sources.
    if (map.getStyle()) {
      // Patches an external renderer, without notifying a React parent.
      // oxlint-disable-next-line react-doctor/no-pass-live-state-to-parent
      apply();
      return;
    }

    // Switching theme while the first style is still loading has to wait, or
    // the diff has nothing to diff against.
    map.once("style.load", apply);
    return () => {
      map.off("style.load", apply);
    };
  }, [style, map, appliedStyleRef]);
}

/** Keep the canvas covered until its final starting viewport has rendered. */
export function useMapPreparation(
  map: MapLibreMap | null,
  onProgress?: (progress: PreparationProgress) => void
): PreparationProgress {
  const [state, setState] = useState<{
    map: MapLibreMap;
    progress: PreparationProgress;
  } | null>(null);

  useEffect(() => {
    if (!map) {
      return;
    }
    const controller = new AbortController();
    const connection = "connection" in navigator ? navigator.connection : null;
    const saveData =
      connection && typeof connection === "object" && "saveData" in connection
        ? connection.saveData === true
        : false;
    const run = async () => {
      try {
        await prepareMap(map, {
          signal: controller.signal,
          preloadRegion: !saveData,
          onProgress: (progress) => {
            if (!controller.signal.aborted) {
              setState({ map, progress });
              onProgress?.(progress);
            }
          },
        });
      } catch (error) {
        if (!controller.signal.aborted) {
          const progress: PreparationProgress = {
            ...INITIAL_PREPARATION,
            stage: "error",
            error:
              error instanceof Error
                ? error.message
                : "Unable to load the map. Please try again.",
          };
          setState({ map, progress });
          onProgress?.(progress);
        }
      }
    };
    void run();
    return () => controller.abort();
  }, [map, onProgress]);

  return state?.map === map ? state.progress : INITIAL_PREPARATION;
}

/** Pitch and bearing follow the 2D/3D toggle. */
export function useViewMode(
  map: MapLibreMap | null,
  ready: boolean,
  view: ViewMode
): void {
  const applied = useRef<{ map: MapLibreMap; view: ViewMode } | null>(null);
  useEffect(() => {
    if (!(map && ready)) {
      return;
    }
    const previous = applied.current;
    applied.current = { map, view };
    // The constructor already applied the shared camera. Preserve its pitch
    // when preparation completes or a quality change creates another map.
    if (previous?.map !== map || previous.view === view) {
      return;
    }

    if (view === "flat") {
      map.easeTo({ bearing: 0, duration: 450, pitch: 0 });
      map.setMaxPitch(0);
    } else {
      map.setMaxPitch(78);
      map.easeTo({ duration: 450, pitch: DEFAULT_CAMERA.pitch });
    }
  }, [view, ready, map]);
}

/** Mirrors the camera into the store and the URL hash. */
export function useCameraSync(map: MapLibreMap | null, ready: boolean): void {
  const setCamera = useMapStore((s) => s.setCamera);

  useEffect(() => {
    if (!(map && ready)) {
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
  }, [setCamera, ready, map]);
}

/** Frame rate and tile counters for the status strip. */
export function usePerfCounters(map: MapLibreMap | null): void {
  const setFps = useMapStore((s) => s.setFps);
  const setLoadedTiles = useMapStore((s) => s.setLoadedTiles);

  useEffect(() => {
    if (!map) {
      return;
    }

    let frames = 0;
    let last = 0;

    const onRender = () => {
      const now = performance.now();
      if (last === 0) {
        last = now;
      }
      frames += 1;
      if (now - last >= 500) {
        setFps(Math.round((frames * 1000) / (now - last)));
        frames = 0;
        last = now;
      }
    };

    // When the map is idle it stops painting, and a stalled counter reads as a
    // hang. Show "idle" instead once frames stop arriving.
    const onIdle = () => {
      frames = 0;
      last = 0;
      setFps(0);
    };

    // The count is only a read-out, so it is flushed on a timer: writing to the
    // store on every tile would re-render the HUD dozens of times a second
    // during a pan, which is real main-thread work spent on a number nobody
    // can read that fast.
    let tiles = 0;
    let flushed = 0;
    const onData = (e: maplibregl.MapSourceDataEvent) => {
      if (e.sourceId === SOURCE_ID && e.tile?.state === "loaded") {
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
    map.on("idle", onIdle);
    map.on("sourcedata", onData);

    return () => {
      window.clearInterval(flush);
      map.off("render", onRender);
      map.off("idle", onIdle);
      map.off("sourcedata", onData);
    };
  }, [setFps, setLoadedTiles, map]);
}

function isInspectable(feature: MapGeoJSONFeature): boolean {
  return INSPECTABLE_LAYERS.has(feature.sourceLayer ?? "");
}

/** Click-to-inspect. Hover highlighting was removed: queryRenderedFeatures on
 * every mouse frame was a constant tax on a dense 3D scene for pure fluff. */
export function useFeatureInteraction(
  map: MapLibreMap | null,
  ready: boolean
): void {
  const setSelection = useMapStore((s) => s.setSelection);

  useEffect(() => {
    if (!(map && ready)) {
      return;
    }

    const onClick = (e: maplibregl.MapMouseEvent) => {
      const hits = map.queryRenderedFeatures(e.point);
      // The live transport layer owns its vehicle inspector. Do not select a
      // building underneath the same click, regardless of listener ordering.
      if (
        hits.some(
          (feature) =>
            feature.source === TRANSIT_SOURCE_ID ||
            feature.source === TRANSIT_POINT_SOURCE_ID
        )
      ) {
        setSelection(null);
        return;
      }
      const useful = hits.find(isInspectable);

      setSelection(
        useful ? readSelection(useful, [e.lngLat.lng, e.lngLat.lat]) : null
      );
    };

    map.on("click", onClick);
    return () => {
      map.off("click", onClick);
    };
  }, [ready, setSelection, map]);
}

/** The pin dropped by a search result. */
export function useSearchMarker(map: MapLibreMap | null): void {
  const marker = useMapStore((s) => s.marker);

  useEffect(() => {
    if (!(map && marker)) {
      return;
    }

    const el = document.createElement("div");
    el.className = "berlin-pin";
    const dot = document.createElement("span");
    dot.className = "berlin-pin__dot";
    const pulse = document.createElement("span");
    pulse.className = "berlin-pin__pulse";
    el.append(dot, pulse);

    const pin = new maplibregl.Marker({ anchor: "center", element: el })
      .setLngLat(marker.center)
      .addTo(map);

    return () => {
      pin.remove();
    };
  }, [marker, map]);
}
