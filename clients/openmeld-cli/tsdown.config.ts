import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    // Keep output names stable for package.json bin fields.
    openmeld: "src/openmeld.ts",
    "openmeld-dev": "src/openmeld-dev.ts",
  },
  outDir: "dist",
  format: "esm",
  platform: "node",
  target: "node20",
  sourcemap: true,
  clean: true,
  // Build-time distribution marker. npm builds ship as the `openmeld` npm
  // package; scripts/release/build-cli-binary.mjs overrides this to "binary"
  // via Bun --define. See src/runtime/distribution.ts.
  define: { __OPENMELD_DISTRIBUTION__: JSON.stringify("npm") },
  // The embedded-assets island uses Bun `with { type: "file" }` imports that
  // only the binary build resolves. Keep it external so the npm/tsdown bundle
  // never parses those imports; the npm runtime never reaches that branch.
  external: [/bundled-assets-embedded/, "bun:sqlite"],
  // For a Node CLI in a "type: module" package, we want dist/openmeld.js (not .mjs).
  outExtensions: () => ({ js: ".js" }),
  banner: {
    js: "#!/usr/bin/env node\n",
  },
  noExternal: [
    "@openmeld/adapter-claude-code",
    "@openmeld/adapter-codex",
    "@openmeld/adapter-core",
    "@openmeld/adapter-openclaw",
    "@openmeld/agent-runtime",
    "@openmeld/local-execution",
    "@openmeld/local-service",
    "@openmeld/space-mesh",
    "@openmeld/schemas",
    "@openmeld/protocol",
    "@openmeld/projects",
    "@openmeld/gateway-contract",
    "@openmeld/utils",
  ],
  // Routine scheduling is bundled through the workspace package so the CLI
  // stays self-contained. Declare its only production dependency explicitly;
  // CI treats an unacknowledged inlined dependency as a build failure.
  inlineOnly: ["croner"],
});
