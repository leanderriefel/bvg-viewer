import * as maplibregl from "maplibre-gl";
import { Protocol } from "pmtiles";

/**
 * Staged into public/ by `scripts/sync-map-worker.mjs`.
 *
 * Anything Vite serves out of node_modules gets an HMR preamble prepended that
 * imports `/@vite/client`, and that module touches `document` - which a Worker
 * does not have. The worker then dies on load and the map stays blank with no
 * error surfaced anywhere. Files under public/ are served byte-for-byte, so
 * pointing MapLibre at a staged copy avoids the rewrite entirely.
 */
const MAPLIBRE_WORKER_URL = "/maplibre/maplibre-gl-worker.mjs";

/**
 * Where the vector tiles come from.
 *
 * Both options speak the OpenMapTiles schema, which is the whole point: the
 * style builder does not need to know which one is live, so you can develop
 * against the hosted planet and ship the local Berlin extract without touching
 * a single layer definition.
 */
export type TileSourceKind = "local" | "openfreemap";

export interface TileSource {
  kind: TileSourceKind;
  label: string;
  /** Passed straight to the MapLibre vector source. */
  spec:
    | { type: "vector"; url: string; attribution: string; maxzoom: number }
    | {
        type: "vector";
        tiles: string[];
        attribution: string;
        maxzoom: number;
        minzoom: number;
      };
}

export const SOURCE_ID = "osm";

/**
 * Buildings use the same archive with their own level of detail.
 *
 * OpenMapTiles only carries building geometry from z13 up, and z13 holds one
 * merged massing blob per tile rather than individual houses. A separate
 * source lets buildings retain at least z13 while the basemap uses coarser
 * tiles at high pitch. Nearby tiles still reach z14 for real footprints and
 * heights.
 */
export const BUILDING_SOURCE_ID = "osm-buildings";

/** First tile zoom containing building geometry in OpenMapTiles. */
export const MIN_BUILDING_TILE_ZOOM = 13;

const OSM_ATTRIBUTION =
  '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a>';

/** Path of the extract produced by `vp run tiles:build`. */
export const LOCAL_PMTILES_PATH = "/tiles/berlin.pmtiles";

let protocolRegistered = false;

/** Keep enough workers to decode ahead without multiplying low-memory heaps. */
export function mapWorkerCount(cores: number, memoryGb?: number): number {
  const coreLimit = Math.max(2, Math.min(Math.floor(cores) - 2, 6));
  if (memoryGb !== undefined && memoryGb <= 2) {
    return 2;
  }
  if (memoryGb !== undefined && memoryGb <= 4) {
    return Math.min(coreLimit, 4);
  }
  return coreLimit;
}

/**
 * PMTiles serves a whole city out of one file over HTTP range requests, so the
 * browser only ever pulls the handful of kilobytes it is about to draw. This
 * has to run before any style referencing `pmtiles://` is handed to MapLibre.
 */
export function registerPmtilesProtocol(): void {
  if (protocolRegistered || typeof window === "undefined") {
    return;
  }

  maplibregl.setWorkerUrl(MAPLIBRE_WORKER_URL);

  // Decoding benefits from parallelism, but every worker retains its own heap.
  // Reserve cores for rendering and start workers while source detection runs.
  const cores = navigator.hardwareConcurrency ?? 4;
  const memory =
    "deviceMemory" in navigator && typeof navigator.deviceMemory === "number"
      ? navigator.deviceMemory
      : undefined;
  maplibregl.setWorkerCount(mapWorkerCount(cores, memory));
  maplibregl.prewarm();

  const protocol = new Protocol({ metadata: true });
  maplibregl.addProtocol("pmtiles", protocol.tile);
  protocolRegistered = true;
}

export const OPENFREEMAP_SOURCE: TileSource = {
  kind: "openfreemap",
  label: "OpenFreeMap (hosted planet)",
  spec: {
    attribution: `${OSM_ATTRIBUTION} · <a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a>`,
    maxzoom: 14,
    type: "vector",
    url: "https://tiles.openfreemap.org/planet",
  },
};

export const LOCAL_SOURCE: TileSource = {
  kind: "local",
  label: "Local Berlin extract",
  spec: {
    type: "vector",
    url: `pmtiles://${LOCAL_PMTILES_PATH}`,
    // The OpenMapTiles schema is CC-BY and requires a visible credit.
    attribution: `${OSM_ATTRIBUTION} · <a href="https://openmaptiles.org/" target="_blank" rel="noreferrer">© OpenMapTiles</a>`,
    maxzoom: 14,
  },
};

/**
 * Prefers the local extract when it has been built, otherwise falls back to the
 * hosted planet so a fresh clone still shows a map on `vp dev`.
 *
 * The probe is a ranged GET rather than a HEAD because some static servers
 * (including Vite's) answer HEAD for files they would then 404 on.
 */
export async function detectTileSource(
  signal?: AbortSignal
): Promise<TileSource> {
  signal?.throwIfAborted();
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", forwardAbort, { once: true });
  const timeout = setTimeout(() => {
    controller.abort(
      new DOMException("Local tile probe timed out", "TimeoutError")
    );
  }, 3000);
  let rejectAbort: (() => void) | undefined;
  // A race also bounds body reads when a server never completes its response.
  // oxlint-disable-next-line promise/avoid-new
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = () => reject(controller.signal.reason);
    controller.signal.addEventListener("abort", rejectAbort, { once: true });
  });

  try {
    return await Promise.race([probeLocalSource(controller.signal), aborted]);
  } catch {
    // Cancellation belongs to the caller; only probe failures use the fallback.
    signal?.throwIfAborted();
    return OPENFREEMAP_SOURCE;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", forwardAbort);
    if (rejectAbort) {
      controller.signal.removeEventListener("abort", rejectAbort);
    }
  }
}

async function probeLocalSource(signal: AbortSignal): Promise<TileSource> {
  const response = await fetch(LOCAL_PMTILES_PATH, {
    headers: { Range: "bytes=0-6" },
    signal,
  });
  const reader = response.body?.getReader();
  if (!reader) {
    return OPENFREEMAP_SOURCE;
  }
  const cancelBody = async () => {
    try {
      await reader.cancel();
    } catch {
      // A failed stream cancellation does not affect source selection.
    }
  };
  signal.addEventListener("abort", cancelBody, { once: true });

  try {
    signal.throwIfAborted();
    if (!response.ok) {
      return OPENFREEMAP_SOURCE;
    }
    // Some servers ignore Range and stream the entire archive. Stop as soon as
    // the seven magic bytes arrive, including when split across stream chunks.
    const magic = new Uint8Array(7);
    let length = 0;
    while (length < magic.length) {
      // Stream chunks must be read in order until the fixed-size header exists.
      // oxlint-disable-next-line no-await-in-loop
      const chunk = await reader.read();
      signal.throwIfAborted();
      if (chunk.done) {
        return OPENFREEMAP_SOURCE;
      }
      const count = Math.min(chunk.value.length, magic.length - length);
      magic.set(chunk.value.subarray(0, count), length);
      length += count;
    }
    return String.fromCodePoint(...magic) === "PMTiles"
      ? LOCAL_SOURCE
      : OPENFREEMAP_SOURCE;
  } finally {
    // Cancellation must not hold up source selection if a server stalls.
    signal.removeEventListener("abort", cancelBody);
    void cancelBody();
  }
}
