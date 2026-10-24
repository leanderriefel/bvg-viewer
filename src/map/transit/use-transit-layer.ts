import type { Feature, FeatureCollection, Point, Polygon } from "geojson";
import type {
  GeoJSONSource,
  Map as MapLibreMap,
  MapLayerMouseEvent,
} from "maplibre-gl";
import { useEffect } from "react";

import { haversine } from "@/lib/geo";
import type { LngLat } from "@/lib/geo";
import { useMapStore } from "@/map/store";
import { MAX_VEHICLE_AGE_MS, PRODUCT_COLORS } from "@/map/transit/model";
import type { TransitProduct, TransitVehicle } from "@/map/transit/model";
import {
  routeBearing,
  sampleVehicle,
  smoothBearing,
} from "@/map/transit/motion";
import type { TransitPose } from "@/map/transit/motion";
import { displayTransitLine } from "@/map/transit/network";
import {
  forecastCorrectionMs,
  remainingForecastCorrection,
} from "@/map/transit/reconciliation";
import { bindRenderedTransitPoses } from "@/map/transit/rendered-poses";
import { bindTransitRoute } from "@/map/transit/route-layer";
import { useTransitStore } from "@/map/transit/store";
import { VEHICLE_MODEL_MIN_ZOOM } from "@/map/transit/vehicle-model-config";
import type { VehicleModelsController } from "@/map/transit/vehicle-model-layer";

export const TRANSIT_SOURCE_ID = "live-transit";
export const TRANSIT_BODY_LAYER_ID = "live-transit-bodies";
export const TRANSIT_POINT_SOURCE_ID = "live-transit-points";
export const TRANSIT_POINT_LAYER_ID = "live-transit-overview";
export const TRANSIT_MODEL_HIT_LAYER_ID = "live-transit-model-hits";
const SELECTION_LAYER_ID = "live-transit-selection";
const LABEL_LAYER_ID = "live-transit-labels";
const INTERACTIVE_LAYERS = [
  TRANSIT_BODY_LAYER_ID,
  TRANSIT_MODEL_HIT_LAYER_ID,
  TRANSIT_POINT_LAYER_ID,
  SELECTION_LAYER_ID,
  LABEL_LAYER_ID,
];
const SOURCE_FRAME_INTERVAL = 1000 / 20;
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
  selected: boolean;
  headingKnown: boolean;
  modelLoaded: boolean;
}

interface RenderVehicle {
  vehicle: TransitVehicle;
  feature: Feature<Polygon, VehicleProperties>;
  point: Feature<Point, VehicleProperties>;
  pose: TransitPose;
  correctionTimeMs: number;
  correctedAt: number;
  drawnAt: number;
  drawnBearing: number;
  hasHeading: boolean;
  headingTrusted: boolean;
  bearingInitialized: boolean;
}

type TransitState = ReturnType<typeof useTransitStore.getState>;

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

function transitFrameInterval(
  reducedMotion: boolean,
  models: VehicleModelsController | null,
  zoom: number
): number {
  if (reducedMotion) {
    return 1000;
  }
  return models && zoom >= VEHICLE_MODEL_MIN_ZOOM ? 0 : SOURCE_FRAME_INTERVAL;
}

function makeRenderVehicle(vehicle: TransitVehicle): RenderVehicle {
  const hasHeading = hasForecastHeading(vehicle);
  const properties: VehicleProperties = {
    color: PRODUCT_COLORS[vehicle.product],
    height: VEHICLE_SIZE[vehicle.product].height,
    id: vehicle.id,
    label: displayTransitLine(vehicle),
    selected: false,
    headingKnown: hasHeading,
    modelLoaded: false,
  };
  return {
    vehicle,
    pose: { coordinates: [0, 0], bearing: 0 },
    correctionTimeMs: 0,
    correctedAt: -Infinity,
    drawnAt: -Infinity,
    drawnBearing: 0,
    hasHeading,
    headingTrusted: hasHeading,
    bearingInitialized: false,
    point: {
      type: "Feature",
      id: vehicle.id,
      geometry: { type: "Point", coordinates: [0, 0] },
      properties,
    },
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
      properties,
    },
  };
}

function hasForecastHeading(vehicle: TransitVehicle): boolean {
  const first = vehicle.frames[0]?.coordinates;
  return (
    first !== undefined &&
    vehicle.frames.some((frame) => haversine(first, frame.coordinates) >= 1)
  );
}

/** Update a metre-sized vehicle footprint in place; the worker gets one batch. */
function placeFootprint(
  render: RenderVehicle,
  center: LngLat,
  bearing: number,
  size = VEHICLE_SIZE[render.vehicle.product]
): void {
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
  time: number,
  now: number,
  state: TransitState
): RenderVehicle {
  if (
    state.mode === "live" &&
    vehicle.observedAt !== render.vehicle.observedAt &&
    time - render.drawnAt < 500
  ) {
    render.correctionTimeMs = forecastCorrectionMs(
      vehicle,
      render.pose.coordinates,
      now
    );
    render.correctedAt = time;
  }
  if (state.mode === "replay") {
    render.correctionTimeMs = 0;
  }
  render.vehicle = vehicle;
  render.hasHeading = hasForecastHeading(vehicle);
  render.feature.properties.color = PRODUCT_COLORS[vehicle.product];
  render.feature.properties.label = displayTransitLine(vehicle);
  render.feature.properties.height = VEHICLE_SIZE[vehicle.product].height;
  return render;
}

function refreshRenderVehicles(
  previous: Map<string, RenderVehicle>,
  vehicles: TransitVehicle[] | undefined,
  time: number,
  now: number,
  state: TransitState
): RenderVehicle[] {
  const next =
    vehicles?.map((vehicle) => {
      const render = previous.get(vehicle.id);
      return render
        ? refreshRenderVehicle(render, vehicle, time, now, state)
        : makeRenderVehicle(vehicle);
    }) ?? [];
  previous.clear();
  for (const render of next) {
    previous.set(render.vehicle.id, render);
  }
  return next;
}

function installLayers(
  map: MapLibreMap,
  data: FeatureCollection<Polygon, VehicleProperties>,
  points: FeatureCollection<Point, VehicleProperties>
): void {
  if (!map.getSource(TRANSIT_SOURCE_ID)) {
    map.addSource(TRANSIT_SOURCE_ID, {
      type: "geojson",
      data,
      maxzoom: 16,
      buffer: 16,
      attribution: "Transport: VBB via transport.rest",
    });
  }
  if (!map.getSource(TRANSIT_POINT_SOURCE_ID)) {
    // This source has its own complete zoom range. Neither it nor the bodies
    // depend on the building tiles or their distance-based level of detail.
    map.addSource(TRANSIT_POINT_SOURCE_ID, {
      type: "geojson",
      data: points,
      maxzoom: 16,
      buffer: 32,
    });
  }
  if (!map.getLayer(TRANSIT_BODY_LAYER_ID)) {
    map.addLayer({
      id: TRANSIT_BODY_LAYER_ID,
      type: "fill-extrusion",
      source: TRANSIT_SOURCE_ID,
      filter: [
        "all",
        ["==", ["get", "headingKnown"], true],
        ["!=", ["get", "modelLoaded"], true],
      ],
      paint: {
        "fill-extrusion-color": ["get", "color"],
        "fill-extrusion-height": ["get", "height"],
        "fill-extrusion-base": 0.6,
        "fill-extrusion-opacity": 0.95,
      },
    });
  }
  if (!map.getLayer(TRANSIT_MODEL_HIT_LAYER_ID)) {
    // Custom GL meshes are not queryable as style features. Their actual-sized
    // invisible footprints preserve selection/hover without drawing a box.
    map.addLayer({
      id: TRANSIT_MODEL_HIT_LAYER_ID,
      type: "fill",
      source: TRANSIT_SOURCE_ID,
      filter: ["==", ["get", "modelLoaded"], true],
      paint: { "fill-opacity": 0 },
    });
  }
  if (!map.getLayer(TRANSIT_POINT_LAYER_ID)) {
    map.addLayer({
      id: TRANSIT_POINT_LAYER_ID,
      type: "circle",
      source: TRANSIT_POINT_SOURCE_ID,
      minzoom: 0,
      paint: {
        "circle-color": ["get", "color"],
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          11,
          3,
          13,
          4,
          15,
          3,
          16,
          ["case", ["get", "headingKnown"], 2, 3],
        ],
        "circle-opacity": [
          "interpolate",
          ["linear"],
          ["zoom"],
          14.5,
          0.95,
          16,
          ["case", ["get", "headingKnown"], 0, 0.95],
        ],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 1.2,
        "circle-stroke-opacity": [
          "interpolate",
          ["linear"],
          ["zoom"],
          14.5,
          0.9,
          16,
          ["case", ["get", "headingKnown"], 0, 0.9],
        ],
        "circle-pitch-alignment": "viewport",
        "circle-pitch-scale": "viewport",
      },
    });
  }
  if (!map.getLayer(SELECTION_LAYER_ID)) {
    map.addLayer({
      id: SELECTION_LAYER_ID,
      type: "circle",
      source: TRANSIT_POINT_SOURCE_ID,
      filter: ["==", ["get", "selected"], true],
      paint: {
        "circle-color": ["get", "color"],
        "circle-opacity": 0.18,
        "circle-radius": 9,
        "circle-stroke-color": ["get", "color"],
        "circle-stroke-width": 2.5,
        "circle-pitch-alignment": "viewport",
        "circle-pitch-scale": "viewport",
      },
    });
  }
  if (!map.getLayer(LABEL_LAYER_ID)) {
    map.addLayer({
      id: LABEL_LAYER_ID,
      type: "symbol",
      source: TRANSIT_POINT_SOURCE_ID,
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

function updateVehicleBearing(
  render: RenderVehicle,
  pose: TransitPose,
  state: TransitState,
  time: number
): void {
  const fullRoute =
    state.selectedRoute?.tripId === render.vehicle.id
      ? state.selectedRoute
      : null;
  const routeHeading =
    !render.hasHeading && fullRoute
      ? routeBearing(
          fullRoute.coordinates,
          pose.coordinates,
          render.headingTrusted ? render.drawnBearing : undefined
        )
      : null;
  const heading = render.hasHeading
    ? pose.bearing
    : (routeHeading ?? render.drawnBearing);
  // A round marker had no visible orientation to interpolate from. Give its
  // first directional shape the actual heading instead of rotating from north.
  const canBlendBearing =
    state.mode === "live" && render.bearingInitialized && render.headingTrusted;
  render.headingTrusted ||= render.hasHeading || routeHeading !== null;
  render.feature.properties.headingKnown = render.headingTrusted;
  const blend = 1 - Math.exp(-(time - render.drawnAt) / 300);
  render.drawnBearing = canBlendBearing
    ? smoothBearing(render.drawnBearing, heading, blend)
    : heading;
  render.bearingInitialized = true;
}

function updateVisibleVehicles(
  map: MapLibreMap,
  renderVehicles: RenderVehicle[],
  state: TransitState,
  data: FeatureCollection<Polygon, VehicleProperties>,
  points: FeatureCollection<Point, VehicleProperties>,
  time: number,
  now: number,
  models: VehicleModelsController | null
): void {
  const bounds = map.getBounds();
  const west = bounds.getWest() - 0.002;
  const east = bounds.getEast() + 0.002;
  const south = bounds.getSouth() - 0.002;
  const north = bounds.getNorth() + 0.002;
  data.features.length = 0;
  points.features.length = 0;
  models?.beginFrame(map.getZoom());
  for (const render of renderVehicles) {
    const { id } = render.vehicle;
    if (
      !state.filters[render.vehicle.product] ||
      now - render.vehicle.observedAt > MAX_VEHICLE_AGE_MS
    ) {
      continue;
    }
    const correction = remainingForecastCorrection(
      render.correctionTimeMs,
      time - render.correctedAt
    );
    const sampleAt = Math.min(
      now + correction,
      render.vehicle.observedAt + MAX_VEHICLE_AGE_MS
    );
    const pose = sampleVehicle(render.vehicle, sampleAt, render.pose);
    if (
      !pose ||
      pose.coordinates[0] < west ||
      pose.coordinates[0] > east ||
      pose.coordinates[1] < south ||
      pose.coordinates[1] > north
    ) {
      continue;
    }
    const selected = id === state.selectedId || id === state.followedId;
    render.feature.properties.modelLoaded = false;
    updateVehicleBearing(render, pose, state, time);
    const model = render.headingTrusted
      ? models?.draw(
          render.vehicle,
          pose.coordinates,
          render.drawnBearing,
          selected
        )
      : null;
    render.feature.properties.modelLoaded = Boolean(model);
    placeFootprint(
      render,
      pose.coordinates,
      render.drawnBearing,
      model?.dimensions
    );
    data.features.push(render.feature);
    const [longitude, latitude] = pose.coordinates;
    render.point.geometry.coordinates[0] = longitude;
    render.point.geometry.coordinates[1] = latitude;
    render.feature.properties.selected = selected;
    render.drawnAt = time;
    points.features.push(render.point);
  }
  models?.endFrame();
}

function bindVehicleInteraction(
  map: MapLibreMap,
  onClick: (event: MapLayerMouseEvent) => void,
  onEnter: () => void,
  onLeave: () => void
): () => void {
  // Delegate once across the fleet: each delegated hover listener performs a
  // rendered-feature query on pointer movement, even when its layer is empty.
  map.on("click", INTERACTIVE_LAYERS, onClick);
  map.on("mouseenter", INTERACTIVE_LAYERS, onEnter);
  map.on("mouseleave", INTERACTIVE_LAYERS, onLeave);
  return () => {
    map.off("click", INTERACTIVE_LAYERS, onClick);
    map.off("mouseenter", INTERACTIVE_LAYERS, onEnter);
    map.off("mouseleave", INTERACTIVE_LAYERS, onLeave);
  };
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
    const points: FeatureCollection<Point, VehicleProperties> = {
      type: "FeatureCollection",
      features: [],
    };
    let renderVehicles: RenderVehicle[] = [];
    const renderedById = new Map<string, RenderVehicle>();
    const unbindPoses = bindRenderedTransitPoses(map, renderedById);
    let lastVehicles: TransitVehicle[] | undefined;
    let animationFrame = 0;
    let lastFrame = -Infinity;
    let lastSourceFrame = -Infinity;
    let dirty = true;
    let wasVisible = false;
    let removed = false;
    let disposed = false;
    let models: VehicleModelsController | null = null;
    let modelsLoading = false;
    let modelsUnavailable = false;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const unbindRoute = bindTransitRoute(map);

    const restore = () => {
      installLayers(map, data, points);
      models?.restore();
      dirty = true;
    };
    // `ready` means the initial load event already fired. Camera tile requests
    // can make isStyleLoaded() false again without another style.load event.
    if (map.getStyle()) {
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
    const unbindVehicles = bindVehicleInteraction(
      map,
      onClick,
      onEnter,
      onLeave
    );
    map.on("moveend", invalidate);
    document.addEventListener("visibilitychange", invalidate);
    const unsubscribe = useTransitStore.subscribe(invalidate);

    const requestModels = async () => {
      if (
        models ||
        modelsLoading ||
        modelsUnavailable ||
        disposed ||
        removed ||
        map.getZoom() < VEHICLE_MODEL_MIN_ZOOM
      ) {
        return;
      }
      modelsLoading = true;
      try {
        const { createVehicleModels } =
          await import("@/map/transit/vehicle-model-layer");
        if (!(disposed || removed)) {
          models = createVehicleModels(map, invalidate);
          dirty = true;
        }
      } catch {
        modelsUnavailable = true;
      } finally {
        modelsLoading = false;
      }
    };

    const animate = (time: number) => {
      if (removed) {
        return;
      }
      animationFrame = requestAnimationFrame(animate);
      const frameInterval = transitFrameInterval(
        reducedMotion.matches,
        models,
        map.getZoom()
      );
      if (
        document.hidden ||
        // Keep the last fleet visible while zooming. Rebuilding two GeoJSON
        // tile pyramids at 20 Hz competes with the basemap's new tile uploads,
        // especially when a zoom-out reveals the entire city at once.
        map.isZooming() ||
        time - lastFrame < frameInterval
      ) {
        return;
      }
      const source = map.getSource<GeoJSONSource>(TRANSIT_SOURCE_ID);
      const pointSource = map.getSource<GeoJSONSource>(TRANSIT_POINT_SOURCE_ID);
      if (!(source && pointSource)) {
        return;
      }
      lastFrame = time;
      const state = useTransitStore.getState();
      // The UI clock publishes at 20 Hz. Live models sample wall time on every
      // display frame without waking React or rebuilding GeoJSON more often.
      const now = state.mode === "live" ? Date.now() : state.clockTime;
      const vehicles = state.snapshot?.vehicles;
      if (vehicles !== lastVehicles) {
        renderVehicles = refreshRenderVehicles(
          renderedById,
          vehicles,
          time,
          now,
          state
        );
        lastVehicles = vehicles;
      }
      if (!state.enabled) {
        if (dirty || wasVisible) {
          data.features.length = 0;
          points.features.length = 0;
          models?.beginFrame(0);
          models?.endFrame();
          source.setData(data);
          pointSource.setData(points);
          wasVisible = false;
          dirty = false;
        }
        return;
      }

      void requestModels();
      updateVisibleVehicles(
        map,
        renderVehicles,
        state,
        data,
        points,
        time,
        now,
        models
      );
      if (
        time - lastSourceFrame >= SOURCE_FRAME_INTERVAL &&
        (dirty || points.features.length > 0 || wasVisible)
      ) {
        source.setData(data);
        pointSource.setData(points);
        lastSourceFrame = time;
        wasVisible = points.features.length > 0;
        dirty = false;
      }
    };
    animationFrame = requestAnimationFrame(animate);

    return () => {
      disposed = true;
      cancelAnimationFrame(animationFrame);
      unsubscribe();
      unbindPoses();
      unbindRoute();
      map.off("style.load", restore);
      map.off("remove", onRemove);
      unbindVehicles();
      map.off("moveend", invalidate);
      document.removeEventListener("visibilitychange", invalidate);
      models?.dispose();
      if (removed) {
        return;
      }
      for (const layer of INTERACTIVE_LAYERS) {
        if (map.getLayer(layer)) {
          map.removeLayer(layer);
        }
      }
      for (const sourceId of [TRANSIT_SOURCE_ID, TRANSIT_POINT_SOURCE_ID]) {
        if (map.getSource(sourceId)) {
          map.removeSource(sourceId);
        }
      }
    };
  }, [map, ready]);
}
