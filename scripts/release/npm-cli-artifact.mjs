import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const LOCAL_DEPENDENCY = /^(?:catalog|workspace|file|link):/iu;
const RUNTIME_DEPENDENCY_FIELDS = [
  "dependencies",
  "optionalDependencies",
  "peerDependencies",
];
const VERSION_PREFIX = /^v/u;
const CONSUMER_ENVIRONMENT_KEY =
  /^(?:path|pathext|systemroot|windir|comspec|temp|tmp|tmpdir|lang|lc_.*|https?_proxy|all_proxy|no_proxy|node_extra_ca_certs)$/iu;
const LINE_BREAK = /\r?\n/u;
const SOURCE_SHA = /^[a-f0-9]{40}$/u;
const SHA512_INTEGRITY = /^sha512-[A-Za-z0-9+/]{86}==$/u;

export function assertNpmRuntimeDependencies(manifest) {
  for (const field of RUNTIME_DEPENDENCY_FIELDS) {
    const dependencies = manifest[field];
    if (dependencies === undefined) {
      continue;
    }
    if (
      !dependencies ||
      typeof dependencies !== "object" ||
      Array.isArray(dependencies)
    ) {
      throw new Error(`The npm package has invalid ${field}.`);
    }
    for (const [name, specifier] of Object.entries(dependencies)) {
      if (
        typeof specifier !== "string" ||
        !specifier.trim() ||
        LOCAL_DEPENDENCY.test(specifier.trim())
      ) {
        throw new Error(
          `The npm package has a non-portable ${field}.${name}: ${String(specifier)}. Pack workspace references before publication.`
        );
      }
    }
  }
}

async function run(command, args, options = {}) {
  const env = options.env ?? process.env;
  const invocation =
    process.platform === "win32"
      ? (
          await import("../../runtime/adapters/core/dist/process-launch.js")
        ).resolvePlatformCommand(command, args, env)
      : { bin: command, args };
  const result = spawnSync(invocation.bin, invocation.args, {
    cwd: options.cwd,
    env,
    windowsVerbatimArguments: invocation.windowsVerbatimArguments,
    windowsHide: true,
    encoding: "utf8",
    timeout: options.timeout ?? 60_000,
    maxBuffer: 8 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `${command} failed (${result.status ?? "not completed"}): ${result.error?.message ?? result.stderr?.trim() ?? "unknown error"}`
    );
  }
  return result.stdout.trim();
}

export async function inspectNpmCliArtifact(artifactPath, expected = {}) {
  const manifest = JSON.parse(
    await run("tar", ["-xOf", artifactPath, "package/package.json"])
  );
  const files = (await run("tar", ["-tf", artifactPath])).split(LINE_BREAK);
  assertNpmRuntimeDependencies(manifest);
  if (
    manifest.name !== "openmeld" ||
    manifest.bin?.openmeld !== "dist/openmeld.js" ||
    !manifest.dependencies
  ) {
    throw new Error("The npm artifact is not the OpenMeld CLI package.");
  }
  for (const path of ["package/README.md", "package/dist/openmeld.js"]) {
    if (!files.includes(path)) {
      throw new Error(
        `The npm artifact is missing ${path}. Build the packaged CLI before packing.`
      );
    }
  }
  if (files.some((path) => path.startsWith("package/dist/binary/"))) {
    throw new Error(
      "CLI binary artifacts must not be included in the npm package."
    );
  }
  for (const field of ["version", "gitHead"]) {
    if (expected[field] !== undefined && manifest[field] !== expected[field]) {
      throw new Error(
        `The npm artifact ${field} does not match the release source.`
      );
    }
  }
  if (
    expected.minRequiredCliVersion !== undefined &&
    manifest.openmeld?.minRequiredCliVersion !== expected.minRequiredCliVersion
  ) {
    throw new Error(
      "The npm artifact required CLI floor does not match the release source."
    );
  }
  return {
    manifest,
    integrity: `sha512-${createHash("sha512").update(readFileSync(artifactPath)).digest("base64")}`,
  };
}

function consumerEnvironment(root, source) {
  // Keep platform and network trust settings, not npm auth/config, Node injection,
  // or a developer's OpenMeld lane. The consumer lives outside the workspace.
  const env = Object.fromEntries(
    Object.entries(source).filter(([key]) => CONSUMER_ENVIRONMENT_KEY.test(key))
  );
  for (const file of ["user.npmrc", "global.npmrc"]) {
    writeFileSync(join(root, file), "");
  }
  return {
    ...env,
    HOME: root,
    USERPROFILE: root,
    OPENMELD_HOME: join(root, "openmeld-home"),
    NPM_CONFIG_USERCONFIG: join(root, "user.npmrc"),
    NPM_CONFIG_GLOBALCONFIG: join(root, "global.npmrc"),
    NPM_CONFIG_CACHE: join(root, "cache"),
    NPM_CONFIG_PREFIX: join(root, "prefix"),
  };
}

export async function verifyNpmCliConsumer(
  artifactPath,
  manifest,
  sourceEnv = process.env
) {
  const root = mkdtempSync(join(tmpdir(), "openmeld-npm-consumer-"));
  try {
    const env = consumerEnvironment(root, sourceEnv);
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({
        name: "openmeld-consumer-check",
        version: "1.0.0",
        private: true,
      })
    );
    await run(
      "npm",
      [
        "install",
        artifactPath,
        "--registry=https://registry.npmjs.org/",
        "--ignore-scripts=false",
        "--no-audit",
        "--no-fund",
        "--workspaces=false",
      ],
      { cwd: root, env, timeout: 300_000 }
    );
    const entry = join(root, "node_modules/openmeld/dist/openmeld.js");
    const version = await run(process.execPath, [entry, "--version"], {
      cwd: root,
      env,
    });
    if (version.replace(VERSION_PREFIX, "") !== manifest.version) {
      throw new Error(
        `Installed CLI reported ${version}, expected ${manifest.version}.`
      );
    }
    if (manifest.dependencies["better-sqlite3"]) {
      await run(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          "import{createRequire}from'node:module';const require=createRequire(process.argv[1]);const Database=require('better-sqlite3');const db=new Database(':memory:');db.prepare('select 1').get();db.close();",
          entry,
        ],
        { cwd: root, env }
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  }
}

export async function packNpmCliArtifact(input = {}) {
  const cwd = input.cwd ?? REPO_ROOT;
  const env = input.env ?? process.env;
  const root = mkdtempSync(join(tmpdir(), "openmeld-npm-artifact-"));
  const artifactPath = join(root, "openmeld.tgz");
  const cleanup = () =>
    rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  try {
    const gitHead = await run("git", ["rev-parse", "HEAD"], { cwd, env });
    if (!SOURCE_SHA.test(gitHead)) {
      throw new Error("CLI packing requires an exact source commit.");
    }
    const source = JSON.parse(
      readFileSync(join(cwd, "clients/openmeld-cli/package.json"), "utf8")
    );
    // The owning release gate builds and verifies first. Do not recursively run
    // prepack, rebuild after verification, or let npm preserve catalog: values.
    await run(
      "pnpm",
      [
        "--config.ignore-scripts=true",
        `--config.pnpmfile=${join(REPO_ROOT, "scripts/release/npm-cli-pack.cjs")}`,
        "pack",
        "--out",
        artifactPath,
      ],
      {
        cwd: join(cwd, "clients/openmeld-cli"),
        env: { ...env, OPENMELD_NPM_PACK_GIT_HEAD: gitHead },
      }
    );
    const result = await inspectNpmCliArtifact(artifactPath, {
      version: source.version,
      gitHead,
      minRequiredCliVersion: source.openmeld?.minRequiredCliVersion,
    });
    return { ...result, path: artifactPath, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}

export async function prepareNpmCliArtifact(input = {}) {
  const artifact = await packNpmCliArtifact(input);
  try {
    await verifyNpmCliConsumer(artifact.path, artifact.manifest, input.env);
    return artifact;
  } catch (error) {
    artifact.cleanup();
    throw error;
  }
}

export async function verifyPublishedNpmCliArtifact(input) {
  const { metadata, target } = input;
  if (!SHA512_INTEGRITY.test(metadata.dist?.integrity ?? "")) {
    throw new Error(
      "Published npm metadata is missing SHA-512 artifact integrity."
    );
  }
  const url = new URL(metadata.dist.tarball);
  if (
    url.origin !== "https://registry.npmjs.org" ||
    !url.pathname.startsWith("/openmeld/-/")
  ) {
    throw new Error(
      "Published CLI tarball is not on the official npm registry."
    );
  }
  const response = await (input.fetch ?? fetch)(url, {
    signal: AbortSignal.timeout(60_000),
    redirect: "error",
  });
  if (!response.ok) {
    throw new Error(
      `Published CLI tarball download failed: HTTP ${response.status}.`
    );
  }
  const root = mkdtempSync(join(tmpdir(), "openmeld-published-npm-"));
  try {
    const artifactPath = join(root, "openmeld.tgz");
    writeFileSync(artifactPath, Buffer.from(await response.arrayBuffer()));
    const result = await inspectNpmCliArtifact(artifactPath, {
      version: target.version,
      gitHead: target.headSha,
      minRequiredCliVersion: target.minRequiredCliVersion,
    });
    if (
      result.integrity !== metadata.dist.integrity ||
      (target.npmIntegrity && result.integrity !== target.npmIntegrity)
    ) {
      throw new Error(
        "Published CLI bytes do not match the verified npm artifact."
      );
    }
    // A resumed release has no in-process prepublication consumer proof.
    if (!target.npmIntegrity) {
      await verifyNpmCliConsumer(artifactPath, result.manifest, input.env);
    }
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const artifact = await prepareNpmCliArtifact();
    try {
      console.log(
        `npm consumer verified: openmeld@${artifact.manifest.version} ${artifact.integrity}`
      );
    } finally {
      artifact.cleanup();
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
