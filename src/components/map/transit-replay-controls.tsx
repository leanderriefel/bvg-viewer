import { Button } from "@/components/ui/button";
import { BERLIN_TIMEZONE } from "@/lib/geo";
import { cn } from "@/lib/utils";
import { REPLAY_SPEEDS } from "@/map/transit/history";
import type { TransitHistoryEntry } from "@/map/transit/history";
import { useTransitStore } from "@/map/transit/store";

const TIMESTAMP = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZone: BERLIN_TIMEZONE,
});
const BOUNDARY = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: BERLIN_TIMEZONE,
});

function PlaybackButtons({
  replaying,
  duration,
}: {
  replaying: boolean;
  duration: number;
}) {
  const playing = useTransitStore((state) => state.playing);
  const speed = useTransitStore((state) => state.speed);
  const replayStatus = useTransitStore((state) => state.replayStatus);
  const playReplay = useTransitStore((state) => state.playReplay);
  const pauseReplay = useTransitStore((state) => state.pauseReplay);
  const setReplaySpeed = useTransitStore((state) => state.setReplaySpeed);
  return (
    <div className="mt-3 flex items-center justify-between gap-2">
      <Button
        aria-label={
          playing ? "Pause transport replay" : "Play transport replay"
        }
        className="h-8 min-w-16 rounded-lg px-3 text-xs"
        disabled={duration === 0 || replayStatus === "error"}
        onClick={playing ? pauseReplay : playReplay}
        size="sm"
        variant={replaying ? "default" : "outline"}
      >
        {playing ? "Pause" : "Play"}
      </Button>
      <fieldset className="bg-muted/60 flex gap-0.5 rounded-lg p-0.5">
        <legend className="sr-only">Replay speed</legend>
        {REPLAY_SPEEDS.map((value) => (
          <button
            aria-label={`Replay at ${value}× speed`}
            aria-pressed={speed === value}
            className={cn(
              "focus-visible:outline-ring rounded-md px-2.5 py-1.5 text-xs font-medium tabular-nums focus-visible:outline-2",
              speed === value
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            )}
            key={value}
            onClick={() => setReplaySpeed(value)}
            type="button"
          >
            {value}×
          </button>
        ))}
      </fieldset>
    </div>
  );
}

function HistoryTimeline({
  history,
  first,
  last,
  time,
  replaying,
}: {
  history: TransitHistoryEntry[];
  first: TransitHistoryEntry;
  last: TransitHistoryEntry;
  time: number;
  replaying: boolean;
}) {
  const seekReplay = useTransitStore((state) => state.seekReplay);
  const replayStatus = useTransitStore((state) => state.replayStatus);
  const duration = last.at - first.at;
  const progress = duration > 0 ? ((time - first.at) / duration) * 1000 : 0;
  const hasGaps = history.some(
    (entry, index) => index > 0 && entry.at > history[index - 1].until
  );
  let status = `${history.length} saved ${history.length === 1 ? "snapshot" : "snapshots"}`;
  if (hasGaps) {
    status += " · Gaps are skipped";
  }
  if (replaying && time >= last.at) {
    status += " · End of saved history";
  }
  if (replaying && replayStatus === "loading") {
    status = "Loading saved snapshot…";
  }
  return (
    <>
      <div className="relative mt-2 flex h-6 items-center">
        <div
          aria-hidden="true"
          className="bg-muted pointer-events-none absolute inset-x-0 h-1 overflow-hidden rounded-full"
        >
          {history.map((entry) => (
            <span
              className="bg-foreground/50 absolute h-full"
              key={entry.at}
              style={{
                left: `${duration > 0 ? Math.min(99.5, ((entry.at - first.at) / duration) * 100) : 0}%`,
                width: `${duration > 0 ? Math.max(0.5, ((entry.until - entry.at) / duration) * 100) : 100}%`,
              }}
            />
          ))}
        </div>
        <input
          aria-label="Transport replay timeline"
          aria-valuetext={`${TIMESTAMP.format(time)} Berlin time`}
          className="focus-visible:outline-ring [&::-moz-range-thumb]:bg-foreground [&::-webkit-slider-thumb]:bg-foreground relative h-6 w-full cursor-pointer appearance-none rounded-sm bg-transparent focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-default [&::-moz-range-thumb]:size-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-track]:bg-transparent [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full"
          disabled={duration === 0}
          max={1000}
          min={0}
          onChange={(event) =>
            seekReplay(
              Math.round(
                first.at + (Number(event.target.value) / 1000) * duration
              )
            )
          }
          step={1}
          type="range"
          value={progress}
        />
      </div>
      <div className="text-muted-foreground flex justify-between gap-2 text-xs tabular-nums">
        <span>{BOUNDARY.format(first.at)}</span>
        <span>{BOUNDARY.format(last.at)}</span>
      </div>
      <PlaybackButtons duration={duration} replaying={replaying} />
      <output className="text-muted-foreground mt-2 block text-xs leading-relaxed">
        {status}
      </output>
    </>
  );
}

export function TransitReplayControls() {
  const mode = useTransitStore((state) => state.mode);
  const history = useTransitStore((state) => state.history);
  const historyStatus = useTransitStore((state) => state.historyStatus);
  const historyError = useTransitStore((state) => state.historyError);
  const replayError = useTransitStore((state) => state.replayError);
  const displayedTime = useTransitStore((state) => {
    if (state.mode === "live") {
      return state.history.at(-1)?.at ?? 0;
    }
    return state.playing
      ? Math.floor(state.clockTime / 250) * 250
      : state.clockTime;
  });
  const seekReplay = useTransitStore((state) => state.seekReplay);
  const backToLive = useTransitStore((state) => state.backToLive);
  const retryReplay = useTransitStore((state) => state.retryReplay);
  const [first] = history;
  const last = history.at(-1);
  const replaying = mode === "replay";
  const time =
    first && last ? Math.max(first.at, Math.min(last.at, displayedTime)) : 0;
  return (
    <section
      aria-label="Transport replay"
      className="shrink-0 border-t px-4 py-3"
    >
      <div className="flex min-h-7 items-center justify-between gap-2">
        <div className="min-w-0">
          <p
            className={cn(
              "text-xs font-medium",
              replaying ? "text-foreground" : "text-muted-foreground"
            )}
          >
            {replaying ? "Replay · Berlin time" : "Saved history"}
          </p>
          {replaying && (
            <time
              className="mt-1 block text-xs font-medium tabular-nums"
              dateTime={new Date(time).toISOString()}
            >
              {TIMESTAMP.format(time)}
            </time>
          )}
        </div>
        {replaying ? (
          <Button
            className="h-7 shrink-0 rounded-full px-2.5 text-xs"
            onClick={backToLive}
            size="sm"
            variant="outline"
          >
            Back to live
          </Button>
        ) : (
          <Button
            className="h-7 rounded-full px-2.5 text-xs"
            disabled={!first}
            onClick={() => first && seekReplay(first.at)}
            size="sm"
            variant="outline"
          >
            Replay
          </Button>
        )}
      </div>
      {first && last ? (
        <HistoryTimeline
          first={first}
          history={history}
          last={last}
          replaying={replaying}
          time={time}
        />
      ) : (
        <output className="text-muted-foreground mt-2 block text-xs leading-relaxed">
          {historyStatus === "loading"
            ? "Checking saved history…"
            : (historyError ??
              "No saved history yet. Replay appears as snapshots are saved.")}
        </output>
      )}
      {replaying && replayError && (
        <div className="mt-2 text-xs leading-relaxed" role="alert">
          <p className="text-amber-700 dark:text-amber-400">{replayError}</p>
          <Button
            className="mt-2 h-7 rounded-lg text-xs"
            onClick={retryReplay}
            size="sm"
            variant="outline"
          >
            Retry snapshot
          </Button>
        </div>
      )}
    </section>
  );
}
