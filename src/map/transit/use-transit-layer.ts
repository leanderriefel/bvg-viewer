import type { Feature, FeatureCollection, Polygon } from "geojson";
import type {
  GeoJSONSource,
  Map as MapLibreMap,
  MapLayerMouseEvent,
} from "maplibre-gl";
import { useEffect } from "react";

import { haversine } from "@/lib/geo";
import type { LngLat } from "@/lib/geo";
import { useMapStore } from "@/map/store";
import { PRODUCT_COLORS } from "@/map/transit/model";
import type { TransitProduct, TransitVehicle } from "@/map/transit/model";
import { sampleVehicle } from "@/map/transit/motion";
import type { TransitPose } from "@/map/transit/motion";
import { useTransitStore } from "@/map/transit/store";

export const TRANSIT_SOURCE_ID = "live-transit";
export const TRANSIT_BODY_LAYER_ID = "live-transit-bodies";
const LABEL_LAYER_ID = "live-transit-labels";
const FRAME_INTERVAL = 1000 / 20;
const METRES_PER_DEGREE = 111_320;
const CORNERS = [
  [1, 1],
  [1, -1],
  [-1, -1],
  [-1, 1],
  [1, 1],
] as const;

interface VehicleProperties {
  color: string;
  height: number;
  id: string;
  label: string;
}

interface RenderVehicle {
  vehicle: TransitVehicle;
  feature: Feature<Polygon, VehicleProperties>;
  pose: TransitPose;
  correction: LngLat;
  correctedAt: number;
  drawnAt: number;
}

const TRAIN_SIZE = { height: 4, length: 45, width: 3.5 };
const VEHICLE_SIZE: Record<TransitProduct, typeof TRAIN_SIZE> = {
  bus: { height: 3.5, length: 15, width: 3 },
  ferry: { height: 5, length: 25, width: 7 },
  tram: { height: 3.5, length: 30, width: 3 },
  suburban: TRAIN_SIZE,
  subway: TRAIN_SIZE,
  express: TRAIN_SIZE,
  regional: TRAIN_SIZE,
  unknown: { height: 3.5, length: 15, width: 3 },
};

function makeRenderVehicle(vehicle: TransitVehicle): RenderVehicle {
  return {
    vehicle,
    pose: { coordinates: [0, 0], bearing: 0 },
    correction: [0, 0],
    correctedAt: -Infinity,
    drawnAt: -Infinity,
    feature: {
      type: "Feature",
      id: vehicle.id,
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [0, 0],
            [0, 0],
            [0, 0],
            [0, 0],
          ],
        ],
      },
      properties: {
        color: PRODUCT_COLORS[vehicle.product],
        height: VEHICLE_SIZE[vehicle.product].height,
        id: vehicle.id,
        label: vehicle.line,
      },
    },
  };
}

/** Update a metre-sized vehicle footprint in place; the worker gets one batch. */
function placeFootprint(
  render: RenderVehicle,
  center: LngLat,
  bearing: number
): void {
  const size = VEHICLE_SIZE[render.vehicle.product];
  const angle = (bearing * Math.PI) / 180;
  const sin = Math.sin(angle);
  const cos = Math.cos(angle);
  const longitudeScale =
    METRES_PER_DEGREE * Math.cos((center[1] * Math.PI) / 180);
  const [ring] = render.feature.geometry.coordinates;
  for (let i = 0; i < CORNERS.length; i += 1) {
    const [forward, side] = CORNERS[i];
    const along = (forward * size.length) / 2;
    const across = (side * size.width) / 2;
    ring[i][0] = center[0] + (along * sin + across * cos) / longitudeScale;
    ring[i][1] = center[1] + (along * cos - across * sin) / METRES_PER_DEGREE;
  }
}

function refreshRenderVehicle(
  render: RenderVehicle,
  vehicle: TransitVehicle,
  time: number
): RenderVehicle {
  if (
    vehicle.observedAt !== render.vehicle.observedAt &&
    time - render.drawnAt < 500
  ) {
    const [oldLongitude, oldLatitude] = render.pose.coordinates;
    const pose = sampleVehicle(vehicle, Date.now(), render.pose);
    if (
      pose &&
      haversine([oldLongitude, oldLatitude], pose.coordinates) < 200
    ) {
      render.correction[0] = oldLongitude - pose.coordinates[0];
      render.correction[1] = oldLatitude - pose.coordinates[1];
      render.correctedAt = time;
    } else {
      render.correctedAt = -Infinity;
    }
  }
  render.vehicle = vehicle;
  render.feature.properties.color = PRODUCT_COLORS[vehicle.product];
  render.feature.properties.label = vehicle.line;
  render.feature.properties.height = VEHICLE_SIZE[vehicle.product].height;
  return render;
}

function installLayers(
  map: MapLibreMap,
  data: FeatureCollection<Polygon, VehicleProperties>
): void {
  if (!map.getSource(TRANSIT_SOURCE_ID)) {
    map.addSource(TRANSIT_SOURCE_ID, {
      type: "geojson",
      data,
      maxzoom: 16,
      buffer: 16,
      attribution: "Live transport: VBB via transport.rest",
    });
  }
  if (!map.getLayer(TRANSIT_BODY_LAYER_ID)) {
    map.addLayer({
      id: TRANSIT_BODY_LAYER_ID,
      type: "fill-extrusion",
      source: TRANSIT_SOURCE_ID,
      paint: {
        "fill-extrusion-color": ["get", "color"],
        "fill-extrusion-height": ["get", "height"],
        "fill-extrusion-base": 0.6,
        "fill-extrusion-opacity": 0.95,
      },
    });
  }
  if (!map.getLayer(LABEL_LAYER_ID)) {
    map.addLayer({
      id: LABEL_LAYER_ID,
      type: "symbol",
      source: TRANSIT_SOURCE_ID,
      minzoom: 14,
      layout: {
        "text-field": ["get", "label"],
        "text-font": ["Noto Sans Bold"],
        "text-size": 11,
        "text-offset": [0, -1.3],
        "text-optional": true,
      },
      paint: {
        "text-color": "#17202b",
        "text-halo-color": "#ffffff",
        "text-halo-width": 1.5,
      },
    });
  }
}

function updateVisibleVehicles(
  map: MapLibreMap,
  renderVehicles: RenderVehicle[],
  filters: Record<TransitProduct, boolean>,
  data: FeatureCollection<Polygon, VehicleProperties>,
  time: number
): void {
  const bounds = map.getBounds();
  const west = bounds.getWest() - 0.002;
  const east = bounds.getEast() + 0.002;
  const south = bounds.getSouth() - 0.002;
  const north = bounds.getNorth() + 0.002;
  const now = Date.now();
  data.features.length = 0;
  for (const render of renderVehicles) {
    if (!filters[render.vehicle.product]) {
      continue;
    }
    const pose = sampleVehicle(render.vehicle, now, render.pose);
    if (
      !pose ||
      pose.coordinates[0] < west ||
      pose.coordinates[0] > east ||
      pose.coordinates[1] < south ||
      pose.coordinates[1] > north
    ) {
      continue;
    }
    const correctionWeight = Math.max(
      0,
      1 - (time - render.correctedAt) / 1000
    );
    pose.coordinates[0] += render.correction[0] * correctionWeight;
    pose.coordinates[1] += render.correction[1] * correctionWeight;
    placeFootprint(render, pose.coordinates, pose.bearing);
    render.drawnAt = time;
    data.features.push(render.feature);
  }
}

/** Animate outside React and redraw only vehicles in the current viewport. */
export function useTransitLayer(map: MapLibreMap | null, ready: boolean): void {
  useEffect(() => {
    if (!(map && ready)) {
      return;
    }

    const data: FeatureCollection<Polygon, VehicleProperties> = {
      type: "FeatureCollection",
      features: [],
    };
    let renderVehicles: RenderVehicle[] = [];
    let lastVehicles: TransitVehicle[] | undefined;
    let animationFrame = 0;
    let lastFrame = -Infinity;
    let dirty = true;
    let wasVisible = false;
    let removed = false;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    const restore = () => {
      installLayers(map, data);
      dirty = true;
    };
    if (map.isStyleLoaded()) {
      restore();
    }
    map.on("style.load", restore);

    const onClick = (event: MapLayerMouseEvent) => {
      const id: unknown = event.features?.[0]?.properties?.id;
      if (typeof id === "string") {
        useTransitStore.getState().selectVehicle(id);
        useMapStore.getState().setSelection(null);
      }
    };
    const onEnter = () => {
      map.getCanvas().style.cursor = "pointer";
    };
    const onLeave = () => {
      map.getCanvas().style.cursor = "";
    };
    const invalidate = () => {
      dirty = true;
    };
    const onRemove = () => {
      removed = true;
      cancelAnimationFrame(animationFrame);
    };
    map.on("remove", onRemove);
    map.on("click", TRANSIT_BODY_LAYER_ID, onClick);
    map.on("click", LABEL_LAYER_ID, onClick);
    map.on("mouseenter", TRANSIT_BODY_LAYER_ID, onEnter);
    map.on("mouseleave", TRANSIT_BODY_LAYER_ID, onLeave);
    map.on("moveend", invalidate);
    document.addEventListener("visibilitychange", invalidate);
    const unsubscribe = useTransitStore.subscribe(invalidate);

    const animate = (time: number) => {
      if (removed) {
        return;
      }
      animationFrame = requestAnimationFrame(animate);
      if (
        document.hidden ||
        time - lastFrame < (reducedMotion.matches ? 1000 : FRAME_INTERVAL)
      ) {
        return;
      }
      const source = map.getSource<GeoJSONSource>(TRANSIT_SOURCE_ID);
      if (!source) {
        return;
      }
      lastFrame = time;
      const state = useTransitStore.getState();
      const vehicles = state.snapshot?.vehicles;
      if (vehicles !== lastVehicles) {
        const previous = new Map(
          renderVehicles.map((render) => [render.vehicle.id, render])
        );
        renderVehicles =
          vehicles?.map((vehicle) => {
            const render = previous.get(vehicle.id);
            if (!render) {
              return makeRenderVehicle(vehicle);
            }
            return refreshRenderVehicle(render, vehicle, time);
          }) ?? [];
        lastVehicles = vehicles;
      }
      if (!state.enabled) {
        if (dirty || wasVisible) {
          data.features.length = 0;
          source.setData(data);
          wasVisible = false;
          dirty = false;
        }
        return;
      }

      updateVisibleVehicles(map, renderVehicles, state.filters, data, time);
      if (dirty || data.features.length > 0 || wasVisible) {
        source.setData(data);
        wasVisible = data.features.length > 0;
      }
      dirty = false;
    };
    animationFrame = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animationFrame);
      unsubscribe();
      map.off("style.load", restore);
      map.off("remove", onRemove);
      map.off("click", TRANSIT_BODY_LAYER_ID, onClick);
      map.off("click", LABEL_LAYER_ID, onClick);
      map.off("mouseenter", TRANSIT_BODY_LAYER_ID, onEnter);
      map.off("mouseleave", TRANSIT_BODY_LAYER_ID, onLeave);
      map.off("moveend", invalidate);
      document.removeEventListener("visibilitychange", invalidate);
      if (removed) {
        return;
      }
      for (const layer of [LABEL_LAYER_ID, TRANSIT_BODY_LAYER_ID]) {
        if (map.getLayer(layer)) {
          map.removeLayer(layer);
        }
      }
      if (map.getSource(TRANSIT_SOURCE_ID)) {
        map.removeSource(TRANSIT_SOURCE_ID);
      }
    };
  }, [map, ready]);
}
