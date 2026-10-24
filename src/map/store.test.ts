import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const STORAGE_NAME = "berlin3d.settings";

function mockStorage(initialValue?: string) {
  const values = new Map<string, string>();
  if (initialValue) {
    values.set(STORAGE_NAME, initialValue);
  }
  const storage = {
    getItem: vi.fn((name: string) => values.get(name) ?? null),
    removeItem: vi.fn((name: string) => values.delete(name)),
    setItem: vi.fn((name: string, value: string) => values.set(name, value)),
  };
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("window", { localStorage: storage });
  return storage;
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("never serializes or writes preferences for ephemeral updates", async () => {
  const storage = mockStorage();
  const { useMapStore } = await import("@/map/store");
  const stringify = vi.spyOn(JSON, "stringify");
  const state = useMapStore.getState();

  for (let frame = 0; frame < 240; frame += 1) {
    state.setFps(frame);
    state.setLoadedTiles(frame);
    state.setCamera({ ...state.camera, bearing: frame });
  }
  state.setSelection(null);
  state.setMarker({ center: [13.4, 52.5], label: "Berlin" });
  useMapStore.setState({ fps: 60, loadedTiles: 32 });

  expect(useMapStore.getState()).toMatchObject({ fps: 60, loadedTiles: 32 });
  expect(stringify).not.toHaveBeenCalled();
  expect(storage.setItem).not.toHaveBeenCalled();
});

it("persists each changed setting and ignores repeated values", async () => {
  const storage = mockStorage();
  const { useMapStore } = await import("@/map/store");
  const state = useMapStore.getState();

  state.setQuality("performance");
  state.setQuality("performance");
  state.setPalette("daylight");
  state.setPalette("midnight");
  state.setView("flat");
  state.toggleView();
  state.setLayerFlag("showHousenumbers", false);
  state.setLayerFlag("showPois", false);
  state.setLayerFlag("showStreetNames", false);
  useMapStore.setState({ quality: "quality" });

  expect(storage.setItem).toHaveBeenCalledTimes(8);
  expect(JSON.parse(storage.getItem(STORAGE_NAME) ?? "null")).toEqual({
    state: {
      palette: "midnight",
      quality: "quality",
      showHousenumbers: false,
      showPois: false,
      showStreetNames: false,
      view: "perspective",
    },
    version: 0,
  });
});

it("hydrates saved preferences without writing them back on camera updates", async () => {
  const storage = mockStorage();
  const firstSession = await import("@/map/store");
  firstSession.useMapStore.getState().setQuality("performance");
  firstSession.useMapStore.getState().setLayerFlag("showPois", false);
  vi.resetModules();
  storage.setItem.mockClear();
  const { useMapStore } = await import("@/map/store");
  expect(useMapStore.persist.hasHydrated()).toBe(true);
  expect(useMapStore.getState()).toMatchObject({
    quality: "performance",
    showPois: false,
  });

  useMapStore.getState().setFps(60);
  useMapStore
    .getState()
    .setCamera({ ...useMapStore.getState().camera, zoom: 16 });
  expect(storage.setItem).not.toHaveBeenCalled();

  useMapStore.setState(useMapStore.getInitialState(), true);
  expect(storage.setItem).toHaveBeenCalledTimes(1);
  expect(useMapStore.getState().quality).toBe("balanced");
});

it("does not recreate cleared storage for counters and still saves later changes", async () => {
  const storage = mockStorage();
  const { useMapStore } = await import("@/map/store");
  useMapStore.getState().setQuality("performance");
  useMapStore.persist.clearStorage();
  storage.setItem.mockClear();

  useMapStore.getState().setLoadedTiles(50);
  expect(storage.getItem(STORAGE_NAME)).toBeNull();
  expect(storage.setItem).not.toHaveBeenCalled();

  useMapStore.getState().setQuality("balanced");
  expect(storage.setItem).toHaveBeenCalledTimes(1);
});

it("refreshes the comparison baseline when preferences are rehydrated", async () => {
  const storage = mockStorage();
  const { useMapStore } = await import("@/map/store");
  storage.setItem(
    STORAGE_NAME,
    JSON.stringify({ state: { palette: "midnight", view: "flat" }, version: 0 })
  );
  storage.setItem.mockClear();

  await useMapStore.persist.rehydrate();
  expect(useMapStore.getState()).toMatchObject({
    palette: "midnight",
    quality: "balanced",
    view: "flat",
  });
  useMapStore.getState().setFps(45);
  useMapStore.getState().setPalette("midnight");
  expect(storage.setItem).not.toHaveBeenCalled();

  useMapStore.getState().setPalette("daylight");
  expect(storage.setItem).toHaveBeenCalledTimes(1);
});

it("imports with default state when server rendering has no localStorage", async () => {
  vi.stubGlobal("localStorage", null);
  Reflect.deleteProperty(globalThis, "localStorage");
  const { useMapStore } = await import("@/map/store");
  expect(useMapStore.getState()).toMatchObject({
    fps: 0,
    quality: "balanced",
    view: "perspective",
  });
});

it("recovers from malformed stored JSON on the next preference change", async () => {
  const storage = mockStorage("{");
  const { useMapStore } = await import("@/map/store");
  useMapStore.getState().setFps(60);
  expect(storage.setItem).not.toHaveBeenCalled();

  useMapStore.getState().setQuality("performance");
  expect(storage.setItem).toHaveBeenCalledTimes(1);
});
