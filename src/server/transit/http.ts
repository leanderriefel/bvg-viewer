import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { gzip } from "node:zlib";

import type { TransitSnapshot } from "@/map/transit/model";

const compress = promisify(gzip);

interface CachedSnapshot {
  key: string;
  json: string;
  etag: string;
  compressed?: Promise<Uint8Array<ArrayBuffer>>;
}

function snapshotKey(snapshot: TransitSnapshot): string {
  // The collector changes positions only with updatedAt; reads can additionally
  // expire vehicles/cells or change storage/health without new upstream data.
  return JSON.stringify([
    snapshot.updatedAt,
    snapshot.realtimeDataUpdatedAt,
    snapshot.status,
    snapshot.error,
    snapshot.storage,
    snapshot.coverage.total,
    snapshot.coverage.succeeded,
    snapshot.coverage.capped,
    snapshot.vehicles.length,
    snapshot.pollIntervalMs,
  ]);
}

function acceptsGzip(value: string | null): boolean {
  if (!value) {
    return false;
  }
  const entries = value
    .toLowerCase()
    .split(",")
    .map((entry) => {
      const [encoding, ...parameters] = entry.trim().split(";");
      const quality = parameters.find((parameter) =>
        parameter.trim().startsWith("q=")
      );
      return {
        encoding: encoding.trim(),
        quality: quality ? Number(quality.trim().slice(2)) : 1,
      };
    });
  const match =
    entries.find((entry) => entry.encoding === "gzip") ??
    entries.find((entry) => entry.encoding === "*");
  return (
    match !== undefined && Number.isFinite(match.quality) && match.quality > 0
  );
}

function matchesEtag(value: string | null, etag: string): boolean {
  return (
    value?.split(",").some((candidate) => {
      const tag = candidate.trim();
      return (
        tag === "*" || tag.replace(/^W\//u, "") === etag.replace(/^W\//u, "")
      );
    }) ?? false
  );
}

async function compressedBody(json: string): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await compress(json));
}

/** One cached serialization/compression serves every reader of an unchanged scan. */
export function createTransitResponder() {
  let cached: CachedSnapshot | undefined;
  return async (
    snapshot: TransitSnapshot,
    request: Request
  ): Promise<Response> => {
    const key = snapshotKey(snapshot);
    if (!cached || cached.key !== key) {
      const json = JSON.stringify(snapshot);
      cached = {
        key,
        json,
        // Weak validators deliberately cover both identity and gzip representations.
        etag: `W/"${createHash("sha256").update(json).digest("base64url")}"`,
      };
    }
    const representation = cached;
    const headers = new Headers({
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      etag: representation.etag,
      vary: "Accept-Encoding",
    });
    if (
      matchesEtag(request.headers.get("if-none-match"), representation.etag)
    ) {
      return new Response(null, { status: 304, headers });
    }
    if (!acceptsGzip(request.headers.get("accept-encoding"))) {
      return new Response(representation.json, { headers });
    }
    representation.compressed ??= compressedBody(representation.json);
    headers.set("content-encoding", "gzip");
    return new Response(await representation.compressed, { headers });
  };
}

export const respondWithTransit = createTransitResponder();
