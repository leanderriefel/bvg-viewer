import type { Map as MapLibreMap } from "maplibre-gl";
import { createContext, useContext } from "react";

import type { LngLat } from "@/lib/geo";
import type { BerlinTour } from "@/map/tour/use-berlin-tour";

export interface FlyTarget {
  center: LngLat;
  zoom?: number;
  pitch?: number;
  bearing?: number;
  /** Drops a labelled pin at the target. */
  label?: string;
}

export interface MapApi {
  /** Null until the canvas has mounted and the style has loaded. */
  map: MapLibreMap | null;
  ready: boolean;
  flyTo: (target: FlyTarget) => void;
  jumpTo: (target: FlyTarget) => void;
  resetNorth: () => void;
  tour: BerlinTour;
}

export const MapContext = createContext<MapApi | null>(null);

export function useMapApi(): MapApi {
  const ctx = useContext(MapContext);
  if (!ctx) {
    throw new Error("useMapApi must be used inside <MapCanvas>");
  }
  return ctx;
}
