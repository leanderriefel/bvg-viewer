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
    <aside
      aria-label="Selected map feature"
      className="map-panel pointer-events-auto max-h-full w-full overflow-y-auto overscroll-contain"
    >
      <header className="flex items-start gap-3 px-4 pt-4 pb-3">
        <span className="bg-muted text-muted-foreground mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg">
          {selection.kind === "building" ? (
            <BuildingIcon size={16} />
          ) : (
            <PinIcon size={16} />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <h2 className="text-sm leading-snug font-semibold tracking-tight">
            {title}
          </h2>
          <p className="text-muted-foreground mt-1 text-xs">
            {[selection.street, selection.housenumber]
              .filter(Boolean)
              .join(" ") || "Berlin"}
          </p>
        </div>

        <Button
          aria-label="Close details"
          className="size-8 shrink-0 rounded-lg"
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
              <div className="text-2xl leading-none font-semibold tracking-tight tabular-nums">
                {selection.height.toFixed(1)} m
              </div>
              <div className="text-muted-foreground mt-1.5 text-xs">
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
          <details className="group px-4 py-3">
            <summary className="focus-visible:outline-ring flex min-h-7 cursor-pointer list-none items-center justify-between rounded-sm text-xs font-medium focus-visible:outline-2 [&::-webkit-details-marker]:hidden">
              Feature properties
              <span
                aria-hidden="true"
                className="text-muted-foreground text-base transition-transform group-open:rotate-90"
              >
                ›
              </span>
            </summary>
            <dl className="mt-2 divide-y text-xs">
              {selection.details.map(([k, v]) => (
                <div
                  className="flex items-baseline justify-between gap-3 py-2"
                  key={k}
                >
                  <dt className="text-muted-foreground break-words">{k}</dt>
                  <dd className="text-right break-words">{v}</dd>
                </div>
              ))}
            </dl>
          </details>
        </>
      )}

      <Separator />
      <button
        className="text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-ring flex min-h-11 w-full items-center gap-2 px-4 py-3 text-left text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-3px]"
        onClick={copyCoords}
        type="button"
      >
        <CopyIcon size={13} />
        <span className="font-mono">{formatLngLat(selection.center)}</span>
      </button>
    </aside>
  );
}
