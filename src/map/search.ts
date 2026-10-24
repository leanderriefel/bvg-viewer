import { BERLIN_BBOX, BERLIN_CENTER } from "@/lib/geo";
import type { LngLat } from "@/lib/geo";
import { LANDMARKS } from "@/map/landmarks";
import type { Landmark } from "@/map/landmarks";

/**
 * Two-tier search.
 *
 * Curated landmarks are matched in-process so the common case - typing "alex"
 * or "brandenburg" - resolves on the keystroke with no network at all. Anything
 * that looks like a real address goes to Photon, which indexes OSM down to the
 * house number.
 */

export interface SearchResult {
  id: string;
  title: string;
  subtitle: string;
  center: LngLat;
  /** Where the entry came from, used for grouping and iconography. */
  kind: "landmark" | "address" | "street" | "place";
  /** Curated camera, when we have one. */
  camera?: Pick<Landmark, "zoom" | "pitch" | "bearing">;
  /** Higher sorts first. */
  score: number;
}

function normalize(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFD")
      // Strip combining marks so "Grosser" matches "Großer" and "koepenick"
      // matches "Köpenick" once the expansions below have run.
      .replaceAll(/\p{Diacritic}/gu, "")
      .replaceAll("ß", "ss")
      .replaceAll("ae", "a")
      .replaceAll("oe", "o")
      .replaceAll("ue", "u")
      .replaceAll(/[^a-z0-9]+/gu, " ")
      .trim()
  );
}

/** Berlin street names compound heavily; treat the suffix as optional. */
const STREET_SUFFIXES =
  /(?<suffix>strasse|str|allee|platz|damm|weg|ufer|chaussee)\b/gu;

function searchKeys(l: Landmark): string[] {
  return [l.name, ...(l.aliases ?? []), l.hint].map(normalize);
}

const LANDMARK_INDEX = LANDMARKS.map((l) => ({
  keys: searchKeys(l),
  landmark: l,
}));

export function searchLandmarks(query: string, limit = 6): SearchResult[] {
  const q = normalize(query);
  if (q.length < 2) {
    return [];
  }

  const out: SearchResult[] = [];

  for (const { landmark, keys } of LANDMARK_INDEX) {
    let best = 0;

    for (const key of keys) {
      if (key === q) {
        best = Math.max(best, 100);
      } else if (key.startsWith(q)) {
        best = Math.max(best, 80);
      } else if (key.includes(q)) {
        best = Math.max(best, 55);
      } else if (key.replaceAll(STREET_SUFFIXES, "").trim().startsWith(q)) {
        best = Math.max(best, 45);
      }
    }

    if (best > 0) {
      out.push({
        id: `landmark:${landmark.id}`,
        title: landmark.name,
        subtitle: landmark.hint,
        center: landmark.center,
        kind: "landmark",
        camera: {
          bearing: landmark.bearing,
          pitch: landmark.pitch,
          zoom: landmark.zoom,
        },
        // Shorter names that match are usually the intended one.
        score: best - landmark.name.length * 0.1,
      });
    }
  }

  return out.toSorted((a, b) => b.score - a.score).slice(0, limit);
}

interface PhotonProperties {
  name?: string;
  street?: string;
  housenumber?: string;
  postcode?: string;
  city?: string;
  district?: string;
  locality?: string;
  state?: string;
  osm_key?: string;
  osm_value?: string;
  type?: string;
}

interface PhotonFeature {
  properties: PhotonProperties;
  geometry: { coordinates: [number, number] };
}

const PHOTON_URL = "https://photon.komoot.io/api/";

function insideBerlin([lng, lat]: LngLat): boolean {
  const [w, s, e, n] = BERLIN_BBOX;
  return lng >= w && lng <= e && lat >= s && lat <= n;
}

function describe(p: PhotonProperties): { title: string; subtitle: string } {
  const streetLine = [p.street, p.housenumber].filter(Boolean).join(" ");
  const area = [p.postcode, p.district ?? p.locality ?? p.city]
    .filter(Boolean)
    .join(" ");

  if (p.name) {
    return {
      subtitle: [streetLine, area].filter(Boolean).join(" · "),
      title: p.name,
    };
  }

  return {
    subtitle: area || "Berlin",
    title: streetLine || p.city || "Unnamed place",
  };
}

function kindOf(p: PhotonProperties): SearchResult["kind"] {
  if (p.housenumber) {
    return "address";
  }
  if (p.osm_key === "highway" || (p.street && !p.name)) {
    return "street";
  }
  return "place";
}

/**
 * Photon geocoding, biased to Berlin and filtered to the city bounding box so
 * that typing a common street name does not offer the same street in Hamburg.
 */
export async function geocode(
  query: string,
  signal?: AbortSignal,
  limit = 8
): Promise<SearchResult[]> {
  if (query.trim().length < 3) {
    return [];
  }

  const url = new URL(PHOTON_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("lat", String(BERLIN_CENTER[1]));
  url.searchParams.set("lon", String(BERLIN_CENTER[0]));
  url.searchParams.set("limit", String(limit * 3));
  url.searchParams.set("lang", "de");

  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new Error(`Geocoder returned ${res.status}`);
  }

  const body = (await res.json()) as { features?: PhotonFeature[] };
  const results: SearchResult[] = [];

  for (const f of body.features ?? []) {
    const center: LngLat = [
      f.geometry.coordinates[0],
      f.geometry.coordinates[1],
    ];
    if (!insideBerlin(center)) {
      continue;
    }

    const { title, subtitle } = describe(f.properties);
    const kind = kindOf(f.properties);

    results.push({
      id: `photon:${center[0]},${center[1]},${title}`,
      title,
      subtitle,
      center,
      kind,
      // A precise address is almost always what someone typing numbers wants.
      score: kind === "address" ? 60 : 40,
    });
  }

  // Photon happily returns several nodes for the same doorway.
  const seen = new Set<string>();
  return results
    .filter((r) => {
      const key = `${r.title}|${r.subtitle}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

/** Default camera for a geocoded hit, tightened for exact addresses. */
export function cameraFor(result: SearchResult): {
  zoom: number;
  pitch: number;
  bearing: number;
} {
  if (result.camera) {
    return result.camera;
  }

  switch (result.kind) {
    case "address": {
      return { zoom: 18.2, pitch: 62, bearing: 0 };
    }
    case "street": {
      return { zoom: 16.4, pitch: 58, bearing: 0 };
    }
    default: {
      return { zoom: 16.8, pitch: 58, bearing: 0 };
    }
  }
}
