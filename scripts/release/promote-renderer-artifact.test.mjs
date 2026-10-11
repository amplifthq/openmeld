const MISSING_PARENT = /parent-admitted/;
const DIGEST_MISMATCH = /Artifact digest mismatch/;
const PROMOTION_FAILED = /promotion failed/;

import assert from "node:assert/strict";
import test from "node:test";
import { promoteRendererArtifact } from "./promote-renderer-artifact.mjs";

test("promotion refuses absent parent evidence or an invalid artifact before invoking Wrangler", async () => {
  const input = {
    root: "/source",
    scope: "docs",
    sourceSha: "a".repeat(40),
    env: {},
  };
  let runs = 0;
  const dependencies = {
    run: () => {
      runs++;
      return { status: 0 };
    },
  };
  await assert.rejects(
    promoteRendererArtifact(input, dependencies),
    MISSING_PARENT
  );
  await assert.rejects(
    promoteRendererArtifact(
      { ...input, env: { OPENMELD_PARENT_TRAIN_ADMISSION: "{}" } },
      {
        ...dependencies,
        admit: () => Promise.resolve(),
        check: (options) => {
          assert.equal(options.requireExisting, true);
          throw new Error("Artifact digest mismatch");
        },
      }
    ),
    DIGEST_MISMATCH
  );
  assert.equal(runs, 0);
});

test("promotion uses trusted Wrangler against the verified source output and propagates failures", async () => {
  const input = {
    root: "/source",
    scope: "web",
    sourceSha: "a".repeat(40),
    env: { OPENMELD_PARENT_TRAIN_ADMISSION: "{}" },
    dryRun: true,
  };
  const dependencies = {
    admit: () => Promise.resolve(),
    check: () => Promise.resolve({ artifactSha256: "verified" }),
    assertCheckout: () => undefined,
    wrangler: "/control/wrangler.js",
    run: (command, args, options) => {
      assert.equal(command, process.execPath);
      assert.deepEqual(args, ["/control/wrangler.js", "deploy", "--dry-run"]);
      assert.equal(options.cwd, "/source/clients/web");
      return { status: 1 };
    },
  };
  await assert.rejects(
    promoteRendererArtifact(input, dependencies),
    PROMOTION_FAILED
  );
});
