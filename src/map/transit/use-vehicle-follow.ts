import type { Map as MapLibreMap, MapMovementEvent } from "maplibre-gl";
import { useEffect } from "react";

import { haversine } from "@/lib/geo";
import { sampleVehicle } from "@/map/transit/motion";
import type { TransitPose } from "@/map/transit/motion";
import { useTransitStore } from "@/map/transit/store";

const FOLLOW_EASE_ID = "transit-follow";
const CAMERA_INTERVAL_MS = 100;
const linear = (value: number) => value;

/** Acquire a useful close view, then preserve orientation while following. */
export function useVehicleFollow(
  map: MapLibreMap | null,
  ready: boolean
): void {
  useEffect(() => {
    if (!(map && ready)) {
      if (map) {
        // Destination preparation deliberately owns the camera while covered.
        // Do not reacquire an old vehicle when navigation reveals its result.
        useTransitStore.getState().stopFollowing();
      }
      return;
    }

    const pose: TransitPose = { coordinates: [0, 0], bearing: 0 };
    const previousTarget: [number, number] = [0, 0];
    const offset: [number, number] = [0, 0];
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let animationFrame = 0;
    let lastFrame = -Infinity;
    let acquiringUntil = 0;
    let following: string | null = null;
    let removed = false;

    const stopForGesture = (event: MapMovementEvent) => {
      if ("transitFollowing" in event && event.transitFollowing === true) {
        return;
      }
      // Gestures and explicit map controls take priority over tracking. The
      // initial camera acquisition marks its own zoom event to avoid stopping itself.
      following = null;
      useTransitStore.getState().stopFollowing();
    };
    const onRemove = () => {
      removed = true;
      cancelAnimationFrame(animationFrame);
    };
    map.on("dragstart", stopForGesture);
    map.on("zoomstart", stopForGesture);
    map.on("rotatestart", stopForGesture);
    map.on("pitchstart", stopForGesture);
    map.on("remove", onRemove);

    const animate = (time: number) => {
      if (removed) {
        return;
      }
      animationFrame = requestAnimationFrame(animate);
      if (document.hidden || time - lastFrame < CAMERA_INTERVAL_MS) {
        return;
      }
      lastFrame = time;
      const state = useTransitStore.getState();
      const id = state.followedId;
      if (!id || !state.enabled) {
        if (following) {
          map.stop();
        }
        following = null;
        return;
      }
      const vehicle = state.snapshot?.vehicles.find(
        (candidate) => candidate.id === id
      );
      // A snapshot can be loading at a replay boundary. Keep the follow target until it arrives.
      if (state.mode === "replay" && state.replayStatus === "loading") {
        return;
      }
      const position = vehicle && sampleVehicle(vehicle, state.clockTime, pose);
      if (!position) {
        state.stopFollowing();
        return;
      }
      const initial = following !== id;
      if (initial) {
        following = id;
        acquiringUntil = time + 800;
      } else if (time < acquiringUntil) {
        return;
      }
      if (!initial && haversine(previousTarget, position.coordinates) < 0.25) {
        return;
      }
      // Reusing easeId avoids per-tick moveend/start events while the previous
      // transition is still active, keeping camera/store updates off the hot path.
      const canvas = map.getCanvas();
      offset[0] =
        canvas.clientWidth >= 640
          ? -Math.min(180, canvas.clientWidth * 0.25)
          : 0;
      offset[1] = canvas.clientWidth < 640 ? -canvas.clientHeight * 0.2 : 0;
      map.easeTo(
        {
          center: position.coordinates,
          zoom: initial ? Math.max(map.getZoom(), 15.5) : undefined,
          offset,
          duration: initial ? 800 : 180,
          easeId: FOLLOW_EASE_ID,
          easing: linear,
          essential: !reducedMotion.matches,
        },
        { transitFollowing: true }
      );
      [previousTarget[0], previousTarget[1]] = position.coordinates;
    };
    animationFrame = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animationFrame);
      map.off("dragstart", stopForGesture);
      map.off("zoomstart", stopForGesture);
      map.off("rotatestart", stopForGesture);
      map.off("pitchstart", stopForGesture);
      map.off("remove", onRemove);
      if (!removed && following) {
        map.stop();
      }
    };
  }, [map, ready]);
}
