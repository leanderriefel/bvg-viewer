import { afterEach, expect, it, vi } from "vite-plus/test";

import { BERLIN_CENTER } from "@/lib/geo";
import { createRegionTileUrls, preloadRegionTiles } from "@/map/region-preload";

const TEMPLATE = "https://tiles.openfreemap.org/planet/release/{z}/{x}/{y}.pbf";
const COVERAGE = [
  { zoom: 11, minX: 1098, maxX: 1102, minY: 670, maxY: 673, count: 20 },
  { zoom: 12, minX: 2196, maxX: 2204, minY: 1340, maxY: 1346, count: 63 },
  { zoom: 13, minX: 4393, maxX: 4409, minY: 2680, maxY: 2693, count: 238 },
  { zoom: 14, minX: 8787, maxX: 8818, minY: 5361, maxY: 5386, count: 832 },
];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function sampleUrls(count = 6): string[] {
  return createRegionTileUrls([TEMPLATE], BERLIN_CENTER, 11).slice(0, count);
}

function deferredResponse() {
  let settle:
    | {
        resolve: (response: Response) => void;
        reject: (reason: Error) => void;
      }
    | undefined;
  // Gate real asynchronous fetch completion without requiring ES2024 APIs.
  // oxlint-disable-next-line promise/avoid-new
  const promise = new Promise<Response>((resolve, reject) => {
    settle = { resolve, reject };
  });
  return {
    promise,
    resolve(response: Response) {
      settle?.resolve(response);
    },
    reject(reason: Error) {
      settle?.reject(reason);
    },
  };
}

function abortableFetch(_url: RequestInfo | URL, options?: RequestInit) {
  const request = deferredResponse();
  const fail = () =>
    request.reject(new DOMException("Cancelled", "AbortError"));
  options?.signal?.addEventListener("abort", fail, { once: true });
  return request.promise;
}

it("covers every intersecting Berlin tile at zooms 11–14 exactly once", () => {
  const urls = createRegionTileUrls([TEMPLATE, TEMPLATE], BERLIN_CENTER);
  const unique = new Set(urls);

  expect(urls).toHaveLength(1153);
  expect(unique.size).toBe(urls.length);
  for (const { zoom, minX, maxX, minY, maxY, count } of COVERAGE) {
    expect(
      urls.filter((url) => url.includes(`/release/${zoom}/`))
    ).toHaveLength(count);
    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        expect(
          unique.has(
            `https://tiles.openfreemap.org/planet/release/${zoom}/${x}/${y}.pbf`
          )
        ).toBe(true);
      }
    }
  }
});

it("orders coarser coverage first and starts each zoom nearest the camera", () => {
  const urls = createRegionTileUrls([TEMPLATE], BERLIN_CENTER);
  const zooms = urls.map((url) =>
    Number(new URL(url).pathname.split("/").at(-3))
  );

  expect(zooms).toEqual(zooms.toSorted((left, right) => left - right));
  for (const [zoom, x, y] of [
    [11, 1100, 671],
    [12, 2200, 1343],
    [13, 4401, 2686],
    [14, 8802, 5373],
  ]) {
    expect(urls.find((url) => url.includes(`/release/${zoom}/`))).toBe(
      `https://tiles.openfreemap.org/planet/release/${zoom}/${x}/${y}.pbf`
    );
  }
  expect(createRegionTileUrls([TEMPLATE], [13.0883, 52.6755], 11)[0]).toContain(
    "/11/1098/670.pbf"
  );
});

it.each([
  [10, 20],
  [11, 20],
  [12.9, 83],
  [20, 1153],
  [Number.NaN, 1153],
])("bounds the requested maximum zoom %s", (zoom, count) => {
  expect(createRegionTileUrls([TEMPLATE], BERLIN_CENTER, zoom)).toHaveLength(
    count
  );
});

it("selects one equivalent template per tile without multiplying coverage", () => {
  const other = TEMPLATE.replace("release", "alternative");
  const urls = createRegionTileUrls([TEMPLATE, other], BERLIN_CENTER, 11);

  expect(urls).toHaveLength(20);
  expect(urls.some((url) => url.includes("/alternative/"))).toBe(true);
  expect(urls.some((url) => url.includes("/release/"))).toBe(true);
});

it.each([
  "https://other.example/planet/release/{z}/{x}/{y}.pbf",
  "http://tiles.openfreemap.org/planet/release/{z}/{x}/{y}.pbf",
  "https://tiles.openfreemap.org/planet",
  "https://tiles.openfreemap.org/planet/release/{z}/{x}/{y}.js",
  "https://tiles.openfreemap.org/planet/release/{z}/{x}/fixed.pbf",
  "https://user:password@tiles.openfreemap.org/planet/release/{z}/{x}/{y}.pbf",
  "invalid-url",
])("rejects unsupported templates: %s", (template) => {
  expect(createRegionTileUrls([template], BERLIN_CENTER)).toEqual([]);
});

it("supports extensionless hosted tiles and finite fallback camera coordinates", () => {
  const urls = createRegionTileUrls(
    [TEMPLATE.replace(".pbf", "")],
    [Number.NaN, Number.POSITIVE_INFINITY],
    11
  );

  expect(urls).toHaveLength(20);
  expect(urls[0]).toBe(
    "https://tiles.openfreemap.org/planet/release/11/1100/671"
  );
});

it("keeps the default pool at twelve requests and starts one replacement per completion", async () => {
  const urls = sampleUrls(20);
  const requests = urls.map(() => deferredResponse());
  let next = 0;
  const network = vi.fn(() => {
    const request = requests[next];
    next += 1;
    return request.promise;
  });
  vi.stubGlobal("fetch", network);
  const loading = preloadRegionTiles(urls, {
    signal: new AbortController().signal,
  });

  expect(network).toHaveBeenCalledTimes(12);
  requests[0].resolve(new Response("first"));
  await vi.waitFor(() => expect(network).toHaveBeenCalledTimes(13));
  for (const request of requests.slice(1)) {
    request.resolve(new Response("tile"));
  }
  await loading;
  expect(network).toHaveBeenCalledTimes(urls.length);
});

it.each([
  [0, 1],
  [-2, 1],
  [2.9, 2],
  [99, 16],
  [Number.NaN, 12],
  [Number.POSITIVE_INFINITY, 12],
])(
  "bounds requested concurrency %s to %s active downloads",
  async (concurrency, expected) => {
    const network = vi.fn(abortableFetch);
    vi.stubGlobal("fetch", network);
    const controller = new AbortController();
    const loading = preloadRegionTiles(sampleUrls(20), {
      signal: controller.signal,
      concurrency,
    });

    try {
      expect(network).toHaveBeenCalledTimes(expected);
    } finally {
      controller.abort();
      await loading;
    }
    expect(network).toHaveBeenCalledTimes(expected);
  }
);

it("consumes a full response body before reusing a download slot", async () => {
  const body = new TransformStream<Uint8Array, Uint8Array>();
  const network = vi
    .fn()
    .mockResolvedValueOnce(new Response(body.readable))
    .mockResolvedValue(new Response("next"));
  vi.stubGlobal("fetch", network);
  const loading = preloadRegionTiles(sampleUrls(2), {
    signal: new AbortController().signal,
    concurrency: 1,
  });

  await vi.waitFor(() => expect(body.readable.locked).toBe(true));
  expect(network).toHaveBeenCalledOnce();
  const writer = body.writable.getWriter();
  await writer.write(new Uint8Array([1, 2, 3]));
  await writer.close();
  await loading;
  expect(network).toHaveBeenCalledTimes(2);
});

it("starts no work for a signal that was already cancelled", async () => {
  const network = vi.fn();
  vi.stubGlobal("fetch", network);
  const controller = new AbortController();
  controller.abort();

  await preloadRegionTiles(sampleUrls(), { signal: controller.signal });
  expect(network).not.toHaveBeenCalled();
});

it("cancels in-flight requests and never schedules remaining tiles after abort", async () => {
  const network = vi.fn(abortableFetch);
  const progress = vi.fn();
  vi.stubGlobal("fetch", network);
  const controller = new AbortController();
  const loading = preloadRegionTiles(sampleUrls(), {
    signal: controller.signal,
    concurrency: 2,
    onProgress: progress,
  });

  expect(network).toHaveBeenCalledTimes(2);
  controller.abort();
  await loading;
  expect(network).toHaveBeenCalledTimes(2);
  expect(progress).toHaveBeenLastCalledWith(2, 6);
});

it("times out each request after four seconds and continues without retry", async () => {
  const timeout = new AbortController();
  const timeoutSignal = vi
    .spyOn(AbortSignal, "timeout")
    .mockReturnValue(timeout.signal);
  const network = vi.fn(abortableFetch);
  vi.stubGlobal("fetch", network);
  const loading = preloadRegionTiles(sampleUrls(1), {
    signal: new AbortController().signal,
  });

  expect(timeoutSignal).toHaveBeenCalledWith(4000);
  timeout.abort(new DOMException("Timeout", "TimeoutError"));
  await loading;
  expect(network).toHaveBeenCalledOnce();
});

it("counts failed requests and HTTP failures as completed without retries", async () => {
  const network = vi
    .fn()
    .mockRejectedValueOnce(new Error("Offline"))
    .mockResolvedValueOnce(new Response("missing", { status: 404 }))
    .mockResolvedValueOnce(new Response("tile"));
  const progress = vi.fn();
  vi.stubGlobal("fetch", network);

  await preloadRegionTiles(sampleUrls(3), {
    signal: new AbortController().signal,
    concurrency: 1,
    onProgress: progress,
  });
  expect(network).toHaveBeenCalledTimes(3);
  expect(progress.mock.calls).toEqual([
    [0, 3],
    [1, 3],
    [2, 3],
    [3, 3],
  ]);
});

it("deduplicates URLs and refuses arbitrary hosts at the download boundary", async () => {
  const network = vi.fn(() => Promise.resolve(new Response("tile")));
  vi.stubGlobal("fetch", network);
  const [url] = sampleUrls(1);

  await preloadRegionTiles(
    [url, url, "https://other.example/tiles/1/2/3.pbf"],
    { signal: new AbortController().signal }
  );
  expect(network).toHaveBeenCalledOnce();
});
