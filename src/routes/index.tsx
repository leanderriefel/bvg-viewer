import { ClientOnly, createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useState } from "react";

import { MapBootScreen } from "@/components/map/boot-screen";
import type { PreparationProgress } from "@/map/preparation";

/**
 * MapLibre touches `document` while its module is still evaluating, so it can
 * never be part of the server bundle - importing it statically anywhere in this
 * tree crashes SSR before `ClientOnly` gets a chance to bail out. Loading the
 * whole shell lazily keeps the map engine out of the server graph entirely, and
 * gives us a separate chunk that only downloads once hydration has started.
 */
const AppShell = lazy(async () => {
  const mod = await import("@/components/map/app-shell");
  return { default: mod.AppShell };
});

export const Route = createFileRoute("/")({
  component: Home,
  head: () => ({
    meta: [
      { title: "Berlin in 3D" },
      {
        content:
          "An interactive 3D map of Berlin built from OpenStreetMap data - buildings, parks, streets and the Spree, at 60fps.",
        name: "description",
      },
    ],
  }),
});

function Home() {
  const [entered, setEntered] = useState(false);
  const [progress, setProgress] = useState<PreparationProgress>();
  const onEnter = useCallback(() => setEntered(true), []);
  const ready = progress?.stage === "ready";

  return (
    <>
      <ClientOnly fallback={null}>
        <Suspense fallback={null}>
          <AppShell entered={entered} onProgress={setProgress} />
        </Suspense>
      </ClientOnly>
      <MapBootScreen onEnter={onEnter} progress={progress} ready={ready} />
    </>
  );
}
