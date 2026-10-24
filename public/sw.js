/**
 * Caches map data so a second visit costs almost nothing.
 *
 * Deliberately narrow: only glyphs, sprites and vector tiles are intercepted.
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

const VERSION = "v1";
const TILE_CACHE = `berlin3d-tiles-${VERSION}`;
const ASSET_CACHE = `berlin3d-assets-${VERSION}`;

/** Rough ceilings, enforced by trimming oldest-first after each write. */
const LIMITS = {
  [TILE_CACHE]: 3000,
  [ASSET_CACHE]: 200,
};

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

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) {
    return hit;
  }

  const response = await fetch(request);
  // Opaque responses have status 0 and are useless to re-serve deliberately,
  // but cross-origin tiles send CORS headers so we get real ones.
  if (response.ok) {
    await cache.put(request, response.clone());
    trim(cacheName);
  }
  return response;
}

function classify(url, request) {
  // Range requests (PMTiles) must never be cached - see the note above.
  if (request.headers.has("range")) {
    return null;
  }

  if (url.pathname.endsWith(".pmtiles")) {
    return null;
  }

  if (
    url.pathname.startsWith("/fonts/") ||
    url.pathname.startsWith("/maplibre/")
  ) {
    return ASSET_CACHE;
  }

  // Vector tiles, local or from the hosted fallback.
  if (url.pathname.endsWith(".pbf") || url.pathname.endsWith(".mvt")) {
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

  event.respondWith(cacheFirst(request, cacheName).catch(() => fetch(request)));
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
