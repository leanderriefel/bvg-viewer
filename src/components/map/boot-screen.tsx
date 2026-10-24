/**
 * What the server renders and what the user sees for the few hundred
 * milliseconds before WebGL comes up. Deliberately static: no fonts to swap,
 * no layout that will shift once the map paints over it.
 */
export function MapBootScreen() {
  return (
    <div className="bg-background flex h-dvh w-full flex-col items-center justify-center gap-5">
      <div className="relative size-14">
        <div className="bg-primary/25 absolute inset-0 animate-ping rounded-full" />
        <div className="bg-primary/70 absolute inset-[18%] rounded-full" />
      </div>

      <div className="text-center">
        <h1 className="font-heading text-lg">Berlin in 3D</h1>
        <p className="text-muted-foreground text-sm">Bringing up the city…</p>
      </div>
    </div>
  );
}
