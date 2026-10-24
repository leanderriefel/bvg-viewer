import type { Map as MapLibreMap } from "maplibre-gl";

import type { TransitVehicle } from "./model";
import type { TransitPose } from "./motion";

export interface RenderedTransitVehicle {
  vehicle: TransitVehicle;
  pose: TransitPose;
  drawnAt: number;
}

const renderedPoses = new WeakMap<
  MapLibreMap,
  Map<string, RenderedTransitVehicle>
>();

export function bindRenderedTransitPoses(
  map: MapLibreMap,
  vehicles: Map<string, RenderedTransitVehicle>
): () => void {
  renderedPoses.set(map, vehicles);
  return () => {
    if (renderedPoses.get(map) === vehicles) {
      renderedPoses.delete(map);
    }
  };
}

/** The follow camera tracks the corrected on-screen pose during feed refreshes. */
export function renderedTransitPose(
  map: MapLibreMap,
  vehicle: TransitVehicle,
  time: number
): TransitPose | null {
  const rendered = renderedPoses.get(map)?.get(vehicle.id);
  return rendered?.vehicle === vehicle && time - rendered.drawnAt <= 250
    ? rendered.pose
    : null;
}
