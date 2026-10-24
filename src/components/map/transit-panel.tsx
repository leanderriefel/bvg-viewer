import { memo, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { BERLIN_TIMEZONE } from "@/lib/geo";
import { cn } from "@/lib/utils";
import { useMapApi } from "@/map/map-context";
import {
  PRODUCT_COLORS,
  PRODUCT_LABELS,
  TRANSIT_PRODUCTS,
} from "@/map/transit/model";
import type {
  TransitProduct,
  TransitSnapshot,
  TransitVehicle,
} from "@/map/transit/model";
import { sampleVehicle } from "@/map/transit/motion";
import { useTransitStore } from "@/map/transit/store";

import { CloseIcon } from "./icons";

const UPDATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZone: BERLIN_TIMEZONE,
});

function formatDelay(delay: number | null): string {
  if (delay === null) {
    return "Delay unavailable";
  }
  if (delay === 0) {
    return "On time";
  }
  const minutes = Math.max(1, Math.round(Math.abs(delay) / 60));
  return `${minutes} min ${delay > 0 ? "late" : "early"}`;
}

function VehicleDetails({ vehicle }: { vehicle: TransitVehicle }) {
  const { flyTo } = useMapApi();
  const selectVehicle = useTransitStore((state) => state.selectVehicle);
  const showOnMap = () => {
    const pose = sampleVehicle(vehicle, Date.now());
    flyTo({ center: pose?.coordinates ?? vehicle.location, zoom: 16 });
  };
  return (
    <section aria-label="Selected vehicle" className="border-t pt-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">
            {vehicle.line} · {PRODUCT_LABELS[vehicle.product]}
          </h3>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {vehicle.direction || "Destination unavailable"}
          </p>
        </div>
        <Button
          aria-label="Close vehicle details"
          className="size-6 shrink-0"
          onClick={() => selectVehicle(null)}
          size="icon"
          variant="ghost"
        >
          <CloseIcon size={13} />
        </Button>
      </div>
      <dl className="mt-2 space-y-1 text-xs">
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Schedule</dt>
          <dd
            className={
              vehicle.delay !== null && vehicle.delay > 60
                ? "text-amber-600 dark:text-amber-400"
                : ""
            }
          >
            {formatDelay(vehicle.delay)}
          </dd>
        </div>
        {vehicle.nextStop && (
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground shrink-0">Next stop</dt>
            <dd className="text-right">{vehicle.nextStop}</dd>
          </div>
        )}
        {vehicle.operator && (
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground shrink-0">Operator</dt>
            <dd className="text-right">{vehicle.operator}</dd>
          </div>
        )}
      </dl>
      <Button
        className="mt-3 w-full"
        onClick={showOnMap}
        size="sm"
        variant="outline"
      >
        Show on map
      </Button>
    </section>
  );
}

const ModeFilters = memo(() => {
  const snapshot = useTransitStore((state) => state.snapshot);
  const filters = useTransitStore((state) => state.filters);
  const toggleProduct = useTransitStore((state) => state.toggleProduct);
  const counts = useMemo(() => {
    const result: Partial<Record<TransitProduct, number>> = {};
    for (const vehicle of snapshot?.vehicles ?? []) {
      result[vehicle.product] = (result[vehicle.product] ?? 0) + 1;
    }
    return result;
  }, [snapshot]);

  return (
    <fieldset>
      <legend className="mb-2 text-xs font-medium">Transport modes</legend>
      <div className="grid grid-cols-2 gap-1.5">
        {TRANSIT_PRODUCTS.map((product) => {
          if (product === "unknown" && !counts.unknown) {
            return null;
          }
          return (
            <button
              aria-label={`Show ${PRODUCT_LABELS[product]}`}
              aria-pressed={filters[product]}
              className={cn(
                "flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-left text-xs transition-colors",
                filters[product]
                  ? "bg-muted/70"
                  : "text-muted-foreground opacity-60"
              )}
              key={product}
              onClick={() => toggleProduct(product)}
              type="button"
            >
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: PRODUCT_COLORS[product] }}
              />
              <span className="flex-1">{PRODUCT_LABELS[product]}</span>
              <span className="font-mono tabular-nums">
                {counts[product] ?? 0}
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
});

ModeFilters.displayName = "ModeFilters";

const VehiclePicker = memo(() => {
  const snapshot = useTransitStore((state) => state.snapshot);
  const selectedId = useTransitStore((state) => state.selectedId);
  const selectVehicle = useTransitStore((state) => state.selectVehicle);
  const vehicle = snapshot?.vehicles.find((item) => item.id === selectedId);
  return (
    <>
      {snapshot && snapshot.vehicles.length > 0 && (
        <label className="block text-xs font-medium">
          Inspect a vehicle
          <select
            className="bg-background mt-1.5 w-full min-w-0 rounded-lg border p-2 text-xs font-normal"
            onChange={(event) => selectVehicle(event.target.value || null)}
            value={vehicle?.id ?? ""}
          >
            <option value="">Choose a line and destination</option>
            {snapshot.vehicles.map((item) => (
              <option key={item.id} value={item.id}>
                {item.line} → {item.direction || "Unknown destination"}
              </option>
            ))}
          </select>
        </label>
      )}
      {vehicle && <VehicleDetails vehicle={vehicle} />}
      {selectedId && !vehicle && (
        <p className="text-muted-foreground text-xs">
          This vehicle is no longer in the latest feed.
        </p>
      )}
    </>
  );
});

VehiclePicker.displayName = "VehiclePicker";

function FeedStatus({
  snapshot,
  error,
  age,
}: {
  snapshot: TransitSnapshot | null;
  error: string | null;
  age: number;
}) {
  if (!snapshot) {
    return (
      <p className="text-muted-foreground text-xs">
        {error || "Connecting to the transport feed…"}
      </p>
    );
  }
  const message = error || snapshot.error;
  return (
    <div className="text-muted-foreground space-y-1 text-xs leading-relaxed">
      {snapshot.updatedAt && (
        <p>
          Last update {UPDATE_FORMAT.format(snapshot.updatedAt)} Berlin ·{" "}
          {Math.floor(age / 1000)}s ago
        </p>
      )}
      <p>
        Coverage: {snapshot.coverage.succeeded}/{snapshot.coverage.total} Berlin
        areas
        {snapshot.coverage.capped > 0
          ? ` · ${snapshot.coverage.capped} at the API limit`
          : ""}
        .
      </p>
      {snapshot.coverage.capped > 0 && (
        <p className="text-amber-700 dark:text-amber-400">
          Busy areas may contain additional vehicles.
        </p>
      )}
      <p>
        {snapshot.storage === "disk"
          ? "History saved on the server."
          : "History is not being saved; live data is in memory."}
      </p>
      {message && (
        <p className="text-amber-700 dark:text-amber-400">{message}</p>
      )}
      {age > 90_000 && snapshot.updatedAt && (
        <p>Old vehicles disappear after 90 seconds. Waiting for fresh data.</p>
      )}
      {snapshot.updatedAt && snapshot.vehicles.length === 0 && (
        <p>No vehicles were returned for the latest scan.</p>
      )}
    </div>
  );
}

function feedPresentation(
  snapshot: TransitSnapshot | null,
  enabled: boolean,
  failed: boolean,
  age: number
): { label: string; tone: string } {
  if (!enabled) {
    return { label: "Hidden", tone: "bg-muted-foreground" };
  }
  const degraded =
    snapshot?.status === "degraded" || snapshot?.status === "offline" || failed;
  if (degraded || (Boolean(snapshot?.updatedAt) && age > 90_000)) {
    return {
      label: age > 90_000 ? "Feed unavailable" : "Partial updates",
      tone: "bg-amber-500",
    };
  }
  if (snapshot?.updatedAt) {
    return {
      label: `Live estimates · ${snapshot.vehicles.length.toLocaleString()} vehicles`,
      tone: "bg-emerald-500",
    };
  }
  return { label: "Connecting", tone: "bg-muted-foreground" };
}

/** Poll status and mode filters stay in React; vehicle animation stays on the map. */
export function TransitPanel() {
  const [expanded, setExpanded] = useState(false);
  const [now, setNow] = useState(0);
  const snapshot = useTransitStore((state) => state.snapshot);
  const enabled = useTransitStore((state) => state.enabled);
  const selectedId = useTransitStore((state) => state.selectedId);
  const error = useTransitStore((state) => state.error);
  const requestStatus = useTransitStore((state) => state.status);
  const setEnabled = useTransitStore((state) => state.setEnabled);
  const selectVehicle = useTransitStore((state) => state.selectVehicle);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, []);
  const open = expanded || Boolean(selectedId);
  const age = snapshot?.updatedAt
    ? Math.max(0, now - snapshot.updatedAt)
    : Infinity;
  const presentation = feedPresentation(
    snapshot,
    enabled,
    requestStatus === "error",
    age
  );
  const toggleExpanded = () => {
    setExpanded(!open);
    if (open) {
      selectVehicle(null);
    }
  };
  return (
    <aside
      aria-label="Live public transport"
      className="bg-card/90 pointer-events-auto w-[min(20rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border shadow-lg backdrop-blur-md"
    >
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          aria-controls="transit-panel-details"
          aria-expanded={open}
          aria-label="Toggle public transport details"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={toggleExpanded}
          type="button"
        >
          <span
            aria-hidden="true"
            className={cn("size-2 shrink-0 rounded-full", presentation.tone)}
          />
          <span className="min-w-0">
            <span className="block text-xs font-semibold">
              Berlin transport{" "}
              <span className="text-muted-foreground font-normal">
                {open ? "−" : "+"}
              </span>
            </span>
            <span className="text-muted-foreground block text-xs">
              {presentation.label}
            </span>
          </span>
        </button>
        <Button
          aria-pressed={enabled}
          className="h-7 px-2 text-xs"
          onClick={() => setEnabled(!enabled)}
          size="sm"
          variant="outline"
        >
          {enabled ? "Hide" : "Show"}
        </Button>
      </div>
      {open && (
        <div
          className="max-h-[min(65dvh,34rem)] space-y-3 overflow-y-auto overscroll-contain border-t px-3 py-3"
          id="transit-panel-details"
        >
          <ModeFilters />
          <FeedStatus age={age} error={error} snapshot={snapshot} />
          <VehiclePicker />
          <p className="text-muted-foreground border-t pt-2 text-xs leading-relaxed">
            Positions are VBB estimates, animated along supplied shapes where
            available. Underground services are shown at the surface. Coverage
            and delays depend on the feed; vehicle models are unavailable. Data
            via{" "}
            <a
              className="underline underline-offset-2"
              href="https://v6.vbb.transport.rest/"
              rel="noreferrer"
              target="_blank"
            >
              transport.rest
            </a>
            .
          </p>
        </div>
      )}
    </aside>
  );
}
