import { spawn } from "node:child_process";
import path from "node:path";
import { readProcessRows } from "./process-rows.mjs";
import {
  collectDescendants,
  sameProcess,
  stopProcessTree,
} from "./process-tree.mjs";

const NODE_ENTRY = /\.[cm]?js$/iu;

// Only the environment/heavy-command owner samples its tree. Component
// wrappers keep ordinary signal forwarding and do not each run a sampler.
export async function runOwnedCommand(
  command,
  args,
  { cwd = process.cwd(), env = process.env, windowsJob = false } = {}
) {
  const invocation = resolveOwnedCommandInvocation(command, args, { env });
  if (process.platform === "win32" && windowsJob) {
    return runWindowsOwnedCommand(invocation, { cwd, env });
  }
  const child = spawn(invocation.command, invocation.args, {
    cwd,
    env,
    stdio: "inherit",
  });
  const tracked = new Map();
  const observe = () => {
    const rows = readProcessRows({ repoRoot: cwd, includeMetrics: true });
    const roots = [
      ...rows
        .filter(
          (row) =>
            row.pid === child.pid &&
            row.parentPid === process.pid &&
            (!tracked.has(row.pid) || sameProcess(tracked.get(row.pid), row))
        )
        .map((row) => row.pid),
      ...rows
        .filter((row) => sameProcess(tracked.get(row.pid) ?? {}, row))
        .map((row) => row.pid),
    ];
    for (const row of collectDescendants(rows, roots, [process.pid])) {
      tracked.set(row.pid, row);
    }
  };
  let observationError;
  const sample = () => {
    try {
      observe();
    } catch (error) {
      observationError = error;
      child.kill("SIGTERM");
    }
  };
  let shutdown;
  const forward = (signal) => {
    sample();
    child.kill(signal);
    shutdown ??= stopProcessTree([...tracked.values()], {
      repoRoot: cwd,
    }).catch((error) => {
      observationError = error;
    });
  };
  const onInt = () => forward("SIGINT");
  const onTerm = () => forward("SIGTERM");
  process.on("SIGINT", onInt);
  process.on("SIGTERM", onTerm);
  const timer = setInterval(sample, 1000);
  try {
    const code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (status, signal) =>
        resolve(signal ? 1 : (status ?? 1))
      );
      sample();
    });
    if (observationError) {
      throw observationError;
    }
    return code;
  } finally {
    clearInterval(timer);
    process.off("SIGINT", onInt);
    process.off("SIGTERM", onTerm);
    await shutdown;
    await stopProcessTree([...tracked.values()], { repoRoot: cwd });
  }
}

async function runWindowsOwnedCommand(invocation, { cwd, env }) {
  const { spawnWindowsJobProcess } = await import(
    "../../runtime/adapters/core/dist/windows-process-job.js"
  );
  const job = spawnWindowsJobProcess({
    invocation: { bin: invocation.command, args: invocation.args },
    cwd,
    env,
  });
  job.child.stdin.end();
  job.child.stdout.pipe(process.stdout, { end: false });
  job.child.stderr.pipe(process.stderr, { end: false });
  const terminate = (signal) => job.terminate(signal);
  process.on("SIGINT", terminate);
  process.on("SIGTERM", terminate);
  let code;
  let commandError;
  try {
    code = await new Promise((resolve, reject) => {
      job.child.once("error", reject);
      job.child.once("close", (status, signal) =>
        resolve(signal ? 1 : (status ?? 1))
      );
    });
  } catch (error) {
    commandError = error;
  } finally {
    process.off("SIGINT", terminate);
    process.off("SIGTERM", terminate);
  }
  const cleanup = await job.cleanup();
  if (!cleanup.ok) {
    const cleanupError =
      cleanup.error ?? new Error("Windows process cleanup failed.");
    if (commandError) {
      throw new AggregateError(
        [commandError, cleanupError],
        "Windows command and process cleanup failed."
      );
    }
    throw cleanupError;
  }
  if (commandError) {
    throw commandError;
  }
  return code;
}

export function resolveOwnedCommandInvocation(
  command,
  args,
  {
    env = process.env,
    nodePath = process.execPath,
    platform = process.platform,
  } = {}
) {
  // pnpm supplies its JavaScript entrypoint to package scripts. Launch that
  // directly on Windows: .cmd shims require a shell and cannot be spawned as
  // executables. Keep arguments as an array instead of shell-interpolating them.
  const isWindowsPnpm =
    platform === "win32" && ["pnpm", "pnpm.cmd"].includes(command);
  const pnpmEntrypoint = isWindowsPnpm ? env.npm_execpath : undefined;
  if (
    isWindowsPnpm &&
    !(
      pnpmEntrypoint &&
      path.win32.isAbsolute(pnpmEntrypoint) &&
      NODE_ENTRY.test(pnpmEntrypoint)
    )
  ) {
    throw new Error(
      "Run this Windows command through a root pnpm script so the exact pnpm JavaScript entrypoint is available."
    );
  }
  return {
    args: pnpmEntrypoint ? [pnpmEntrypoint, ...args] : args,
    command: pnpmEntrypoint ? nodePath : command,
  };
}
