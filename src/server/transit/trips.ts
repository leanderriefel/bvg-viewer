import { setTimeout as pause } from "node:timers/promises";

import { normalizeTripRoute, validRouteIdentity } from "@/map/transit/route";
import type { TransitRoute } from "@/map/transit/route";

import { retryAfterMilliseconds } from "./collector";
import { TripRouteError } from "./trip-route-error";

export const TRIP_ROUTE_TTL_MS = 10 * 60_000;
export const TRIP_REQUEST_SPACING_MS = 1500;

interface TripRouteOptions {
  request?: typeof fetch;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  capacity?: number;
}

interface CachedRoute {
  route: TransitRoute;
  expiresAt: number;
}

/** At most 40 additional requests/minute, on top of the radar's normal 32. */
export class TripRoutes {
  private readonly request: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly capacity: number;
  private readonly cache = new Map<string, CachedRoute>();
  private readonly pending = new Map<string, Promise<TransitRoute>>();
  private nextRequestAt = 0;
  private backoffUntil = 0;

  constructor(options: TripRouteOptions = {}) {
    this.request = options.request ?? fetch;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? pause;
    this.capacity = options.capacity ?? 64;
  }

  async get(tripId: string, line: string): Promise<TransitRoute> {
    if (!validRouteIdentity(tripId, line)) {
      throw new TripRouteError("Invalid trip ID or line name", 400);
    }
    const key = JSON.stringify([tripId, line]);
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > this.now()) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached.route;
    }
    this.cache.delete(key);
    const pending = this.pending.get(key);
    if (pending) {
      return pending;
    }
    if (this.now() < this.backoffUntil) {
      throw new TripRouteError(
        "Route updates are temporarily rate limited",
        429,
        Math.ceil((this.backoffUntil - this.now()) / 1000)
      );
    }
    if (this.pending.size >= 8) {
      throw new TripRouteError(
        "Route updates are busy; try again shortly",
        503,
        3
      );
    }
    const work = this.fetchAndCache(tripId, line, key);
    this.pending.set(key, work);
    try {
      return await work;
    } finally {
      this.pending.delete(key);
    }
  }

  private async fetchAndCache(
    tripId: string,
    line: string,
    key: string
  ): Promise<TransitRoute> {
    const scheduledAt = Math.max(this.now(), this.nextRequestAt);
    this.nextRequestAt = scheduledAt + TRIP_REQUEST_SPACING_MS;
    if (scheduledAt > this.now()) {
      await this.sleep(scheduledAt - this.now());
    }
    if (this.now() < this.backoffUntil) {
      throw new TripRouteError(
        "Route updates are temporarily rate limited",
        429,
        Math.ceil((this.backoffUntil - this.now()) / 1000)
      );
    }
    const url = new URL(
      `https://v6.vbb.transport.rest/trips/${encodeURIComponent(tripId)}`
    );
    url.search = new URLSearchParams({
      lineName: line,
      polyline: "true",
      stopovers: "true",
      remarks: "false",
      pretty: "false",
    }).toString();
    let response: Response;
    try {
      response = await this.request(url, {
        headers: {
          accept: "application/json",
          "user-agent":
            "berlin-in-3d (https://github.com/leanderriefel/bvg-viewer)",
        },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new TripRouteError("The route service is temporarily unavailable");
    }
    if (response.status === 429) {
      const wait = retryAfterMilliseconds(
        response.headers.get("retry-after"),
        this.now()
      );
      this.backoffUntil = this.now() + wait;
      throw new TripRouteError(
        "Route updates are temporarily rate limited",
        429,
        Math.ceil(wait / 1000)
      );
    }
    if (!response.ok) {
      throw new TripRouteError(
        "The route is not available from VBB",
        response.status === 404 ? 404 : 503
      );
    }
    let route: TransitRoute;
    try {
      route = normalizeTripRoute(
        await response.json(),
        tripId,
        line,
        this.now()
      );
    } catch {
      throw new TripRouteError(
        "VBB has no usable route shape for this vehicle"
      );
    }
    this.cache.set(key, { route, expiresAt: this.now() + TRIP_ROUTE_TTL_MS });
    while (this.cache.size > this.capacity) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.cache.delete(oldest);
    }
    return route;
  }
}

const shared = globalThis as typeof globalThis & {
  berlinTransitTripRoutes?: TripRoutes;
};

export function getTripRoutes(): TripRoutes {
  shared.berlinTransitTripRoutes ??= new TripRoutes();
  return shared.berlinTransitTripRoutes;
}

export async function respondWithTripRoute(
  request: Request
): Promise<Response> {
  const params = new URL(request.url).searchParams;
  try {
    const route = await getTripRoutes().get(
      params.get("tripId") ?? "",
      params.get("lineName") ?? ""
    );
    return Response.json(route, {
      headers: { "cache-control": "private, max-age=600" },
    });
  } catch (error) {
    const status = error instanceof TripRouteError ? error.status : 503;
    const headers = new Headers({ "cache-control": "no-store" });
    if (error instanceof TripRouteError && error.retryAfter !== null) {
      headers.set("retry-after", String(error.retryAfter));
    }
    return Response.json(
      {
        error:
          error instanceof TripRouteError
            ? error.message
            : "The route is temporarily unavailable",
      },
      { status, headers }
    );
  }
}
