import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomBytes } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acquireLock,
  type OpenMeldLock,
  readLockMeta,
  releaseLock,
  runWithHeldLock,
  tryCleanupStaleLock,
} from "./lock";
import type { OpenMeldEnvPreset, OpenMeldPathResolutionInput } from "./paths";
import {
  resolveOpenMeldEnvPreset,
  resolveOpenMeldRootDir,
  resolveOpenMeldServiceOwnedPathInput,
  runtimeDir,
  systemDir,
} from "./paths";

const DAEMON_STATE_SCHEMA = "openmeld-daemon-install-v1";
export const DAEMON_SERVICE_RUNTIME_STATE_SCHEMA =
  "openmeld-daemon-service-state-v1";
export const DAEMON_SERVICE_RUNTIME_MODE_ENV = "OPENMELD_DAEMON_RUNTIME_MODE";
export const DAEMON_SERVICE_RUNTIME_DETACHED_ENV =
  "OPENMELD_DAEMON_RUNTIME_DETACHED";
export const DAEMON_SERVICE_RUNTIME_CONTROLLER_ENV =
  "OPENMELD_DAEMON_SERVICE_CONTROLLER";
export const DAEMON_SERVICE_RUNTIME_AUTO_START_ENV =
  "OPENMELD_DAEMON_SERVICE_AUTO_START";
export const DAEMON_SERVICE_RUNTIME_SYSTEM_SERVICE_ENV =
  "OPENMELD_DAEMON_RUNTIME_SYSTEM_SERVICE";
const DAEMON_TOKEN_SCHEMA = "openmeld-daemon-token-v1";
const DAEMON_TOKEN_ROTATE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const DAEMON_HEARTBEAT_STALE_MS = 3 * 60 * 1000;
const DAEMON_ACTIVE_BUNDLE_STATE_FILENAME = "active-bundle.json";
const DAEMON_DISPATCH_JOURNAL_FILENAME = "daemon-dispatch-journal.jsonl";
const DAEMON_LIFECYCLE_JOURNAL_FILENAME = "daemon-lifecycle-journal.jsonl";
const DAEMON_REPAIR_JOURNAL_FILENAME = "repair-journal.json";
const DAEMON_SERVICE_LOCK_PROFILE = "daemon-service";
const DAEMON_SERVICE_LOCK_KEY = "daemon-service-run";
type DaemonServiceLifecycleLockContext = {
  active: boolean;
  failures: unknown[];
  ownerRoot: string;
  pendingOperations: Set<Promise<void>>;
};
const daemonServiceLifecycleLockContext =
  new AsyncLocalStorage<DaemonServiceLifecycleLockContext>();
const DAEMON_STABLE_LAUNCHER_FILENAME = "daemon-service-launcher.mjs";
const DAEMON_SERVICE_EXECUTABLE_WRAPPER_FILENAME_BY_PRESET = {
  prod: "OpenMeld Service",
  "dev-local": "OpenMeld Service Dev",
  canary: "OpenMeld Service Canary",
} as const satisfies Record<OpenMeldEnvPreset, string>;
const DAEMON_SERVICE_BINARY_EXECUTABLE_FILENAME_BY_PRESET = {
  prod: "OpenMeld Service Binary",
  "dev-local": "OpenMeld Service Binary Dev",
  canary: "OpenMeld Service Binary Canary",
} as const satisfies Record<OpenMeldEnvPreset, string>;
const DAEMON_SERVICE_UPDATE_WORKER_BINARY_FILENAME_BY_PRESET = {
  prod: "OpenMeld Update Worker Binary",
  "dev-local": "OpenMeld Update Worker Binary Dev",
  canary: "OpenMeld Update Worker Binary Canary",
} as const satisfies Record<OpenMeldEnvPreset, string>;
const DAEMON_SERVICE_LEGACY_EXECUTABLE_WRAPPER_FILENAME_BY_PRESET = {
  prod: "openmeld-service",
  "dev-local": "openmeld-dev-service",
  canary: "openmeld-canary-service",
} as const satisfies Record<OpenMeldEnvPreset, string>;
export const DAEMON_SERVICE_LIFECYCLE_LOCK_PROFILE =
  DAEMON_SERVICE_LOCK_PROFILE;
export const DAEMON_SERVICE_LIFECYCLE_LOCK_KEY = DAEMON_SERVICE_LOCK_KEY;
export type DaemonServiceLifecycleLock = OpenMeldLock;

export type DaemonLifecycleIntent =
  | "run_background"
  | "run_foreground"
  | "stop"
  | "autostart"
  | "status_cleanup"
  | "startup_check"
  | "start"
  | "reinstall"
  | "uninstall"
  | "upgrade_reconcile";

export type DaemonLifecycleLockMeta = {
  intent: DaemonLifecycleIntent;
  command: string;
  pid?: number;
  sessionId?: string;
  at?: string;
};

export type DaemonInstallSource = "cli.auto_check" | "daemon.command.install";
export type DaemonRunMode = "foreground" | "background";
export type DaemonServiceController =
  | "launchd"
  | "systemd"
  | "windows-service"
  | "legacy-detached"
  | "unknown";

type BaseDaemonServiceRuntimeState = {
  mode: DaemonRunMode;
  command: string;
  gatewayUrl: string | null;
  openMeldProfileId: string | null;
  stopRequestedAt: string | null;
  startedAt: string;
  updatedAt: string;
  heartbeatAt: string | null;
  managedBySystemService: boolean;
  serviceController: DaemonServiceController;
  autoStart: boolean;
};

export type DaemonServiceRuntimeState = BaseDaemonServiceRuntimeState & {
  v: 1;
  schema: typeof DAEMON_SERVICE_RUNTIME_STATE_SCHEMA;
  status: "running";
  pid: number;
};

export type DaemonServiceRuntimeStatus = {
  status: "running" | "stale" | "not_running" | "unknown";
  mode: DaemonRunMode | null;
  pid: number | null;
  startedAt: string | null;
  updatedAt: string | null;
  managedBySystemService: boolean;
  serviceController: DaemonServiceRuntimeState["serviceController"];
  autoStart: boolean;
  reason?: string;
};

export type DaemonServiceRuntimeMetadataInput = {
  managedBySystemService?: boolean;
  serviceController?: string;
  autoStart?: boolean;
  env?: NodeJS.ProcessEnv;
};

export type DaemonServiceRuntimeMetadata = {
  managedBySystemService: boolean;
  serviceController: DaemonServiceController;
  autoStart: boolean;
};

export type DaemonInstallState = {
  v: 1;
  schema: typeof DAEMON_STATE_SCHEMA;
  daemonVersion: string;
  installSource: DaemonInstallSource;
  installedAt: string;
  updatedAt: string;
};

export type DaemonTokenState = {
  v: 1;
  schema: typeof DAEMON_TOKEN_SCHEMA;
  token: string;
  issuedAt: string;
  updatedAt: string;
};

export type DaemonInstallResult = {
  status: "installed" | "already_installed";
  state: DaemonInstallState;
};

export type DaemonUninstallResult = {
  removed: boolean;
};

export type DaemonStatus =
  | {
      installed: true;
      state: DaemonInstallState;
    }
  | {
      installed: false;
      state: null;
    };

export async function getDaemonStatus(
  pathInput: OpenMeldPathResolutionInput = {}
): Promise<DaemonStatus> {
  const [state, runtimeExists] = await Promise.all([
    readDaemonInstallState(pathInput),
    pathExists(daemonRuntimeRootPath(pathInput)),
  ]);
  if (state && runtimeExists) {
    return {
      installed: true,
      state,
    };
  }
  return {
    installed: false,
    state: null,
  };
}

export async function getDaemonRuntimeStatus(
  pathInput: OpenMeldPathResolutionInput = {}
): Promise<DaemonServiceRuntimeStatus> {
  const state = await readDaemonServiceRuntimeState(pathInput);
  if (!state) {
    return {
      status: "not_running",
      mode: null,
      pid: null,
      startedAt: null,
      updatedAt: null,
      managedBySystemService: false,
      serviceController: "unknown",
      autoStart: false,
    };
  }
  if (!Number.isInteger(state.pid) || state.pid <= 0) {
    return {
      status: "stale",
      mode: state.mode,
      pid: state.pid,
      startedAt: state.startedAt,
      updatedAt: state.updatedAt,
      managedBySystemService: state.managedBySystemService,
      serviceController: state.serviceController,
      autoStart: state.autoStart,
      reason: "invalid_pid",
    };
  }
  if (!isPidAlive(state.pid)) {
    return {
      status: "stale",
      mode: state.mode,
      pid: state.pid,
      startedAt: state.startedAt,
      updatedAt: state.updatedAt,
      managedBySystemService: state.managedBySystemService,
      serviceController: state.serviceController,
      autoStart: state.autoStart,
      reason: "process_not_alive",
    };
  }
  if (isDaemonServiceRuntimeHeartbeatStale(state)) {
    return {
      status: "stale",
      mode: state.mode,
      pid: state.pid,
      startedAt: state.startedAt,
      updatedAt: state.updatedAt,
      managedBySystemService: state.managedBySystemService,
      serviceController: state.serviceController,
      autoStart: state.autoStart,
      reason: "heartbeat_stale",
    };
  }
  return {
    status: "running",
    mode: state.mode,
    pid: state.pid,
    startedAt: state.startedAt,
    updatedAt: state.updatedAt,
    managedBySystemService: state.managedBySystemService,
    serviceController: state.serviceController,
    autoStart: state.autoStart,
  };
}

export async function readDaemonServiceRuntimeSnapshot(
  pathInput: OpenMeldPathResolutionInput = {}
): Promise<DaemonServiceRuntimeState | null> {
  return await readDaemonServiceRuntimeState(pathInput);
}

export function resolveDaemonServiceRuntimeMetadata(
  input: DaemonServiceRuntimeMetadataInput = {}
): DaemonServiceRuntimeMetadata {
  const env = input.env ?? process.env;
  const managedBySystemService =
    input.managedBySystemService === true ||
    env[DAEMON_SERVICE_RUNTIME_SYSTEM_SERVICE_ENV] === "1";
  const serviceControllerInput =
    typeof input.serviceController === "string" &&
    input.serviceController.length > 0
      ? input.serviceController
      : env[DAEMON_SERVICE_RUNTIME_CONTROLLER_ENV];
  const autoStart =
    input.autoStart === true ||
    env[DAEMON_SERVICE_RUNTIME_AUTO_START_ENV] === "1";

  return {
    managedBySystemService,
    serviceController: parseDaemonServiceController(serviceControllerInput),
    autoStart,
  };
}

export async function setDaemonServiceRuntimeState(
  state: DaemonServiceRuntimeState,
  pathInput: OpenMeldPathResolutionInput = {}
): Promise<void> {
  await writeDaemonServiceRuntimeState(state, pathInput);
}

export async function clearDaemonServiceRuntimeState(
  pathInput: OpenMeldPathResolutionInput = {}
): Promise<void> {
  const { clearDaemonRuntimeLease } = await import("./daemon-runtime-lease");
  await Promise.all([
    rm(daemonServiceRuntimeStatePath(pathInput), { force: true }),
    clearDaemonRuntimeLease(pathInput),
  ]);
}

export function withDaemonServiceRunLock<T>(
  callback: () => Promise<T>,
  meta: DaemonLifecycleLockMeta = {
    intent: "run_background",
    command: "openmeld service start",
  }
): Promise<T> {
  return withDaemonServiceLifecycleLock(meta, callback);
}

export async function acquireDaemonServiceLifecycleLock(
  meta: DaemonLifecycleLockMeta = {
    intent: "run_background",
    command: "openmeld service start",
  },
  pathResolution: OpenMeldPathResolutionInput = resolveOpenMeldServiceOwnedPathInput()
): Promise<DaemonServiceLifecycleLock> {
  return await acquireLock({
    openMeldProfileId: DAEMON_SERVICE_LIFECYCLE_LOCK_PROFILE,
    key: DAEMON_SERVICE_LIFECYCLE_LOCK_KEY,
    meta,
    pathResolution,
  });
}

export async function releaseDaemonServiceLifecycleLock(
  lock: DaemonServiceLifecycleLock
): Promise<void> {
  await releaseLock(lock);
}

export function withDaemonServiceStopLock<T>(
  callback: () => Promise<T>,
  meta: DaemonLifecycleLockMeta = {
    intent: "stop",
    command: "openmeld service stop",
  }
): Promise<T> {
  return withDaemonServiceLifecycleLock(meta, callback);
}

export function withDaemonServiceReconcileLock<T>(
  callback: () => Promise<T>,
  meta: DaemonLifecycleLockMeta = {
    intent: "upgrade_reconcile",
    command: "openmeld service update",
  }
): Promise<T> {
  return withDaemonServiceLifecycleLock(meta, callback);
}

export function withDaemonServiceRegistrationMutationLock<T>(
  callback: () => Promise<T>,
  meta: DaemonLifecycleLockMeta
): Promise<T> {
  return withDaemonServiceLifecycleLock(meta, callback);
}

export function withDaemonServiceLifecycleLock<T>(
  meta: DaemonLifecycleLockMeta,
  callback: () => Promise<T>
): Promise<T> {
  const pathResolution = resolveOpenMeldServiceOwnedPathInput();
  const ownerRoot = resolveOpenMeldRootDir(pathResolution);
  const currentContext = daemonServiceLifecycleLockContext.getStore();
  if (currentContext?.active && currentContext.ownerRoot === ownerRoot) {
    let operation: Promise<T>;
    try {
      operation = callback();
    } catch (error) {
      operation = Promise.reject(error);
    }
    let trackedOperation: Promise<void>;
    trackedOperation = operation
      .then(
        () => undefined,
        (error: unknown) => {
          currentContext.failures.push(error);
        }
      )
      .finally(() => {
        currentContext.pendingOperations.delete(trackedOperation);
      });
    currentContext.pendingOperations.add(trackedOperation);
    return operation;
  }
  return withDaemonServiceLifecycleOwnerLock({
    callback,
    meta,
    ownerRoot,
    pathResolution,
  });
}

async function withDaemonServiceLifecycleOwnerLock<T>(input: {
  callback: () => Promise<T>;
  meta: DaemonLifecycleLockMeta;
  ownerRoot: string;
  pathResolution: OpenMeldPathResolutionInput;
}): Promise<T> {
  const lock = await acquireDaemonServiceLifecycleLock(
    input.meta,
    input.pathResolution
  );
  return await runWithHeldLock({
    lock,
    run: async () => {
      const context: DaemonServiceLifecycleLockContext = {
        active: true,
        failures: [],
        ownerRoot: input.ownerRoot,
        pendingOperations: new Set(),
      };
      let outcome: { ok: true; value: T } | { ok: false; error: unknown };
      try {
        outcome = {
          ok: true,
          value: await daemonServiceLifecycleLockContext.run(
            context,
            input.callback
          ),
        };
      } catch (error) {
        outcome = { ok: false, error };
      } finally {
        while (context.pendingOperations.size > 0) {
          await Promise.all([...context.pendingOperations]);
        }
        context.active = false;
      }
      const failures = [
        ...(outcome.ok ? [] : [outcome.error]),
        ...context.failures,
      ].filter(
        (failure, index, allFailures) => allFailures.indexOf(failure) === index
      );
      if (failures.length === 1) {
        throw failures[0];
      }
      if (failures.length > 1) {
        throw new AggregateError(
          failures,
          "daemon service lifecycle mutation failed in more than one operation"
        );
      }
      if (!outcome.ok) {
        throw outcome.error;
      }
      return outcome.value;
    },
    releaseContext: {
      command: input.meta.command,
      component: "daemon_service_lifecycle",
      intent: input.meta.intent,
      lockKey: DAEMON_SERVICE_LIFECYCLE_LOCK_KEY,
      openMeldProfileId: DAEMON_SERVICE_LIFECYCLE_LOCK_PROFILE,
    },
  });
}

export async function readDaemonServiceLifecycleLockMeta(): Promise<DaemonLifecycleLockMeta | null> {
  const meta = await readLockMeta({
    openMeldProfileId: DAEMON_SERVICE_LIFECYCLE_LOCK_PROFILE,
    key: DAEMON_SERVICE_LIFECYCLE_LOCK_KEY,
    pathResolution: resolveOpenMeldServiceOwnedPathInput(),
  });
  if (!meta) {
    return null;
  }
  const intent =
    typeof meta.intent === "string"
      ? normalizeDaemonLifecycleIntent(meta.intent)
      : null;
  const command = typeof meta.command === "string" ? meta.command.trim() : "";
  if (!intent || command.length === 0) {
    return null;
  }
  const pid = typeof meta.pid === "number" ? meta.pid : undefined;
  const sessionId =
    typeof meta.sessionId === "string" && meta.sessionId.trim().length > 0
      ? meta.sessionId.trim()
      : undefined;
  const at =
    typeof meta.at === "string" && meta.at.trim().length > 0
      ? meta.at.trim()
      : undefined;
  return {
    intent,
    command,
    ...(typeof pid === "number" ? { pid } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(at ? { at } : {}),
  };
}

export async function readDaemonServiceLifecycleLockMetaWithCleanup(): Promise<DaemonLifecycleLockMeta | null> {
  await tryCleanupStaleLock({
    openMeldProfileId: DAEMON_SERVICE_LIFECYCLE_LOCK_PROFILE,
    key: DAEMON_SERVICE_LIFECYCLE_LOCK_KEY,
    pathResolution: resolveOpenMeldServiceOwnedPathInput(),
  });
  return await readDaemonServiceLifecycleLockMeta();
}

export async function installDaemon(input: {
  daemonVersion: string;
  source: DaemonInstallSource;
}): Promise<DaemonInstallResult> {
  const existingState = await readDaemonInstallState();
  const runtimeExists = await pathExists(daemonRuntimeRootPath());
  if (
    existingState &&
    runtimeExists &&
    existingState.daemonVersion === input.daemonVersion
  ) {
    await ensureDaemonTokenState();
    return {
      status: "already_installed",
      state: existingState,
    };
  }

  await ensureDaemonRuntimeLayout();
  const now = new Date().toISOString();
  const nextState: DaemonInstallState = {
    v: 1,
    schema: DAEMON_STATE_SCHEMA,
    daemonVersion: input.daemonVersion,
    installSource: input.source,
    installedAt: existingState?.installedAt ?? now,
    updatedAt: now,
  };
  await writeDaemonInstallState(nextState);
  await ensureDaemonTokenState();

  return {
    status: "installed",
    state: nextState,
  };
}

export async function uninstallDaemon(
  pathInput: OpenMeldPathResolutionInput = {}
): Promise<DaemonUninstallResult> {
  const [hasState, hasRuntimeDir, hasToken] = await Promise.all([
    pathExists(daemonStatePath(pathInput)),
    pathExists(daemonRuntimeRootPath(pathInput)),
    pathExists(daemonTokenPath(pathInput)),
  ]);

  await Promise.all([
    rm(daemonStatePath(pathInput), { force: true }),
    rm(daemonTokenPath(pathInput), { force: true }),
    rm(daemonServiceRuntimeStatePath(pathInput), { force: true }),
    rm(daemonRuntimeRootPath(pathInput), { recursive: true, force: true }),
  ]);

  return {
    removed: hasState || hasRuntimeDir || hasToken,
  };
}

export function daemonStatePath(
  pathInput: OpenMeldPathResolutionInput = {}
): string {
  return join(systemDir(pathInput), "daemon-install.json");
}

export function daemonRuntimeRootPath(
  pathInput: OpenMeldPathResolutionInput = {}
): string {
  return join(runtimeDir(pathInput), "daemon");
}

export function daemonServiceRuntimeStatePath(
  pathInput: OpenMeldPathResolutionInput = {}
): string {
  return join(daemonRuntimeRootPath(pathInput), "service-runtime.json");
}

export function daemonRuntimeDataPath(
  pathInput: OpenMeldPathResolutionInput = {}
): string {
  return join(daemonRuntimeRootPath(pathInput), "data");
}

export function daemonRuntimeBundlesPath(
  pathInput: OpenMeldPathResolutionInput = {}
): string {
  return join(daemonRuntimeRootPath(pathInput), "bundles");
}

export function daemonRuntimeStateRootPath(
  pathInput: OpenMeldPathResolutionInput = {}
): string {
  return join(daemonRuntimeRootPath(pathInput), "state");
}

export function daemonLifecycleJournalPath(
  pathInput: OpenMeldPathResolutionInput = {}
): string {
  return join(
    daemonRuntimeRootPath(pathInput),
    "logs",
    DAEMON_LIFECYCLE_JOURNAL_FILENAME
  );
}

export function daemonDispatchJournalPath(
  pathInput: OpenMeldPathResolutionInput = {}
): string {
  return join(
    daemonRuntimeRootPath(pathInput),
    "logs",
    DAEMON_DISPATCH_JOURNAL_FILENAME
  );
}

export function daemonServiceActiveBundleStatePath(
  pathInput: OpenMeldPathResolutionInput = {}
): string {
  return join(
    daemonRuntimeStateRootPath(pathInput),
    DAEMON_ACTIVE_BUNDLE_STATE_FILENAME
  );
}

export function daemonServiceRepairJournalPath(
  pathInput: OpenMeldPathResolutionInput = {}
): string {
  return join(
    daemonRuntimeStateRootPath(pathInput),
    DAEMON_REPAIR_JOURNAL_FILENAME
  );
}

export function daemonRuntimeServiceManagerPath(
  pathInput: OpenMeldPathResolutionInput = {}
): string {
  return join(daemonRuntimeRootPath(pathInput), "service-manager");
}

export function daemonServiceStableLauncherPath(
  pathInput: OpenMeldPathResolutionInput = {}
): string {
  return join(
    daemonRuntimeServiceManagerPath(pathInput),
    DAEMON_STABLE_LAUNCHER_FILENAME
  );
}

export function daemonServiceStableExecutableWrapperPath(
  pathInput: OpenMeldPathResolutionInput = {}
): string {
  const preset = resolveOpenMeldEnvPreset(pathInput);
  return join(
    daemonRuntimeServiceManagerPath(pathInput),
    DAEMON_SERVICE_EXECUTABLE_WRAPPER_FILENAME_BY_PRESET[preset]
  );
}

export function daemonServiceStableBinaryExecutablePath(
  pathInput: OpenMeldPathResolutionInput = {}
): string {
  const preset = resolveOpenMeldEnvPreset(pathInput);
  return join(
    daemonRuntimeServiceManagerPath(pathInput),
    DAEMON_SERVICE_BINARY_EXECUTABLE_FILENAME_BY_PRESET[preset]
  );
}

export function daemonServiceUpdateWorkerBinaryExecutablePath(
  pathInput: OpenMeldPathResolutionInput = {}
): string {
  const preset = resolveOpenMeldEnvPreset(pathInput);
  return join(
    daemonRuntimeServiceManagerPath(pathInput),
    DAEMON_SERVICE_UPDATE_WORKER_BINARY_FILENAME_BY_PRESET[preset]
  );
}

export function daemonServiceLegacyExecutableWrapperPath(
  pathInput: OpenMeldPathResolutionInput = {}
): string {
  const preset = resolveOpenMeldEnvPreset(pathInput);
  return join(
    daemonRuntimeServiceManagerPath(pathInput),
    DAEMON_SERVICE_LEGACY_EXECUTABLE_WRAPPER_FILENAME_BY_PRESET[preset]
  );
}

export function daemonServiceExecutableWrapperPaths(
  pathInput: OpenMeldPathResolutionInput = {}
): string[] {
  return [
    daemonServiceStableExecutableWrapperPath(pathInput),
    daemonServiceLegacyExecutableWrapperPath(pathInput),
  ];
}

export function daemonServiceRecognizedExecutablePaths(
  pathInput: OpenMeldPathResolutionInput = {}
): string[] {
  return [
    daemonServiceStableBinaryExecutablePath(pathInput),
    ...daemonServiceExecutableWrapperPaths(pathInput),
  ];
}

export function daemonTokenPath(
  pathInput: OpenMeldPathResolutionInput = {}
): string {
  return join(systemDir(pathInput), "daemon-token.json");
}

export async function restoreDaemonInstallStateSnapshot(
  snapshot: DaemonInstallState | null,
  pathInput: OpenMeldPathResolutionInput = {}
): Promise<void> {
  if (!snapshot) {
    await rm(daemonStatePath(pathInput), { force: true });
    return;
  }
  await writeDaemonInstallState(snapshot, pathInput);
}

export function resolveDaemonControlPlaneEndpoint(
  pathInput: OpenMeldPathResolutionInput = {}
): string {
  const runtimeRoot = daemonRuntimeRootPath(pathInput);
  const suffix = createHash("sha256")
    .update(runtimeRoot)
    .digest("hex")
    .slice(0, 24);
  if (process.platform === "win32") {
    return `\\\\.\\pipe\\openmeld-daemon-control-${suffix}`;
  }
  return join(tmpdir(), `openmeld-daemon-control-${suffix}.sock`);
}

export async function ensureDaemonControlPlaneToken(
  pathInput: OpenMeldPathResolutionInput = {}
): Promise<string> {
  const state = await ensureDaemonTokenState(pathInput);
  return state.token;
}

export async function rotateDaemonControlPlaneTokenIfExpired(
  pathInput: OpenMeldPathResolutionInput = {}
): Promise<DaemonTokenState> {
  const current = await readDaemonTokenState(pathInput);
  if (current && !isDaemonTokenExpired(current)) {
    await chmod(daemonTokenPath(pathInput), 0o600).catch(() => undefined);
    return current;
  }

  return await writeNewDaemonTokenState(pathInput);
}

export async function readDaemonControlPlaneToken(
  pathInput: OpenMeldPathResolutionInput = {}
): Promise<string | null> {
  const state = await readDaemonTokenState(pathInput);
  return state?.token ?? null;
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(
      error instanceof Error &&
      (error as NodeJS.ErrnoException).code === "ESRCH"
    );
  }
}

async function readDaemonServiceRuntimeState(
  pathInput: OpenMeldPathResolutionInput = {}
): Promise<DaemonServiceRuntimeState | null> {
  const raw = await readFile(
    daemonServiceRuntimeStatePath(pathInput),
    "utf8"
  ).catch((error) => {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  });
  if (raw === null) {
    return null;
  }
  return parseDaemonServiceRuntimeState(raw);
}

function parseDaemonServiceRuntimeState(
  raw: string
): DaemonServiceRuntimeState | null {
  try {
    const parsed = JSON.parse(raw);
    if (!isDaemonServiceRuntimeStateObject(parsed)) {
      return null;
    }

    return {
      v: 1,
      schema: DAEMON_SERVICE_RUNTIME_STATE_SCHEMA,
      status: "running",
      pid: parsed.pid,
      mode: parsed.mode,
      command: parsed.command,
      gatewayUrl: parseNullableString(parsed.gatewayUrl),
      openMeldProfileId: resolveStoredDaemonServiceOpenMeldProfileId(parsed),
      stopRequestedAt: parseNullableString(parsed.stopRequestedAt),
      heartbeatAt: parseNullableString(parsed.heartbeatAt),
      startedAt: parsed.startedAt,
      updatedAt: parsed.updatedAt,
      managedBySystemService: parsed.managedBySystemService === true,
      serviceController: parseDaemonServiceController(parsed.serviceController),
      autoStart: parsed.autoStart === true,
    };
  } catch {
    return null;
  }
}

function isDaemonServiceRuntimeStateObject(value: unknown): value is {
  v: 1;
  schema: string;
  status: "running";
  pid: number;
  mode: DaemonRunMode;
  command: string;
  gatewayUrl: string | null;
  openMeldProfileId?: string | null;
  profile?: string | null;
  stopRequestedAt: string | null;
  heartbeatAt: string | null;
  startedAt: string;
  updatedAt: string;
  managedBySystemService?: boolean;
  serviceController?: string;
  autoStart?: boolean;
} {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    candidate.v === 1 &&
    candidate.schema === DAEMON_SERVICE_RUNTIME_STATE_SCHEMA &&
    candidate.status === "running" &&
    typeof candidate.pid === "number" &&
    candidate.pid > 0 &&
    (candidate.mode === "foreground" || candidate.mode === "background") &&
    typeof candidate.command === "string" &&
    candidate.command.length > 0 &&
    isValidNullableString(candidate.gatewayUrl) &&
    isValidOptionalNullableString(candidate.openMeldProfileId) &&
    isValidOptionalNullableString(candidate.profile) &&
    isValidNullableString(candidate.stopRequestedAt) &&
    isValidNullableString(candidate.heartbeatAt) &&
    typeof candidate.startedAt === "string" &&
    candidate.startedAt.length > 0 &&
    typeof candidate.updatedAt === "string" &&
    candidate.updatedAt.length > 0
  );
}

export function parseDaemonServiceController(
  value: unknown
): DaemonServiceController {
  if (
    value === "launchd" ||
    value === "systemd" ||
    value === "windows-service" ||
    value === "legacy-detached" ||
    value === "unknown"
  ) {
    return value;
  }
  return "unknown";
}

function isValidNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isValidOptionalNullableString(
  value: unknown
): value is string | null | undefined {
  return value === undefined || value === null || typeof value === "string";
}

function parseNullableString(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    return null;
  }
  return value;
}

function resolveStoredDaemonServiceOpenMeldProfileId(input: {
  openMeldProfileId?: unknown;
  profile?: unknown;
}): string | null {
  const openMeldProfileId = parseNullableString(input.openMeldProfileId);
  const legacyProfile = parseNullableString(input.profile);
  if (
    openMeldProfileId &&
    legacyProfile &&
    openMeldProfileId !== legacyProfile
  ) {
    throw new Error("conflicting openMeldProfileId values");
  }
  return openMeldProfileId ?? legacyProfile;
}

export function isDaemonServiceRuntimeHeartbeatStale(
  state: DaemonServiceRuntimeState
): boolean {
  const latestSignalAt = Math.max(
    parseIsoTimestampOrZero(state.heartbeatAt),
    parseIsoTimestampOrZero(state.updatedAt)
  );
  if (latestSignalAt <= 0) {
    return false;
  }
  return Date.now() - latestSignalAt > DAEMON_HEARTBEAT_STALE_MS;
}

function parseIsoTimestampOrZero(value: string | null): number {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function writeDaemonServiceRuntimeState(
  state: DaemonServiceRuntimeState,
  pathInput: OpenMeldPathResolutionInput = {}
): Promise<void> {
  const path = daemonServiceRuntimeStatePath(pathInput);
  const runtimeRootPath = daemonRuntimeRootPath(pathInput);
  await mkdir(runtimeRootPath, { recursive: true });
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  let shouldCleanupTemp = true;

  try {
    await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(tempPath, path);
    await chmod(path, 0o600);
    shouldCleanupTemp = false;
  } finally {
    if (shouldCleanupTemp) {
      await rm(tempPath, { force: true }).catch(() => undefined);
    }
  }
}

async function ensureDaemonRuntimeLayout(): Promise<void> {
  await Promise.all([
    mkdir(systemDir(), { recursive: true }),
    mkdir(join(daemonRuntimeRootPath(), "bin"), { recursive: true }),
    mkdir(daemonRuntimeBundlesPath(), { recursive: true }),
    mkdir(join(daemonRuntimeRootPath(), "data"), { recursive: true }),
    mkdir(join(daemonRuntimeRootPath(), "logs"), { recursive: true }),
    mkdir(daemonRuntimeStateRootPath(), { recursive: true }),
    mkdir(daemonRuntimeServiceManagerPath(), { recursive: true }),
  ]);
}

function normalizeDaemonLifecycleIntent(
  value: string
): DaemonLifecycleIntent | null {
  switch (value) {
    case "run_background":
    case "run_foreground":
    case "stop":
    case "autostart":
    case "status_cleanup":
    case "startup_check":
    case "start":
    case "reinstall":
    case "uninstall":
    case "upgrade_reconcile":
      return value;
    default:
      return null;
  }
}

async function ensureDaemonTokenState(
  pathInput: OpenMeldPathResolutionInput = {}
): Promise<DaemonTokenState> {
  const current = await readDaemonTokenState(pathInput);
  if (current) {
    await chmod(daemonTokenPath(pathInput), 0o600).catch(() => undefined);
    return current;
  }

  return await writeNewDaemonTokenState(pathInput);
}

async function writeNewDaemonTokenState(
  pathInput: OpenMeldPathResolutionInput
): Promise<DaemonTokenState> {
  const nowIso = new Date().toISOString();
  const next: DaemonTokenState = {
    v: 1,
    schema: DAEMON_TOKEN_SCHEMA,
    token: createDaemonTokenValue(),
    issuedAt: nowIso,
    updatedAt: nowIso,
  };
  await writeDaemonTokenState(next, pathInput);
  return next;
}

async function readDaemonInstallState(
  pathInput: OpenMeldPathResolutionInput = {}
): Promise<DaemonInstallState | null> {
  const raw = await readFile(daemonStatePath(pathInput), "utf8").catch(
    (error) => {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return null;
      }
      throw error;
    }
  );
  if (raw === null) {
    return null;
  }
  return parseDaemonInstallState(raw);
}

function parseDaemonInstallState(raw: string): DaemonInstallState | null {
  try {
    const parsed = JSON.parse(raw) as Partial<DaemonInstallState>;
    if (parsed.v !== 1) {
      return null;
    }
    if (parsed.schema !== DAEMON_STATE_SCHEMA) {
      return null;
    }
    if (typeof parsed.daemonVersion !== "string" || !parsed.daemonVersion) {
      return null;
    }
    if (!isDaemonInstallSource(parsed.installSource)) {
      return null;
    }
    if (typeof parsed.installedAt !== "string" || !parsed.installedAt) {
      return null;
    }
    if (typeof parsed.updatedAt !== "string" || !parsed.updatedAt) {
      return null;
    }
    return {
      v: 1,
      schema: DAEMON_STATE_SCHEMA,
      daemonVersion: parsed.daemonVersion,
      installSource: parsed.installSource,
      installedAt: parsed.installedAt,
      updatedAt: parsed.updatedAt,
    };
  } catch {
    return null;
  }
}

function isDaemonInstallSource(value: unknown): value is DaemonInstallSource {
  return value === "cli.auto_check" || value === "daemon.command.install";
}

async function writeDaemonInstallState(
  state: DaemonInstallState,
  pathInput: OpenMeldPathResolutionInput = {}
): Promise<void> {
  const path = daemonStatePath(pathInput);
  await mkdir(systemDir(pathInput), { recursive: true });
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  let shouldCleanupTemp = true;

  try {
    await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(tempPath, path);
    shouldCleanupTemp = false;
  } finally {
    if (shouldCleanupTemp) {
      await rm(tempPath, { force: true }).catch(() => undefined);
    }
  }
}

async function readDaemonTokenState(
  pathInput: OpenMeldPathResolutionInput = {}
): Promise<DaemonTokenState | null> {
  const raw = await readFile(daemonTokenPath(pathInput), "utf8").catch(
    (error) => {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return null;
      }
      throw error;
    }
  );
  if (raw === null) {
    return null;
  }
  return parseDaemonTokenState(raw);
}

function parseDaemonTokenState(raw: string): DaemonTokenState | null {
  try {
    const parsed = JSON.parse(raw) as Partial<DaemonTokenState>;
    if (parsed.v !== 1 || parsed.schema !== DAEMON_TOKEN_SCHEMA) {
      return null;
    }
    if (typeof parsed.token !== "string" || parsed.token.length < 16) {
      return null;
    }
    if (typeof parsed.issuedAt !== "string" || !parsed.issuedAt) {
      return null;
    }
    if (typeof parsed.updatedAt !== "string" || !parsed.updatedAt) {
      return null;
    }
    return {
      v: 1,
      schema: DAEMON_TOKEN_SCHEMA,
      token: parsed.token,
      issuedAt: parsed.issuedAt,
      updatedAt: parsed.updatedAt,
    };
  } catch {
    return null;
  }
}

async function writeDaemonTokenState(
  state: DaemonTokenState,
  pathInput: OpenMeldPathResolutionInput = {}
): Promise<void> {
  const path = daemonTokenPath(pathInput);
  await mkdir(systemDir(pathInput), { recursive: true });
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  let shouldCleanupTemp = true;

  try {
    await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(tempPath, path);
    await chmod(path, 0o600);
    shouldCleanupTemp = false;
  } finally {
    if (shouldCleanupTemp) {
      await rm(tempPath, { force: true }).catch(() => undefined);
    }
  }
}

function isDaemonTokenExpired(state: DaemonTokenState): boolean {
  const updatedAtMs = Date.parse(state.updatedAt);
  if (!Number.isFinite(updatedAtMs)) {
    return true;
  }
  return Date.now() - updatedAtMs >= DAEMON_TOKEN_ROTATE_MAX_AGE_MS;
}

function createDaemonTokenValue(): string {
  return randomBytes(32).toString("base64url");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return false;
    }
    throw error;
  }
}
