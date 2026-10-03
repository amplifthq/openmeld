import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const EXCLUDED_TEST_ERROR = /excluded by every owning Vitest configuration/u;

test("focused feedback executes mixed suites and explicit skips, and rejects excluded files", () => {
  const root = mkdtempSync(path.join(tmpdir(), "focused-runner-"));
  const require = createRequire(
    new URL("../../clients/web/package.json", import.meta.url)
  );
  const script = fileURLToPath(
    new URL("./run-focused-workspace-tests.mjs", import.meta.url)
  );
  const markers = path.join(root, "executed.txt");
  try {
    mkdirSync(path.join(root, "node_modules"));
    symlinkSync(
      path.dirname(require.resolve("vitest/package.json")),
      path.join(root, "node_modules/vitest"),
      process.platform === "win32" ? "junction" : "dir"
    );
    writeFileSync(path.join(root, "package.json"), '{"type":"module"}');
    writeFileSync(
      path.join(root, "vitest.config.mjs"),
      'export default {test:{include:["*.test.js"],exclude:["*.integration.test.js"],passWithNoTests:true}};'
    );
    writeFileSync(
      path.join(root, "vitest.integration.config.mjs"),
      'export default {test:{include:["*.integration.test.js"],environment:"node"}};'
    );
    for (const [file, label, callback] of [
      [
        "unit.test.js",
        "unit",
        'expect(document.createElement("div").tagName).toBe("DIV");',
      ],
      [
        "flow.integration.test.js",
        "integration",
        'expect(typeof document).toBe("undefined");',
      ],
    ]) {
      writeFileSync(
        path.join(root, file),
        `import {it,expect} from "vitest"; import {appendFileSync} from "node:fs"; it(${JSON.stringify(label)},()=>{ ${callback} appendFileSync(${JSON.stringify(markers)},${JSON.stringify(`${label}\n`)}); });`
      );
    }
    writeFileSync(
      path.join(root, "platform.test.js"),
      'import {it} from "vitest"; it.skip("intentional platform skip",()=>{throw new Error("must remain skipped")});'
    );
    writeFileSync(
      path.join(root, "excluded.test.js"),
      'import {it} from "vitest"; it("excluded",()=>{});'
    );
    const run = (files) =>
      spawnSync(
        process.execPath,
        [script, root, "vitest run --environment jsdom", ...files],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            OPENMELD_HOME: path.join(root, "openmeld-home"),
          },
        }
      );
    const result = run([
      "unit.test.js",
      "flow.integration.test.js",
      "platform.test.js",
    ]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(readFileSync(markers, "utf8").trim().split("\n").sort(), [
      "integration",
      "unit",
    ]);
    // A package edit that excludes a selected file must turn feedback red.
    writeFileSync(
      path.join(root, "vitest.config.mjs"),
      'export default {test:{include:["unit.test.js"],passWithNoTests:true}};'
    );
    const excluded = run(["excluded.test.js"]);
    assert.notEqual(excluded.status, 0);
    assert.match(excluded.stderr, EXCLUDED_TEST_ERROR);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
