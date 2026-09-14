import { execFile } from "node:child_process";
import {
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import {
  executionContextAssignmentSchema,
  executionContextTaskSchema,
} from "@openmeld/schemas";
import type {
  ComputerFileAccessPolicy,
  ExecutionContextTask,
} from "@openmeld/schemas/types";
import { z } from "zod/v4";

const execFileAsync = promisify(execFile);
const COMMIT_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const manifestSchema = z
  .strictObject({
    version: z.literal(1),
    identity: executionContextAssignmentSchema,
    sourceWorkingDirectory: z.string().nullable(),
    baseCommit: z.string().regex(COMMIT_PATTERN).nullable(),
    boundaryRoot: z.string(),
    workingDirectory: z.string(),
    status: z.enum(["preparing", "completed"]),
    copiedUncommittedFiles: z.literal(false),
  })
  .refine((manifest) =>
    manifest.identity.access === "space_context"
      ? manifest.sourceWorkingDirectory === null && manifest.baseCommit === null
      : manifest.sourceWorkingDirectory !== null &&
        isAbsolute(manifest.sourceWorkingDirectory) &&
        manifest.baseCommit !== null &&
        manifest.identity.workspace === "isolated"
  );
type Manifest = z.infer<typeof manifestSchema>;
export type ExecutionContextWorkspace = {
  workingDirectory: string;
  boundaryRoot: string;
  sourceWorkingDirectory?: string;
  baseCommit?: string;
};

export async function prepareExecutionContextWorkspace(input: {
  context: ExecutionContextTask;
  ledgerRootPath: string;
  currentWorkingDirectory: string;
  policy: ComputerFileAccessPolicy;
}): Promise<ExecutionContextWorkspace> {
  const parsed = executionContextTaskSchema.safeParse(input.context);
  if (!parsed.success) {
    throw failure("invalid_workspace_context");
  }
  const { nativeConversationId, runtimeWorkspaceFingerprint, ...identity } =
    parsed.data;
  const isProject = identity.access !== "space_context";
  const source = isProject
    ? await canonicalDirectory(input.currentWorkingDirectory)
    : null;
  if (source) {
    assertSourceAllowed(source, input.policy);
    if (identity.workspace === "current") {
      return { workingDirectory: source, boundaryRoot: source };
    }
  }

  const ledgerRoot = await ensureDirectory(input.ledgerRootPath, true);
  const workspaceRoot = await ensureDirectory(
    join(ledgerRoot, "execution-context-workspaces")
  );
  const recordsRoot = await ensureDirectory(
    join(ledgerRoot, "execution-context-workspace-records")
  );
  const boundaryRoot = join(workspaceRoot, identity.id);
  const workingDirectory = source
    ? join(boundaryRoot, "worktree")
    : boundaryRoot;
  const recordPath = join(recordsRoot, `${identity.id}.json`);
  const stored = await readManifest(recordPath);
  if (stored) {
    if (
      JSON.stringify(stored.identity) !== JSON.stringify(identity) ||
      stored.sourceWorkingDirectory !== source ||
      stored.boundaryRoot !== boundaryRoot ||
      stored.workingDirectory !== workingDirectory
    ) {
      throw failure("workspace_identity_mismatch");
    }
    if (stored.status !== "completed") {
      throw failure("workspace_creation_incomplete");
    }
    return await verifyRetainedWorkspace(stored);
  }
  if (runtimeWorkspaceFingerprint || nativeConversationId) {
    throw failure("workspace_record_missing");
  }
  if (await inspectPath(boundaryRoot)) {
    throw failure("workspace_already_exists");
  }
  const baseCommit = source ? await resolveSourceCommit(source) : null;
  const manifest: Manifest = {
    version: 1,
    identity,
    sourceWorkingDirectory: source,
    baseCommit,
    boundaryRoot,
    workingDirectory,
    status: "preparing",
    copiedUncommittedFiles: false,
  };
  // Exclusive creation arbitrates concurrent attempts; an interrupted record is
  // retained. No retry can replace a workspace with possible task effects.
  await writeManifest(recordPath, manifest, "wx");
  await mkdir(boundaryRoot, { mode: 0o700 });
  if (source && baseCommit) {
    const repository = join(boundaryRoot, "repository.git");
    await git(boundaryRoot, [
      "init",
      "--bare",
      "--template=",
      `--object-format=${baseCommit.length === 64 ? "sha256" : "sha1"}`,
      repository,
    ]);
    // A protocol fetch copies only committed objects, never local files,
    // alternates or hardlinks, and never writes the source worktree registry.
    await git(boundaryRoot, [
      `--git-dir=${repository}`,
      "fetch",
      "--no-tags",
      "--no-recurse-submodules",
      "--depth=1",
      "--no-write-fetch-head",
      source,
      `${baseCommit}:refs/openmeld/base`,
    ]);
    await git(boundaryRoot, [
      `--git-dir=${repository}`,
      "worktree",
      "add",
      "--detach",
      workingDirectory,
      baseCommit,
    ]);
    await verifyOwnedRepository(manifest);
  }
  await writeManifest(recordPath, { ...manifest, status: "completed" }, "r+");
  return workspaceResult(manifest);
}

export async function readExecutionContextWorkspace(input: {
  ledgerRootPath: string;
  contextId: string;
}): Promise<ExecutionContextWorkspace | null> {
  if (
    !executionContextAssignmentSchema.shape.id.safeParse(input.contextId)
      .success
  ) {
    throw failure("invalid_workspace_context");
  }
  if (!(await inspectPath(input.ledgerRootPath))) {
    return null;
  }
  const ledgerRoot = await canonicalDirectory(input.ledgerRootPath);
  const recordsRoot = join(ledgerRoot, "execution-context-workspace-records");
  if (!(await inspectPath(recordsRoot))) {
    return null;
  }
  await canonicalDirectory(recordsRoot);
  const manifest = await readManifest(
    join(recordsRoot, `${input.contextId}.json`)
  );
  if (!manifest) {
    return null;
  }
  const workspaceRoot = await canonicalDirectory(
    join(ledgerRoot, "execution-context-workspaces")
  );
  const boundaryRoot = join(workspaceRoot, input.contextId);
  const isProject = manifest.identity.access !== "space_context";
  const workingDirectory = isProject
    ? join(boundaryRoot, "worktree")
    : boundaryRoot;
  if (
    manifest.identity.id !== input.contextId ||
    manifest.boundaryRoot !== boundaryRoot ||
    manifest.workingDirectory !== workingDirectory
  ) {
    throw failure("workspace_identity_mismatch");
  }
  if (manifest.status !== "completed") {
    throw failure("workspace_creation_incomplete");
  }
  return await verifyRetainedWorkspace(manifest);
}

async function verifyRetainedWorkspace(
  manifest: Manifest
): Promise<ExecutionContextWorkspace> {
  await canonicalDirectory(manifest.boundaryRoot);
  await canonicalDirectory(manifest.workingDirectory);
  if (manifest.sourceWorkingDirectory) {
    await verifyOwnedRepository(manifest);
  }
  return workspaceResult(manifest);
}

function workspaceResult(manifest: Manifest): ExecutionContextWorkspace {
  return {
    workingDirectory: manifest.workingDirectory,
    boundaryRoot: manifest.boundaryRoot,
    ...(manifest.sourceWorkingDirectory
      ? { sourceWorkingDirectory: manifest.sourceWorkingDirectory }
      : {}),
    ...(manifest.baseCommit ? { baseCommit: manifest.baseCommit } : {}),
  };
}

function assertSourceAllowed(
  source: string,
  policy: ComputerFileAccessPolicy
): void {
  if (
    policy.mode === "only_selected_folders" &&
    !policy.folders.some((folder) => within(source, folder))
  ) {
    throw failure("workspace_outside_computer_policy");
  }
  if (
    policy.mode === "block_selected_folders" &&
    policy.folders.some(
      (folder) => within(source, folder) || within(folder, source)
    )
  ) {
    throw failure("workspace_overlaps_blocked_folder");
  }
}

async function resolveSourceCommit(source: string): Promise<string> {
  // Requiring a marker at the selected root prevents Git's upward discovery
  // from escalating a selected subdirectory into the surrounding repository.
  if (!(await inspectPath(join(source, ".git")))) {
    throw failure("project_repository_required");
  }
  const topLevel = await git(source, ["rev-parse", "--show-toplevel"]);
  if ((await realpath(topLevel)) !== source) {
    throw failure("project_repository_root_required");
  }
  const commit = await git(source, [
    "rev-parse",
    "--verify",
    "HEAD^{commit}",
  ]).catch((cause: unknown) => {
    throw new Error("execution_context.project_commit_required", { cause });
  });
  if (!COMMIT_PATTERN.test(commit)) {
    throw failure("project_commit_required");
  }
  return commit;
}

async function verifyOwnedRepository(manifest: Manifest): Promise<void> {
  const repository = join(manifest.boundaryRoot, "repository.git");
  await canonicalDirectory(repository);
  await assertPrivateMetadata(repository);
  if (await inspectPath(join(repository, "objects", "info", "alternates"))) {
    throw failure("workspace_git_metadata_changed");
  }
  const gitFile = join(manifest.workingDirectory, ".git");
  const gitFileInfo = await inspectPath(gitFile);
  if (!gitFileInfo?.isFile() || gitFileInfo.size > 4096) {
    throw failure("workspace_git_metadata_changed");
  }
  const expectedGitDir = join(repository, "worktrees", "worktree");
  if (
    (await readFile(gitFile, "utf8")).trim() !== `gitdir: ${expectedGitDir}`
  ) {
    throw failure("workspace_git_metadata_changed");
  }
  if (
    (await realpath(
      join(
        expectedGitDir,
        (await readFile(join(expectedGitDir, "commondir"), "utf8")).trim()
      )
    )) !== repository
  ) {
    throw failure("workspace_git_metadata_changed");
  }
  const base = await git(manifest.boundaryRoot, [
    `--git-dir=${repository}`,
    "rev-parse",
    "--verify",
    "refs/openmeld/base^{commit}",
  ]);
  if (base !== manifest.baseCommit) {
    throw failure("workspace_base_commit_changed");
  }
}

async function assertPrivateMetadata(path: string): Promise<void> {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) {
      throw failure("workspace_is_symlink");
    }
    if (entry.isDirectory()) {
      await assertPrivateMetadata(join(path, entry.name));
    } else if ((await lstat(join(path, entry.name))).nlink !== 1) {
      throw failure("workspace_git_metadata_changed");
    }
  }
}

async function readManifest(path: string): Promise<Manifest | null> {
  const info = await inspectPath(path);
  if (!info) {
    return null;
  }
  if (!info.isFile() || info.size > 32_768) {
    throw failure("workspace_record_invalid");
  }
  let content: unknown;
  try {
    content = JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw failure("workspace_record_invalid");
  }
  const parsed = manifestSchema.safeParse(content);
  if (!parsed.success) {
    throw failure("workspace_record_invalid");
  }
  return parsed.data;
}

async function writeManifest(
  path: string,
  manifest: Manifest,
  flags: "wx" | "r+"
): Promise<void> {
  const file = await open(path, flags, 0o600);
  try {
    await file.truncate(0);
    await file.writeFile(`${JSON.stringify(manifest)}\n`, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }
}

async function inspectPath(path: string) {
  const info = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  });
  if (info?.isSymbolicLink()) {
    throw failure("workspace_is_symlink");
  }
  return info;
}

async function canonicalDirectory(path: string): Promise<string> {
  if (!(await inspectPath(path))?.isDirectory()) {
    throw failure("workspace_directory_unavailable");
  }
  return await realpath(path);
}

async function ensureDirectory(
  path: string,
  recursive = false
): Promise<string> {
  await inspectPath(path);
  await mkdir(path, { recursive, mode: 0o700 }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") {
        throw error;
      }
    }
  );
  return await canonicalDirectory(path);
}

function within(child: string, parent: string): boolean {
  const path = relative(resolve(parent), child);
  return (
    path === "" ||
    (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path))
  );
}

const GIT_SETTINGS = {
  "core.hooksPath": "/dev/null",
  "core.attributesFile": "/dev/null",
  "core.fsmonitor": "false",
  "credential.helper": "",
  "protocol.allow": "never",
  "protocol.file.allow": "always",
  "fetch.recurseSubmodules": "false",
  "submodule.recurse": "false",
  "uploadpack.packObjectsHook": "",
  "gc.auto": "0",
  "maintenance.auto": "false",
};

async function git(cwd: string, args: string[]): Promise<string> {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))
  );
  Object.assign(env, {
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_ATTR_NOSYSTEM: "1",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_NO_LAZY_FETCH: "1",
    GIT_ALLOW_PROTOCOL: "file",
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_COUNT: String(Object.keys(GIT_SETTINGS).length),
  });
  for (const [index, [key, value]] of Object.entries(GIT_SETTINGS).entries()) {
    env[`GIT_CONFIG_KEY_${index}`] = key;
    env[`GIT_CONFIG_VALUE_${index}`] = value;
  }
  const result = await execFileAsync("git", args, {
    cwd,
    env,
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
  return result.stdout.trim();
}

function failure(code: string): Error {
  return new Error(`execution_context.${code}`);
}
