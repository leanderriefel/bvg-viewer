/* oxlint-disable anti-slop/no-unknown-parameters -- This module validates untrusted history API JSON before it can set playback bounds. */
export interface TransitHistoryEntry {
  at: number;
  until: number;
}

export const REPLAY_SPEEDS = [1, 10, 30] as const;
export type ReplaySpeed = (typeof REPLAY_SPEEDS)[number];

/** Validate the small history index before it can set the playback bounds. */
export function readTransitHistory(
  value: unknown
): TransitHistoryEntry[] | null {
  if (!Array.isArray(value) || value.length > 120) {
    return null;
  }
  const entries: TransitHistoryEntry[] = [];
  for (const candidate of value) {
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      !("at" in candidate && "until" in candidate) ||
      typeof candidate.at !== "number" ||
      typeof candidate.until !== "number" ||
      !Number.isSafeInteger(candidate.at) ||
      !Number.isSafeInteger(candidate.until) ||
      candidate.at < 0 ||
      candidate.until < candidate.at ||
      candidate.until - candidate.at > 120_000
    ) {
      return null;
    }
    const previous = entries.at(-1);
    if (
      previous &&
      (candidate.at <= previous.at || candidate.at < previous.until)
    ) {
      return null;
    }
    entries.push({ at: candidate.at, until: candidate.until });
  }
  const last = entries.at(-1);
  return last && last.until !== last.at ? null : entries;
}

export function historyEntryAt(
  entries: TransitHistoryEntry[],
  time: number
): TransitHistoryEntry | undefined {
  const entry = entries.findLast((candidate) => candidate.at <= time);
  return entry && time <= entry.until ? entry : undefined;
}

/** A seek into a missing interval lands on the nearest available boundary. */
export function constrainReplayTime(
  entries: TransitHistoryEntry[],
  time: number
): number | null {
  if (!Number.isFinite(time) || entries.length === 0) {
    return null;
  }
  let nearest = entries[0].at;
  let distance = Infinity;
  for (const entry of entries) {
    const candidate = Math.max(entry.at, Math.min(entry.until, time));
    const difference = Math.abs(candidate - time);
    if (difference <= distance) {
      nearest = candidate;
      distance = difference;
    }
  }
  return nearest;
}

/** Spend elapsed time only on recorded intervals, skipping gaps without extrapolating. */
export function advanceReplayTime(
  entries: TransitHistoryEntry[],
  time: number,
  elapsed: number
): number {
  let remaining = Math.max(0, elapsed);
  let position = time;
  for (const entry of entries) {
    if (entry.until < position) {
      continue;
    }
    position = Math.max(position, entry.at);
    const available = entry.until - position;
    if (remaining < available) {
      return position + remaining;
    }
    remaining -= available;
    position = entry.until;
  }
  return position;
}
