import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
// @ts-expect-error Build-only JavaScript helper; never enters the renderer.
import { desktopWebBuildIdentity } from "../../scripts/desktop/web-build-identity.mjs";

export default defineConfig({
  main: {
    define: {
      __OPENMELD_DESKTOP_WEB_BUILD__: JSON.stringify(
        desktopWebBuildIdentity(resolve(import.meta.dirname, "../.."))
      ),
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(import.meta.dirname, "src/main/main.ts"),
        },
      },
    },
  },
  preload: {
    build: {
      externalizeDeps: false,
      rollupOptions: {
        input: {
          index: resolve(import.meta.dirname, "src/preload/preload.ts"),
        },
        output: {
          entryFileNames: "[name].cjs",
          format: "cjs",
        },
      },
    },
  },
  renderer: {
    plugins: [react(), tailwindcss()],
    root: resolve(import.meta.dirname, "src/renderer"),
    build: {
      rollupOptions: {
        input: {
          index: resolve(import.meta.dirname, "src/renderer/index.html"),
          pilot: resolve(import.meta.dirname, "src/renderer/pilot.html"),
        },
      },
    },
  },
});
