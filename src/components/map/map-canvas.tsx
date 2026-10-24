import type { Map as MapLibreMap } from "maplibre-gl";
import { useCallback, useMemo, useRef } from "react";

import { DEFAULT_CAMERA } from "@/lib/geo";
import { MapContext } from "@/map/map-context";
import type { FlyTarget, MapApi } from "@/map/map-context";
import { useMapStore } from "@/map/store";
import { useTransitFeed } from "@/map/transit/use-transit-feed";
import { useTransitLayer } from "@/map/transit/use-transit-layer";
import {
  useCameraSync,
  useFeatureInteraction,
  useMapInstance,
  useMapStyle,
  usePerfCounters,
  useRestyle,
  useSearchMarker,
  useTileSource,
  useViewMode,
} from "@/map/use-map-effects";

interface Props {
  children?: React.ReactNode;
}

/**
 * Owns the MapLibre instance and publishes an imperative handle to the rest of
 * the UI. Everything imperative lives in `use-map-effects`; this component is
 * the container element, the camera helpers, and the context.
 */
export function MapCanvas({ children }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);

  const view = useMapStore((s) => s.view);
  const quality = useMapStore((s) => s.quality);

  const source = useTileSource();
  const style = useMapStyle(source);
  const appliedStyleRef = useRef<typeof style>(null);

  const { map, ready } = useMapInstance({
    appliedStyleRef,
    containerRef,
    mapRef,
    quality,
    source,
    style,
  });

  useRestyle(mapRef, style, appliedStyleRef);
  useViewMode(mapRef, view);
  useCameraSync(mapRef, ready);
  usePerfCounters(mapRef);
  useFeatureInteraction(mapRef, ready);
  useSearchMarker(mapRef);
  useTransitFeed();
  useTransitLayer(map, ready);

  const flyTo = useCallback((t: FlyTarget) => {
    const instance = mapRef.current;
    if (!instance) {
      return;
    }
    const flat = useMapStore.getState().view === "flat";
    instance.flyTo({
      center: t.center,
      zoom: t.zoom ?? 16.5,
      pitch: flat ? 0 : (t.pitch ?? DEFAULT_CAMERA.pitch),
      bearing: flat ? 0 : (t.bearing ?? 0),
      // A gentle curve reads as travel across the city rather than a cut.
      speed: 1.4,
      curve: 1.5,
      essential: true,
    });
  }, []);

  const jumpTo = useCallback((t: FlyTarget) => {
    const instance = mapRef.current;
    if (!instance) {
      return;
    }
    const flat = useMapStore.getState().view === "flat";
    instance.jumpTo({
      bearing: flat ? 0 : (t.bearing ?? 0),
      center: t.center,
      pitch: flat ? 0 : (t.pitch ?? DEFAULT_CAMERA.pitch),
      zoom: t.zoom ?? 16.5,
    });
  }, []);

  const resetNorth = useCallback(() => {
    mapRef.current?.easeTo({ bearing: 0, duration: 400 });
  }, []);

  const api = useMemo<MapApi>(
    () => ({ flyTo, jumpTo, map, ready, resetNorth }),
    [map, ready, flyTo, jumpTo, resetNorth]
  );

  return (
    <MapContext.Provider value={api}>
      <div className="absolute inset-0" ref={containerRef} />
      {children}
    </MapContext.Provider>
  );
}
