import type { Map as MapLibreMap } from "maplibre-gl";
import { useCallback, useMemo, useRef } from "react";

import { MapBootScreen } from "@/components/map/boot-screen";
import { useMapEntrance } from "@/map/boot/use-map-entrance";
import { MapContext } from "@/map/map-context";
import type { MapApi } from "@/map/map-context";
import type { PreparationProgress } from "@/map/preparation";
import { useMapStore } from "@/map/store";
import { useBerlinTour } from "@/map/tour/use-berlin-tour";
import { useTransitFeed } from "@/map/transit/use-transit-feed";
import { useTransitLayer } from "@/map/transit/use-transit-layer";
import { useVehicleFollow } from "@/map/transit/use-vehicle-follow";
import { useVehicleRoute } from "@/map/transit/use-vehicle-route";
import {
  useCameraSync,
  useDistanceHaze,
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
  arrived: boolean;
  entered: boolean;
  onArrival: () => void;
  onProgress: (progress: PreparationProgress) => void;
}

/**
 * Owns the MapLibre instance and publishes an imperative handle to the rest of
 * the UI. The hooks own map preparation and effects; this component is
 * the container element, the camera helpers, and the context.
 */
export function MapCanvas({
  children,
  arrived,
  entered,
  onArrival,
  onProgress,
}: Props) {
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

  const preparation = useMapPreparation(map, onProgress);
  const startupReady = preparation.stage === "ready";
  const navigation = usePreparedNavigation(map, startupReady && arrived);
  const { flyTo, jumpTo } = navigation;
  const mapReady = startupReady && !navigation.busy;
  const ready = mapReady && arrived;

  useRestyle(map, style, appliedStyleRef);
  useDistanceHaze(map, view);
  useViewMode(map, ready, view);
  useMapEntrance(map, entered && startupReady, onArrival);
  useCameraSync(map, ready);
  usePerfCounters(map);
  useFeatureInteraction(map, ready);
  useSearchMarker(map);
  useTransitFeed();
  useTransitLayer(map, ready);
  useVehicleRoute();
  useVehicleFollow(map, ready);
  const tour = useBerlinTour(map, ready);

  const resetNorth = useCallback(() => {
    mapRef.current?.easeTo({ bearing: 0, duration: 400 });
  }, []);

  const api = useMemo<MapApi>(
    () => ({ flyTo, jumpTo, map, ready, resetNorth, tour }),
    [map, ready, flyTo, jumpTo, resetNorth, tour]
  );

  return (
    <MapContext.Provider value={api}>
      <div className="absolute inset-0" ref={containerRef} />
      {ready && children}
      {entered && !mapReady && (
        <div className="absolute inset-0 z-20">
          <MapBootScreen
            destination
            progress={navigation.progress ?? preparation}
          />
        </div>
      )}
    </MapContext.Provider>
  );
}
