import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  artifactInputIdentity,
  artifactOutputIdentity,
  assertArtifactCheckout,
} from "./production-artifact-check.mjs";
import { checkProductionWeb } from "./production-web-health.mjs";

const SSR_ERROR = /SSR/u;
const SOURCE_ERROR = /source/u;
const DIRTY_ERROR = /dirty/u;
const CHECKOUT_ERROR = /checkout changed/u;

test("artifact evidence rejects a moved HEAD or newly dirty checkout", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "artifact-checkout-"));
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  try {
    git("init", "--quiet");
    git(
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "--allow-empty",
      "-m",
      "fixture"
    );
    const sha = git("rev-parse", "HEAD");
    assertArtifactCheckout(root, sha);
    await writeFile(path.join(root, "unexpected.txt"), "changed");
    assert.throws(() => assertArtifactCheckout(root, sha), CHECKOUT_ERROR);
    assertArtifactCheckout(root, sha, true);
    assert.throws(
      () => assertArtifactCheckout(root, "0".repeat(40), true),
      CHECKOUT_ERROR
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Web health requires rendered HTML from the exact clean source, not guide.md or stale HTML", async () => {
  const sourceSha = "a".repeat(40);
  const html = `<html><head><meta name="openmeld-source-sha" content="${sourceSha}"/><meta name="openmeld-build-id" content="build-a"/><meta name="openmeld-build-dirty" content="false"/></head><body>OpenMeld<script src="/assets/a.js"></script></body></html>`;
  let requested;
  const run = (
    body,
    status = 200,
    contentType = "text/html",
    expectedBuildId = null
  ) =>
    checkProductionWeb({
      url: "https://web.example",
      sourceSha,
      expectedBuildId,
      fetchImpl: (url) => {
        requested = url;
        return Promise.resolve(
          new Response(body, {
            status,
            headers: { "content-type": contentType },
          })
        );
      },
    });
  assert.equal((await run(html)).buildId, "build-a");
  assert.equal(requested.pathname, "/");
  await assert.rejects(run(html, 200, "text/html", "prior-build"), {
    message: "Web SSR build identity does not match the verified artifact.",
  });
  await assert.rejects(
    run("# OpenMeld guide", 200, "text/markdown"),
    SSR_ERROR
  );
  await assert.rejects(run(html, 500), SSR_ERROR);
  await assert.rejects(
    run(html.replace(sourceSha, "b".repeat(40))),
    SOURCE_ERROR
  );
  await assert.rejects(
    run(html.replace('content="false"', 'content="true"')),
    DIRTY_ERROR
  );
});

test("artifact reuse identity changes with source, production target, build inputs and ignored env files", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "artifact-inputs-"));
  try {
    execFileSync("git", ["init", "--quiet", root]);
    await mkdir(path.join(root, "clients/web"), { recursive: true });
    await writeFile(path.join(root, ".gitignore"), ".env*\n");
    await writeFile(path.join(root, "clients/web/vite.config.ts"), "config-a");
    const webRoot = path.join(root, "clients/web");
    await mkdir(path.join(webRoot, "dist"));
    await mkdir(path.join(webRoot, ".wrangler/deploy"), { recursive: true });
    await writeFile(path.join(webRoot, "dist/index.js"), "built-a");
    await writeFile(
      path.join(webRoot, ".wrangler/deploy/config.json"),
      "pointer-a"
    );
    const output = await artifactOutputIdentity(webRoot);
    await writeFile(
      path.join(webRoot, ".wrangler/deploy/config.json"),
      "pointer-b"
    );
    assert.notEqual(await artifactOutputIdentity(webRoot), output);
    const initial = await artifactInputIdentity(
      root,
      "web",
      "a".repeat(40),
      {}
    );
    assert.equal(
      await artifactInputIdentity(root, "web", "a".repeat(40), {}),
      initial
    );
    for (const [scope, sha, env] of [
      ["desktop", "a".repeat(40), {}],
      ["web", "b".repeat(40), {}],
      ["web", "a".repeat(40), { VITE_BETTER_AUTH_URL: "https://auth.example" }],
    ]) {
      assert.notEqual(
        await artifactInputIdentity(root, scope, sha, env),
        initial
      );
    }
    await writeFile(path.join(root, ".env.production"), "SECRET=do-not-record");
    const environmentChanged = await artifactInputIdentity(
      root,
      "web",
      "a".repeat(40),
      {}
    );
    assert.notEqual(environmentChanged, initial);
    await writeFile(path.join(root, "clients/web/vite.config.ts"), "config-b");
    assert.notEqual(
      await artifactInputIdentity(root, "web", "a".repeat(40), {}),
      environmentChanged
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
