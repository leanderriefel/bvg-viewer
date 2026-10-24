import { useCallback, useEffect, useState } from "react";

import { TooltipProvider } from "@/components/ui/tooltip";
import { registerServiceWorker } from "@/map/offline";
import type { PreparationProgress } from "@/map/preparation";
import { useMapStore } from "@/map/store";
import { getPalette } from "@/map/theme/palette";

import { FeatureInspector } from "./feature-inspector";
import { CubeIconC } from "./icons";
import { MapCanvas } from "./map-canvas";
import { MapControls, StatsHud } from "./map-hud";
import { PlacesMenu } from "./places-menu";
import { SearchCommand } from "./search-command";
import { SettingsSheet } from "./settings-sheet";
import { TourControls } from "./tour-controls";
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
  const hasSelection = useMapStore((s) => s.selection !== null);

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
            <div
              className="world-controls map-interface pointer-events-none absolute inset-0"
              data-selection={hasSelection}
            >
              <header className="map-navigator map-panel pointer-events-auto p-2.5">
                <div className="flex items-center gap-2 pb-2">
                  <span className="bg-primary text-primary-foreground flex size-7 items-center justify-center rounded-lg">
                    <CubeIconC size={16} />
                  </span>
                  <h1 className="flex-1 text-sm font-semibold tracking-tight">
                    Berlin{" "}
                    <span className="text-muted-foreground font-normal">
                      in 3D
                    </span>
                  </h1>
                  <PlacesMenu />
                  <SettingsSheet />
                </div>
                <SearchCommand />
              </header>

              <div className="map-view-controls pointer-events-auto">
                <ViewControls />
              </div>
              <div className="map-tour">
                <TourControls />
              </div>
              <div className="map-feature">
                <FeatureInspector />
              </div>
              <div className="map-camera-controls">
                <MapControls />
              </div>
              <div className="map-diagnostics pointer-events-auto">
                <StatsHud />
              </div>
              <TransitPanel />
            </div>
          )}
        </MapCanvas>
      </main>
    </TooltipProvider>
  );
}
