import type { Map as MapLibreMap } from "maplibre-gl";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { BERLIN_MAX_BOUNDS } from "@/lib/geo";
import {
  createWarmupCameras,
  prepareMap,
  waitForMapIdle,
} from "@/map/preparation";
import type { PreparationProgress } from "@/map/preparation";
import { preloadRegionTiles } from "@/map/region-preload";
import type { Camera } from "@/map/store";

vi.mock("@/map/region-preload", () => ({
  createRegionTileUrls: vi.fn(() => ["tile-one", "tile-two"]),
  preloadRegionTiles: vi.fn(async () => {}),
}));

const START: Camera = {
  bearing: -18,
  center: [13.405, 52.52],
  pitch: 55,
  zoom: 14.2,
};

type Listener = (event?: { error: Error }) => void;

class FakeMap {
  camera = structuredClone(START);
  listeners = new Map<string, Set<Listener>>();
  isLoaded = true;
  tilesLoaded = true;
  container = { clientWidth: 1200, clientHeight: 800 };
  source = {
    tiles: ["https://tiles.openfreemap.org/planet/test/{z}/{x}/{y}.pbf"],
    maxzoom: 14,
  };
  onJump?: () => void;
  onRepaint?: () => void;

  jumpTo = vi.fn((camera: Camera) => {
    this.camera = structuredClone(camera);
    this.onJump?.();
  });

  triggerRepaint = vi.fn(() => this.onRepaint?.());

  on(type: string, listener: Listener) {
    const listeners = this.listeners.get(type) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  off(type: string, listener: Listener) {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string, error?: Error) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(error ? { error } : undefined);
    }
  }

  renderIdle() {
    this.emit("render");
    this.emit("idle");
  }

  listenerCount() {
    return [...this.listeners.values()].reduce(
      (count, set) => count + set.size,
      0
    );
  }

  loaded() {
    return this.isLoaded;
  }

  areTilesLoaded() {
    return this.tilesLoaded;
  }

  getCenter() {
    return { lng: this.camera.center[0], lat: this.camera.center[1] };
  }

  getBearing() {
    return this.camera.bearing;
  }

  getPitch() {
    return this.camera.pitch;
  }

  getZoom() {
    return this.camera.zoom;
  }

  getContainer() {
    return this.container;
  }

  getSource() {
    return this.source;
  }
}

function createMap() {
  const fake = new FakeMap();
  // Only the MapLibre methods exercised by preparation are needed here.
  const map: Pick<
    MapLibreMap,
    "areTilesLoaded" | "getBearing" | "getPitch" | "getZoom" | "loaded"
  > = fake;
  return { fake, map: map as MapLibreMap };
}

function isStartingCamera(camera: Camera): boolean {
  return (
    camera.bearing === START.bearing &&
    camera.pitch === START.pitch &&
    camera.zoom === START.zoom &&
    camera.center[0] === START.center[0] &&
    camera.center[1] === START.center[1]
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  vi.mocked(preloadRegionTiles).mockResolvedValue();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

it("installs listeners before moving and requires a new render before a loaded idle", async () => {
  const { fake, map } = createMap();
  const controller = new AbortController();
  const removeAbort = vi.spyOn(controller.signal, "removeEventListener");
  const completed = vi.fn();
  const pending = waitForMapIdle(map, controller.signal, 1000, () => {
    expect(fake.listenerCount()).toBe(3);
    fake.emit("idle");
  }).then(completed);

  await Promise.resolve();
  expect(completed).not.toHaveBeenCalled();
  fake.emit("render");
  fake.isLoaded = false;
  fake.emit("idle");
  fake.isLoaded = true;
  fake.tilesLoaded = false;
  fake.emit("idle");
  await Promise.resolve();
  expect(completed).not.toHaveBeenCalled();
  fake.tilesLoaded = true;
  fake.emit("idle");
  await pending;

  expect(completed).toHaveBeenCalledTimes(1);
  expect(fake.listenerCount()).toBe(0);
  expect(removeAbort).toHaveBeenCalledWith("abort", expect.any(Function));
  expect(vi.getTimerCount()).toBe(0);
});

it.each(["timeout", "abort", "error", "move failure", "already aborted"])(
  "removes map and signal listeners after %s",
  async (failure) => {
    const { fake, map } = createMap();
    const controller = new AbortController();
    const removeAbort = vi.spyOn(controller.signal, "removeEventListener");
    if (failure === "already aborted") {
      controller.abort();
    }
    const pending = waitForMapIdle(map, controller.signal, 100, () => {
      if (failure === "move failure") {
        throw new Error("Camera cannot move");
      }
    });
    const rejected = expect(pending).rejects.toBeInstanceOf(Error);

    if (failure === "timeout") {
      await vi.advanceTimersByTimeAsync(100);
    } else if (failure === "abort") {
      controller.abort();
    } else if (failure === "error") {
      fake.emit("error", new Error("Tile request failed"));
    }
    await rejected;

    expect(fake.listenerCount()).toBe(0);
    expect(removeAbort).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  }
);

it("restores the starting camera before reporting that preparation is ready", async () => {
  const { fake, map } = createMap();
  fake.onRepaint = () => fake.renderIdle();
  const stages: PreparationProgress[] = [];

  await prepareMap(map, {
    signal: new AbortController().signal,
    onProgress: (progress) => {
      if (progress.stage === "ready") {
        expect(fake.camera).toEqual(START);
      }
      stages.push(progress);
    },
  });

  expect(fake.jumpTo.mock.calls.length).toBeGreaterThan(1);
  expect(fake.jumpTo).toHaveBeenLastCalledWith(START);
  expect(stages.at(-1)?.stage).toBe("ready");
  expect(fake.listenerCount()).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

it.each(["timeout", "tile error"])(
  "restores the starting camera when optional poses encounter %s",
  async (failure) => {
    const { fake, map } = createMap();
    fake.onRepaint = () => {
      if (isStartingCamera(fake.camera)) {
        fake.renderIdle();
      } else if (failure === "tile error") {
        fake.emit("error", new Error("Optional tile unavailable"));
      }
    };
    const pending = prepareMap(map, {
      signal: new AbortController().signal,
      budgetMs: 900,
      onProgress: vi.fn(),
    });

    await vi.runAllTimersAsync();
    await pending;

    expect(fake.jumpTo).toHaveBeenLastCalledWith(START);
    expect(fake.camera).toEqual(START);
    expect(fake.listenerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  }
);

it.each(["external cancellation", "map removal"])(
  "does not restore a camera after %s aborts preparation",
  async () => {
    const { fake, map } = createMap();
    const controller = new AbortController();
    fake.onRepaint = () => {
      if (fake.jumpTo.mock.calls.length === 0) {
        fake.renderIdle();
      }
    };
    // The map lifecycle aborts this same signal before removing its map.
    fake.onJump = () => controller.abort();
    const pending = prepareMap(map, {
      signal: controller.signal,
      onProgress: vi.fn(),
    });

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });

    expect(fake.jumpTo).toHaveBeenCalledTimes(1);
    expect(isStartingCamera(fake.camera)).toBe(false);
    expect(fake.listenerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  }
);

it("restores the starting camera before propagating an optional prefetch failure", async () => {
  const { fake, map } = createMap();
  fake.onRepaint = () => fake.renderIdle();
  vi.mocked(preloadRegionTiles).mockRejectedValue(new Error("Prefetch failed"));

  await expect(
    prepareMap(map, {
      signal: new AbortController().signal,
      onProgress: vi.fn(),
    })
  ).rejects.toThrow("Prefetch failed");

  expect(fake.jumpTo).toHaveBeenLastCalledWith(START);
  expect(fake.camera).toEqual(START);
  expect(fake.listenerCount()).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

it("reserves restoration time when optional prefetch and poses exhaust their budget", async () => {
  const { fake, map } = createMap();
  const controller = new AbortController();
  let preloadSignal: AbortSignal | undefined;
  vi.mocked(preloadRegionTiles).mockImplementation((_urls, { signal }) => {
    preloadSignal = signal;
    // Event-based cancellation needs a promise bridge, just like MapLibre.
    // oxlint-disable-next-line promise/avoid-new
    return new Promise<void>((resolve) => {
      signal.addEventListener("abort", () => resolve(), { once: true });
    });
  });
  fake.onRepaint = () => {
    if (fake.jumpTo.mock.calls.length === 0) {
      fake.renderIdle();
    }
  };
  const start = performance.now();
  const pending = prepareMap(map, {
    signal: controller.signal,
    budgetMs: 900,
    onProgress: vi.fn(),
  });
  const rejected = expect(pending).rejects.toThrow("taking longer");

  await vi.advanceTimersByTimeAsync(599);
  expect(preloadSignal?.aborted).toBe(false);
  expect(fake.jumpTo).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(preloadSignal?.aborted).toBe(true);
  expect(fake.jumpTo).toHaveBeenLastCalledWith(START);
  await vi.advanceTimersByTimeAsync(300);
  await rejected;

  expect(performance.now() - start).toBe(900);
  expect(fake.camera).toEqual(START);
  expect(fake.listenerCount()).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

it("clamps warmup cameras to Berlin even at map edges and large viewport sizes", () => {
  const [west, south, east, north] = BERLIN_MAX_BOUNDS;
  for (const center of [
    [west, south],
    [west, north],
    [east, south],
    [east, north],
  ]) {
    const camera: Camera = {
      ...START,
      center: [center[0], center[1]],
      zoom: 11,
    };
    const poses = createWarmupCameras(camera, 20_000, 20_000);

    expect(poses.length).toBeLessThanOrEqual(16);
    for (const pose of poses) {
      expect(pose.center[0]).toBeGreaterThanOrEqual(west);
      expect(pose.center[0]).toBeLessThanOrEqual(east);
      expect(pose.center[1]).toBeGreaterThanOrEqual(south);
      expect(pose.center[1]).toBeLessThanOrEqual(north);
    }
  }
});

it("keeps flat views flat and avoids rotation warmup", () => {
  const poses = createWarmupCameras({ ...START, pitch: 0 }, 1200, 800);

  expect(poses).toHaveLength(9);
  for (const pose of poses) {
    expect(pose.pitch).toBe(0);
    expect(pose.bearing).toBe(START.bearing);
  }
});
