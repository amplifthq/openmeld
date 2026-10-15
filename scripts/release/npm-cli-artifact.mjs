import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
const CACHE_SCHEMA_VERSION = 2;
const NATIVE_COMPILATION_OUTPUT =
  /\bgyp (?:info|ERR!|verb)|No prebuilt binaries found|\b(?:CC|CXX|SOLINK_MODULE)\(target\)/u;
const BUILD_ENVIRONMENT_KEY =
  /^(?:cc|cflags|cxx|cxxflags|ldflags|macosx_deployment_target|node_options|npm_config_arch|npm_config_target_arch|sdkroot)$/iu;

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
      if (name.startsWith("@openmeld/")) {
        throw new Error(
          `The npm package has a non-portable ${field}.${name}. Internal OpenMeld packages must be bundled into the CLI.`
        );
      }
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
  let invocation = { bin: command, args };
  if (process.platform === "win32" && command === "npm") {
    // setup-node's Windows distribution includes npm beside node.exe. Invoke
    // its JS entry directly so a clean consumer needs no workspace build.
    invocation = {
      bin: process.execPath,
      args: [
        join(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"),
        ...args,
      ],
    };
  } else if (process.platform === "win32" && command === "pnpm") {
    invocation = (
      await import("../../runtime/adapters/core/dist/process-launch.js")
    ).resolvePlatformCommand(command, args, env);
  }
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
  options.inspectOutput?.(`${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}

export function assertNoNativeCompilation(output) {
  // Lifecycle command text can contain "prebuild-install || node-gyp rebuild"
  // even when a prebuild succeeds. Reject evidence of the fallback actually
  // running, including an optional dependency whose compilation failure npm hides.
  if (NATIVE_COMPILATION_OUTPUT.test(output)) {
    throw new Error(
      `npm consumer installation fell back to native compilation:\n${output}`
    );
  }
}

export async function readNpmCliArtifact(artifactPath) {
  const manifest = JSON.parse(
    await run("tar", ["-xOf", artifactPath, "package/package.json"])
  );
  const files = (await run("tar", ["-tf", artifactPath])).split(LINE_BREAK);
  return {
    manifest,
    files,
    integrity: `sha512-${createHash("sha512").update(readFileSync(artifactPath)).digest("base64")}`,
  };
}

export async function inspectNpmCliArtifact(artifactPath, expected = {}) {
  const { manifest, files, integrity } = await readNpmCliArtifact(artifactPath);
  assertNpmRuntimeDependencies(manifest);
  if (
    manifest.name !== "openmeld" ||
    manifest.bin?.openmeld !== "dist/openmeld.js" ||
    !manifest.dependencies
  ) {
    throw new Error("The npm artifact is not the OpenMeld CLI package.");
  }
  for (const path of [
    "package/README.md",
    "package/dist/openmeld.js",
    "package/dist/windows/openmeld-windows-process.exe",
  ]) {
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
    integrity,
  };
}

export function verifyPreparedNpmCliArtifact(input) {
  if (
    !(
      input?.path &&
      SHA512_INTEGRITY.test(input.integrity ?? "") &&
      isRegularFile(input.path)
    )
  ) {
    throw new Error("npm publication requires a verified CLI tarball.");
  }
  const integrity = `sha512-${createHash("sha512").update(readFileSync(input.path)).digest("base64")}`;
  if (integrity !== input.integrity) {
    throw new Error(
      "The prepared npm tarball changed after consumer verification; refusing publication."
    );
  }
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
        "--foreground-scripts",
        "--no-audit",
        "--no-fund",
        "--workspaces=false",
      ],
      {
        cwd: root,
        env,
        timeout: 300_000,
        inspectOutput: assertNoNativeCompilation,
      }
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

export async function prepareNpmCliArtifact(input = {}, dependencies = {}) {
  return await prepareCachedNpmCliArtifact(input, dependencies);
}

export async function admitNpmCliArtifact(input = {}, dependencies = {}) {
  return await prepareCachedNpmCliArtifact(input, {
    ...dependencies,
    runReleaseReady:
      dependencies.runReleaseReady ??
      (async ({ cwd, env }) => {
        await run("pnpm", ["run", "verify:release-ready", "--", "--force"], {
          cwd,
          env,
          timeout: 600_000,
        });
      }),
  });
}

async function prepareCachedNpmCliArtifact(input = {}, dependencies = {}) {
  const cwd = input.cwd ?? REPO_ROOT;
  const env = input.env ?? process.env;
  const sourceSha = await readExactCleanSource({
    cwd,
    env,
    expectedSourceSha: input.sourceSha,
  });
  const runtime = await resolveToolRuntime({ cwd, env }, dependencies);
  const buildInputs = hashBuildInputs({ env, runtime, sourceSha });
  const cache = resolveNpmArtifactCache({ cwd, buildInputs });
  const expected = readExpectedNpmArtifact({ cwd, sourceSha });
  const cached = await readCachedNpmCliArtifact(
    { cache, expected, runtime, sourceSha },
    dependencies
  );
  if (cached) {
    return cached;
  }

  await dependencies.runReleaseReady?.({ cwd, env, sourceSha });
  const postBuildSourceSha = await readExactCleanSource({
    cwd,
    env,
    expectedSourceSha: sourceSha,
  });
  if (postBuildSourceSha !== sourceSha) {
    throw new Error("CLI artifact build changed the exact release source.");
  }

  const packArtifact = dependencies.packArtifact ?? packNpmCliArtifact;
  const verifyConsumer = dependencies.verifyConsumer ?? verifyNpmCliConsumer;
  const artifact = await packArtifact({ cwd, env });
  try {
    await verifyConsumer(artifact.path, artifact.manifest, env);
    await readExactCleanSource({
      cwd,
      env,
      expectedSourceSha: sourceSha,
    });
    const inspected = await (
      dependencies.inspectArtifact ?? inspectNpmCliArtifact
    )(artifact.path, expected);
    mkdirSync(cache.directory, { recursive: true });
    const temporaryArtifact = `${cache.artifactPath}.${process.pid}.tmp`;
    copyFileSync(artifact.path, temporaryArtifact);
    renameSync(temporaryArtifact, cache.artifactPath);
    const cachedResult = await (
      dependencies.inspectArtifact ?? inspectNpmCliArtifact
    )(cache.artifactPath, expected);
    if (
      cachedResult.integrity !== inspected.integrity ||
      cachedResult.integrity !== artifact.integrity
    ) {
      throw new Error("Cached npm artifact bytes changed during handoff.");
    }
    writeJsonAtomically(cache.receiptPath, {
      artifactIntegrity: cachedResult.integrity,
      buildInputs,
      manifest: {
        gitHead: cachedResult.manifest.gitHead,
        minRequiredCliVersion:
          cachedResult.manifest.openmeld?.minRequiredCliVersion,
        name: cachedResult.manifest.name,
        version: cachedResult.manifest.version,
      },
      runtime,
      schemaVersion: CACHE_SCHEMA_VERSION,
      sourceSha,
    });
    return persistentArtifact(cache.artifactPath, cachedResult);
  } catch (error) {
    rmSync(cache.directory, { recursive: true, force: true, maxRetries: 3 });
    throw error;
  } finally {
    artifact.cleanup();
  }
}

async function readExactCleanSource(input) {
  const sourceSha = await run(
    "git",
    ["rev-parse", "--verify", "HEAD^{commit}"],
    {
      cwd: input.cwd,
      env: input.env,
    }
  );
  if (!SOURCE_SHA.test(sourceSha)) {
    throw new Error("CLI artifact admission requires an exact source commit.");
  }
  if (input.expectedSourceSha && sourceSha !== input.expectedSourceSha) {
    throw new Error("CLI artifact source does not match the release train.");
  }
  const status = await run(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=normal"],
    { cwd: input.cwd, env: input.env }
  );
  if (status) {
    throw new Error("CLI artifact admission requires a clean worktree.");
  }
  return sourceSha;
}

async function resolveToolRuntime(input, dependencies) {
  if (dependencies.readToolRuntime) {
    return await dependencies.readToolRuntime(input);
  }
  return {
    arch: process.arch,
    ...(process.platform === "darwin"
      ? {
          compiler: await run("xcrun", ["clang", "--version"], input),
          sdk: await run("xcrun", ["--show-sdk-version"], input),
        }
      : {}),
    node: process.version,
    npm: await run("npm", ["--version"], input),
    platform: process.platform,
    pnpm: await run("pnpm", ["--version"], input),
  };
}

function hashBuildInputs(input) {
  const environment = Object.fromEntries(
    Object.entries(input.env)
      .filter(([key]) => BUILD_ENVIRONMENT_KEY.test(key))
      .sort(([left], [right]) => left.localeCompare(right))
  );
  return createHash("sha256")
    .update(
      JSON.stringify({
        environment,
        runtime: input.runtime,
        sourceSha: input.sourceSha,
      })
    )
    .digest("hex");
}

function resolveNpmArtifactCache(input) {
  const directory = join(
    input.cwd,
    "dev-tmp/release-artifact-check/artifacts/cli",
    input.buildInputs
  );
  return {
    artifactPath: join(directory, "openmeld.tgz"),
    buildInputs: input.buildInputs,
    directory,
    receiptPath: join(directory, "receipt.json"),
  };
}

function readExpectedNpmArtifact(input) {
  const source = JSON.parse(
    readFileSync(join(input.cwd, "clients/openmeld-cli/package.json"), "utf8")
  );
  return {
    gitHead: input.sourceSha,
    minRequiredCliVersion: source.openmeld?.minRequiredCliVersion,
    version: source.version,
  };
}

async function readCachedNpmCliArtifact(input, dependencies) {
  if (
    !(
      isRegularFile(input.cache.receiptPath) &&
      isRegularFile(input.cache.artifactPath)
    )
  ) {
    return null;
  }
  try {
    const receipt = JSON.parse(readFileSync(input.cache.receiptPath, "utf8"));
    if (
      receipt.schemaVersion !== CACHE_SCHEMA_VERSION ||
      receipt.buildInputs !== input.cache.buildInputs ||
      receipt.sourceSha !== input.sourceSha ||
      JSON.stringify(receipt.runtime) !== JSON.stringify(input.runtime)
    ) {
      return null;
    }
    const result = await (
      dependencies.inspectArtifact ?? inspectNpmCliArtifact
    )(input.cache.artifactPath, input.expected);
    if (
      receipt.artifactIntegrity !== result.integrity ||
      receipt.manifest?.name !== result.manifest.name ||
      receipt.manifest?.version !== result.manifest.version ||
      receipt.manifest?.gitHead !== result.manifest.gitHead ||
      receipt.manifest?.minRequiredCliVersion !==
        result.manifest.openmeld?.minRequiredCliVersion
    ) {
      return null;
    }
    return persistentArtifact(input.cache.artifactPath, result);
  } catch {
    rmSync(input.cache.directory, {
      recursive: true,
      force: true,
      maxRetries: 3,
    });
    return null;
  }
}

function isRegularFile(path) {
  return existsSync(path) && lstatSync(path).isFile();
}

function persistentArtifact(path, result) {
  return { ...result, path, cleanup: () => undefined };
}

function writeJsonAtomically(path, value) {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  renameSync(temporaryPath, path);
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
