import type { Map as MapLibreMap } from "maplibre-gl";

const HAZE_HEIGHT = 0.42;
const HAZE_SKY_OVERLAP = 0.06;
const HAZE_START_PITCH = 60;
const HAZE_FULL_PITCH = 72;
const radians = (degrees: number) => (degrees * Math.PI) / 180;

/** Position of the mercator horizon, in viewport heights from the top. */
export function horizonFraction(pitch: number, verticalFov: number): number {
  // Match MapLibre's mercatorHorizonAdjustment: its sky is drawn slightly
  // below the physical horizon to cover the last coarse ground tiles.
  const horizonAngle = Math.min(
    Math.tan(radians(90 - pitch)) * 0.85,
    Math.tan(radians(89.25 - pitch))
  );
  return 0.5 - (0.5 * horizonAngle) / Math.tan(radians(verticalFov / 2));
}

/**
 * Soften distant LOD boundaries without requesting more tiles. This narrow,
 * unblurred gradient is rasterized by the browser, outside the WebGL renderer.
 * Only pitch changes move it; panning and rotation do no DOM or React work.
 */
export function installDistanceHaze(
  map: MapLibreMap,
  color: string
): () => void {
  const haze = document.createElement("div");
  haze.className = "map-distance-haze";
  haze.setAttribute("aria-hidden", "true");
  haze.style.background = `linear-gradient(to bottom, transparent, ${color} 14.29%, color-mix(in srgb, ${color} 70%, transparent) 42%, color-mix(in srgb, ${color} 25%, transparent) 70%, transparent)`;

  let previousPitch = -1;
  let previousFov = -1;
  const update = () => {
    const pitch = map.getPitch();
    const fov = map.getVerticalFieldOfView();
    if (pitch === previousPitch && fov === previousFov) {
      return;
    }
    previousPitch = pitch;
    previousFov = fov;
    haze.hidden = pitch <= HAZE_START_PITCH;
    if (haze.hidden) {
      return;
    }

    const progress = Math.min(
      1,
      (pitch - HAZE_START_PITCH) / (HAZE_FULL_PITCH - HAZE_START_PITCH)
    );
    haze.style.opacity = String(progress * progress * (3 - 2 * progress));
    const offset =
      (horizonFraction(pitch, fov) - HAZE_SKY_OVERLAP) / HAZE_HEIGHT;
    haze.style.transform = `translateY(${offset * 100}%)`;
  };

  update();
  // Keep markers above the haze even when changing theme recreates it.
  map.getCanvas().after(haze);
  map.on("pitch", update);
  map.on("resize", update);
  return () => {
    map.off("pitch", update);
    map.off("resize", update);
    haze.remove();
  };
}
