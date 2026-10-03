import { spawnSync } from "node:child_process";
import {
  accessSync,
  constants,
  existsSync,
  lstatSync,
  realpathSync,
} from "node:fs";
import { join, resolve, sep } from "node:path";
import { buildLaneId } from "./dev-isolated-lane.mjs";

const PATH_SEPARATOR = /[\\/]/u;

export function resolveWorktreeDevHome(repoRoot) {
  return join(
    resolve(repoRoot),
    ".turbo",
    "dev",
    "isolated",
    buildLaneId(repoRoot),
    "openmeld-home"
  );
}

export function assertNoSymlinkAncestors(path, root) {
  const segments = resolve(path)
    .slice(resolve(root).length + 1)
    .split(PATH_SEPARATOR);
  let current = resolve(root);
  for (const segment of segments) {
    current = join(current, segment);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error(`Refusing to clean a symbolic link: ${current}`);
    }
  }
}

export function manageWorktreeDevService(
  repoRoot,
  { clean = false, dryRun = false } = {}
) {
  const home = resolveWorktreeDevHome(repoRoot);
  assertNoSymlinkAncestors(home, repoRoot);
  console.log(`[dev-service] Development home: ${home}`);
  if (dryRun) {
    console.log(
      `[dev-service] Would ${clean ? "uninstall" : "stop"} only this home's Service and maintenance worker.`
    );
    return;
  }
  // A never-connected Web-only lane has no Service to stop. Do not require a
  // CLI build or create local state just to stop its frontend.
  if (!existsSync(join(home, "runtime", "daemon"))) {
    return;
  }
  const invocation = resolveWorktreeDevServiceCommand(repoRoot);
  const result = spawnSync(
    invocation.command,
    [
      ...invocation.args,
      "service",
      clean ? "uninstall" : "stop",
      "--json",
      "--view",
      "agent",
    ],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        OPENMELD_ENV_PRESET: "dev-local",
        OPENMELD_HOME: home,
      },
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 4 * 1024 * 1024,
    }
  );
  if (result.error || result.status !== 0) {
    const detail = [
      result.error?.message,
      result.stderr?.trim(),
      result.stdout?.trim(),
    ]
      .filter(Boolean)
      .join("\n");
    const termination = result.signal
      ? `signal ${result.signal}`
      : `exit code ${result.status}`;
    throw new Error(
      `Development Service ${clean ? "uninstall" : "stop"} failed (${termination}): ${detail || "No error output."}`
    );
  }
  const output = JSON.parse(result.stdout);
  if (!(clean || ["stopped", "not_running"].includes(output.status))) {
    throw new Error(
      `Development Service did not stop: ${JSON.stringify(output)}`
    );
  }
  console.log(
    `[dev-service] ${clean ? "Uninstalled" : "Stopped"} this environment's Service and maintenance worker.`
  );
}

/** Reuse a lane-installed CLI when there is no source CLI output, never PATH/global state. */
export function resolveWorktreeDevServiceCommand(repoRoot) {
  const entry = join(repoRoot, "clients/openmeld-cli/dist/openmeld-dev.js");
  if (existsSync(entry)) {
    return { command: process.execPath, args: [entry] };
  }
  const home = resolveWorktreeDevHome(repoRoot);
  assertNoSymlinkAncestors(home, repoRoot);
  const binary = join(
    home,
    "bin",
    process.platform === "win32" ? "openmeld.exe" : "openmeld"
  );
  try {
    accessSync(binary, constants.X_OK);
    if (!realpathSync(binary).startsWith(realpathSync(home) + sep)) {
      throw new Error("CLI resolves outside the owned development home.");
    }
  } catch (cause) {
    throw new Error(
      "Stopping this Service requires this lane's installed CLI or repo-local CLI output. Complete local Web setup or run pnpm turbo run build --filter=openmeld. No global CLI was invoked.",
      { cause }
    );
  }
  return { command: binary, args: [] };
}

export function listWorktreeDevData(repoRoot) {
  const laneId = buildLaneId(repoRoot);
  return [
    join(repoRoot, ".turbo", "dev", "isolated", laneId),
    join(repoRoot, ".wrangler-dev-state", "isolated", laneId),
  ];
}
