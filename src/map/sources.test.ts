import { afterEach, expect, it, vi } from "vite-plus/test";

import {
  detectTileSource,
  LOCAL_SOURCE,
  mapWorkerCount,
  OPENFREEMAP_SOURCE,
  registerPmtilesProtocol,
} from "@/map/sources";

const workers = vi.hoisted(() => ({
  addProtocol: vi.fn(),
  prewarm: vi.fn(),
  setWorkerCount: vi.fn(),
  setWorkerUrl: vi.fn(),
}));

vi.mock("maplibre-gl", () => workers);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("reads fragmented magic bytes and cancels an ignored range response", async () => {
  const cancel = vi.fn();
  let chunk = 0;
  const body = new ReadableStream<Uint8Array>({
    cancel,
    pull(controller) {
      controller.enqueue(
        new TextEncoder().encode(chunk === 0 ? "PMT" : "iles")
      );
      chunk += 1;
    },
  });
  const fetchMock = vi.fn().mockResolvedValue(new Response(body));
  vi.stubGlobal("fetch", fetchMock);

  await expect(detectTileSource()).resolves.toBe(LOCAL_SOURCE);
  expect(fetchMock).toHaveBeenCalledWith("/tiles/berlin.pmtiles", {
    headers: { Range: "bytes=0-6" },
    signal: expect.any(AbortSignal),
  });
  expect(cancel).toHaveBeenCalledOnce();
});

it.each(["<!doctype html>", "PMT", "not map data"])(
  "rejects a non-archive response: %s",
  async (body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));
    await expect(detectTileSource()).resolves.toBe(OPENFREEMAP_SOURCE);
  }
);

it("bounds a stalled response body to three seconds and cancels its stream", async () => {
  vi.useFakeTimers();
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({ cancel });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));
  const detection = detectTileSource();

  await vi.advanceTimersByTimeAsync(3000);

  await expect(detection).resolves.toBe(OPENFREEMAP_SOURCE);
  expect(cancel).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it("bounds a request that never returns response headers", async () => {
  vi.useFakeTimers();
  const fetchMock = vi.fn(() => Promise.race<Response>([]));
  vi.stubGlobal("fetch", fetchMock);
  const detection = detectTileSource();

  await vi.advanceTimersByTimeAsync(3000);

  await expect(detection).resolves.toBe(OPENFREEMAP_SOURCE);
  expect(vi.getTimerCount()).toBe(0);
});

it("uses hosted tiles when the local request fails", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Offline")));

  await expect(detectTileSource()).resolves.toBe(OPENFREEMAP_SOURCE);
});

it("preserves caller cancellation instead of returning the hosted fallback", async () => {
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({ cancel });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));
  const controller = new AbortController();
  const detection = detectTileSource(controller.signal);
  const rejected = expect(detection).rejects.toThrow("Component unmounted");
  await Promise.resolve();

  controller.abort(new Error("Component unmounted"));

  await rejected;
  expect(cancel).toHaveBeenCalledOnce();
});

it("does not probe when already canceled", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  await expect(
    detectTileSource(AbortSignal.abort(new Error("Canceled")))
  ).rejects.toThrow("Canceled");
  expect(fetchMock).not.toHaveBeenCalled();
});

it.each([
  [2, undefined, 2],
  [8, undefined, 6],
  [32, 8, 6],
  [32, 4, 4],
  [32, 2, 2],
])("bounds workers for %i cores and %s GB", (cores, memory, expected) => {
  expect(mapWorkerCount(cores, memory)).toBe(expected);
});

it("configures worker resources before starting them", () => {
  vi.stubGlobal("window", {});
  vi.stubGlobal("navigator", { deviceMemory: 4, hardwareConcurrency: 32 });

  registerPmtilesProtocol();
  registerPmtilesProtocol();

  expect(workers.setWorkerCount).toHaveBeenCalledExactlyOnceWith(4);
  expect(workers.prewarm).toHaveBeenCalledOnce();
  expect(workers.setWorkerUrl.mock.invocationCallOrder[0]).toBeLessThan(
    workers.prewarm.mock.invocationCallOrder[0]
  );
  expect(workers.setWorkerCount.mock.invocationCallOrder[0]).toBeLessThan(
    workers.prewarm.mock.invocationCallOrder[0]
  );
});
