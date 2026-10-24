import path from "node:path";

import { beforeEach, expect, it, vi } from "vite-plus/test";

import type { TransitSnapshot } from "@/map/transit/model";

import { createTransitStorage } from "./storage";

const filesystem = vi.hoisted(() => {
  const files = new Map<string, string | Uint8Array>();
  const write = (file: string, data: string | Uint8Array) => {
    files.set(file, data);
    return Promise.resolve();
  };
  const move = (temporary: string, destination: string) => {
    const data = files.get(temporary);
    if (data === undefined) {
      return Promise.reject(new Error("Temporary file does not exist"));
    }
    files.set(destination, data);
    files.delete(temporary);
    return Promise.resolve();
  };
  const remove = (file: string) => {
    files.delete(file);
    return Promise.resolve();
  };
  return {
    files,
    write,
    move,
    remove,
    mkdir: vi.fn(() => Promise.resolve()),
    readFile: vi.fn(() => Promise.resolve("")),
    writeFile: vi.fn(write),
    rename: vi.fn(move),
    rm: vi.fn(remove),
  };
});

vi.mock("node:fs/promises", () => ({
  mkdir: filesystem.mkdir,
  readFile: filesystem.readFile,
  writeFile: filesystem.writeFile,
  rename: filesystem.rename,
  rm: filesystem.rm,
}));

const DIRECTORY = path.join("transit-storage-test", "snapshots");
const LATEST = path.join(DIRECTORY, "latest.json");

function snapshot(updatedAt: number): TransitSnapshot {
  return {
    vehicles: [],
    updatedAt,
    realtimeDataUpdatedAt: null,
    coverage: { total: 16, succeeded: 16, capped: 0 },
    status: "live",
    error: null,
    storage: "disk",
    pollIntervalMs: 30_000,
  };
}

beforeEach(() => {
  filesystem.files.clear();
  filesystem.writeFile.mockReset().mockImplementation(filesystem.write);
  filesystem.rename.mockReset().mockImplementation(filesystem.move);
  filesystem.rm.mockReset().mockImplementation(filesystem.remove);
});

it("removes a partially written latest file and preserves the published snapshot", async () => {
  const storage = createTransitStorage(DIRECTORY);
  const published = JSON.stringify(snapshot(0));
  filesystem.files.set(LATEST, published);
  const failure = new Error("Disk is full");
  filesystem.writeFile.mockImplementationOnce((file, data) => {
    filesystem.files.set(file, data);
    return Promise.reject(failure);
  });

  await expect(storage.save(snapshot(30_000))).rejects.toBe(failure);
  expect(filesystem.files.get(LATEST)).toBe(published);
  expect(filesystem.files.has(`${LATEST}.tmp`)).toBe(false);
});

it("removes the latest temporary file when replacement fails", async () => {
  const storage = createTransitStorage(DIRECTORY);
  const published = JSON.stringify(snapshot(0));
  filesystem.files.set(LATEST, published);
  const failure = new Error("Replacement failed");
  filesystem.rename.mockRejectedValueOnce(failure);

  await expect(storage.save(snapshot(30_000))).rejects.toBe(failure);
  expect(filesystem.files.get(LATEST)).toBe(published);
  expect(filesystem.files.has(`${LATEST}.tmp`)).toBe(false);
});

it("cleans a failed history slot before a later save uses another slot", async () => {
  const storage = createTransitStorage(DIRECTORY);
  const history = path.join(DIRECTORY, "snapshot-000.json.gz");
  const publishedHistory = Uint8Array.from([1, 2, 3]);
  filesystem.files.set(history, publishedHistory);
  const failure = new Error("History replacement failed");
  filesystem.rename
    .mockImplementationOnce(filesystem.move)
    .mockRejectedValueOnce(failure);

  await expect(storage.save(snapshot(0))).rejects.toBe(failure);
  expect(filesystem.files.get(history)).toBe(publishedHistory);
  expect(filesystem.files.has(`${history}.tmp`)).toBe(false);
  expect(filesystem.files.get(LATEST)).toBe(JSON.stringify(snapshot(0)));

  await storage.save(snapshot(30_000));
  expect(
    filesystem.files.has(path.join(DIRECTORY, "snapshot-001.json.gz"))
  ).toBe(true);
  expect(
    [...filesystem.files.keys()].some((file) => file.endsWith(".tmp"))
  ).toBe(false);
});

it("preserves the original save error when temporary-file cleanup also fails", async () => {
  const failure = new Error("Original storage failure");
  filesystem.rename.mockRejectedValueOnce(failure);
  filesystem.rm.mockRejectedValueOnce(new Error("Cleanup is unavailable"));

  await expect(createTransitStorage(DIRECTORY).save(snapshot(0))).rejects.toBe(
    failure
  );
  expect(filesystem.rm).toHaveBeenCalledOnce();
});
