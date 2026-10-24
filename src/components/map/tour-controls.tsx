import { Button } from "@/components/ui/button";
import { useMapApi } from "@/map/map-context";

import { CloseIcon, NavigateIcon, PauseIconC, PlayIconC } from "./icons";

export function TourControls() {
  const { tour } = useMapApi();
  const { state, start: handleStart, exit: handleExit } = tour;

  if (!state) {
    return (
      <Button
        className="bg-card/90 pointer-events-auto h-10 gap-2 rounded-xl shadow-sm backdrop-blur-md"
        onClick={handleStart}
        variant="outline"
      >
        <PlayIconC size={16} />
        Tour Berlin
      </Button>
    );
  }

  const paused = state.status === "paused";
  const { caption } = state;

  return (
    <section
      aria-label="Tour Berlin"
      className="bg-card/95 pointer-events-auto w-80 max-w-[calc(100vw-5rem)] rounded-2xl border p-4 shadow-lg backdrop-blur-xl"
    >
      <div aria-atomic="true" aria-live="polite">
        <div className="text-muted-foreground flex items-center gap-2 text-xs font-medium">
          <NavigateIcon size={14} />
          <span>{paused ? "Tour paused" : "Tour Berlin"}</span>
          <span className="ml-auto tabular-nums">
            {state.step} / {state.total}
          </span>
        </div>
        <p className="text-muted-foreground mt-3 text-xs font-medium tracking-wider uppercase">
          {caption.kind === "vehicle"
            ? "Live vehicle · VBB estimate"
            : "Landmark"}
        </p>
        <h2 className="mt-1 text-lg leading-snug font-semibold tracking-tight">
          {caption.title}
        </h2>
        {caption.location && (
          <p className="mt-1 text-xs leading-relaxed">{caption.location}</p>
        )}
        <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
          {caption.description}
        </p>
      </div>
      <div className="mt-4 flex items-center gap-2">
        <Button
          aria-label={paused ? "Resume tour" : "Pause tour"}
          className="h-9 flex-1 gap-2 rounded-lg"
          onClick={paused ? tour.resume : tour.pause}
          size="sm"
          variant="outline"
        >
          {paused ? <PlayIconC size={14} /> : <PauseIconC size={14} />}
          {paused ? "Resume" : "Pause"}
        </Button>
        <Button
          aria-label="Exit tour"
          className="h-9 gap-2 rounded-lg"
          onClick={handleExit}
          size="sm"
          variant="ghost"
        >
          <CloseIcon size={14} />
          Exit
        </Button>
      </div>
      <p className="text-muted-foreground mt-2.5 text-xs">
        Move the map to leave the tour.
      </p>
    </section>
  );
}
