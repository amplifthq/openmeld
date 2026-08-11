import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { dbDebtRegistry } from "../src/index";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.."
);

describe("db registries", () => {
  it("keeps debt markers aligned with real code locations", () => {
    for (const item of dbDebtRegistry) {
      const absolutePath = path.resolve(repoRoot, item.path);
      const source = fs.readFileSync(absolutePath, "utf8");
      expect(source).toContain(item.marker);
    }
  });

  it("exposes an empty debt registry after Phase 3 debt retirement", () => {
    expect(dbDebtRegistry).toEqual([]);
  });

  it("does not keep retired runtime fallback registry files around", () => {
    expect(
      fs.existsSync(
        path.resolve(repoRoot, "packages/db/src/registry/fallback-registry.ts")
      )
    ).toBe(false);
    expect(
      fs.existsSync(
        path.resolve(
          repoRoot,
          "packages/db/src/diagnostics/fallback-hit-recorder.ts"
        )
      )
    ).toBe(false);
  });
});
