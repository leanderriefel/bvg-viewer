import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useMapApi } from "@/map/map-context";
import { useMapStore } from "@/map/store";

import { CompassIcon, MinusIcon, PlusIcon } from "./icons";

/** Zoom buttons and a compass that doubles as "reset the camera to north". */
export function MapControls() {
  const { map, resetNorth } = useMapApi();
  const bearing = useMapStore((s) => s.camera.bearing);
  const pitch = useMapStore((s) => s.camera.pitch);
  const view = useMapStore((s) => s.view);

  return (
    <div className="pointer-events-auto flex flex-col items-center gap-2">
      {view === "perspective" && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label="Reset bearing to north"
              className="bg-card/80 size-10 rounded-xl shadow-sm backdrop-blur-md"
              onClick={resetNorth}
              size="icon"
              variant="outline"
            >
              <span
                className="block"
                style={{ transform: `rotate(${-bearing}deg)` }}
              >
                <CompassIcon size={18} />
              </span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">
            {Math.round(bearing)}° · pitch {Math.round(pitch)}°
          </TooltipContent>
        </Tooltip>
      )}

      <div className="bg-card/80 flex flex-col overflow-hidden rounded-xl border shadow-sm backdrop-blur-md">
        <Button
          aria-label="Zoom in"
          className="size-10 rounded-none border-0"
          onClick={() => map?.zoomIn()}
          size="icon"
          variant="ghost"
        >
          <PlusIcon size={16} />
        </Button>
        <div className="bg-border h-px" />
        <Button
          aria-label="Zoom out"
          className="size-10 rounded-none border-0"
          onClick={() => map?.zoomOut()}
          size="icon"
          variant="ghost"
        >
          <MinusIcon size={16} />
        </Button>
      </div>
    </div>
  );
}

const SOURCE_LABEL: Record<string, string> = {
  local: "Local extract",
  openfreemap: "OpenFreeMap",
};

/**
 * Small status strip. The frame rate is here because "is this smooth?" is the
 * whole point of the project, and a number settles the argument.
 */
/** Green when comfortably smooth, amber when noticeable, red when not. */
function toneForFps(fps: number): string {
  if (fps === 0) {
    return "text-muted-foreground";
  }
  if (fps >= 50) {
    return "text-emerald-500";
  }
  if (fps >= 30) {
    return "text-amber-500";
  }
  return "text-red-500";
}

export function StatsHud() {
  const fps = useMapStore((s) => s.fps);
  const zoom = useMapStore((s) => s.camera.zoom);
  const center = useMapStore((s) => s.camera.center);
  const tileSource = useMapStore((s) => s.tileSource);
  const loadedTiles = useMapStore((s) => s.loadedTiles);

  const fpsTone = toneForFps(fps);

  return (
    <div className="bg-card/80 pointer-events-auto hidden items-center gap-3 rounded-xl border px-3 py-1.5 font-mono text-xs shadow-sm backdrop-blur-md md:flex">
      <span className={cn("tabular-nums", fpsTone)}>
        {fps === 0 ? "idle" : `${fps} fps`}
      </span>
      <span className="bg-border h-3 w-px" />
      <span className="text-muted-foreground tabular-nums">
        z{zoom.toFixed(1)}
      </span>
      <span className="bg-border h-3 w-px" />
      <span className="text-muted-foreground tabular-nums">
        {center[1].toFixed(4)}, {center[0].toFixed(4)}
      </span>
      <span className="bg-border h-3 w-px" />
      <span className="text-muted-foreground">
        {tileSource ? SOURCE_LABEL[tileSource] : "connecting…"}
      </span>
      {loadedTiles > 0 && (
        <>
          <span className="bg-border h-3 w-px" />
          <span className="text-muted-foreground tabular-nums">
            {loadedTiles} tiles
          </span>
        </>
      )}
    </div>
  );
}
