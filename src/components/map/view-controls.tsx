import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useMapStore } from "@/map/store";
import type { QualityLevel } from "@/map/theme/build-style";
import { PALETTE_ORDER, PALETTES } from "@/map/theme/palette";

import { CheckIcon, CubeIconC, LayersIcon, MapFlatIcon } from "./icons";

const QUALITY_COPY: Record<QualityLevel, { label: string; hint: string }> = {
  balanced: {
    hint: "Capped resolution; the horizon falls back to simple massing blocks. The default.",
    label: "Balanced",
  },
  performance: {
    hint: "1x resolution, no antialiasing; detailed buildings only up close, massing blocks beyond. Smoothest on laptops.",
    label: "Performance",
  },
  quality: {
    hint: "Native resolution with antialiasing. Wants a real GPU.",
    label: "Quality",
  },
};

/** Swatch strip that previews a palette without having to apply it. */
function PaletteSwatch({ id }: { id: keyof typeof PALETTES }) {
  const p = PALETTES[id];
  const colors = [p.background, p.park, p.water, p.buildingMid, p.buildingHigh];

  return (
    <span className="ring-border flex h-5 w-12 overflow-hidden rounded-[4px] ring-1">
      {colors.map((c) => (
        <span className="flex-1" key={c} style={{ backgroundColor: c }} />
      ))}
    </span>
  );
}

export function ViewControls() {
  const palette = useMapStore((s) => s.palette);
  const setPalette = useMapStore((s) => s.setPalette);
  const view = useMapStore((s) => s.view);
  const setView = useMapStore((s) => s.setView);
  const quality = useMapStore((s) => s.quality);
  const setQuality = useMapStore((s) => s.setQuality);

  const showHousenumbers = useMapStore((s) => s.showHousenumbers);
  const showPois = useMapStore((s) => s.showPois);
  const showStreetNames = useMapStore((s) => s.showStreetNames);
  const setLayerFlag = useMapStore((s) => s.setLayerFlag);

  return (
    <div className="flex items-center gap-2">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-label={view === "flat" ? "Switch to 3D" : "Switch to 2D"}
            className="bg-card/80 size-10 rounded-xl shadow-sm backdrop-blur-md"
            onClick={() => setView(view === "flat" ? "perspective" : "flat")}
            size="icon"
            variant="outline"
          >
            {view === "flat" ? (
              <CubeIconC size={17} />
            ) : (
              <MapFlatIcon size={17} />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left">
          {view === "flat" ? "Switch to 3D" : "Switch to flat 2D"}
        </TooltipContent>
      </Tooltip>

      <Popover>
        <PopoverTrigger asChild>
          <Button
            aria-label="Map style and layers"
            className="bg-card/80 size-10 rounded-xl shadow-sm backdrop-blur-md"
            size="icon"
            variant="outline"
          >
            <LayersIcon size={17} />
          </Button>
        </PopoverTrigger>

        <PopoverContent align="end" className="w-80 p-0" side="bottom">
          <div className="px-4 pt-4 pb-3">
            <h3 className="font-heading text-sm">Theme</h3>
            <p className="text-muted-foreground text-xs">
              {PALETTES[palette].blurb}
            </p>
          </div>

          <div className="px-2 pb-3">
            {PALETTE_ORDER.map((id) => (
              <button
                className={cn(
                  "hover:bg-accent flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors",
                  id === palette && "bg-accent"
                )}
                key={id}
                onClick={() => setPalette(id)}
                type="button"
              >
                <PaletteSwatch id={id} />
                <span className="flex-1 text-sm">{PALETTES[id].label}</span>
                {id === palette && <CheckIcon size={15} />}
              </button>
            ))}
          </div>

          <Separator />

          <div className="px-4 py-3">
            <h3 className="font-heading pb-2 text-sm">Rendering</h3>
            <ToggleGroup
              className="w-full"
              onValueChange={(v) => v && setQuality(v as QualityLevel)}
              type="single"
              value={quality}
              variant="outline"
            >
              {(Object.keys(QUALITY_COPY) as QualityLevel[]).map((q) => (
                <ToggleGroupItem className="flex-1 text-xs" key={q} value={q}>
                  {QUALITY_COPY[q].label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <p className="text-muted-foreground pt-2 text-xs">
              {QUALITY_COPY[quality].hint}
            </p>
          </div>

          <Separator />

          <div className="space-y-3 px-4 py-3">
            <h3 className="font-heading text-sm">Layers</h3>

            <LayerToggle
              checked={showStreetNames}
              id="street-names"
              label="Street names"
              onChange={(v) => setLayerFlag("showStreetNames", v)}
            />
            <LayerToggle
              checked={showPois}
              id="pois"
              label="Points of interest"
              onChange={(v) => setLayerFlag("showPois", v)}
            />
            <LayerToggle
              checked={showHousenumbers}
              hint="Only from zoom 17.5"
              id="housenumbers"
              label="House numbers"
              onChange={(v) => setLayerFlag("showHousenumbers", v)}
            />
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function LayerToggle({
  id,
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <Label
          className={cn("text-sm", disabled && "text-muted-foreground")}
          htmlFor={id}
        >
          {label}
        </Label>
        {hint && (
          <p className="text-muted-foreground text-xs leading-tight">{hint}</p>
        )}
      </div>
      <Switch
        checked={checked && !disabled}
        disabled={disabled}
        id={id}
        onCheckedChange={onChange}
      />
    </div>
  );
}
