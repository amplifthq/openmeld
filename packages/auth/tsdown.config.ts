import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    client: "src/client.ts",
    "organization-policy": "src/organization-policy.ts",
    server: "src/server.ts",
  },
  outDir: "dist",
  format: "esm",
  platform: "node",
  target: "node18",
  sourcemap: true,
  clean: false,
  outExtensions: () => ({ js: ".js" }),
});
