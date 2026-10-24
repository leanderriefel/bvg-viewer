/**
 * Every visual theme is a flat bag of colour tokens. The style builder turns a
 * palette plus a view mode into a full MapLibre style, so adding a new look is
 * a matter of filling in this record rather than hand-editing a 900-line JSON.
 */

export interface Palette {
  id: PaletteId;
  label: string;
  /** Drives the UI chrome (shadcn `.dark` class) alongside the map itself. */
  scheme: "light" | "dark";
  /** One-line description shown in the theme picker. */
  blurb: string;

  /** Behind everything, visible where no polygon covers the map. */
  background: string;
  /** The land polygon / default ground colour. */
  earth: string;

  water: string;
  waterDeep: string;
  waterway: string;

  park: string;
  forest: string;
  grass: string;
  sand: string;
  wetland: string;
  cemetery: string;
  pitch: string;

  residential: string;
  commercial: string;
  industrial: string;
  hospital: string;
  school: string;
  aerodrome: string;

  /** Flat building footprints, used below the extrusion threshold. */
  buildingFlat: string;
  /** Roof colour of a normal, low building. */
  buildingLow: string;
  /** Roof colour of a mid-rise. */
  buildingMid: string;
  /** Roof colour at the top of the height ramp. */
  buildingHigh: string;
  /** Applied to the handful of buildings we want to read from far away. */
  buildingLandmark: string;
  buildingOpacity: number;

  motorway: string;
  trunk: string;
  primary: string;
  secondary: string;
  minor: string;
  service: string;
  path: string;
  rail: string;
  /** Outline drawn under every road; set equal to `earth` to disable casings. */
  casing: string;

  boundary: string;

  textPrimary: string;
  textSecondary: string;
  textWater: string;
  textHalo: string;
  poi: string;

  /** UI accent reused for markers, the search pin and highlight rings. */
  accent: string;

  /** Directional light for the extrusion shading. */
  lightIntensity: number;
  lightColor: string;
  /** Top / bottom of the sky gradient in 3D. */
  skyTop: string;
  skyHorizon: string;
}

export type PaletteId =
  | "daylight"
  | "midnight"
  | "vivid"
  | "blueprint"
  | "slate";

export const DAYLIGHT: Palette = {
  accent: "#f0b429",
  aerodrome: "#e6e8ec",
  background: "#e9edf0",
  blurb: "Clean white massing, the way an architect's model looks",
  boundary: "#a89bb5",
  buildingFlat: "#dfe1e3",
  buildingHigh: "#cbcfd4",
  buildingLandmark: "#d8c9a8",
  buildingLow: "#e6e7e9",
  buildingMid: "#dcdee1",
  buildingOpacity: 1,
  casing: "#cbcfd4",
  cemetery: "#d9e3d2",
  commercial: "#f2ebe4",
  earth: "#f4f5f6",
  forest: "#c3e0b6",
  grass: "#d8ecce",
  hospital: "#f4e4e4",
  id: "daylight",
  industrial: "#e9e7ee",
  label: "Daylight",
  lightColor: "#ffffff",
  lightIntensity: 0.42,
  minor: "#ffffff",
  motorway: "#ffffff",
  park: "#cfe8c4",
  path: "#e3e0da",
  pitch: "#c6e3bc",
  poi: "#7b8288",
  primary: "#ffffff",
  rail: "#d4d6d9",
  residential: "#eeeeef",
  sand: "#eee6cf",
  scheme: "light",
  school: "#f0ecdc",
  secondary: "#ffffff",
  service: "#fafafa",
  skyHorizon: "#dfeaf3",
  skyTop: "#9dc4e8",
  textHalo: "#ffffff",
  textPrimary: "#3d4247",
  textSecondary: "#6b7278",
  textWater: "#5b87ac",
  trunk: "#ffffff",
  water: "#9ec9e8",
  waterDeep: "#84b8dd",
  waterway: "#93c2e2",
  wetland: "#cfe1d5",
};

export const MIDNIGHT: Palette = {
  accent: "#f3c623",
  aerodrome: "#17191c",
  background: "#0b0d0f",
  blurb: "Near-black with teal parks - built for looking at data on top",
  boundary: "#3d3550",
  buildingFlat: "#1e2226",
  buildingHigh: "#3a4048",
  buildingLandmark: "#5c5230",
  buildingLow: "#22262b",
  buildingMid: "#2b3037",
  buildingOpacity: 1,
  casing: "#0f1214",
  cemetery: "#1b2b25",
  commercial: "#1a1a1e",
  earth: "#131619",
  forest: "#123a37",
  grass: "#17443f",
  hospital: "#231a1d",
  id: "midnight",
  industrial: "#191b20",
  label: "Midnight",
  lightColor: "#dfe8ff",
  lightIntensity: 0.28,
  minor: "#24282d",
  motorway: "#3a3f46",
  park: "#15403e",
  path: "#25282b",
  pitch: "#174a41",
  poi: "#7d8590",
  primary: "#2f343a",
  rail: "#2a2e33",
  residential: "#16191c",
  sand: "#2e2b22",
  scheme: "dark",
  school: "#1e1d19",
  secondary: "#2a2e34",
  service: "#1f2226",
  skyHorizon: "#16202e",
  skyTop: "#05070c",
  textHalo: "#0b0d0f",
  textPrimary: "#c9d1d9",
  textSecondary: "#8b949e",
  textWater: "#5d8fd0",
  trunk: "#343940",
  water: "#12386e",
  waterDeep: "#0d2851",
  waterway: "#1b4a8a",
  wetland: "#14383a",
};

export const VIVID: Palette = {
  accent: "#ffc23d",
  aerodrome: "#1a1735",
  background: "#0d0a1a",
  blurb: "Buildings coloured by height - the skyline as a heat map",
  boundary: "#ff5fa2",
  buildingFlat: "#2a1f5c",
  buildingHigh: "#ffc23d",
  buildingLandmark: "#ff4d8d",
  buildingLow: "#2f2d8f",
  buildingMid: "#a02a9c",
  buildingOpacity: 0.96,
  casing: "#0d0a1a",
  cemetery: "#1c4436",
  commercial: "#251742",
  earth: "#171233",
  forest: "#0c5c40",
  grass: "#14805a",
  hospital: "#31153a",
  id: "vivid",
  industrial: "#1a1838",
  label: "Vivid",
  lightColor: "#ffffff",
  lightIntensity: 0.35,
  minor: "#3f358c",
  motorway: "#ff7a3d",
  park: "#0f6b4a",
  path: "#4a3f8f",
  pitch: "#12946a",
  poi: "#c0aef0",
  primary: "#c96bd6",
  rail: "#5b4bb0",
  residential: "#1c1640",
  sand: "#8a6a2a",
  scheme: "dark",
  school: "#2a1c3c",
  secondary: "#7b62d9",
  service: "#332a75",
  skyHorizon: "#3a1a6b",
  skyTop: "#05030f",
  textHalo: "#0d0a1a",
  textPrimary: "#f0eaff",
  textSecondary: "#b3a6e0",
  textWater: "#8fb3ff",
  trunk: "#ff9354",
  water: "#1b2fa8",
  waterDeep: "#111d78",
  waterway: "#2b4fd6",
  wetland: "#0f5f5c",
};

export const BLUEPRINT: Palette = {
  accent: "#5ee0ff",
  aerodrome: "#0b2743",
  background: "#071a2e",
  blurb: "Cyan on navy - the city as a technical drawing",
  boundary: "#7fd4f0",
  buildingFlat: "#10405f",
  buildingHigh: "#28a0d8",
  buildingLandmark: "#5ee0ff",
  buildingLow: "#12496e",
  buildingMid: "#186290",
  buildingOpacity: 0.92,
  casing: "#071a2e",
  cemetery: "#0d3050",
  commercial: "#0c2c48",
  earth: "#0a2440",
  forest: "#0c2f4c",
  grass: "#103a5c",
  hospital: "#0e2f4e",
  id: "blueprint",
  industrial: "#0a2640",
  label: "Blueprint",
  lightColor: "#cfefff",
  lightIntensity: 0.3,
  minor: "#2b7ba6",
  motorway: "#5ee0ff",
  park: "#0d3352",
  path: "#2a6f96",
  pitch: "#124465",
  poi: "#7fb8d8",
  primary: "#3fb0dc",
  rail: "#3d8fb8",
  residential: "#0b2842",
  sand: "#123f60",
  scheme: "dark",
  school: "#0d2c48",
  secondary: "#3596c4",
  service: "#24688d",
  skyHorizon: "#0d3a5e",
  skyTop: "#03101d",
  textHalo: "#071a2e",
  textPrimary: "#bfeaff",
  textSecondary: "#7fb8d8",
  textWater: "#69c8f0",
  trunk: "#4fcaf0",
  water: "#0d355a",
  waterDeep: "#0a2b4a",
  waterway: "#1b5a8f",
  wetland: "#0e3450",
};

export const SLATE: Palette = {
  accent: "#2f6fed",
  aerodrome: "#e7e7e9",
  background: "#e4e4e5",
  blurb: "Neutral greyscale - nothing competes with the geometry",
  boundary: "#b0b2b5",
  buildingFlat: "#d2d3d5",
  buildingHigh: "#adb1b6",
  buildingLandmark: "#8f9499",
  buildingLow: "#dcdddf",
  buildingMid: "#c9cbce",
  buildingOpacity: 1,
  casing: "#c4c6c9",
  cemetery: "#dcdedc",
  commercial: "#e8e8e9",
  earth: "#ededee",
  forest: "#d5d8d6",
  grass: "#e2e4e2",
  hospital: "#eceaea",
  id: "slate",
  industrial: "#e6e6e8",
  label: "Slate",
  lightColor: "#ffffff",
  lightIntensity: 0.45,
  minor: "#f5f5f5",
  motorway: "#ffffff",
  park: "#dcdedd",
  path: "#dedede",
  pitch: "#d8dbd9",
  poi: "#75787c",
  primary: "#fbfbfb",
  rail: "#cfd1d3",
  residential: "#eaeaeb",
  sand: "#e8e6e1",
  scheme: "light",
  school: "#eaeae7",
  secondary: "#f8f8f8",
  service: "#f1f1f1",
  skyHorizon: "#e0e3e6",
  skyTop: "#b8bec4",
  textHalo: "#ffffff",
  textPrimary: "#35383b",
  textSecondary: "#6a6d71",
  textWater: "#6c757d",
  trunk: "#fdfdfd",
  water: "#bcc3ca",
  waterDeep: "#a9b2bb",
  waterway: "#c0c7cd",
  wetland: "#dadddc",
};

export const PALETTES: Record<PaletteId, Palette> = {
  blueprint: BLUEPRINT,
  daylight: DAYLIGHT,
  midnight: MIDNIGHT,
  slate: SLATE,
  vivid: VIVID,
};

export const PALETTE_ORDER: PaletteId[] = [
  "daylight",
  "midnight",
  "vivid",
  "blueprint",
  "slate",
];

export function getPalette(id: PaletteId): Palette {
  return PALETTES[id] ?? DAYLIGHT;
}
