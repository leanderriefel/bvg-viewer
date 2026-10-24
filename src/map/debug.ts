import type { Map as MapLibreMap } from "maplibre-gl";

declare global {
  // eslint-disable-next-line vars-on-top, no-var
  var __map: MapLibreMap | undefined;
}

/**
 * Publishes the map instance for profiling.
 *
 * Always available in dev; in a production build only when the page is opened
 * with `?debug`, so the handle exists when you need to measure a real build but
 * is not part of the normal page surface.
 */
export function exposeMapForDebugging(map: MapLibreMap): void {
  const wanted =
    import.meta.env.DEV ||
    new URLSearchParams(window.location.search).has("debug");

  if (wanted) {
    globalThis.__map = map;
  }
}
