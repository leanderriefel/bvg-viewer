import type { JumpToOptions, Map as MapLibreMap } from "maplibre-gl";

/** Descends into the loaded camera, preserving URL and flat-view destinations. */
export function startMapEntrance(
  map: MapLibreMap,
  reducedMotion: boolean,
  onComplete: () => void
): () => void {
  if (reducedMotion) {
    onComplete();
    return () => {
      // Reduced-motion entry has no animation to cancel.
    };
  }

  const center = map.getCenter();
  const target = {
    center: [center.lng, center.lat],
    zoom: map.getZoom(),
    pitch: map.getPitch(),
    bearing: map.getBearing(),
  } satisfies JumpToOptions;
  let complete = false;
  let removed = false;

  function finish() {
    if (complete || removed) {
      return;
    }
    complete = true;
    onComplete();
  }

  function onRemove() {
    removed = true;
  }

  map.once("remove", onRemove);
  map.jumpTo({
    ...target,
    zoom: Math.max(map.getMinZoom(), target.zoom - 1.2),
    pitch: target.pitch === 0 ? 0 : Math.max(0, target.pitch - 32),
    bearing: target.pitch === 0 ? target.bearing : target.bearing - 10,
  });
  map.once("moveend", finish);
  map.easeTo({
    ...target,
    duration: 2400,
    easing: (progress) => progress * progress * (3 - 2 * progress),
  });

  return () => {
    map.off("moveend", finish);
    map.off("remove", onRemove);
    if (complete || removed) {
      return;
    }
    complete = true;
    map.stop();
    map.jumpTo(target);
  };
}
