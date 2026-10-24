import { useEffect } from "react";

import { startVehicleRouteLoad } from "@/map/transit/load-vehicle-route";
import { useTransitStore } from "@/map/transit/store";

/** Fetch one full shape when selection changes; never poll every vehicle route. */
export function useVehicleRoute(): void {
  const mode = useTransitStore((state) => state.mode);
  const tripId = useTransitStore(
    (state) => state.followedId ?? state.selectedId
  );
  const line = useTransitStore(
    (state) =>
      state.snapshot?.vehicles.find(
        (vehicle) => vehicle.id === (state.followedId ?? state.selectedId)
      )?.line ?? null
  );
  // Historical vehicles use their saved forecast, never a route fetched from today's feed.
  useEffect(
    () => startVehicleRouteLoad(mode === "live" ? tripId : null, line),
    [tripId, line, mode]
  );
}
