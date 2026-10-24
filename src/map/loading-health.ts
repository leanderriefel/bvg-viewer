import type {
  ErrorEvent,
  Map as MapLibreMap,
  MapSourceDataEvent,
  Source,
  VectorTileSource,
} from "maplibre-gl";

import { BUILDING_SOURCE_ID, SOURCE_ID } from "@/map/sources";

/** Public Tile fields remain live as MapLibre retries or removes that tile. */
interface FailedTile {
  uses: number;
  state: string;
}

interface LoadingHealth {
  failedTiles: Set<FailedTile>;
  sourceErrors: Map<string, Source | undefined>;
  globalError: boolean;
  cleanup: () => void;
}

const healthByMap = new WeakMap<MapLibreMap, LoadingHealth>();

function tileFromError(event: ErrorEvent): FailedTile | null {
  if (!(typeof event === "object" && event && "tile" in event)) {
    return null;
  }
  const { tile } = event;
  if (
    typeof tile === "object" &&
    tile &&
    "uses" in tile &&
    typeof tile.uses === "number" &&
    "state" in tile &&
    typeof tile.state === "string"
  ) {
    // Keep the validated live Tile reference rather than copying its state.
    return tile as FailedTile;
  }
  return null;
}

function sourceIdFromError(event: ErrorEvent): string | null {
  return typeof event === "object" &&
    event &&
    "sourceId" in event &&
    typeof event.sourceId === "string"
    ? event.sourceId
    : null;
}

function pruneTiles(state: LoadingHealth): void {
  for (const tile of state.failedTiles) {
    // Removed failures are not cached by MapLibre; revisiting requests a new
    // tile. A retry switches state before its next success or error event.
    if (tile.uses <= 0 || tile.state !== "errored") {
      state.failedTiles.delete(tile);
    }
  }
}

/** Attach immediately after construction, before the asynchronous style load. */
export function trackMapLoadingHealth(map: MapLibreMap): () => void {
  const existing = healthByMap.get(map);
  if (existing) {
    return existing.cleanup;
  }
  const state: LoadingHealth = {
    failedTiles: new Set(),
    sourceErrors: new Map(),
    globalError: false,
    cleanup,
  };
  const onError = (event: ErrorEvent) => {
    const tile = tileFromError(event);
    if (tile) {
      state.failedTiles.add(tile);
      return;
    }
    const sourceId = sourceIdFromError(event);
    if (sourceId) {
      state.sourceErrors.set(sourceId, map.getSource(sourceId));
    } else {
      // A style/glyph failure has no safe viewport test. Keep the map covered
      // until a successful style replacement or a fresh map retries it.
      state.globalError = true;
    }
  };
  const onData = (event: MapSourceDataEvent) => {
    if (event.sourceDataType === "metadata") {
      state.sourceErrors.delete(event.sourceId);
    }
    pruneTiles(state);
  };
  const onStyleLoad = () => {
    state.globalError = false;
  };
  function cleanup() {
    map.off("error", onError);
    map.off("sourcedata", onData);
    map.off("style.load", onStyleLoad);
    state.failedTiles.clear();
    state.sourceErrors.clear();
    if (healthByMap.get(map) === state) {
      healthByMap.delete(map);
    }
  }
  healthByMap.set(map, state);
  map.on("error", onError);
  map.on("sourcedata", onData);
  map.on("style.load", onStyleLoad);
  return cleanup;
}

/** loaded()/areTilesLoaded() also return true for errors; reject those here. */
export function assertMapLoadingHealthy(map: MapLibreMap): void {
  const state = healthByMap.get(map);
  // Small map fixtures and callers outside the application own their policy.
  if (!state) {
    return;
  }
  pruneTiles(state);
  if (state.globalError || state.failedTiles.size > 0) {
    throw new Error("Some map data could not load. Please try again.");
  }
  for (const [sourceId, failedSource] of state.sourceErrors) {
    const source = map.getSource(sourceId);
    if (source === failedSource) {
      throw new Error("Map source metadata could not load. Please try again.");
    }
    state.sourceErrors.delete(sourceId);
  }
  for (const id of [SOURCE_ID, BUILDING_SOURCE_ID]) {
    const source = map.getSource<VectorTileSource>(id);
    if (
      !source ||
      !source.loaded() ||
      !Array.isArray(source.tiles) ||
      source.tiles.length === 0
    ) {
      throw new Error("Map source metadata could not load. Please try again.");
    }
  }
}
