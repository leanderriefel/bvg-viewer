import { create } from "zustand";
import { persist } from "zustand/middleware";

import { DEFAULT_CAMERA } from "@/lib/geo";
import type { LngLat } from "@/lib/geo";
import type { TileSourceKind } from "@/map/sources";
import type { QualityLevel, ViewMode } from "@/map/theme/build-style";
import type { PaletteId } from "@/map/theme/palette";

export interface Camera {
  center: LngLat;
  zoom: number;
  pitch: number;
  bearing: number;
}

/** What the inspector shows when you click something. */
export interface Selection {
  kind: "building" | "place";
  /** MapLibre feature id, when the click landed on a real footprint. */
  featureId?: string | number;
  name?: string;
  housenumber?: string;
  street?: string;
  height?: number;
  levels?: number;
  center: LngLat;
  /** Free-form extra rows harvested from the vector tile properties. */
  details: [string, string][];
}

interface MapState {
  // -- persisted preferences ----------------------------------------------
  palette: PaletteId;
  view: ViewMode;
  quality: QualityLevel;
  showHousenumbers: boolean;
  showPois: boolean;
  showStreetNames: boolean;

  // -- ephemeral ----------------------------------------------------------
  camera: Camera;
  tileSource: TileSourceKind | null;
  selection: Selection | null;
  /** A dropped pin from search, drawn until the next search or dismissal. */
  marker: { center: LngLat; label: string } | null;
  fps: number;
  loadedTiles: number;

  setPalette: (p: PaletteId) => void;
  setView: (v: ViewMode) => void;
  toggleView: () => void;
  setQuality: (q: QualityLevel) => void;
  setLayerFlag: (
    key: "showHousenumbers" | "showPois" | "showStreetNames",
    value: boolean
  ) => void;
  setCamera: (c: Camera) => void;
  setTileSource: (k: TileSourceKind) => void;
  setSelection: (s: Selection | null) => void;
  setMarker: (m: { center: LngLat; label: string } | null) => void;
  setFps: (n: number) => void;
  setLoadedTiles: (n: number) => void;
}

export const useMapStore = create<MapState>()(
  persist(
    (set, get) => ({
      camera: { ...DEFAULT_CAMERA, center: [...DEFAULT_CAMERA.center] },
      fps: 0,
      loadedTiles: 0,
      marker: null,
      palette: "daylight",
      quality: "balanced",
      selection: null,
      setCamera: (camera) => set({ camera }),
      setFps: (fps) => set({ fps }),
      setLayerFlag: (key, value) => set({ [key]: value } as Partial<MapState>),
      setLoadedTiles: (loadedTiles) => set({ loadedTiles }),
      setMarker: (marker) => set({ marker }),
      setPalette: (palette) => set({ palette }),
      setQuality: (quality) => set({ quality }),
      setSelection: (selection) => set({ selection }),
      setTileSource: (tileSource) => set({ tileSource }),
      setView: (view) => set({ view }),
      showHousenumbers: true,
      showPois: true,
      showStreetNames: true,
      tileSource: null,
      toggleView: () =>
        set({ view: get().view === "perspective" ? "flat" : "perspective" }),
      view: "perspective",
    }),
    {
      name: "berlin3d.settings",
      // The camera lives in the URL hash instead, so a shared link beats a
      // stale localStorage entry and two tabs do not fight over position.
      partialize: (s) => ({
        palette: s.palette,
        quality: s.quality,
        showHousenumbers: s.showHousenumbers,
        showPois: s.showPois,
        showStreetNames: s.showStreetNames,
        view: s.view,
      }),
    }
  )
);

/**
 * Camera <-> URL hash, in the `#15.2/52.5200/13.4050/-18/55` form that most
 * map tools use, so links are readable and portable.
 */
export function encodeCameraHash(c: Camera): string {
  return `#${c.zoom.toFixed(2)}/${c.center[1].toFixed(5)}/${c.center[0].toFixed(
    5
  )}/${Math.round(c.bearing)}/${Math.round(c.pitch)}`;
}

export function decodeCameraHash(hash: string): Camera | null {
  const parts = hash.replace(/^#/u, "").split("/");
  if (parts.length < 3) {
    return null;
  }

  const [zoom, lat, lng, bearing, pitch] = parts.map(Number);
  if (
    !(Number.isFinite(zoom) && Number.isFinite(lat) && Number.isFinite(lng))
  ) {
    return null;
  }

  return {
    bearing: Number.isFinite(bearing) ? bearing : 0,
    center: [lng, lat],
    pitch: Number.isFinite(pitch) ? pitch : 0,
    zoom,
  };
}
