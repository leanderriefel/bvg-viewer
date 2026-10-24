import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { gzip } from "node:zlib";

import { readTransitSnapshot } from "@/map/transit/model";
import type { TransitSnapshot } from "@/map/transit/model";

const compress = promisify(gzip);
export const HISTORY_SLOTS = 120;

export interface TransitStorage {
  load: () => Promise<TransitSnapshot | null>;
  save: (snapshot: TransitSnapshot) => Promise<void>;
}

async function replaceFile(
  temporary: string,
  destination: string
): Promise<void> {
  // Windows virus scanners can briefly hold a newly written file open.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      // oxlint-disable-next-line eslint/no-await-in-loop -- Retrying rename must be sequential.
      await rename(temporary, destination);
      return;
    } catch (error) {
      if (
        !(
          error instanceof Error &&
          "code" in error &&
          (error.code === "EPERM" || error.code === "EBUSY")
        ) ||
        attempt === 4
      ) {
        throw error;
      }
      // oxlint-disable-next-line eslint/no-await-in-loop -- Allow the transient file lock to clear.
      await delay(50 * (attempt + 1));
    }
  }
}

/** A mounted local directory keeps the latest state and a bounded replay window. */
export function createTransitStorage(directory: string): TransitStorage {
  return {
    async load() {
      try {
        const content: unknown = JSON.parse(
          await readFile(path.join(directory, "latest.json"), "utf-8")
        );
        return readTransitSnapshot(content);
      } catch {
        // Missing, truncated, or incompatible snapshots can be replaced by live data.
        return null;
      }
    },
    async save(snapshot) {
      await mkdir(directory, { recursive: true });
      const content = JSON.stringify(snapshot);
      const latest = path.join(directory, "latest.json");
      await writeFile(`${latest}.tmp`, content);
      await replaceFile(`${latest}.tmp`, latest);

      // Time-based slots survive restarts without an unbounded append-only log.
      const slot =
        Math.floor((snapshot.updatedAt ?? Date.now()) / 30_000) % HISTORY_SLOTS;
      const history = path.join(
        directory,
        `snapshot-${String(slot).padStart(3, "0")}.json.gz`
      );
      await writeFile(`${history}.tmp`, await compress(content));
      await replaceFile(`${history}.tmp`, history);
    },
  };
}
