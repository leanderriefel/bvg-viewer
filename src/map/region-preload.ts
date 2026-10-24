import { BERLIN_BBOX, BERLIN_CENTER } from "@/lib/geo";
import type { LngLat } from "@/lib/geo";

const MIN_ZOOM = 11;
const MAX_ZOOM = 14;
// Raw tile downloads retain no decoded geometry. A larger bounded pool keeps
// high-latency hosted requests moving within the startup preparation deadline.
const DEFAULT_CONCURRENCY = 12;
const MAX_CONCURRENCY = 16;
const REQUEST_TIMEOUT_MS = 4000;
const TEMPLATE_PATH =
  /^\/planet\/[^/]+\/\{z\}\/\{x\}\/\{y\}(?:\.(?:pbf|mvt))?$/u;
const TILE_PATH = /^\/planet\/[^/]+\/\d+\/\d+\/\d+(?:\.(?:pbf|mvt))?$/u;

function isHostedTileUrl(value: string, path: RegExp): boolean {
  try {
    const url = new URL(value);
    return (
      url.origin === "https://tiles.openfreemap.org" &&
      !url.username &&
      !url.password &&
      !url.hash &&
      path.test(decodeURIComponent(url.pathname))
    );
  } catch {
    return false;
  }
}

function tilePosition([longitude, latitude]: LngLat, zoom: number): LngLat {
  const scale = 2 ** zoom;
  const radians = (latitude * Math.PI) / 180;
  return [
    ((longitude + 180) / 360) * scale,
    ((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2) * scale,
  ];
}

/** Cover Berlin once per zoom, loading coarse coverage and nearby detail first. */
export function createRegionTileUrls(
  templates: readonly string[],
  center: LngLat,
  maximumZoom = MAX_ZOOM
): string[] {
  const supported = [...new Set(templates)].filter(
    (template) =>
      ["{z}", "{x}", "{y}"].every((token) => template.includes(token)) &&
      isHostedTileUrl(template, TEMPLATE_PATH)
  );
  if (supported.length === 0) {
    return [];
  }
  const zoomLimit = Number.isFinite(maximumZoom)
    ? Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.floor(maximumZoom)))
    : MAX_ZOOM;
  const [west, south, east, north] = BERLIN_BBOX;
  const safeCenter: LngLat = [
    Number.isFinite(center[0])
      ? Math.max(west, Math.min(east, center[0]))
      : BERLIN_CENTER[0],
    Number.isFinite(center[1])
      ? Math.max(south, Math.min(north, center[1]))
      : BERLIN_CENTER[1],
  ];
  const urls = new Set<string>();

  for (let zoom = MIN_ZOOM; zoom <= zoomLimit; zoom += 1) {
    const [minX, minY] = tilePosition([west, north], zoom).map(Math.floor);
    const [maxX, maxY] = tilePosition([east, south], zoom).map(Math.floor);
    const [centerX, centerY] = tilePosition(safeCenter, zoom);
    const tiles: { x: number; y: number; distance: number }[] = [];
    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        tiles.push({
          x,
          y,
          distance: (x + 0.5 - centerX) ** 2 + (y + 0.5 - centerY) ** 2,
        });
      }
    }
    tiles.sort((left, right) => left.distance - right.distance);
    for (const { x, y } of tiles) {
      // Match MapLibre's choice among equivalent TileJSON templates.
      const template = supported[(x + y) % supported.length];
      urls.add(
        template
          .replaceAll("{z}", String(zoom))
          .replaceAll("{x}", String(x))
          .replaceAll("{y}", String(y))
      );
    }
  }
  return [...urls];
}

interface RegionPreloadOptions {
  signal: AbortSignal;
  concurrency?: number;
  onProgress?: (completed: number, total: number) => void;
}

/** Warm HTTP/SW caches without retaining decoded tiles or unbounded promises. */
export async function preloadRegionTiles(
  urls: readonly string[],
  {
    signal,
    concurrency = DEFAULT_CONCURRENCY,
    onProgress,
  }: RegionPreloadOptions
): Promise<void> {
  if (signal.aborted) {
    return;
  }
  const queue = [...new Set(urls)].filter((url) =>
    isHostedTileUrl(url, TILE_PATH)
  );
  const poolSize = Number.isFinite(concurrency)
    ? Math.max(1, Math.min(MAX_CONCURRENCY, Math.floor(concurrency)))
    : DEFAULT_CONCURRENCY;
  let next = 0;
  let completed = 0;
  onProgress?.(0, queue.length);

  async function download(): Promise<void> {
    while (!signal.aborted && next < queue.length) {
      const url = queue[next];
      next += 1;
      try {
        const requestSignal = AbortSignal.any([
          signal,
          AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        ]);
        // Each worker consumes one body before starting its next download.
        // oxlint-disable-next-line no-await-in-loop
        const response = await fetch(url, { signal: requestSignal });
        // Reading to completion commits the HTTP cache entry. The buffer stays
        // local to this iteration and is never accumulated or decoded.
        // oxlint-disable-next-line no-await-in-loop
        await response.arrayBuffer();
      } catch {
        // Optional warming never retries or prevents the live map from loading.
      } finally {
        completed += 1;
        onProgress?.(completed, queue.length);
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(poolSize, queue.length) }, () => download())
  );
}
