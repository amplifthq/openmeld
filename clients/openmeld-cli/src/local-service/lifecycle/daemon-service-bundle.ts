import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  cp,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { readDaemonRuntimeLease } from "../../config/daemon-runtime-lease";
import { readDaemonServiceContract } from "../../config/daemon-service-contract";
import { readDaemonServiceUpdateWorkerProtectedBundleIds } from "../../config/daemon-service-update-worker-registration";
import {
  daemonRuntimeBundlesPath,
  daemonRuntimeRootPath,
  daemonRuntimeServiceManagerPath,
  daemonRuntimeStateRootPath,
  daemonServiceActiveBundleStatePath,
  daemonServiceLegacyExecutableWrapperPath,
  daemonServiceStableBinaryExecutablePath,
  daemonServiceStableExecutableWrapperPath,
  daemonServiceStableLauncherPath,
  daemonServiceUpdateWorkerBinaryExecutablePath,
  daemonStatePath,
  getDaemonStatus,
  daemonServiceExecutableWrapperPaths as resolveDaemonServiceExecutableWrapperPaths,
  daemonServiceRecognizedExecutablePaths as resolveDaemonServiceRecognizedExecutablePaths,
} from "../../config/daemon-state";
import {
  type OpenMeldPathResolutionInput,
  resolveOpenMeldEnvPreset,
} from "../../config/paths";
import { resolveBundledServiceRelease } from "../../config/service-release";
import type { CliBinaryReleaseInfo } from "../../config/version-state";
import {
  performManagedInstall,
  resolveCliSelfVersion,
} from "../../local-components/managed-install";
import {
  DEFAULT_CLI_BINARY_DOWNLOAD_POLICY,
  downloadCliBinaryUpdateArtifact,
  resolveCliBinaryUpdatePlan,
  verifyCliBinaryCodeSignature,
} from "../../runtime/cli-binary-update-artifact";
import {
  isBinaryDistribution,
  type OpenMeldDistribution,
  resolveOpenMeldDistribution,
} from "../../runtime/distribution";
import {
  classifyDiagnosticPath,
  collectLocalOperationFailure,
} from "../../system/local-operation-diagnostics";
import { emitDaemonLifecycleEvent } from "./daemon-lifecycle-journal";
import { resolveDaemonServiceArtifact } from "./daemon-service-artifact";
import { readPendingDaemonServiceUpdate } from "./daemon-service-update-state";

const DAEMON_ACTIVE_BUNDLE_SCHEMA = "openmeld-daemon-active-bundle-v2";
const DAEMON_ACTIVE_BUNDLE_LEGACY_SCHEMA = "openmeld-daemon-active-bundle-v1";
const DAEMON_CLI_ENTRY_NAMES = ["openmeld-dev.js", "openmeld.js"] as const;
const DAEMON_BUNDLE_SOURCE_KIND_WORKSPACE = "workspace";
const DAEMON_BUNDLE_SOURCE_KIND_PACKAGE_INSTALL = "package_install";
const DAEMON_BUNDLE_SOURCE_KIND_NPX_CACHE = "npx_cache";
const DAEMON_BUNDLE_SOURCE_KIND_UNKNOWN = "unknown";
// The npm Service bundle copies the platform-neutral JavaScript runtime only.
// CLI binary and native secure-storage artifacts are verified and released by
// the CLI artifact lane; the Service does not load them.
const DAEMON_SOURCE_DIST_IGNORED_TOP_LEVEL_DIRS = new Set(["binary", "native"]);

export type DaemonBundleFormat =
  | "legacy_linked_v1"
  | "self_contained_v1"
  | "binary_v1";
export type DaemonBundleSourceKind =
  | typeof DAEMON_BUNDLE_SOURCE_KIND_WORKSPACE
  | typeof DAEMON_BUNDLE_SOURCE_KIND_PACKAGE_INSTALL
  | typeof DAEMON_BUNDLE_SOURCE_KIND_NPX_CACHE
  | typeof DAEMON_BUNDLE_SOURCE_KIND_UNKNOWN;

export type DaemonActiveBundleState = {
  v: 2;
  schema: typeof DAEMON_ACTIVE_BUNDLE_SCHEMA;
  bundleId: string;
  daemonVersion: string;
  entryScriptRelativePath: string;
  bundleFormat: DaemonBundleFormat;
  sourceEntryScriptPath: string;
  sourcePackageRootPath: string;
  sourceDistRootPath: string;
  sourceDistFingerprint?: string | null;
  sourceKind: DaemonBundleSourceKind;
  createdAt: string;
  updatedAt: string;
};

export function daemonServiceActiveBundlePath(
  pathInput: OpenMeldPathResolutionInput = {}
): string {
  return daemonServiceActiveBundleStatePath(pathInput);
}

export function daemonServiceLauncherPath(
  pathInput: OpenMeldPathResolutionInput = {}
): string {
  return daemonServiceStableLauncherPath(pathInput);
}

export function daemonServiceExecutableWrapperPath(
  pathInput: OpenMeldPathResolutionInput = {}
): string {
  return daemonServiceStableExecutableWrapperPath(pathInput);
}

export function daemonServiceBinaryExecutablePath(
  pathInput: OpenMeldPathResolutionInput = {}
): string {
  return daemonServiceStableBinaryExecutablePath(pathInput);
}

export function daemonServiceUpdateWorkerBinaryPath(
  pathInput: OpenMeldPathResolutionInput = {}
): string {
  return daemonServiceUpdateWorkerBinaryExecutablePath(pathInput);
}

export function daemonServiceExecutableWrapperPaths(
  pathInput: OpenMeldPathResolutionInput = {}
): string[] {
  return resolveDaemonServiceExecutableWrapperPaths(pathInput);
}

export function daemonServiceRecognizedExecutablePaths(
  pathInput: OpenMeldPathResolutionInput = {}
): string[] {
  return resolveDaemonServiceRecognizedExecutablePaths(pathInput);
}

export function daemonServiceLegacyWrapperPath(
  pathInput: OpenMeldPathResolutionInput = {}
): string {
  return daemonServiceLegacyExecutableWrapperPath(pathInput);
}

export function resolveDaemonBundleRootPath(
  bundleId: string,
  pathInput: OpenMeldPathResolutionInput = {}
): string {
  return join(daemonRuntimeBundlesPath(pathInput), bundleId);
}

export function isDaemonBundleSourceAllowedForLane(input: {
  sourceKind: DaemonBundleSourceKind;
  pathInput?: OpenMeldPathResolutionInput;
}): boolean {
  if (input.sourceKind !== DAEMON_BUNDLE_SOURCE_KIND_WORKSPACE) {
    return true;
  }
  return resolveOpenMeldEnvPreset(input.pathInput) === "dev-local";
}

export async function readDaemonActiveBundleState(
  pathInput: OpenMeldPathResolutionInput = {}
): Promise<DaemonActiveBundleState | null> {
  const raw = await readFile(
    daemonServiceActiveBundlePath(pathInput),
    "utf8"
  ).catch((error) => {
    if (getErrorCode(error) === "ENOENT") {
      return null;
    }
    throw error;
  });
  if (raw === null) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<DaemonActiveBundleState>;
    if (parsed.v === 2 && parsed.schema === DAEMON_ACTIVE_BUNDLE_SCHEMA) {
      if (
        typeof parsed.bundleId !== "string" ||
        parsed.bundleId.length === 0 ||
        typeof parsed.daemonVersion !== "string" ||
        parsed.daemonVersion.length === 0 ||
        typeof parsed.entryScriptRelativePath !== "string" ||
        parsed.entryScriptRelativePath.length === 0 ||
        !isDaemonBundleFormat(parsed.bundleFormat) ||
        typeof parsed.sourceEntryScriptPath !== "string" ||
        parsed.sourceEntryScriptPath.length === 0 ||
        typeof parsed.sourcePackageRootPath !== "string" ||
        parsed.sourcePackageRootPath.length === 0 ||
        typeof parsed.sourceDistRootPath !== "string" ||
        parsed.sourceDistRootPath.length === 0 ||
        !isDaemonBundleSourceKind(parsed.sourceKind) ||
        typeof parsed.createdAt !== "string" ||
        parsed.createdAt.length === 0 ||
        typeof parsed.updatedAt !== "string" ||
        parsed.updatedAt.length === 0
      ) {
        return null;
      }
      return {
        v: 2,
        schema: DAEMON_ACTIVE_BUNDLE_SCHEMA,
        bundleId: parsed.bundleId,
        daemonVersion: parsed.daemonVersion,
        entryScriptRelativePath: parsed.entryScriptRelativePath,
        bundleFormat: parsed.bundleFormat,
        sourceEntryScriptPath: parsed.sourceEntryScriptPath,
        sourcePackageRootPath: parsed.sourcePackageRootPath,
        sourceDistRootPath: parsed.sourceDistRootPath,
        sourceDistFingerprint: normalizeOptionalText(
          parsed.sourceDistFingerprint
        ),
        sourceKind: parsed.sourceKind,
        createdAt: parsed.createdAt,
        updatedAt: parsed.updatedAt,
      };
    }

    const legacyParsed = parsed as Partial<{
      v: 1;
      schema: string;
      bundleId: string;
      daemonVersion: string;
      entryScriptRelativePath: string;
      sourceDistRootPath: string;
      createdAt: string;
      updatedAt: string;
    }>;
    if (
      legacyParsed.v !== 1 ||
      legacyParsed.schema !== DAEMON_ACTIVE_BUNDLE_LEGACY_SCHEMA ||
      typeof legacyParsed.bundleId !== "string" ||
      legacyParsed.bundleId.length === 0 ||
      typeof legacyParsed.daemonVersion !== "string" ||
      legacyParsed.daemonVersion.length === 0 ||
      typeof legacyParsed.entryScriptRelativePath !== "string" ||
      legacyParsed.entryScriptRelativePath.length === 0 ||
      typeof legacyParsed.sourceDistRootPath !== "string" ||
      legacyParsed.sourceDistRootPath.length === 0 ||
      typeof legacyParsed.createdAt !== "string" ||
      legacyParsed.createdAt.length === 0 ||
      typeof legacyParsed.updatedAt !== "string" ||
      legacyParsed.updatedAt.length === 0
    ) {
      return null;
    }
    const sourceEntryScriptPath = join(
      legacyParsed.sourceDistRootPath,
      basename(legacyParsed.entryScriptRelativePath)
    );
    const sourcePackageRootPath = dirname(legacyParsed.sourceDistRootPath);
    return {
      v: 2,
      schema: DAEMON_ACTIVE_BUNDLE_SCHEMA,
      bundleId: legacyParsed.bundleId,
      daemonVersion: legacyParsed.daemonVersion,
      entryScriptRelativePath: legacyParsed.entryScriptRelativePath,
      bundleFormat: "legacy_linked_v1",
      sourceEntryScriptPath,
      sourcePackageRootPath,
      sourceDistRootPath: legacyParsed.sourceDistRootPath,
      sourceDistFingerprint: null,
      sourceKind: inferDaemonBundleSourceKind(sourcePackageRootPath),
      createdAt: legacyParsed.createdAt,
      updatedAt: legacyParsed.updatedAt,
    };
  } catch {
    return null;
  }
}

export async function resolveAlignedDaemonActiveBundleEntryPath(
  input: { expectedVersion?: string } = {}
): Promise<string | null> {
  const [installStatus, serviceContract, state] = await Promise.all([
    getDaemonStatus(),
    readDaemonServiceContract().catch(() => null),
    readDaemonActiveBundleState(),
  ]);
  const expectedVersion =
    input.expectedVersion ??
    serviceContract?.daemonVersion ??
    (installStatus.installed
      ? installStatus.state.daemonVersion
      : (state?.daemonVersion ?? "unknown"));
  const matchingServiceContract =
    input.expectedVersion &&
    serviceContract?.daemonVersion !== input.expectedVersion
      ? null
      : serviceContract;
  const activeBundleEntryPath =
    await resolveDaemonBundleEntryPathFromState(state);
  const installedBundleFingerprint = activeBundleEntryPath
    ? await resolveInstalledDaemonBundleFingerprint(state)
    : null;
  const activeBundleSourceAvailable =
    state && state.bundleFormat === "legacy_linked_v1"
      ? await pathExists(state.sourcePackageRootPath).catch(() => null)
      : null;
  const artifact = resolveDaemonServiceArtifact({
    expectedVersion,
    installStatus,
    serviceContract: matchingServiceContract,
    activeBundle: state,
    activeBundleSourceAvailable,
    activeBundleEntryPath,
    installedBundleFingerprint,
  });
  return artifact.resolvedEntryPath;
}

export async function resolveInstalledDaemonBundleFingerprint(
  state: DaemonActiveBundleState | null,
  pathInput: OpenMeldPathResolutionInput = {}
): Promise<string | null> {
  if (state?.bundleFormat === "binary_v1") {
    const entryPath = await resolveDaemonBundleEntryPathFromState(
      state,
      pathInput
    );
    return entryPath ? await hashDaemonBinaryFile(entryPath) : null;
  }
  if (state?.bundleFormat === "self_contained_v1") {
    const bundleRootPath = resolveDaemonBundleRootPath(
      state.bundleId,
      pathInput
    );
    const distRootPath = join(
      bundleRootPath,
      dirname(state.entryScriptRelativePath)
    );
    const relativeDistRootPath = relative(bundleRootPath, distRootPath);
    if (
      relativeDistRootPath === ".." ||
      relativeDistRootPath.startsWith(`..${sep}`) ||
      isAbsolute(relativeDistRootPath)
    ) {
      return null;
    }
    return await computeDaemonSourceDistFingerprint(distRootPath);
  }
  return null;
}

export async function resolveDaemonBundleEntryPathFromState(
  state: DaemonActiveBundleState | null,
  pathInput: OpenMeldPathResolutionInput = {}
): Promise<string | null> {
  if (!state) {
    return null;
  }
  if (state.bundleFormat === "binary_v1") {
    const stableExecutablePath = daemonServiceBinaryExecutablePath(pathInput);
    if (await pathExists(stableExecutablePath)) {
      return stableExecutablePath;
    }
    return (await pathExists(state.sourceEntryScriptPath))
      ? state.sourceEntryScriptPath
      : null;
  }
  const entryPath = join(
    resolveDaemonBundleRootPath(state.bundleId, pathInput),
    state.entryScriptRelativePath
  );
  return (await pathExists(entryPath)) ? entryPath : null;
}

export async function prepareDaemonServiceBundle(input: {
  activate?: boolean;
  daemonVersion: string;
  cliScriptPath?: string;
  binaryRelease?: CliBinaryReleaseInfo;
}): Promise<DaemonActiveBundleState> {
  const preparedBundle = isBinaryDistribution()
    ? await prepareBinaryDaemonServiceBundle(input)
    : await prepareNodeDaemonServiceBundle(input);
  if (input.activate !== false) {
    await activateDaemonServiceBundle(preparedBundle);
  }
  return preparedBundle;
}

async function prepareNodeDaemonServiceBundle(input: {
  daemonVersion: string;
  cliScriptPath?: string;
}): Promise<DaemonActiveBundleState> {
  const sourceProvenance = await resolveDaemonBundleSourceProvenance(
    input.cliScriptPath
  );
  if (
    !isDaemonBundleSourceAllowedForLane({
      sourceKind: sourceProvenance.sourceKind,
    })
  ) {
    throw new Error(
      "OpenMeld Service cannot use repo-local workspace service files in this lane. Repo-local service files are only allowed through `openmeld-dev`."
    );
  }
  const { sourceEntryScriptPath, sourceDistRootPath, sourcePackageRootPath } =
    sourceProvenance;
  const sourceDistFingerprint =
    await computeDaemonSourceDistFingerprint(sourceDistRootPath);
  const entryScriptRelativePath = basename(sourceEntryScriptPath);
  const now = new Date().toISOString();
  const bundleId = createBundleId(input.daemonVersion);
  const bundleRootPath = resolveDaemonBundleRootPath(bundleId);
  const targetDistRootPath = join(bundleRootPath, "dist");

  await Promise.all([
    mkdir(daemonRuntimeRootPath(), { recursive: true }),
    mkdir(daemonRuntimeBundlesPath(), { recursive: true }),
    mkdir(daemonRuntimeStateRootPath(), { recursive: true }),
    mkdir(daemonRuntimeServiceManagerPath(), { recursive: true }),
  ]);

  try {
    await rm(bundleRootPath, { recursive: true, force: true });
    await mkdir(bundleRootPath, { recursive: true });
    await cp(sourceDistRootPath, targetDistRootPath, {
      recursive: true,
      force: true,
      filter: (sourcePath) =>
        isDaemonSourceDistPathIncluded(sourceDistRootPath, sourcePath),
    });
    await writeDaemonBundlePackageManifest({
      bundleRootPath,
      daemonVersion: input.daemonVersion,
    });
    await copyDaemonBundleRuntimeDependencies({
      bundleRootPath,
      sourcePackageRootPath,
    });
  } catch (error) {
    await rm(bundleRootPath, { recursive: true, force: true }).catch(
      () => undefined
    );
    throw error;
  }

  const nextState: DaemonActiveBundleState = {
    v: 2,
    schema: DAEMON_ACTIVE_BUNDLE_SCHEMA,
    bundleId,
    daemonVersion: input.daemonVersion,
    entryScriptRelativePath: join("dist", entryScriptRelativePath),
    bundleFormat: "self_contained_v1",
    sourceEntryScriptPath,
    sourcePackageRootPath,
    sourceDistRootPath,
    sourceDistFingerprint,
    sourceKind: sourceProvenance.sourceKind,
    createdAt: now,
    updatedAt: now,
  };

  return nextState;
}

// Binary distribution: the daemon runs this same binary via `service run`, so
// there is no dist copy or node_modules dependency closure. Anchor the daemon
// to the managed install (versions/<version>/openmeld) and record a binary_v1
// active-bundle state (path fields kept non-empty for the read whitelist). No
// launcher/wrapper is generated; command-spec points straight at the binary.
async function prepareBinaryDaemonServiceBundle(input: {
  daemonVersion: string;
  binaryRelease?: CliBinaryReleaseInfo;
}): Promise<DaemonActiveBundleState> {
  const { daemonVersion } = input;
  const bundledRelease = resolveBundledServiceRelease();
  const binaryRelease =
    input.binaryRelease ??
    (bundledRelease?.version === daemonVersion ? bundledRelease : undefined);
  if (daemonVersion !== resolveCliSelfVersion()) {
    const active = await readDaemonActiveBundleState();
    if (
      active?.bundleFormat === "binary_v1" &&
      active.daemonVersion === daemonVersion &&
      active.sourceDistFingerprint &&
      (!binaryRelease ||
        binaryRelease.sha256 === active.sourceDistFingerprint) &&
      (await pathExists(active.sourceEntryScriptPath)) &&
      (await hashDaemonBinaryFile(active.sourceEntryScriptPath)) ===
        active.sourceDistFingerprint
    ) {
      return active;
    }
  }
  if (binaryRelease) {
    return await prepareSelectedBinaryDaemonServiceBundle({
      daemonVersion,
      release: binaryRelease,
    });
  }
  if (daemonVersion !== resolveCliSelfVersion()) {
    throw new Error(
      `Cannot prepare OpenMeld Service ${daemonVersion} from CLI ${resolveCliSelfVersion()}. Acquire the selected Service release before preparing the update.`
    );
  }
  const outcome = await performManagedInstall();
  const managedBinaryPath = outcome.managedBinaryPath;
  if (!(await pathExists(managedBinaryPath))) {
    throw new Error(
      `OpenMeld managed binary is missing at ${managedBinaryPath}; cannot prepare binary OpenMeld Service.`
    );
  }
  const managedVersionDir = dirname(managedBinaryPath);
  const now = new Date().toISOString();

  await Promise.all([
    mkdir(daemonRuntimeRootPath(), { recursive: true }),
    mkdir(daemonRuntimeStateRootPath(), { recursive: true }),
    mkdir(daemonRuntimeServiceManagerPath(), { recursive: true }),
  ]);

  const nextState: DaemonActiveBundleState = {
    v: 2,
    schema: DAEMON_ACTIVE_BUNDLE_SCHEMA,
    bundleId: createBundleId(outcome.version),
    daemonVersion: outcome.version,
    entryScriptRelativePath: "openmeld",
    bundleFormat: "binary_v1",
    sourceEntryScriptPath: managedBinaryPath,
    sourcePackageRootPath: managedVersionDir,
    sourceDistRootPath: managedVersionDir,
    sourceDistFingerprint: await hashDaemonBinaryFile(managedBinaryPath),
    sourceKind: DAEMON_BUNDLE_SOURCE_KIND_PACKAGE_INSTALL,
    createdAt: now,
    updatedAt: now,
  };

  return nextState;
}

async function prepareSelectedBinaryDaemonServiceBundle(input: {
  daemonVersion: string;
  release: CliBinaryReleaseInfo;
}): Promise<DaemonActiveBundleState> {
  if (input.release.version !== input.daemonVersion) {
    throw new Error(
      "The selected Service artifact does not match the update target."
    );
  }
  const bundleId = createBundleId(input.daemonVersion);
  const bundleRootPath = resolveDaemonBundleRootPath(bundleId);
  const executablePath = join(bundleRootPath, "openmeld");
  const onDeltaFallback = (error: Error): void => {
    console.warn("[openmeld.service.artifact_delta_fallback]", error.message);
  };
  const plan = await resolveCliBinaryUpdatePlan({
    baseBinaryPath: process.execPath,
    currentVersion: resolveCliSelfVersion(),
    onDeltaFallback,
    release: input.release,
  });
  const bytes = await downloadCliBinaryUpdateArtifact({
    downloadPolicy: DEFAULT_CLI_BINARY_DOWNLOAD_POLICY,
    fetchImpl: fetch,
    onDeltaFallback,
    plan,
    release: input.release,
  });
  await mkdir(bundleRootPath, { recursive: true });
  try {
    await writeFile(executablePath, bytes, { mode: 0o755 });
    await verifyCliBinaryCodeSignature({
      artifactPath: executablePath,
      release: input.release,
      runCommand: async (command, args) => {
        const result = await promisify(execFile)(command, args, {
          encoding: "utf8",
        });
        return { code: 0, stdout: result.stdout, stderr: result.stderr };
      },
    });
  } catch (error) {
    await rm(bundleRootPath, { recursive: true, force: true });
    throw error;
  }
  const now = new Date().toISOString();
  return {
    v: 2,
    schema: DAEMON_ACTIVE_BUNDLE_SCHEMA,
    bundleId,
    daemonVersion: input.daemonVersion,
    entryScriptRelativePath: "openmeld",
    bundleFormat: "binary_v1",
    sourceEntryScriptPath: executablePath,
    sourcePackageRootPath: bundleRootPath,
    sourceDistRootPath: bundleRootPath,
    sourceDistFingerprint: input.release.sha256.toLowerCase(),
    sourceKind: DAEMON_BUNDLE_SOURCE_KIND_PACKAGE_INSTALL,
    createdAt: now,
    updatedAt: now,
  };
}

export async function activateDaemonServiceBundle(
  preparedBundle: DaemonActiveBundleState
): Promise<void> {
  await mkdir(daemonRuntimeStateRootPath(), { recursive: true });
  await writeFile(
    daemonServiceActiveBundlePath(),
    `${JSON.stringify(preparedBundle, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 }
  );
  if (preparedBundle.bundleFormat !== "binary_v1") {
    await ensureDaemonServiceManagerExecutables();
  }
}

export async function discardPreparedDaemonServiceBundle(
  preparedBundle: DaemonActiveBundleState
): Promise<void> {
  if (preparedBundle.bundleFormat === "legacy_linked_v1") {
    return;
  }
  const activeBundle = await readDaemonActiveBundleState();
  if (activeBundle?.bundleId === preparedBundle.bundleId) {
    return;
  }
  await rm(resolveDaemonBundleRootPath(preparedBundle.bundleId), {
    recursive: true,
    force: true,
  });
}

async function hashDaemonBinaryFile(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  hash.update(await readFile(filePath));
  return hash.digest("hex");
}

export async function runAuditedServiceManagerCarrierMutation<T>(input: {
  distribution?: OpenMeldDistribution;
  operation: string;
  pathInput?: OpenMeldPathResolutionInput;
  run: () => Promise<T>;
  targetPath: string;
}): Promise<T> {
  const pathInput = input.pathInput ?? {};
  const metadata = {
    distribution: input.distribution ?? resolveOpenMeldDistribution(),
    executable: process.execPath,
    operation: input.operation,
    preset: resolveOpenMeldEnvPreset(pathInput),
    targetPath: input.targetPath,
    targetCategory: classifyDiagnosticPath(input.targetPath),
    actorPid: process.pid,
    parentPid: process.ppid,
  };
  await emitDaemonLifecycleEvent({
    command: "openmeld service carrier mutation",
    intent: "status_cleanup",
    metadata,
    pathInput,
    result: "attempted",
    type: "service_manager.registration_reconcile",
  });
  try {
    const result = await input.run();
    await emitDaemonLifecycleEvent({
      command: "openmeld service carrier mutation",
      intent: "status_cleanup",
      metadata,
      pathInput,
      result: "completed",
      type: "service_manager.registration_reconcile",
    });
    return result;
  } catch (error) {
    await emitDaemonLifecycleEvent({
      command: "openmeld service carrier mutation",
      intent: "status_cleanup",
      metadata: {
        ...metadata,
        errorMessage: error instanceof Error ? error.message : String(error),
        operationFailure: collectLocalOperationFailure(error),
      },
      pathInput,
      result: "failed",
      type: "service_manager.registration_reconcile",
    });
    throw error;
  }
}

export async function ensureDaemonServiceStableBinaryExecutable(
  pathInput: OpenMeldPathResolutionInput = {}
): Promise<string> {
  const activeBundle = await readDaemonActiveBundleState();
  if (activeBundle?.bundleFormat !== "binary_v1") {
    throw new Error(
      "OpenMeld cannot prepare the stable macOS Service executable without an active binary bundle."
    );
  }
  return await ensureVerifiedBinaryCarrier({
    bundle: activeBundle,
    operationName: "stable_binary",
    pathInput,
    targetPath: daemonServiceBinaryExecutablePath(pathInput),
  });
}

export async function ensureDaemonServiceUpdateWorkerBinaryExecutable(
  preparedBundle: DaemonActiveBundleState,
  pathInput: OpenMeldPathResolutionInput = {}
): Promise<string> {
  if (preparedBundle.bundleFormat !== "binary_v1") {
    throw new Error(
      "OpenMeld cannot prepare the update worker binary without a binary Service bundle."
    );
  }
  return await ensureVerifiedBinaryCarrier({
    bundle: preparedBundle,
    operationName: "update_worker_binary",
    pathInput,
    targetPath: daemonServiceUpdateWorkerBinaryPath(pathInput),
  });
}

export async function clearDaemonServiceUpdateWorkerBinaryExecutable(
  pathInput: OpenMeldPathResolutionInput = {}
): Promise<void> {
  const targetPath = daemonServiceUpdateWorkerBinaryPath(pathInput);
  await runAuditedServiceManagerCarrierMutation({
    distribution: "binary",
    operation: "remove_update_worker_binary",
    pathInput,
    targetPath,
    run: async () => await rm(targetPath, { force: true }),
  });
}

async function ensureVerifiedBinaryCarrier(input: {
  bundle: DaemonActiveBundleState;
  operationName: "stable_binary" | "update_worker_binary";
  pathInput: OpenMeldPathResolutionInput;
  targetPath: string;
}): Promise<string> {
  const sourcePath = input.bundle.sourceEntryScriptPath;
  const expectedFingerprint =
    input.bundle.sourceDistFingerprint ??
    (await hashDaemonBinaryFile(sourcePath));
  const stableExecutablePath = input.targetPath;
  const stableExecutableStat = await lstat(stableExecutablePath).catch(
    () => null
  );
  if (
    stableExecutableStat?.isFile() === true &&
    !stableExecutableStat.isSymbolicLink() &&
    (await hashDaemonBinaryFile(stableExecutablePath).catch(() => null)) ===
      expectedFingerprint
  ) {
    await runAuditedServiceManagerCarrierMutation({
      distribution: "binary",
      operation: `refresh_${input.operationName}_permissions`,
      pathInput: input.pathInput,
      targetPath: stableExecutablePath,
      run: async () => await chmod(stableExecutablePath, 0o700),
    });
    return stableExecutablePath;
  }

  await mkdir(dirname(stableExecutablePath), { recursive: true });
  const preparedPath = `${stableExecutablePath}.next-${String(process.pid)}`;
  await runAuditedServiceManagerCarrierMutation({
    distribution: "binary",
    operation: `clear_prepared_${input.operationName}`,
    pathInput: input.pathInput,
    targetPath: preparedPath,
    run: async () => await rm(preparedPath, { force: true }),
  });
  try {
    await runAuditedServiceManagerCarrierMutation({
      distribution: "binary",
      operation: `prepare_${input.operationName}`,
      pathInput: input.pathInput,
      targetPath: preparedPath,
      run: async () => {
        await copyFile(sourcePath, preparedPath);
        await chmod(preparedPath, 0o700);
      },
    });
    const preparedFingerprint = await hashDaemonBinaryFile(preparedPath);
    if (preparedFingerprint !== expectedFingerprint) {
      throw new Error(
        "OpenMeld could not verify the prepared Service carrier executable."
      );
    }
    await runAuditedServiceManagerCarrierMutation({
      distribution: "binary",
      operation: `replace_${input.operationName}`,
      pathInput: input.pathInput,
      targetPath: stableExecutablePath,
      run: async () => await rename(preparedPath, stableExecutablePath),
    });
    return stableExecutablePath;
  } finally {
    await runAuditedServiceManagerCarrierMutation({
      distribution: "binary",
      operation: `clear_prepared_${input.operationName}`,
      pathInput: input.pathInput,
      targetPath: preparedPath,
      run: async () => await rm(preparedPath, { force: true }),
    }).catch(() => undefined);
  }
}

export async function verifyDaemonActiveBundleIntegrity(
  activeBundle: DaemonActiveBundleState
): Promise<boolean> {
  const expectedFingerprint = activeBundle.sourceDistFingerprint?.trim();
  if (
    !expectedFingerprint ||
    activeBundle.bundleFormat === "legacy_linked_v1"
  ) {
    return false;
  }
  const entryPath = await resolveDaemonBundleEntryPathFromState(activeBundle);
  if (!entryPath) {
    return false;
  }
  return (
    (await resolveInstalledDaemonBundleFingerprint(activeBundle)) ===
    expectedFingerprint
  );
}

async function writeDaemonBundlePackageManifest(input: {
  bundleRootPath: string;
  daemonVersion: string;
}): Promise<void> {
  const packageManifestPath = join(input.bundleRootPath, "package.json");
  await writeFile(
    packageManifestPath,
    `${JSON.stringify(
      {
        name: "openmeld-daemon-service-bundle",
        private: true,
        type: "module",
        version: input.daemonVersion,
      },
      null,
      2
    )}\n`,
    {
      encoding: "utf8",
      mode: 0o600,
    }
  );
}

async function copyDaemonBundleRuntimeDependencies(input: {
  bundleRootPath: string;
  sourcePackageRootPath: string;
}): Promise<void> {
  const runtimeDependencies = await collectDaemonBundleRuntimeDependencyClosure(
    {
      sourcePackageRootPath: input.sourcePackageRootPath,
    }
  );

  const targetNodeModulesPath = join(input.bundleRootPath, "node_modules");
  await rm(targetNodeModulesPath, {
    recursive: true,
    force: true,
  });
  await mkdir(targetNodeModulesPath, { recursive: true });
  for (const runtimeDependency of runtimeDependencies) {
    await copyDaemonBundleDependencyDirectory({
      dependencyName: runtimeDependency.dependencyName,
      sourceDependencyPath: runtimeDependency.packageRootPath,
      targetNodeModulesPath,
    });
  }
}

async function copyDaemonBundleDependencyDirectory(input: {
  dependencyName: string;
  sourceDependencyPath: string;
  targetNodeModulesPath: string;
}): Promise<void> {
  if (!(await pathExists(input.sourceDependencyPath))) {
    throw new Error(
      `OpenMeld could not copy runtime dependency ${input.dependencyName} for background service bundling from ${input.sourceDependencyPath}. Run \`pnpm install\` and retry.`
    );
  }
  const targetDependencyPath = join(
    input.targetNodeModulesPath,
    ...input.dependencyName.split("/")
  );
  await mkdir(dirname(targetDependencyPath), { recursive: true });
  await cp(input.sourceDependencyPath, targetDependencyPath, {
    recursive: true,
    force: true,
    dereference: true,
    preserveTimestamps: true,
  });
}

export async function writeDaemonServiceLauncher(
  pathInput: OpenMeldPathResolutionInput = {}
): Promise<void> {
  await mkdir(daemonRuntimeServiceManagerPath(pathInput), { recursive: true });
  const targetPath = daemonServiceLauncherPath(pathInput);
  await runAuditedServiceManagerCarrierMutation({
    distribution: "npm",
    operation: "write_launcher",
    pathInput,
    targetPath,
    run: async () =>
      await writeFile(
        targetPath,
        `${buildDaemonServiceLauncherSource(pathInput)}\n`,
        {
          encoding: "utf8",
          mode: 0o700,
        }
      ),
  });
}

export async function writeDaemonServiceExecutableWrapper(
  pathInput: OpenMeldPathResolutionInput = {}
): Promise<void> {
  await mkdir(daemonRuntimeServiceManagerPath(pathInput), { recursive: true });
  await Promise.all(
    daemonServiceExecutableWrapperPaths(pathInput).map(async (wrapperPath) => {
      await runAuditedServiceManagerCarrierMutation({
        distribution: "npm",
        operation: "write_executable_wrapper",
        pathInput,
        targetPath: wrapperPath,
        run: async () => {
          await writeFile(
            wrapperPath,
            `${buildDaemonServiceExecutableWrapperSource(pathInput)}\n`,
            {
              encoding: "utf8",
              mode: 0o700,
            }
          );
          await chmod(wrapperPath, 0o700);
        },
      });
    })
  );
}

export async function ensureDaemonServiceManagerExecutables(
  pathInput: OpenMeldPathResolutionInput = {}
): Promise<void> {
  await writeDaemonServiceLauncher(pathInput);
  await writeDaemonServiceExecutableWrapper(pathInput);
}

export async function restoreDaemonActiveBundleStateSnapshot(
  snapshot: DaemonActiveBundleState | null,
  pathInput: OpenMeldPathResolutionInput = {}
): Promise<void> {
  if (!snapshot) {
    await rm(daemonServiceActiveBundlePath(pathInput), { force: true });
    return;
  }
  await mkdir(daemonRuntimeStateRootPath(pathInput), { recursive: true });
  await writeFile(
    daemonServiceActiveBundlePath(pathInput),
    `${JSON.stringify(snapshot, null, 2)}\n`,
    {
      encoding: "utf8",
      mode: 0o600,
    }
  );
}

export async function clearDaemonServiceBundles(): Promise<void> {
  await Promise.all([
    rm(daemonServiceActiveBundlePath(), { force: true }),
    runAuditedServiceManagerCarrierMutation({
      operation: "remove_launcher",
      targetPath: daemonServiceLauncherPath(),
      run: async () => await rm(daemonServiceLauncherPath(), { force: true }),
    }),
    runAuditedServiceManagerCarrierMutation({
      distribution: "binary",
      operation: "remove_stable_binary",
      targetPath: daemonServiceBinaryExecutablePath(),
      run: async () =>
        await rm(daemonServiceBinaryExecutablePath(), { force: true }),
    }),
    clearDaemonServiceUpdateWorkerBinaryExecutable(),
    ...daemonServiceExecutableWrapperPaths().map((wrapperPath) =>
      runAuditedServiceManagerCarrierMutation({
        operation: "remove_executable_wrapper",
        targetPath: wrapperPath,
        run: async () => await rm(wrapperPath, { force: true }),
      })
    ),
    rm(daemonRuntimeBundlesPath(), { recursive: true, force: true }),
  ]);
}

export async function cleanupInactiveDaemonServiceBundles(
  input: { retainBundleIds?: string[] } = {}
): Promise<void> {
  const [
    active,
    serviceContract,
    runtimeLease,
    registeredWorkerBundleIds,
    pendingUpdate,
  ] = await Promise.all([
    readDaemonActiveBundleState(),
    readDaemonServiceContract().catch(() => null),
    readDaemonRuntimeLease().catch(() => null),
    readDaemonServiceUpdateWorkerProtectedBundleIds(),
    readPendingDaemonServiceUpdate(),
  ]);
  const retain = new Set([
    ...(active ? [active.bundleId] : []),
    ...(serviceContract?.bundleId ? [serviceContract.bundleId] : []),
    ...(runtimeLease?.bundleId ? [runtimeLease.bundleId] : []),
    ...registeredWorkerBundleIds,
    ...(pendingUpdate?.preparedBundle.bundleFormat === "self_contained_v1"
      ? [pendingUpdate.preparedBundle.bundleId]
      : []),
    ...(input.retainBundleIds ?? []),
  ]);
  const bundleEntries = await readDirectoryNames(daemonRuntimeBundlesPath());
  await Promise.all(
    bundleEntries
      .filter((bundleId) => !retain.has(bundleId))
      .map(async (bundleId) => {
        await rm(resolveDaemonBundleRootPath(bundleId), {
          recursive: true,
          force: true,
        });
      })
  );
}

async function resolveDaemonBundleSourceProvenance(
  explicitPath?: string
): Promise<{
  sourceEntryScriptPath: string;
  sourceDistRootPath: string;
  sourcePackageRootPath: string;
  sourceKind: DaemonBundleSourceKind;
}> {
  const sourceEntryScriptPath = await resolveCliScriptPath(explicitPath);
  const sourceDistRootPath = dirname(sourceEntryScriptPath);
  const sourcePackageRootPath = dirname(sourceDistRootPath);
  return {
    sourceEntryScriptPath,
    sourceDistRootPath,
    sourcePackageRootPath,
    sourceKind: inferDaemonBundleSourceKind(sourcePackageRootPath),
  };
}

async function resolveCliScriptPath(explicitPath?: string): Promise<string> {
  const rawPath = explicitPath ?? process.argv[1];
  if (!rawPath) {
    throw new Error(
      "Cannot determine CLI script path for OpenMeld background service bundle."
    );
  }
  const resolvedPath = await realpath(rawPath).catch(async () => {
    const fallbackPath = await resolvePreferredCliScriptPath(rawPath);
    if (fallbackPath) {
      return fallbackPath;
    }
    throw new Error(
      `OpenMeld could not resolve a CLI dist entry for service bundling from ${rawPath}.`
    );
  });
  const preferredPath = await resolvePreferredCliScriptPath(resolvedPath);
  if (preferredPath) {
    return preferredPath;
  }
  throw new Error(
    `OpenMeld could not find a supported CLI dist entry for service bundling from ${resolvedPath}.`
  );
}

function createBundleId(version: string): string {
  const normalizedVersion = version.replace(/[^a-zA-Z0-9._-]+/g, "_");
  return `${normalizedVersion}-${Date.now()}`;
}

async function computeDaemonSourceDistFingerprint(
  sourceDistRootPath: string
): Promise<string> {
  const filePaths = await listDaemonSourceDistFiles(sourceDistRootPath);
  const hash = createHash("sha256");
  for (const filePath of filePaths) {
    const relativePath = relative(sourceDistRootPath, filePath).replaceAll(
      "\\",
      "/"
    );
    hash.update(relativePath, "utf8");
    hash.update("\0", "utf8");
    hash.update(await readFile(filePath));
    hash.update("\0", "utf8");
  }
  return hash.digest("hex");
}

async function listDaemonSourceDistFiles(path: string): Promise<string[]> {
  return await listIncludedDaemonSourceDistFiles(path, path);
}

async function listIncludedDaemonSourceDistFiles(
  sourceDistRootPath: string,
  currentPath: string
): Promise<string[]> {
  const entries = await readdir(currentPath, { withFileTypes: true });
  const filePaths: string[] = [];

  for (const entry of entries) {
    const entryPath = join(currentPath, entry.name);
    if (!isDaemonSourceDistPathIncluded(sourceDistRootPath, entryPath)) {
      continue;
    }
    if (entry.isDirectory()) {
      filePaths.push(
        ...(await listIncludedDaemonSourceDistFiles(
          sourceDistRootPath,
          entryPath
        ))
      );
      continue;
    }
    if (entry.isFile()) {
      filePaths.push(entryPath);
    }
  }

  return filePaths.sort((left, right) => {
    if (left === right) {
      return 0;
    }
    return left < right ? -1 : 1;
  });
}

function isDaemonSourceDistPathIncluded(
  sourceDistRootPath: string,
  candidatePath: string
): boolean {
  const relativePath = relative(sourceDistRootPath, candidatePath).replaceAll(
    "\\",
    "/"
  );
  if (!relativePath || relativePath.startsWith("..")) {
    return true;
  }
  const topLevelPathSegment = relativePath.split("/")[0] ?? "";
  return !DAEMON_SOURCE_DIST_IGNORED_TOP_LEVEL_DIRS.has(topLevelPathSegment);
}

async function collectDaemonBundleRuntimeDependencyClosure(input: {
  sourcePackageRootPath: string;
}): Promise<Array<{ dependencyName: string; packageRootPath: string }>> {
  const packageManifestPath = join(input.sourcePackageRootPath, "package.json");
  const packageManifestRaw = await readFile(packageManifestPath, "utf8").catch(
    (error: unknown) => {
      if (getErrorCode(error) === "ENOENT") {
        throw new Error(
          `OpenMeld could not find the CLI package manifest for background service bundling at ${packageManifestPath}.`
        );
      }
      throw error;
    }
  );
  const packageManifest = JSON.parse(packageManifestRaw) as {
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  };
  const resolvedDependencies = new Map<string, string>();
  const queue = [
    ...Object.keys(packageManifest.dependencies ?? {}).map(
      (dependencyName) => ({
        dependencyName,
        required: true,
        resolverPackageRootPath: input.sourcePackageRootPath,
      })
    ),
    ...Object.keys(packageManifest.optionalDependencies ?? {}).map(
      (dependencyName) => ({
        dependencyName,
        required: false,
        resolverPackageRootPath: input.sourcePackageRootPath,
      })
    ),
  ];

  while (queue.length > 0) {
    const nextDependency = queue.shift();
    if (!nextDependency) {
      continue;
    }
    if (isTypeOnlyDependencyName(nextDependency.dependencyName)) {
      continue;
    }
    if (resolvedDependencies.has(nextDependency.dependencyName)) {
      continue;
    }
    const dependencyManifest = await readDaemonBundleDependencyManifest({
      dependencyName: nextDependency.dependencyName,
      required: nextDependency.required,
      resolverPackageRootPath: nextDependency.resolverPackageRootPath,
    });
    if (!dependencyManifest) {
      continue;
    }

    resolvedDependencies.set(
      nextDependency.dependencyName,
      dependencyManifest.packageRootPath
    );
    const nestedRequiredDependencies = Object.keys(
      dependencyManifest.dependencies ?? {}
    );
    const nestedOptionalDependencies = Object.keys(
      dependencyManifest.optionalDependencies ?? {}
    );
    const nestedPeerDependencies = Object.keys(
      dependencyManifest.peerDependencies ?? {}
    );
    for (const dependencyName of nestedRequiredDependencies) {
      queue.push({
        dependencyName,
        required: true,
        resolverPackageRootPath: dependencyManifest.packageRootPath,
      });
    }
    for (const dependencyName of nestedOptionalDependencies) {
      queue.push({
        dependencyName,
        required: false,
        resolverPackageRootPath: dependencyManifest.packageRootPath,
      });
    }
    for (const dependencyName of nestedPeerDependencies) {
      queue.push({
        dependencyName,
        required: false,
        resolverPackageRootPath: dependencyManifest.packageRootPath,
      });
    }
  }

  return [...resolvedDependencies.entries()]
    .map(([dependencyName, packageRootPath]) => ({
      dependencyName,
      packageRootPath,
    }))
    .sort((left, right) =>
      left.dependencyName.localeCompare(right.dependencyName)
    );
}

function isTypeOnlyDependencyName(dependencyName: string): boolean {
  return dependencyName.startsWith("@types/");
}

async function readDaemonBundleDependencyManifest(input: {
  dependencyName: string;
  required: boolean;
  resolverPackageRootPath: string;
}): Promise<{
  packageRootPath: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
} | null> {
  const dependencyPackageRootPath = await resolveDaemonDependencyPackageRoot({
    dependencyName: input.dependencyName,
    resolverPackageRootPath: input.resolverPackageRootPath,
    required: input.required,
  });
  if (!dependencyPackageRootPath) {
    return null;
  }
  const dependencyManifestPath = join(
    dependencyPackageRootPath,
    "package.json"
  );
  const dependencyManifestRaw = await readFile(
    dependencyManifestPath,
    "utf8"
  ).catch((error: unknown) => {
    if (getErrorCode(error) === "ENOENT") {
      if (!input.required) {
        return null;
      }
      throw new Error(
        `OpenMeld could not find runtime dependency ${input.dependencyName} for background service bundling at ${dependencyManifestPath}. Run \`pnpm install\` and retry.`
      );
    }
    throw error;
  });
  if (dependencyManifestRaw === null) {
    return null;
  }
  const dependencyManifest = JSON.parse(dependencyManifestRaw) as {
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };
  return {
    packageRootPath: dependencyPackageRootPath,
    ...dependencyManifest,
  };
}

async function resolveDaemonDependencyPackageRoot(input: {
  dependencyName: string;
  resolverPackageRootPath: string;
  required: boolean;
}): Promise<string | null> {
  const resolver = createRequire(
    join(input.resolverPackageRootPath, "package.json")
  );
  const dependencyPackageRootPath =
    await resolveDaemonDependencyPackageRootFromManifest({
      dependencyName: input.dependencyName,
      resolver,
    });
  if (dependencyPackageRootPath) {
    return dependencyPackageRootPath;
  }
  try {
    const dependencyEntryPath = await realpath(
      resolver.resolve(input.dependencyName)
    );
    return await findDaemonDependencyPackageRoot(dependencyEntryPath);
  } catch (error) {
    if (isPackageEntryResolutionError(error)) {
      const dependencyPackageRootPath =
        await findDaemonDependencyPackageRootFromResolutionPaths({
          dependencyName: input.dependencyName,
          resolver,
        });
      if (dependencyPackageRootPath) {
        return dependencyPackageRootPath;
      }
      if (!input.required) {
        return null;
      }
      throw new Error(
        `OpenMeld could not find runtime dependency ${input.dependencyName} for background service bundling from ${input.resolverPackageRootPath}. Run \`pnpm install\` and retry.`
      );
    }
    throw error;
  }
}

async function resolveDaemonDependencyPackageRootFromManifest(input: {
  dependencyName: string;
  resolver: NodeJS.Require;
}): Promise<string | null> {
  try {
    const dependencyManifestPath = await realpath(
      input.resolver.resolve(`${input.dependencyName}/package.json`)
    );
    return await findDaemonDependencyPackageRootFromManifestPath({
      dependencyManifestPath,
      dependencyName: input.dependencyName,
    });
  } catch (error) {
    if (isPackageEntryResolutionError(error)) {
      return null;
    }
    throw error;
  }
}

async function findDaemonDependencyPackageRootFromManifestPath(input: {
  dependencyManifestPath: string;
  dependencyName: string;
}): Promise<string | null> {
  let currentPath = dirname(input.dependencyManifestPath);
  while (true) {
    const packageManifestPath = join(currentPath, "package.json");
    const packageManifestRaw = await readFile(
      packageManifestPath,
      "utf8"
    ).catch((error: unknown) => {
      if (getErrorCode(error) === "ENOENT") {
        return null;
      }
      throw error;
    });
    if (packageManifestRaw !== null) {
      const packageManifest = JSON.parse(packageManifestRaw) as {
        name?: unknown;
      };
      if (packageManifest.name === input.dependencyName) {
        return currentPath;
      }
    }
    const parentPath = dirname(currentPath);
    if (parentPath === currentPath) {
      return null;
    }
    currentPath = parentPath;
  }
}

async function findDaemonDependencyPackageRootFromResolutionPaths(input: {
  dependencyName: string;
  resolver: NodeJS.Require;
}): Promise<string | null> {
  const resolutionPaths = input.resolver.resolve.paths(input.dependencyName);
  if (!resolutionPaths) {
    return null;
  }
  for (const nodeModulesPath of resolutionPaths) {
    const candidatePackageRootPath = join(
      nodeModulesPath,
      ...input.dependencyName.split("/")
    );
    if (await pathExists(join(candidatePackageRootPath, "package.json"))) {
      return await realpath(candidatePackageRootPath);
    }
  }
  return null;
}

async function findDaemonDependencyPackageRoot(
  resolvedEntryPath: string
): Promise<string> {
  let currentPath = dirname(resolvedEntryPath);
  while (true) {
    const packageManifestPath = join(currentPath, "package.json");
    if (await pathExists(packageManifestPath)) {
      return currentPath;
    }
    const parentPath = dirname(currentPath);
    if (parentPath === currentPath) {
      break;
    }
    currentPath = parentPath;
  }
  throw new Error(
    `OpenMeld could not determine the package root for background service dependency entry ${resolvedEntryPath}.`
  );
}

function buildDaemonServiceLauncherSource(
  pathInput: OpenMeldPathResolutionInput = {}
): string {
  const activeBundleStatePath = JSON.stringify(
    daemonServiceActiveBundlePath(pathInput)
  );
  const installStatePath = JSON.stringify(daemonStatePath(pathInput));
  const bundleRootPath = JSON.stringify(daemonRuntimeBundlesPath(pathInput));
  const allowWorkspaceBundleSource = JSON.stringify(
    resolveOpenMeldEnvPreset(pathInput) === "dev-local"
  );
  return `import { access, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

const ACTIVE_BUNDLE_PATH = ${activeBundleStatePath};
const INSTALL_STATE_PATH = ${installStatePath};
const BUNDLE_ROOT_PATH = ${bundleRootPath};
const ALLOW_WORKSPACE_BUNDLE_SOURCE = ${allowWorkspaceBundleSource};

const ACTIVE_BUNDLE_SCHEMA = "openmeld-daemon-active-bundle-v2";
const ACTIVE_BUNDLE_LEGACY_SCHEMA = "openmeld-daemon-active-bundle-v1";
const INSTALL_STATE_SCHEMA = "openmeld-daemon-install-v1";

async function readJsonFile(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function normalizeInstallState(parsed) {
  if (!parsed || parsed.schema !== INSTALL_STATE_SCHEMA || typeof parsed.daemonVersion !== "string" || parsed.daemonVersion.length === 0) {
    return null;
  }
  return {
    daemonVersion: parsed.daemonVersion,
  };
}

function normalizeBundleState(parsed) {
  if (
    parsed &&
    parsed.v === 2 &&
    parsed.schema === ACTIVE_BUNDLE_SCHEMA &&
    typeof parsed.bundleId === "string" &&
    parsed.bundleId.length > 0 &&
    typeof parsed.daemonVersion === "string" &&
    parsed.daemonVersion.length > 0 &&
    typeof parsed.entryScriptRelativePath === "string" &&
    parsed.entryScriptRelativePath.length > 0 &&
    (parsed.bundleFormat === "self_contained_v1" || parsed.bundleFormat === "legacy_linked_v1")
  ) {
    return parsed;
  }
  if (
    parsed &&
    parsed.v === 1 &&
    parsed.schema === ACTIVE_BUNDLE_LEGACY_SCHEMA &&
    typeof parsed.bundleId === "string" &&
    parsed.bundleId.length > 0 &&
    typeof parsed.daemonVersion === "string" &&
    parsed.daemonVersion.length > 0 &&
    typeof parsed.entryScriptRelativePath === "string" &&
    parsed.entryScriptRelativePath.length > 0
  ) {
    return {
      ...parsed,
      bundleFormat: "legacy_linked_v1",
    };
  }
  return null;
}

function normalizeBundlePackageManifest(parsed) {
  if (!parsed || typeof parsed.version !== "string" || parsed.version.length === 0) {
    return null;
  }
  return {
    version: parsed.version,
  };
}

function uniqueNonEmptyStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))];
}

async function findFallbackSelfContainedBundle(input) {
  const directories = await readdir(BUNDLE_ROOT_PATH, { withFileTypes: true }).catch((error) => {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  });
  const entryScriptRelativePaths = uniqueNonEmptyStrings([
    input.preferredEntryScriptRelativePath,
    "dist/openmeld.js",
    "dist/openmeld-dev.js",
  ]);
  const candidates = [];
  for (const directory of directories) {
    if (!directory.isDirectory()) {
      continue;
    }
    const bundleId = directory.name;
    const bundlePath = join(BUNDLE_ROOT_PATH, bundleId);
    const manifest = normalizeBundlePackageManifest(
      await readJsonFile(join(bundlePath, "package.json"))
    );
    if (manifest?.version !== input.installState.daemonVersion) {
      continue;
    }
    for (const entryScriptRelativePath of entryScriptRelativePaths) {
      const entryPath = join(bundlePath, entryScriptRelativePath);
      if (!(await pathExists(entryPath))) {
        continue;
      }
      const entryStat = await stat(entryPath).catch(() => null);
      candidates.push({
        bundleId,
        entryPath,
        entryScriptRelativePath,
        mtimeMs: entryStat?.mtimeMs ?? 0,
      });
      break;
    }
  }
  candidates.sort((a, b) => {
    if (b.mtimeMs !== a.mtimeMs) {
      return b.mtimeMs - a.mtimeMs;
    }
    return b.bundleId.localeCompare(a.bundleId);
  });
  return candidates[0] ?? null;
}

async function persistFallbackActiveBundleState(input) {
  const now = new Date().toISOString();
  const bundleRootPath = join(BUNDLE_ROOT_PATH, input.bundleId);
  const nextState = {
    v: 2,
    schema: ACTIVE_BUNDLE_SCHEMA,
    bundleId: input.bundleId,
    daemonVersion: input.installState.daemonVersion,
    entryScriptRelativePath: input.entryScriptRelativePath,
    bundleFormat: "self_contained_v1",
    sourceEntryScriptPath: input.entryPath,
    sourcePackageRootPath: bundleRootPath,
    sourceDistRootPath: join(bundleRootPath, "dist"),
    sourceDistFingerprint: null,
    sourceKind: "package_install",
    createdAt: input.previousBundleState?.createdAt ?? now,
    updatedAt: now,
  };
  await writeFile(ACTIVE_BUNDLE_PATH, \`\${JSON.stringify(nextState, null, 2)}\\n\`, {
    encoding: "utf8",
    mode: 0o600,
  }).catch((error) => {
    console.error(\`OpenMeld Service launcher recovered a matching bundle but could not update active bundle state: \${String(error)}\`);
  });
}

async function resolveEntryPath() {
  const installState = normalizeInstallState(await readJsonFile(INSTALL_STATE_PATH));
  const bundleState = normalizeBundleState(await readJsonFile(ACTIVE_BUNDLE_PATH));
  if (!installState) {
    throw new Error("OpenMeld Service launcher could not read a valid install state.");
  }
  if (!bundleState) {
    const fallback = await findFallbackSelfContainedBundle({
      installState,
      preferredEntryScriptRelativePath: null,
    });
    if (!fallback) {
      throw new Error("OpenMeld Service launcher could not read a valid active bundle state.");
    }
    await persistFallbackActiveBundleState({
      ...fallback,
      installState,
      previousBundleState: null,
    });
    console.error(\`OpenMeld Service launcher recovered bundle \${fallback.bundleId} because active bundle state was missing or invalid.\`);
    return fallback.entryPath;
  }
  if (bundleState.bundleFormat !== "self_contained_v1") {
    const fallback = await findFallbackSelfContainedBundle({
      installState,
      preferredEntryScriptRelativePath: bundleState.entryScriptRelativePath,
    });
    if (!fallback) {
      throw new Error(\`OpenMeld Service launcher refused to start legacy bundle format \${String(bundleState.bundleFormat)}.\`);
    }
    await persistFallbackActiveBundleState({
      ...fallback,
      installState,
      previousBundleState: bundleState,
    });
    console.error(\`OpenMeld Service launcher recovered bundle \${fallback.bundleId} because active bundle state used legacy bundle format \${String(bundleState.bundleFormat)}.\`);
    return fallback.entryPath;
  }
  if (bundleState.sourceKind === "workspace" && !ALLOW_WORKSPACE_BUNDLE_SOURCE) {
    const fallback = await findFallbackSelfContainedBundle({
      installState,
      preferredEntryScriptRelativePath: bundleState.entryScriptRelativePath,
    });
    if (!fallback) {
      throw new Error("OpenMeld Service launcher refused to start repo-local workspace service files in this lane. Repo-local service files are only allowed through \`openmeld-dev\`.");
    }
    await persistFallbackActiveBundleState({
      ...fallback,
      installState,
      previousBundleState: bundleState,
    });
    console.error(\`OpenMeld Service launcher recovered bundle \${fallback.bundleId} because active bundle state pointed at a repo-local workspace bundle in this lane.\`);
    return fallback.entryPath;
  }
  if (bundleState.daemonVersion !== installState.daemonVersion) {
    const fallback = await findFallbackSelfContainedBundle({
      installState,
      preferredEntryScriptRelativePath: bundleState.entryScriptRelativePath,
    });
    if (!fallback) {
      throw new Error(\`OpenMeld Service launcher detected bundle version drift: bundle v\${String(bundleState.daemonVersion)} != install v\${String(installState.daemonVersion)}.\`);
    }
    await persistFallbackActiveBundleState({
      ...fallback,
      installState,
      previousBundleState: bundleState,
    });
    console.error(\`OpenMeld Service launcher recovered bundle \${fallback.bundleId} because active bundle state had version drift.\`);
    return fallback.entryPath;
  }
  const entryPath = join(BUNDLE_ROOT_PATH, bundleState.bundleId, bundleState.entryScriptRelativePath);
  if (await pathExists(entryPath)) {
    return entryPath;
  }
  const fallback = await findFallbackSelfContainedBundle({
    installState,
    preferredEntryScriptRelativePath: bundleState.entryScriptRelativePath,
  });
  if (!fallback) {
    throw new Error(\`OpenMeld Service launcher could not find active bundle entry \${entryPath}.\`);
  }
  await persistFallbackActiveBundleState({
    ...fallback,
    installState,
    previousBundleState: bundleState,
  });
  console.error(\`OpenMeld Service launcher recovered bundle \${fallback.bundleId} because active bundle entry was missing.\`);
  return fallback.entryPath;
}

async function main() {
  const entryPath = await resolveEntryPath();
  const child = spawn(process.execPath, [entryPath, ...process.argv.slice(2)], {
    stdio: "inherit",
    env: process.env,
    windowsHide: true,
  });

  const forwardSignal = (signal) => {
    if (!child.killed) {
      child.kill(signal);
    }
  };

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      forwardSignal(signal);
    });
  }

  child.once("error", (error) => {
    console.error(String(error));
    process.exitCode = 1;
  });

  child.once("close", (code, signal) => {
    if (typeof code === "number") {
      process.exitCode = code;
      return;
    }
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exitCode = 1;
  });
}

await main();`;
}

function buildDaemonServiceExecutableWrapperSource(
  pathInput: OpenMeldPathResolutionInput = {}
): string {
  return [
    "#!/bin/sh",
    `exec ${quoteShellSingle(process.execPath)} ${quoteShellSingle(
      daemonServiceLauncherPath(pathInput)
    )} "$@"`,
  ].join("\n");
}

function quoteShellSingle(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

async function readDirectoryNames(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true }).catch(
    (error) => {
      if (getErrorCode(error) === "ENOENT") {
        return [];
      }
      throw error;
    }
  );
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

function inferDaemonBundleSourceKind(
  sourcePackageRootPath: string
): DaemonBundleSourceKind {
  const normalized = sourcePackageRootPath.replaceAll("\\", "/").toLowerCase();
  if (normalized.includes("/.npm/") && normalized.includes("_npx")) {
    return DAEMON_BUNDLE_SOURCE_KIND_NPX_CACHE;
  }
  if (normalized.includes("/node_modules/")) {
    return DAEMON_BUNDLE_SOURCE_KIND_PACKAGE_INSTALL;
  }
  if (normalized.includes("/openmeld/")) {
    return DAEMON_BUNDLE_SOURCE_KIND_WORKSPACE;
  }
  return DAEMON_BUNDLE_SOURCE_KIND_UNKNOWN;
}

function isDaemonBundleFormat(value: unknown): value is DaemonBundleFormat {
  return (
    value === "legacy_linked_v1" ||
    value === "self_contained_v1" ||
    value === "binary_v1"
  );
}

function isDaemonBundleSourceKind(
  value: unknown
): value is DaemonBundleSourceKind {
  return (
    value === DAEMON_BUNDLE_SOURCE_KIND_WORKSPACE ||
    value === DAEMON_BUNDLE_SOURCE_KIND_PACKAGE_INSTALL ||
    value === DAEMON_BUNDLE_SOURCE_KIND_NPX_CACHE ||
    value === DAEMON_BUNDLE_SOURCE_KIND_UNKNOWN
  );
}

function isPackageEntryResolutionError(error: unknown): boolean {
  const code = getErrorCode(error);
  return (
    code === "MODULE_NOT_FOUND" || code === "ERR_PACKAGE_PATH_NOT_EXPORTED"
  );
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (getErrorCode(error) === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function resolvePreferredCliScriptPath(
  rawPath: string
): Promise<string | null> {
  const preferredScriptNames = buildPreferredCliScriptNames(rawPath);
  const candidateRoots = [
    dirname(rawPath),
    join(process.cwd(), "dist"),
    join(process.cwd(), "clients", "openmeld-cli", "dist"),
    dirname(fileURLToPath(import.meta.url)),
    join(dirname(fileURLToPath(import.meta.url)), "..", "dist"),
  ];
  for (const scriptName of preferredScriptNames) {
    for (const candidateRoot of candidateRoots) {
      const candidatePath = join(candidateRoot, scriptName);
      if (await pathExists(candidatePath)) {
        return candidatePath;
      }
    }
  }
  return null;
}

function buildPreferredCliScriptNames(rawPath: string): string[] {
  const requestedScriptName = basename(rawPath).endsWith(".js")
    ? basename(rawPath)
    : `${basename(rawPath)}.js`;
  if (isSupportedDaemonCliEntryName(requestedScriptName)) {
    return [requestedScriptName];
  }
  if (String(process.env.OPENMELD_DEV_MODE ?? "").trim() === "1") {
    return [...DAEMON_CLI_ENTRY_NAMES];
  }
  return [...DAEMON_CLI_ENTRY_NAMES].reverse();
}

function isSupportedDaemonCliEntryName(
  value: string
): value is (typeof DAEMON_CLI_ENTRY_NAMES)[number] {
  return DAEMON_CLI_ENTRY_NAMES.includes(
    value as (typeof DAEMON_CLI_ENTRY_NAMES)[number]
  );
}

function getErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}
