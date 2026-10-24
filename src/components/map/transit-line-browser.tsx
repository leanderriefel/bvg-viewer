import { useEffect, useMemo, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import { PRODUCT_COLORS, PRODUCT_LABELS } from "@/map/transit/model";
import { groupTransitLines } from "@/map/transit/network";
import type { TransitLineGroup } from "@/map/transit/network";
import { useTransitStore } from "@/map/transit/store";

import { NavigateIcon, SearchIcon } from "./icons";
import { DelayBadge, LineBadge, stopLabel } from "./transit-vehicle-card";

interface BrowserProps {
  now: number;
  lineKey: string | null;
  onLineChange: (key: string | null) => void;
}

function LineRow({
  group,
  onOpen,
}: {
  group: TransitLineGroup;
  onOpen: () => void;
}) {
  return (
    <button
      aria-label={`Explore ${group.line}, ${group.vehicles.length} vehicles`}
      className="group hover:bg-muted/70 focus-visible:outline-ring flex w-full items-center gap-2.5 rounded-xl px-2 py-2.5 text-left transition-colors focus-visible:outline-2"
      onClick={onOpen}
      type="button"
    >
      <LineBadge color={PRODUCT_COLORS[group.product]} line={group.line} />
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-medium">
          {PRODUCT_LABELS[group.product]}
        </span>
        <span className="text-muted-foreground mt-0.5 block text-xs">
          {group.directions.length}{" "}
          {group.directions.length === 1 ? "direction" : "directions"}
          {group.delayedCount > 0 && (
            <span className="text-amber-700 dark:text-amber-400">
              {" "}
              · {group.delayedCount} late
            </span>
          )}
        </span>
      </span>
      <span className="text-right">
        <span className="block text-sm font-semibold tabular-nums">
          {group.vehicles.length}
        </span>
        <span className="text-muted-foreground block text-xs">vehicles</span>
      </span>
      <span
        aria-hidden="true"
        className="text-muted-foreground pl-1 text-lg transition-transform group-hover:translate-x-0.5"
      >
        ›
      </span>
    </button>
  );
}

function LineVehicles({
  group,
  onBack,
}: {
  group: TransitLineGroup;
  onBack: () => void;
}) {
  const selectVehicle = useTransitStore((state) => state.selectVehicle);
  return (
    <div>
      <button
        className="text-muted-foreground hover:text-foreground focus-visible:outline-ring mb-3 rounded-sm text-xs font-medium focus-visible:outline-2"
        onClick={onBack}
        type="button"
      >
        ← All lines
      </button>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <LineBadge color={PRODUCT_COLORS[group.product]} line={group.line} />
          <span className="text-xs font-medium">
            {group.vehicles.length} active vehicles
          </span>
        </div>
        <span className="text-muted-foreground text-xs">
          {group.directions.length} directions
        </span>
      </div>
      <div
        aria-label={`${group.line} vehicles by direction`}
        className="max-h-[min(34dvh,20rem)] space-y-4 overflow-y-auto overscroll-contain pr-1"
      >
        {group.directions.map((direction) => (
          <section aria-label={`Toward ${direction.name}`} key={direction.name}>
            <div className="bg-card sticky top-0 z-10 mb-1 flex items-start justify-between gap-2 py-2 text-xs">
              <h4 className="leading-relaxed font-medium">
                <span className="text-muted-foreground mr-1">→</span>
                {stopLabel(direction.name)}
              </h4>
              <span className="bg-muted text-muted-foreground shrink-0 rounded-full px-1.5 py-0.5 text-xs tabular-nums">
                {direction.vehicles.length}
              </span>
            </div>
            <div className="space-y-0.5 border-l border-dashed pl-2">
              {direction.vehicles.map((vehicle, index) => (
                <button
                  aria-label={`Inspect ${vehicle.line} toward ${vehicle.direction}, next stop ${vehicle.nextStop ?? "unknown"}, vehicle ${index + 1}`}
                  className="group hover:bg-muted/70 focus-visible:outline-ring flex w-full items-center gap-2 rounded-lg px-2 py-2.5 text-left transition-colors focus-visible:outline-2"
                  key={vehicle.id}
                  onClick={() => selectVehicle(vehicle.id)}
                  type="button"
                >
                  <span className="bg-muted text-muted-foreground flex size-5 shrink-0 items-center justify-center rounded-full text-xs tabular-nums">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="text-muted-foreground block text-xs">
                      Next stop
                    </span>
                    <span className="mt-0.5 block truncate text-xs font-medium">
                      {vehicle.nextStop
                        ? stopLabel(vehicle.nextStop)
                        : "Not reported"}
                    </span>
                  </span>
                  <DelayBadge delay={vehicle.delay} />
                  <NavigateIcon
                    className="text-muted-foreground shrink-0"
                    size={12}
                  />
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

export function TransitLineBrowser({
  now,
  lineKey,
  onLineChange,
}: BrowserProps) {
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(30);
  const listRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const snapshot = useTransitStore((state) => state.snapshot);
  const filters = useTransitStore((state) => state.filters);
  const groups = useMemo(
    () => groupTransitLines(snapshot?.vehicles ?? [], filters, query, now),
    [snapshot, filters, query, now]
  );
  const selectedLine = groups.find((group) => group.key === lineKey);
  const hasMore = groups.length > limit;
  useEffect(() => {
    const root = listRef.current;
    const sentinel = sentinelRef.current;
    if (selectedLine || !hasMore || !(root && sentinel)) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setLimit((current) => Math.min(current + 30, groups.length));
        }
      },
      { root, rootMargin: "160px 0px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [groups.length, hasMore, selectedLine]);
  const onSearch = (value: string) => {
    setQuery(value);
    setLimit(30);
    onLineChange(null);
  };
  const openLine = (key: string) => {
    // A destination search narrows preview counts. Opening the service shows
    // all its vehicles, with every direction explicitly grouped below it.
    setQuery("");
    onLineChange(key);
  };
  if (selectedLine) {
    return (
      <div className="border-t px-4 py-4">
        <LineVehicles group={selectedLine} onBack={() => onLineChange(null)} />
      </div>
    );
  }
  if (lineKey) {
    return (
      <div className="border-t px-4 py-5">
        <button
          className="text-muted-foreground hover:text-foreground text-xs font-medium"
          onClick={() => onLineChange(null)}
          type="button"
        >
          ← All lines
        </button>
        <p className="text-muted-foreground mt-4 text-xs">
          This line is no longer in the current feed or is hidden by your mode
          filters.
        </p>
      </div>
    );
  }
  return (
    <section
      aria-label="Active transport lines"
      className="border-t px-3 pt-3 pb-2"
    >
      <div className="relative mx-1 mb-3">
        <SearchIcon
          className="text-muted-foreground pointer-events-none absolute top-3 left-3"
          size={14}
        />
        <Input
          aria-label="Search transport lines"
          className="border-border/60 bg-muted/40 h-9 rounded-lg pr-3 pl-9 text-xs shadow-none"
          onChange={(event) => onSearch(event.target.value)}
          placeholder="Search lines, stops, ferry, bus…"
          type="search"
          value={query}
        />
      </div>
      <div className="text-muted-foreground mb-2 flex items-center justify-between px-2 text-xs">
        <h3 className="font-medium">
          {query ? "Matching lines" : "All lines"}
        </h3>
        <span className="tabular-nums">
          {groups.length} {groups.length === 1 ? "line" : "lines"}
        </span>
      </div>
      <div
        aria-label="Line results"
        className="max-h-[min(30dvh,19rem)] overflow-y-auto overscroll-contain"
        ref={listRef}
      >
        {groups.slice(0, limit).map((group) => (
          <LineRow
            group={group}
            key={group.key}
            onOpen={() => openLine(group.key)}
          />
        ))}
        {groups.length === 0 && (
          <p className="text-muted-foreground px-2 py-8 text-center text-xs leading-relaxed">
            {snapshot
              ? "No matching lines. Try another search or enable a transport mode."
              : "Connecting to Berlin’s live network…"}
          </p>
        )}
        {hasMore && (
          <div
            aria-hidden="true"
            className="text-muted-foreground py-3 text-center text-xs"
            ref={sentinelRef}
          >
            Scroll for more lines
          </div>
        )}
      </div>
    </section>
  );
}
