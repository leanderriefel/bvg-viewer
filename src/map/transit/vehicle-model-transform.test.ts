import { MercatorCoordinate } from "maplibre-gl";
import { Matrix4, Vector3 } from "three";
import { describe, expect, it } from "vite-plus/test";

import {
  setVehicleModelMatrix,
  VEHICLE_MODEL_MERCATOR_ORIGIN,
  VEHICLE_MODEL_ORIGIN,
  VEHICLE_MODEL_ORIGIN_UNITS_PER_METER,
} from "./vehicle-model-transform";

function sceneAnchor(): Matrix4 {
  const { x, y, z } = VEHICLE_MODEL_MERCATOR_ORIGIN;
  const scale = VEHICLE_MODEL_ORIGIN_UNITS_PER_METER;
  return new Matrix4().set(
    scale,
    0,
    0,
    x,
    0,
    0,
    -scale,
    y,
    0,
    scale,
    0,
    z,
    0,
    0,
    0,
    1
  );
}

describe("vehicle model world transforms", () => {
  it.each([
    [0, 0, 1],
    [90, 1, 0],
    [180, 0, -1],
    [270, -1, 0],
  ])(
    "faces compass bearing %s in local east/up/north axes",
    (bearing, east, north) => {
      const transform = setVehicleModelMatrix(
        new Matrix4(),
        VEHICLE_MODEL_ORIGIN,
        bearing
      );
      const forward = new Vector3(0, 0, 1).applyMatrix4(transform);
      expect(forward.x).toBeCloseTo(east, 10);
      expect(forward.y).toBeCloseTo(0, 10);
      expect(forward.z).toBeCloseTo(north, 10);
      expect(transform.determinant()).toBeCloseTo(1, 10);
    }
  );

  it.each([
    [13.405, 52.52, 0],
    [13.1, 52.3, 23],
    [13.8, 52.7, 100],
    [13.5, 60, -3],
  ])(
    "matches MapLibre's geographic position and metre scale at %s, %s",
    (longitude, latitude, altitude) => {
      const position: [number, number] = [longitude, latitude];
      const expected = MercatorCoordinate.fromLngLat(position, altitude);
      const transform = setVehicleModelMatrix(
        new Matrix4(),
        position,
        0,
        altitude
      );
      const anchored = sceneAnchor().multiply(transform);
      const groundCentre = new Vector3().applyMatrix4(anchored);
      expect(groundCentre.x).toBeCloseTo(expected.x, 13);
      expect(groundCentre.y).toBeCloseTo(expected.y, 13);
      expect(groundCentre.z).toBeCloseTo(expected.z, 13);

      const metre = expected.meterInMercatorCoordinateUnits();
      const roof = new Vector3(0, 1, 0).applyMatrix4(anchored);
      const front = new Vector3(0, 0, 1).applyMatrix4(anchored);
      expect(roof.z - groundCentre.z).toBeCloseTo(metre, 13);
      expect(front.y - groundCentre.y).toBeCloseTo(-metre, 13);
      expect(transform.elements[5]).toBeCloseTo(
        metre / VEHICLE_MODEL_ORIGIN_UNITS_PER_METER,
        12
      );
    }
  );

  it("keeps the same world anchor through camera translation, rotation and zoom", () => {
    const model = setVehicleModelMatrix(new Matrix4(), [13.45, 52.55], 37, 12);
    const world = sceneAnchor().multiply(model);
    const initialWorld = world.clone();
    const point = new Vector3(1, 2, 3);
    const expected = point.clone().applyMatrix4(world);
    const cameras = [
      new Matrix4(),
      new Matrix4().makeTranslation(-0.55, -0.33, -0.001),
      new Matrix4().makeRotationZ(0.7).scale(new Vector3(100, 100, 100)),
    ];
    for (const camera of cameras) {
      const clip = point.clone().applyMatrix4(camera.clone().multiply(world));
      const recoveredWorld = clip.applyMatrix4(camera.clone().invert());
      expect(recoveredWorld.distanceTo(expected)).toBeLessThan(1e-12);
      expect(world.equals(initialWorld)).toBe(true);
    }
    expect(Object.isFrozen(VEHICLE_MODEL_ORIGIN)).toBe(true);
    expect(Object.isFrozen(VEHICLE_MODEL_MERCATOR_ORIGIN)).toBe(true);
  });

  it("reuses the supplied matrix and fully replaces a previous pose", () => {
    const target = new Matrix4().makeScale(12, 3, 7);
    const { elements } = target;
    expect(setVehicleModelMatrix(target, [13.5, 52.6], 135, 20)).toBe(target);
    expect(target.elements).toBe(elements);
    setVehicleModelMatrix(target, VEHICLE_MODEL_ORIGIN, 0);
    expect(target.equals(new Matrix4())).toBe(true);
  });

  it("rejects nonfinite inputs and positions outside Web Mercator", () => {
    const target = new Matrix4();
    expect(() => setVehicleModelMatrix(target, [13, 90], 0)).toThrow(
      "Web Mercator"
    );
    expect(() => setVehicleModelMatrix(target, [Number.NaN, 52], 0)).toThrow(
      "Web Mercator"
    );
    expect(() => setVehicleModelMatrix(target, [13, 52], Infinity)).toThrow(
      "Web Mercator"
    );
    expect(() =>
      setVehicleModelMatrix(target, [13, 52], 0, Number.NaN)
    ).toThrow("Web Mercator");
  });
});
