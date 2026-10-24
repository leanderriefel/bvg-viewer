import { useEffect } from "react";

import { TooltipProvider } from "@/components/ui/tooltip";
import { registerServiceWorker } from "@/map/offline";
import { useMapStore } from "@/map/store";
import { getPalette } from "@/map/theme/palette";

import { FeatureInspector } from "./feature-inspector";
import { MapCanvas } from "./map-canvas";
import { MapControls, StatsHud } from "./map-hud";
import { PlacesMenu } from "./places-menu";
import { SearchCommand } from "./search-command";
import { SettingsSheet } from "./settings-sheet";
import { TransitPanel } from "./transit-panel";
import { ViewControls } from "./view-controls";

/**
 * Keeps the shadcn colour scheme in step with the map palette, so the panels
 * sitting on top of a dark basemap are dark too.
 */
function useThemeSync() {
  const palette = useMapStore((s) => s.palette);
  const { scheme } = getPalette(palette);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", scheme === "dark");
    root.style.colorScheme = scheme;
  }, [scheme]);
}

export function AppShell() {
  useThemeSync();

  useEffect(() => {
    registerServiceWorker();
  }, []);

  return (
    <TooltipProvider delayDuration={300}>
      <main className="bg-background relative h-dvh w-full overflow-hidden">
        <MapCanvas>
          {/* One pointer-events-none overlay so the map keeps every drag and
              wheel event; each panel opts back in for itself. */}
          <div className="pointer-events-none absolute inset-0 flex flex-col p-3 sm:p-4">
            <header className="flex items-start justify-between gap-3">
              <div className="pointer-events-auto flex items-center gap-2">
                <PlacesMenu />
                <SearchCommand />
              </div>

              <div className="pointer-events-auto flex items-center gap-2">
                <ViewControls />
                <SettingsSheet />
              </div>
            </header>

            <div className="flex min-h-0 flex-1 items-start justify-between gap-3 pt-3">
              <div className="pointer-events-none">
                <FeatureInspector />
              </div>

              <div className="pt-1">
                <MapControls />
              </div>
            </div>

            <footer className="flex items-end justify-end gap-3 pt-3 pb-3 md:justify-between">
              <StatsHud />
              <TransitPanel />
            </footer>
          </div>
        </MapCanvas>
      </main>
    </TooltipProvider>
  );
}
