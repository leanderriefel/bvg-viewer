import { create } from "zustand";

import { TRANSIT_PRODUCTS } from "@/map/transit/model";
import type { TransitProduct, TransitSnapshot } from "@/map/transit/model";
import type { TransitRoute } from "@/map/transit/route";

interface TransitState {
  snapshot: TransitSnapshot | null;
  enabled: boolean;
  filters: Record<TransitProduct, boolean>;
  selectedId: string | null;
  followedId: string | null;
  selectedRoute: TransitRoute | null;
  routeStatus: "idle" | "loading" | "ready" | "error";
  error: string | null;
  status: "loading" | "live" | "error";
  setEnabled: (enabled: boolean) => void;
  toggleProduct: (product: TransitProduct) => void;
  selectVehicle: (selectedId: string | null) => void;
  followVehicle: (id: string | null) => void;
  stopFollowing: () => void;
  setSelectedRoute: (route: TransitRoute | null) => void;
  setRouteStatus: (status: TransitState["routeStatus"]) => void;
  receive: (snapshot: TransitSnapshot) => void;
  fail: (error: string) => void;
}

// Positions stay in memory: persisting them as preferences would revive stale
// vehicles on a later visit. The server owns the durable snapshot history.
export const useTransitStore = create<TransitState>()((set) => ({
  snapshot: null,
  enabled: true,
  filters: Object.fromEntries(
    TRANSIT_PRODUCTS.map((product) => [product, true])
  ) as Record<TransitProduct, boolean>,
  selectedId: null,
  followedId: null,
  selectedRoute: null,
  routeStatus: "idle",
  error: null,
  status: "loading",
  setEnabled: (enabled) =>
    set((state) => ({
      enabled,
      followedId: enabled ? state.followedId : null,
    })),
  toggleProduct: (product) =>
    set((state) => {
      const followed = state.snapshot?.vehicles.find(
        (vehicle) => vehicle.id === state.followedId
      );
      return {
        filters: { ...state.filters, [product]: !state.filters[product] },
        followedId:
          followed?.product === product && state.filters[product]
            ? null
            : state.followedId,
      };
    }),
  selectVehicle: (selectedId) =>
    set((state) => ({
      selectedId,
      followedId: selectedId === state.followedId ? state.followedId : null,
    })),
  followVehicle: (followedId) =>
    set((state) => {
      const vehicle = state.snapshot?.vehicles.find(
        (candidate) => candidate.id === followedId
      );
      return {
        followedId,
        selectedId: followedId ?? state.selectedId,
        enabled: followedId ? true : state.enabled,
        filters: vehicle
          ? { ...state.filters, [vehicle.product]: true }
          : state.filters,
      };
    }),
  stopFollowing: () => set({ followedId: null }),
  setSelectedRoute: (selectedRoute) => set({ selectedRoute }),
  setRouteStatus: (routeStatus) => set({ routeStatus }),
  receive: (snapshot) => set({ snapshot, error: null, status: "live" }),
  fail: (error) => set({ error, status: "error" }),
}));
