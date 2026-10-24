import { useCallback, useEffect, useState } from "react";

import { TooltipProvider } from "@/components/ui/tooltip";
import { registerServiceWorker } from "@/map/offline";
import type { PreparationProgress } from "@/map/preparation";
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

interface Props {
  entered: boolean;
  onProgress: (progress: PreparationProgress) => void;
}

export function AppShell({ entered, onProgress }: Props) {
  useThemeSync();
  const [controlsReady, setControlsReady] = useState(false);
  const onArrival = useCallback(() => setControlsReady(true), []);

  useEffect(() => {
    registerServiceWorker();
  }, []);

  return (
    <TooltipProvider delayDuration={300}>
      <main
        className="world-surface bg-background relative h-dvh w-full overflow-hidden"
        data-entered={entered}
        inert={!entered}
      >
        <MapCanvas
          arrived={controlsReady}
          entered={entered}
          onArrival={onArrival}
          onProgress={onProgress}
        >
          {/* One pointer-events-none overlay so the map keeps every drag and
              wheel event; each panel opts back in for itself. */}
          {controlsReady && (
            <div className="world-controls pointer-events-none absolute inset-0 flex flex-col p-3 sm:p-4">
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
          )}
        </MapCanvas>
      </main>
    </TooltipProvider>
  );
}
