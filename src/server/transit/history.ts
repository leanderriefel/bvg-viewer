import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";

import type { TransitHistoryEntry } from "@/map/transit/history";
import { readTransitSnapshot } from "@/map/transit/model";
import type { TransitSnapshot } from "@/map/transit/model";

import { HISTORY_SLOTS, historyFilename } from "./storage";

const decompress = promisify(gunzip);
const HISTORY_FILE = /^snapshot-\d{3}\.json\.gz$/u;

export interface TransitHistory {
  list: () => Promise<TransitHistoryEntry[]>;
  load: (at: number) => Promise<TransitSnapshot | null>;
}

interface SavedTime {
  at: number;
  interval: number;
}

async function readSnapshot(file: string): Promise<TransitSnapshot | null> {
  try {
    const content = await decompress(await readFile(file));
    return readTransitSnapshot(JSON.parse(content.toString()));
  } catch {
    // An interrupted write, expired slot, or incompatible file is not available history.
    return null;
  }
}

/** Cache metadata, not the entire fleet for every saved time. */
export function createTransitHistory(directory: string): TransitHistory {
  const metadata = new Map<
    string,
    { version: string; time: SavedTime | null }
  >();
  let pending: Promise<TransitHistoryEntry[]> | null = null;
  const scan = async (): Promise<TransitHistoryEntry[]> => {
    let files: string[];
    try {
      const names = await readdir(directory);
      files = names.filter((file) => HISTORY_FILE.test(file));
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return [];
      }
      throw error;
    }
    const times: SavedTime[] = [];
    // Read a bounded number at once so a full history does not inflate all fleets in memory.
    for (let index = 0; index < files.length; index += 4) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- Bound concurrent gzip inflation and validation.
      const batch = await Promise.all(
        files.slice(index, index + 4).map(async (file) => {
          const absolute = path.join(directory, file);
          try {
            const info = await stat(absolute);
            const version = `${info.mtimeMs}:${info.size}`;
            const cached = metadata.get(file);
            if (cached?.version === version) {
              return cached.time;
            }
            const snapshot = await readSnapshot(absolute);
            const at = snapshot?.updatedAt;
            const time =
              snapshot &&
              at !== null &&
              at !== undefined &&
              Number.isSafeInteger(at) &&
              historyFilename(at) === file
                ? { at, interval: snapshot.pollIntervalMs }
                : null;
            metadata.set(file, { version, time });
            return time;
          } catch {
            return null;
          }
        })
      );
      for (const time of batch) {
        if (time) {
          times.push(time);
        }
      }
    }
    const present = new Set(files);
    for (const file of metadata.keys()) {
      if (!present.has(file)) {
        metadata.delete(file);
      }
    }
    const sorted = times.toSorted((a, b) => a.at - b.at).slice(-HISTORY_SLOTS);
    return sorted.map((time, index) => {
      const next = sorted[index + 1];
      // A missing sweep is a visible gap. Never extend the newest saved time into the future.
      const connected =
        next && next.at - time.at <= Math.min(120_000, time.interval * 2);
      return { at: time.at, until: connected ? next.at : time.at };
    });
  };
  return {
    async list() {
      pending ??= scan();
      try {
        return await pending;
      } finally {
        pending = null;
      }
    },
    async load(at) {
      if (!Number.isSafeInteger(at) || at < 0) {
        return null;
      }
      const snapshot = await readSnapshot(
        path.join(directory, historyFilename(at))
      );
      // The ring may have wrapped after the index was read; never substitute a newer fleet.
      return snapshot?.updatedAt === at ? snapshot : null;
    },
  };
}
