import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        "@shared": resolve("src/shared"),
      },
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve("src/main/index.ts"),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        "@shared": resolve("src/shared"),
      },
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve("src/preload/index.ts"),
        },
        // Electron's sandboxed preload (sandbox: true in both windows) cannot
        // load ES modules — `import`/`export` throws "Cannot use import
        // statement outside a module" and the preload silently fails to
        // load, leaving `window.worship` undefined. package.json has
        // "type": "module" for the rest of the toolchain (tsx, drizzle-kit),
        // so this override is what keeps the preload itself as plain CJS.
        output: {
          format: "cjs",
          entryFileNames: "[name].js",
        },
      },
    },
  },
  renderer: {
    root: resolve("src/renderer"),
    resolve: {
      alias: {
        "@renderer": resolve("src/renderer/src"),
        "@shared": resolve("src/shared"),
      },
    },
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        input: {
          control: resolve("src/renderer/index.html"),
          projection: resolve("src/renderer/projection.html"),
          // Offscreen worker window: renders PDF pages to images with pdf.js.
          // It's a renderer (not a Node worker) because rasterizing needs a
          // real Canvas2D — see src/main/slides/rasterizer.ts.
          rasterizer: resolve("src/renderer/rasterizer.html"),
        },
      },
    },
  },
});
