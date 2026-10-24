import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useMapApi } from "@/map/map-context";
import { useMapStore } from "@/map/store";

import { CompassIcon, InfoIcon, MinusIcon, PlusIcon } from "./icons";

export function MapControls() {
  const { map, resetNorth } = useMapApi();
  const bearing = useMapStore((s) => s.camera.bearing);
  const pitch = useMapStore((s) => s.camera.pitch);
  const view = useMapStore((s) => s.view);

  return (
    <fieldset
      aria-label="Map navigation"
      className="map-panel pointer-events-auto flex flex-col items-center overflow-hidden rounded-xl p-0.5"
    >
      {view === "perspective" && (
        <>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label="Reset bearing to north"
                className="size-9 rounded-lg"
                onClick={resetNorth}
                size="icon"
                variant="ghost"
              >
                <span
                  className="block"
                  style={{ transform: `rotate(${-bearing}deg)` }}
                >
                  <CompassIcon size={16} />
                </span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">
              Face north · {Math.round(bearing)}° bearing · {Math.round(pitch)}°
              tilt
            </TooltipContent>
          </Tooltip>
          <span className="bg-border my-0.5 h-px w-5" />
        </>
      )}
      <Button
        aria-label="Zoom in"
        className="size-9 rounded-lg"
        onClick={() => map?.zoomIn()}
        size="icon"
        variant="ghost"
      >
        <PlusIcon size={16} />
      </Button>
      <Button
        aria-label="Zoom out"
        className="size-9 rounded-lg"
        onClick={() => map?.zoomOut()}
        size="icon"
        variant="ghost"
      >
        <MinusIcon size={16} />
      </Button>
    </fieldset>
  );
}

function MapDiagnostics() {
  const fps = useMapStore((s) => s.fps);
  const camera = useMapStore((s) => s.camera);
  const tileSource = useMapStore((s) => s.tileSource);
  const loadedTiles = useMapStore((s) => s.loadedTiles);
  const source =
    tileSource === "local" ? "Local Berlin extract" : "OpenFreeMap";
  const stats = [
    ["Frame rate", fps === 0 ? "Idle" : `${fps} fps`],
    ["Zoom", camera.zoom.toFixed(2)],
    [
      "Bearing / tilt",
      `${Math.round(camera.bearing)}° / ${Math.round(camera.pitch)}°`,
    ],
    ["Latitude", camera.center[1].toFixed(5)],
    ["Longitude", camera.center[0].toFixed(5)],
    ["Loaded tiles", String(loadedTiles)],
    ["Map source", tileSource ? source : "Connecting…"],
  ];

  return (
    <>
      <div>
        <h2 className="text-sm font-semibold">Map details</h2>
        <p className="text-muted-foreground mt-1 text-xs">
          Your current view and map performance.
        </p>
      </div>
      <dl className="mt-2 divide-y text-xs">
        {stats.map(([label, value]) => (
          <div className="flex justify-between gap-4 py-2.5" key={label}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-medium tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}

export function StatsHud() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          className="map-panel text-muted-foreground h-8 gap-1.5 rounded-full px-2.5 text-xs"
          variant="ghost"
        >
          <InfoIcon size={14} />
          Map details
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-72 max-w-[calc(100vw-2rem)] gap-0 rounded-2xl p-4"
        side="top"
        sideOffset={10}
      >
        <MapDiagnostics />
      </PopoverContent>
    </Popover>
  );
}
