import { readTransitRoute } from "@/map/transit/route";
import type { TransitRoute } from "@/map/transit/route";
import { useTransitStore } from "@/map/transit/store";

const ROUTE_TTL_MS = 10 * 60_000;
const routes = new Map<string, TransitRoute>();

async function loadRoute(
  tripId: string,
  line: string,
  signal: AbortSignal
): Promise<TransitRoute> {
  const query = new URLSearchParams({ tripId, lineName: line });
  const response = await fetch(`/api/transit-route?${query}`, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
  });
  if (!response.ok) {
    throw new Error("Route unavailable");
  }
  const route = readTransitRoute(await response.json());
  if (!route || route.tripId !== tripId) {
    throw new Error("Invalid trip route");
  }
  return route;
}

/** A cancellable, cached route request; late responses cannot replace a newer selection. */
export function startVehicleRouteLoad(
  tripId: string | null,
  line: string | null
): (() => void) | undefined {
  const store = useTransitStore.getState();
  store.setSelectedRoute(null);
  if (!(tripId && line)) {
    store.setRouteStatus("idle");
    return;
  }
  const key = JSON.stringify([tripId, line]);
  const cached = routes.get(key);
  if (cached && Date.now() - cached.updatedAt < ROUTE_TTL_MS) {
    routes.delete(key);
    routes.set(key, cached);
    store.setSelectedRoute(cached);
    store.setRouteStatus("ready");
    return;
  }
  store.setRouteStatus("loading");
  const controller = new AbortController();
  let disposed = false;
  const load = async () => {
    try {
      const route = await loadRoute(tripId, line, controller.signal);
      if (disposed) {
        return;
      }
      routes.delete(key);
      routes.set(key, route);
      if (routes.size > 64) {
        const oldest = routes.keys().next().value;
        if (oldest !== undefined) {
          routes.delete(oldest);
        }
      }
      useTransitStore.getState().setSelectedRoute(route);
      useTransitStore.getState().setRouteStatus("ready");
    } catch {
      if (!disposed) {
        useTransitStore.getState().setRouteStatus("error");
      }
    }
  };
  void load();
  return () => {
    disposed = true;
    controller.abort();
  };
}
