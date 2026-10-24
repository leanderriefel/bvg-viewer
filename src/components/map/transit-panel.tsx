import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { BERLIN_TIMEZONE } from "@/lib/geo";
import { cn } from "@/lib/utils";
import {
  MAX_VEHICLE_AGE_MS,
  PRODUCT_COLORS,
  PRODUCT_LABELS,
  TRANSIT_PRODUCTS,
} from "@/map/transit/model";
import type { TransitSnapshot } from "@/map/transit/model";
import { summarizeTransit } from "@/map/transit/network";
import { useTransitStore } from "@/map/transit/store";

import { CloseIcon, LayersIcon, PlusIcon } from "./icons";
import { TransitLineBrowser } from "./transit-line-browser";
import { TransitVehicleCard } from "./transit-vehicle-card";

const NUMBER = new Intl.NumberFormat("en-GB");
const CLOCK = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZone: BERLIN_TIMEZONE,
});

function connectionLabel(
  snapshot: TransitSnapshot | null,
  error: string | null,
  now: number
) {
  if (
    error ||
    snapshot?.status === "offline" ||
    (snapshot?.updatedAt && now - snapshot.updatedAt > MAX_VEHICLE_AGE_MS)
  ) {
    return { text: "Updates interrupted", live: false };
  }
  if (!snapshot?.updatedAt) {
    return { text: "Connecting", live: false };
  }
  return {
    text:
      snapshot.status === "degraded" ? "Partial coverage" : "Live estimates",
    live: snapshot.status === "live",
  };
}

function NetworkStats({ now }: { now: number }) {
  const snapshot = useTransitStore((state) => state.snapshot);
  const summary = useMemo(
    () => summarizeTransit(snapshot?.vehicles ?? [], now),
    [snapshot, now]
  );
  const stats = [
    { label: "Vehicles", value: summary.vehicleCount },
    { label: "Active lines", value: summary.lineCount },
    { label: "≥1 min late", value: summary.delayedCount },
  ];
  return (
    <dl className="grid grid-cols-3 gap-2 px-5 pt-1 pb-4">
      {stats.map((stat) => (
        <div key={stat.label}>
          <dd className="text-[25px] leading-tight font-semibold tracking-tight tabular-nums">
            {NUMBER.format(stat.value)}
          </dd>
          <dt className="text-muted-foreground mt-1 text-xs">{stat.label}</dt>
        </div>
      ))}
    </dl>
  );
}

function ModeFilters({ now }: { now: number }) {
  const snapshot = useTransitStore((state) => state.snapshot);
  const filters = useTransitStore((state) => state.filters);
  const toggleProduct = useTransitStore((state) => state.toggleProduct);
  const counts = useMemo(
    () => summarizeTransit(snapshot?.vehicles ?? [], now).byProduct,
    [snapshot, now]
  );
  return (
    <fieldset className="border-t px-4 py-3">
      <legend className="sr-only">Transport visible on the map</legend>
      <div className="flex flex-wrap gap-1.5">
        {TRANSIT_PRODUCTS.map((product) => {
          if (product === "unknown" && counts.unknown === 0) {
            return null;
          }
          return (
            <button
              aria-label={`Show ${PRODUCT_LABELS[product]}`}
              aria-pressed={filters[product]}
              className={cn(
                "focus-visible:outline-ring inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2",
                filters[product]
                  ? "border-border/80 bg-background text-foreground shadow-xs"
                  : "bg-muted/40 text-muted-foreground border-transparent opacity-60"
              )}
              key={product}
              onClick={() => toggleProduct(product)}
              type="button"
            >
              <span
                aria-hidden="true"
                className="size-1.5 rounded-full"
                style={{ backgroundColor: PRODUCT_COLORS[product] }}
              />
              {PRODUCT_LABELS[product]}
              <span className="text-muted-foreground text-xs tabular-nums">
                {NUMBER.format(counts[product])}
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function FeedDetails({
  snapshot,
  error,
}: {
  snapshot: TransitSnapshot | null;
  error: string | null;
}) {
  return (
    <details className="group bg-muted/20 text-muted-foreground border-t px-4 py-3 text-xs">
      <summary className="focus-visible:outline-ring flex cursor-pointer list-none items-center justify-between gap-2 rounded-sm focus-visible:outline-2 [&::-webkit-details-marker]:hidden">
        <span>
          {snapshot?.updatedAt
            ? `Updated ${CLOCK.format(snapshot.updatedAt)}`
            : "Waiting for the first update"}
        </span>
        <span className="flex items-center gap-1.5">
          {snapshot
            ? `${snapshot.coverage.succeeded}/${snapshot.coverage.total} areas`
            : "VBB"}
          <PlusIcon
            className="transition-transform group-open:rotate-45"
            size={12}
          />
        </span>
      </summary>
      <div className="space-y-2 pt-3 leading-relaxed">
        <p>
          Positions follow VBB movement estimates. Underground services appear
          at the surface.
        </p>
        <p>
          Delay figures cover vehicles with reported data; an unknown delay is
          not counted as on time.
        </p>
        {snapshot?.coverage.capped ? (
          <p>
            Some busy areas reached the feed limit; additional vehicles may be
            running.
          </p>
        ) : null}
        <p>
          {snapshot?.storage === "disk"
            ? "Recent history is saved on the server."
            : "History is not being saved. Live data is kept in memory."}
        </p>
        {(error || snapshot?.error) && (
          <p className="text-amber-700 dark:text-amber-400">
            {error || snapshot?.error}
          </p>
        )}
        <a
          className="text-foreground inline-block font-medium underline underline-offset-4"
          href="https://v6.vbb.transport.rest/"
          rel="noreferrer"
          target="_blank"
        >
          Data via VBB / transport.rest ↗
        </a>
      </div>
    </details>
  );
}

/** Browse the live network by line, then direction, then individual vehicle. */
export function TransitPanel() {
  const [expanded, setExpanded] = useState(true);
  const [lineKey, setLineKey] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const snapshot = useTransitStore((state) => state.snapshot);
  const enabled = useTransitStore((state) => state.enabled);
  const selectedId = useTransitStore((state) => state.selectedId);
  const error = useTransitStore((state) => state.error);
  const setEnabled = useTransitStore((state) => state.setEnabled);
  const selectVehicle = useTransitStore((state) => state.selectVehicle);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = window.setInterval(tick, 5000);
    return () => window.clearInterval(timer);
  }, []);
  const vehicle = snapshot?.vehicles.find(
    (item) =>
      item.id === selectedId && now - item.observedAt <= MAX_VEHICLE_AGE_MS
  );
  const open = expanded || Boolean(selectedId);
  const connection = connectionLabel(snapshot, error, now);
  let connectionTone = "bg-muted-foreground";
  if (enabled) {
    connectionTone = connection.live ? "bg-emerald-500" : "bg-amber-500";
  }
  const toggleExpanded = () => {
    setExpanded(!open);
    if (open) {
      selectVehicle(null);
    }
  };
  return (
    <aside
      aria-label="Live public transport"
      className="border-border/80 bg-card/95 pointer-events-auto w-[min(23rem,calc(100vw-1.5rem))] overflow-hidden rounded-[24px] border shadow-[0_8px_40px_-12px_rgb(0_0_0/25%)] backdrop-blur-xl"
    >
      <div className="flex items-start gap-3 px-4 pt-4 pb-3">
        <button
          aria-controls="transit-panel-details"
          aria-expanded={open}
          aria-label="Toggle public transport details"
          className="focus-visible:outline-ring flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left focus-visible:outline-2"
          onClick={toggleExpanded}
          type="button"
        >
          <span className="bg-background flex size-10 shrink-0 items-center justify-center rounded-2xl border shadow-xs">
            <LayersIcon size={18} />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold tracking-tight">
              Berlin in motion
            </span>
            <span className="text-muted-foreground mt-1 flex items-center gap-1.5 text-xs">
              <span
                aria-hidden="true"
                className={cn("size-1.5 rounded-full", connectionTone)}
              />
              {enabled ? connection.text : "Transport hidden"}
            </span>
          </span>
        </button>
        <Button
          aria-label={
            enabled ? "Hide transport on map" : "Show transport on map"
          }
          aria-pressed={enabled}
          className="h-7 rounded-full px-2.5 text-xs"
          onClick={() => setEnabled(!enabled)}
          size="sm"
          variant="outline"
        >
          {enabled ? "Visible" : "Hidden"}
        </Button>
        <Button
          aria-label={
            open ? "Collapse transport panel" : "Expand transport panel"
          }
          className="text-muted-foreground size-7 rounded-full"
          onClick={toggleExpanded}
          size="icon"
          variant="ghost"
        >
          {open ? <CloseIcon size={14} /> : <PlusIcon size={14} />}
        </Button>
      </div>
      {!open && (
        <div className="text-muted-foreground px-5 pb-3 text-xs">
          Explore active lines, vehicles and delays
        </div>
      )}
      {open && (
        <div
          className="max-h-[min(72dvh,44rem)] overflow-y-auto overscroll-contain"
          id="transit-panel-details"
        >
          {vehicle ? (
            <TransitVehicleCard
              now={now}
              onBack={() => selectVehicle(null)}
              vehicle={vehicle}
            />
          ) : (
            <>
              {!lineKey && (
                <>
                  <NetworkStats now={now} />
                  <ModeFilters now={now} />
                </>
              )}
              {selectedId && (
                <p className="text-muted-foreground px-4 pb-2 text-xs">
                  That vehicle has left the current feed.
                </p>
              )}
              <TransitLineBrowser
                lineKey={lineKey}
                now={now}
                onLineChange={setLineKey}
              />
            </>
          )}
          <FeedDetails error={error} snapshot={snapshot} />
        </div>
      )}
    </aside>
  );
}
