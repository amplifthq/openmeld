import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { fumadocsMdx } from "fumadocs-mdx/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { prepareSharedPublicAssets } from "../../scripts/vite/shared-public-assets.mjs";

prepareSharedPublicAssets(import.meta.dirname);
const publicOrigins: Record<string, { app: string; website: string }> = {
  prod: { app: "https://app.openmeld.ai", website: "https://openmeld.ai" },
  stg: {
    app: "https://app.staging.openmeld.ai",
    website: "https://staging.openmeld.ai",
  },
};
const origins = publicOrigins[process.env.CLOUDFLARE_ENV ?? ""] ?? {
  app: "http://localhost:3000",
  website: "http://localhost:3500",
};

export default defineConfig({
  define: {
    "import.meta.env.VITE_APP_URL": JSON.stringify(
      process.env.VITE_APP_URL ?? origins.app
    ),
    "import.meta.env.VITE_WEBSITE_URL": JSON.stringify(
      process.env.VITE_WEBSITE_URL ?? origins.website
    ),
    __OPENMELD_DOCS_BUILD__: JSON.stringify({
      id: randomUUID(),
      sha: execFileSync("git", ["rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim(),
      dirty:
        execFileSync("git", ["status", "--porcelain"], {
          encoding: "utf8",
        }).trim().length > 0,
    }),
  },
  build: { assetsDir: "_docs/assets" },
  ssr: { noExternal: ["fumadocs-core", "fumadocs-ui", "@fumadocs/base-ui"] },
  // The MDX macro emits imports after scanning. Prebundle it before first SSR.
  environments: {
    ssr: { optimizeDeps: { include: ["fumadocs-mdx/runtime/macro"] } },
  },
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" }, inspectorPort: false }),
    fumadocsMdx(),
    tsconfigPaths(),
    tanstackStart({
      router: { routeFileIgnorePattern: "\\.(test|spec)\\." },
      client: { base: "/_docs/build" },
      serverFns: { base: "/_docs/serverFn" },
      prerender: { enabled: true },
    }),
    react(),
    tailwindcss(),
  ],
});
