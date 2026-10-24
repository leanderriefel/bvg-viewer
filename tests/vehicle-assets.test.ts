import { readFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";

interface Source {
  id: string;
  title: string;
  url: string;
}

interface Model {
  id: string;
  mode: string;
  cars: number;
  sourceIds: string[];
  modelUrl: string;
  dimensions: { width: number; height: number; length: number };
  drawCalls: number;
  triangles: number;
  bytes: number;
  segments: { node: string }[];
}

interface Service {
  mode: string;
  line: string;
  defaultModel: string;
  alternatives: string[];
  confidence: string;
  sourceUrls: string[];
}

interface Accessor {
  bufferView: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
  min?: number[];
  max?: number[];
}

interface GltfNode {
  name?: string;
  children?: number[];
  mesh?: number;
  translation?: number[];
  rotation?: number[];
  scale?: number[];
  matrix?: number[];
  extras?: { modelId?: string };
}

interface Gltf {
  asset: { version: string };
  scene: number;
  scenes: { nodes: number[] }[];
  nodes: GltfNode[];
  meshes: {
    primitives: {
      attributes: Record<string, number>;
      indices: number;
      material: number;
      mode?: number;
    }[];
  }[];
  materials: unknown[];
  accessors: Accessor[];
  bufferViews: {
    buffer: number;
    byteOffset?: number;
    byteLength: number;
    byteStride?: number;
  }[];
  buffers: { byteLength: number; uri?: string }[];
  images?: unknown[];
  textures?: unknown[];
  cameras?: unknown[];
  animations?: unknown[];
  extensionsRequired?: string[];
}

const COMPONENT_COUNTS: Record<string, number> = {
  SCALAR: 1,
  VEC3: 3,
  VEC4: 4,
};
const COMPONENT_BYTES: Record<number, number> = {
  5121: 1,
  5123: 2,
  5125: 4,
  5126: 4,
};
const root = new URL("../", import.meta.url);
const fleet: {
  models: (Pick<Model, "id" | "sourceIds"> & { livery: string })[];
  sources: Source[];
  observedServices: Record<string, string>;
} = JSON.parse(
  readFileSync(new URL("assets/vehicles/fleet.json", root), "utf-8")
);
const catalog: {
  models: Model[];
  services: Service[];
  sources: Source[];
  coordinates: Record<string, string>;
} = JSON.parse(
  readFileSync(new URL("public/models/vehicles/catalog.json", root), "utf-8")
);

function expandLabels(labels: string): string[] {
  return labels.split(/\s+/u).flatMap((label) => {
    const range = /^(?<prefix>\D*)(?<start>\d+)-(?:\D*)(?<end>\d+)$/u.exec(
      label
    );
    if (!range?.groups) {
      return [label];
    }
    const { prefix, start, end } = range.groups;
    return Array.from(
      { length: Number(end) - Number(start) + 1 },
      (_, index) => `${prefix}${Number(start) + index}`
    );
  });
}

function readGlb(model: Model): { gltf: Gltf; binary: Buffer } {
  expect(model.modelUrl).toBe(`/models/vehicles/${model.id}.glb`);
  const file = readFileSync(new URL(`public${model.modelUrl}`, root));
  expect(file.length).toBe(model.bytes);
  expect(file.readUInt32LE(0)).toBe(0x46_54_6c_67);
  expect(file.readUInt32LE(4)).toBe(2);
  expect(file.readUInt32LE(8)).toBe(file.length);
  const jsonLength = file.readUInt32LE(12);
  expect(jsonLength % 4).toBe(0);
  expect(file.readUInt32LE(16)).toBe(0x4e_4f_53_4a);
  const gltf: Gltf = JSON.parse(file.subarray(20, 20 + jsonLength).toString());
  const binaryHeader = 20 + jsonLength;
  expect(file.readUInt32LE(binaryHeader + 4)).toBe(0x00_4e_49_42);
  const binary = file.subarray(binaryHeader + 8);
  expect(binary.length).toBe(file.readUInt32LE(binaryHeader));
  return { gltf, binary };
}

function values(gltf: Gltf, binary: Buffer, accessorIndex: number): number[][] {
  const accessor = gltf.accessors[accessorIndex];
  expect(accessor).toBeDefined();
  const view = gltf.bufferViews[accessor.bufferView];
  expect(view).toBeDefined();
  const components = COMPONENT_COUNTS[accessor.type];
  const bytes = COMPONENT_BYTES[accessor.componentType];
  if (!(components && bytes)) {
    throw new Error(`Unsupported vehicle accessor ${accessorIndex}`);
  }
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const stride = view.byteStride ?? components * bytes;
  const end = start + (accessor.count - 1) * stride + components * bytes;
  expect(end).toBeLessThanOrEqual((view.byteOffset ?? 0) + view.byteLength);
  expect(end).toBeLessThanOrEqual(binary.length);
  const result = Array.from({ length: accessor.count }, (_, index) =>
    Array.from({ length: components }, (__, component) => {
      const offset = start + index * stride + component * bytes;
      if (accessor.componentType === 5126) {
        return binary.readFloatLE(offset);
      }
      return binary.readUIntLE(offset, bytes);
    })
  );
  expect(result.every((row) => row.every(Number.isFinite))).toBe(true);
  return result;
}

function transformPosition(position: number[], node: GltfNode): number[] {
  const [x, y, z] = position;
  const [qx, qy, qz, qw] = node.rotation ?? [0, 0, 0, 1];
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  const translation = node.translation ?? [0, 0, 0];
  return [
    x + qw * tx + qy * tz - qz * ty + translation[0],
    y + qw * ty + qz * tx - qx * tz + translation[1],
    z + qw * tz + qx * ty - qy * tx + translation[2],
  ];
}

describe("vehicle service catalog", () => {
  it("covers the observed feed, including numeric and prefixed ranges", () => {
    expect(expandLabels("106-110 M44-M46 334R")).toEqual([
      "106",
      "107",
      "108",
      "109",
      "110",
      "M44",
      "M45",
      "M46",
      "334R",
    ]);
    const expected = Object.entries(fleet.observedServices).flatMap(
      ([mode, labels]) => expandLabels(labels).map((line) => `${mode}:${line}`)
    );
    const actual = catalog.services.map(({ mode, line }) => `${mode}:${line}`);
    expect(expected).toHaveLength(266);
    expect(new Set(actual).size).toBe(actual.length);
    expect(actual.toSorted()).toEqual(expected.toSorted());
    expect(catalog.models.map(({ id }) => id).toSorted()).toEqual(
      fleet.models.map(({ id }) => id).toSorted()
    );
    expect(new Set(catalog.models.map(({ id }) => id)).size).toBe(49);
  });

  it("resolves every model and evidence reference with explicit confidence", () => {
    const models = new Map(catalog.models.map((model) => [model.id, model]));
    const sources = new Map(
      catalog.sources.map((source) => [source.id, source])
    );
    expect(sources.size).toBe(fleet.sources.length);
    for (const source of fleet.sources) {
      expect(sources.get(source.id)).toMatchObject(source);
      expect(new URL(source.url).protocol).toBe("https:");
    }
    for (const model of catalog.models) {
      expect(model.sourceIds).toEqual(
        fleet.models.find(({ id }) => id === model.id)?.sourceIds
      );
      for (const sourceId of model.sourceIds) {
        expect(sources.has(sourceId), `${model.id}: ${sourceId}`).toBe(true);
      }
    }
    for (const service of catalog.services) {
      expect(["family", "representative", "unknown"]).toContain(
        service.confidence
      );
      const references = [service.defaultModel, ...service.alternatives];
      expect(new Set(references).size).toBe(references.length);
      for (const id of references) {
        expect(
          models.get(id)?.mode,
          `${service.mode}:${service.line}: ${id}`
        ).toBe(service.mode);
      }
      for (const url of service.sourceUrls) {
        expect(new URL(url).protocol).toBe("https:");
      }
    }
  });

  it("preserves mode collisions and keeps unidentified 1236 neutral", () => {
    for (const [line, railMode] of [
      ["M1", "tram"],
      ["S41", "s-bahn"],
      ["U6", "u-bahn"],
    ]) {
      expect(
        catalog.services.find(
          (service) => service.line === line && service.mode === "bus"
        )?.defaultModel
      ).toMatch(/^bus-/u);
      expect(
        catalog.services.find(
          (service) => service.line === line && service.mode === railMode
        )
      ).toBeDefined();
    }
    expect(catalog.services.find(({ line }) => line === "1236")).toMatchObject({
      mode: "long-distance",
      defaultModel: "rail-generic",
      confidence: "unknown",
      alternatives: [],
    });
    expect(fleet.models.find(({ id }) => id === "rail-generic")?.livery).toBe(
      "neutral"
    );
  });
});

describe("standalone vehicle GLB exports", () => {
  it("declares meter-scale ground-centered Y-up coordinates", () => {
    expect(catalog.coordinates).toEqual({
      unit: "meter",
      up: "+Y",
      forward: "+Z",
      origin: "ground-center",
    });
  });

  for (const model of catalog.models) {
    it(`${model.id} contains only its own untransformed root and car meshes`, () => {
      const { gltf, binary } = readGlb(model);
      expect(gltf.asset.version).toBe("2.0");
      expect(gltf.scenes).toHaveLength(1);
      const roots = gltf.scenes[gltf.scene].nodes;
      expect(roots).toHaveLength(1);
      const modelRoot = gltf.nodes[roots[0]];
      expect(modelRoot.extras?.modelId).toBe(model.id);
      expect(modelRoot.translation ?? [0, 0, 0]).toEqual([0, 0, 0]);
      expect(modelRoot.rotation ?? [0, 0, 0, 1]).toEqual([0, 0, 0, 1]);
      expect(modelRoot.mesh).toBeUndefined();
      expect(modelRoot.children).toHaveLength(model.cars);
      expect(gltf.nodes).toHaveLength(model.cars + 1);
      expect(gltf.meshes).toHaveLength(model.cars);
      expect(model.drawCalls).toBe(model.cars);
      expect(gltf.materials).toHaveLength(1);
      expect(gltf.buffers).toHaveLength(1);
      expect(gltf.buffers[0].uri).toBeUndefined();
      for (const view of gltf.bufferViews) {
        expect(view.buffer).toBe(0);
        expect((view.byteOffset ?? 0) + view.byteLength).toBeLessThanOrEqual(
          gltf.buffers[0].byteLength
        );
      }
      expect(binary.length - gltf.buffers[0].byteLength).toBeLessThan(4);
      expect(binary.length).toBeGreaterThanOrEqual(gltf.buffers[0].byteLength);
      for (const property of [
        "images",
        "textures",
        "cameras",
        "animations",
        "extensionsRequired",
      ] as const) {
        expect(gltf[property] ?? []).toHaveLength(0);
      }
      expect(JSON.stringify(gltf)).not.toContain("KHR_lights_punctual");
      const meshIndices = new Set<number>();
      const minimum = [Infinity, Infinity, Infinity];
      const maximum = [-Infinity, -Infinity, -Infinity];
      let triangles = 0;
      for (const node of gltf.nodes) {
        expect(node.scale ?? [1, 1, 1]).toEqual([1, 1, 1]);
        expect(node.matrix).toBeUndefined();
      }
      for (const index of modelRoot.children ?? []) {
        const node = gltf.nodes[index];
        expect(node.children ?? []).toHaveLength(0);
        if (node.mesh === undefined) {
          throw new Error(`${model.id} car is missing a mesh`);
        }
        meshIndices.add(node.mesh);
        const mesh = gltf.meshes[node.mesh];
        expect(mesh.primitives).toHaveLength(1);
        const [primitive] = mesh.primitives;
        expect(primitive.material).toBe(0);
        expect(primitive.mode ?? 4).toBe(4);
        expect(Object.keys(primitive.attributes).toSorted()).toEqual([
          "COLOR_0",
          "NORMAL",
          "POSITION",
        ]);
        const positions = values(gltf, binary, primitive.attributes.POSITION);
        for (const attribute of ["NORMAL", "COLOR_0"]) {
          expect(
            values(gltf, binary, primitive.attributes[attribute])
          ).toHaveLength(positions.length);
        }
        const indices = values(gltf, binary, primitive.indices).flat();
        expect(indices.length % 3).toBe(0);
        expect(
          indices.every(
            (value) =>
              Number.isInteger(value) && value >= 0 && value < positions.length
          )
        ).toBe(true);
        triangles += indices.length / 3;
        const accessor = gltf.accessors[primitive.attributes.POSITION];
        const localMinimum = [Infinity, Infinity, Infinity];
        const localMaximum = [-Infinity, -Infinity, -Infinity];
        for (const position of positions) {
          const world = transformPosition(position, node);
          for (let axis = 0; axis < 3; axis += 1) {
            localMinimum[axis] = Math.min(localMinimum[axis], position[axis]);
            localMaximum[axis] = Math.max(localMaximum[axis], position[axis]);
            minimum[axis] = Math.min(minimum[axis], world[axis]);
            maximum[axis] = Math.max(maximum[axis], world[axis]);
          }
        }
        expect(accessor.min).toEqual(localMinimum);
        expect(accessor.max).toEqual(localMaximum);
      }
      expect(meshIndices.size).toBe(model.cars);
      expect(triangles).toBe(model.triangles);
      expect(Math.abs(minimum[1])).toBeLessThan(0.0001);
      expect(Math.abs((minimum[0] + maximum[0]) / 2)).toBeLessThan(0.0001);
      expect(Math.abs((minimum[2] + maximum[2]) / 2)).toBeLessThan(0.0001);
      for (const [axis, dimension] of [
        model.dimensions.width,
        model.dimensions.height,
        model.dimensions.length,
      ].entries()) {
        expect(maximum[axis] - minimum[axis]).toBeCloseTo(dimension, 2);
      }
      expect(model.segments.map(({ node }) => node)).toEqual(
        modelRoot.children?.map((index) => gltf.nodes[index].name)
      );
    });
  }
});
