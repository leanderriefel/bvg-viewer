/**
 * Copies MapLibre's worker into public/ so the browser gets it verbatim.
 *
 * Vite's dev server rewrites every module it serves out of node_modules,
 * prepending an HMR preamble that imports `/@vite/client`. That preamble
 * touches `document`, which does not exist inside a Worker, so the worker
 * throws on load and then every style and every tile silently never finishes
 * parsing - the map stays blank with no error anywhere. Files under public/ are
 * streamed byte-for-byte instead, which sidesteps the whole problem in dev and
 * in the production build alike.
 *
 * The worker imports `./maplibre-gl-shared.mjs` relatively, so both files have
 * to land in the same directory. Re-run whenever maplibre-gl is upgraded;
 * the Vite plugin runs this automatically during dev and builds.
 */
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

const FILES = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];
const OUT_DIR = join(process.cwd(), "public", "maplibre");

async function main() {
  // maplibre-gl declares no "." export, so resolve via its manifest instead -
  // that also keeps this independent of any package manager's node_modules
  // layout (pnpm's nesting, bun's hoisting, npm's flattening).
  const manifest = require.resolve("maplibre-gl/package.json");
  const distDir = join(dirname(manifest), "dist");

  await mkdir(OUT_DIR, { recursive: true });

  for (const file of FILES) {
    await copyFile(join(distDir, file), join(OUT_DIR, file));
  }

  // Record which version is staged, so a stale copy is obvious.
  const pkg = JSON.parse(await readFile(manifest, "utf-8"));
  await writeFile(join(OUT_DIR, "VERSION"), `${pkg.version}\n`, "utf-8");

  console.log(`maplibre worker staged in public/maplibre (v${pkg.version})`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
