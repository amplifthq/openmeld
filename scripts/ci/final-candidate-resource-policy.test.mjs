import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const packageJson = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8")
);

// Exercise shell argument boundaries and failure propagation without running
// heavy tasks. Equivalent whitespace or helper spelling is not the contract.
for (const scriptName of ["verify:pre-push:full", "verify:pr:full"]) {
  test(`${scriptName} separates heavy phases and stops after failure`, () => {
    const directory = mkdtempSync(
      path.join(tmpdir(), "openmeld-phase-policy-")
    );
    const log = path.join(directory, "calls.jsonl");
    const shim = `#!${process.execPath}
import { appendFileSync } from "node:fs";
appendFileSync(process.env.PHASE_LOG, JSON.stringify(process.argv.slice(2)) + "\\n");
if (process.argv.includes(process.env.FAIL_PHASE)) process.exit(7);
`;
    try {
      for (const name of ["node", "pnpm"]) {
        writeFileSync(path.join(directory, name), shim, { mode: 0o755 });
      }
      const run = (failPhase = "") => {
        writeFileSync(log, "");
        const result = spawnSync(packageJson.scripts[scriptName], {
          shell: true,
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${directory}${path.delimiter}${process.env.PATH ?? ""}`,
            PHASE_LOG: log,
            FAIL_PHASE: failPhase,
          },
        });
        const calls = readFileSync(log, "utf8")
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) =>
            JSON.parse(line).filter((arg) => arg !== "--changed-only")
          );
        return { result, calls };
      };
      const { result, calls } = run();
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(calls, [
        ["scripts/dev/turbo-affected.mjs", "check", "--", "--concurrency=2"],
        ["scripts/dev/turbo-affected.mjs", "test", "--", "--concurrency=2"],
        scriptName === "verify:pr:full"
          ? [
              "scripts/dev/turbo-affected.mjs",
              "test:integration",
              "--",
              "--concurrency=1",
            ]
          : ["run", "verify:release-ready"],
      ]);
      const failed = run("check");
      assert.equal(failed.result.status, 7);
      assert.deepEqual(failed.calls, [calls[0]]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
