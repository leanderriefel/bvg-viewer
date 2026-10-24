import type { FeatureCollection, LineString, Point } from "geojson";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";

import { PRODUCT_COLORS } from "@/map/transit/model";
import type { TransitVehicle } from "@/map/transit/model";
import type { TransitRoute } from "@/map/transit/route";
import { useTransitStore } from "@/map/transit/store";
import { isXrayVehicle } from "@/map/transit/xray";

const ROUTE_SOURCE_ID = "live-transit-route";
const ROUTE_HALO_ID = "live-transit-route-halo";
const ROUTE_LINE_ID = "live-transit-route-line";
const ROUTE_STOPS_ID = "live-transit-route-stops";
const ROUTE_LAYERS = [ROUTE_STOPS_ID, ROUTE_LINE_ID, ROUTE_HALO_ID];

interface RouteProperties {
  color: string;
  kind: "route" | "stop";
  name: string;
}

type RouteData = FeatureCollection<LineString | Point, RouteProperties>;

function routeData(
  vehicle: TransitVehicle | undefined,
  route: TransitRoute | null
): RouteData {
  const coordinates = route?.coordinates ?? vehicle?.route ?? [];
  if (coordinates.length < 2) {
    return { type: "FeatureCollection", features: [] };
  }
  const color = vehicle ? PRODUCT_COLORS[vehicle.product] : "#1767ad";
  const data: RouteData = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "LineString", coordinates },
        properties: {
          color,
          kind: "route",
          name: route?.line ?? vehicle?.line ?? "",
        },
      },
    ],
  };
  for (const stop of route?.stops ?? []) {
    data.features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: stop.coordinates },
      properties: { color, kind: "stop", name: stop.name },
    });
  }
  return data;
}

function installRouteLayers(map: MapLibreMap): void {
  if (!map.getSource(ROUTE_SOURCE_ID)) {
    map.addSource(ROUTE_SOURCE_ID, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
      maxzoom: 16,
      buffer: 32,
    });
  }
  const before = map.getLayer("live-transit-bodies")
    ? "live-transit-bodies"
    : undefined;
  if (!map.getLayer(ROUTE_HALO_ID)) {
    map.addLayer(
      {
        id: ROUTE_HALO_ID,
        type: "line",
        source: ROUTE_SOURCE_ID,
        filter: ["==", ["get", "kind"], "route"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#ffffff",
          "line-opacity": 0.65,
          "line-width": ["interpolate", ["linear"], ["zoom"], 11, 4, 16, 8],
        },
      },
      before
    );
  }
  if (!map.getLayer(ROUTE_LINE_ID)) {
    map.addLayer(
      {
        id: ROUTE_LINE_ID,
        type: "line",
        source: ROUTE_SOURCE_ID,
        filter: ["==", ["get", "kind"], "route"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["get", "color"],
          "line-opacity": 0.8,
          "line-width": ["interpolate", ["linear"], ["zoom"], 11, 2, 16, 4],
        },
      },
      before
    );
  }
  if (!map.getLayer(ROUTE_STOPS_ID)) {
    map.addLayer(
      {
        id: ROUTE_STOPS_ID,
        type: "circle",
        source: ROUTE_SOURCE_ID,
        minzoom: 13,
        filter: ["==", ["get", "kind"], "stop"],
        paint: {
          "circle-color": "#ffffff",
          "circle-radius": 3.5,
          "circle-stroke-color": ["get", "color"],
          "circle-stroke-width": 2,
        },
      },
      before
    );
  }
}

/** The route changes with selection or new data, separately from animation. */
export function bindTransitRoute(map: MapLibreMap): () => void {
  let removed = false;
  let previousKey: string | null = null;
  let previousRoute: TransitRoute | null = null;
  const sync = () => {
    const source = map.getSource<GeoJSONSource>(ROUTE_SOURCE_ID);
    if (!source || removed) {
      return;
    }
    const state = useTransitStore.getState();
    const activeId = state.followedId ?? state.selectedId;
    const vehicle = state.snapshot?.vehicles.find(
      (item) => item.id === activeId
    );
    const route =
      state.mode === "live" && state.selectedRoute?.tripId === activeId
        ? state.selectedRoute
        : null;
    const visible =
      state.enabled && (!vehicle || state.filters[vehicle.product]);
    const key = `${activeId}:${visible}:${vehicle?.product}:${route ? "full" : vehicle?.observedAt}`;
    if (key === previousKey && route === previousRoute) {
      return;
    }
    previousKey = key;
    previousRoute = route;
    const xray = isXrayVehicle(vehicle);
    map.setPaintProperty(
      ROUTE_LINE_ID,
      "line-dasharray",
      xray ? [2, 2] : undefined
    );
    map.setPaintProperty(ROUTE_HALO_ID, "line-opacity", xray ? 0.2 : 0.65);
    map.setPaintProperty(ROUTE_HALO_ID, "line-blur", xray ? 2 : 0);
    source.setData(
      visible && activeId
        ? routeData(vehicle, route)
        : { type: "FeatureCollection", features: [] }
    );
  };
  const restore = () => {
    installRouteLayers(map);
    previousKey = null;
    sync();
  };
  const onRemove = () => {
    removed = true;
  };
  map.on("style.load", restore);
  map.on("remove", onRemove);
  const unsubscribe = useTransitStore.subscribe(sync);
  // The style definition is enough to add sources; ongoing camera tile loads
  // must not leave this waiting for a style.load event that already happened.
  if (map.getStyle()) {
    restore();
  }
  return () => {
    unsubscribe();
    map.off("style.load", restore);
    map.off("remove", onRemove);
    if (removed) {
      return;
    }
    for (const layer of ROUTE_LAYERS) {
      if (map.getLayer(layer)) {
        map.removeLayer(layer);
      }
    }
    if (map.getSource(ROUTE_SOURCE_ID)) {
      map.removeSource(ROUTE_SOURCE_ID);
    }
  };
}
