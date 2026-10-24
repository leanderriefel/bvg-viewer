import type { PreparationProgress } from "@/map/preparation";

interface Props {
  progress?: PreparationProgress;
  destination?: boolean;
}

/** Covers temporary loading cameras until the starting scene is complete. */
export function MapBootScreen({ progress, destination = false }: Props) {
  const failed = progress?.stage === "error";
  const warming = progress?.stage === "warming";
  const completed = progress?.completed ?? 0;
  const total = progress?.total ?? 0;
  let message = "Loading the starting view…";
  if (destination) {
    message = "Loading your destination…";
  }
  if (warming) {
    message = "Preparing nearby views and caching Berlin…";
  }
  if (failed) {
    message = progress.error ?? "Unable to load the map. Please try again.";
  }

  return (
    <div className="bg-background flex h-full min-h-dvh w-full flex-col items-center justify-center gap-5 px-6">
      <div aria-hidden="true" className="relative size-14">
        <div className="bg-primary/25 absolute inset-0 rounded-full motion-safe:animate-pulse" />
        <div className="bg-primary/70 absolute inset-[18%] rounded-full" />
      </div>

      <div className="text-center">
        <h1 className="font-heading text-lg">Berlin in 3D</h1>
        <output
          aria-live="polite"
          className="text-muted-foreground mt-1 block max-w-sm text-sm"
        >
          {message}
        </output>
      </div>

      {!failed && (
        <div className="w-full max-w-xs">
          <progress
            aria-label="Preparing map data"
            className="bg-primary/10 [&::-webkit-progress-value]:bg-primary [&::-moz-progress-bar]:bg-primary h-1.5 w-full overflow-hidden rounded-full [&::-webkit-progress-bar]:bg-transparent"
            max={total || 100}
            value={total ? completed : undefined}
          />
          <p className="text-muted-foreground mt-3 text-center text-xs">
            {destination
              ? "Preparing map data before you arrive."
              : "Preparing the city for smoother exploring. This can take about 30 seconds."}
          </p>
        </div>
      )}
      {failed && (
        <button
          className="bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-medium"
          onClick={() => window.location.reload()}
          type="button"
        >
          Try again
        </button>
      )}
    </div>
  );
}
