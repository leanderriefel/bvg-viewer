import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { formatLngLat } from "@/lib/geo";
import { useMapStore } from "@/map/store";

import {
  BuildingIcon,
  CloseIcon,
  CopyIcon,
  PinIcon,
  RulerIconC,
} from "./icons";

/**
 * Details for whatever was last clicked. Buildings get a height read-out and an
 * estimated storey count; everything else falls back to the raw tile
 * attributes, which is genuinely the interesting part when poking at OSM data.
 */
export function FeatureInspector() {
  const selection = useMapStore((s) => s.selection);
  const setSelection = useMapStore((s) => s.setSelection);

  if (!selection) {
    return null;
  }

  const title =
    selection.name ??
    (selection.kind === "building" ? "Unnamed building" : "Unnamed feature");

  const copyCoords = () => {
    void navigator.clipboard?.writeText(formatLngLat(selection.center));
  };

  return (
    <aside className="bg-card/90 pointer-events-auto w-[19rem] overflow-hidden rounded-2xl border shadow-lg backdrop-blur-md">
      <header className="flex items-start gap-2 px-4 pt-3.5 pb-3">
        <span className="bg-muted text-muted-foreground mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg">
          {selection.kind === "building" ? (
            <BuildingIcon size={16} />
          ) : (
            <PinIcon size={16} />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <h2 className="font-heading truncate text-sm leading-tight">
            {title}
          </h2>
          <p className="text-muted-foreground truncate text-xs">
            {[selection.street, selection.housenumber]
              .filter(Boolean)
              .join(" ") || "Berlin"}
          </p>
        </div>

        <Button
          aria-label="Close details"
          className="size-7 shrink-0"
          onClick={() => setSelection(null)}
          size="icon"
          variant="ghost"
        >
          <CloseIcon size={14} />
        </Button>
      </header>

      {typeof selection.height === "number" && (
        <>
          <Separator />
          <div className="flex items-center gap-4 px-4 py-3">
            <RulerIconC className="text-muted-foreground" size={16} />
            <div>
              <div className="font-heading text-lg leading-none">
                {selection.height.toFixed(1)} m
              </div>
              <div className="text-muted-foreground text-xs">
                roughly {selection.levels} floor
                {selection.levels === 1 ? "" : "s"}
              </div>
            </div>
          </div>
        </>
      )}

      {selection.details.length > 0 && (
        <>
          <Separator />
          <dl className="flex flex-wrap gap-1.5 px-4 py-3">
            {selection.details.map(([k, v]) => (
              <Badge className="font-normal" key={k} variant="secondary">
                <span className="text-muted-foreground">{k}</span>
                <span className="ml-1">{v}</span>
              </Badge>
            ))}
          </dl>
        </>
      )}

      <Separator />
      <button
        className="text-muted-foreground hover:bg-accent hover:text-foreground flex w-full items-center gap-2 px-4 py-2.5 text-left text-xs transition-colors"
        onClick={copyCoords}
        type="button"
      >
        <CopyIcon size={13} />
        <span className="font-mono">{formatLngLat(selection.center)}</span>
      </button>
    </aside>
  );
}
