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
import { cn } from "@/lib/utils";
import { useMapStore } from "@/map/store";
import type { QualityLevel } from "@/map/theme/build-style";
import { PALETTE_ORDER, PALETTES } from "@/map/theme/palette";

import { CheckIcon, LayersIcon, PlusIcon } from "./icons";

const QUALITY_COPY: Record<QualityLevel, { label: string; hint: string }> = {
  balanced: {
    hint: "A balance of detail and smooth navigation. Recommended for most devices.",
    label: "Balanced",
  },
  performance: {
    hint: "Less detail in the distance for smoother navigation and lower battery use.",
    label: "Performance",
  },
  quality: {
    hint: "Sharper edges and full resolution. Best on a device with a dedicated GPU.",
    label: "Quality",
  },
};

/** Swatch strip that previews a palette without having to apply it. */
function PaletteSwatch({ id }: { id: keyof typeof PALETTES }) {
  const p = PALETTES[id];
  const colors = [p.background, p.park, p.water, p.buildingMid, p.buildingHigh];

  return (
    <span className="ring-border flex h-8 w-full overflow-hidden rounded-lg ring-1">
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
    <div className="map-panel flex items-center gap-0.5 rounded-xl p-0.5">
      <fieldset
        aria-label="Map view"
        className="bg-muted/70 flex rounded-lg p-0.5"
      >
        {(["flat", "perspective"] as const).map((mode) => (
          <Button
            aria-label={mode === "flat" ? "2D map" : "3D map"}
            aria-pressed={view === mode}
            className={cn(
              "text-muted-foreground h-7 rounded-md px-2.5 text-[11px]",
              view === mode && "bg-background text-foreground shadow-xs"
            )}
            key={mode}
            onClick={() => setView(mode)}
            variant="ghost"
          >
            {mode === "flat" ? "2D" : "3D"}
          </Button>
        ))}
      </fieldset>

      <span className="bg-border mx-1 h-4 w-px" />

      <Popover>
        <PopoverTrigger asChild>
          <Button
            aria-label="Map style and layers"
            className="h-8 gap-1.5 rounded-lg px-2.5 text-xs"
            variant="ghost"
          >
            <LayersIcon size={15} />
            Layers
          </Button>
        </PopoverTrigger>

        <PopoverContent
          align="end"
          className="max-h-(--radix-popover-content-available-height) w-80 max-w-[calc(100vw-2rem)] gap-0 overflow-y-auto rounded-2xl p-0"
          side="bottom"
          sideOffset={10}
        >
          <div className="px-4 pt-4 pb-3">
            <h2 className="text-sm font-semibold">Map appearance</h2>
            <p className="text-muted-foreground mt-1 text-xs">
              Choose a theme and what you see.
            </p>
          </div>

          <fieldset
            aria-label="Map theme"
            className="grid grid-cols-3 gap-2 px-4 pb-4"
          >
            {PALETTE_ORDER.map((id) => (
              <button
                aria-pressed={id === palette}
                className={cn(
                  "hover:bg-accent focus-visible:outline-ring rounded-xl border border-transparent p-1.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2",
                  id === palette && "border-border bg-accent"
                )}
                key={id}
                onClick={() => setPalette(id)}
                type="button"
              >
                <PaletteSwatch id={id} />
                <span className="mt-2 flex items-center justify-between gap-1 text-[11px]">
                  {PALETTES[id].label}
                  {id === palette && <CheckIcon size={12} />}
                </span>
              </button>
            ))}
          </fieldset>

          <Separator />

          <details className="group px-4 py-3">
            <summary className="focus-visible:outline-ring flex min-h-7 cursor-pointer list-none items-center gap-2 rounded-sm text-xs focus-visible:outline-2 [&::-webkit-details-marker]:hidden">
              <span className="flex-1 font-medium">Rendering quality</span>
              <span className="text-muted-foreground">
                {QUALITY_COPY[quality].label}
              </span>
              <PlusIcon
                className="text-muted-foreground transition-transform group-open:rotate-45"
                size={13}
              />
            </summary>
            <div className="pt-3">
              <ToggleGroup
                className="w-full"
                onValueChange={(v) => v && setQuality(v as QualityLevel)}
                type="single"
                value={quality}
                variant="outline"
              >
                {(Object.keys(QUALITY_COPY) as QualityLevel[]).map((q) => (
                  <ToggleGroupItem
                    className="flex-1 rounded-lg text-xs"
                    key={q}
                    value={q}
                  >
                    {QUALITY_COPY[q].label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <p className="text-muted-foreground pt-2 text-xs">
                {QUALITY_COPY[quality].hint}
              </p>
            </div>
          </details>

          <Separator />

          <div className="space-y-4 px-4 pt-4 pb-5">
            <h3 className="text-xs font-semibold">Map labels</h3>

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
