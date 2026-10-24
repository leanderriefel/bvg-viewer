import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { clearMapCache, formatBytes, getStorageEstimate } from "@/map/offline";
import type { StorageEstimate } from "@/map/offline";
import { useMapStore } from "@/map/store";

import { InfoIcon } from "./icons";

const SHORTCUTS: [string, string][] = [
  ["⌘K / Ctrl+K", "Search places and addresses"],
  ["/", "Same, without the modifier"],
  ["Drag", "Pan"],
  ["Right-drag", "Rotate and tilt"],
  ["Scroll", "Zoom"],
  ["Shift+drag", "Zoom to a box"],
];

export function SettingsSheet() {
  const [open, setOpen] = useState(false);
  const [storage, setStorage] = useState<StorageEstimate | null>(null);
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState(false);

  const tileSource = useMapStore((s) => s.tileSource);

  const refresh = useCallback(async () => {
    try {
      setStorage(await getStorageEstimate());
    } catch {
      setStorage(null);
    }
  }, []);

  // Reading the browser storage quota is a genuine external system, and it is
  // only read when the panel opens rather than on every render.
  useEffect(() => {
    if (open) {
      // oxlint-disable-next-line react/set-state-in-effect
      void refresh();
    }
  }, [open, refresh]);

  const onClear = async () => {
    setClearing(true);
    setClearError(false);
    try {
      await clearMapCache();
      await refresh();
    } catch {
      setClearError(true);
    } finally {
      setClearing(false);
    }
  };

  return (
    <Sheet onOpenChange={setOpen} open={open}>
      <SheetTrigger asChild>
        <Button
          aria-label="About this map and storage"
          className="text-muted-foreground size-7 rounded-lg"
          size="icon"
          variant="ghost"
        >
          <InfoIcon size={15} />
        </Button>
      </SheetTrigger>

      <SheetContent
        className="w-full gap-6 overflow-y-auto sm:max-w-sm"
        side="right"
      >
        <SheetHeader className="gap-2 px-5 pt-7">
          <SheetTitle className="font-sans text-xl font-semibold tracking-tight">
            About this map
          </SheetTitle>
          <SheetDescription>
            Every building, park, street and river comes from OpenStreetMap.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6 px-5 pb-8">
          <section>
            <h3 className="pb-3 text-sm font-semibold">Map data</h3>
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-muted-foreground">Tile source</span>
              <Badge variant={tileSource === "local" ? "default" : "secondary"}>
                {tileSource === "local"
                  ? "Local Berlin extract"
                  : "OpenFreeMap (hosted)"}
              </Badge>
            </div>
          </section>

          <Separator />

          <section>
            <h3 className="pb-3 text-sm font-semibold">Offline storage</h3>
            {storage ? (
              <>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-2xl font-semibold tracking-tight tabular-nums">
                    {formatBytes(storage.usedBytes)}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    of {formatBytes(storage.quotaBytes)} available
                  </span>
                </div>
                <div className="bg-muted mt-2 h-1.5 overflow-hidden rounded-full">
                  <div
                    className="bg-primary h-full rounded-full"
                    style={{
                      width: `${Math.min(
                        100,
                        (storage.usedBytes / Math.max(1, storage.quotaBytes)) *
                          100
                      ).toFixed(2)}%`,
                    }}
                  />
                </div>
              </>
            ) : (
              <p className="text-muted-foreground text-sm">
                This browser does not report storage usage.
              </p>
            )}

            <p className="text-muted-foreground pt-2 text-xs leading-relaxed">
              Tiles and fonts are cached after first use, so revisiting an area
              costs no network at all.
            </p>

            <Button
              className="mt-3 h-10 w-full rounded-xl"
              disabled={clearing}
              onClick={onClear}
              size="sm"
              variant="outline"
            >
              {clearing ? "Clearing…" : "Clear cached map data"}
            </Button>
            {clearError && (
              <p className="text-destructive mt-2 text-xs" role="alert">
                Cached data could not be cleared. Please try again.
              </p>
            )}
          </section>

          <Separator />

          <section>
            <h3 className="pb-3 text-sm font-semibold">Keyboard & gestures</h3>
            <dl className="space-y-1.5">
              {SHORTCUTS.map(([key, what]) => (
                <div
                  className="flex items-center justify-between gap-3"
                  key={key}
                >
                  <dt className="text-muted-foreground text-sm">{what}</dt>
                  <dd>
                    <kbd className="bg-muted rounded border px-1.5 py-0.5 font-mono text-[10px]">
                      {key}
                    </kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          <Separator />

          <section className="text-muted-foreground text-xs leading-relaxed">
            <p>
              Map data © OpenStreetMap contributors, available under the ODbL.
              Rendered with MapLibre GL JS. Hosted tiles by OpenFreeMap; local
              tiles built with Planetiler.
            </p>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
