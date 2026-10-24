import type { Map as MapLibreMap, MapMovementEvent } from "maplibre-gl";

import { haversine } from "@/lib/geo";
import { createResizeMovementGuard } from "@/map/camera-movement";
import { LANDMARKS_BY_ID } from "@/map/landmarks";
import type { Landmark } from "@/map/landmarks";
import { useMapStore } from "@/map/store";
import { PRODUCT_LABELS } from "@/map/transit/model";
import type { TransitVehicle } from "@/map/transit/model";
import { sampleVehicle } from "@/map/transit/motion";
import type { TransitPose } from "@/map/transit/motion";
import { displayTransitLine } from "@/map/transit/network";
import { useTransitStore } from "@/map/transit/store";
import { destinationCamera } from "@/map/use-prepared-navigation";

const FLIGHT_MS = 3200;
const LANDMARK_MS = 6000;
const VEHICLE_MS = 12_000;
const VEHICLE_RADIUS_METRES = 5000;
const TOUR_EVENT = { berlinTour: true };
const CAMERA_EVENTS = [
  "movestart",
  "dragstart",
  "zoomstart",
  "rotatestart",
  "pitchstart",
] as const;

interface TourStop {
  kind: "landmark" | "vehicle";
  landmark: Landmark;
}

// Resolve the existing curation, including its camera framing and captions.
export const BERLIN_TOUR_STOPS: TourStop[] = [
  "brandenburger-tor",
  "reichstag",
  "berliner-dom",
  "fernsehturm",
  "east-side-gallery",
  "oberbaumbruecke",
  "circuit",
].flatMap((id, index): TourStop[] => {
  const landmark = LANDMARKS_BY_ID.get(id);
  if (!landmark) {
    return [];
  }
  const stop: TourStop = { kind: "landmark", landmark };
  return index % 2 === 1 ? [stop, { kind: "vehicle", landmark }] : [stop];
});

export interface TourCaption {
  kind: "landmark" | "vehicle";
  title: string;
  description: string;
  location: string | null;
}

export interface BerlinTourState {
  status: "playing" | "paused";
  step: number;
  total: number;
  caption: TourCaption;
}

export interface BerlinTourControls {
  start: () => void;
  pause: () => void;
  resume: () => void;
  exit: () => void;
}

type TransitState = ReturnType<typeof useTransitStore.getState>;
type Scene = TourStop & { vehicle: TransitVehicle | null };

function vehicleAvailable(
  vehicle: TransitVehicle,
  transit: TransitState,
  now: number,
  pose?: TransitPose
): boolean {
  return Boolean(
    transit.mode === "live" &&
    transit.enabled &&
    transit.snapshot?.status !== "offline" &&
    transit.filters[vehicle.product] &&
    (vehicle.frames.at(-1)?.at ?? 0) > now &&
    sampleVehicle(vehicle, now, pose)
  );
}

/** Only follow a fresh, visible vehicle with an unexpired movement forecast. */
export function nearbyTourVehicle(
  landmark: Landmark,
  transit: TransitState,
  now: number
): TransitVehicle | null {
  let nearest: TransitVehicle | null = null;
  let nearestDistance = VEHICLE_RADIUS_METRES;
  const pose: TransitPose = { coordinates: [0, 0], bearing: 0 };
  for (const vehicle of transit.snapshot?.vehicles ?? []) {
    if (!vehicleAvailable(vehicle, transit, now, pose)) {
      continue;
    }
    const distance = haversine(landmark.center, pose.coordinates);
    if (distance < nearestDistance) {
      nearest = vehicle;
      nearestDistance = distance;
    }
  }
  return nearest;
}

function captionFor(scene: Scene): TourCaption {
  const { landmark, vehicle } = scene;
  if (!vehicle) {
    return {
      kind: "landmark",
      title: landmark.name,
      description: landmark.hint,
      location: null,
    };
  }
  return {
    kind: "vehicle",
    title: `${PRODUCT_LABELS[vehicle.product]} ${displayTransitLine(vehicle)}`,
    description: `Toward ${vehicle.direction.replace(/\s*\(Berlin\)$/u, "")}`,
    location: vehicle.nextStop
      ? `Next: ${vehicle.nextStop.replace(/\s*\(Berlin\)$/u, "")}`
      : `Near ${landmark.name}`,
  };
}

/** Owns only tour timers, flights and vehicle tracking; user navigation wins. */
export function createBerlinTour(
  map: MapLibreMap,
  onChange: (state: BerlinTourState | null) => void,
  reducedMotion: boolean
): BerlinTourControls & { dispose: () => void } {
  const isResizeMovement = createResizeMovementGuard(map);
  let status: "idle" | "playing" | "paused" = "idle";
  let scene: Scene | null = null;
  let index = -1;
  let phase: "travel" | "dwell" = "travel";
  let remainingMs = 0;
  let deadline = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let flightTimer: ReturnType<typeof setTimeout> | undefined;
  let followedId: string | null = null;
  let disposed = false;
  let removed = false;

  function publish() {
    onChange(
      status === "idle" || !scene
        ? null
        : {
            status,
            step: index + 1,
            total: BERLIN_TOUR_STOPS.length,
            caption: captionFor(scene),
          }
    );
  }

  function clearPending() {
    clearTimeout(timer);
    clearTimeout(flightTimer);
    map.off("moveend", arrive);
  }

  function releaseVehicle() {
    const ownedId = followedId;
    followedId = null;
    const transit = useTransitStore.getState();
    if (ownedId && transit.followedId === ownedId) {
      transit.stopFollowing();
    }
    if (ownedId && useTransitStore.getState().selectedId === ownedId) {
      transit.selectVehicle(null);
    }
  }

  function finish(stopCamera: boolean) {
    const wasActive = status !== "idle";
    status = "idle";
    scene = null;
    clearPending();
    releaseVehicle();
    if (wasActive && stopCamera && !removed) {
      map.stop();
    }
    if (wasActive) {
      publish();
    }
  }

  function schedule() {
    deadline = Date.now() + remainingMs;
    timer = setTimeout(advance, remainingMs);
  }

  function currentVehicle(): TransitVehicle | null {
    const transit = useTransitStore.getState();
    const vehicle = transit.snapshot?.vehicles.find(
      (candidate) => candidate.id === scene?.vehicle?.id
    );
    return vehicle && vehicleAvailable(vehicle, transit, Date.now())
      ? vehicle
      : null;
  }

  function follow() {
    const vehicle = currentVehicle();
    if (!vehicle) {
      advance();
      return;
    }
    followedId = vehicle.id;
    useTransitStore.getState().followVehicle(vehicle.id);
    schedule();
  }

  function arrive() {
    if (status !== "playing" || !scene) {
      return;
    }
    clearPending();
    phase = "dwell";
    if (scene.vehicle) {
      follow();
    } else {
      schedule();
    }
  }

  function travel() {
    if (!scene || removed) {
      return;
    }
    const vehicle = scene.vehicle ? currentVehicle() : null;
    if (scene.vehicle && !vehicle) {
      advance();
      return;
    }
    const pose = vehicle && sampleVehicle(vehicle, Date.now());
    const target = pose
      ? {
          center: pose.coordinates,
          zoom: 16.2,
          pitch: 58,
          bearing: pose.bearing,
        }
      : scene.landmark;
    map.on("moveend", arrive);
    // A background tab can suspend camera frames. Keep the itinerary bounded.
    flightTimer = setTimeout(arrive, reducedMotion ? 0 : FLIGHT_MS + 250);
    map.flyTo(
      {
        ...destinationCamera(target, useMapStore.getState().view),
        duration: reducedMotion ? 0 : FLIGHT_MS,
      },
      TOUR_EVENT
    );
  }

  function advance() {
    clearPending();
    scene = null;
    releaseVehicle();
    if (removed || disposed || status !== "playing") {
      return;
    }
    map.stop();
    while (index + 1 < BERLIN_TOUR_STOPS.length) {
      index += 1;
      const stop = BERLIN_TOUR_STOPS[index];
      const vehicle =
        stop.kind === "vehicle"
          ? nearbyTourVehicle(
              stop.landmark,
              useTransitStore.getState(),
              Date.now()
            )
          : null;
      if (stop.kind === "vehicle" && !vehicle) {
        continue;
      }
      scene = { ...stop, vehicle };
      phase = "travel";
      remainingMs = vehicle ? VEHICLE_MS : LANDMARK_MS;
      publish();
      travel();
      return;
    }
    finish(true);
  }

  function onCameraMove(event: MapMovementEvent) {
    if (isResizeMovement(event)) {
      return;
    }
    if (
      status === "idle" ||
      ("berlinTour" in event && event.berlinTour === true) ||
      (phase === "dwell" &&
        followedId &&
        "transitFollowing" in event &&
        event.transitFollowing === true)
    ) {
      return;
    }
    // Leave the user's new camera operation running.
    finish(false);
  }

  function onRemove() {
    removed = true;
    dispose();
  }

  const unsubscribe = useTransitStore.subscribe((transit) => {
    if (status !== "playing" || !scene?.vehicle) {
      return;
    }
    const vehicle = currentVehicle();
    if (!vehicle) {
      advance();
    } else if (followedId && transit.followedId !== followedId) {
      finish(false);
    } else if (scene.vehicle !== vehicle) {
      scene = { ...scene, vehicle };
      publish();
    }
  });

  function dispose() {
    if (disposed) {
      return;
    }
    disposed = true;
    finish(true);
    unsubscribe();
    for (const event of CAMERA_EVENTS) {
      map.off(event, onCameraMove);
    }
    map.off("remove", onRemove);
  }

  for (const event of CAMERA_EVENTS) {
    map.on(event, onCameraMove);
  }
  map.on("remove", onRemove);

  return {
    start() {
      if (disposed || status !== "idle") {
        return;
      }
      if (useTransitStore.getState().mode === "replay") {
        useTransitStore.getState().backToLive();
      }
      useTransitStore.getState().stopFollowing();
      useMapStore.getState().setSelection(null);
      useMapStore.getState().setMarker(null);
      status = "playing";
      index = -1;
      advance();
    },
    pause() {
      if (status !== "playing") {
        return;
      }
      status = "paused";
      if (phase === "dwell") {
        remainingMs = Math.max(0, deadline - Date.now());
      }
      clearPending();
      releaseVehicle();
      map.stop();
      publish();
    },
    resume() {
      if (status !== "paused" || disposed) {
        return;
      }
      status = "playing";
      publish();
      if (phase === "travel") {
        travel();
      } else if (scene?.vehicle) {
        follow();
      } else {
        schedule();
      }
    },
    exit: () => finish(true),
    dispose,
  };
}
