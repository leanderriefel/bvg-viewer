import type { Map as MapLibreMap, MapMovementEvent } from "maplibre-gl";

/** Map.resize emits movestart too; resizing must not release camera ownership. */
export function createResizeMovementGuard(map: MapLibreMap) {
  const canvas = map.getCanvas();
  let width = canvas.clientWidth;
  let height = canvas.clientHeight;
  return (event: MapMovementEvent): boolean => {
    const resized =
      width !== canvas.clientWidth || height !== canvas.clientHeight;
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    return event.type === "movestart" && resized && !event.originalEvent;
  };
}
