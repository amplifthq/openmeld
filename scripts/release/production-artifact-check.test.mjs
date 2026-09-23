import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  artifactInputIdentity,
  artifactOutputIdentity,
  assertArtifactCheckout,
  reusableArtifact,
  saveArtifactSnapshot,
} from "./production-artifact-check.mjs";
import {
  checkProductionWeb,
  waitForProductionWeb,
} from "./production-web-health.mjs";

const SSR_ERROR = /SSR/u;
const SOURCE_ERROR = /source/u;
const DIRTY_ERROR = /dirty/u;
const CHECKOUT_ERROR = /checkout changed/u;
const WEB_HEALTH_TIMEOUT_ERROR =
  /did not match the verified release within 3000ms: Web SSR deployment source/u;

async function writeArtifactOutput(webRoot, label) {
  await rm(path.join(webRoot, "dist"), { force: true, recursive: true });
  await rm(path.join(webRoot, ".wrangler/deploy"), {
    force: true,
    recursive: true,
  });
  await mkdir(path.join(webRoot, "dist"), { recursive: true });
  await mkdir(path.join(webRoot, ".wrangler/deploy"), { recursive: true });
  await writeFile(path.join(webRoot, "dist/index.js"), `bundle-${label}`);
  await writeFile(
    path.join(webRoot, ".wrangler/deploy/config.json"),
    `deploy-${label}`
  );
}

async function saveReusableFixture({
  receiptPath,
  webRoot,
  scope,
  sourceSha,
  identity,
}) {
  const artifactSha256 = await artifactOutputIdentity(webRoot);
  await saveArtifactSnapshot({
    receiptPath,
    webRoot,
    scope,
    identity,
    artifactSha256,
  });
  await mkdir(path.dirname(receiptPath), { recursive: true });
  await writeFile(
    receiptPath,
    `${JSON.stringify({
      scope,
      sourceSha,
      inputIdentity: identity,
      artifactSha256,
      allowDirty: false,
    })}\n`
  );
  return artifactSha256;
}

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

test("Web health waits briefly for the deployed SSR page to serve the verified artifact", async () => {
  const sourceSha = "a".repeat(40);
  const page = (sha, buildId) =>
    `<html><head><meta name="openmeld-source-sha" content="${sha}"/><meta name="openmeld-build-id" content="${buildId}"/><meta name="openmeld-build-dirty" content="false"/></head><body>OpenMeld<script src="/assets/a.js"></script></body></html>`;
  let requests = 0;
  let elapsedMs = 0;
  const options = {
    url: "https://web.example",
    sourceSha,
    expectedBuildId: "verified-build",
    now: () => elapsedMs,
    sleepImpl: (ms) => {
      elapsedMs += ms;
    },
    retryDelayMs: 1000,
    maxWaitMs: 3000,
    fetchImpl: () => {
      requests += 1;
      return new Response(
        requests === 1
          ? page("b".repeat(40), "old-build")
          : page(sourceSha, "verified-build"),
        { headers: { "content-type": "text/html" } }
      );
    },
  };

  assert.deepEqual(await waitForProductionWeb(options), {
    sourceSha,
    buildId: "verified-build",
    status: 200,
  });
  assert.equal(requests, 2);
  assert.equal(elapsedMs, 1000);

  requests = 0;
  elapsedMs = 0;
  await assert.rejects(
    waitForProductionWeb({
      ...options,
      fetchImpl: () => {
        requests += 1;
        return new Response(page("b".repeat(40), "old-build"), {
          headers: { "content-type": "text/html" },
        });
      },
    }),
    WEB_HEALTH_TIMEOUT_ERROR
  );
  assert.equal(requests, 4);
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

test("Web and Desktop reuse restore independent verified output snapshots", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "artifact-snapshots-"));
  const webRoot = path.join(root, "clients/web");
  const receiptRoot = path.join(root, "dev-tmp/release-artifact-check");
  const sourceSha = "a".repeat(40);
  const webIdentity = "1".repeat(64);
  const desktopIdentity = "2".repeat(64);
  const webReceipt = path.join(receiptRoot, "web.json");
  const desktopReceipt = path.join(receiptRoot, "desktop.json");
  try {
    await writeArtifactOutput(webRoot, "web");
    const webOutput = await saveReusableFixture({
      receiptPath: webReceipt,
      webRoot,
      scope: "web",
      sourceSha,
      identity: webIdentity,
    });
    await writeArtifactOutput(webRoot, "desktop");
    const desktopOutput = await saveReusableFixture({
      receiptPath: desktopReceipt,
      webRoot,
      scope: "desktop",
      sourceSha,
      identity: desktopIdentity,
    });
    assert.notEqual(webOutput, desktopOutput);

    await writeArtifactOutput(webRoot, "damaged-live-output");
    assert.equal(
      (
        await reusableArtifact({
          receiptPath: webReceipt,
          webRoot,
          scope: "web",
          sourceSha,
          identity: webIdentity,
          allowDirty: false,
        })
      )?.reused,
      true
    );
    assert.equal(await artifactOutputIdentity(webRoot), webOutput);
    assert.equal(
      await readFile(path.join(webRoot, "dist/index.js"), "utf8"),
      "bundle-web"
    );

    assert.equal(
      (
        await reusableArtifact({
          receiptPath: desktopReceipt,
          webRoot,
          scope: "desktop",
          sourceSha,
          identity: desktopIdentity,
          allowDirty: false,
        })
      )?.reused,
      true
    );
    assert.equal(await artifactOutputIdentity(webRoot), desktopOutput);
    assert.equal(
      await readFile(
        path.join(webRoot, ".wrangler/deploy/config.json"),
        "utf8"
      ),
      "deploy-desktop"
    );

    await writeFile(
      path.join(receiptRoot, "artifacts/web", webIdentity, "dist/index.js"),
      "corrupt-snapshot"
    );
    assert.equal(
      await reusableArtifact({
        receiptPath: webReceipt,
        webRoot,
        scope: "web",
        sourceSha,
        identity: webIdentity,
        allowDirty: false,
      }),
      null
    );
    assert.equal(await artifactOutputIdentity(webRoot), desktopOutput);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
