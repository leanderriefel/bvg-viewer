import { useCallback, useEffect, useRef, useState } from "react";

import type { PreparationProgress } from "@/map/preparation";

import { BootShader } from "./boot-shader";

const MINIMUM_OPENING_MS = 1100;
const REVEAL_MS = 900;
const SLOW_CONNECTION_MS = 15_000;

interface Props {
  ready?: boolean;
  onEnter?: () => void;
  progress?: PreparationProgress;
  destination?: boolean;
}

function getLoadingStatus({
  progress,
  destination,
  ready,
  slow,
}: Props & { slow: boolean }): string {
  if (progress?.stage === "error") {
    return progress.error ?? "Unable to load the map. Please try again.";
  }
  if (ready) {
    return "Map ready";
  }
  if (progress?.stage === "warming") {
    return "Preparing map…";
  }
  if (slow) {
    return "The map is taking longer to load.";
  }
  return destination ? "Loading destination…" : "Loading map…";
}

/** One continuous surface from the server's first paint to the rendered map. */
export function MapBootScreen({
  ready = false,
  onEnter,
  progress,
  destination = false,
}: Props) {
  const [phase, setPhase] = useState<"loading" | "revealing" | "complete">(
    "loading"
  );
  const [slow, setSlow] = useState(false);
  const startedAt = useRef<number | null>(null);

  const enter = useCallback(() => {
    setPhase("revealing");
    onEnter?.();
  }, [onEnter]);

  useEffect(() => {
    if (phase !== "loading") {
      return;
    }
    startedAt.current = performance.now();
    const timer = window.setTimeout(() => setSlow(true), SLOW_CONNECTION_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    if (!ready || phase !== "loading") {
      return;
    }
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    const elapsed = performance.now() - (startedAt.current ?? 0);
    const delay = reducedMotion ? 0 : Math.max(0, MINIMUM_OPENING_MS - elapsed);
    const timer = window.setTimeout(enter, delay);
    return () => window.clearTimeout(timer);
  }, [ready, phase, enter]);

  useEffect(() => {
    if (phase !== "revealing") {
      return;
    }
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    const timer = window.setTimeout(
      () => setPhase("complete"),
      reducedMotion ? 180 : REVEAL_MS
    );
    return () => window.clearTimeout(timer);
  }, [phase]);

  if (phase === "complete") {
    return null;
  }

  const failed = progress?.stage === "error";
  const total = progress?.total ?? 0;
  const completed = progress?.completed ?? 0;
  const status = getLoadingStatus({ progress, destination, ready, slow });

  return (
    <section
      aria-label="Loading Berlin map"
      className="boot-screen"
      data-phase={phase}
      data-ready={ready}
      inert={phase === "revealing"}
    >
      <div aria-hidden="true" className="boot-screen__art">
        {!destination && <BootShader />}
      </div>
      <div className="boot-screen__content">
        <h1 className="boot-screen__title">
          Berlin<span className="sr-only"> in 3D</span>
        </h1>
        {!failed && (
          <progress
            aria-label="Loading map data"
            className="boot-screen__track"
            max={total || 100}
            value={total ? completed : undefined}
          />
        )}
        <output className="boot-screen__status">{status}</output>
        {(failed || (slow && !ready && progress?.stage !== "warming")) && (
          <button
            className="boot-screen__retry"
            onClick={() => window.location.reload()}
            type="button"
          >
            Try again
          </button>
        )}
      </div>
    </section>
  );
}
