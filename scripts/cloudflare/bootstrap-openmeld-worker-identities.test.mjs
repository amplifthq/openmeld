import assert from "node:assert/strict";
import test from "node:test";

import {
  bootstrapOpenMeldWorkerIdentities,
  OPENMELD_BOOTSTRAP_WORKERS,
  OPENMELD_STAGING_BOOTSTRAP_WORKERS,
  parseArgs,
} from "./bootstrap-openmeld-worker-identities.mjs";

const MISSING_CREDENTIALS_REGEX =
  /CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required/u;

test("plans every missing greenfield Worker without writing", async () => {
  let uploads = 0;
  const result = await bootstrapOpenMeldWorkerIdentities({
    apply: false,
    client: {
      listWorkerNames: async () => [],
      uploadBootstrapWorker: () => {
        uploads += 1;
      },
    },
  });

  assert.equal(result.ok, false);
  assert.equal(uploads, 0);
  assert.deepEqual(
    result.resources.map(({ action, name }) => ({ action, name })),
    OPENMELD_BOOTSTRAP_WORKERS.map((name) => ({
      action: "missing",
      name,
    }))
  );
});

test("creates only missing identities and verifies every stable name", async () => {
  const names = new Set([OPENMELD_BOOTSTRAP_WORKERS[0]]);
  const uploaded = [];
  const result = await bootstrapOpenMeldWorkerIdentities({
    apply: true,
    client: {
      listWorkerNames: async () => [...names],
      uploadBootstrapWorker: (name) => {
        uploaded.push(name);
        names.add(name);
      },
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(uploaded, OPENMELD_BOOTSTRAP_WORKERS.slice(1));
  assert.deepEqual(
    result.resources.map(({ action, verified }) => ({ action, verified })),
    OPENMELD_BOOTSTRAP_WORKERS.map((_, index) => ({
      action: index === 0 ? "existing" : "created",
      verified: true,
    }))
  );
});

test("requires explicit Cloudflare credentials", () => {
  assert.throws(() => parseArgs([], {}), MISSING_CREDENTIALS_REGEX);
});

test("accepts pnpm's option separator before apply", () => {
  assert.equal(
    parseArgs(["--", "--apply"], {
      CLOUDFLARE_ACCOUNT_ID: "account",
      CLOUDFLARE_API_TOKEN: "token",
    }).apply,
    true
  );
});

test("bootstraps staging Worker identities without touching production names", async () => {
  const names = new Set();
  const uploaded = [];
  const result = await bootstrapOpenMeldWorkerIdentities({
    apply: true,
    environment: "staging",
    client: {
      listWorkerNames: async () => [...names],
      uploadBootstrapWorker: (name) => {
        uploaded.push(name);
        names.add(name);
      },
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(uploaded, OPENMELD_STAGING_BOOTSTRAP_WORKERS);
  assert.ok(uploaded.every((name) => name.endsWith("-stg")));
  assert.ok(
    uploaded.every((name) => !OPENMELD_BOOTSTRAP_WORKERS.includes(name))
  );
});
