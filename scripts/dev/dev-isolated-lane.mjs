import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

import { readListeningTcpPortOwners } from "./dev-port-owners.mjs";
import { readProcessRows } from "./process-rows.mjs";
import { sameProcess } from "./process-tree.mjs";

const REGISTRY_VERSION = 1;
const REGISTRY_DIRECTORY_NAME = "openmeld-dev";
const REGISTRY_FILE_NAME = "isolated-lanes.json";
const REGISTRY_LOCK_NAME = "isolated-lanes.lock";
const LEGACY_REGISTRY_LOCK_OWNER_FILE_NAME = "owner.json";
const REGISTRY_LOCK_TIMEOUT_MS = 2000;
const REGISTRY_LOCK_RETRY_MS = 25;
const PORT_BLOCK_START = 28_000;
const PORT_BLOCK_SIZE = 16;
const PORT_BLOCK_COUNT = 256;
const PORT_OFFSETS = {
  web: 0,
  gateway: 1,
  auth: 2,
  remoteAgent: 3,
  cliBinary: 4,
  webInspector: 8,
  gatewayInspector: 9,
  authInspector: 10,
  coreInspector: 11,
  remoteAgentInspector: 12,
};
const ROLE_PID_KEYS = {
  stack: "stackPid",
  web: "webPid",
};

export async function reserveIsolatedDevLane(options = {}) {
  const repoRoot = resolve(String(options.repoRoot ?? process.cwd()));
  const pid = normalizePid(options.pid ?? process.pid);
  const kind = normalizeRole(options.kind);
  const startedAt =
    pid === process.pid
      ? readProcessRows({ repoRoot, includeMetrics: true }).find(
          (row) => row.pid === pid
        )?.startedAt
      : undefined;
  const isPidAlive = options.isPidAlive ?? defaultIsPidAlive;
  const gitCommonDir = resolveGitCommonDirectory({
    gitCommonDir: options.gitCommonDir,
    repoRoot,
    spawnSyncImpl: options.spawnSyncImpl,
  });
  const registryPaths = buildRegistryPaths(gitCommonDir);

  return await withRegistryLock(
    {
      ...registryPaths,
      isPidAlive,
      lockPid: pid,
      now: options.now,
    },
    () => {
      const registry = cleanRegistry(readRegistry(registryPaths.registryPath), {
        isPidAlive,
      });
      const laneId = buildLaneId(repoRoot);
      const existing = registry.lanes[laneId] ?? null;

      if (kind === "web") {
        const attached = attachWebProcess({
          existing,
          isPidAlive,
          pid,
          repoRoot,
          stackStartCommand: options.stackStartCommand ?? "pnpm dev:isolated",
        });
        attached.webStartedAt = startedAt;
        writeRegistry(registryPaths.registryPath, {
          ...registry,
          lanes: {
            ...registry.lanes,
            [laneId]: attached,
          },
        });
        ensureLaneDirectories(attached);
        return attached;
      }

      if (existing?.stackPid && isPidAlive(existing.stackPid)) {
        throw new Error(
          `Worktree ${repoRoot} already has an isolated dev stack (pid=${String(existing.stackPid)}). No process was stopped.`
        );
      }

      const listeningPortOwners =
        options.listeningPortOwners ??
        readListeningTcpPortOwners({
          env: options.env,
          platform: options.platform,
          ports: listAllIsolatedDevPorts(),
          repoRoot,
          spawnSyncImpl: options.spawnSyncImpl,
        });
      const processRows = existing?.webPid
        ? (options.processRows ??
          readProcessRows({
            env: options.env,
            platform: options.platform,
            repoRoot,
            spawnSyncImpl: options.spawnSyncImpl,
          }))
        : [];
      const ports = selectPortBlock({
        existing,
        laneId,
        listeningPortOwners,
        processRows,
        registry,
        repoRoot,
      });
      const lane = buildLaneRecord({
        existing,
        laneId,
        now: options.now,
        pid,
        ports,
        repoRoot,
      });
      lane.stackStartedAt = startedAt;

      writeRegistry(registryPaths.registryPath, {
        ...registry,
        lanes: {
          ...registry.lanes,
          [laneId]: lane,
        },
      });
      ensureLaneDirectories(lane);
      return lane;
    }
  );
}

export async function releaseIsolatedDevLane(options = {}) {
  const repoRoot = resolve(String(options.repoRoot ?? process.cwd()));
  const pid = normalizePid(options.pid ?? process.pid);
  const kind = normalizeRole(options.kind);
  const isPidAlive = options.isPidAlive ?? defaultIsPidAlive;
  const gitCommonDir = resolveGitCommonDirectory({
    gitCommonDir: options.gitCommonDir,
    repoRoot,
    spawnSyncImpl: options.spawnSyncImpl,
  });
  const registryPaths = buildRegistryPaths(gitCommonDir);

  await withRegistryLock(
    {
      ...registryPaths,
      isPidAlive,
      lockPid: pid,
      now: options.now,
    },
    () => {
      const registry = cleanRegistry(readRegistry(registryPaths.registryPath), {
        isPidAlive,
      });
      const laneId = buildLaneId(repoRoot);
      const existing = registry.lanes[laneId];
      const pidKey = ROLE_PID_KEYS[kind];

      if (!existing || existing[pidKey] !== pid) {
        writeRegistry(registryPaths.registryPath, registry);
        return;
      }

      const updated = { ...existing, [pidKey]: null };
      const lanes = { ...registry.lanes };
      if (updated.stackPid || updated.webPid) {
        lanes[laneId] = updated;
      } else {
        delete lanes[laneId];
      }
      writeRegistry(registryPaths.registryPath, { ...registry, lanes });
    }
  );
}

export function buildIsolatedDevEnvironment(lane) {
  const authUrl = buildIsolatedDevUrl(lane.laneId, lane.ports.auth);
  const gatewayUrl = buildIsolatedDevUrl(lane.laneId, lane.ports.gateway);
  const webUrl = buildIsolatedDevUrl(lane.laneId, lane.ports.web);

  return {
    AUTH_WORKER_NODE_ENV: "development",
    BETTER_AUTH_URL: authUrl,
    VITE_BETTER_AUTH_URL: authUrl,
    VITE_OPENMELD_HOME: lane.openMeldHome,
    VITE_OPENMELD_CLI_BINARY_MANIFEST_URL: `http://127.0.0.1:${lane.ports.cliBinary}/cli/manifest.json`,
    OPENMELD_CLI_BINARY_MANIFEST_URL: `http://127.0.0.1:${lane.ports.cliBinary}/cli/manifest.json`,
    OPENMELD_CLI_BINARY_DEV_PORT: String(lane.ports.cliBinary),
    OPENMELD_AUTH_URL: authUrl,
    OPENMELD_DEV_AUTH_INSPECTOR_PORT: String(lane.ports.authInspector),
    OPENMELD_DEV_AUTH_PORT: String(lane.ports.auth),
    OPENMELD_DEV_CORE_INSPECTOR_PORT: String(lane.ports.coreInspector),
    OPENMELD_DEV_GATEWAY_INSPECTOR_PORT: String(lane.ports.gatewayInspector),
    OPENMELD_DEV_GATEWAY_PORT: String(lane.ports.gateway),
    OPENMELD_DEV_ISOLATED: "1",
    OPENMELD_DEV_LANE_ID: lane.laneId,
    OPENMELD_DEV_REMOTE_AGENT_INSPECTOR_PORT: String(
      lane.ports.remoteAgentInspector
    ),
    OPENMELD_DEV_REMOTE_AGENT_PORT: String(lane.ports.remoteAgent),
    OPENMELD_DEV_WEB_INSPECTOR_PORT: String(lane.ports.webInspector),
    OPENMELD_DEV_WEB_PORT: String(lane.ports.web),
    OPENMELD_DEV_WRANGLER_STATE_DIR: lane.wranglerStateDirectory,
    OPENMELD_GATEWAY_URL: gatewayUrl,
    OPENMELD_HOME: lane.openMeldHome,
    WEB_APP_URL: webUrl,
    WRANGLER_REGISTRY_PATH: lane.wranglerRegistryPath,
  };
}

export function buildLaneId(repoRoot) {
  const digest = createHash("sha256")
    .update(resolve(String(repoRoot)))
    .digest("hex");
  return `wt-${digest.slice(0, 12)}`;
}

export function readCurrentIsolatedDevLane(repoRoot) {
  const root = resolve(repoRoot);
  const gitCommonDir = resolveGitCommonDirectory({ repoRoot: root });
  const registry = readRegistry(buildRegistryPaths(gitCommonDir).registryPath);
  const lane = registry.lanes[buildLaneId(root)];
  if (
    !lane ||
    lane.repoRoot !== root ||
    !isLivePid(lane.stackPid, defaultIsPidAlive) ||
    !Number.isInteger(lane.ports.cliBinary)
  ) {
    throw new Error(
      "Start this worktree's current Worker stack with pnpm dev:worktree before serving its CLI binary."
    );
  }
  return lane;
}

export function readIsolatedDevOwners(repoRoot, rows, gitCommonDir) {
  const registry = readRegistry(
    buildRegistryPaths(gitCommonDir ?? resolveGitCommonDirectory({ repoRoot }))
      .registryPath
  );
  const lane = registry.lanes[buildLaneId(repoRoot)];
  if (!lane || lane.repoRoot !== resolve(repoRoot)) {
    return [];
  }
  return ["stack", "web"].flatMap((kind) => {
    const row = rows.find((item) => item.pid === lane[`${kind}Pid`]);
    return sameProcess(
      { pid: lane[`${kind}Pid`], startedAt: lane[`${kind}StartedAt`] },
      row
    )
      ? [row]
      : [];
  });
}

function attachWebProcess(input) {
  if (
    !(input.existing?.stackPid && input.isPidAlive(input.existing.stackPid))
  ) {
    throw new Error(
      `Worktree ${input.repoRoot} has no live Worker stack. Start one in this worktree first with: ${input.stackStartCommand}`
    );
  }
  if (input.existing.webPid && input.isPidAlive(input.existing.webPid)) {
    throw new Error(
      `Worktree ${input.repoRoot} already has an isolated web server (pid=${String(input.existing.webPid)}). No process was stopped.`
    );
  }
  return {
    ...input.existing,
    webPid: input.pid,
  };
}

function buildLaneRecord(input) {
  const wranglerStateDirectory = join(
    input.repoRoot,
    ".wrangler-dev-state",
    "isolated",
    input.laneId
  );
  const openMeldHome = join(
    input.repoRoot,
    ".turbo",
    "dev",
    "isolated",
    input.laneId,
    "openmeld-home"
  );

  return {
    laneId: input.laneId,
    ports: input.ports,
    repoRoot: input.repoRoot,
    stackPid: input.pid,
    startedAt: new Date(input.now ?? Date.now()).toISOString(),
    openMeldHome,
    webPid: input.existing?.webPid ?? null,
    wranglerRegistryPath: join(wranglerStateDirectory, "registry"),
    wranglerStateDirectory,
  };
}

function selectPortBlock(input) {
  const occupiedPorts = new Set(
    input.listeningPortOwners.map((owner) => Number(owner.port))
  );
  for (const lane of Object.values(input.registry.lanes)) {
    if (lane.laneId === input.laneId) {
      continue;
    }
    for (const port of Object.values(lane.ports)) {
      occupiedPorts.add(port);
    }
  }

  const preferredSlot = preferredSlotForLane(input.laneId);
  const existingSlot = input.existing
    ? slotForPortBlock(input.existing.ports)
    : null;
  const hasAttachedWeb = Boolean(input.existing?.webPid);
  if (hasAttachedWeb && existingSlot === null) {
    throw new Error(
      `Worktree ${input.repoRoot} has a live isolated web server on an invalid port block. Stop the isolated Web server before restarting the stack.`
    );
  }
  const reusableAttachedWebPorts = hasAttachedWeb
    ? resolveReusableAttachedWebPorts(input)
    : new Set();
  const candidateSlots = hasAttachedWeb
    ? [existingSlot]
    : listCandidateSlots(existingSlot, preferredSlot);

  for (const slot of candidateSlots) {
    const ports = buildPortBlock(slot);
    if (
      Object.values(ports).every(
        (port) => !occupiedPorts.has(port) || reusableAttachedWebPorts.has(port)
      )
    ) {
      return ports;
    }
  }

  if (hasAttachedWeb) {
    throw new Error(
      `Worktree ${input.repoRoot} has a live isolated web server and cannot move to a different port block. Stop the isolated Web server before restarting the stack.`
    );
  }

  throw new Error(
    `No isolated OpenMeld dev port block is available for ${input.repoRoot}. No process was stopped.`
  );
}

function resolveReusableAttachedWebPorts(input) {
  const processRowsByPid = new Map(
    input.processRows.map((row) => [Number(row.pid), row])
  );
  const webPid = Number(input.existing.webPid);

  const reusablePorts = new Set();
  for (const port of [
    input.existing.ports.web,
    input.existing.ports.webInspector,
  ]) {
    const owners = input.listeningPortOwners.filter(
      (owner) => Number(owner.port) === port
    );
    if (
      owners.length > 0 &&
      owners.every((owner) =>
        isProcessDescendantOf({
          ancestorPid: webPid,
          pid: Number(owner.pid),
          processRowsByPid,
        })
      )
    ) {
      reusablePorts.add(port);
    }
  }
  return reusablePorts;
}

function isProcessDescendantOf(input) {
  const visitedPids = new Set();
  let currentPid = input.pid;

  while (Number.isInteger(currentPid) && currentPid > 0) {
    if (currentPid === input.ancestorPid) {
      return true;
    }
    if (visitedPids.has(currentPid)) {
      return false;
    }
    visitedPids.add(currentPid);
    currentPid = Number(input.processRowsByPid.get(currentPid)?.parentPid);
  }

  return false;
}

function listCandidateSlots(existingSlot, preferredSlot) {
  const slots = [];
  if (existingSlot !== null) {
    slots.push(existingSlot);
  }
  for (let offset = 0; offset < PORT_BLOCK_COUNT; offset += 1) {
    const slot = (preferredSlot + offset) % PORT_BLOCK_COUNT;
    if (!slots.includes(slot)) {
      slots.push(slot);
    }
  }
  return slots;
}

function preferredSlotForLane(laneId) {
  const digest = createHash("sha256").update(laneId).digest();
  return digest.readUInt32BE(0) % PORT_BLOCK_COUNT;
}

function buildPortBlock(slot) {
  const base = PORT_BLOCK_START + slot * PORT_BLOCK_SIZE;
  return Object.fromEntries(
    Object.entries(PORT_OFFSETS).map(([name, offset]) => [name, base + offset])
  );
}

function slotForPortBlock(ports) {
  const webPort = Number(ports?.web);
  const delta = webPort - PORT_BLOCK_START;
  if (
    !Number.isInteger(webPort) ||
    delta < 0 ||
    delta % PORT_BLOCK_SIZE !== 0
  ) {
    return null;
  }
  const slot = delta / PORT_BLOCK_SIZE;
  return slot < PORT_BLOCK_COUNT ? slot : null;
}

function listAllIsolatedDevPorts() {
  const ports = [];
  for (let slot = 0; slot < PORT_BLOCK_COUNT; slot += 1) {
    ports.push(...Object.values(buildPortBlock(slot)));
  }
  return ports;
}

function cleanRegistry(registry, options) {
  const lanes = {};
  for (const [laneId, lane] of Object.entries(registry.lanes)) {
    const stackPid = isLivePid(lane.stackPid, options.isPidAlive)
      ? lane.stackPid
      : null;
    const webPid = isLivePid(lane.webPid, options.isPidAlive)
      ? lane.webPid
      : null;
    if (stackPid || webPid) {
      lanes[laneId] = { ...lane, stackPid, webPid };
    }
  }
  return { version: REGISTRY_VERSION, lanes };
}

function readRegistry(registryPath) {
  try {
    const parsed = JSON.parse(readFileSync(registryPath, "utf8"));
    if (
      parsed?.version !== REGISTRY_VERSION ||
      !parsed.lanes ||
      typeof parsed.lanes !== "object"
    ) {
      throw new Error("unsupported registry shape");
    }
    return parsed;
  } catch (error) {
    if (isMissingFileError(error)) {
      return { version: REGISTRY_VERSION, lanes: {} };
    }
    throw new Error(
      `Unable to read isolated dev lane registry ${registryPath}: ${toErrorMessage(error)}`
    );
  }
}

function writeRegistry(registryPath, registry) {
  mkdirSync(dirname(registryPath), { recursive: true });
  const temporaryPath = `${registryPath}.${String(process.pid)}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(registry, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  renameSync(temporaryPath, registryPath);
}

function ensureLaneDirectories(lane) {
  mkdirSync(lane.openMeldHome, { recursive: true });
  mkdirSync(lane.wranglerRegistryPath, { recursive: true });
  mkdirSync(lane.wranglerStateDirectory, { recursive: true });
}

export async function withRegistryLock(input, callback) {
  const timeoutAt = Date.now() + REGISTRY_LOCK_TIMEOUT_MS;
  mkdirSync(dirname(input.lockPath), { recursive: true });

  while (true) {
    try {
      writeFileSync(
        input.lockPath,
        `${JSON.stringify({ pid: input.lockPid })}\n`,
        { encoding: "utf8", flag: "wx", mode: 0o600 }
      );
      break;
    } catch (error) {
      if (!isAlreadyExistsError(error)) {
        throw error;
      }
      if (reclaimRegistryLock(input.lockPath, input.isPidAlive)) {
        continue;
      }
      if (Date.now() >= timeoutAt) {
        throw new Error(
          "Timed out waiting for the isolated dev lane registry lock. No process was stopped."
        );
      }
      await sleep(REGISTRY_LOCK_RETRY_MS);
    }
  }

  try {
    return await callback();
  } finally {
    rmSync(input.lockPath, { force: true, recursive: true });
  }
}

function reclaimRegistryLock(lockPath, isPidAlive) {
  // Serialize stale-lock recovery as well as normal acquisition. Otherwise two
  // reclaimers can both observe a dead owner and one can delete the other's
  // newly acquired lock. A crashed recovery fails closed instead of unlocking
  // an owner whose identity cannot be proved.
  const recoveryPath = `${lockPath}.reclaim`;
  try {
    mkdirSync(recoveryPath);
  } catch (error) {
    if (isAlreadyExistsError(error)) {
      return false;
    }
    throw error;
  }
  try {
    if (!canReclaimRegistryLock(lockPath, isPidAlive)) {
      return false;
    }
    rmSync(lockPath, { force: true, recursive: true });
    return true;
  } finally {
    rmSync(recoveryPath, { recursive: true, force: true });
  }
}

function canReclaimRegistryLock(lockPath, isPidAlive) {
  try {
    const owner = JSON.parse(readRegistryLockOwner(lockPath));
    return !isLivePid(owner?.pid, isPidAlive);
  } catch {
    return false;
  }
}

function readRegistryLockOwner(lockPath) {
  try {
    return readFileSync(lockPath, "utf8");
  } catch (error) {
    if (!(error instanceof Error && "code" in error)) {
      throw error;
    }
    if (error.code !== "EISDIR") {
      throw error;
    }
    return readFileSync(
      join(lockPath, LEGACY_REGISTRY_LOCK_OWNER_FILE_NAME),
      "utf8"
    );
  }
}

function buildRegistryPaths(gitCommonDir) {
  const registryDirectory = join(gitCommonDir, REGISTRY_DIRECTORY_NAME);
  return {
    lockPath: join(registryDirectory, REGISTRY_LOCK_NAME),
    registryPath: join(registryDirectory, REGISTRY_FILE_NAME),
  };
}

export function resolveGitCommonDirectory(options) {
  if (options.gitCommonDir) {
    return resolve(String(options.gitCommonDir));
  }

  const result = (options.spawnSyncImpl ?? spawnSync)(
    "git",
    ["rev-parse", "--git-common-dir"],
    {
      cwd: options.repoRoot,
      encoding: "utf8",
      env: process.env,
    }
  );
  if (result.error || result.status !== 0) {
    throw new Error(
      `Unable to resolve git common directory: ${String(result.stderr ?? result.error ?? "unknown error").trim()}`
    );
  }

  const rawPath = String(result.stdout ?? "").trim();
  if (rawPath.length === 0) {
    throw new Error("git rev-parse returned an empty git common directory.");
  }
  return isAbsolute(rawPath)
    ? resolve(rawPath)
    : resolve(options.repoRoot, rawPath);
}

function normalizeRole(value) {
  if (value === "stack" || value === "web") {
    return value;
  }
  throw new Error('isolated dev lane kind must be "stack" or "web".');
}

function normalizePid(value) {
  const pid = Number(value);
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error("isolated dev lane pid must be a positive integer.");
  }
  return pid;
}

function isLivePid(pid, isPidAlive) {
  return Number.isInteger(pid) && pid > 0 && isPidAlive(pid);
}

function defaultIsPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function buildIsolatedDevUrl(laneId, port) {
  return `http://${laneId}.localhost:${String(port)}`;
}

function isAlreadyExistsError(error) {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

function isMissingFileError(error) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, milliseconds);
  });
}

function toErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
