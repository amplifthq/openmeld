import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { resolveApprovedNativeBuilds } from "./resolve-approved-native-builds.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".."
);

test("derives isolated native rebuilds only from trusted allowBuilds truth", () => {
  assert.deepEqual(
    resolveApprovedNativeBuilds(path.join(REPO_ROOT, "pnpm-workspace.yaml")),
    [
      "better-sqlite3",
      "electron",
      "electron-winstaller",
      "esbuild",
      "koffi",
      "lightningcss",
      "sharp",
      "workerd",
    ]
  );
});
