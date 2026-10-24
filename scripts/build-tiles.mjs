/**
 * Builds public/tiles/berlin.pmtiles from the OpenStreetMap Berlin extract.
 *
 * Planetiler turns the ~95 MB Geofabrik extract into a single PMTiles archive
 * in the OpenMapTiles schema - the same schema the hosted fallback serves, so
 * the map style does not change at all when this file appears. PMTiles is a
 * single file addressed by HTTP range requests, which is why shipping a whole
 * city does not mean the visitor downloads a whole city: the browser pulls only
 * the few kilobytes covering what is on screen, and the service worker keeps
 * them.
 *
 * Requires Java 21+. Run with `vp run tiles:build`.
 */
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, stat, rename } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const PLANETILER_VERSION = "v0.10.2";
const PLANETILER_URL = `https://github.com/onthegomap/planetiler/releases/download/${PLANETILER_VERSION}/planetiler.jar`;

const CACHE_DIR = join(process.cwd(), ".cache");
const JAR = join(CACHE_DIR, `planetiler-${PLANETILER_VERSION}.jar`);
const OUT_DIR = join(process.cwd(), "public", "tiles");
const OUT = join(OUT_DIR, "berlin.pmtiles");

/** Heap for Planetiler. Berlin is small; this is comfortable, not required. */
const HEAP = process.env.PLANETILER_HEAP ?? "4g";

async function exists(p) {
  try {
    const info = await stat(p);
    return info.size > 0;
  } catch {
    return false;
  }
}

function human(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function download(url, dest) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) {
    throw new Error(`Download failed: ${url} -> HTTP ${res.status}`);
  }

  const total = Number(res.headers.get("content-length") ?? 0);
  let seen = 0;
  let lastLogged = 0;

  const body = Readable.fromWeb(res.body);
  body.on("data", (chunk) => {
    seen += chunk.length;
    // Throttle progress so CI logs stay readable.
    if (seen - lastLogged > 8 * 1024 * 1024) {
      lastLogged = seen;
      const pct = total ? ` (${Math.round((seen / total) * 100)}%)` : "";
      process.stdout.write(`  ${human(seen)}${pct}\r`);
    }
  });

  const tmp = `${dest}.part`;
  await pipeline(body, createWriteStream(tmp));
  await rename(tmp, dest);
  process.stdout.write(`  ${human(seen)} done\n`);
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${cmd} exited with code ${code}`))
    );
  });
}

async function main() {
  await mkdir(CACHE_DIR, { recursive: true });
  await mkdir(OUT_DIR, { recursive: true });

  if (await exists(JAR)) {
    console.log(`Planetiler ${PLANETILER_VERSION} already cached.`);
  } else {
    console.log(`Downloading Planetiler ${PLANETILER_VERSION}…`);
    await download(PLANETILER_URL, JAR);
  }

  console.log("\nBuilding Berlin tiles (this takes a few minutes)…\n");

  await run("java", [
    `-Xmx${HEAP}`,
    // Planetiler is happier with a large young generation on short runs.
    "-XX:+UseParallelGC",
    "-jar",
    JAR,
    "--download",
    "--area=berlin",
    // Keep the downloaded .osm.pbf and intermediate data out of the repo root.
    `--data-dir=${join(CACHE_DIR, "planetiler-data")}`,
    `--output=${OUT}`,
    "--force",
    // House numbers power the address search, and the extra layers are what
    // make the map worth zooming into.
    "--max-zoom=14",
    // Detail knobs, deliberately looser than Planetiler's defaults. The map
    // reads colour blocks, not survey geometry: a wider simplification
    // tolerance and a larger minimum feature size strip vertices and tiny
    // slivers from every layer, which shrinks the archive and the per-tile
    // decode/parse work in the browser. Houses keep their shape; hedges and
    // kerbs do not survive.
    "--simplify_tolerance=0.3",
    "--min_feature_size=1.5",
    "--simplify_tolerance_at_max_zoom=0.125",
    "--min_feature_size_at_max_zoom=0.125",
  ]);

  const outStat = await stat(OUT);
  const { size } = outStat;
  console.log(`\nWrote public/tiles/berlin.pmtiles (${human(size)}).`);
  console.log("Reload the app - it will pick the local extract automatically.");
}

main().catch((error) => {
  console.error(`\n${error.message}`);
  console.error(
    "\nPlanetiler needs Java 21 or newer on PATH. Check with: java -version"
  );
  process.exit(1);
});
