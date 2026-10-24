import { MAX_VEHICLE_AGE_MS, PRODUCT_LABELS, TRANSIT_PRODUCTS } from "./model";
import type { TransitProduct, TransitVehicle } from "./model";

export interface TransitDirectionGroup {
  name: string;
  vehicles: TransitVehicle[];
}

export interface TransitLineGroup {
  key: string;
  line: string;
  product: TransitProduct;
  vehicles: TransitVehicle[];
  directions: TransitDirectionGroup[];
  delayedCount: number;
  knownDelayCount: number;
}

export interface TransitSummary {
  vehicleCount: number;
  lineCount: number;
  delayedCount: number;
  knownDelayCount: number;
  byProduct: Record<TransitProduct, number>;
}

const NATURAL_ORDER = new Intl.Collator("de", {
  numeric: true,
  sensitivity: "base",
});

const PRODUCT_SEARCH_ALIASES: Record<TransitProduct, string> = {
  suburban: "suburban S-Bahn Sbahn train trains rail",
  subway: "subway U-Bahn Ubahn underground metro train trains rail",
  tram: "tram trams tramway Straßenbahn",
  bus: "bus buses",
  ferry: "ferry ferries Fähre Fähren faehre faehren boat boats",
  regional: "regional Regionalbahn RE RB train trains rail",
  express:
    "express IC ICE Intercity longdistance long distance long-distance train trains rail",
  unknown: "other unknown",
};

// Short service abbreviations would otherwise match unrelated station/operator
// text such as Berlin or Straße. Resolve these as mode keywords explicitly.
const SHORT_PRODUCT_ALIASES = new Map<string, TransitProduct>([
  ["re", "regional"],
  ["rb", "regional"],
  ["ic", "express"],
  ["ice", "express"],
]);

function searchable(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase("de")
    .normalize("NFKD")
    .replaceAll(/\p{M}/gu, "")
    .replaceAll("ß", "ss");
}

/** VBB occasionally omits the S/U prefix while retaining the service category. */
export function displayTransitLine(
  vehicle: Pick<TransitVehicle, "line" | "product">
): string {
  const line = vehicle.line.trim();
  if (!/^\d+$/u.test(line)) {
    return line;
  }
  if (vehicle.product === "suburban") {
    return `S${line}`;
  }
  if (vehicle.product === "subway") {
    return `U${line}`;
  }
  return line;
}

function lineKey(vehicle: TransitVehicle): string {
  return JSON.stringify([
    vehicle.product,
    searchable(displayTransitLine(vehicle)),
  ]);
}

/** Adjacent radar areas can observe the same trip; counts must remain unique. */
function freshVehicles(
  vehicles: TransitVehicle[],
  now: number
): TransitVehicle[] {
  if (!Number.isFinite(now)) {
    return [];
  }
  const trips = new Map<string, TransitVehicle>();
  for (const vehicle of vehicles) {
    if (now - vehicle.observedAt > MAX_VEHICLE_AGE_MS) {
      continue;
    }
    const previous = trips.get(vehicle.id);
    if (!previous || vehicle.observedAt >= previous.observedAt) {
      trips.set(vehicle.id, vehicle);
    }
  }
  return [...trips.values()];
}

function compareVehicles(a: TransitVehicle, b: TransitVehicle): number {
  return (
    NATURAL_ORDER.compare(a.nextStop ?? "", b.nextStop ?? "") ||
    NATURAL_ORDER.compare(a.id, b.id)
  );
}

function matchesQuery(vehicle: TransitVehicle, tokens: string[]): boolean {
  if (tokens.length === 0) {
    return true;
  }
  const haystack = searchable(
    [
      displayTransitLine(vehicle),
      PRODUCT_LABELS[vehicle.product],
      PRODUCT_SEARCH_ALIASES[vehicle.product],
      vehicle.operator ?? "",
      vehicle.direction,
      vehicle.nextStop ?? "",
    ].join(" ")
  );
  return tokens.every((token) => {
    const product = SHORT_PRODUCT_ALIASES.get(token);
    return product ? vehicle.product === product : haystack.includes(token);
  });
}

function groupDirections(vehicles: TransitVehicle[]): TransitDirectionGroup[] {
  const groups = new Map<string, TransitDirectionGroup>();
  for (const vehicle of vehicles) {
    const name = vehicle.direction.trim() || "Destination unavailable";
    const key = searchable(name);
    const group = groups.get(key);
    if (group) {
      group.vehicles.push(vehicle);
    } else {
      groups.set(key, { name, vehicles: [vehicle] });
    }
  }
  return [...groups.values()].toSorted((a, b) =>
    NATURAL_ORDER.compare(a.name, b.name)
  );
}

/** One line per service, then destination groups with independently inspectable trips. */
export function groupTransitLines(
  vehicles: TransitVehicle[],
  filters: Record<TransitProduct, boolean>,
  query: string,
  now: number
): TransitLineGroup[] {
  const groups = new Map<string, TransitLineGroup>();
  const search = searchable(query).split(/\s+/u).filter(Boolean);
  for (const vehicle of freshVehicles(vehicles, now)) {
    if (!filters[vehicle.product] || !matchesQuery(vehicle, search)) {
      continue;
    }
    const key = lineKey(vehicle);
    const existing = groups.get(key);
    if (existing) {
      existing.vehicles.push(vehicle);
    } else {
      groups.set(key, {
        key,
        line: displayTransitLine(vehicle),
        product: vehicle.product,
        vehicles: [vehicle],
        directions: [],
        delayedCount: 0,
        knownDelayCount: 0,
      });
    }
  }
  const result = [...groups.values()];
  for (const group of result) {
    group.vehicles = group.vehicles.toSorted(compareVehicles);
    group.directions = groupDirections(group.vehicles);
    group.delayedCount = group.vehicles.filter(
      (vehicle) => vehicle.delay !== null && vehicle.delay >= 60
    ).length;
    group.knownDelayCount = group.vehicles.filter(
      (vehicle) => vehicle.delay !== null
    ).length;
  }
  return result.toSorted(
    (a, b) =>
      TRANSIT_PRODUCTS.indexOf(a.product) -
        TRANSIT_PRODUCTS.indexOf(b.product) ||
      NATURAL_ORDER.compare(a.line, b.line)
  );
}

/** All network totals use fresh, unique trips and only explicitly reported delays. */
export function summarizeTransit(
  vehicles: TransitVehicle[],
  now: number
): TransitSummary {
  const summary: TransitSummary = {
    vehicleCount: 0,
    lineCount: 0,
    delayedCount: 0,
    knownDelayCount: 0,
    byProduct: {
      suburban: 0,
      subway: 0,
      tram: 0,
      bus: 0,
      ferry: 0,
      regional: 0,
      express: 0,
      unknown: 0,
    },
  };
  const lines = new Set<string>();
  for (const vehicle of freshVehicles(vehicles, now)) {
    summary.vehicleCount += 1;
    summary.byProduct[vehicle.product] += 1;
    lines.add(lineKey(vehicle));
    if (vehicle.delay !== null) {
      summary.knownDelayCount += 1;
      summary.delayedCount += Number(vehicle.delay >= 60);
    }
  }
  summary.lineCount = lines.size;
  return summary;
}

export function formatDelay(delay: number | null): string {
  if (delay === null) {
    return "No delay data";
  }
  if (delay === 0) {
    return "On time";
  }
  const magnitude = Math.abs(delay);
  const minutes = magnitude < 60 ? "<1" : String(Math.round(magnitude / 60));
  return `${delay < 0 ? "−" : "+"}${minutes} min`;
}
