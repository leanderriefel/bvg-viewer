import { readTransitSnapshot } from "@/map/transit/model";
import type { TransitSnapshot } from "@/map/transit/model";

const REFRESH_MS = 5000;
const FAILURE_REFRESH_MS = 15_000;

interface TransitPollingOptions {
  isVisible: () => boolean;
  subscribeVisibility: (listener: () => void) => () => void;
  receive: (snapshot: TransitSnapshot) => void;
  fail: (message: string) => void;
  request?: typeof fetch;
}

/** One cancellable polling lifecycle, shared by the hook and lifecycle tests. */
export function startTransitPolling(
  options: TransitPollingOptions
): () => void {
  const request = options.request ?? fetch;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | null = null;
  let refreshAfterSettling = false;
  let previousSnapshot: TransitSnapshot | null = null;
  let etag: string | null = null;
  const canPublish = (active: AbortController) =>
    !disposed && !active.signal.aborted && options.isVisible();

  const refresh = async () => {
    if (disposed || !options.isVisible() || controller) {
      return;
    }
    const active = new AbortController();
    controller = active;
    let delay = REFRESH_MS;
    try {
      const headers = new Headers({ Accept: "application/json" });
      if (etag) {
        headers.set("If-None-Match", etag);
      }
      const response = await request("/api/transit", {
        cache: "no-store",
        signal: AbortSignal.any([active.signal, AbortSignal.timeout(15_000)]),
        headers,
      });
      if (!response.ok && response.status !== 304) {
        throw new Error(
          `Transport updates unavailable (HTTP ${response.status}).`
        );
      }
      const snapshot =
        response.status === 304
          ? previousSnapshot
          : readTransitSnapshot(await response.json());
      if (!snapshot) {
        throw new Error("The transport server returned an invalid snapshot.");
      }
      if (canPublish(active)) {
        previousSnapshot = snapshot;
        etag =
          response.headers.get("ETag") ??
          (response.status === 304 ? etag : null);
        options.receive(snapshot);
      }
    } catch (error) {
      delay = FAILURE_REFRESH_MS;
      if (canPublish(active)) {
        options.fail(
          error instanceof Error
            ? error.message
            : "Transport updates unavailable."
        );
      }
    } finally {
      controller = null;
      if (!disposed && options.isVisible()) {
        // A tab can become visible before its aborted request settles. Queue
        // the refresh here so that this transition cannot lose its wake-up.
        const wait = refreshAfterSettling ? 0 : delay;
        refreshAfterSettling = false;
        timer = setTimeout(() => {
          void refresh();
        }, wait);
      }
    }
  };

  const onVisibility = () => {
    clearTimeout(timer);
    if (!options.isVisible()) {
      refreshAfterSettling = false;
      controller?.abort();
    } else if (controller) {
      refreshAfterSettling = true;
    } else {
      void refresh();
    }
  };

  const unsubscribe = options.subscribeVisibility(onVisibility);
  void refresh();
  return () => {
    disposed = true;
    clearTimeout(timer);
    controller?.abort();
    unsubscribe();
  };
}
