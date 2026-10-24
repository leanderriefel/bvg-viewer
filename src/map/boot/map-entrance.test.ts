import type {
  EaseToOptions,
  JumpToOptions,
  Map as MapLibreMap,
} from "maplibre-gl";
import { expect, it, vi } from "vite-plus/test";

import { startMapEntrance } from "./map-entrance";

const DEFAULT_CAMERA = { zoom: 16, pitch: 60, bearing: 35 };

function createMap(camera = DEFAULT_CAMERA) {
  const listeners = new Map<string, () => void>();
  const emit = (event: string) => {
    const listener = listeners.get(event);
    listeners.delete(event);
    listener?.();
  };
  const model = {
    getCenter: vi.fn(() => ({ lng: 13.401, lat: 52.512 })),
    getZoom: vi.fn(() => camera.zoom),
    getPitch: vi.fn(() => camera.pitch),
    getBearing: vi.fn(() => camera.bearing),
    getMinZoom: vi.fn(() => 11),
    jumpTo: vi.fn((_options: JumpToOptions) => emit("moveend")),
    easeTo: vi.fn<(options: EaseToOptions) => void>(),
    once: vi.fn((event: string, listener: () => void) => {
      listeners.set(event, listener);
    }),
    off: vi.fn((event: string, listener: () => void) => {
      if (listeners.get(event) === listener) {
        listeners.delete(event);
      }
    }),
    stop: vi.fn(() => emit("moveend")),
  };
  // Only the camera and event methods used by the entrance need a fake.
  // eslint-disable-next-line anti-slop/no-chained-type-assertions
  const map = model as unknown as MapLibreMap;
  return { emit, listeners, map, model };
}

it("descends to the exact loaded camera and listens only after the starting jump", () => {
  const { map, model } = createMap();
  const onComplete = vi.fn();
  const cleanup = startMapEntrance(map, false, onComplete);

  expect(model.jumpTo).toHaveBeenCalledWith({
    center: [13.401, 52.512],
    zoom: 14.8,
    pitch: 28,
    bearing: 25,
  });
  const [[flight]] = model.easeTo.mock.calls;
  expect(flight).toMatchObject({
    center: [13.401, 52.512],
    zoom: 16,
    pitch: 60,
    bearing: 35,
    duration: 2400,
  });
  expect(flight).not.toHaveProperty("essential");
  expect(flight.easing?.(0)).toBe(0);
  expect(flight.easing?.(0.5)).toBe(0.5);
  expect(flight.easing?.(1)).toBe(1);
  expect(onComplete).not.toHaveBeenCalled();

  cleanup();
});

it("clamps the starting zoom and preserves a flat camera's bearing and pitch", () => {
  const { map, model } = createMap({ zoom: 11.4, pitch: 0, bearing: -80 });
  const cleanup = startMapEntrance(map, false, vi.fn());

  expect(model.jumpTo).toHaveBeenCalledWith({
    center: [13.401, 52.512],
    zoom: 11,
    pitch: 0,
    bearing: -80,
  });
  expect(model.easeTo).toHaveBeenCalledWith(
    expect.objectContaining({ zoom: 11.4, pitch: 0, bearing: -80 })
  );
  cleanup();
});

it("completes reduced-motion entry immediately without changing or observing the map", () => {
  const { map, model } = createMap();
  const onComplete = vi.fn();
  const cleanup = startMapEntrance(map, true, onComplete);

  expect(onComplete).toHaveBeenCalledOnce();
  expect(model.getCenter).not.toHaveBeenCalled();
  expect(model.once).not.toHaveBeenCalled();
  expect(model.jumpTo).not.toHaveBeenCalled();
  expect(model.easeTo).not.toHaveBeenCalled();
  cleanup();
  expect(model.stop).not.toHaveBeenCalled();
});

it("completes once on moveend and leaves the finished camera untouched during cleanup", () => {
  const { emit, map, model } = createMap();
  const onComplete = vi.fn();
  const cleanup = startMapEntrance(map, false, onComplete);

  emit("moveend");
  emit("moveend");
  cleanup();

  expect(onComplete).toHaveBeenCalledOnce();
  expect(model.stop).not.toHaveBeenCalled();
  expect(model.jumpTo).toHaveBeenCalledOnce();
});

it("finishes when another map action interrupts the entrance", () => {
  const { map, model } = createMap();
  const onComplete = vi.fn();
  const cleanup = startMapEntrance(map, false, onComplete);

  model.stop();
  expect(onComplete).toHaveBeenCalledOnce();
  cleanup();
  expect(model.stop).toHaveBeenCalledOnce();
  expect(model.jumpTo).toHaveBeenCalledOnce();
});

it("cancels without completion and restores the destination before a reconstructed entrance", () => {
  const { listeners, map, model } = createMap();
  const onComplete = vi.fn();
  const cleanup = startMapEntrance(map, false, onComplete);

  cleanup();
  cleanup();

  expect(model.stop).toHaveBeenCalledOnce();
  expect(model.jumpTo).toHaveBeenLastCalledWith({
    center: [13.401, 52.512],
    zoom: 16,
    pitch: 60,
    bearing: 35,
  });
  expect(onComplete).not.toHaveBeenCalled();
  expect(listeners.size).toBe(0);
});

it("avoids touching a map removed before entrance cleanup", () => {
  const { emit, listeners, map, model } = createMap();
  const onComplete = vi.fn();
  const cleanup = startMapEntrance(map, false, onComplete);

  emit("remove");
  cleanup();

  expect(model.stop).not.toHaveBeenCalled();
  expect(model.jumpTo).toHaveBeenCalledOnce();
  expect(onComplete).not.toHaveBeenCalled();
  expect(listeners.size).toBe(0);
});
