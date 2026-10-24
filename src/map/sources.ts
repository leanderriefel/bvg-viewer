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

  // Tile decoding is the bottleneck when panning, and it is embarrassingly
  // parallel. MapLibre defaults to a conservative worker count; on a machine
  // with cores to spare, using more of them is the difference between tiles
  // appearing as you arrive and appearing a second later. Two are reserved for
  // the main thread and the browser itself.
  const cores = navigator.hardwareConcurrency ?? 4;
  maplibregl.setWorkerCount(Math.max(2, Math.min(cores - 2, 12)));

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
  try {
    const res = await fetch(LOCAL_PMTILES_PATH, {
      headers: { Range: "bytes=0-15" },
      signal,
    });

    // A PMTiles archive starts with the magic bytes "PMTiles" followed by the
    // spec version. Anything else means we hit an SPA fallback serving HTML.
    if (res.ok) {
      const head = new Uint8Array(await res.arrayBuffer());
      const magic = String.fromCodePoint(...head.slice(0, 7));
      if (magic === "PMTiles") {
        return LOCAL_SOURCE;
      }
    }
  } catch {
    // Offline or no extract built - the hosted planet is the sane default.
  }

  return OPENFREEMAP_SOURCE;
}
