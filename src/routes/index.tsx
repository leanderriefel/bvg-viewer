import { ClientOnly, createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

import { MapBootScreen } from "@/components/map/boot-screen";

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
  return (
    <ClientOnly fallback={<MapBootScreen />}>
      <Suspense fallback={<MapBootScreen />}>
        <AppShell />
      </Suspense>
    </ClientOnly>
  );
}
