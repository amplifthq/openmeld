import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { parseJsoncObject } from "../../packages/db/src/tooling/parse-jsonc.ts";
import { buildCoreVersionReleaseStepSpecs } from "../cloudflare/core-version-deployment.mjs";
import {
  CUTOVER_CONFIG_NAME,
  cutoverConfigArgs,
  withPostgresqlCutoverConfig,
} from "./postgresql-cutover-config.mjs";

const onlyCrons = /may change only prod triggers.crons/u;

test("maintenance configuration preserves actual source paths and bindings for the Core deployment owner", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "pg-cutover-config-"));
  try {
    for (const scope of ["auth", "core"]) {
      mkdirSync(path.join(root, "services", scope), { recursive: true });
      writeFileSync(
        path.join(root, "services", scope, "wrangler.jsonc"),
        readFileSync(
          new URL(`../../services/${scope}/wrangler.jsonc`, import.meta.url)
        )
      );
    }
    await withPostgresqlCutoverConfig(root, true, (env) => {
      for (const scope of ["auth", "core"]) {
        const directory = path.join(root, "services", scope);
        const original = parseJsoncObject(
          readFileSync(path.join(directory, "wrangler.jsonc"), "utf8")
        );
        const derived = parseJsoncObject(
          readFileSync(path.join(directory, CUTOVER_CONFIG_NAME), "utf8")
        );
        assert.deepEqual(derived.env.prod.triggers.crons, []);
        assert.equal(
          path.resolve(directory, derived.main),
          path.resolve(directory, original.main)
        );
        derived.env.prod.triggers.crons = original.env.prod.triggers.crons;
        assert.deepEqual(derived, original);
        assert.deepEqual(cutoverConfigArgs(scope, { cwd: root, env }), [
          "--config",
          CUTOVER_CONFIG_NAME,
        ]);
      }
      const coreSteps = buildCoreVersionReleaseStepSpecs({
        versionId: "fb18a6dd-5ee3-43fd-aa64-087346c6bfd3",
        wranglerConfigSource: "{}",
        configArgs: cutoverConfigArgs("core", { cwd: root, env }),
      });
      assert.deepEqual(coreSteps[1].args.slice(-2), [
        "--config",
        CUTOVER_CONFIG_NAME,
      ]);
      const file = path.join(root, "services/core", CUTOVER_CONFIG_NAME);
      const invalid = JSON.parse(readFileSync(file, "utf8"));
      invalid.env.prod.hyperdrive[0].id = "wrong-target";
      writeFileSync(file, JSON.stringify(invalid));
      assert.throws(
        () => cutoverConfigArgs("core", { cwd: root, env }),
        onlyCrons
      );
    });
    assert.equal(
      existsSync(path.join(root, "services/core", CUTOVER_CONFIG_NAME)),
      false
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
