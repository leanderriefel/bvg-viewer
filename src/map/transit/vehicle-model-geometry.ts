import { Mesh, SkinnedMesh } from "three";
import type {
  Material,
  Object3D,
  BufferGeometry,
  BufferAttribute,
  InterleavedBufferAttribute,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

function validateVertexValues(
  attribute: BufferAttribute | InterleavedBufferAttribute
): void {
  for (let index = 0; index < attribute.count; index += 1) {
    if (
      !(
        Number.isFinite(attribute.getX(index)) &&
        Number.isFinite(attribute.getY(index)) &&
        Number.isFinite(attribute.getZ(index))
      ) ||
      (attribute.itemSize === 4 && !Number.isFinite(attribute.getW(index)))
    ) {
      throw new Error("Vehicle mesh contains non-finite vertex attributes.");
    }
  }
}

function validateGeometry(geometry: BufferGeometry): void {
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const color = geometry.getAttribute("color");
  if (!(position && normal && color)) {
    throw new Error(
      "Vehicle mesh requires position, normal and color attributes."
    );
  }
  if (
    position.itemSize !== 3 ||
    normal.itemSize !== 3 ||
    ![3, 4].includes(color.itemSize) ||
    position.count === 0 ||
    position.count !== normal.count ||
    position.count !== color.count
  ) {
    throw new Error(
      "Vehicle mesh attributes have invalid shapes or vertex counts."
    );
  }
  for (const attribute of [position, normal, color]) {
    validateVertexValues(attribute);
  }
  const indices = geometry.index;
  if (!(indices && indices.count > 0 && indices.count % 3 === 0)) {
    throw new Error(
      "Vehicle assets must use nonempty indexed triangle geometry."
    );
  }
  for (let index = 0; index < indices.count; index += 1) {
    const vertex = indices.getX(index);
    if (
      !(Number.isSafeInteger(vertex) && vertex >= 0 && vertex < position.count)
    ) {
      throw new Error("Vehicle mesh contains an out-of-range triangle index.");
    }
  }
}

/** Bake the authored car transforms once, so a family needs one instanced draw. */
export function mergeVehicleModelGeometry(root: Object3D): BufferGeometry {
  root.updateMatrixWorld(true);
  const parts: BufferGeometry[] = [];
  try {
    root.traverse((object) => {
      if (!(object instanceof Mesh)) {
        return;
      }
      if (object instanceof SkinnedMesh) {
        throw new TypeError(
          "Vehicle assets must contain rigid, unskinned meshes."
        );
      }
      const { geometry } = object;
      validateGeometry(geometry);
      if (
        !object.matrixWorld.elements.every(Number.isFinite) ||
        object.matrixWorld.determinant() === 0
      ) {
        throw new Error(
          "Vehicle mesh transforms must be finite and invertible."
        );
      }
      parts.push(geometry.clone().applyMatrix4(object.matrixWorld));
    });
    if (parts.length === 0) {
      throw new Error("Vehicle asset contains no mesh geometry.");
    }
    const merged = mergeGeometries(parts, false);
    if (!merged) {
      throw new Error("Vehicle car geometries have incompatible attributes.");
    }
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    return merged;
  } finally {
    for (const geometry of parts) {
      geometry.dispose();
    }
  }
}

/** Imported prototypes are CPU-only; the merged instance geometry owns rendering. */
export function disposeVehiclePrototype(root: Object3D): void {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  root.traverse((object) => {
    if (object instanceof Mesh) {
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material)
        ? object.material
        : [object.material]) {
        materials.add(material);
      }
    }
  });
  for (const geometry of geometries) {
    geometry.dispose();
  }
  for (const material of materials) {
    material.dispose();
  }
}
