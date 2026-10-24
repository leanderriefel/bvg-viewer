import type { Map as MapLibreMap } from "maplibre-gl";
import { useCallback, useMemo, useRef } from "react";

import { MapBootScreen } from "@/components/map/boot-screen";
import { MapContext } from "@/map/map-context";
import type { MapApi } from "@/map/map-context";
import { useMapStore } from "@/map/store";
import {
  useCameraSync,
  useFeatureInteraction,
  useMapInstance,
  useMapPreparation,
  useMapStyle,
  usePerfCounters,
  useRestyle,
  useSearchMarker,
  useTileSource,
  useViewMode,
} from "@/map/use-map-effects";
import { usePreparedNavigation } from "@/map/use-prepared-navigation";

interface Props {
  children?: React.ReactNode;
}

/**
 * Owns the MapLibre instance and publishes an imperative handle to the rest of
 * the UI. The hooks own map preparation and effects; this component is
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

  const map = useMapInstance({
    appliedStyleRef,
    containerRef,
    mapRef,
    quality,
    source,
    style,
  });

  const preparation = useMapPreparation(map);
  const startupReady = preparation.stage === "ready";
  const navigation = usePreparedNavigation(map, startupReady);
  const { flyTo, jumpTo } = navigation;
  const ready = startupReady && !navigation.busy;

  useRestyle(map, style, appliedStyleRef);
  useViewMode(map, ready, view);
  useCameraSync(map, ready);
  usePerfCounters(map);
  useFeatureInteraction(map, ready);
  useSearchMarker(map);

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
      {ready && children}
      {!ready && (
        <div className="absolute inset-0 z-20">
          <MapBootScreen
            destination={navigation.busy}
            progress={navigation.progress ?? preparation}
          />
        </div>
      )}
    </MapContext.Provider>
  );
}
