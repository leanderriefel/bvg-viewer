import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";

import type { TransitSnapshot } from "./model";
import { startTransitPolling } from "./poll-feed";

function snapshot(): TransitSnapshot {
  return {
    vehicles: [],
    updatedAt: 1_000_000,
    realtimeDataUpdatedAt: null,
    coverage: { total: 16, succeeded: 16, capped: 0 },
    status: "live",
    error: null,
    storage: "disk",
    pollIntervalMs: 30_000,
  };
}

function setup(initiallyVisible = true) {
  let visible = initiallyVisible;
  let listener: (() => void) | null = null;
  const receive = vi.fn();
  const fail = vi.fn();
  const request = vi
    .fn<typeof fetch>()
    .mockImplementation(() => Promise.resolve(Response.json(snapshot())));
  const unsubscribe = vi.fn(() => {
    listener = null;
  });
  const start = () =>
    startTransitPolling({
      isVisible: () => visible,
      subscribeVisibility: (nextListener) => {
        listener = nextListener;
        return unsubscribe;
      },
      receive,
      fail,
      request,
    });
  return {
    receive,
    fail,
    request,
    unsubscribe,
    start,
    setVisible: (next: boolean) => {
      visible = next;
      listener?.();
    },
  };
}

function deferredResponse() {
  let resolveResponse: ((response: Response) => void) | null = null;
  let rejectResponse: ((error: Error) => void) | null = null;
  // oxlint-disable-next-line promise/avoid-new -- Explicit settlement models an in-flight request racing visibility changes.
  const promise = new Promise<Response>((resolve, reject) => {
    resolveResponse = resolve;
    rejectResponse = reject;
  });
  return {
    promise,
    resolve: (response: Response) => resolveResponse?.(response),
    reject: (error: Error) => rejectResponse?.(error),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("browser transit polling lifecycle", () => {
  it("starts on visibility and polls the shared endpoint every five seconds", async () => {
    const feed = setup(false);
    const stop = feed.start();
    expect(feed.request).not.toHaveBeenCalled();
    feed.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(feed.receive).toHaveBeenCalledWith(snapshot());
    expect(feed.request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(feed.request).toHaveBeenCalledTimes(2);
    stop();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(feed.request).toHaveBeenCalledTimes(2);
    expect(feed.unsubscribe).toHaveBeenCalledOnce();
  });

  it("does not lose a resume while an aborted request is still settling", async () => {
    const pending = deferredResponse();
    const feed = setup();
    feed.request.mockReturnValueOnce(pending.promise);
    const stop = feed.start();
    const signal = feed.request.mock.calls[0][1]?.signal;
    feed.setVisible(false);
    expect(signal?.aborted).toBe(true);
    feed.setVisible(true);
    expect(feed.request).toHaveBeenCalledTimes(1);
    pending.reject(new Error("The request was aborted"));
    await vi.advanceTimersByTimeAsync(0);
    expect(feed.request).toHaveBeenCalledTimes(2);
    expect(feed.receive).toHaveBeenCalledOnce();
    expect(feed.fail).not.toHaveBeenCalled();
    stop();
  });

  it("ignores late responses after hiding or disposing and cancels further work", async () => {
    const pending = deferredResponse();
    const feed = setup();
    feed.request.mockReturnValueOnce(pending.promise);
    const stop = feed.start();
    stop();
    pending.resolve(Response.json(snapshot()));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(feed.receive).not.toHaveBeenCalled();
    expect(feed.fail).not.toHaveBeenCalled();
    expect(feed.request).toHaveBeenCalledOnce();
  });

  it("retains the previous snapshot and backs off after invalid upstream cache data", async () => {
    const feed = setup();
    feed.request.mockResolvedValueOnce(Response.json({ vehicles: [] }));
    const stop = feed.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(feed.fail).toHaveBeenCalledWith(
      "The transport server returned an invalid snapshot."
    );
    expect(feed.receive).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(14_999);
    expect(feed.request).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(feed.request).toHaveBeenCalledTimes(2);
    expect(feed.receive).toHaveBeenCalledWith(snapshot());
    stop();
  });

  it("pauses scheduled requests while hidden and resumes immediately", async () => {
    const feed = setup();
    const stop = feed.start();
    await vi.advanceTimersByTimeAsync(0);
    feed.setVisible(false);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(feed.request).toHaveBeenCalledOnce();
    feed.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(feed.request).toHaveBeenCalledTimes(2);
    stop();
  });

  it("reuses a validated snapshot on 304 and preserves conditional requests after errors", async () => {
    const feed = setup();
    feed.request
      .mockResolvedValueOnce(
        Response.json(snapshot(), { headers: { ETag: '"snapshot-1"' } })
      )
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 304 }));
    const stop = feed.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(
      new Headers(feed.request.mock.calls[0][1]?.headers).has("If-None-Match")
    ).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(
      new Headers(feed.request.mock.calls[1][1]?.headers).get("If-None-Match")
    ).toBe('"snapshot-1"');
    expect(feed.fail).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(
      new Headers(feed.request.mock.calls[2][1]?.headers).get("If-None-Match")
    ).toBe('"snapshot-1"');
    expect(feed.receive).toHaveBeenCalledTimes(2);
    expect(feed.receive.mock.calls[1][0]).toBe(feed.receive.mock.calls[0][0]);
    stop();
  });

  it("rejects an initial 304 when no local snapshot has been validated", async () => {
    const feed = setup();
    feed.request.mockResolvedValueOnce(new Response(null, { status: 304 }));
    const stop = feed.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(feed.receive).not.toHaveBeenCalled();
    expect(feed.fail).toHaveBeenCalledWith(
      "The transport server returned an invalid snapshot."
    );
    stop();
  });
});
