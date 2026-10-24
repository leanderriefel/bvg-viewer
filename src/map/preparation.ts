import type {
  ErrorEvent,
  Map as MapLibreMap,
  VectorTileSource,
} from "maplibre-gl";

import { BERLIN_MAX_BOUNDS } from "@/lib/geo";
import { assertMapLoadingHealthy } from "@/map/loading-health";
import { createRegionTileUrls, preloadRegionTiles } from "@/map/region-preload";
import { SOURCE_ID } from "@/map/sources";
import type { Camera } from "@/map/store";

// Leave time to restore and finish the actual starting viewport. Optional
// prefetch must never consume the budget needed to present a complete scene.
export const MAP_PREPARATION_BUDGET_MS = 27_000;
const RESTORE_BUDGET_MS = 5000;
const POSE_BUDGET_MS = 1800;

export interface PreparationProgress {
  stage: "loading" | "warming" | "ready" | "error";
  completed: number;
  total: number;
  error?: string;
}

export const INITIAL_PREPARATION: PreparationProgress = {
  stage: "loading",
  completed: 0,
  total: 0,
};

export function readMapCamera(map: MapLibreMap): Camera {
  const center = map.getCenter();
  return {
    bearing: map.getBearing(),
    center: [center.lng, center.lat],
    pitch: map.getPitch(),
    zoom: map.getZoom(),
  };
}

/** Warm the same map so decoded tiles, buffers and shaders are reusable. */
export function createWarmupCameras(
  camera: Camera,
  width: number,
  height: number
): Camera[] {
  const worldSize = 512 * 2 ** camera.zoom;
  const longitudeStep = (Math.max(320, width) * 0.45 * 360) / worldSize;
  const latitudeStep =
    (Math.max(320, height) *
      0.45 *
      360 *
      Math.cos((camera.center[1] * Math.PI) / 180)) /
    worldSize;
  const cameras: Camera[] = [
    { ...camera, pitch: 0, zoom: Math.max(11, camera.zoom - 1) },
  ];

  if (camera.pitch > 0) {
    for (const rotation of [45, 90, 135, 180, 225, 270, 315]) {
      cameras.push({ ...camera, bearing: camera.bearing + rotation });
    }
  }

  for (const [x, y] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ]) {
    cameras.push({
      ...camera,
      center: [
        Math.max(
          BERLIN_MAX_BOUNDS[0],
          Math.min(BERLIN_MAX_BOUNDS[2], camera.center[0] + x * longitudeStep)
        ),
        Math.max(
          BERLIN_MAX_BOUNDS[1],
          Math.min(BERLIN_MAX_BOUNDS[3], camera.center[1] + y * latitudeStep)
        ),
      ],
    });
  }
  return cameras;
}

/** Register before moving: the old viewport's loaded() can still be true. */
export function waitForMapIdle(
  map: MapLibreMap,
  signal: AbortSignal,
  timeoutMs: number,
  move?: () => void
): Promise<void> {
  // Event-based APIs need a promise bridge; every exit removes all listeners.
  // oxlint-disable-next-line promise/avoid-new
  return new Promise((resolve, reject) => {
    let rendered = false;
    const finish = (error?: Error) => {
      clearTimeout(timer);
      map.off("render", onRender);
      map.off("idle", onIdle);
      map.off("error", onError);
      signal.removeEventListener("abort", onAbort);
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };
    const onRender = () => {
      rendered = true;
    };
    const onIdle = () => {
      if (rendered && map.loaded() && map.areTilesLoaded()) {
        try {
          assertMapLoadingHealthy(map);
          finish();
        } catch (error) {
          finish(
            error instanceof Error
              ? error
              : new Error("Unable to load map data")
          );
        }
      }
    };
    const onError = (event: ErrorEvent) => {
      finish(
        new Error("Some map data could not load. Please try again.", {
          cause: event.error,
        })
      );
    };
    const onAbort = () =>
      finish(new DOMException("Map preparation cancelled", "AbortError"));
    const timer = setTimeout(
      () => {
        finish(
          new Error("The map is taking longer than expected. Please try again.")
        );
      },
      Math.max(1, timeoutMs)
    );

    if (signal.aborted) {
      onAbort();
      return;
    }
    map.on("render", onRender);
    map.on("idle", onIdle);
    map.on("error", onError);
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      move?.();
      map.triggerRepaint();
    } catch (error) {
      finish(
        error instanceof Error ? error : new Error("Unable to prepare the map")
      );
    }
  });
}

interface PreparationOptions {
  signal: AbortSignal;
  onProgress: (progress: PreparationProgress) => void;
  budgetMs?: number;
  /** Bulk data warming is optional for metered connections. */
  preloadRegion?: boolean;
}

/** Never reveal a temporary warm-up pose, including on deadline or failure. */
export async function prepareMap(
  map: MapLibreMap,
  {
    signal,
    onProgress,
    budgetMs = MAP_PREPARATION_BUDGET_MS,
    preloadRegion = true,
  }: PreparationOptions
): Promise<void> {
  const start = readMapCamera(map);
  const deadline = performance.now() + budgetMs;
  const optionalDeadline = deadline - Math.min(RESTORE_BUDGET_MS, budgetMs / 3);
  onProgress(INITIAL_PREPARATION);
  await waitForMapIdle(map, signal, budgetMs);
  signal.throwIfAborted();

  const container = map.getContainer();
  const cameras = createWarmupCameras(
    start,
    container.clientWidth,
    container.clientHeight
  );
  const source = map.getSource<VectorTileSource>(SOURCE_ID);
  const urls =
    preloadRegion && source?.tiles
      ? createRegionTileUrls(
          source.tiles,
          start.center,
          Math.min(14, source.maxzoom)
        )
      : [];
  let completedViews = 0;
  let completedTiles = 0;
  let lastProgress = 0;
  const total = cameras.length + urls.length + 1;
  const report = () => {
    const now = performance.now();
    if (now - lastProgress < 150) {
      return;
    }
    lastProgress = now;
    onProgress({
      stage: "warming",
      completed: completedViews + completedTiles,
      total,
    });
  };
  onProgress({ stage: "warming", completed: 0, total });
  const prefetch = new AbortController();
  const preloadSignal = AbortSignal.any([signal, prefetch.signal]);
  const timer = setTimeout(
    () => prefetch.abort(),
    Math.max(1, optionalDeadline - performance.now())
  );
  const preload = preloadRegionTiles(urls, {
    signal: preloadSignal,
    onProgress: (completed) => {
      completedTiles = completed;
      report();
    },
  });

  try {
    for (const camera of cameras) {
      signal.throwIfAborted();
      const remaining = optionalDeadline - performance.now();
      if (remaining <= 0) {
        break;
      }
      try {
        // Sequential visits bound GPU/worker pressure; timed-out optional
        // views yield immediately to the next pose and final restoration.
        // oxlint-disable-next-line eslint/no-await-in-loop
        await waitForMapIdle(
          map,
          signal,
          Math.min(POSE_BUDGET_MS, remaining),
          () => map.jumpTo(camera)
        );
      } catch {
        signal.throwIfAborted();
      }
      completedViews += 1;
      report();
    }
    await preload;
  } finally {
    clearTimeout(timer);
    prefetch.abort();
    if (!signal.aborted) {
      await waitForMapIdle(
        map,
        signal,
        Math.max(1, deadline - performance.now()),
        () => map.jumpTo(start)
      );
    }
  }
  signal.throwIfAborted();
  onProgress({ stage: "ready", completed: total, total });
}
