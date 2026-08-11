import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { normalizeProcessMatchText } from "./process-matchers.mjs";
import { readProcessRows } from "./process-rows.mjs";

const ROOT_DEV_PORT_PACKAGE_PATHS = [
  "services/auth",
  "services/gateway",
  "services/remote-agent",
];
const INSPECTOR_PORT_REGEX = /--inspector-port(?:=|\s+)(\d{1,5})/u;
const LISTENING_PORT_REGEX = /:(\d{1,5})$/u;
const NEWLINE_REGEX = /\r?\n/u;
const TRAILING_SLASH_REGEX = /\/$/u;
const WINDOWS_SHELLS = ["powershell.exe", "pwsh"];
const WINDOWS_LISTENER_QUERY = [
  "-NoProfile",
  "-NonInteractive",
  "-Command",
  "Get-NetTCPConnection -State Listen | Select-Object LocalPort, OwningProcess | ConvertTo-Json -Compress",
];

export function assertRootDevPortsAvailable(options = {}) {
  const targetRepoRoot = resolve(String(options.repoRoot ?? process.cwd()));
  const portTargets =
    options.portTargets ?? readRootDevPortTargets({ repoRoot: targetRepoRoot });
  const listeningOwners =
    options.listeningOwners ??
    readListeningTcpPortOwners({
      env: options.env,
      platform: options.platform,
      ports: portTargets.map((target) => target.port),
      repoRoot: targetRepoRoot,
      spawnSyncImpl: options.spawnSyncImpl,
    });
  const targetPorts = new Set(portTargets.map((target) => target.port));
  const relevantOwners = listeningOwners.filter((owner) =>
    targetPorts.has(owner.port)
  );

  if (relevantOwners.length === 0) {
    return;
  }

  const processRows =
    options.processRows ??
    readProcessRows({
      env: options.env ?? process.env,
      platform: options.platform ?? process.platform,
      repoRoot: targetRepoRoot,
      spawnSyncImpl: options.spawnSyncImpl ?? spawnSync,
    });
  const worktreeRoots =
    options.worktreeRoots ??
    readGitWorktreeRoots({
      env: options.env,
      repoRoot: targetRepoRoot,
      spawnSyncImpl: options.spawnSyncImpl,
    });
  const processRowsByPid = new Map(processRows.map((row) => [row.pid, row]));
  const targetsByPort = new Map(
    portTargets.map((target) => [target.port, target])
  );
  const conflicts = relevantOwners
    .map((owner) => {
      const processRow = processRowsByPid.get(owner.pid);
      const command = processRow?.command ?? owner.command;
      return {
        ...owner,
        command,
        owningWorktree: findOwningWorktree(command, worktreeRoots),
        target: targetsByPort.get(owner.port),
      };
    })
    .sort((left, right) => left.port - right.port || left.pid - right.pid);

  throw new Error(formatPortConflictMessage(conflicts));
}

export function readRootDevPortTargets(options = {}) {
  const targetRepoRoot = resolve(String(options.repoRoot ?? process.cwd()));

  return ROOT_DEV_PORT_PACKAGE_PATHS.map((packagePath) => {
    const manifestPath = join(targetRepoRoot, packagePath, "package.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const devScript = manifest.scripts?.dev;
    if (typeof devScript !== "string") {
      throw new Error(
        `Root dev package ${packagePath} must define a dev script with a fixed inspector port.`
      );
    }

    const portMatch = INSPECTOR_PORT_REGEX.exec(devScript);
    const port = Number.parseInt(portMatch?.[1] ?? "", 10);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new Error(
        `Root dev package ${packagePath} must declare a valid --inspector-port in its dev script.`
      );
    }

    return {
      packageName: String(manifest.name ?? packagePath),
      packagePath,
      port,
    };
  });
}

export function readListeningTcpPortOwners(options = {}) {
  const ports = Array.from(new Set(options.ports ?? [])).sort(
    (left, right) => left - right
  );
  if (ports.length === 0) {
    return [];
  }

  const input = {
    env: options.env ?? process.env,
    repoRoot: resolve(String(options.repoRoot ?? process.cwd())),
    spawnSyncImpl: options.spawnSyncImpl ?? spawnSync,
  };
  const owners =
    (options.platform ?? process.platform) === "win32"
      ? readWindowsListeningTcpOwners(input)
      : readPosixListeningTcpOwners({ ...input, ports });
  const targetPorts = new Set(ports);
  return owners.filter((owner) => targetPorts.has(owner.port));
}

function readPosixListeningTcpOwners(input) {
  const result = input.spawnSyncImpl(
    "lsof",
    [
      "-nP",
      ...input.ports.map((port) => `-iTCP:${String(port)}`),
      "-sTCP:LISTEN",
      "-Fpcn",
    ],
    {
      cwd: input.repoRoot,
      encoding: "utf8",
      env: input.env,
    }
  );

  if (result.error) {
    throw new Error(
      `Unable to inspect root dev ports with lsof: ${toErrorMessage(result.error)}`
    );
  }
  if (result.status === 1 && String(result.stdout ?? "").trim().length === 0) {
    return [];
  }
  assertSpawnSucceeded(result, "lsof");
  return parsePosixListeningTcpOwners(result.stdout);
}

export function parsePosixListeningTcpOwners(stdout) {
  const owners = [];
  let currentPid = null;
  let currentCommand = "unknown";

  for (const rawLine of String(stdout ?? "").split(NEWLINE_REGEX)) {
    const field = rawLine.slice(0, 1);
    const value = rawLine.slice(1);

    if (field === "p") {
      currentPid = Number.parseInt(value, 10);
      currentCommand = "unknown";
      continue;
    }
    if (field === "c") {
      currentCommand = value.trim() || "unknown";
      continue;
    }
    if (field !== "n" || !Number.isInteger(currentPid)) {
      continue;
    }

    const portMatch = LISTENING_PORT_REGEX.exec(value.trim());
    const port = Number.parseInt(portMatch?.[1] ?? "", 10);
    if (Number.isInteger(port)) {
      owners.push({ command: currentCommand, pid: currentPid, port });
    }
  }

  return owners;
}

function readWindowsListeningTcpOwners(input) {
  for (const shellCommand of WINDOWS_SHELLS) {
    const result = input.spawnSyncImpl(shellCommand, WINDOWS_LISTENER_QUERY, {
      cwd: input.repoRoot,
      encoding: "utf8",
      env: input.env,
    });

    if (isMissingCommand(result)) {
      continue;
    }

    assertSpawnSucceeded(result, shellCommand);
    return parseWindowsListeningTcpOwners(result.stdout);
  }

  throw new Error(
    "Unable to inspect root dev ports: neither powershell.exe nor pwsh is available."
  );
}

function parseWindowsListeningTcpOwners(stdout) {
  const raw = String(stdout ?? "").trim();
  if (raw.length === 0) {
    return [];
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Unable to parse PowerShell listener JSON: ${toErrorMessage(error)}`
    );
  }

  const records = Array.isArray(parsed) ? parsed : [parsed];
  return records.flatMap((record) => {
    const port = Number(record?.LocalPort);
    const pid = Number(record?.OwningProcess);
    if (!(Number.isInteger(port) && Number.isInteger(pid))) {
      return [];
    }
    return [{ command: "unknown", pid, port }];
  });
}

export function readGitWorktreeRoots(options = {}) {
  const targetRepoRoot = resolve(String(options.repoRoot ?? process.cwd()));
  const result = (options.spawnSyncImpl ?? spawnSync)(
    "git",
    ["worktree", "list", "--porcelain"],
    {
      cwd: targetRepoRoot,
      encoding: "utf8",
      env: options.env ?? process.env,
    }
  );
  assertSpawnSucceeded(result, "git worktree list --porcelain");

  return String(result.stdout ?? "")
    .split(NEWLINE_REGEX)
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length).trim())
    .filter((worktreeRoot) => worktreeRoot.length > 0);
}

function findOwningWorktree(command, worktreeRoots) {
  const normalizedCommand = normalizeForOwnershipMatch(command);
  const sortedRoots = [...worktreeRoots].sort(
    (left, right) => right.length - left.length
  );

  for (const worktreeRoot of sortedRoots) {
    const normalizedRoot = normalizeForOwnershipMatch(worktreeRoot);
    if (
      normalizedCommand === normalizedRoot ||
      normalizedCommand.includes(`${normalizedRoot}/`)
    ) {
      return worktreeRoot;
    }
  }

  return null;
}

function normalizeForOwnershipMatch(value) {
  return normalizeProcessMatchText(value)
    .toLowerCase()
    .replace(TRAILING_SLASH_REGEX, "");
}

function formatPortConflictMessage(conflicts) {
  const details = conflicts.map((conflict) => {
    const targetName =
      conflict.target?.packageName ??
      `unknown package for port ${conflict.port}`;
    const owner = conflict.owningWorktree
      ? `worktree ${conflict.owningWorktree}`
      : "worktree unknown";
    return `- ${targetName} inspector port ${conflict.port}: pid ${conflict.pid}, ${owner}\n  command: ${conflict.command}`;
  });

  return [
    "Root dev ports are already owned:",
    ...details,
    "No process was stopped. This dev stack was blocked before Turbo started to protect the existing owner.",
    "Stop the stack from the reported worktree, or use that worktree's existing dev stack, then retry `pnpm dev`.",
  ].join("\n");
}

function assertSpawnSucceeded(result, command) {
  if (result.error) {
    throw new Error(`${command} failed: ${toErrorMessage(result.error)}`);
  }
  if (result.status !== 0) {
    const stderr = String(result.stderr ?? "").trim();
    throw new Error(
      stderr.length > 0
        ? `${command} failed: ${stderr}`
        : `${command} exited with status ${String(result.status)}`
    );
  }
}

function isMissingCommand(result) {
  return result.error instanceof Error && "code" in result.error
    ? result.error.code === "ENOENT"
    : false;
}

function toErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
