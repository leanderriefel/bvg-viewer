import { afterEach, expect, it, vi } from "vite-plus/test";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

it("registers immediately and once without an idle callback", async () => {
  const register = vi.fn().mockResolvedValue({});
  vi.stubGlobal("navigator", { serviceWorker: { register } });
  const { registerServiceWorker } = await import("@/map/offline");

  registerServiceWorker();
  registerServiceWorker();

  expect(register).toHaveBeenCalledExactlyOnceWith("/sw.js", { scope: "/" });
});

it("does not block or reject when registration fails", async () => {
  vi.stubGlobal("navigator", {
    serviceWorker: {
      register: vi.fn().mockRejectedValue(new Error("Offline")),
    },
  });
  const { registerServiceWorker } = await import("@/map/offline");

  expect(registerServiceWorker()).toBeUndefined();
  await Promise.resolve();
});

it("supports browsers without service workers", async () => {
  vi.stubGlobal("navigator", {});
  const { registerServiceWorker } = await import("@/map/offline");

  expect(registerServiceWorker()).toBeUndefined();
});
