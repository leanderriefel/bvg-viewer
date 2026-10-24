import { useEffect } from "react";

import { startVehicleRouteLoad } from "@/map/transit/load-vehicle-route";
import { useTransitStore } from "@/map/transit/store";

/** Fetch one full shape when selection changes; never poll every vehicle route. */
export function useVehicleRoute(): void {
  const tripId = useTransitStore(
    (state) => state.followedId ?? state.selectedId
  );
  const line = useTransitStore(
    (state) =>
      state.snapshot?.vehicles.find(
        (vehicle) => vehicle.id === (state.followedId ?? state.selectedId)
      )?.line ?? null
  );
  useEffect(() => startVehicleRouteLoad(tripId, line), [tripId, line]);
}
