import type { Map as MapLibreMap } from "maplibre-gl";
import { expect, it } from "vite-plus/test";

import {
  assertMapLoadingHealthy,
  trackMapLoadingHealth,
} from "@/map/loading-health";
import { BUILDING_SOURCE_ID, SOURCE_ID } from "@/map/sources";

interface HealthEvent {
  sourceId?: string;
  sourceDataType?: "metadata" | "idle";
  tile?: { uses: number; state: string };
  error?: Error;
}

type Listener = (event: HealthEvent) => void;

class HealthMap {
  listeners = new Map<string, Set<Listener>>();
  sources = new Map([
    [SOURCE_ID, { loaded: () => true, tiles: ["tiles/{z}/{x}/{y}"] }],
    [BUILDING_SOURCE_ID, { loaded: () => true, tiles: ["tiles/{z}/{x}/{y}"] }],
  ]);

  zoom = 14;

  getZoom() {
    return this.zoom;
  }

  getSource(id: string) {
    return this.sources.get(id);
  }

  on(type: string, listener: Listener) {
    const listeners = this.listeners.get(type) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  off(type: string, listener: Listener) {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string, event: HealthEvent = {}) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }

  listenerCount() {
    return [...this.listeners.values()].reduce(
      (total, listeners) => total + listeners.size,
      0
    );
  }
}

function createMap() {
  const fake = new HealthMap();
  // Only the public source and event methods used by the tracker are needed.
  const map: Pick<MapLibreMap, "getZoom"> = fake;
  return { fake, map: map as MapLibreMap };
}

it("rejects an in-view tile that failed before a required idle listener existed", () => {
  const { fake, map } = createMap();
  const cleanup = trackMapLoadingHealth(map);
  const tile = { uses: 1, state: "errored" };
  fake.emit("error", { sourceId: SOURCE_ID, tile });

  expect(() => assertMapLoadingHealthy(map)).toThrow("could not load");
  // Reusing the same failed tile does not emit another error or heal it.
  tile.uses = 2;
  expect(() => assertMapLoadingHealthy(map)).toThrow("could not load");
  cleanup();
});

it.each(["offscreen", "unloaded", "successfully retried"])(
  "allows a required view after the failed tile is %s",
  (recovery) => {
    const { fake, map } = createMap();
    const cleanup = trackMapLoadingHealth(map);
    const tile = { uses: 1, state: "errored" };
    fake.emit("error", { sourceId: BUILDING_SOURCE_ID, tile });

    if (recovery === "offscreen") {
      tile.uses = 0;
    } else {
      tile.state = recovery === "unloaded" ? "unloaded" : "loaded";
    }
    fake.emit("sourcedata", { sourceId: BUILDING_SOURCE_ID, tile });

    expect(() => assertMapLoadingHealthy(map)).not.toThrow();
    cleanup();
  }
);

it("accepts legitimate empty geometry without guessing from queried features", () => {
  const { map } = createMap();
  const cleanup = trackMapLoadingHealth(map);

  expect(() => assertMapLoadingHealthy(map)).not.toThrow();
  cleanup();
});

it("rejects failed metadata even when MapLibre pretends the source is loaded", () => {
  const { fake, map } = createMap();
  const cleanup = trackMapLoadingHealth(map);
  fake.sources.set(SOURCE_ID, { loaded: () => true, tiles: [] });

  expect(() => assertMapLoadingHealthy(map)).toThrow("metadata");
  cleanup();
});

it("rejects a missing required building source", () => {
  const { fake, map } = createMap();
  const cleanup = trackMapLoadingHealth(map);
  fake.sources.delete(BUILDING_SOURCE_ID);

  expect(() => assertMapLoadingHealthy(map)).toThrow("metadata");
  cleanup();
});

it("keeps a metadata error until a metadata retry succeeds", () => {
  const { fake, map } = createMap();
  const cleanup = trackMapLoadingHealth(map);
  fake.emit("error", { sourceId: SOURCE_ID });
  fake.emit("sourcedata", { sourceId: SOURCE_ID, sourceDataType: "idle" });
  expect(() => assertMapLoadingHealthy(map)).toThrow("metadata");

  fake.emit("sourcedata", { sourceId: SOURCE_ID, sourceDataType: "metadata" });

  expect(() => assertMapLoadingHealthy(map)).not.toThrow();
  cleanup();
});

it("does not apply old metadata errors to a replacement source instance", () => {
  const { fake, map } = createMap();
  const cleanup = trackMapLoadingHealth(map);
  fake.emit("error", { sourceId: SOURCE_ID });
  fake.sources.set(SOURCE_ID, {
    loaded: () => true,
    tiles: ["replacement/{z}/{x}/{y}"],
  });

  expect(() => assertMapLoadingHealthy(map)).not.toThrow();
  cleanup();
});

it("keeps source-less errors until a successful style replacement", () => {
  const { fake, map } = createMap();
  const cleanup = trackMapLoadingHealth(map);
  fake.emit("error", { error: new Error("Style invalid") });
  fake.emit("sourcedata", { sourceId: SOURCE_ID, sourceDataType: "metadata" });
  expect(() => assertMapLoadingHealthy(map)).toThrow("could not load");

  fake.emit("style.load");

  expect(() => assertMapLoadingHealthy(map)).not.toThrow();
  cleanup();
});

it("registers once and cleanup removes listeners and stored failures", () => {
  const { fake, map } = createMap();
  const cleanup = trackMapLoadingHealth(map);
  expect(trackMapLoadingHealth(map)).toBe(cleanup);
  expect(fake.listenerCount()).toBe(3);
  fake.emit("error", { tile: { uses: 1, state: "errored" } });

  cleanup();
  cleanup();
  expect(fake.listenerCount()).toBe(0);
  expect(() => assertMapLoadingHealthy(map)).not.toThrow();
  const nextCleanup = trackMapLoadingHealth(map);
  expect(() => assertMapLoadingHealthy(map)).not.toThrow();
  nextCleanup();
});

it("leaves untracked callers responsible for their own health policy", () => {
  const { map } = createMap();

  expect(() => assertMapLoadingHealthy(map)).not.toThrow();
});
