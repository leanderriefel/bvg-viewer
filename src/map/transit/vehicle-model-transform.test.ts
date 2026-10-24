import { MercatorCoordinate } from "maplibre-gl";
import { Matrix4, Vector3 } from "three";
import { describe, expect, it } from "vite-plus/test";

import {
  createVehicleModelOrigin,
  setVehicleModelMatrix,
} from "./vehicle-model-transform";

const LOCATIONS = [
  { lng: 13.2, lat: 52.43 },
  { lng: 13.405, lat: 52.52 },
  { lng: 13.65, lat: 52.65 },
];

describe("vehicle scene rebasing", () => {
  it.each(LOCATIONS)(
    "keeps vehicle details near zero at $lng, $lat",
    (location) => {
      const origin = createVehicleModelOrigin(location);
      const matrix = setVehicleModelMatrix(
        new Matrix4(),
        [location.lng, location.lat],
        0,
        0.05,
        origin
      );
      const translation = new Vector3().setFromMatrixPosition(matrix);
      expect(translation.x).toBeCloseTo(0, 7);
      expect(translation.z).toBeCloseTo(0, 7);

      // The shader first adds instance translation to float32 model vertices.
      // Window highlight panels are only 1.5 mm above their glass. Translating
      // to city-wide coordinates here can round both surfaces to the same value.
      const body = Math.fround(Math.fround(1.28) + translation.x);
      const panel = Math.fround(Math.fround(1.2815) + translation.x);
      expect(panel - body).toBeCloseTo(0.0015, 6);
    }
  );

  it.each([0, 90, 225])(
    "preserves geographic position, altitude and bearing %s across origins",
    (bearing) => {
      const coordinates = [13.37, 52.49] as const;
      const expected = MercatorCoordinate.fromLngLat(
        [coordinates[0], coordinates[1]],
        2.5
      );
      const yaw = (bearing * Math.PI) / 180;
      const units = expected.meterInMercatorCoordinateUnits();

      for (const location of LOCATIONS) {
        const origin = createVehicleModelOrigin(location);
        const anchor = new Matrix4()
          .makeScale(
            origin.unitsPerMeter,
            origin.unitsPerMeter,
            origin.unitsPerMeter
          )
          .setPosition(origin.x, origin.y, origin.z)
          .multiply(new Matrix4().makeRotationX(Math.PI / 2));
        const matrix = setVehicleModelMatrix(
          new Matrix4(),
          coordinates,
          bearing,
          2.5,
          origin
        );
        const world = anchor.multiply(matrix);
        const ground = new Vector3().applyMatrix4(world);
        const nose = new Vector3(0, 0, 1).applyMatrix4(world);

        expect(ground.x).toBeCloseTo(expected.x, 12);
        expect(ground.y).toBeCloseTo(expected.y, 12);
        expect(ground.z).toBeCloseTo(expected.z, 12);
        expect((nose.x - ground.x) / units).toBeCloseTo(Math.sin(yaw), 7);
        expect((ground.y - nose.y) / units).toBeCloseTo(Math.cos(yaw), 7);
      }
    }
  );
});
