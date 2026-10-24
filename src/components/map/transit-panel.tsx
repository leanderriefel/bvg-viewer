import { useEffect, useMemo, useState } from "react";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

import { CloseIcon, NavigateIcon, PlusIcon } from "./icons";
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

function NetworkOverview({ now }: { now: number }) {
  const snapshot = useTransitStore((state) => state.snapshot);
  const summary = useMemo(
    () => summarizeTransit(snapshot?.vehicles ?? [], now),
    [snapshot, now]
  );
  const stats = [
    { label: "Vehicles", value: summary.vehicleCount },
    { label: "Active lines", value: summary.lineCount },
    { label: "Late ≥1 min", value: summary.delayedCount },
  ];
  return (
    <section aria-label="Network overview">
      <dl className="grid grid-cols-3 gap-3 border-b px-5 pt-4 pb-5">
        {stats.map((stat) => (
          <div key={stat.label}>
            <dd className="text-[22px] leading-tight font-semibold tracking-tight tabular-nums">
              {NUMBER.format(stat.value)}
            </dd>
            <dt className="text-muted-foreground mt-1 text-xs">{stat.label}</dt>
          </div>
        ))}
      </dl>
      <div className="px-5 py-4">
        <h3 className="mb-2 text-xs font-semibold">By transport mode</h3>
        <dl className="divide-y">
          {TRANSIT_PRODUCTS.map(
            (product) =>
              summary.byProduct[product] > 0 && (
                <div
                  className="flex items-center gap-2.5 py-2.5 text-xs"
                  key={product}
                >
                  <span
                    aria-hidden="true"
                    className="size-2 rounded-full"
                    style={{ backgroundColor: PRODUCT_COLORS[product] }}
                  />
                  <dt className="text-muted-foreground flex-1">
                    {PRODUCT_LABELS[product]}
                  </dt>
                  <dd className="font-medium tabular-nums">
                    {NUMBER.format(summary.byProduct[product])}
                  </dd>
                </div>
              )
          )}
        </dl>
        <p className="text-muted-foreground mt-3 text-xs leading-relaxed">
          Figures cover the current feed across Berlin. Open a line to explore
          its vehicles and directions.
        </p>
      </div>
    </section>
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
    <details className="group border-b px-4 py-2">
      <summary className="focus-visible:outline-ring flex min-h-9 cursor-pointer list-none items-center gap-2 rounded-sm text-xs focus-visible:outline-2 [&::-webkit-details-marker]:hidden">
        <span className="flex-1 font-medium">Transport modes</span>
        <span className="text-muted-foreground">Filter map & lines</span>
        <PlusIcon
          className="text-muted-foreground transition-transform group-open:rotate-45"
          size={13}
        />
      </summary>
      <fieldset className="pb-2">
        <legend className="sr-only">Transport visible on the map</legend>
        <div className="grid grid-cols-2 gap-2 pt-2">
          {TRANSIT_PRODUCTS.map((product) => {
            if (product === "unknown" && counts.unknown === 0) {
              return null;
            }
            return (
              <button
                aria-label={`Include ${PRODUCT_LABELS[product]}`}
                aria-pressed={filters[product]}
                className={cn(
                  "focus-visible:outline-ring inline-flex min-h-10 items-center gap-2 rounded-xl border px-2.5 py-2 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2",
                  filters[product]
                    ? "border-border/80 bg-background text-foreground shadow-xs"
                    : "bg-muted/40 text-muted-foreground border-transparent"
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
                <span className="text-muted-foreground ml-auto text-xs tabular-nums">
                  {NUMBER.format(counts[product])}
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>
    </details>
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
          Positions follow VBB movement estimates. U-Bahn uses outlined X-ray
          markers and dashed routes, including on above-ground sections.
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
            Some updates are delayed. Vehicles follow their latest forecast
            while we retry.
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
  const [expanded, setExpanded] = useState(false);
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
      className="map-transit map-panel pointer-events-auto flex flex-col overflow-hidden"
      data-expanded={open}
    >
      <button
        aria-controls="transit-panel-details"
        aria-expanded={open}
        aria-label="Toggle public transport details"
        className="hover:bg-muted/50 focus-visible:outline-ring flex w-full shrink-0 items-center gap-2.5 rounded-2xl p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-3px]"
        onClick={toggleExpanded}
        type="button"
      >
        <span className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-lg">
          <NavigateIcon size={16} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-semibold tracking-tight">
            Live transport
          </span>
          <span className="text-muted-foreground mt-0.5 flex items-center gap-1.5 text-xs">
            <span
              aria-hidden="true"
              className={cn("size-1.5 rounded-full", connectionTone)}
            />
            {enabled ? connection.text : "Transport hidden"}
          </span>
        </span>
        <span className="text-muted-foreground flex size-7 items-center justify-center rounded-full border">
          {open ? <CloseIcon size={14} /> : <PlusIcon size={14} />}
        </span>
      </button>
      {open && (
        <div
          className="min-h-0 overflow-y-auto overscroll-contain"
          id="transit-panel-details"
        >
          {vehicle ? (
            <TransitVehicleCard
              now={now}
              onBack={() => selectVehicle(null)}
              vehicle={vehicle}
            />
          ) : (
            <Tabs className="gap-0" defaultValue="lines">
              <div className="flex items-center gap-4 border-b px-4 pb-3">
                <TabsList
                  aria-label="Transport information"
                  className="h-9 flex-1 rounded-xl"
                >
                  <TabsTrigger className="rounded-lg" value="lines">
                    Lines
                  </TabsTrigger>
                  <TabsTrigger className="rounded-lg" value="overview">
                    Overview
                  </TabsTrigger>
                </TabsList>
              </div>
              <div className="flex items-center justify-between border-b px-4 py-3">
                <Label className="text-xs" htmlFor="transit-map-visible">
                  Show on map
                </Label>
                <Switch
                  checked={enabled}
                  id="transit-map-visible"
                  onCheckedChange={setEnabled}
                />
              </div>
              <TabsContent className="mt-0" value="lines">
                <ModeFilters now={now} />
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
              </TabsContent>
              <TabsContent className="mt-0" value="overview">
                <NetworkOverview now={now} />
              </TabsContent>
            </Tabs>
          )}
          <FeedDetails error={error} snapshot={snapshot} />
        </div>
      )}
    </aside>
  );
}
