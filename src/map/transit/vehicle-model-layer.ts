import type { CustomLayerInterface, Map as MapLibreMap } from "maplibre-gl";
import {
  Camera,
  DoubleSide,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  NoToneMapping,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  WebGLRenderer,
} from "three";
import type { BufferGeometry } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import type { TransitVehicle } from "./model";
import {
  loadVehicleModelCatalog,
  resolveVehicleModel,
} from "./vehicle-model-catalog";
import type {
  VehicleModelAsset,
  VehicleModelCatalog,
} from "./vehicle-model-catalog";
import {
  VEHICLE_MODEL_LAYER_ID,
  VEHICLE_MODEL_MIN_ZOOM,
} from "./vehicle-model-config";
import {
  disposeVehiclePrototype,
  mergeVehicleModelGeometry,
} from "./vehicle-model-geometry";
import {
  createVehicleModelOrigin,
  setVehicleModelMatrix,
} from "./vehicle-model-transform";

const MAX_MODEL_VEHICLES = 256;
const MAX_CONCURRENT_LOADS = 3;
const INITIAL_CAPACITY = 16;

interface ModelBatch {
  asset: VehicleModelAsset;
  geometry: BufferGeometry;
  mesh: InstancedMesh;
  capacity: number;
  count: number;
}

export interface VehicleModelsController {
  beginFrame: (zoom: number) => void;
  draw: (
    vehicle: TransitVehicle,
    coordinates: readonly [number, number],
    bearing: number,
    selected: boolean
  ) => VehicleModelAsset | null;
  endFrame: () => void;
  restore: () => void;
  dispose: () => void;
}

function fleetMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    name: "Berlin fleet map shading",
    vertexColors: true,
    // The map's north/up projection reverses screen winding relative to a
    // conventional Three camera. Explicit outward normals keep both-sided
    // geometry lit consistently, without mirroring the vehicle's doors/nose.
    side: DoubleSide,
    vertexShader: `
      varying vec3 fleetColor;
      varying vec3 fleetNormal;
      void main() {
        vec4 localPosition = vec4(position, 1.0);
        vec3 localNormal = normal;
        #ifdef USE_INSTANCING
          localPosition = instanceMatrix * localPosition;
          localNormal = mat3(instanceMatrix) * localNormal;
        #endif
        fleetColor = color.rgb;
        fleetNormal = normalize(mat3(modelMatrix) * localNormal);
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * localPosition;
      }
    `,
    fragmentShader: `
      varying vec3 fleetColor;
      varying vec3 fleetNormal;
      void main() {
        vec3 light = normalize(vec3(-0.35, 0.9, 0.4));
        float illumination = 0.62 + 0.38 * max(dot(normalize(fleetNormal), light), 0.0);
        gl_FragColor = vec4(fleetColor * illumination, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

/** One lazy, shared-context draw per visible family; no React/per-trip renderers. */
export function createVehicleModels(
  map: MapLibreMap,
  changed: () => void
): VehicleModelsController {
  const scene = new Scene();
  const camera = new Camera();
  const material = fleetMaterial();
  const loader = new GLTFLoader();
  const abort = new AbortController();
  let origin = createVehicleModelOrigin(map.getCenter());
  const anchor = new Matrix4();
  const axes = new Matrix4().makeRotationX(Math.PI / 2);
  const matrix = new Matrix4();
  const batches = new Map<string, ModelBatch>();
  const requested = new Set<string>();
  const queue: VehicleModelAsset[] = [];
  const resolved = new WeakMap<TransitVehicle, VehicleModelAsset | null>();
  let catalog: VehicleModelCatalog | null = null;
  let renderer: WebGLRenderer | null = null;
  let activeLoads = 0;
  let count = 0;
  let previouslyVisible = false;
  let enabled = false;
  let disposed = false;
  let removed = false;
  let contextLost = false;

  const releaseRenderer = () => {
    for (const batch of batches.values()) {
      batch.geometry.dispose();
      batch.mesh.dispose();
    }
    material.dispose();
    renderer?.dispose();
    renderer = null;
  };
  const layer: CustomLayerInterface = {
    id: VEHICLE_MODEL_LAYER_ID,
    type: "custom",
    renderingMode: "3d",
    onAdd(_map, gl) {
      try {
        renderer = new WebGLRenderer({
          canvas: map.getCanvas(),
          context: gl,
          antialias: true,
        });
        renderer.autoClear = false;
        renderer.outputColorSpace = SRGBColorSpace;
        renderer.toneMapping = NoToneMapping;
      } catch {
        // Existing GeoJSON bodies remain visible when WebGL cannot initialize.
        releaseRenderer();
      }
      changed();
    },
    render(_gl, input) {
      if (!(renderer && enabled && !contextLost && !disposed && count > 0)) {
        return;
      }
      camera.projectionMatrix
        .fromArray(input.defaultProjectionData.mainMatrix)
        .multiply(anchor);
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
      renderer.resetState();
      renderer.render(scene, camera);
      renderer.resetState();
      // The transit animation loop owns repaint scheduling. A permanent
      // repaint loop here would prevent destination preparation from going idle.
    },
    onRemove() {
      releaseRenderer();
    },
  };

  const restore = () => {
    if (disposed || removed || !map.getStyle() || map.getLayer(layer.id)) {
      return;
    }
    const before = map.getLayer("live-transit-overview")
      ? "live-transit-overview"
      : undefined;
    map.addLayer(layer, before);
  };

  const makeInstances = (
    geometry: BufferGeometry,
    capacity: number
  ): InstancedMesh => {
    const mesh = new InstancedMesh(geometry, material, capacity);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.count = 0;
    // Viewport culling already happened using fresh geographic positions.
    // Recomputing a moving instance bounding sphere would cost another pass.
    mesh.frustumCulled = false;
    scene.add(mesh);
    return mesh;
  };

  const load = async (asset: VehicleModelAsset) => {
    let geometry: BufferGeometry | null = null;
    try {
      const response = await fetch(asset.modelUrl, { signal: abort.signal });
      if (!response.ok) {
        throw new Error(
          `Vehicle model request returned HTTP ${response.status}.`
        );
      }
      const bytes = await response.arrayBuffer();
      const prototype = await loader.parseAsync(bytes, "/models/vehicles/");
      try {
        geometry = mergeVehicleModelGeometry(prototype.scene);
      } finally {
        disposeVehiclePrototype(prototype.scene);
      }
      if (disposed || removed) {
        geometry.dispose();
        return;
      }
      batches.set(asset.id, {
        asset,
        geometry,
        mesh: makeInstances(geometry, INITIAL_CAPACITY),
        count: 0,
        capacity: INITIAL_CAPACITY,
      });
      changed();
    } catch {
      geometry?.dispose();
      // Failed or cancelled loads retain the directional footprint fallback.
      // Each family is tried once per binding, avoiding request retry storms.
    } finally {
      activeLoads -= 1;
      pump();
    }
  };

  function pump(): void {
    if (disposed || removed) {
      return;
    }
    while (activeLoads < MAX_CONCURRENT_LOADS && queue.length > 0) {
      const asset = queue.shift();
      if (asset) {
        activeLoads += 1;
        void load(asset);
      }
    }
  }

  const request = (asset: VehicleModelAsset, selected: boolean) => {
    if (requested.has(asset.id)) {
      return;
    }
    requested.add(asset.id);
    if (selected) {
      queue.unshift(asset);
    } else {
      queue.push(asset);
    }
    pump();
  };

  const onRemove = () => {
    removed = true;
    abort.abort();
    queue.length = 0;
    releaseRenderer();
  };
  const onContextLost = () => {
    contextLost = true;
    changed();
  };
  const onContextRestored = () => {
    contextLost = false;
    changed();
  };
  map.on("remove", onRemove);
  map.on("webglcontextlost", onContextLost);
  map.on("webglcontextrestored", onContextRestored);
  async function initializeCatalog(): Promise<void> {
    try {
      const value = await loadVehicleModelCatalog(abort.signal);
      if (!(disposed || removed)) {
        catalog = value;
        changed();
      }
    } catch {
      // The existing bodies and overview dots are the catalog/network fallback.
    }
  }
  void initializeCatalog();
  restore();

  return {
    restore,
    beginFrame(zoom) {
      enabled = zoom >= VEHICLE_MODEL_MIN_ZOOM && !contextLost;
      if (enabled) {
        // City-wide float32 translations lose the millimetre gaps between
        // windows, doors and bodywork. Rebase the entire frame near the view;
        // compose the geographic translation on the CPU at double precision.
        origin = createVehicleModelOrigin(map.getCenter());
        anchor
          .makeScale(
            origin.unitsPerMeter,
            origin.unitsPerMeter,
            origin.unitsPerMeter
          )
          .setPosition(origin.x, origin.y, origin.z)
          .multiply(axes);
      }
      count = 0;
      for (const batch of batches.values()) {
        batch.count = 0;
      }
    },
    draw(vehicle, coordinates, bearing, selected) {
      if (!(enabled && catalog && renderer) || disposed) {
        return null;
      }
      let asset = resolved.get(vehicle);
      if (asset === undefined) {
        asset = resolveVehicleModel(catalog, vehicle);
        resolved.set(vehicle, asset);
      }
      if (!asset) {
        return null;
      }
      const batch = batches.get(asset.id);
      if (!batch) {
        request(asset, selected);
        return null;
      }
      // Reserve a slot so the selected/followed vehicle cannot lose its model
      // to an unusually crowded viewport. Overflow keeps its usual footprint.
      if (count >= (selected ? MAX_MODEL_VEHICLES : MAX_MODEL_VEHICLES - 1)) {
        return null;
      }
      if (batch.count === batch.capacity) {
        const capacity = Math.min(MAX_MODEL_VEHICLES, batch.capacity * 2);
        const previous = batch.mesh;
        batch.mesh = makeInstances(batch.geometry, capacity);
        batch.mesh.instanceMatrix.array.set(previous.instanceMatrix.array);
        scene.remove(previous);
        previous.dispose();
        batch.capacity = capacity;
      }
      setVehicleModelMatrix(matrix, coordinates, bearing, 0.05, origin);
      batch.mesh.setMatrixAt(batch.count, matrix);
      batch.count += 1;
      count += 1;
      return asset;
    },
    endFrame() {
      for (const batch of batches.values()) {
        batch.mesh.count = batch.count;
        if (batch.count > 0) {
          batch.mesh.instanceMatrix.needsUpdate = true;
        }
      }
      if (!removed && (count > 0 || previouslyVisible)) {
        map.triggerRepaint();
      }
      previouslyVisible = count > 0;
    },
    dispose() {
      disposed = true;
      abort.abort();
      queue.length = 0;
      map.off("remove", onRemove);
      map.off("webglcontextlost", onContextLost);
      map.off("webglcontextrestored", onContextRestored);
      if (!removed && map.getLayer(layer.id)) {
        map.removeLayer(layer.id);
      } else {
        releaseRenderer();
      }
      scene.clear();
      batches.clear();
    },
  };
}
