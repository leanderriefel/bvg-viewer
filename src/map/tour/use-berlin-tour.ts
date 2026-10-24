import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";

import { createBerlinTour } from "./berlin-tour";
import type { BerlinTourControls, BerlinTourState } from "./berlin-tour";

export interface BerlinTour extends BerlinTourControls {
  state: BerlinTourState | null;
}

export function useBerlinTour(
  map: MapLibreMap | null,
  ready: boolean
): BerlinTour {
  const controller = useRef<ReturnType<typeof createBerlinTour> | null>(null);
  const [state, setState] = useState<BerlinTourState | null>(null);
  const controls = useMemo<BerlinTourControls>(
    () => ({
      start: () => controller.current?.start(),
      pause: () => controller.current?.pause(),
      resume: () => controller.current?.resume(),
      exit: () => controller.current?.exit(),
    }),
    []
  );

  useEffect(() => {
    if (!(map && ready)) {
      return;
    }
    const tour = createBerlinTour(
      map,
      setState,
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
    controller.current = tour;
    return () => {
      controller.current = null;
      tour.dispose();
    };
  }, [map, ready]);

  return useMemo(() => ({ ...controls, state }), [controls, state]);
}
