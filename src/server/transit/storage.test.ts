import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";

import { expect, it } from "vite-plus/test";

import type { TransitSnapshot } from "@/map/transit/model";

import { HISTORY_SLOTS, createTransitStorage } from "./storage";

const decompress = promisify(gunzip);

function snapshot(updatedAt: number): TransitSnapshot {
  return {
    vehicles: [],
    updatedAt,
    realtimeDataUpdatedAt: null,
    coverage: { total: 16, succeeded: 16, capped: 0 },
    status: "live",
    error: null,
    storage: "disk",
    pollIntervalMs: 30_000,
  };
}

it("restores a validated snapshot and stores a gzip history with no temporary files", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "berlin-transit-test-"));
  try {
    const storage = createTransitStorage(directory);
    expect(await storage.load()).toBeNull();
    const saved = snapshot(30_000);
    await storage.save(saved);
    expect(await storage.load()).toEqual(saved);
    const files = await readdir(directory);
    expect(files.toSorted()).toEqual(["latest.json", "snapshot-001.json.gz"]);
    const history = await decompress(
      await readFile(path.join(directory, "snapshot-001.json.gz"))
    );
    expect(JSON.parse(history.toString())).toEqual(saved);
    await writeFile(
      path.join(directory, "latest.json"),
      '{"vehicles": "invalid"}'
    );
    expect(await storage.load()).toBeNull();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("bounds replay history even across a new storage instance", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "berlin-transit-test-"));
  try {
    for (let index = 0; index < HISTORY_SLOTS + 2; index += 1) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- Models sequential collector writes, including slot replacement.
      await createTransitStorage(directory).save(snapshot(index * 30_000));
    }
    expect(await readdir(directory)).toHaveLength(HISTORY_SLOTS + 1);
    const restored = await createTransitStorage(directory).load();
    expect(restored?.updatedAt).toBe((HISTORY_SLOTS + 1) * 30_000);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 15_000);
