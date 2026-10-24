const MODES = {
  "s-bahn": { label: "S-Bahn", symbol: "S", color: "#42864b" },
  "u-bahn": { label: "U-Bahn", symbol: "U", color: "#3476a6" },
  tram: { label: "Tram", symbol: "T", color: "#be5148" },
  bus: { label: "Bus", symbol: "B", color: "#9b688c" },
  regional: { label: "Regional", symbol: "R", color: "#b84c42" },
  "long-distance": { label: "Long-distance", symbol: "IC", color: "#686d66" },
  ferry: { label: "Ferry", symbol: "F", color: "#4f99a3" },
};
const numberFormat = new Intl.NumberFormat("en-GB");
const catalogUrl = new URL("catalog.json", import.meta.url);
const elements = Object.fromEntries(
  [...document.querySelectorAll("[id]")].map((element) => [element.id, element])
);
const state = {
  catalog: null,
  mode: "all",
  query: "",
  selected: null,
  loading: null,
  generation: 0,
  viewer: null,
  disposed: false,
};
const events = new AbortController();
const viewerPromise = prepareViewer();

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) {
    element.className = className;
  }
  if (text !== undefined) {
    element.textContent = text;
  }
  return element;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function modelUrl(model) {
  const url = new URL(model.modelUrl, catalogUrl);
  const directory = new URL(".", catalogUrl);
  if (
    url.origin !== directory.origin ||
    !url.pathname.startsWith(directory.pathname) ||
    !url.pathname.endsWith(".glb")
  ) {
    throw new Error("The model URL must point to a GLB in this collection.");
  }
  return url;
}

function validateModel(model) {
  if (
    !isRecord(model) ||
    !["id", "name", "operator", "family", "modelUrl"].every((key) =>
      hasText(model[key])
    ) ||
    !Object.hasOwn(MODES, model.mode) ||
    !isRecord(model.dimensions) ||
    !["width", "length", "height"].every(
      (key) =>
        Number.isFinite(model.dimensions[key]) && model.dimensions[key] > 0
    ) ||
    !["cars", "triangles", "vertices", "drawCalls", "bytes"].every((key) =>
      isCount(model[key])
    ) ||
    typeof model.notes !== "string" ||
    !Array.isArray(model.sourceIds) ||
    !model.sourceIds.every(hasText)
  ) {
    throw new Error("A vehicle entry in catalog.json is incomplete.");
  }
  modelUrl(model);
  return model;
}

function validateCatalog(value) {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.models) ||
    !Array.isArray(value.services) ||
    !Array.isArray(value.sources)
  ) {
    throw new Error("The vehicle catalog has an unsupported format.");
  }
  const models = value.models.map(validateModel);
  const modelIds = new Set(models.map((model) => model.id));
  if (modelIds.size !== models.length) {
    throw new Error("Vehicle IDs in the catalog must be unique.");
  }
  for (const service of value.services) {
    if (
      !isRecord(service) ||
      !Object.hasOwn(MODES, service.mode) ||
      !hasText(service.line) ||
      !modelIds.has(service.defaultModel) ||
      !Array.isArray(service.alternatives) ||
      !service.alternatives.every((id) => modelIds.has(id)) ||
      !["family", "representative", "unknown"].includes(service.confidence) ||
      typeof service.note !== "string"
    ) {
      throw new Error("A service assignment in catalog.json is incomplete.");
    }
  }
  for (const source of value.sources) {
    if (
      !isRecord(source) ||
      !["id", "title", "url"].every((key) => hasText(source[key]))
    ) {
      throw new Error("A source in catalog.json is incomplete.");
    }
    const url = new URL(source.url);
    if (!["https:", "http:"].includes(url.protocol)) {
      throw new Error("Catalog sources must use HTTP or HTTPS links.");
    }
  }
  return { ...value, models };
}

function showStageMessage(text, error = false, retry = false) {
  elements["stage-message"].hidden = false;
  elements["stage-message"].dataset.error = String(error);
  elements["stage-message"].querySelector("p").textContent = text;
  elements["retry-model"].hidden = !retry;
}

function renderFilters() {
  const entries = [
    ["all", { label: "All vehicles" }],
    ...Object.entries(MODES),
  ];
  const buttons = entries.map(([mode, details]) => {
    const count =
      state.catalog?.models.filter(
        (model) => mode === "all" || model.mode === mode
      ).length ?? 0;
    const button = node("button", "filter-button");
    button.type = "button";
    button.dataset.mode = mode;
    button.setAttribute("aria-pressed", String(state.mode === mode));
    if (details.color) {
      const dot = node("span", "mode-dot");
      dot.style.setProperty("--mode-color", details.color);
      dot.setAttribute("aria-hidden", "true");
      button.append(dot);
    }
    button.append(
      node("span", "", details.label),
      node("small", "", String(count))
    );
    return button;
  });
  elements["mode-filters"].replaceChildren(...buttons);
}

function searchText(value) {
  return value.toLocaleLowerCase("en-GB").replaceAll(/[\s-]/gu, "");
}

function textMatches(value, query) {
  return searchText(value).includes(query);
}

function serviceMatches(service, query) {
  return textMatches(`${MODES[service.mode].label} ${service.line}`, query);
}

function makeModeIcon(mode) {
  const details = MODES[mode];
  const icon = node("span", "mode-icon", details.symbol);
  icon.style.setProperty("--mode-color", details.color);
  icon.setAttribute("aria-hidden", "true");
  return icon;
}

function renderLibrary() {
  if (!state.catalog) {
    return;
  }
  const query = searchText(state.query);
  const services = query
    ? state.catalog.services.filter(
        (service) =>
          (state.mode === "all" || service.mode === state.mode) &&
          serviceMatches(service, query)
      )
    : [];
  const matchingIds = new Set(
    services.flatMap((service) => [
      service.defaultModel,
      ...service.alternatives,
    ])
  );
  const models = state.catalog.models.filter(
    (model) =>
      (state.mode === "all" || model.mode === state.mode) &&
      (!query ||
        matchingIds.has(model.id) ||
        textMatches(
          `${model.name} ${model.family} ${model.operator} ${MODES[model.mode].label}`,
          query
        ))
  );
  elements["result-count"].textContent = String(models.length);
  elements["library-status"].hidden = models.length > 0;
  elements["library-status"].textContent =
    state.catalog.models.length === 0
      ? "The collection is empty. Add models to catalog.json to get started."
      : "No vehicles found. Try another line, vehicle name, or transport mode.";
  const assetButtons = models.map((model) => {
    const button = node("button", "asset-button");
    button.type = "button";
    button.dataset.modelId = model.id;
    button.setAttribute(
      "aria-pressed",
      String(state.selected?.id === model.id)
    );
    const label = node("span");
    label.append(
      node("span", "asset-title", model.name),
      node(
        "span",
        "asset-subtitle",
        `${MODES[model.mode].label} · ${model.operator}`
      )
    );
    button.append(
      makeModeIcon(model.mode),
      label,
      node("span", "asset-arrow", "↗")
    );
    return button;
  });
  elements["asset-list"].replaceChildren(...assetButtons);
  elements["service-results"].hidden = services.length === 0;
  const serviceButtons = services.map((service) => {
    const model = state.catalog.models.find(
      (entry) => entry.id === service.defaultModel
    );
    const button = node("button", "service-result");
    button.type = "button";
    button.dataset.modelId = service.defaultModel;
    button.title = service.note;
    const label = node("span", "service-result-label");
    label.append(
      node("strong", "", `${MODES[service.mode].label} ${service.line}`),
      document.createTextNode(model.name)
    );
    button.append(makeModeIcon(service.mode), label);
    return button;
  });
  elements["service-list"].replaceChildren(...serviceButtons);
}

function formatBytes(bytes) {
  return bytes >= 1_000_000
    ? `${(bytes / 1_000_000).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

function renderDetails(model) {
  elements["model-classification"].textContent =
    `${MODES[model.mode].label.toUpperCase()} / ${model.operator.toUpperCase()}`;
  elements["model-name"].textContent = model.name;
  const formation =
    model.cars === 1 ? "1 vehicle section" : `${model.cars} vehicle sections`;
  elements["model-family"].textContent =
    `${model.family} · ${formation} · ${numberFormat.format(model.vertices)} vertices`;
  elements["download-model"].href = modelUrl(model).href;
  elements["download-model"].download = `${model.id}.glb`;
  elements["download-model"].hidden = false;
  elements["model-information"].hidden = false;
  elements["model-notes"].textContent =
    model.notes || "A real-scale visual model of this vehicle family.";
  const facts = [
    ["Length", model.dimensions.length.toFixed(2), "m"],
    ["Width", model.dimensions.width.toFixed(2), "m"],
    ["Height", model.dimensions.height.toFixed(2), "m"],
    ["Triangles", numberFormat.format(model.triangles), ""],
    ["Draw calls", numberFormat.format(model.drawCalls), ""],
    ["File size", formatBytes(model.bytes), ""],
  ];
  elements["model-facts"].replaceChildren(
    ...facts.map(([label, value, unit]) => {
      const wrapper = node("div");
      const description = node("dd", "", value);
      if (unit) {
        description.append(node("span", "", unit));
      }
      wrapper.append(node("dt", "", label), description);
      return wrapper;
    })
  );
  const services = state.catalog.services.filter(
    (service) =>
      service.defaultModel === model.id ||
      service.alternatives.includes(model.id)
  );
  elements["service-count"].textContent = String(services.length);
  const chips = services.map((service) => {
    const chip = node("span", "service-chip");
    const dot = node("span", "mode-dot");
    dot.style.setProperty("--mode-color", MODES[service.mode].color);
    chip.title = `${service.confidence}: ${service.note}`;
    chip.append(
      dot,
      document.createTextNode(service.line),
      node("small", "", MODES[service.mode].label)
    );
    return chip;
  });
  elements["model-services"].replaceChildren(
    ...(chips.length > 0
      ? chips
      : [
          node(
            "p",
            "service-empty",
            "No line assignments are listed for this model. Explore it by vehicle family."
          ),
        ])
  );
  const sourceIds = new Set(model.sourceIds);
  const sources = state.catalog.sources.filter((source) =>
    sourceIds.has(source.id)
  );
  elements["model-sources"].replaceChildren(
    ...sources.map((source) => {
      const link = node("a", "", `${source.title} ↗`);
      link.href = source.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      return link;
    })
  );
}

async function selectModel(id) {
  const model = state.catalog?.models.find((entry) => entry.id === id);
  if (!model || state.disposed) {
    return;
  }
  state.selected = model;
  state.generation += 1;
  const { generation } = state;
  state.loading?.abort();
  const loading = new AbortController();
  state.loading = loading;
  renderDetails(model);
  for (const button of elements["asset-list"].querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(button.dataset.modelId === id));
  }
  const location = new URL(window.location.href);
  location.hash = encodeURIComponent(id);
  window.history.replaceState(null, "", location);
  showStageMessage(`Loading ${model.name}…`);
  elements["reset-camera"].disabled = true;
  elements["rotate-model"].disabled = true;
  const viewer = await viewerPromise;
  if (state.disposed || generation !== state.generation) {
    return;
  }
  if (!viewer) {
    showStageMessage(
      "The 3D preview is unavailable. Check your internet connection and WebGL support. You can still browse and download every model.",
      true
    );
    return;
  }
  viewer.clear();
  try {
    const url = modelUrl(model);
    const response = await fetch(url, { signal: loading.signal });
    if (!response.ok) {
      throw new Error(`The GLB request returned HTTP ${response.status}.`);
    }
    const data = await response.arrayBuffer();
    if (generation !== state.generation || state.disposed) {
      return;
    }
    const asset = await viewer.parse(data, new URL(".", url).href);
    if (generation !== state.generation || state.disposed) {
      viewer.disposeObject(asset.scene);
      return;
    }
    viewer.show(asset.scene);
    elements["stage-message"].hidden = true;
    elements["reset-camera"].disabled = false;
    elements["rotate-model"].disabled = false;
    elements["model-canvas"].setAttribute(
      "aria-label",
      `Interactive 3D model of ${model.name}. Use arrow keys to orbit, plus or minus to zoom, and Home to reset.`
    );
  } catch (error) {
    if (
      loading.signal.aborted ||
      generation !== state.generation ||
      state.disposed
    ) {
      return;
    }
    const detail =
      error instanceof Error ? error.message : "The file could not be loaded.";
    showStageMessage(`Could not preview this vehicle. ${detail}`, true, true);
  }
}

function disposeObject(object) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  object.traverse((child) => {
    if (child.geometry) {
      geometries.add(child.geometry);
    }
    for (const material of Array.isArray(child.material)
      ? child.material
      : [child.material]) {
      if (!material) {
        continue;
      }
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value?.isTexture) {
          textures.add(value);
        }
      }
    }
  });
  for (const geometry of geometries) {
    geometry.dispose();
  }
  for (const material of materials) {
    material.dispose();
  }
  for (const texture of textures) {
    texture.source?.data?.close?.();
    texture.dispose();
  }
}

async function prepareViewer() {
  try {
    const [THREE, { OrbitControls }, { GLTFLoader }] = await Promise.all([
      import("three"),
      import("three/addons/controls/OrbitControls.js"),
      import("three/addons/loaders/GLTFLoader.js"),
    ]);
    if (state.disposed) {
      return null;
    }
    const canvas = elements["model-canvas"];
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 2000);
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI / 2 - 0.015;
    controls.autoRotateSpeed = 0.7;
    controls.enablePan = false;
    scene.add(new THREE.HemisphereLight(0xff_ff_ff, 0x8c_92_77, 2.6));
    const key = new THREE.DirectionalLight(0xff_f4_dd, 3.5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0002;
    key.shadow.normalBias = 0.03;
    scene.add(key, key.target);
    const fill = new THREE.DirectionalLight(0xe0_ea_ff, 1.4);
    fill.position.set(-20, 12, -15);
    scene.add(fill);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShadowMaterial({ opacity: 0.14 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.012;
    floor.receiveShadow = true;
    scene.add(floor);
    const loader = new GLTFLoader();
    let current = null;
    let grid = null;
    let bounds = null;
    let active = true;
    let previousTime = 0;
    const cameraDirection = new THREE.Vector3(0.92, 0.46, 0.58).normalize();
    const right = new THREE.Vector3()
      .crossVectors(new THREE.Vector3(0, 1, 0), cameraDirection)
      .normalize();
    const up = new THREE.Vector3()
      .crossVectors(cameraDirection, right)
      .normalize();

    const frame = () => {
      if (!bounds) {
        return;
      }
      const center = bounds.getCenter(new THREE.Vector3());
      const half = bounds.getSize(new THREE.Vector3()).multiplyScalar(0.5);
      const verticalTangent = Math.tan(
        THREE.MathUtils.degToRad(camera.fov / 2)
      );
      const horizontalTangent = verticalTangent * camera.aspect;
      let distance = 1;
      for (const x of [-half.x, half.x]) {
        for (const y of [-half.y, half.y]) {
          for (const z of [-half.z, half.z]) {
            const corner = new THREE.Vector3(x, y, z);
            const depth = corner.dot(cameraDirection);
            distance = Math.max(
              distance,
              Math.abs(corner.dot(right)) / horizontalTangent + depth,
              Math.abs(corner.dot(up)) / verticalTangent + depth
            );
          }
        }
      }
      distance *= 1.3;
      camera.position.copy(center).addScaledVector(cameraDirection, distance);
      camera.near = Math.max(0.01, distance / 1000);
      camera.far = Math.max(1000, distance * 25);
      camera.updateProjectionMatrix();
      controls.target.copy(center);
      controls.minDistance = Math.max(1, half.length() * 0.22);
      controls.maxDistance = distance * 4;
      controls.update();
      controls.saveState();
    };

    const clear = () => {
      if (current) {
        scene.remove(current);
        disposeObject(current);
        current = null;
      }
      if (grid) {
        scene.remove(grid);
        disposeObject(grid);
        grid = null;
      }
      bounds = null;
    };

    const show = (object) => {
      const nextBounds = new THREE.Box3().setFromObject(object);
      if (nextBounds.isEmpty()) {
        disposeObject(object);
        throw new Error("The GLB contains no visible geometry.");
      }
      current = object;
      current.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      scene.add(current);
      bounds = nextBounds;
      const size = bounds.getSize(new THREE.Vector3());
      const extent = Math.max(size.x, size.y, size.z, 10);
      floor.scale.setScalar(extent * 5);
      grid = new THREE.GridHelper(extent * 3, 36, 0xa9_b3_98, 0xba_c3_aa);
      grid.material.transparent = true;
      grid.material.opacity = 0.14;
      grid.position.y = -0.008;
      scene.add(grid);
      key.position.set(extent * 0.35, extent * 0.8, extent * 0.3);
      key.target.position.copy(bounds.getCenter(new THREE.Vector3()));
      key.shadow.camera.left = -extent;
      key.shadow.camera.right = extent;
      key.shadow.camera.top = extent;
      key.shadow.camera.bottom = -extent;
      key.shadow.camera.near = 0.1;
      key.shadow.camera.far = extent * 5;
      key.shadow.camera.updateProjectionMatrix();
      frame();
    };

    const resize = new ResizeObserver(() => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (width < 1 || height < 1) {
        return;
      }
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      frame();
    });
    resize.observe(elements.stage);
    const visibility = new IntersectionObserver(([entry]) => {
      active = entry.isIntersecting;
    });
    visibility.observe(canvas);
    renderer.setAnimationLoop((time) => {
      const delta = previousTime
        ? Math.min((time - previousTime) / 1000, 0.1)
        : 0;
      previousTime = time;
      if (!active || document.hidden || !current) {
        return;
      }
      controls.update(delta);
      renderer.render(scene, camera);
    });
    canvas.addEventListener(
      "webglcontextlost",
      (event) => {
        event.preventDefault();
        showStageMessage(
          "The graphics context was interrupted. Reload this page to restore the preview; downloads remain available.",
          true
        );
      },
      { signal: events.signal }
    );
    canvas.addEventListener(
      "keydown",
      (event) => {
        const steps = {
          ArrowLeft: -0.12,
          ArrowRight: 0.12,
          ArrowUp: -0.1,
          ArrowDown: 0.1,
        };
        if (Object.hasOwn(steps, event.key)) {
          event.preventDefault();
          const offset = camera.position.clone().sub(controls.target);
          const spherical = new THREE.Spherical().setFromVector3(offset);
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            spherical.theta += steps[event.key];
          } else {
            spherical.phi = THREE.MathUtils.clamp(
              spherical.phi + steps[event.key],
              0.05,
              controls.maxPolarAngle
            );
          }
          camera.position
            .copy(controls.target)
            .add(new THREE.Vector3().setFromSpherical(spherical));
          controls.update();
        } else if (["+", "=", "-", "_"].includes(event.key)) {
          event.preventDefault();
          const offset = camera.position.clone().sub(controls.target);
          offset.multiplyScalar(
            event.key === "+" || event.key === "=" ? 0.9 : 1.1
          );
          offset.clampLength(controls.minDistance, controls.maxDistance);
          camera.position.copy(controls.target).add(offset);
          controls.update();
        } else if (event.key === "Home") {
          event.preventDefault();
          frame();
        }
      },
      { signal: events.signal }
    );
    const viewer = {
      clear,
      show,
      frame,
      disposeObject,
      parse: (data, path) => loader.parseAsync(data, path),
      rotate: (enabled) => {
        controls.autoRotate = enabled;
      },
      dispose() {
        resize.disconnect();
        visibility.disconnect();
        renderer.setAnimationLoop(null);
        controls.dispose();
        clear();
        disposeObject(floor);
        key.shadow.dispose();
        renderer.dispose();
      },
    };
    state.viewer = viewer;
    return viewer;
  } catch {
    showStageMessage(
      "The 3D preview needs WebGL and an internet connection for Three.js. You can still explore the catalog and download the GLB files.",
      true
    );
    return null;
  }
}

async function loadCatalog() {
  elements["library-status"].hidden = false;
  elements["library-status"].textContent = "Loading the collection…";
  try {
    const response = await fetch(catalogUrl, { signal: events.signal });
    if (!response.ok) {
      throw new Error(`The catalog request returned HTTP ${response.status}.`);
    }
    state.catalog = validateCatalog(await response.json());
    if (state.disposed) {
      return;
    }
    elements["total-models"].textContent = String(state.catalog.models.length);
    elements["total-modes"].textContent = String(
      new Set(state.catalog.models.map((model) => model.mode)).size
    );
    elements["catalog-date"].textContent = hasText(state.catalog.generatedAt)
      ? `Collection · ${state.catalog.generatedAt}`
      : "";
    renderFilters();
    renderLibrary();
    let requestedId = "";
    try {
      requestedId = decodeURIComponent(window.location.hash.slice(1));
    } catch {
      requestedId = "";
    }
    const initial =
      state.catalog.models.find((model) => model.id === requestedId) ??
      state.catalog.models[0];
    if (initial) {
      await selectModel(initial.id);
    } else {
      showStageMessage(
        "No vehicles have been added to this collection yet.",
        true
      );
    }
  } catch (error) {
    if (events.signal.aborted) {
      return;
    }
    const detail =
      error instanceof Error ? error.message : "Please check your connection.";
    elements["library-status"].textContent =
      `Could not load the collection. ${detail}`;
    const retry = node("button", "", "Reload collection");
    retry.type = "button";
    retry.addEventListener("click", loadCatalog, {
      once: true,
      signal: events.signal,
    });
    elements["library-status"].append(retry);
    showStageMessage(
      "The vehicle catalog could not be loaded. Use “Reload collection” to try again.",
      true
    );
  }
}

elements["mode-filters"].addEventListener(
  "click",
  (event) => {
    const button = event.target.closest("button[data-mode]");
    if (!button) {
      return;
    }
    state.mode = button.dataset.mode;
    for (const entry of elements["mode-filters"].querySelectorAll("button")) {
      entry.setAttribute("aria-pressed", String(entry === button));
    }
    renderLibrary();
  },
  { signal: events.signal }
);

elements["asset-search"].addEventListener(
  "input",
  (event) => {
    state.query = event.target.value;
    renderLibrary();
  },
  { signal: events.signal }
);

for (const id of ["asset-list", "service-list"]) {
  elements[id].addEventListener(
    "click",
    async (event) => {
      const button = event.target.closest("button[data-model-id]");
      if (button) {
        await selectModel(button.dataset.modelId);
      }
    },
    { signal: events.signal }
  );
}

elements["reset-camera"].addEventListener(
  "click",
  () => state.viewer?.frame(),
  { signal: events.signal }
);
elements["retry-model"].addEventListener(
  "click",
  async () => {
    if (state.selected) {
      await selectModel(state.selected.id);
    }
  },
  { signal: events.signal }
);
elements["rotate-model"].addEventListener(
  "click",
  (event) => {
    const button = event.currentTarget;
    const enabled = button.getAttribute("aria-pressed") !== "true";
    button.setAttribute("aria-pressed", String(enabled));
    button.setAttribute(
      "aria-label",
      `Turn ${enabled ? "off" : "on"} automatic rotation`
    );
    state.viewer?.rotate(enabled);
  },
  { signal: events.signal }
);

document.addEventListener(
  "keydown",
  (event) => {
    if (
      event.key === "/" &&
      !["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)
    ) {
      event.preventDefault();
      elements["asset-search"].focus();
    }
  },
  { signal: events.signal }
);
window.addEventListener(
  "pagehide",
  (event) => {
    if (event.persisted) {
      return;
    }
    state.disposed = true;
    state.generation += 1;
    state.loading?.abort();
    events.abort();
    state.viewer?.dispose();
  },
  { signal: events.signal }
);

renderFilters();
await loadCatalog();
