# Berlin in 3D

An interactive 3D map of Berlin built from OpenStreetMap data — buildings with real heights, parks, streets, the Spree and the lakes — that stays smooth from the whole-city view down to individual house numbers.

```bash
vp install
vp dev
```

Then open <http://localhost:3000>.

## What's in it

- **3D and 2D.** A pitched perspective view with extruded buildings, and a flat top-down mode that reads like a street map. The toggle keeps your position.
- **Five themes.** Daylight, Midnight, Vivid (buildings coloured by height), Blueprint and Slate. Switching re-paints without re-downloading a single tile, and the UI chrome follows the map's light/dark scheme.
- **Search.** `⌘K` / `Ctrl+K` (or `/`). Curated Berlin places resolve on the keystroke with no network at all; anything address-shaped goes to Photon, which indexes OSM down to the house number.
- **Places menu.** ~70 destinations, each with a hand-picked camera angle — a park gets a high gentle view, a tower gets looked up at.
- **Inspector.** Click any building for its height, estimated storey count and raw OSM attributes.
- **Live transport.** S-Bahn, U-Bahn, trams, buses, ferries and available regional / long-distance trains move through the map as coloured placeholders. Open the transport panel to filter modes; click a vehicle for its line, destination, operator, next stop and available delay.
- **Shareable views.** The camera lives in the URL hash (`#15.6/52.5163/13.3824/-25/70`), so any view can be linked.
- **Offline-ish.** Tiles, glyphs and the map engine are cached by a service worker, so a second visit costs almost no network.

## Map data

The map speaks the [OpenMapTiles](https://openmaptiles.org/schema/) schema and can read it from either of two sources. It picks automatically at startup and tells you which one is live in the status strip.

**Local extract (recommended).** `vp run tiles:build` runs [Planetiler](https://github.com/onthegomap/planetiler) over the Geofabrik Berlin extract and writes `public/tiles/berlin.pmtiles` — about **40 MB for the entire city**, z0–14. Needs Java 21+ and takes a few minutes. Despite the file size the visitor does not download 40 MB: PMTiles is a single archive addressed by HTTP range requests, so the browser pulls only the few kilobytes covering what is on screen, and the service worker keeps them.

**Hosted fallback.** Without a local extract the map falls back to [OpenFreeMap](https://openfreemap.org)'s hosted planet, so a fresh clone shows a map immediately. It is noticeably slower — the tiles come from the other side of the internet rather than from disk.

Both carry the same layers, so the style does not change between them.

## Live transport

The server collects the unauthenticated [VBB radar API](https://v6.vbb.transport.rest/api.html) over a 4 × 4 grid covering Berlin. Each cell requests up to 1,024 vehicles and a 60-second movement forecast with one-second frames. A sweep starts every 30 seconds when the previous one has finished. Requests are spaced by at least one second (normally 32 requests/minute), below the API's documented 100 requests/minute limit. Rate-limit responses pause the entire collector using `Retry-After`; outages back off. Trip IDs deduplicate vehicles crossing cell boundaries.

Browsers poll the shared `/api/transit` snapshot every five seconds, so additional visitors do not multiply upstream requests. Responses use gzip and conditional ETags to avoid retransmitting unchanged movement data. Browser polling pauses when the tab is hidden or transport is disabled. The server continues collecting after its first API request while the server process remains running. The panel shows coverage, freshness, collection problems and whether disk storage is available. Positions expire after 90 seconds; animation stops at the last supplied forecast point instead of extrapolating through an outage.

Snapshots are stored atomically in `.data/transit/latest.json`, with up to 120 compressed history files (`snapshot-000.json.gz` … `snapshot-119.json.gz`), approximately one hour at the normal cadence. Slots are overwritten as the ring advances. Set `TRANSIT_DATA_DIR` to change this directory, and mount persistent storage there when deploying. Saved snapshots are validated on restart and refreshed from VBB; disk failures fall back to memory and appear in the panel. History is retained for inspection and future replay; there is currently no replay UI.

Run this on a **persistent Node server with a writable data directory**. Collection starts lazily on the first `/api/transit` request. A static host or a serverless function that sleeps between requests cannot run continuous collection. Use one app process per upstream egress IP: the collector and its request budget are shared within one process, and independent replicas need an external shared collector before scaling out.

Vehicle rectangles follow the dense movement points supplied by VBB, with interpolation between points and a short correction blend when predictions change. These are **estimated positions**, not guaranteed GPS observations or independently matched OSM tracks. Bus, rail and ferry paths have the accuracy of the supplied shapes; underground services appear at the surface and bridge elevations are not inferred. Coverage is limited to vehicles the upstream radar returns, and capped cells are marked as partial. Delay is shown only when supplied for the next stop; an unknown delay is never treated as on time. The API supplies service categories and operators, not reliable rolling-stock model identifiers.

## Performance

This was the hard part, and it is worth writing down what actually mattered. Measured on the production build with Chrome's CPU throttled 6× to stand in for a mid-range laptop, at z15.6 with the camera pitched 70°:

| Change | Effect |
| --- | --- |
| Tile LOD falloff (`maxZoomLevelsOnScreen` 9.3 → 16) | **12 → 30 fps** |
| Collapsing 24 road layers into 3, and 11 landcover/landuse layers into 2 | 55 → 24 style layers |
| Raising `maxTileCacheSize` from 200 to 800 | the "performance" preset stopped being the _slowest_ one |
| Buildings from z13 instead of z15 | buildings reach the horizon instead of stopping in the near field |

Two findings were counter-intuitive enough to be worth repeating:

- **Buildings are not the bottleneck.** Moving the extrusion layer from z13 all the way to z16 — from "buildings everywhere" to "almost none" — only bought about 3 fps. **Tile count** is what dominates, because every layer pays for every tile, which is why the LOD knob is worth 2.5× on its own.
- **A small tile cache is not a performance setting.** Trimming it to 200 tiles made things _slower_, because rotating the camera kept evicting tiles that were about to be needed again and each one had to be re-parsed.

The rendering preset (Performance / Balanced / Quality) in the layers popover controls the LOD falloff, when extrusions start, and antialiasing.

Buildings only exist in OpenMapTiles from z13 up: z13 holds merged massing polygons and z14 holds individual footprints with real heights. Buildings use a separate source that keeps at least z13 detail in pitched views, while roads and labels can use coarser tiles. Both extrusion layers share that coverage, so tilting or rotating cannot leave a gap when the massing fades into detailed buildings.

## Stack

- [TanStack Start](https://tanstack.com/start) + React 19
- [MapLibre GL JS](https://maplibre.org/) for rendering, [PMTiles](https://protomaps.com/docs/pmtiles) for the local archive
- Tailwind CSS v4 and [shadcn/ui](https://ui.shadcn.com) (preset `b4c0P8qldI` — Lyra style, zinc base, amber accent, Geist + Merriweather, Hugeicons)
- [Vite+](https://viteplus.dev/) for development, builds, linting, formatting, and type checks, with [Ultracite](https://www.ultracite.ai/) presets
- Zustand for map state

## Scripts

| Command | What it does |
| --- | --- |
| `vp dev` | Dev server on :3000 |
| `vp build` / `vp preview` | Production build, then serve it |
| `vp run tiles:build` | Build the local Berlin PMTiles extract (needs Java 21+) |
| `vp run glyphs:fetch` | Re-fetch the vendored label glyphs |
| `vp check` | Check formatting and lint rules |
| `vp check --fix` | Format and apply safe lint fixes |
| `vp run typecheck` | TypeScript compiler checks (`tsc --noEmit`) |
| `vp test run` | Building visibility regression tests across rendering presets |
| `vp run generate-routes` | Regenerate the TanStack route tree |

Vite+ uses Bun to install dependencies and keeps `bun.lock` as the lockfile. All lint and format settings live in `vite.config.ts`, where Ultracite supplies the presets and Vite+ runs Oxlint and Oxfmt. The editor and pre-commit hook use the same configuration.

Type-aware linting is opt-in to preserve the existing Ultracite lint baseline. Run `vp run typecheck` separately for TypeScript compiler checks.

GitHub Actions runs formatting, linting, type checks, and the production build on pushes and pull requests. Node is pinned in `.node-version` and Bun in `package.json`. Downloaded map sources under `data/` and generated map assets are kept out of Git.

Use `vp run <script>` for custom package scripts. Built-in commands such as `vp dev` and `vp build` run directly, so the dev port and worker preparation are configured in Vite itself. Existing `bun run dev`, `bun run build`, `bun run check`, and `bun run fix` aliases also use Vite+.

Add `?debug` to the URL in a production build to expose the MapLibre instance as `window.__map` for profiling. It is always available in dev.

### Two things that will bite you

`public/maplibre/` holds a copy of MapLibre's worker, staged by `scripts/sync-map-worker.mjs` on every `dev` and `build`. It has to be served from `public/` because anything Vite serves out of `node_modules` gets an HMR preamble prepended, and that preamble touches `document` — which a Worker does not have. The worker then dies on load and the map stays blank with no error anywhere.

MapLibre's stylesheet is imported into a CSS layer in `src/styles.css`. Tailwind v4 puts every utility in `@layer utilities`, and unlayered CSS outranks any layer, so an unlayered `.maplibregl-map { position: relative }` would beat `.absolute` and collapse the map container to zero height.

## Attribution

Map data © OpenStreetMap contributors, licensed under the [ODbL](https://www.openstreetmap.org/copyright). Vector tiles use the OpenMapTiles schema (CC-BY). Geocoding by [Photon](https://photon.komoot.io).
