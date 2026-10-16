import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const MODULE_NOT_FOUND = /MODULE_NOT_FOUND/u;

test("Desktop artifact admission rejects an external runtime export without built output", () => {
  const root = mkdtempSync(join(tmpdir(), "desktop-runtime-export-"));
  try {
    mkdirSync(join(root, "scripts"));
    const pkg = join(root, "node_modules/@openmeld/start");
    mkdirSync(pkg, { recursive: true });
    writeFileSync(
      join(pkg, "package.json"),
      JSON.stringify({
        type: "module",
        exports: { "./node-runtime": "./dist/setup-node-runtime.js" },
      })
    );
    const check = join(root, "scripts/check-runtime-deps.mjs");
    copyFileSync(
      new URL(
        "../../clients/desktop/scripts/check-runtime-deps.mjs",
        import.meta.url
      ),
      check
    );
    const missing = spawnSync(process.execPath, [check], { encoding: "utf8" });
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, MODULE_NOT_FOUND);
    mkdirSync(join(pkg, "dist"));
    writeFileSync(
      join(pkg, "dist/setup-node-runtime.js"),
      "export const built = true;\n"
    );
    const built = spawnSync(process.execPath, [check], { encoding: "utf8" });
    assert.equal(built.status, 0, built.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
