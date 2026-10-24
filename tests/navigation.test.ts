import { expect, it } from "vite-plus/test";

import Point from "../node_modules/@mapbox/point-geometry/index.js";
import {
  generateMousePitchHandler,
  generateMouseRotationHandler,
} from "../node_modules/maplibre-gl/src/ui/handler/mouse.ts";
import { DRAG_ROTATE_OPTIONS } from "../src/map/navigation";

// Exercise the installed engine rather than copying its gesture mathematics.
// This file lives outside src so private MapLibre source types stay out of tsc.
const CENTER = new Point(500, 300);
const RIGHT_BUTTON_EVENT = {
  button: 2,
  buttons: 2,
  ctrlKey: false,
  preventDefault() {},
} as MouseEvent;

type Coordinates = readonly [number, number];

const GESTURES: {
  name: string;
  points: readonly Coordinates[];
  deltas: readonly number[];
}[] = [
  {
    name: "above the center",
    points: [
      [480, 250],
      [490, 250],
      [510, 250],
    ],
    deltas: [8, 16],
  },
  {
    name: "below the center",
    points: [
      [480, 350],
      [490, 350],
      [510, 350],
    ],
    deltas: [8, 16],
  },
  {
    name: "crossing the center line",
    points: [
      [480, 299],
      [490, 299],
      [500, 300],
      [510, 301],
    ],
    deltas: [8, 8, 8],
  },
  {
    name: "crossing the center during a sparse diagonal move",
    points: [
      [490, 190],
      [510, 300],
      [520, 301],
    ],
    deltas: [16, 8],
  },
  {
    name: "passing just above the center during a sparse diagonal move",
    points: [
      [490, 190],
      [510, 299.999],
      [520, 301],
    ],
    deltas: [16, 8],
  },
];

it.each(GESTURES)("rotates consistently $name", ({ points, deltas }) => {
  const handler = generateMouseRotationHandler(
    { enable: true, clickTolerance: 1 },
    () => CENTER,
    () => DRAG_ROTATE_OPTIONS.around,
    () => DRAG_ROTATE_OPTIONS.movement
  );
  const [start, ...moves] = points;
  handler.dragStart(RIGHT_BUTTON_EVENT, new Point(...start));

  const actualDeltas = moves.map(
    (point) =>
      handler.dragMove(RIGHT_BUTTON_EVENT, new Point(...point))?.bearingDelta
  );

  expect(actualDeltas).toEqual(deltas);
});

it("preserves right-button pitching during rotation", () => {
  const handler = generateMousePitchHandler(
    { enable: true, clickTolerance: 1 },
    () => DRAG_ROTATE_OPTIONS.around
  );
  handler.dragStart(RIGHT_BUTTON_EVENT, new Point(490, 190));

  expect(handler.dragMove(RIGHT_BUTTON_EVENT, new Point(510, 300))).toEqual({
    pitchDelta: -55,
  });
});
