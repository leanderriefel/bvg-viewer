import { useEffect, useRef, useState } from "react";

/** GPU code loads independently, so an unavailable adapter cannot hold up Berlin. */
export function BootShader() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !("gpu" in navigator)) {
      return;
    }

    const controller = new AbortController();
    let dispose: (() => void) | undefined;
    let available = true;

    const start = async () => {
      try {
        const { createBootShader } =
          await import("@/map/boot/create-boot-shader");
        if (controller.signal.aborted) {
          return;
        }
        dispose = await createBootShader(canvas, controller.signal, () => {
          available = false;
          setVisible(false);
        });
        if (!controller.signal.aborted && available) {
          setVisible(true);
        }
      } catch {
        // The soft CSS background stays visible if WebGPU is unavailable or lost.
        if (!controller.signal.aborted) {
          setVisible(false);
        }
      }
    };

    void start();
    return () => {
      controller.abort();
      dispose?.();
    };
  }, []);

  return (
    <canvas
      aria-hidden="true"
      className="boot-screen__shader"
      data-visible={visible}
      ref={canvasRef}
    />
  );
}
