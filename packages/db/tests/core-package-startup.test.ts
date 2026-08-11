import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CORE_STARTUP_TIMEOUT_MS = 15_000;
const CORE_STARTUP_TEST_TIMEOUT_MS = 20_000;
const coreEntrypointPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../src/core/index.ts"
);

describe("Core database package startup", () => {
  it(
    "loads in the native Node ESM initialization order used by service builds",
    () => {
      const result = spawnSync(
        process.execPath,
        [
          "--experimental-strip-types",
          "--input-type=module",
          "--eval",
          `await import(${JSON.stringify(coreEntrypointPath)})`,
        ],
        {
          encoding: "utf8",
          timeout: CORE_STARTUP_TIMEOUT_MS,
        }
      );

      expect(result.status, result.error?.message ?? result.stderr).toBe(0);
    },
    CORE_STARTUP_TEST_TIMEOUT_MS
  );
});
