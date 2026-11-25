import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const skill = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(skill, "../../..");

export default defineConfig({
  root: skill,
  resolve: {
    alias: {
      "@openmeld/schemas/types": path.join(
        repo,
        "packages/schemas/src/types/index.ts"
      ),
      "@openmeld/schemas": path.join(repo, "packages/schemas/src/index.ts"),
      "@openmeld/utils": path.join(repo, "packages/utils/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["check.test.ts"],
  },
});
