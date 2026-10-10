import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import { acquireLocalResources } from "./local-resources.mjs";
import { buildServedCliArtifact } from "./serve-cli-binary.mjs";

const HASH_MISMATCH = /sha256 mismatch/u;

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "openmeld-cli-build-phase-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const registry = join(directory, "openmeld-dev", "resources.json");
  const acquire = (options) =>
    acquireLocalResources({
      ...options,
      gitCommonDir: directory,
      readMemory: () => ({
        availableBytes: 32 * 1024 ** 3,
        totalBytes: 64 * 1024 ** 3,
        pressure: "normal",
      }),
    });
  const records = () => JSON.parse(readFileSync(registry, "utf8"));
  const bytes = Buffer.from("finite CLI artifact fixture");
  const outFile = join(directory, "openmeld");
  writeFileSync(outFile, bytes);
  const built = {
    artifactName: "openmeld-darwin-arm64",
    outFile,
    platform: "darwin-arm64",
    sha256: createHash("sha256").update(bytes).digest("hex"),
    version: "0.0.0-test",
  };
  return { acquire, records, built, bytes };
}

// biome-ignore lint/style/noDoneCallback: Node test passes a TestContext, not a completion callback.
test("reserves the CLI build phase and releases before the served artifact reaches its caller", async (t) => {
  const f = fixture(t);
  const result = await buildServedCliArtifact({
    acquire: f.acquire,
    build: () => {
      assert.equal(f.records().length, 1);
      assert.equal(f.records()[0].kind, "heavy");
      return f.built;
    },
    env: {},
  });
  assert.deepEqual(result.artifact, f.bytes);
  assert.deepEqual(gunzipSync(result.archive), f.bytes);
  assert.deepEqual(f.records(), []);
  const next = await f.acquire({ kind: "heavy" });
  try {
    assert.equal(f.records().length, 1);
  } finally {
    await next.release();
  }
});

// biome-ignore lint/style/noDoneCallback: Node test passes a TestContext, not a completion callback.
test("releases the reservation after a build failure or artifact verification failure", async (t) => {
  const f = fixture(t);
  const failure = new Error("build failed");
  await assert.rejects(
    buildServedCliArtifact({
      acquire: f.acquire,
      build: () => {
        throw failure;
      },
      env: {},
    }),
    (error) => error === failure
  );
  assert.deepEqual(f.records(), []);
  await assert.rejects(
    buildServedCliArtifact({
      acquire: f.acquire,
      build: () => ({ ...f.built, sha256: "mismatched" }),
      env: {},
    }),
    HASH_MISMATCH
  );
  assert.deepEqual(f.records(), []);
});

test("a rejected resource admission never starts the build and removes waiting signal handlers", async () => {
  const before = [
    process.listenerCount("SIGINT"),
    process.listenerCount("SIGTERM"),
  ];
  let built = false;
  const failure = new Error("admission rejected");
  await assert.rejects(
    buildServedCliArtifact({
      acquire: () => Promise.reject(failure),
      build: () => {
        built = true;
      },
      env: {},
    }),
    (error) => error === failure
  );
  assert.equal(built, false);
  assert.deepEqual(
    [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")],
    before
  );
});
