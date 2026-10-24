/**
 * Service worker registration plus the storage read-outs the settings panel
 * shows. Kept apart from the map so nothing here can stall first paint.
 */

export interface StorageEstimate {
  usedBytes: number;
  quotaBytes: number;
}

/** Caching is an optimisation, so a failed registration is not an error. */
async function registerQuietly(): Promise<void> {
  try {
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch {
    // Ignored on purpose: the map works fine without a service worker.
  }
}

let registered = false;

export function registerServiceWorker(): void {
  if (registered || typeof navigator === "undefined") {
    return;
  }
  if (!("serviceWorker" in navigator)) {
    return;
  }
  registered = true;

  // Start activation now so the first visit's map preparation can populate the
  // cache too. Registration stays asynchronous and cannot block source loading.
  void registerQuietly();
}

export async function getStorageEstimate(): Promise<StorageEstimate | null> {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) {
    return null;
  }
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  return { quotaBytes: quota, usedBytes: usage };
}

export async function clearMapCache(): Promise<void> {
  if (typeof caches !== "undefined") {
    const keys = await caches.keys();
    const ours: Promise<boolean>[] = [];
    for (const key of keys) {
      if (key.startsWith("berlin3d-")) {
        ours.push(caches.delete(key));
      }
    }
    await Promise.all(ours);
  }
  navigator.serviceWorker?.controller?.postMessage("clear-map-cache");
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}
