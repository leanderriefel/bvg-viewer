import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useRef } from "react";

import { startMapEntrance } from "./map-entrance";

/** Plays once per visit; rebuilding a map for a quality change keeps its camera. */
export function useMapEntrance(
  map: MapLibreMap | null,
  entered: boolean,
  onArrival: () => void
): void {
  const played = useRef(false);

  useEffect(() => {
    if (!(map && entered)) {
      return;
    }
    if (played.current) {
      onArrival();
      return;
    }
    played.current = true;
    return startMapEntrance(
      map,
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      onArrival
    );
  }, [map, entered, onArrival]);
}
