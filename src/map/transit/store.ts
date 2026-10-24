import { create } from "zustand";

import { TRANSIT_PRODUCTS } from "@/map/transit/model";
import type { TransitProduct, TransitSnapshot } from "@/map/transit/model";

interface TransitState {
  snapshot: TransitSnapshot | null;
  enabled: boolean;
  filters: Record<TransitProduct, boolean>;
  selectedId: string | null;
  error: string | null;
  status: "loading" | "live" | "error";
  setEnabled: (enabled: boolean) => void;
  toggleProduct: (product: TransitProduct) => void;
  selectVehicle: (selectedId: string | null) => void;
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
  error: null,
  status: "loading",
  setEnabled: (enabled) => set({ enabled }),
  toggleProduct: (product) =>
    set((state) => ({
      filters: { ...state.filters, [product]: !state.filters[product] },
    })),
  selectVehicle: (selectedId) => set({ selectedId }),
  receive: (snapshot) => set({ snapshot, error: null, status: "live" }),
  fail: (error) => set({ error, status: "error" }),
}));
