import type { MapOptions } from "maplibre-gl";

/** Keep horizontal right-button drags consistent across the whole viewport. */
export const DRAG_ROTATE_OPTIONS = {
  around: "center",
  movement: "linear",
} as const satisfies NonNullable<MapOptions["dragRotate"]>;
