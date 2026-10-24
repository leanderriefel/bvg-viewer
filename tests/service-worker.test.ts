import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

import { expect, it, vi } from "vite-plus/test";

const WORKER_SOURCE = readFileSync(
  new URL("../public/sw.js", import.meta.url),
  "utf-8"
);
const TILE_URL =
  "https://tiles.openfreemap.org/planet/20261018_080001_pt/14/8800/5370";

interface WorkerFetchEvent {
  request: Request;
  respondWith: (response: Promise<Response>) => void;
  waitUntil: (task: Promise<unknown>) => void;
}

function createWorker() {
  const entries = new Map<string, Response>();
  const cache = {
    delete: vi.fn((request: Request) =>
      Promise.resolve(entries.delete(request.url))
    ),
    keys: vi.fn(() =>
      Promise.resolve([...entries.keys()].map((url) => new Request(url)))
    ),
    match: vi.fn((request: Request) =>
      Promise.resolve(entries.get(request.url)?.clone())
    ),
    put: vi.fn((request: Request, response: Response) => {
      entries.set(request.url, response);
      return Promise.resolve();
    }),
  };
  const open = vi.fn(() => Promise.resolve(cache));
  const network = vi.fn(() => Promise.resolve(new Response("tile")));
  const listeners = new Map<string, (event: WorkerFetchEvent) => void>();
  runInNewContext(WORKER_SOURCE, {
    caches: { open },
    fetch: network,
    self: {
      addEventListener(
        name: string,
        listener: (event: WorkerFetchEvent) => void
      ) {
        listeners.set(name, listener);
      },
      location: { origin: "https://berlin.example" },
    },
    URL,
  });

  function dispatch(url = TILE_URL, options?: RequestInit) {
    let response: Promise<Response> | undefined;
    const lifetime: Promise<unknown>[] = [];
    listeners.get("fetch")?.({
      request: new Request(url, options),
      respondWith(value) {
        response = value;
      },
      waitUntil(task) {
        lifetime.push(task);
      },
    });
    return { lifetime, response };
  }

  return { cache, dispatch, entries, network, open };
}

it("returns a fetched tile while the cache write is still pending", async () => {
  const worker = createWorker();
  const write = Promise.withResolvers<undefined>();
  worker.cache.put.mockImplementation(() => write.promise);
  const event = worker.dispatch();

  try {
    const response = await event.response;
    expect(await response?.text()).toBe("tile");
    expect(worker.cache.put).toHaveBeenCalledOnce();
    expect(worker.cache.keys).not.toHaveBeenCalled();
    expect(event.lifetime).toHaveLength(1);
  } finally {
    write.resolve();
    await Promise.all(event.lifetime);
  }
});

it("serves cached tiles without a network request or another write", async () => {
  const worker = createWorker();
  worker.entries.set(TILE_URL, new Response("cached"));
  const event = worker.dispatch();

  const response = await event.response;
  expect(await response?.text()).toBe("cached");
  await Promise.all(event.lifetime);
  expect(worker.network).not.toHaveBeenCalled();
  expect(worker.cache.put).not.toHaveBeenCalled();
});

it("deduplicates concurrent persistence of the same tile", async () => {
  const worker = createWorker();
  const write = Promise.withResolvers<undefined>();
  worker.cache.put.mockImplementation(() => write.promise);
  const first = worker.dispatch();
  const second = worker.dispatch();

  try {
    await Promise.all([first.response, second.response]);
    expect(worker.cache.put).toHaveBeenCalledOnce();
  } finally {
    write.resolve();
    await Promise.all([...first.lifetime, ...second.lifetime]);
  }
});

it("keeps a successful network response when cache persistence fails", async () => {
  const worker = createWorker();
  worker.cache.put.mockRejectedValue(new Error("Storage quota exceeded"));
  const event = worker.dispatch();

  const response = await event.response;
  expect(await response?.text()).toBe("tile");
  await Promise.all(event.lifetime);
  expect(worker.network).toHaveBeenCalledOnce();
});

it("uses the network once when cache storage is unavailable", async () => {
  const worker = createWorker();
  worker.open.mockRejectedValue(new Error("Storage unavailable"));
  const event = worker.dispatch();

  const response = await event.response;
  expect(await response?.text()).toBe("tile");
  await Promise.all(event.lifetime);
  expect(worker.network).toHaveBeenCalledOnce();
});

it("propagates a network failure without silently requesting the tile again", async () => {
  const worker = createWorker();
  worker.network.mockRejectedValue(new Error("Offline"));
  const event = worker.dispatch();

  await expect(event.response).rejects.toThrow("Offline");
  await Promise.all(event.lifetime);
  expect(worker.network).toHaveBeenCalledOnce();
});

it("scans in batches and removes the oldest entries above the tile limit", async () => {
  const worker = createWorker();
  const oldest = "https://berlin.example/tiles/oldest.pbf";
  worker.entries.set(oldest, new Response("old"));
  for (let index = 0; index < 3000; index += 1) {
    worker.entries.set(
      `https://berlin.example/tiles/${index}.pbf`,
      new Response()
    );
  }
  const events = Array.from({ length: 130 }, (_, index) =>
    worker.dispatch(`https://berlin.example/tiles/new-${index}.pbf`)
  );

  await Promise.all(events.map((event) => event.response));
  await Promise.all(events.flatMap((event) => event.lifetime));
  expect(worker.cache.keys).toHaveBeenCalledTimes(3);
  expect(worker.entries.has(oldest)).toBe(false);
  expect(worker.entries.size).toBeLessThanOrEqual(3000);
});

it("serializes cache scans while a previous batch is still being trimmed", async () => {
  const worker = createWorker();
  const scan = Promise.withResolvers<Request[]>();
  const started = Promise.withResolvers<undefined>();
  worker.cache.keys.mockImplementationOnce(() => {
    started.resolve();
    return scan.promise;
  });
  const events = Array.from({ length: 64 }, (_, index) =>
    worker.dispatch(`https://berlin.example/tiles/${index}.pbf`)
  );

  try {
    await Promise.all(events.map((event) => event.response));
    await started.promise;
    expect(worker.cache.keys).toHaveBeenCalledOnce();
  } finally {
    scan.resolve([]);
    await Promise.all(events.flatMap((event) => event.lifetime));
  }
  expect(worker.cache.keys).toHaveBeenCalledTimes(2);
});

it.each([
  TILE_URL,
  `${TILE_URL}.pbf`,
  "https://berlin.example/fonts/Noto%20Sans%20Regular/0-255.pbf",
  "https://berlin.example/tiles/14/8800/5370.mvt",
])("intercepts supported map data: %s", async (url) => {
  const worker = createWorker();
  const event = worker.dispatch(url);

  expect(event.response).toBeDefined();
  await event.response;
  await Promise.all(event.lifetime);
  expect(worker.cache.put).toHaveBeenCalledOnce();
});

it.each([
  "https://berlin.example/",
  "https://berlin.example/assets/app.js",
  "https://berlin.example/maplibre/maplibre-gl-worker.mjs",
  "https://berlin.example/maplibre/maplibre-gl-shared.mjs",
  "https://berlin.example/fonts/app.js",
  "https://berlin.example/tiles/berlin.pmtiles",
  "https://tiles.openfreemap.org/planet",
  "https://tiles.openfreemap.org/planet/release/not/a/tile",
  "https://other.example/planet/release/14/8800/5370",
  "https://other.example/payload.pbf",
])("leaves app code and unsupported URLs to the browser: %s", (url) => {
  const worker = createWorker();
  const event = worker.dispatch(url);

  expect(event.response).toBeUndefined();
  expect(event.lifetime).toHaveLength(0);
  expect(worker.network).not.toHaveBeenCalled();
});

it("bypasses range requests and never persists partial responses", async () => {
  const worker = createWorker();
  expect(
    worker.dispatch(TILE_URL, { headers: { Range: "bytes=0-127" } }).response
  ).toBeUndefined();
  worker.network.mockResolvedValue(new Response("partial", { status: 206 }));
  const event = worker.dispatch();

  const response = await event.response;
  expect(response?.status).toBe(206);
  await Promise.all(event.lifetime);
  expect(worker.cache.put).not.toHaveBeenCalled();
});

it("leaves non-GET requests to the browser", () => {
  const worker = createWorker();
  const event = worker.dispatch(TILE_URL, { method: "POST" });

  expect(event.response).toBeUndefined();
  expect(worker.network).not.toHaveBeenCalled();
});
