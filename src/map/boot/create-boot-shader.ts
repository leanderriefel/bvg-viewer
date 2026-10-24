import { clock, effect, frame, frameLoop, init, surface } from "vgpu";
import type { Frame, FrameLoopHandle } from "vgpu";

import lightShader from "./light.wgsl";

/** Owns every resource for this temporary scene, including setup canceled mid-flight. */
export async function createBootShader(
  canvas: HTMLCanvasElement,
  signal: AbortSignal,
  onUnavailable: () => void
): Promise<() => void> {
  const gpu = await init({
    label: "Berlin opening",
    powerPreference: "low-power",
  });
  if (signal.aborted) {
    gpu.dispose();
    signal.throwIfAborted();
  }

  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let loop: FrameLoopHandle | undefined;
  let unsubscribeError: (() => void) | undefined;
  let disposed = false;
  let updatePlayback: (() => void) | undefined;

  function dispose() {
    if (disposed) {
      return;
    }
    disposed = true;
    loop?.stop();
    unsubscribeError?.();
    signal.removeEventListener("abort", dispose);
    if (updatePlayback) {
      document.removeEventListener("visibilitychange", updatePlayback);
      window.removeEventListener("resize", updatePlayback);
      motion.removeEventListener("change", updatePlayback);
    }
    gpu.dispose();
  }

  function fallback() {
    if (!disposed) {
      onUnavailable();
      dispose();
    }
  }

  // Bound fragment work while the map is also compiling and uploading its tiles.
  const dpr = Math.min(
    1,
    1440 / Math.max(canvas.clientWidth, canvas.clientHeight, 1)
  );

  try {
    signal.addEventListener("abort", dispose, { once: true });
    unsubscribeError = gpu.onError(fallback);
    const screen = surface(gpu, canvas, {
      dpr,
      label: "Berlin opening surface",
    });
    const params = { resolution: screen.size, time: 0 };
    const bindings = { params };
    const light = effect(gpu, lightShader, {
      label: "Berlin opening light",
      set: bindings,
    });
    await light.compile(screen);

    if (signal.aborted || disposed) {
      throw new Error("Berlin opening ended before its shader was ready");
    }

    const time = clock(gpu);

    const draw = (currentFrame: Frame) => {
      try {
        params.resolution = screen.size;
        params.time = motion.matches ? 1 : time.time;
        light.set(bindings);
        currentFrame.pass(screen, light);
      } catch {
        currentFrame.cancel();
        fallback();
      }
    };

    const play = () => {
      loop?.stop();
      if (disposed || document.hidden) {
        return;
      }
      try {
        if (motion.matches) {
          frame(gpu, draw);
        } else {
          loop = frameLoop(gpu, draw, { fps: 30 });
        }
      } catch {
        fallback();
      }
    };

    updatePlayback = play;
    document.addEventListener("visibilitychange", updatePlayback);
    window.addEventListener("resize", updatePlayback);
    motion.addEventListener("change", updatePlayback);
    play();

    if (disposed) {
      throw new Error("Berlin opening could not render its first frame");
    }

    const watchDevice = async () => {
      await gpu.lost;
      fallback();
    };
    void watchDevice();

    return dispose;
  } catch (error) {
    dispose();
    throw error;
  }
}
