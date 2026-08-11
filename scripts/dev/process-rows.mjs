import { spawnSync } from "node:child_process";

const posixProcessRowRegex = /^(\d+)\s+(\d+)\s+(.+)$/;
const windowsShells = ["powershell.exe", "pwsh"];
const windowsProcessQueryArgs = [
  "-NoProfile",
  "-NonInteractive",
  "-Command",
  "Get-CimInstance Win32_Process | Select-Object @{Name='pid';Expression={$_.ProcessId}}, @{Name='parentPid';Expression={$_.ParentProcessId}}, @{Name='command';Expression={$_.CommandLine}} | ConvertTo-Json -Compress",
];

export function readProcessRows(input) {
  const {
    repoRoot,
    platform = process.platform,
    env = process.env,
    spawnSyncImpl = spawnSync,
  } = input;

  if (platform === "win32") {
    return readWindowsProcessRows({ repoRoot, env, spawnSyncImpl });
  }

  return readPosixProcessRows({ repoRoot, env, spawnSyncImpl });
}

function readPosixProcessRows(input) {
  const result = input.spawnSyncImpl("ps", ["-axo", "pid=,ppid=,command="], {
    cwd: input.repoRoot,
    env: input.env,
    encoding: "utf8",
  });
  assertSpawnSucceeded(result, "ps");

  return String(result.stdout ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map(parsePosixProcessRow)
    .filter((row) => row !== null);
}

function parsePosixProcessRow(line) {
  const match = posixProcessRowRegex.exec(line);
  if (!match) {
    return null;
  }

  return {
    pid: Number(match[1]),
    parentPid: Number(match[2]),
    command: match[3],
  };
}

function readWindowsProcessRows(input) {
  for (const shellCommand of windowsShells) {
    const result = input.spawnSyncImpl(shellCommand, windowsProcessQueryArgs, {
      cwd: input.repoRoot,
      env: input.env,
      encoding: "utf8",
    });

    if (isMissingCommand(result)) {
      continue;
    }

    assertSpawnSucceeded(result, shellCommand);
    return parseWindowsProcessRows(result.stdout);
  }

  throw new Error(
    "Unable to inspect running processes: neither powershell.exe nor pwsh is available."
  );
}

function parseWindowsProcessRows(stdout) {
  const raw = String(stdout ?? "").trim();
  if (raw.length === 0) {
    return [];
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Unable to parse PowerShell process list JSON: ${toErrorMessage(error)}`
    );
  }

  const records = Array.isArray(parsed) ? parsed : [parsed];
  return records.flatMap(normalizeWindowsProcessRow);
}

function normalizeWindowsProcessRow(record) {
  if (!record || typeof record !== "object") {
    return [];
  }

  const pid = "pid" in record ? record.pid : undefined;
  const parentPid = "parentPid" in record ? record.parentPid : undefined;
  const command = "command" in record ? record.command : undefined;
  if (typeof pid !== "number" || !Number.isFinite(pid)) {
    return [];
  }
  if (typeof parentPid !== "number" || !Number.isFinite(parentPid)) {
    return [];
  }
  if (typeof command !== "string") {
    return [];
  }

  const normalizedCommand = command.trim();
  if (normalizedCommand.length === 0) {
    return [];
  }

  return [
    {
      pid,
      parentPid,
      command: normalizedCommand,
    },
  ];
}

function assertSpawnSucceeded(result, command) {
  if (result.error) {
    throw new Error(`${command} failed: ${toErrorMessage(result.error)}`);
  }

  if (result.status !== 0) {
    const stderr = String(result.stderr ?? "").trim();
    throw new Error(
      stderr.length > 0
        ? stderr
        : `${command} exited with status ${result.status}`
    );
  }
}

function isMissingCommand(result) {
  return result.error instanceof Error && "code" in result.error
    ? result.error.code === "ENOENT"
    : false;
}

function toErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
