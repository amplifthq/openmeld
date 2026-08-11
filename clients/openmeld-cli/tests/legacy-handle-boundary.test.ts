import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(TEST_DIR, "../../..");
const LEGACY_TARGET_HANDLE_PATTERN = /\btargetProfileHandle\b/u;

const ACTIVE_LEGACY_HANDLE_BOUNDARY_FILES = [
  "packages/protocol/src/types.ts",
  "packages/schemas/src/schemas/protocol/signal.ts",
  "packages/schemas/src/schemas/daemon/runtime-transport.ts",
  "services/core/src/dispatch/application/dispatch-execution-service.ts",
  "services/core/src/dispatch/application/dispatch-queue-service.ts",
  "services/core/src/dispatch/application/legacy-dispatch-reply-mirror.ts",
  "services/core/src/dispatch/infrastructure/runtime-transport/runtime-transport-client.ts",
  "services/core/src/dispatch/infrastructure/runtime-transport/runtime-coordinator-client.ts",
] as const;

describe("legacy handle boundary", () => {
  it("does not reintroduce targetProfileHandle into active mention contracts or runtime paths", () => {
    const failures: string[] = [];

    for (const relativePath of ACTIVE_LEGACY_HANDLE_BOUNDARY_FILES) {
      const absolutePath = resolve(REPO_ROOT, relativePath);
      const fileText = readFileSync(absolutePath, "utf8");

      if (LEGACY_TARGET_HANDLE_PATTERN.test(fileText)) {
        failures.push(relativePath);
      }
    }

    expect(failures).toEqual([]);
  });
});
