import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useMapApi } from "@/map/map-context";
import { PRODUCT_COLORS, PRODUCT_LABELS } from "@/map/transit/model";
import type { TransitVehicle } from "@/map/transit/model";
import { sampleVehicle } from "@/map/transit/motion";
import { displayTransitLine, formatDelay } from "@/map/transit/network";
import { useTransitStore } from "@/map/transit/store";
import { isXrayVehicle } from "@/map/transit/xray";

import { TargetIcon } from "./icons";

export function LineBadge({ line, color }: { line: string; color: string }) {
  return (
    <span
      className="inline-flex min-w-10 shrink-0 items-center justify-center rounded-lg px-2 py-1 text-xs font-semibold text-white shadow-xs"
      style={{ backgroundColor: color }}
    >
      {line}
    </span>
  );
}

export function DelayBadge({ delay }: { delay: number | null }) {
  let tone = "bg-muted text-muted-foreground";
  if (delay !== null) {
    tone =
      delay >= 60
        ? "bg-amber-100 text-amber-800 dark:bg-amber-400/15 dark:text-amber-300"
        : "bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300";
  }
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-1 text-xs font-medium tabular-nums",
        tone
      )}
    >
      {formatDelay(delay)}
    </span>
  );
}

export function stopLabel(value: string): string {
  return value.replace(/\s*\(Berlin\)$/u, "");
}

export function TransitVehicleCard({
  vehicle,
  onBack,
  now,
}: {
  vehicle: TransitVehicle;
  onBack: () => void;
  now: number;
}) {
  const { flyTo } = useMapApi();
  const followedId = useTransitStore((state) => state.followedId);
  const followVehicle = useTransitStore((state) => state.followVehicle);
  const stopFollowing = useTransitStore((state) => state.stopFollowing);
  const selectedRoute = useTransitStore((state) => state.selectedRoute);
  const routeStatus = useTransitStore((state) => state.routeStatus);
  const following = followedId === vehicle.id;
  const observationAge = Math.max(
    0,
    Math.floor((now - vehicle.observedAt) / 1000)
  );
  let routeDescription = "Movement forecast";
  if (routeStatus === "loading") {
    routeDescription = "Loading route…";
  }
  if (selectedRoute?.tripId === vehicle.id) {
    routeDescription = `${selectedRoute.stops.length} stops · full route`;
  }
  const showOnMap = () => {
    const pose = sampleVehicle(vehicle, Date.now());
    flyTo({ center: pose?.coordinates ?? vehicle.location, zoom: 16 });
  };
  return (
    <section aria-label="Selected vehicle" className="px-5 pb-5">
      <button
        className="text-muted-foreground hover:text-foreground focus-visible:outline-ring mb-4 rounded-sm text-xs font-medium transition-colors focus-visible:outline-2"
        onClick={onBack}
        type="button"
      >
        ← Back to lines
      </button>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <LineBadge
            color={PRODUCT_COLORS[vehicle.product]}
            line={displayTransitLine(vehicle)}
          />
          <span className="text-muted-foreground text-xs">
            {PRODUCT_LABELS[vehicle.product]}
          </span>
        </div>
        <DelayBadge delay={vehicle.delay} />
      </div>
      <div
        className="my-5 border-l-2 pl-4"
        style={{ borderColor: PRODUCT_COLORS[vehicle.product] }}
      >
        <p className="text-muted-foreground text-xs font-medium tracking-[0.12em] uppercase">
          Next stop
        </p>
        <h3 className="mt-1.5 text-xl leading-snug font-semibold tracking-tight">
          {vehicle.nextStop ? stopLabel(vehicle.nextStop) : "Not reported"}
        </h3>
        <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
          Toward {stopLabel(vehicle.direction)}
        </p>
      </div>
      <dl className="mb-5 space-y-3 border-y py-3 text-xs">
        <div className="flex items-start justify-between gap-4">
          <dt className="text-muted-foreground shrink-0">Operator</dt>
          <dd className="text-right font-medium">
            {vehicle.operator ?? "Not reported"}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Position</dt>
          <dd className="text-right font-medium">
            {observationAge > 40
              ? `Forecast · ${observationAge}s since update`
              : "VBB movement estimate"}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Route</dt>
          <dd className="font-medium">{routeDescription}</dd>
        </div>
      </dl>
      {isXrayVehicle(vehicle) && (
        <div className="mb-4 rounded-xl border border-sky-500/20 bg-sky-500/5 px-3 py-2.5">
          <p className="flex items-center gap-2 text-xs font-semibold">
            <span
              aria-hidden="true"
              className="size-2.5 rounded-full border-2 border-sky-600 shadow-[0_0_8px_#0ea5e94d] dark:border-sky-400"
            />
            U-Bahn X-ray
            <span
              aria-hidden="true"
              className="ml-auto w-8 border-t-2 border-dashed border-sky-600 dark:border-sky-400"
            />
          </p>
          <p className="text-muted-foreground mt-1.5 text-xs leading-relaxed">
            Outlined trains and dashed routes show U-Bahn schematically,
            including above-ground sections.
            {following && " Nearby buildings fade while following."}
          </p>
        </div>
      )}
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <Button
          aria-pressed={following}
          className="bg-foreground text-background hover:bg-foreground/90 h-10 gap-2 rounded-xl"
          onClick={() =>
            following ? stopFollowing() : followVehicle(vehicle.id)
          }
          size="sm"
        >
          <TargetIcon size={15} />
          {following ? "Stop following" : "Follow vehicle"}
        </Button>
        <Button
          className="h-10 rounded-xl px-3"
          onClick={showOnMap}
          size="sm"
          variant="outline"
        >
          Locate
        </Button>
      </div>
      {following && (
        <p className="text-muted-foreground mt-2.5 text-xs leading-relaxed">
          Camera follows this vehicle. Move the map to take control.
        </p>
      )}
    </section>
  );
}
