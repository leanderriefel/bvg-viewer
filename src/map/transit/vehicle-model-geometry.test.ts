import { readFile } from "node:fs/promises";

import {
  Box3,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Matrix3,
  Mesh,
  MeshStandardMaterial,
  SkinnedMesh,
  Vector3,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  disposeVehiclePrototype,
  mergeVehicleModelGeometry,
} from "./vehicle-model-geometry";

async function loadModel(id: string): Promise<Group> {
  const bytes = await readFile(
    new URL(`../../../public/models/vehicles/${id}.glb`, import.meta.url)
  );
  const gltf = await new GLTFLoader().parseAsync(
    Uint8Array.from(bytes).buffer,
    ""
  );
  return gltf.scene;
}

function meshesIn(root: Group): Mesh[] {
  const meshes: Mesh[] = [];
  root.traverse((object) => {
    if (object instanceof Mesh) {
      meshes.push(object);
    }
  });
  return meshes;
}

function expectVectorClose(actual: Vector3, expected: Vector3): void {
  expect(actual.x).toBeCloseTo(expected.x, 4);
  expect(actual.y).toBeCloseTo(expected.y, 4);
  expect(actual.z).toBeCloseTo(expected.z, 4);
}

function triangle(): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3)
  );
  geometry.setAttribute(
    "normal",
    new Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3)
  );
  geometry.setAttribute(
    "color",
    new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1], 3)
  );
  geometry.setIndex([0, 1, 2]);
  return geometry;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("vehicle GLB geometry merging", () => {
  it.each([
    ["sbahn-481", 4],
    ["ice-4", 12],
    ["tram-urbanliner", 9],
    ["bus-bvg-articulated", 2],
    ["ferry-faehrbaer", 1],
  ] as const)(
    "preserves %s bounds, triangles and vertex attributes in one draw",
    async (id, cars) => {
      const root = await loadModel(id);
      const meshes = meshesIn(root);
      expect(meshes).toHaveLength(cars);
      const originalBounds = new Box3().setFromObject(root, true);
      const originals = meshes.map(({ geometry }) => ({
        geometry,
        position: [...geometry.getAttribute("position").array],
        normal: [...geometry.getAttribute("normal").array],
        color: [...geometry.getAttribute("color").array],
        indices: [...(geometry.getIndex()?.array ?? [])],
        bounds: geometry.boundingBox?.clone(),
        dispose: vi.spyOn(geometry, "dispose"),
      }));
      const merged = mergeVehicleModelGeometry(root);
      try {
        const actualBounds = merged.boundingBox;
        expect(actualBounds).not.toBeNull();
        if (!actualBounds) {
          throw new Error("Merged geometry must expose its bounds.");
        }
        expectVectorClose(actualBounds.min, originalBounds.min);
        expectVectorClose(actualBounds.max, originalBounds.max);
        expect(merged.boundingSphere?.radius).toBeGreaterThan(0);
        expect(merged.groups).toEqual([]);
        expect(merged.getIndex()?.count).toBe(
          originals.reduce((count, source) => count + source.indices.length, 0)
        );
        expect(merged.getAttribute("position").count).toBe(
          meshes.reduce(
            (count, mesh) =>
              count + mesh.geometry.getAttribute("position").count,
            0
          )
        );
        expect(merged.getAttribute("normal").count).toBe(
          merged.getAttribute("position").count
        );
        for (const name of ["position", "normal", "color"]) {
          expect(merged.getAttribute(name).itemSize).toBe(
            meshes[0].geometry.getAttribute(name).itemSize
          );
          expect(merged.getAttribute(name).normalized).toBe(
            meshes[0].geometry.getAttribute(name).normalized
          );
        }
        expect([...merged.getAttribute("color").array]).toEqual(
          originals.flatMap((source) => source.color)
        );
        for (const source of originals) {
          expect(source.dispose).not.toHaveBeenCalled();
          expect([...source.geometry.getAttribute("position").array]).toEqual(
            source.position
          );
          expect([...source.geometry.getAttribute("normal").array]).toEqual(
            source.normal
          );
          expect([...source.geometry.getAttribute("color").array]).toEqual(
            source.color
          );
          expect([...(source.geometry.getIndex()?.array ?? [])]).toEqual(
            source.indices
          );
          expect(source.geometry.boundingBox).toEqual(source.bounds);
        }
      } finally {
        merged.dispose();
        disposeVehiclePrototype(root);
      }
    }
  );

  it("bakes a reversed rear car and nested pivot/root transforms into positions and normals", async () => {
    const root = await loadModel("sbahn-481");
    const meshes = meshesIn(root);
    const rear = meshes.at(-1);
    if (!rear) {
      throw new Error("The S-Bahn fixture must include a rear driving car.");
    }
    expect(rear.quaternion.y).toBeCloseTo(-1, 5);
    const pivot = new Group();
    root.add(pivot);
    pivot.add(rear);
    pivot.position.set(2, 0.5, -3);
    pivot.rotation.y = 0.3;
    root.position.set(11, 4, -7);
    root.rotation.set(0.1, 0.6, -0.2);
    root.scale.set(2, 3, 4);
    root.updateMatrixWorld(true);
    const originalBounds = new Box3().setFromObject(root, true);
    const merged = mergeVehicleModelGeometry(root);
    try {
      let offset = 0;
      for (const mesh of meshes) {
        const positions = mesh.geometry.getAttribute("position");
        const normals = mesh.geometry.getAttribute("normal");
        const normalMatrix = new Matrix3().getNormalMatrix(mesh.matrixWorld);
        for (const index of [
          0,
          Math.floor(positions.count / 2),
          positions.count - 1,
        ]) {
          const expectedPosition = new Vector3()
            .fromBufferAttribute(positions, index)
            .applyMatrix4(mesh.matrixWorld);
          const expectedNormal = new Vector3()
            .fromBufferAttribute(normals, index)
            .applyNormalMatrix(normalMatrix);
          expectVectorClose(
            new Vector3().fromBufferAttribute(
              merged.getAttribute("position"),
              offset + index
            ),
            expectedPosition
          );
          expectVectorClose(
            new Vector3().fromBufferAttribute(
              merged.getAttribute("normal"),
              offset + index
            ),
            expectedNormal
          );
        }
        offset += positions.count;
      }
      if (!merged.boundingBox) {
        throw new Error("Merged geometry must expose its transformed bounds.");
      }
      expectVectorClose(merged.boundingBox.min, originalBounds.min);
      expectVectorClose(merged.boundingBox.max, originalBounds.max);
    } finally {
      merged.dispose();
      disposeVehiclePrototype(root);
    }
  });

  it("rejects scenes without rigid mesh geometry", () => {
    expect(() => mergeVehicleModelGeometry(new Group())).toThrow("no mesh");
    const root = new Group();
    root.add(new SkinnedMesh(triangle(), new MeshStandardMaterial()));
    try {
      expect(() => mergeVehicleModelGeometry(root)).toThrow("unskinned");
    } finally {
      disposeVehiclePrototype(root);
    }
  });

  it.each([
    [
      "missing normal",
      (geometry: BufferGeometry) => geometry.deleteAttribute("normal"),
    ],
    [
      "missing color",
      (geometry: BufferGeometry) => geometry.deleteAttribute("color"),
    ],
    [
      "unindexed triangles",
      (geometry: BufferGeometry) => geometry.setIndex(null),
    ],
    [
      "nonfinite positions",
      (geometry: BufferGeometry) =>
        geometry.getAttribute("position").setX(0, Number.NaN),
    ],
    [
      "empty vertices",
      (geometry: BufferGeometry) =>
        geometry.setAttribute("position", new Float32BufferAttribute([], 3)),
    ],
    [
      "mismatched colors",
      (geometry: BufferGeometry) =>
        geometry.setAttribute(
          "color",
          new Float32BufferAttribute([1, 0, 0], 3)
        ),
    ],
    [
      "out-of-range indices",
      (geometry: BufferGeometry) => geometry.setIndex([0, 1, 99]),
    ],
    [
      "incomplete triangle",
      (geometry: BufferGeometry) => geometry.setIndex([0, 1]),
    ],
  ] as const)("rejects malformed input: %s", (_label, mutate) => {
    const geometry = triangle();
    mutate(geometry);
    const root = new Group();
    root.add(new Mesh(geometry, new MeshStandardMaterial()));
    try {
      expect(() => mergeVehicleModelGeometry(root)).toThrow();
    } finally {
      disposeVehiclePrototype(root);
    }
  });

  it("disposes shared prototype geometries and materials once without disposing the merge", () => {
    const sharedGeometry = triangle();
    const separateGeometry = triangle();
    const sharedMaterial = new MeshStandardMaterial({ vertexColors: true });
    const separateMaterial = new MeshStandardMaterial({ vertexColors: true });
    const root = new Group();
    root.add(
      new Mesh(sharedGeometry, sharedMaterial),
      new Mesh(sharedGeometry, [sharedMaterial, sharedMaterial]),
      new Mesh(separateGeometry, [sharedMaterial, separateMaterial])
    );
    const sourceDisposals = [
      sharedGeometry,
      separateGeometry,
      sharedMaterial,
      separateMaterial,
    ].map((resource) => vi.spyOn(resource, "dispose"));
    const merged = mergeVehicleModelGeometry(root);
    const mergedDisposal = vi.spyOn(merged, "dispose");
    disposeVehiclePrototype(root);
    for (const spy of sourceDisposals) {
      expect(spy).toHaveBeenCalledExactlyOnceWith();
    }
    expect(mergedDisposal).not.toHaveBeenCalled();
    expect(merged.getAttribute("position").count).toBe(9);
    merged.dispose();
  });
});
