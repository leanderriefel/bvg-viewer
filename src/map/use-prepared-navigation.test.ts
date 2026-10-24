import type { Map as MapLibreMap } from "maplibre-gl";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { DEFAULT_CAMERA } from "@/lib/geo";
import type { Camera } from "@/map/store";
import {
  destinationCamera,
  prepareNavigationDestination,
} from "@/map/use-prepared-navigation";

type Listener = (event?: { error: Error }) => void;

class DestinationMap {
  listeners = new Map<string, Set<Listener>>();
  loaded = vi.fn(() => true);
  areTilesLoaded = vi.fn(() => true);
  triggerRepaint = vi.fn();
  jumpTo = vi.fn((_camera: Camera) => {});

  on(type: string, listener: Listener) {
    const listeners = this.listeners.get(type) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  off(type: string, listener: Listener) {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string, event?: { error: Error }) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }

  idle() {
    this.emit("render");
    this.emit("idle");
  }

  listenerCount() {
    return [...this.listeners.values()].reduce(
      (total, listeners) => total + listeners.size,
      0
    );
  }
}

function createMap() {
  const fake = new DestinationMap();
  // The fixture supplies exactly the public MapLibre API used by navigation.
  const map: Pick<MapLibreMap, "loaded" | "areTilesLoaded"> = fake;
  return { fake, map: map as MapLibreMap };
}

const TARGET: Camera = {
  bearing: 90,
  center: [13.2, 52.5],
  pitch: 65,
  zoom: 16,
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("uses navigation defaults without retaining the caller's coordinate array", () => {
  const center: [number, number] = [13.4, 52.5];
  const camera = destinationCamera({ center }, "perspective");
  center[0] = 14;

  expect(camera).toEqual({
    bearing: 0,
    center: [13.4, 52.5],
    pitch: DEFAULT_CAMERA.pitch,
    zoom: 16.5,
  });
});

it("honors explicit perspective camera values and keeps flat navigation flat", () => {
  expect(destinationCamera(TARGET, "perspective")).toEqual(TARGET);
  expect(destinationCamera(TARGET, "flat")).toEqual({
    ...TARGET,
    bearing: 0,
    pitch: 0,
  });
});

it("jumps once with listeners attached and waits for the target to render", async () => {
  const { fake, map } = createMap();
  fake.jumpTo.mockImplementation(() => {
    expect(fake.listenerCount()).toBe(3);
    fake.emit("idle");
  });
  const completed = vi.fn();
  const navigation = prepareNavigationDestination(
    map,
    TARGET,
    new AbortController().signal
  ).then(completed);
  await Promise.resolve();
  expect(completed).not.toHaveBeenCalled();

  fake.idle();
  await navigation;

  expect(fake.jumpTo).toHaveBeenCalledExactlyOnceWith(TARGET);
  expect(fake.listenerCount()).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

it("keeps waiting when the new viewport still has outstanding tiles", async () => {
  const { fake, map } = createMap();
  fake.areTilesLoaded.mockReturnValue(false);
  const completed = vi.fn();
  const navigation = prepareNavigationDestination(
    map,
    TARGET,
    new AbortController().signal
  ).then(completed);
  fake.idle();
  await Promise.resolve();
  expect(completed).not.toHaveBeenCalled();

  fake.areTilesLoaded.mockReturnValue(true);
  fake.idle();
  await navigation;
  expect(completed).toHaveBeenCalledOnce();
});

it("rejects tile errors instead of revealing a falsely loaded destination", async () => {
  const { fake, map } = createMap();
  const navigation = prepareNavigationDestination(
    map,
    TARGET,
    new AbortController().signal
  );
  const rejected = expect(navigation).rejects.toThrow("could not load");

  fake.emit("error", { error: new Error("Tile request failed") });
  fake.idle();
  await rejected;
  expect(fake.listenerCount()).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

it("bounds a destination wait to eight seconds", async () => {
  const { fake, map } = createMap();
  const navigation = prepareNavigationDestination(
    map,
    TARGET,
    new AbortController().signal
  );
  const rejected = expect(navigation).rejects.toThrow("taking longer");

  await vi.advanceTimersByTimeAsync(8000);
  await rejected;
  expect(fake.listenerCount()).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

it("never jumps when a replaced request was already aborted", async () => {
  const { fake, map } = createMap();

  await expect(
    prepareNavigationDestination(map, TARGET, AbortSignal.abort())
  ).rejects.toMatchObject({ name: "AbortError" });

  expect(fake.jumpTo).not.toHaveBeenCalled();
  expect(fake.listenerCount()).toBe(0);
});

it("cancels an old wait without reverting or settling the newer destination", async () => {
  const { fake, map } = createMap();
  const oldController = new AbortController();
  const old = prepareNavigationDestination(map, TARGET, oldController.signal);
  const rejected = expect(old).rejects.toMatchObject({ name: "AbortError" });
  oldController.abort();
  const next = { ...TARGET, center: [13.6, 52.4] as [number, number] };
  const current = prepareNavigationDestination(
    map,
    next,
    new AbortController().signal
  );

  fake.idle();
  await rejected;
  await current;

  expect(fake.jumpTo).toHaveBeenCalledTimes(2);
  expect(fake.jumpTo).toHaveBeenLastCalledWith(next);
  expect(fake.listenerCount()).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});
