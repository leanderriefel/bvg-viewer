/**
 * Caches map data so a second visit costs almost nothing.
 *
 * Deliberately narrow: only glyphs and vector tiles are intercepted.
 * HTML, JS and CSS are left entirely to the browser and the dev server, because
 * a service worker that caches app code is the classic way to ship a build
 * nobody can update.
 *
 * PMTiles is a special case. It is one large file read through HTTP range
 * requests, and the Cache API keys entries by URL alone - two different byte
 * ranges of the same archive would overwrite each other and hand back the wrong
 * bytes. Those requests are passed straight through; the browser's own HTTP
 * cache handles them correctly, and the archive is served immutable.
 */

const VERSION = "v2";
const TILE_CACHE = `berlin3d-tiles-${VERSION}`;
const ASSET_CACHE = `berlin3d-assets-${VERSION}`;

/** Rough ceilings; batches can temporarily exceed them by a few dozen tiles. */
const LIMITS = {
  [TILE_CACHE]: 3000,
  [ASSET_CACHE]: 200,
};
const TRIM_BATCH_SIZE = 64;
const maintenance = new Map();
const pendingWrites = new Map();
const HOSTED_TILE_PATH = /^\/planet\/[^/]+\/\d+\/\d+\/\d+(?:\.(?:pbf|mvt))?$/u;

self.addEventListener("install", (event) => {
  // Glyphs are needed for the very first label drawn, and there are only a
  // dozen of them, so warm them up front.
  event.waitUntil(
    caches
      .open(ASSET_CACHE)
      .then((cache) =>
        cache.addAll([
          "/fonts/Noto Sans Regular/0-255.pbf",
          "/fonts/Noto Sans Regular/256-511.pbf",
          "/fonts/Noto Sans Bold/0-255.pbf",
        ])
      )
      .catch(() => {
        // A missing glyph range must not block activation.
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => {
        const stale = [];
        for (const key of keys) {
          if (key.startsWith("berlin3d-") && !(key in LIMITS)) {
            stale.push(caches.delete(key));
          }
        }
        return Promise.all(stale);
      })
      .then(() => self.clients.claim())
  );
});

async function trim(cacheName) {
  const limit = LIMITS[cacheName];
  if (!limit) {
    return;
  }
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= limit) {
    return;
  }
  // Cache.keys() preserves insertion order, so the front is the oldest.
  await Promise.all(
    keys.slice(0, keys.length - limit).map((k) => cache.delete(k))
  );
}

function scheduleTrim(cacheName) {
  let state = maintenance.get(cacheName);
  if (!state) {
    state = { writes: 0, task: Promise.resolve() };
    maintenance.set(cacheName, state);
  }
  state.writes += 1;
  // Scan once after worker startup, then once per batch, never per tile. Chain
  // scans so a burst cannot enumerate/delete the same oldest entries in parallel.
  if (state.writes === 1 || state.writes % TRIM_BATCH_SIZE === 0) {
    state.task = state.task
      .then(() => trim(cacheName))
      .catch(() => {
        // Quota limits or unavailable storage must not affect the map.
      });
  }
  return state.task;
}

function persist(cache, cacheName, request, response) {
  const key = `${cacheName}:${request.url}`;
  const pending = pendingWrites.get(key);
  if (pending) {
    return pending;
  }
  const task = (async () => {
    try {
      await cache.put(request, response.clone());
      await scheduleTrim(cacheName);
    } catch {
      // Persistence is best effort. A successful fetch must never be retried
      // just because storage is full, disabled, or was cleared during the write.
    } finally {
      pendingWrites.delete(key);
    }
  })();
  pendingWrites.set(key, task);
  return task;
}

async function cacheFirst(request, cacheName) {
  let cache;
  try {
    cache = await caches.open(cacheName);
    const hit = await cache.match(request);
    if (hit) {
      return { response: hit };
    }
  } catch {
    // Private browsing and storage failures still permit a normal network load.
  }

  const response = await fetch(request);
  // Opaque responses have status 0 and are useless to re-serve deliberately,
  // but cross-origin tiles send CORS headers so we get real ones.
  const persistence =
    cache && response.ok && response.status !== 206
      ? persist(cache, cacheName, request, response)
      : undefined;
  return { response, persistence };
}

function classify(url, request) {
  // Range requests (PMTiles) must never be cached - see the note above.
  if (request.headers.has("range")) {
    return null;
  }

  if (url.pathname.endsWith(".pmtiles")) {
    return null;
  }

  if (url.origin === self.location.origin) {
    // MapLibre worker modules have stable filenames and change with upgrades.
    // They are application code and must use normal browser HTTP revalidation.
    if (url.pathname.startsWith("/maplibre/")) {
      return null;
    }
    if (url.pathname.startsWith("/fonts/") && url.pathname.endsWith(".pbf")) {
      return ASSET_CACHE;
    }
    if (url.pathname.endsWith(".pbf") || url.pathname.endsWith(".mvt")) {
      return TILE_CACHE;
    }
  }

  // Hosted releases may use extensionless tile URLs. Only numeric tile paths
  // on the supported host qualify; TileJSON and unrelated external URLs do not.
  if (
    url.origin === "https://tiles.openfreemap.org" &&
    HOSTED_TILE_PATH.test(url.pathname)
  ) {
    return TILE_CACHE;
  }

  return null;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") {
    return;
  }

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  const cacheName = classify(url, request);
  if (!cacheName) {
    return;
  }

  const result = cacheFirst(request, cacheName);
  event.respondWith(result.then(({ response }) => response));
  // Register the lifetime extension synchronously, while returning the network
  // response independently of disk writes and cache maintenance.
  event.waitUntil(
    result
      .then(({ persistence }) => persistence)
      .catch(() => {
        // The response promise already reports network errors to the requester.
      })
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "clear-map-cache") {
    event.waitUntil(
      caches.keys().then((keys) => {
        const ours = [];
        for (const key of keys) {
          if (key.startsWith("berlin3d-")) {
            ours.push(caches.delete(key));
          }
        }
        return Promise.all(ours);
      })
    );
  }
});
