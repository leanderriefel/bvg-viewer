import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { gzip } from "node:zlib";

import { readTransitSnapshot } from "@/map/transit/model";
import type { TransitSnapshot } from "@/map/transit/model";

const compress = promisify(gzip);
export const HISTORY_SLOTS = 120;

export function historyFilename(at: number): string {
  const slot = Math.floor(at / 30_000) % HISTORY_SLOTS;
  return `snapshot-${String(slot).padStart(3, "0")}.json.gz`;
}

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

async function writeAtomically(
  destination: string,
  data: string | Uint8Array
): Promise<void> {
  const temporary = `${destination}.tmp`;
  try {
    await writeFile(temporary, data);
    await replaceFile(temporary, destination);
  } catch (error) {
    try {
      await rm(temporary, { force: true });
    } catch {
      // A cleanup failure must not hide the error that prevented saving.
    }
    throw error;
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
      await writeAtomically(latest, content);

      // Time-based slots survive restarts without an unbounded append-only log.
      const history = path.join(
        directory,
        historyFilename(snapshot.updatedAt ?? Date.now())
      );
      await writeAtomically(history, await compress(content));
    },
  };
}
