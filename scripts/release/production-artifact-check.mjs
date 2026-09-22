import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { buildProductionRenderer } from "../desktop/renderer-build.mjs";
import { desktopWebBuildIdentity } from "../desktop/web-build-identity.mjs";
import { runOwnedCommand } from "../dev/owned-command.mjs";
import {
  checkProductionWeb,
  validateSsrPage,
} from "./production-web-health.mjs";

const ENV_FILE = /^\.env(?:\.|$)/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const BUILD_ENV =
  /^(VITE_|CLOUDFLARE_ENV$|OPENMELD_DESKTOP_(TARGET|PILOT|NODE_HEAP_MB)$|OPENMELD_DEV_ISOLATED$|OPENMELD_GATEWAY_URL$|NODE_OPTIONS$|NODE_ENV$|BETTER_AUTH_URL$|WEB_APP_URL$)/u;

function productionBuildEnvironment(scope, env) {
  return {
    ...env,
    CLOUDFLARE_ENV: "prod",
    OPENMELD_RELEASE_ARTIFACT_CHECK: "1",
    OPENMELD_DESKTOP_PILOT: undefined,
    OPENMELD_DESKTOP_TARGET: scope === "desktop" ? "production" : undefined,
  };
}

const repositoryRoot = () =>
  execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: process.cwd(),
    encoding: "utf8",
  }).trim();

async function hashTree(directory, hash = createHash("sha256"), prefix = "") {
  for (const name of (await readdir(directory)).sort()) {
    const filename = path.join(directory, name);
    const relative = `${prefix}/${name}`;
    const stat = await lstat(filename);
    if (stat.isSymbolicLink()) {
      throw new Error("Release build output must not contain symbolic links.");
    }
    hash.update(relative).update("\0");
    if (stat.isDirectory()) {
      await hashTree(filename, hash, relative);
    } else {
      hash.update(await readFile(filename)).update("\0");
    }
  }
  return hash;
}

export function artifactOutputIdentity(webRoot) {
  return artifactFilesIdentity(
    path.join(webRoot, "dist"),
    path.join(webRoot, ".wrangler/deploy/config.json")
  );
}

async function artifactFilesIdentity(distPath, deployConfigPath) {
  const hash = await hashTree(distPath);
  if ((await lstat(deployConfigPath)).isSymbolicLink()) {
    throw new Error("Release build output must not contain symbolic links.");
  }
  return hash.update(await readFile(deployConfigPath)).digest("hex");
}

export async function artifactInputIdentity(
  root,
  scope,
  sourceSha,
  env = process.env
) {
  const hash = createHash("sha256").update(desktopWebBuildIdentity(root));
  const files = execFileSync(
    "git",
    [
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
      "scripts/release",
      "scripts/dev",
      "package.json",
      "pnpm-workspace.yaml",
      "turbo.json",
    ],
    { cwd: root, encoding: "utf8" }
  )
    .split("\0")
    .filter(Boolean)
    .sort();
  for (const file of new Set(files)) {
    hash.update(file).update("\0");
    try {
      hash.update(await readFile(path.join(root, file)));
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }
  for (const directory of [root, path.join(root, "clients/web")]) {
    for (const name of (await readdir(directory))
      .filter((name) => ENV_FILE.test(name))
      .sort()) {
      hash
        .update(path.relative(root, path.join(directory, name)))
        .update(await readFile(path.join(directory, name)));
    }
  }
  // Values are hashed, never retained in evidence (some build inputs are secrets).
  const inputs = Object.fromEntries(
    Object.entries(productionBuildEnvironment(scope, env))
      .filter(([key]) => BUILD_ENV.test(key))
      .sort(([a], [b]) => a.localeCompare(b))
  );
  return hash
    .update(
      JSON.stringify({
        scope,
        sourceSha,
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        inputs,
      })
    )
    .digest("hex");
}

function artifactSnapshotPath(receiptPath, scope, identity) {
  if (!((scope === "web" || scope === "desktop") && SHA256.test(identity))) {
    throw new Error(
      "Artifact snapshot requires a valid scope and input identity."
    );
  }
  return path.join(path.dirname(receiptPath), "artifacts", scope, identity);
}

async function pathExists(filename) {
  try {
    await lstat(filename);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function snapshotOutputIdentity(snapshotPath) {
  return artifactFilesIdentity(
    path.join(snapshotPath, "dist"),
    path.join(snapshotPath, "deploy/config.json")
  );
}

export async function saveArtifactSnapshot({
  receiptPath,
  webRoot,
  scope,
  identity,
  artifactSha256,
}) {
  const snapshotPath = artifactSnapshotPath(receiptPath, scope, identity);
  const parent = path.dirname(snapshotPath);
  const temporary = path.join(parent, `.${identity}.tmp-${randomUUID()}`);
  const previous = path.join(parent, `.${identity}.previous-${randomUUID()}`);
  await mkdir(path.join(temporary, "deploy"), { recursive: true });
  try {
    await cp(path.join(webRoot, "dist"), path.join(temporary, "dist"), {
      recursive: true,
    });
    await cp(
      path.join(webRoot, ".wrangler/deploy/config.json"),
      path.join(temporary, "deploy/config.json")
    );
    if ((await snapshotOutputIdentity(temporary)) !== artifactSha256) {
      throw new Error("Artifact snapshot changed while it was being saved.");
    }
    const hadPrevious = await pathExists(snapshotPath);
    if (hadPrevious) {
      await rename(snapshotPath, previous);
    }
    try {
      await rename(temporary, snapshotPath);
    } catch (error) {
      if (hadPrevious) {
        await rename(previous, snapshotPath);
      }
      throw error;
    }
    await rm(previous, { force: true, recursive: true });
  } finally {
    await rm(temporary, { force: true, recursive: true });
  }
  return snapshotPath;
}

export async function restoreArtifactSnapshot({
  receiptPath,
  webRoot,
  scope,
  identity,
  artifactSha256,
}) {
  const snapshotPath = artifactSnapshotPath(receiptPath, scope, identity);
  try {
    if ((await snapshotOutputIdentity(snapshotPath)) !== artifactSha256) {
      return false;
    }
  } catch (error) {
    if (
      error.code === "ENOENT" ||
      error.message === "Release build output must not contain symbolic links."
    ) {
      return false;
    }
    throw error;
  }

  const restoreRoot = path.join(
    webRoot,
    `.openmeld-artifact-restore-${randomUUID()}`
  );
  const stagedDist = path.join(restoreRoot, "staged-dist");
  const stagedDeploy = path.join(restoreRoot, "staged-deploy");
  const previousDist = path.join(restoreRoot, "previous-dist");
  const previousDeploy = path.join(restoreRoot, "previous-deploy");
  const dist = path.join(webRoot, "dist");
  const deploy = path.join(webRoot, ".wrangler/deploy");
  let backedUpDist = false;
  let backedUpDeploy = false;
  let installedDist = false;
  let installedDeploy = false;
  await mkdir(restoreRoot, { recursive: true });
  try {
    await cp(path.join(snapshotPath, "dist"), stagedDist, { recursive: true });
    await cp(path.join(snapshotPath, "deploy"), stagedDeploy, {
      recursive: true,
    });
    if (
      (await artifactFilesIdentity(
        stagedDist,
        path.join(stagedDeploy, "config.json")
      )) !== artifactSha256
    ) {
      return false;
    }
    if (await pathExists(dist)) {
      await rename(dist, previousDist);
      backedUpDist = true;
    }
    if (await pathExists(deploy)) {
      await rename(deploy, previousDeploy);
      backedUpDeploy = true;
    }
    await rename(stagedDist, dist);
    installedDist = true;
    await mkdir(path.dirname(deploy), { recursive: true });
    await rename(stagedDeploy, deploy);
    installedDeploy = true;
    if ((await artifactOutputIdentity(webRoot)) !== artifactSha256) {
      throw new Error("Restored artifact does not match its verified receipt.");
    }
    return true;
  } catch (error) {
    if (installedDist) {
      await rm(dist, { force: true, recursive: true });
    }
    if (installedDeploy) {
      await rm(deploy, { force: true, recursive: true });
    }
    if (backedUpDist) {
      await rename(previousDist, dist);
    }
    if (backedUpDeploy) {
      await rename(previousDeploy, deploy);
    }
    throw error;
  } finally {
    await rm(restoreRoot, { force: true, recursive: true });
  }
}

export async function reusableArtifact({
  receiptPath,
  webRoot,
  scope,
  sourceSha,
  identity,
  allowDirty,
}) {
  try {
    const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
    if (
      receipt.scope === scope &&
      receipt.sourceSha === sourceSha &&
      receipt.inputIdentity === identity &&
      SHA256.test(receipt.artifactSha256) &&
      receipt.allowDirty === allowDirty &&
      (await restoreArtifactSnapshot({
        receiptPath,
        webRoot,
        scope,
        identity,
        artifactSha256: receipt.artifactSha256,
      }))
    ) {
      return { ...receipt, reused: true };
    }
  } catch (error) {
    if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) {
      throw error;
    }
  }
  return null;
}

export async function checkProductionArtifact({
  root = repositoryRoot(),
  scope,
  sourceSha,
  allowDirty = false,
}) {
  if (!["web", "desktop"].includes(scope)) {
    throw new Error("Choose --scope web or desktop.");
  }
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  sourceSha ??= head;
  if (sourceSha !== head) {
    throw new Error("Artifact source must be the checked-out release SHA.");
  }
  const dirty = execFileSync("git", ["status", "--porcelain"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  if (dirty && !allowDirty) {
    throw new Error("Artifact admission requires a clean source checkout.");
  }
  // Vite preview may set NODE_ENV while loading its own configuration. Preserve
  // the caller's actual build inputs instead of hashing preview side effects.
  const buildInputs = { ...process.env };
  const identity = await artifactInputIdentity(
    root,
    scope,
    sourceSha,
    buildInputs
  );
  const webRoot = path.join(root, "clients/web");
  const output = path.join(webRoot, "dist");
  const receiptPath = path.join(
    root,
    "dev-tmp/release-artifact-check",
    `${scope}.json`
  );
  const reusable = await reusableArtifact({
    receiptPath,
    webRoot,
    scope,
    sourceSha,
    identity,
    allowDirty,
  });
  if (reusable) {
    return reusable;
  }
  const env = productionBuildEnvironment(scope, buildInputs);
  // Anonymous local SSR needs the cookie module to initialize, not a real
  // production signing key. Production secret readiness has its own guard.
  env.WEB_OPENMELD_SPACE_ACCESS_COOKIE_SECRET = randomBytes(32).toString("hex");
  if (scope === "desktop") {
    await buildProductionRenderer(root, env);
  } else if (
    (await runOwnedCommand(
      "pnpm",
      ["--dir", "clients/web", "run", "build:prod"],
      { cwd: root, env }
    )) !== 0
  ) {
    throw new Error("Production Web build failed.");
  }

  // Vite's Cloudflare preview consumes the generated output configuration and
  // runs that bundle in local Workerd, including SSR imports and asset modules.
  const require = createRequire(path.join(webRoot, "package.json"));
  const { preview } = await import(pathToFileURL(require.resolve("vite")).href);
  const priorPreviewMode = process.env.OPENMELD_RELEASE_ARTIFACT_CHECK;
  const priorCookieSecret = process.env.WEB_OPENMELD_SPACE_ACCESS_COOKIE_SECRET;
  process.env.OPENMELD_RELEASE_ARTIFACT_CHECK = "1";
  process.env.WEB_OPENMELD_SPACE_ACCESS_COOKIE_SECRET =
    env.WEB_OPENMELD_SPACE_ACCESS_COOKIE_SECRET;
  let server;
  let ssr;
  try {
    server = await preview({
      root: webRoot,
      mode: "production",
      preview: { host: "127.0.0.1", port: 0, open: false },
    });
    const address = server.httpServer.address();
    if (!address || typeof address === "string") {
      throw new Error("Workerd preview did not open a local listener.");
    }
    ssr = await checkProductionWeb({
      url: `http://127.0.0.1:${address.port}`,
      sourceSha,
      allowDirty,
    });
    if (scope === "desktop") {
      const marker = JSON.parse(
        await readFile(path.join(output, "client/desktop-build.json"), "utf8")
      );
      if (
        marker.webBuild !== desktopWebBuildIdentity(root) ||
        marker.installedTarget?.kind !== "production"
      ) {
        throw new Error(
          "Desktop renderer identity or production target is incorrect."
        );
      }
      validateSsrPage({
        status: 200,
        contentType: "text/html",
        html: await readFile(path.join(output, "client/_shell.html"), "utf8"),
        sourceSha,
        allowDirty,
      });
    }
  } finally {
    await server?.close();
    if (priorPreviewMode === undefined) {
      Reflect.deleteProperty(process.env, "OPENMELD_RELEASE_ARTIFACT_CHECK");
    } else {
      process.env.OPENMELD_RELEASE_ARTIFACT_CHECK = priorPreviewMode;
    }
    if (priorCookieSecret === undefined) {
      Reflect.deleteProperty(
        process.env,
        "WEB_OPENMELD_SPACE_ACCESS_COOKIE_SECRET"
      );
    } else {
      process.env.WEB_OPENMELD_SPACE_ACCESS_COOKIE_SECRET = priorCookieSecret;
    }
  }
  if (
    (await artifactInputIdentity(root, scope, sourceSha, buildInputs)) !==
    identity
  ) {
    throw new Error(
      "Build inputs changed during artifact verification; no evidence was saved."
    );
  }
  assertArtifactCheckout(root, sourceSha, allowDirty);
  const artifactSha256 = await artifactOutputIdentity(webRoot);
  const receipt = {
    scope,
    sourceSha,
    inputIdentity: identity,
    artifactSha256,
    ssr,
    allowDirty,
    runtime: "local-workerd-disposable-cookie-key",
    verifiedAt: new Date().toISOString(),
  };
  await mkdir(path.dirname(receiptPath), { recursive: true });
  await saveArtifactSnapshot({
    receiptPath,
    webRoot,
    scope,
    identity,
    artifactSha256,
  });
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}

export function assertArtifactCheckout(root, sourceSha, allowDirty = false) {
  const read = (args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  if (
    read(["rev-parse", "HEAD"]) !== sourceSha ||
    (!allowDirty && read(["status", "--porcelain"]))
  ) {
    throw new Error(
      "Source checkout changed during artifact verification; no evidence was saved."
    );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const { values } = parseArgs({
    options: {
      scope: { type: "string" },
      "source-sha": { type: "string" },
      "allow-dirty": { type: "boolean", default: false },
    },
  });
  console.log(
    JSON.stringify(
      await checkProductionArtifact({
        scope: values.scope,
        sourceSha: values["source-sha"],
        allowDirty: values["allow-dirty"],
      })
    )
  );
}
