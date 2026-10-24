import { historyEntryAt, readTransitHistory } from "@/map/transit/history";
import { readTransitSnapshot } from "@/map/transit/model";
import type { TransitSnapshot } from "@/map/transit/model";
import { useTransitStore } from "@/map/transit/store";

interface PlaybackOptions {
  isVisible: () => boolean;
  subscribeVisibility: (listener: () => void) => () => void;
  request?: typeof fetch;
  now?: () => number;
  monotonicNow?: () => number;
}

/** One clock for rendering, camera tracking, summaries and replay controls. */
export function startTransitPlayback(options: PlaybackOptions): () => void {
  const request = options.request ?? fetch;
  const now = options.now ?? Date.now;
  const monotonicNow = options.monotonicNow ?? (() => performance.now());
  const cache = new Map<number, TransitSnapshot>();
  const pending = new Map<number, Promise<TransitSnapshot>>();
  const controllers = new Map<number, AbortController>();
  const prefetched = new Set<number>();
  const historyController = new AbortController();
  let disposed = false;
  let loadingAt: number | null = null;
  let publication = 0;
  let loadingHistory = false;
  let lastHistory = -Infinity;
  let previousTick = monotonicNow();

  const loadHistory = async () => {
    if (disposed || loadingHistory) {
      return;
    }
    loadingHistory = true;
    lastHistory = now();
    try {
      const response = await request("/api/transit-history", {
        cache: "no-store",
        signal: AbortSignal.any([
          historyController.signal,
          AbortSignal.timeout(15_000),
        ]),
      });
      if (!response.ok) {
        throw new Error("Saved transport history is unavailable.");
      }
      const history = readTransitHistory(await response.json());
      if (!history) {
        throw new Error(
          "The transport server returned an invalid history index."
        );
      }
      if (!disposed) {
        useTransitStore.getState().receiveHistory(history);
      }
    } catch (error) {
      if (!disposed) {
        useTransitStore
          .getState()
          .failHistory(
            error instanceof Error
              ? error.message
              : "Saved transport history is unavailable."
          );
      }
    } finally {
      loadingHistory = false;
    }
  };

  const loadSnapshot = (at: number): Promise<TransitSnapshot> => {
    const cached = cache.get(at);
    if (cached) {
      return Promise.resolve(cached);
    }
    const inFlight = pending.get(at);
    if (inFlight && !controllers.get(at)?.signal.aborted) {
      return inFlight;
    }
    const controller = new AbortController();
    controllers.set(at, controller);
    const load = async () => {
      try {
        const response = await request(`/api/transit-history?at=${at}`, {
          cache: "no-store",
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(15_000),
          ]),
        });
        if (!response.ok) {
          throw new Error(
            response.status === 404
              ? "This snapshot has expired. Go back to live to refresh the available history."
              : "Could not load this saved snapshot. Try again."
          );
        }
        const snapshot = readTransitSnapshot(await response.json());
        if (!snapshot || snapshot.updatedAt !== at) {
          throw new Error(
            "The transport server returned an invalid saved snapshot."
          );
        }
        if (disposed || controller.signal.aborted) {
          throw new Error("Replay request cancelled.");
        }
        cache.set(at, snapshot);
        if (cache.size > 4) {
          const oldest = cache.keys().next().value;
          if (oldest !== undefined) {
            cache.delete(oldest);
          }
        }
        return snapshot;
      } finally {
        if (controllers.get(at) === controller) {
          pending.delete(at);
          controllers.delete(at);
        }
      }
    };
    const promise = load();
    pending.set(at, promise);
    return promise;
  };

  const publishSnapshot = async (at: number) => {
    publication += 1;
    const current = publication;
    try {
      const snapshot = await loadSnapshot(at);
      if (!disposed && current === publication && loadingAt === at) {
        useTransitStore.getState().receiveReplay(snapshot);
      }
    } catch (error) {
      if (!disposed && current === publication && loadingAt === at) {
        useTransitStore
          .getState()
          .failReplay(
            at,
            error instanceof Error
              ? error.message
              : "Could not load this saved snapshot."
          );
      }
    }
  };

  const prefetchSnapshot = async (at: number) => {
    prefetched.add(at);
    try {
      await loadSnapshot(at);
    } catch {
      // A failed prefetch is retried as a foreground request when playback reaches it.
    }
  };

  const sync = () => {
    const state = useTransitStore.getState();
    if (disposed || state.mode === "live") {
      if (loadingAt !== null) {
        publication += 1;
      }
      loadingAt = null;
      for (const controller of controllers.values()) {
        controller.abort();
      }
      return;
    }
    const entry = historyEntryAt(state.history, state.clockTime);
    if (!entry) {
      return;
    }
    // Keep only the requested fleet and the next fleet in flight during rapid scrubbing.
    const next = state.history[state.history.indexOf(entry) + 1];
    for (const [at, controller] of controllers) {
      if (at !== entry.at && at !== next?.at) {
        controller.abort();
      }
    }
    if (state.replayStatus === "loading" && loadingAt !== entry.at) {
      loadingAt = entry.at;
      void publishSnapshot(entry.at);
    } else if (state.replayStatus === "error") {
      loadingAt = null;
    }
    if (
      state.replayStatus === "ready" &&
      next &&
      state.playing &&
      !prefetched.has(next.at)
    ) {
      // Prefetching never changes the visible snapshot or its clock.
      void prefetchSnapshot(next.at);
    }
  };
  const unsubscribe = useTransitStore.subscribe(sync);
  const tick = () => {
    const time = monotonicNow();
    const elapsed = Math.max(0, time - previousTick);
    previousTick = time;
    if (!options.isVisible()) {
      return;
    }
    const state = useTransitStore.getState();
    state.advanceClock(now(), elapsed);
    if (state.mode === "live" && now() - lastHistory >= 30_000) {
      void loadHistory();
    }
  };
  tick();
  sync();
  const unsubscribeVisibility = options.subscribeVisibility(() => {
    // Background tabs throttle timers. Resuming must not spend the hidden wall time.
    previousTick = monotonicNow();
    tick();
  });
  const timer = setInterval(tick, 50);
  return () => {
    disposed = true;
    clearInterval(timer);
    unsubscribe();
    unsubscribeVisibility();
    historyController.abort();
    for (const controller of controllers.values()) {
      controller.abort();
    }
  };
}
