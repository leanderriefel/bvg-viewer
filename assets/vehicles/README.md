# Berlin transit vehicle library

49 original low-poly vehicle assets for Three.js, modeled from scratch in Blender 5.2.3. Operator/manufacturer references informed the silhouettes, liveries and nominal dimensions. No third-party meshes, photos, logos or textures are embedded.

Open `/models/vehicles/` while the app is running to explore the collection, search a service and download a GLB. The standalone page also works with a static HTTP server whose root is `public/`. Its preview loads pinned Three.js 0.180.0 modules from jsDelivr; the GLBs themselves have no network or decoder dependencies.

## Files

| Path | Contents |
| --- | --- |
| `public/models/vehicles/*.glb` | 49 standalone glTF 2.0 binary assets; approximately 12.2 MiB together |
| `public/models/vehicles/catalog.json` | Model metadata, 266 mode-qualified service entries, alternatives, confidence and primary sources |
| `public/models/vehicles/previews/` | Rendered QA views; long trains show two leading cars, explicitly recorded in `views.json` |
| `assets/vehicles/berlin-vehicle-fleet.blend` | Directly openable Blender source, with an editable fleet overview |
| `assets/vehicles/fleet.json` | Authored dimensions, family definitions, service inventory and evidence links |
| `scripts/blender/build_vehicles.py` | Original procedural mesh construction and GLB export |
| `scripts/build-vehicles.mjs` | Rebuild through the live Blender Lab add-on |
| `scripts/blender/render_vehicles.py` | Reproducible Blender thumbnail rendering |
| `tests/vehicle-assets.test.ts` | Export-contract, bounds, material, metadata and service regression checks |

## Inventory

| Mode | Count | Families represented |
| --- | --: | --- |
| S-Bahn | 4 | BR 480, BR 481/482, BR 483, BR 484 |
| U-Bahn | 8 | A3/A3L, GI/1E, HK, IK, JK, F, H, J |
| Tram | 11 | Flexity short/long, Urbanliner, GT6N/U, GT6Z, Woltersdorf Moderus Gamma, SRS Artic/KTNF6, Potsdam Combino XL/Variobahn/Tramlink |
| Bus | 8 | Solo, articulated, electric solo/articulated, Enviro500 double deck, heritage SD202 family, neutral regional bus, representative airport coach |
| Regional | 8 | DB Dosto push-pull, Talent 2, ODEG Desiro HC/KISS, NEB Mireo Plus B/Plus H/Pesa Link, DB LINT 41 |
| Long-distance | 9 | ICE 1/2/3/4/T, IC2 Dosto, conventional EuroCity, CD ComfortJet, unidentified-train fallback |
| Ferry | 1 | F23 FaehrBaer solar catamaran |

These are simplified game/map assets. Technical dimensions are used where established; other envelopes, coach counts, graphics, door positions and small fittings are representative. `nominalDimensions` records the construction envelope. `dimensions` records the exported bounding box, including mirrors and couplers. This is not a set of engineering replicas.

## Coordinate and rendering contract

- glTF uses metres, **+Y up**, **+Z forward**, **+X right**. Root transforms are identity at scale 1.
- Each root sits at the **horizontal bounding-box center on the ground/water plane** (minimum Y = 0). Rail height includes wheels; boats start at the bottom of their simplified hulls.
- Every rigid car/section is a separate mesh with an individually usable pivot, listed in `segments`. Rear bus sections pivot at the accordion joint. Rail-car pivots are at each car's body center; rail-path animation must position the cars along the path.
- `segments[].node` is the actual exported node name; Blender may append a suffix on repeated live builds. `id` and the per-node `segmentIndex` remain stable. `segments[].offset` is the glTF-space pivot position.
- One opaque PBR vertex-color material, one primitive/draw call per rigid section. No transparent glass sorting, textures, skeletons, animations, external buffers or required extensions. Windows are dark opaque geometry.
- The entire library contains 188,962 triangles. Catalog statistics are per full asset. Load only the required families; share geometry/materials between clones and use instancing for large vehicle populations. Twelve-car trains naturally cost more than solo buses.
- In the Blender overview, long roots have a display scale so the whole collection is usable. The underlying meshes and all GLB exports use metres. Reset the asset root's location, rotation and scale before exporting manually.

## Three.js loading and service selection

```js
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const catalogResponse = await fetch("/models/vehicles/catalog.json");
if (!catalogResponse.ok) {
  throw new Error(`Vehicle catalog: HTTP ${catalogResponse.status}`);
}
const catalog = await catalogResponse.json();

// Keep mode from the feed: M1 can be a bus or a tram; S41 can be rail replacement.
const mode = "s-bahn";
const line = "S41".replaceAll(/\s+/g, "").toUpperCase();
const service = catalog.services.find(
  (entry) => entry.mode === mode && entry.line === line
);
if (!service) {
  throw new Error(`No vehicle family configured for ${mode} ${line}`);
}
const model = catalog.models.find((entry) => entry.id === service.defaultModel);
if (!model) {
  throw new Error(`Missing model ${service.defaultModel}`);
}
const asset = await new GLTFLoader().loadAsync(model.modelUrl);
scene.add(asset.scene); // An existing THREE.Scene, with appropriate lighting.
// asset.scene.clone(true) shares geometry/materials for repeated vehicles.
```

For verified live fleet IDs, choose the corresponding model directly instead of inferring the class from the line number. Consult `confidence`, `note`, `alternatives` and the linked sources when displaying a default:

- `family`: operator/manufacturer/VBB evidence supports the family. The precise departure, livery and formation can still vary.
- `representative`: a useful visual choice with incomplete route/class allocation evidence.
- `unknown`: the supplied label cannot determine the required vehicle identity. A clearly documented fallback is provided.

## Research decisions

Evidence was reviewed for **24 October 2026**, not the future timetable. Sources are linked individually in `catalog.json` and `fleet.json`.

- [S-Bahn Berlin](https://sbahn.berlin/das-unternehmen/fahrzeugpark/) identifies 480, 481 and 483/484 as the active fleet families. Older 485 trains are not contemporary defaults.
- [BVG](https://www.bvg.de/de/unternehmen/nachhaltige-mobilitaet/flotte/u-bahn) distinguishes the narrow U1-U4 and wider U5-U9 systems and dates the J/JK passenger introduction. Older current families remain in the pack.
- [BVG's Urbanliner announcement](https://www.bvg.de/de/unternehmen/medienportal/pressemitteilungen/20260715-start-urbanliner-fahrgastbetrieb) supports the new M4 family. Other BVG tram line choices are representative, not verified daily allocations.
- 87 is Woltersdorf, 88 is Schoneiche-Rudersdorf, and 91/92 are Potsdam. Potsdam and SRS retain their own colors. BVG's retired regular KT4D fleet is not used as a contemporary default.
- [ODEG](https://www.odeg.de/unternehmen/fahrzeugflotte/desiro-hc) distinguishes the mixed-height Desiro HC from the all-double-deck KISS. [NEB](https://www.neb.de/unternehmen/fahrzeuge/) now includes battery/hydrogen Mireo families. RB55's LINT assignment is based on contract evidence and remains representative.
- [DB's 2026 IC change](https://www.deutschebahn.com/de/presse/presse-regional/pr-leipzig-de/aktuell/presseinformationen/Sonntag-ist-Fahrplanwechsel-Alle-Neuerungen-fuer-Sachsen-Sachsen-Anhalt-und-Thueringen-im-Ueberblick-13696100) supports IC2 double-deck coaches for IC2177. [CD](https://www.ceskedrahy.cz/en/press-center/press-releases/only-complete-comfortjet-trainsets-will-be-travelling-berlin-original) supports blue/white ComfortJets for Berliner/RJ178.
- ICE service numbers do not permanently prove a train class. The six supplied ICE labels use an explicitly unknown ICE4 fallback with ICE1/2/3/T alternatives; [DB's travel-day formation](https://www.bahn.de/service/zug/fahrtinformationen) is the appropriate way to refine them. `1236` stays neutral and unidentified.
- Bus prefixes do not establish manufacturer, capacity or traction. Yellow BVG body types are reusable options; ambiguous and outlying route labels use neutral fallbacks where agency identity is absent. Electric 300, some heritage 218 workings and BER2 are documented special cases with limits recorded in the catalog.
- [FRS's FaehrBaer specification](https://www.frs-weisse-flotte.de/informationen/schiffe/sf-faerbaer-1bis4) supports the F23 solar catamaran, rather than a rowing boat or large sightseeing ship.

## Rebuild

Start the official Blender Lab MCP add-on server on `127.0.0.1:9876` in Blender 5.2, then run:

```sh
vp run vehicles:build
vp test run tests/vehicle-assets.test.ts
```

The builder creates a dedicated live scene, exports only that scene's selected vehicle, and writes an isolated source library. A separate background Blender converts that library to an ordinary `.blend`. The live user's original file and other scene data are not saved into the distributed source. Repeated builds create a new fleet scene so existing work is preserved.

For a background-only rebuild, run the installed Blender executable with `--background --python scripts/blender/build_vehicles.py -- --root .`, then run `scripts/blender/finalize_vehicles.py` against the resulting library (see the Node runner for the exact argument structure).

For thumbnails, use the installed Blender executable:

```sh
blender --background assets/vehicles/berlin-vehicle-fleet.blend --python scripts/blender/render_vehicles.py -- --root .
```

`--only sbahn-483 bus-bvg-double-deck` limits thumbnail rendering. Preview PNGs are derivatives; the GLBs remain full consists at scale 1.

With Python and Pillow installed, `python scripts/blender/compose_previews.py` arranges those rendered views into the two contact sheets in this directory.

## Validation and license

All 49 GLBs were parsed with Three.js 0.180.0 `GLTFLoader` and checked with the Khronos glTF validator (2.0.0-dev.3.10): **zero errors and zero warnings**. The 53 regression cases independently read binary accessors and check finite geometry, bounds, root isolation, colors, indices, triangles, mesh counts, child-node metadata, evidence links and mode collisions.

Original geometry, generated GLBs, Blender source and preview renders are dedicated to the public domain under **CC0 1.0**; see `LICENSE.txt`. Operator/manufacturer names identify the modeled vehicle families.
