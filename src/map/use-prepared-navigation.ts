import type { Map as MapLibreMap } from "maplibre-gl";
import { useCallback, useEffect, useState } from "react";

import { DEFAULT_CAMERA } from "@/lib/geo";
import type { FlyTarget } from "@/map/map-context";
import { INITIAL_PREPARATION, waitForMapIdle } from "@/map/preparation";
import type { PreparationProgress } from "@/map/preparation";
import { useMapStore } from "@/map/store";
import type { Camera } from "@/map/store";
import type { ViewMode } from "@/map/theme/build-style";

const DESTINATION_BUDGET_MS = 8000;

interface NavigationRequest {
  map: MapLibreMap;
  camera: Camera;
}

interface NavigationResult {
  request: NavigationRequest;
  progress: PreparationProgress | null;
}

export function destinationCamera(target: FlyTarget, view: ViewMode): Camera {
  const flat = view === "flat";
  return {
    bearing: flat ? 0 : (target.bearing ?? 0),
    center: [target.center[0], target.center[1]],
    pitch: flat ? 0 : (target.pitch ?? DEFAULT_CAMERA.pitch),
    zoom: target.zoom ?? 16.5,
  };
}

/** The caller commits its loading cover before invoking this operation. */
export async function prepareNavigationDestination(
  map: MapLibreMap,
  camera: Camera,
  signal: AbortSignal
): Promise<void> {
  await waitForMapIdle(map, signal, DESTINATION_BUDGET_MS, () =>
    map.jumpTo(camera)
  );
  signal.throwIfAborted();
}

/** Reveal a complete destination instead of animating through unloaded tiles. */
export function usePreparedNavigation(
  map: MapLibreMap | null,
  startupReady: boolean
): {
  flyTo: (target: FlyTarget) => void;
  jumpTo: (target: FlyTarget) => void;
  progress: PreparationProgress | null;
  busy: boolean;
} {
  const [request, setRequest] = useState<NavigationRequest | null>(null);
  const [result, setResult] = useState<NavigationResult | null>(null);
  const active = startupReady && request?.map === map ? request : null;
  let progress: PreparationProgress | null = null;
  if (active) {
    progress =
      result?.request === active ? result.progress : INITIAL_PREPARATION;
  }

  const navigate = useCallback(
    (target: FlyTarget) => {
      if (!(map && startupReady)) {
        return;
      }
      setRequest({
        map,
        camera: destinationCamera(target, useMapStore.getState().view),
      });
    },
    [map, startupReady]
  );

  // Request state makes busy true during render. The cover is committed and
  // camera-sync cleanup runs before this effect moves the map.
  useEffect(() => {
    if (!active) {
      return;
    }
    const controller = new AbortController();
    const run = async () => {
      try {
        await prepareNavigationDestination(
          active.map,
          active.camera,
          controller.signal
        );
        if (!controller.signal.aborted) {
          setResult({ request: active, progress: null });
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setResult({
            request: active,
            progress: {
              ...INITIAL_PREPARATION,
              stage: "error",
              error:
                error instanceof Error
                  ? error.message
                  : "Unable to load this destination. Please try again.",
            },
          });
        }
      }
    };
    void run();
    return () => controller.abort();
  }, [active]);

  return {
    flyTo: navigate,
    jumpTo: navigate,
    progress,
    busy: progress !== null,
  };
}
