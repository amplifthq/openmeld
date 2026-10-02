import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { promisify } from "node:util";
import { resolveExecutablePathsOnPath } from "@openmeld/adapter-core";

const execFileAsync = promisify(execFile);
const PROJECT_IMAGE =
  "node:24-bookworm@sha256:64af3819f9275802414d7cdc38c27e9d82bd564dec4d4da87d008255d36c63b4";
const WORKSPACE_IN_CONTAINER = "/workspace";
const COMMAND_TIMEOUT_MS = 120_000;
const COMMAND_OUTPUT_BYTES = 128 * 1024;
const CONTAINER_NAME_PREFIX = "openmeld-claude-project-";
const CONTAINER_MISSING_RE =
  /no such container|no container with name|does not exist/iu;
const LINE_BREAK_RE = /\r?\n/u;
const CONTEXT_ID_RE = /^[a-f0-9-]{36}$/iu;

export type ClaudeProjectContainerRuntime = {
  binary: string;
  engineIdentity: string;
  kind: "docker" | "podman";
};

export async function resolveClaudeProjectContainerRuntime(): Promise<ClaudeProjectContainerRuntime> {
  for (const kind of ["docker", "podman"] as const) {
    const binary = resolveExecutablePathsOnPath(kind)[0];
    if (!binary) {
      continue;
    }
    try {
      await execFileAsync(
        binary,
        ["version", "--format", "{{.Server.Version}}"],
        {
          encoding: "utf8",
          maxBuffer: 4096,
          timeout: 5000,
          windowsHide: true,
        }
      );
      const engineIdentity = await readContainerEngineIdentity({
        binary,
        kind,
      });
      return { binary, engineIdentity, kind };
    } catch {
      // The executable is present but its local Linux-container engine is not.
    }
  }
  throw new Error("claude_project.container_runtime_unavailable");
}

export async function prepareClaudeProjectContainer(input: {
  boundaryRoot: string;
  contextId: string;
  workspacePath: string;
}): Promise<ClaudeProjectContainerRuntime> {
  const runtime = await resolveClaudeProjectContainerRuntime();
  try {
    await execFileAsync(
      runtime.binary,
      ["image", "inspect", "--format", "{{.Id}}", PROJECT_IMAGE],
      {
        encoding: "utf8",
        maxBuffer: 4096,
        timeout: 10_000,
        windowsHide: true,
      }
    );
  } catch {
    try {
      await execFileAsync(runtime.binary, ["pull", PROJECT_IMAGE], {
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
        timeout: 300_000,
        windowsHide: true,
      });
    } catch (error) {
      throw new Error("claude_project.image_unavailable", { cause: error });
    }
  }
  const workspacePath = await realpath(input.workspacePath);
  const boundaryRoot = await realpath(input.boundaryRoot);
  if (
    workspacePath !== input.workspacePath ||
    boundaryRoot !== input.boundaryRoot
  ) {
    throw new Error("claude_project.workspace_path_changed");
  }
  const relativeWorkspace = assertContainedWorkspace(
    boundaryRoot,
    workspacePath
  );
  const outsideDirectory = await mkdtemp(
    join(dirname(boundaryRoot), ".openmeld-container-probe-")
  );
  const marker = randomUUID();
  const insideName = `.openmeld-container-probe-${marker}`;
  const insidePath = join(workspacePath, insideName);
  const outsidePath = join(outsideDirectory, "outside");
  const writeName = `.openmeld-container-write-probe-${marker}`;
  const writePath = join(workspacePath, writeName);
  try {
    await writeFile(insidePath, `inside:${marker}`, {
      flag: "wx",
      mode: 0o600,
    });
    await writeFile(outsidePath, `outside:${marker}`, {
      flag: "wx",
      mode: 0o600,
    });
    const inside = await runClaudeProjectContainerCommand({
      command: `cat ${quoteShellArgument(`${WORKSPACE_IN_CONTAINER}/${relativeWorkspace}/${insideName}`)}`,
      contextId: input.contextId,
      runtime,
      boundaryRoot,
      workspacePath,
    });
    if (inside.exitCode !== 0 || inside.stdout.trim() !== `inside:${marker}`) {
      throw new Error("claude_project.inside_access_unverified");
    }
    const outside = await runClaudeProjectContainerCommand({
      command: `cat ${quoteShellArgument(outsidePath)}`,
      contextId: input.contextId,
      runtime,
      boundaryRoot,
      workspacePath,
    });
    if (
      outside.exitCode === 0 ||
      outside.stdout.includes(`outside:${marker}`)
    ) {
      throw new Error("claude_project.outside_access_unverified");
    }
    const written = await runClaudeProjectContainerCommand({
      command: `printf 'written:${marker}' > ${quoteShellArgument(`${WORKSPACE_IN_CONTAINER}/${relativeWorkspace}/${writeName}`)}`,
      contextId: input.contextId,
      runtime,
      boundaryRoot,
      workspacePath,
    });
    if (
      written.exitCode !== 0 ||
      (await readFile(writePath, "utf8")) !== `written:${marker}`
    ) {
      throw new Error("claude_project.inside_write_unverified");
    }
    return runtime;
  } finally {
    await rm(insidePath, { force: true });
    await rm(writePath, { force: true });
    await rm(outsideDirectory, { recursive: true, force: true });
  }
}

function quoteShellArgument(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export async function runClaudeProjectContainerCommand(input: {
  boundaryRoot: string;
  command: string;
  contextId: string;
  runtime: ClaudeProjectContainerRuntime;
  workspacePath: string;
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  await assertContainerEngineIdentity(input.runtime);
  const workspacePath = await realpath(input.workspacePath);
  const boundaryRoot = await realpath(input.boundaryRoot);
  if (
    workspacePath !== input.workspacePath ||
    boundaryRoot !== input.boundaryRoot
  ) {
    throw new Error("claude_project.workspace_path_changed");
  }
  const relativeWorkspace = assertContainedWorkspace(
    boundaryRoot,
    workspacePath
  );
  if (
    !isAbsolute(workspacePath) ||
    boundaryRoot.includes(",") ||
    boundaryRoot.includes("\n") ||
    boundaryRoot.includes("\r")
  ) {
    throw new Error("claude_project.workspace_path_unsupported");
  }
  if (!input.command.trim() || input.command.length > 16_000) {
    throw new Error("claude_project.command_invalid");
  }
  const name = `${containerNamePrefix(input.contextId)}${randomBytes(4).toString("hex")}`;
  const args = buildClaudeProjectContainerArgs({
    command: input.command,
    name,
    boundaryRoot,
    relativeWorkspace,
  });
  let outcome: { exitCode: number; stdout: string; stderr: string } | Error;
  try {
    const result = await execFileAsync(input.runtime.binary, args, {
      encoding: "utf8",
      maxBuffer: COMMAND_OUTPUT_BYTES,
      timeout: COMMAND_TIMEOUT_MS + 15_000,
      windowsHide: true,
    });
    outcome = { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const commandError = error as Error & {
      code?: string | number;
      stdout?: string;
      stderr?: string;
    };
    if (typeof commandError.code === "number") {
      outcome = {
        exitCode: commandError.code,
        stdout: commandError.stdout ?? "",
        stderr: commandError.stderr ?? "",
      };
    } else {
      outcome = new Error(
        `claude_project.container_command_failed: ${commandError.message}`
      );
    }
  }
  // A killed Docker/Podman client can leave its attached container running.
  // Always confirm it is gone before the task workspace may be released.
  try {
    await execFileAsync(input.runtime.binary, ["rm", "-f", name], {
      encoding: "utf8",
      maxBuffer: 4096,
      timeout: 15_000,
      windowsHide: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!CONTAINER_MISSING_RE.test(message)) {
      throw new Error(
        `claude_project.container_cleanup_unconfirmed: ${message}`,
        { cause: outcome }
      );
    }
  }
  if (outcome instanceof Error) {
    throw outcome;
  }
  return outcome;
}

export async function stopClaudeProjectContainersForContext(input: {
  contextId: string;
  runtime: ClaudeProjectContainerRuntime;
}): Promise<void> {
  await assertContainerEngineIdentity(input.runtime);
  const prefix = containerNamePrefix(input.contextId);
  let names: string[];
  try {
    const { stdout } = await execFileAsync(
      input.runtime.binary,
      ["ps", "-a", "--filter", `name=${prefix}`, "--format", "{{.Names}}"],
      {
        encoding: "utf8",
        maxBuffer: 16_384,
        timeout: 15_000,
        windowsHide: true,
      }
    );
    names = stdout
      .split(LINE_BREAK_RE)
      .filter((name) => name.startsWith(prefix));
  } catch (error) {
    throw new Error("claude_project.container_cleanup_unconfirmed", {
      cause: error,
    });
  }
  for (const name of names) {
    try {
      await execFileAsync(input.runtime.binary, ["rm", "-f", name], {
        encoding: "utf8",
        maxBuffer: 4096,
        timeout: 15_000,
        windowsHide: true,
      });
    } catch (error) {
      throw new Error("claude_project.container_cleanup_unconfirmed", {
        cause: error,
      });
    }
  }
}

async function assertContainerEngineIdentity(
  runtime: ClaudeProjectContainerRuntime
): Promise<void> {
  const current = await readContainerEngineIdentity(runtime);
  if (current !== runtime.engineIdentity) {
    throw new Error("claude_project.container_engine_changed");
  }
}

async function readContainerEngineIdentity(input: {
  binary: string;
  kind: "docker" | "podman";
}): Promise<string> {
  if (input.kind === "docker") {
    const { stdout } = await execFileAsync(
      input.binary,
      ["info", "--format", "{{.ID}}"],
      { encoding: "utf8", maxBuffer: 4096, timeout: 5000, windowsHide: true }
    );
    const identity = stdout.trim();
    if (!identity) {
      throw new Error("claude_project.container_engine_identity_missing");
    }
    return identity;
  }
  const { stdout } = await execFileAsync(
    input.binary,
    ["info", "--format", "json"],
    {
      encoding: "utf8",
      maxBuffer: 128 * 1024,
      timeout: 5000,
      windowsHide: true,
    }
  );
  const info = JSON.parse(stdout) as {
    host?: { hostname?: unknown };
    store?: { graphRoot?: unknown };
  };
  if (
    typeof info.host?.hostname !== "string" ||
    typeof info.store?.graphRoot !== "string"
  ) {
    throw new Error("claude_project.container_engine_identity_missing");
  }
  return `${info.host.hostname}:${info.store.graphRoot}`;
}

function containerNamePrefix(contextId: string): string {
  if (!CONTEXT_ID_RE.test(contextId)) {
    throw new Error("claude_project.context_id_invalid");
  }
  return `${CONTAINER_NAME_PREFIX}${contextId.replaceAll("-", "")}-`;
}

export function buildClaudeProjectContainerArgs(input: {
  command: string;
  name: string;
  boundaryRoot: string;
  relativeWorkspace: string;
}): string[] {
  if (!input.name.startsWith(CONTAINER_NAME_PREFIX)) {
    throw new Error("claude_project.container_name_invalid");
  }
  const user =
    typeof process.getuid === "function" && typeof process.getgid === "function"
      ? `${process.getuid()}:${process.getgid()}`
      : "1000:1000";
  return [
    "run",
    "--rm",
    "--pull",
    "never",
    "--name",
    input.name,
    "--network",
    "none",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--pids-limit",
    "128",
    "--memory",
    "1g",
    "--cpus",
    "2",
    "--user",
    user,
    "--mount",
    `type=bind,src=${input.boundaryRoot},dst=${WORKSPACE_IN_CONTAINER}`,
    "--workdir",
    `${WORKSPACE_IN_CONTAINER}/${input.relativeWorkspace}`,
    "--tmpfs",
    "/tmp:rw,nosuid,nodev,size=64m",
    "--env",
    "HOME=/tmp",
    "--env",
    `GIT_DIR=${WORKSPACE_IN_CONTAINER}/repository.git/worktrees/worktree`,
    "--env",
    `GIT_COMMON_DIR=${WORKSPACE_IN_CONTAINER}/repository.git`,
    "--env",
    `GIT_WORK_TREE=${WORKSPACE_IN_CONTAINER}/worktree`,
    PROJECT_IMAGE,
    "/usr/bin/timeout",
    `${Math.floor(COMMAND_TIMEOUT_MS / 1000)}s`,
    "/bin/bash",
    "-lc",
    input.command,
  ];
}

function assertContainedWorkspace(
  boundaryRoot: string,
  workspacePath: string
): string {
  const within = relative(boundaryRoot, workspacePath);
  if (
    !within ||
    within === ".." ||
    within.startsWith(`..${sep}`) ||
    isAbsolute(within)
  ) {
    throw new Error("claude_project.workspace_outside_boundary");
  }
  return within.split(sep).join("/");
}
