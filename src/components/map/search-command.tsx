import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { useMapApi } from "@/map/map-context";
import { cameraFor, geocode, searchLandmarks } from "@/map/search";
import type { SearchResult } from "@/map/search";
import { useMapStore } from "@/map/store";

import { ResultIcon, SearchIcon } from "./icons";

/** How long to sit on a keystroke before asking the geocoder. */
const DEBOUNCE_MS = 220;

export function SearchCommand() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [remote, setRemote] = useState<SearchResult[]>([]);

  // Curated matches are a pure function of the query, so they are derived
  // during render rather than pushed through state by an effect - that is what
  // makes them land on the keystroke with no extra render.
  const local = useMemo(() => searchLandmarks(query), [query]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const { flyTo } = useMapApi();
  const setMarker = useMapStore((s) => s.setMarker);
  const abortRef = useRef<AbortController | null>(null);

  // Cmd/Ctrl+K anywhere, and plain "/" when not already typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;

      if (
        (e.key === "k" && (e.metaKey || e.ctrlKey)) ||
        (e.key === "/" && !typing)
      ) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    abortRef.current?.abort();

    if (query.trim().length < 3) {
      // Clearing the previous query's results is the whole job of this effect.
      // oxlint-disable-next-line react/set-state-in-effect
      setRemote([]);
      setLoading(false);
      setFailed(false);
      return;
    }

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setFailed(false);

    const run = async () => {
      try {
        setRemote(await geocode(query, ctrl.signal));
        setLoading(false);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        // The map is still fully usable from the curated list, so a geocoder
        // outage is a note in the panel rather than an error state.
        setRemote([]);
        setFailed(true);
        setLoading(false);
      }
    };

    const timer = window.setTimeout(() => {
      run();
    }, DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [query]);

  const go = useCallback(
    (result: SearchResult) => {
      const cam = cameraFor(result);
      flyTo({ center: result.center, ...cam });
      setMarker({ center: result.center, label: result.title });
      setOpen(false);
      setQuery("");
    },
    [flyTo, setMarker]
  );

  return (
    <>
      <Button
        aria-label="Search Berlin"
        className="bg-card/80 text-muted-foreground h-10 w-full justify-start gap-2 rounded-xl px-3 shadow-sm backdrop-blur-md sm:w-72"
        onClick={() => setOpen(true)}
        variant="outline"
      >
        <SearchIcon size={16} />
        <span className="truncate text-sm">Search Berlin…</span>
        <kbd className="bg-muted text-muted-foreground ml-auto hidden rounded border px-1.5 py-0.5 font-mono text-[10px] sm:inline">
          ⌘K
        </kbd>
      </Button>

      <CommandDialog
        description="Find a landmark, street or house number"
        onOpenChange={setOpen}
        open={open}
        title="Search Berlin"
      >
        {/* Our own scorer already ranked these, so cmdk must not re-sort or
            re-filter them against the raw query. */}
        <Command shouldFilter={false}>
          <CommandInput
            onValueChange={setQuery}
            placeholder="Brandenburger Tor, Oranienstraße 10, Mitte…"
            value={query}
          />
          <CommandList>
            {query.length === 0 && (
              <div className="text-muted-foreground px-4 py-6 text-center text-sm">
                Type a landmark, a street, or a full address.
              </div>
            )}

            {query.length > 0 &&
              local.length === 0 &&
              remote.length === 0 &&
              !loading && (
                <CommandEmpty>
                  {failed
                    ? "The address search is unavailable right now."
                    : "Nothing found in Berlin."}
                </CommandEmpty>
              )}

            {local.length > 0 && (
              <CommandGroup heading="Places in Berlin">
                {local.map((r) => (
                  <ResultRow key={r.id} onSelect={go} result={r} />
                ))}
              </CommandGroup>
            )}

            {local.length > 0 && remote.length > 0 && <CommandSeparator />}

            {remote.length > 0 && (
              <CommandGroup heading="Addresses & streets">
                {remote.map((r) => (
                  <ResultRow key={r.id} onSelect={go} result={r} />
                ))}
              </CommandGroup>
            )}

            {loading && (
              <div className="text-muted-foreground px-4 py-3 text-center text-xs">
                Searching addresses…
              </div>
            )}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}

function ResultRow({
  result,
  onSelect,
}: {
  result: SearchResult;
  onSelect: (r: SearchResult) => void;
}) {
  return (
    <CommandItem
      className="gap-3"
      onSelect={() => onSelect(result)}
      value={result.id}
    >
      <ResultIcon
        className="text-muted-foreground"
        kind={result.kind}
        size={16}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">{result.title}</div>
        {result.subtitle && (
          <div className="text-muted-foreground truncate text-xs">
            {result.subtitle}
          </div>
        )}
      </div>
    </CommandItem>
  );
}
