/**
 * Vendors the glyph ranges the map actually needs into public/fonts.
 *
 * Bundling them removes a third-party request from the hot path on first paint
 * and lets the whole basemap render while offline. Only the Latin ranges that
 * German/English labels touch are fetched - the full Noto range would be ~40x
 * larger for glyphs we never draw.
 */
import { mkdir, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";

const UPSTREAM = "https://tiles.openfreemap.org/fonts";
const OUT_DIR = join(process.cwd(), "public", "fonts");

const FONTS = ["Noto Sans Regular", "Noto Sans Bold"];
const RANGES = [
  "0-255", // Basic Latin + Latin-1 (covers ä ö ü ß)
  "256-511", // Latin Extended-A
  "768-1023", // Combining diacritics
  "7680-7935", // Latin Extended Additional
  "8192-8447", // General punctuation, arrows, currency
  "8448-8703", // Letterlike symbols, number forms
];

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  let fetched = 0;
  let skipped = 0;

  for (const font of FONTS) {
    const dir = join(OUT_DIR, font);
    await mkdir(dir, { recursive: true });

    for (const range of RANGES) {
      const dest = join(dir, `${range}.pbf`);
      if (await exists(dest)) {
        skipped++;
        continue;
      }

      const url = `${UPSTREAM}/${encodeURIComponent(font)}/${range}.pbf`;
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`  ! ${font} ${range} -> HTTP ${res.status}`);
        continue;
      }

      await writeFile(dest, Buffer.from(await res.arrayBuffer()));
      fetched++;
    }
    console.log(`  ok  ${font}`);
  }

  console.log(
    `\nGlyphs ready in public/fonts (${fetched} fetched, ${skipped} cached).`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
