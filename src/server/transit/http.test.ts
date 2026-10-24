import { promisify } from "node:util";
import { gunzip } from "node:zlib";

import { describe, expect, it, vi } from "vite-plus/test";

import { normalizeRadar, readTransitSnapshot } from "@/map/transit/model";
import type { TransitSnapshot } from "@/map/transit/model";

import { createTransitResponder } from "./http";

const decompress = promisify(gunzip);

function snapshot(): TransitSnapshot {
  return {
    vehicles: normalizeRadar(
      {
        movements: [
          {
            tripId: "berlin-1",
            line: { name: "S1", product: "suburban" },
            location: { longitude: 13.4, latitude: 52.5 },
          },
        ],
      },
      1_000_000
    ),
    updatedAt: 1_000_000,
    realtimeDataUpdatedAt: 990_000,
    coverage: { total: 16, succeeded: 16, capped: 0 },
    status: "live",
    error: null,
    storage: "disk",
    pollIntervalMs: 30_000,
  };
}

function request(headers?: HeadersInit) {
  return new Request("http://localhost/api/transit", { headers });
}

describe("transit HTTP snapshots", () => {
  it("serves schema-valid gzip and identity representations with shared validators", async () => {
    const respond = createTransitResponder();
    const saved = snapshot();
    const plain = await respond(saved, request());
    const compressed = await respond(
      saved,
      request({ "accept-encoding": "gzip, deflate, br" })
    );
    expect(plain.headers.get("content-encoding")).toBeNull();
    expect(compressed.headers.get("content-encoding")).toBe("gzip");
    expect(compressed.headers.get("vary")).toBe("Accept-Encoding");
    expect(compressed.headers.get("cache-control")).toBe("no-store");
    expect(compressed.headers.get("etag")).toBe(plain.headers.get("etag"));
    const decoded = await decompress(
      new Uint8Array(await compressed.arrayBuffer())
    );
    expect(readTransitSnapshot(JSON.parse(decoded.toString()))).toEqual(saved);
    expect(await plain.json()).toEqual(saved);
  });

  it("returns a bodyless 304 for matching weak or strong conditional validators", async () => {
    const respond = createTransitResponder();
    const saved = snapshot();
    const initial = await respond(saved, request());
    const etag = initial.headers.get("etag");
    expect(etag).toBeTruthy();
    const response = await respond(
      saved,
      request({ "if-none-match": `"old", ${etag}` })
    );
    expect(response.status).toBe(304);
    expect(await response.text()).toBe("");
    expect(response.headers.get("etag")).toBe(etag);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const strong = await respond(
      saved,
      request({ "if-none-match": etag?.replace(/^W\//u, "") ?? "" })
    );
    expect(strong.status).toBe(304);
  });

  it("reuses serialization across reads and invalidates after collection or expiry", async () => {
    const respond = createTransitResponder();
    const saved = snapshot();
    const serialize = vi.fn(() => ({ ...saved }));
    Object.defineProperty(saved, "toJSON", { value: serialize });
    const initial = await respond(saved, request());
    const etag = initial.headers.get("etag") ?? "";
    await respond(saved, request({ "if-none-match": etag }));
    expect(serialize).toHaveBeenCalledTimes(1);
    const expired = { ...saved, vehicles: [], status: "offline" as const };
    const changed = await respond(expired, request({ "if-none-match": etag }));
    expect(changed.status).toBe(200);
    expect(changed.headers.get("etag")).not.toBe(etag);
  });

  it.each(["gzip;q=0", "gzip;q=0, *;q=1", "br", "gzip;q=invalid"])(
    "does not gzip when excluded by %s",
    async (encoding) => {
      const response = await createTransitResponder()(
        snapshot(),
        request({ "accept-encoding": encoding })
      );
      expect(response.headers.get("content-encoding")).toBeNull();
      expect(await response.json()).toEqual(snapshot());
    }
  );
});
