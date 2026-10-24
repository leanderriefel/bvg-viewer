import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { createBootShader } from "./create-boot-shader";

const renderer = vi.hoisted(() => {
  const unsubscribeError = vi.fn();
  const gpu = {
    dispose: vi.fn(),
    lost: Promise.resolve(null),
    onError: vi.fn(() => unsubscribeError),
  };
  const light = { compile: vi.fn<() => Promise<null>>(), set: vi.fn() };
  const currentFrame = { cancel: vi.fn(), pass: vi.fn() };
  const loop = { stop: vi.fn() };

  return {
    clock: vi.fn(() => ({ time: 0 })),
    currentFrame,
    effect: vi.fn(() => light),
    frame: vi.fn(
      (_gpu: typeof gpu, draw: (value: typeof currentFrame) => void) =>
        draw(currentFrame)
    ),
    frameLoop: vi.fn(() => loop),
    gpu,
    init: vi.fn<() => Promise<typeof gpu>>(),
    light,
    loop,
    surface: vi.fn(() => ({ size: [1024, 768] })),
    unsubscribeError,
  };
});

vi.mock("vgpu", () => renderer);

function deferred<T>(initialValue: T) {
  let resolvePromise = (_value: T = initialValue): void => {
    throw new Error("Deferred promise is not initialized");
  };
  // A controllable promise lets tests abort while GPU setup is still pending.
  // eslint-disable-next-line promise/avoid-new
  const promise = new Promise<T>((resolve) => {
    resolvePromise = (value = initialValue) => resolve(value);
  });
  return { promise, resolve: resolvePromise };
}

let browserWindow: EventTarget;
let browserDocument: EventTarget;
let motion: EventTarget & { matches: boolean };

// The renderer only reads canvas layout; WebGPU itself is mocked above.
const canvas = { clientWidth: 1024, clientHeight: 768 } as HTMLCanvasElement;

beforeEach(() => {
  vi.clearAllMocks();
  renderer.init.mockResolvedValue(renderer.gpu);
  renderer.light.compile.mockResolvedValue(null);
  renderer.currentFrame.pass.mockReset();
  renderer.gpu.lost = deferred(null).promise;

  motion = Object.assign(new EventTarget(), { matches: false });
  browserWindow = Object.assign(new EventTarget(), {
    matchMedia: () => motion,
  });
  browserDocument = Object.assign(new EventTarget(), { hidden: false });
  vi.stubGlobal("window", browserWindow);
  vi.stubGlobal("document", browserDocument);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("disposes an adapter acquired after setup was aborted without starting frames", async () => {
  const initialization = deferred(renderer.gpu);
  renderer.init.mockReturnValue(initialization.promise);
  const controller = new AbortController();
  const result = createBootShader(canvas, controller.signal, vi.fn());
  const rejection = expect(result).rejects.toMatchObject({
    name: "AbortError",
  });

  controller.abort();
  initialization.resolve(renderer.gpu);
  await rejection;

  expect(renderer.gpu.dispose).toHaveBeenCalledOnce();
  expect(renderer.surface).not.toHaveBeenCalled();
  expect(renderer.frameLoop).not.toHaveBeenCalled();
});

it("disposes immediately when aborted during compilation and never starts playback", async () => {
  const compilation = deferred(null);
  renderer.light.compile.mockReturnValue(compilation.promise);
  const controller = new AbortController();
  const result = createBootShader(canvas, controller.signal, vi.fn());
  const rejection = expect(result).rejects.toThrow(
    "ended before its shader was ready"
  );
  await vi.waitFor(() => expect(renderer.light.compile).toHaveBeenCalledOnce());

  controller.abort();
  expect(renderer.gpu.dispose).toHaveBeenCalledOnce();
  compilation.resolve();
  await rejection;

  expect(renderer.gpu.dispose).toHaveBeenCalledOnce();
  expect(renderer.frame).not.toHaveBeenCalled();
  expect(renderer.frameLoop).not.toHaveBeenCalled();
  expect(renderer.unsubscribeError).toHaveBeenCalledOnce();
});

it("releases the GPU and rejects when native shader compilation fails", async () => {
  const compilationError = new Error("Shader compilation failed");
  renderer.light.compile.mockRejectedValue(compilationError);

  await expect(
    createBootShader(canvas, new AbortController().signal, vi.fn())
  ).rejects.toBe(compilationError);

  expect(renderer.gpu.dispose).toHaveBeenCalledOnce();
  expect(renderer.unsubscribeError).toHaveBeenCalledOnce();
  expect(renderer.frameLoop).not.toHaveBeenCalled();
});

it("stops playback and removes browser and abort listeners on idempotent disposal", async () => {
  const controller = new AbortController();
  const removeAbort = vi.spyOn(controller.signal, "removeEventListener");
  const removeVisibility = vi.spyOn(browserDocument, "removeEventListener");
  const removeResize = vi.spyOn(browserWindow, "removeEventListener");
  const removeMotion = vi.spyOn(motion, "removeEventListener");
  const dispose = await createBootShader(canvas, controller.signal, vi.fn());

  expect(renderer.frameLoop).toHaveBeenCalledOnce();
  dispose();
  dispose();

  expect(renderer.loop.stop).toHaveBeenCalledOnce();
  expect(renderer.gpu.dispose).toHaveBeenCalledOnce();
  expect(renderer.unsubscribeError).toHaveBeenCalledOnce();
  expect(removeAbort).toHaveBeenCalledWith("abort", expect.any(Function));
  expect(removeVisibility).toHaveBeenCalledWith(
    "visibilitychange",
    expect.any(Function)
  );
  expect(removeResize).toHaveBeenCalledWith("resize", expect.any(Function));
  expect(removeMotion).toHaveBeenCalledWith("change", expect.any(Function));
});

it("draws a static reduced-motion frame and redraws after a viewport resize", async () => {
  motion.matches = true;
  const dispose = await createBootShader(
    canvas,
    new AbortController().signal,
    vi.fn()
  );

  expect(renderer.frame).toHaveBeenCalledOnce();
  expect(renderer.currentFrame.pass).toHaveBeenCalledOnce();
  expect(renderer.frameLoop).not.toHaveBeenCalled();
  browserWindow.dispatchEvent(new Event("resize"));
  expect(renderer.frame).toHaveBeenCalledTimes(2);
  expect(renderer.currentFrame.pass).toHaveBeenCalledTimes(2);

  dispose();
  browserWindow.dispatchEvent(new Event("resize"));
  expect(renderer.frame).toHaveBeenCalledTimes(2);
});

it("rejects setup instead of revealing a disposed shader when the first static frame fails", async () => {
  motion.matches = true;
  renderer.currentFrame.pass.mockImplementation(() => {
    throw new Error("Canvas presentation failed");
  });
  const onUnavailable = vi.fn();

  await expect(
    createBootShader(canvas, new AbortController().signal, onUnavailable)
  ).rejects.toThrow("could not render its first frame");

  expect(onUnavailable).toHaveBeenCalledOnce();
  expect(renderer.currentFrame.cancel).toHaveBeenCalledOnce();
  expect(renderer.gpu.dispose).toHaveBeenCalledOnce();
});

it("falls back and releases playback when the device is lost", async () => {
  const loss = deferred(null);
  renderer.gpu.lost = loss.promise;
  const onUnavailable = vi.fn();
  const dispose = await createBootShader(
    canvas,
    new AbortController().signal,
    onUnavailable
  );

  loss.resolve();
  await vi.waitFor(() => expect(onUnavailable).toHaveBeenCalledOnce());

  expect(renderer.loop.stop).toHaveBeenCalledOnce();
  expect(renderer.gpu.dispose).toHaveBeenCalledOnce();
  dispose();
  expect(renderer.gpu.dispose).toHaveBeenCalledOnce();
});
