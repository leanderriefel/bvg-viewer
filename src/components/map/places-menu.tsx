import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  LANDMARKS,
  LANDMARK_CATEGORY_LABEL,
  LANDMARK_CATEGORY_ORDER,
} from "@/map/landmarks";
import type { Landmark, LandmarkCategory } from "@/map/landmarks";
import { useMapApi } from "@/map/map-context";
import { useMapStore } from "@/map/store";

import { CategoryIcon, PinIcon, SearchIcon } from "./icons";

/**
 * The "take me somewhere" panel. Everything here has a hand-picked camera, so
 * the point is browsing rather than searching - the palette covers search.
 */
export function PlacesMenu() {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const { flyTo } = useMapApi();
  const setMarker = useMapStore((s) => s.setMarker);

  const grouped = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const match = (l: Landmark) =>
      !q ||
      l.name.toLowerCase().includes(q) ||
      l.hint.toLowerCase().includes(q) ||
      (l.aliases ?? []).some((a) => a.includes(q));

    const out = new Map<LandmarkCategory, Landmark[]>();
    for (const cat of LANDMARK_CATEGORY_ORDER) {
      const items = LANDMARKS.filter((l) => l.category === cat && match(l));
      if (items.length > 0) {
        out.set(cat, items);
      }
    }
    return out;
  }, [filter]);

  const go = (l: Landmark) => {
    flyTo({
      bearing: l.bearing,
      center: l.center,
      pitch: l.pitch,
      zoom: l.zoom,
    });
    setMarker({ center: l.center, label: l.name });
    setOpen(false);
  };

  return (
    <Sheet onOpenChange={setOpen} open={open}>
      <SheetTrigger asChild>
        <Button
          className="bg-card/80 h-10 gap-2 rounded-xl shadow-sm backdrop-blur-md"
          variant="outline"
        >
          <PinIcon size={16} />
          <span className="hidden sm:inline">Places</span>
        </Button>
      </SheetTrigger>

      <SheetContent
        className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
        side="left"
      >
        <SheetHeader className="gap-1 border-b px-5 pt-5 pb-4">
          <SheetTitle className="font-heading text-xl">
            Places in Berlin
          </SheetTitle>
          <SheetDescription>
            {LANDMARKS.length} spots, each with its own camera angle.
          </SheetDescription>

          <div className="relative mt-3">
            <SearchIcon
              className="text-muted-foreground absolute top-1/2 left-3 -translate-y-1/2"
              size={15}
            />
            <Input
              className="pl-9"
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter places…"
              value={filter}
            />
          </div>
        </SheetHeader>

        <ScrollArea className="min-h-0 flex-1">
          <div className="px-3 py-3">
            {grouped.size === 0 && (
              <p className="text-muted-foreground px-2 py-8 text-center text-sm">
                No place matches “{filter}”.
              </p>
            )}

            {[...grouped].map(([cat, items]) => (
              <section className="mb-4" key={cat}>
                <h3 className="text-muted-foreground px-2 pb-1.5 text-xs font-medium tracking-wider uppercase">
                  {LANDMARK_CATEGORY_LABEL[cat]}
                </h3>
                <ul>
                  {items.map((l) => (
                    <li key={l.id}>
                      <button
                        className="hover:bg-accent focus-visible:bg-accent flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left transition-colors focus-visible:outline-none"
                        onClick={() => go(l)}
                        type="button"
                      >
                        <span className="bg-muted text-muted-foreground mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md">
                          <CategoryIcon category={l.category} size={15} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {l.name}
                          </span>
                          <span className="text-muted-foreground block truncate text-xs">
                            {l.hint}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
