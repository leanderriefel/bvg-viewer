import type {
  ExpressionSpecification,
  FilterSpecification,
  Map as MapLibreMap,
} from "maplibre-gl";

import { haversine } from "@/lib/geo";
import type { LngLat } from "@/lib/geo";
import type { TransitVehicle } from "@/map/transit/model";

const BUILDING_LAYER_ID = "building-3d";
const FOCUS_LAYER_ID = "live-transit-xray-buildings";
const FOCUS_RADIUS_METRES = 130;
const FOCUS_UPDATE_MS = 1000;
const FOCUS_MOVE_METRES = 30;
const FOCUS_MIN_ZOOM = 15;

/** The feed has no tunnel metadata; U-Bahn uses a schematic style throughout. */
export function isXrayVehicle(vehicle: TransitVehicle | undefined): boolean {
  return vehicle?.product === "subway";
}

/** Only a followed U-Bahn opens a local window into the city. */
export function createBuildingFocus(map: MapLibreMap) {
  let originalFilter: FilterSpecification | undefined;
  let previousCenter: LngLat | null = null;
  let updatedAt = -Infinity;

  const clear = () => {
    if (!previousCenter) {
      return;
    }
    // A restyle may already have replaced both layers. Never put an old filter
    // back into a new style or access a map after its remove event.
    if (map.getLayer(FOCUS_LAYER_ID)) {
      map.removeLayer(FOCUS_LAYER_ID);
      if (map.getLayer(BUILDING_LAYER_ID)) {
        map.setFilter(BUILDING_LAYER_ID, originalFilter ?? null);
      }
    }
    originalFilter = undefined;
    previousCenter = null;
    updatedAt = -Infinity;
  };

  const update = (center: LngLat | null, time: number) => {
    if (!center || map.getZoom() < FOCUS_MIN_ZOOM) {
      clear();
      return;
    }
    if (
      previousCenter &&
      (time - updatedAt < FOCUS_UPDATE_MS ||
        haversine(previousCenter, center) < FOCUS_MOVE_METRES)
    ) {
      return;
    }
    const building = map
      .getStyle()
      ?.layers.find((layer) => layer.id === BUILDING_LAYER_ID);
    if (building?.type !== "fill-extrusion") {
      return;
    }

    const nearby: ExpressionSpecification = [
      "<",
      ["distance", { type: "Point", coordinates: [...center] }],
      FOCUS_RADIUS_METRES,
    ];
    const installed = Boolean(map.getLayer(FOCUS_LAYER_ID));
    if (!installed) {
      originalFilter = building.filter;
    }
    // buildStyle owns building-3d and uses an expression filter. MapLibre's
    // broader FilterSpecification also accepts legacy filters we never emit.
    const baseFilter = originalFilter as
      | boolean
      | ExpressionSpecification
      | undefined;
    const inside: FilterSpecification = ["all", baseFilter ?? true, nearby];
    if (installed) {
      map.setFilter(FOCUS_LAYER_ID, inside);
    } else {
      // Extrusion opacity is per layer. Split only the nearby footprints into
      // one translucent layer; leave all other buildings and their LOD intact.
      map.addLayer(
        {
          ...building,
          id: FOCUS_LAYER_ID,
          filter: inside,
          paint: { ...building.paint, "fill-extrusion-opacity": 0.24 },
        },
        BUILDING_LAYER_ID
      );
    }
    map.setFilter(BUILDING_LAYER_ID, [
      "all",
      baseFilter ?? true,
      ["!", nearby],
    ]);
    previousCenter = [...center];
    updatedAt = time;
  };

  return { clear, update };
}
