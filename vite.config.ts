import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import fmt from "ultracite/oxfmt";
import antiSlop from "ultracite/oxlint/anti-slop";
import core from "ultracite/oxlint/core";
import { selectJsPlugins } from "ultracite/oxlint/js-plugins";
import react from "ultracite/oxlint/react";
import { defineConfig, lazyPlugins } from "vite-plus";

const runFile = promisify(execFile);

// Ultracite includes this rule, but the bundled Oxlint does not implement it.
const reactPreset = {
  ...react,
  rules: Object.fromEntries(
    Object.entries(react.rules ?? {}).filter(
      ([rule]) => rule !== "react/react-compiler"
    )
  ),
};

const config = defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  fmt,
  lint: {
    extends: [core, reactPreset, antiSlop, selectJsPlugins(["react-doctor"])],
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    // Preserve the existing lint baseline; use `vp run typecheck` for tsc.
    options: { typeAware: false, typeCheck: false },
    settings: { "react-doctor": { portedRuleMode: "curated" } },
    ignorePatterns: [
      ...(core.ignorePatterns ?? []),
      "src/routeTree.gen.ts",
      // Vendored by shadcn; changes are overwritten by its CLI.
      "src/components/ui/**",
    ],
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
      // Keep named declarations and the existing component/module layout.
      "eslint/func-style": "off",
      "react/function-component-definition": "off",
      "eslint/no-use-before-define": "off",
      "react-doctor/only-export-components": "off",
      // React Compiler is not enabled; MapLibre relies on stable style objects.
      "react-doctor/react-compiler-no-manual-memoization": "off",
      // Keep explanations beside constants and MapLibre's conventional key order.
      "eslint/no-inline-comments": "off",
      "eslint/sort-keys": "off",
      // MapLibre expression builders need tuple assertions and explicit return types.
      "anti-slop/require-safety-comment-for-type-assertion": "off",
      "anti-slop/no-known-value-widening": "off",
      // SSR guards and untyped vector-tile data require runtime checks.
      "anti-slop/no-runtime-typeof": "off",
    },
    overrides: [
      {
        files: ["scripts/**", "public/sw.js"],
        rules: {
          "eslint/no-await-in-loop": "off",
          "eslint/no-implicit-globals": "off",
          "eslint/no-plusplus": "off",
          "promise/avoid-new": "off",
          "promise/prefer-await-to-callbacks": "off",
          "promise/prefer-await-to-then": "off",
          "unicorn/import-style": "off",
        },
      },
    ],
  },
  server: {
    port: 3000,
    // TanStack Devtools pipes server logs to the browser; avoid echoing them back.
    forwardConsole: false,
  },
  build: {
    // The map engine is large and changes rarely; splitting it out means a
    // style tweak does not invalidate a megabyte of it in the user's cache.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("maplibre-gl")) {
            return "maplibre";
          }
        },
      },
    },
  },
  optimizeDeps: {
    // MapLibre must stay pre-bundled. Served raw from node_modules, Vite
    // injects its HMR preamble (`import ... from "/@vite/client"`) into
    // maplibre-gl-worker.mjs, and that preamble touches `document` - which does
    // not exist inside a Worker, so the worker dies on load and every style and
    // tile silently never finishes parsing.
    include: ["maplibre-gl", "pmtiles"],
  },
  plugins: lazyPlugins(() => [
    {
      name: "maplibre-worker",
      // Built-in vp commands skip package.json's predev/prebuild scripts.
      async configResolved() {
        await runFile(
          process.execPath,
          [
            fileURLToPath(
              new URL("scripts/sync-map-worker.mjs", import.meta.url)
            ),
          ],
          { cwd: import.meta.dirname }
        );
      },
    },
    devtools(),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ]),
  resolve: { tsconfigPaths: true },
  worker: { format: "es" },
});

export default config;
