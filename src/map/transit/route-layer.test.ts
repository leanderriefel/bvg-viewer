import type { Map as MapLibreMap } from "maplibre-gl";
import { expect, it, vi } from "vite-plus/test";

import { bindTransitRoute } from "./route-layer";

function mapSurface() {
  const sources = new Map<string, { setData: ReturnType<typeof vi.fn> }>();
  const layers = new Set<string>();
  const listeners = new Map<string, Set<() => void>>();
  const surface = {
    getStyle: vi.fn(() => ({ version: 8 })),
    isStyleLoaded: vi.fn(() => false),
    getSource: (id: string) => sources.get(id),
    addSource: (id: string) => {
      sources.set(id, { setData: vi.fn() });
    },
    removeSource: (id: string) => sources.delete(id),
    getLayer: (id: string) => layers.has(id),
    addLayer: (layer: { id: string }) => {
      layers.add(layer.id);
    },
    removeLayer: (id: string) => layers.delete(id),
    setPaintProperty: vi.fn(),
    on: (event: string, listener: () => void) => {
      const registered = listeners.get(event) ?? new Set<() => void>();
      registered.add(listener);
      listeners.set(event, registered);
    },
    off: (event: string, listener: () => void) => {
      listeners.get(event)?.delete(listener);
    },
  };
  return {
    surface,
    sources,
    layers,
    listeners,
    // This test double implements the public style/source/event methods used by
    // the binding. Rendering and camera internals are intentionally absent.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- A partial public-method test double cannot implement unrelated WebGL internals.
    map: surface as unknown as MapLibreMap,
    emit: (event: string) => {
      for (const listener of listeners.get(event) ?? []) {
        listener();
      }
    },
  };
}

it("installs the route while camera tiles are loading after the initial style event", () => {
  const { map, sources, layers, surface } = mapSurface();
  const unbind = bindTransitRoute(map);
  try {
    expect(surface.isStyleLoaded()).toBe(false);
    expect(sources.has("live-transit-route")).toBe(true);
    expect(layers.has("live-transit-route-line")).toBe(true);
  } finally {
    unbind();
  }
});

it("restores route layers after a restyle and removes subscriptions on disposal", () => {
  const { map, sources, layers, listeners, emit } = mapSurface();
  const unbind = bindTransitRoute(map);
  sources.clear();
  layers.clear();
  emit("style.load");
  expect(sources.has("live-transit-route")).toBe(true);
  expect(layers.size).toBe(3);
  unbind();
  expect(sources.size).toBe(0);
  expect(layers.size).toBe(0);
  expect(listeners.get("style.load")?.size).toBe(0);
  expect(listeners.get("remove")?.size).toBe(0);
});
