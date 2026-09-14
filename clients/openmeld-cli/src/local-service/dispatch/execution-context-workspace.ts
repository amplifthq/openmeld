import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  readlink,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { listAgentControllerSupervisedProcessIds } from "@openmeld/adapter-core";
import {
  executionContextAssignmentSchema,
  executionContextTaskSchema,
} from "@openmeld/schemas";
import type {
  ComputerFileAccessPolicy,
  ExecutionContextTask,
} from "@openmeld/schemas/types";
import { z } from "zod/v4";
import {
  acquireLock,
  type OpenMeldLock,
  releaseLock,
  runWithHeldLock,
} from "../../config/lock";
import { createLedgerIo } from "../state/ledger-io";

const execFileAsync = promisify(execFile);
const syncDirectory = createLedgerIo().syncPath;
const COMMIT_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const manifestSchema = z
  .strictObject({
    version: z.union([z.literal(1), z.literal(2)]),
    identity: executionContextAssignmentSchema,
    sourceWorkingDirectory: z.string().nullable(),
    baseCommit: z.string().regex(COMMIT_PATTERN).nullable(),
    boundaryRoot: z.string(),
    workingDirectory: z.string(),
    status: z.enum([
      "preparing",
      "restoring",
      "completed",
      "in_use",
      "retiring",
      "released",
    ]),
    pristineFingerprint: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .optional(),
    copiedUncommittedFiles: z.literal(false),
    processSupervisionId: z.uuid().optional(),
    retirement: z
      .strictObject({
        path: z.string(),
        pristineFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
      })
      .optional(),
  })
  .refine(
    (manifest) =>
      manifest.version === 2 ||
      ((manifest.status === "preparing" || manifest.status === "completed") &&
        !manifest.pristineFingerprint &&
        !manifest.processSupervisionId &&
        !manifest.retirement)
  )
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
  const { nativeConversationId, runtimeWorkspaceFingerprint } = parsed.data;
  const identity = executionContextAssignmentSchema.strip().parse(parsed.data);
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
  return await withWorkspaceLock(ledgerRoot, identity.id, async () => {
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
      await reconcileRetainedWorkspace(
        stored,
        recordPath,
        Boolean(runtimeWorkspaceFingerprint || nativeConversationId),
        ledgerRoot
      );
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
      version: 2,
      identity,
      sourceWorkingDirectory: source,
      baseCommit,
      boundaryRoot,
      workingDirectory,
      status: "preparing",
      copiedUncommittedFiles: false,
      processSupervisionId: randomUUID(),
    };
    // Publish the frozen base before Git starts. The process-owned lock prevents
    // a retry from racing a live materialization; retries never replace task data.
    await writeManifest(recordPath, manifest, "wx");
    await finishWorkspacePreparation(manifest, recordPath, true);
    return workspaceResult(manifest);
  });
}

async function reconcileRetainedWorkspace(
  record: Manifest,
  path: string,
  hasNativeIdentity: boolean,
  ledgerRoot: string
) {
  if (record.status === "retiring") {
    await runWithHeldLock({
      lock: await acquireWorkspaceExecutionLock(ledgerRoot, record.identity.id),
      run: async () => {
        if (
          !record.processSupervisionId ||
          (
            await listAgentControllerSupervisedProcessIds({
              fresh: true,
              processId: null,
              supervisionId: record.processSupervisionId,
            })
          ).length > 0
        ) {
          throw failure("workspace_execution_quiescence_unconfirmed");
        }
        const reconciled = await finishWorkspaceRetirement(record, path);
        if (reconciled.status === "released") {
          await restoreReleasedWorkspace(reconciled, path);
        }
      },
    });
  } else if (record.status === "released") {
    await restoreReleasedWorkspace(record, path);
  } else if (record.status === "preparing" || record.status === "restoring") {
    if (record.status === "preparing" && hasNativeIdentity) {
      throw failure("workspace_creation_incomplete");
    }
    if (
      !record.processSupervisionId ||
      (
        await listAgentControllerSupervisedProcessIds({
          fresh: true,
          processId: null,
          supervisionId: record.processSupervisionId,
        })
      ).length > 0
    ) {
      throw failure("workspace_preparation_quiescence_unconfirmed");
    }
    await finishWorkspacePreparation(record, path);
  } else if (record.status === "in_use") {
    await runWithHeldLock({
      lock: await acquireWorkspaceExecutionLock(ledgerRoot, record.identity.id),
      run: async () => {
        if (
          !record.processSupervisionId ||
          (
            await listAgentControllerSupervisedProcessIds({
              fresh: true,
              processId: null,
              supervisionId: record.processSupervisionId,
            })
          ).length > 0
        ) {
          throw failure("workspace_execution_quiescence_unconfirmed");
        }
        await verifyRetainedWorkspace(record);
        await writeManifest(path, { ...record, status: "completed" }, "r+");
      },
    });
  }
}

async function finishWorkspacePreparation(
  manifest: Manifest,
  recordPath: string,
  pristineCreation = false
) {
  const {
    boundaryRoot,
    workingDirectory,
    sourceWorkingDirectory: source,
    baseCommit,
  } = manifest;
  await ensureDirectory(boundaryRoot);
  const repository = join(boundaryRoot, "repository.git");
  if (source && baseCommit) {
    if (!(await inspectPath(repository))) {
      if ((await readdir(boundaryRoot)).length > 0) {
        throw failure("workspace_creation_incomplete");
      }
      await git(
        boundaryRoot,
        [
          "init",
          "--bare",
          "--template=",
          `--object-format=${baseCommit.length === 64 ? "sha256" : "sha1"}`,
          repository,
        ],
        manifest.processSupervisionId
      );
    }
    await canonicalDirectory(repository);
    await assertPrivateMetadata(repository);
    if (
      (await readdir(boundaryRoot)).some(
        (name) => name !== "repository.git" && name !== "worktree"
      )
    ) {
      throw failure("workspace_creation_incomplete");
    }
    if (await inspectPath(join(repository, "objects", "info", "alternates"))) {
      throw failure("workspace_git_metadata_changed");
    }
    // A protocol fetch copies only committed objects, never local files,
    // alternates or hardlinks, and never writes the source worktree registry.
    if (!(await inspectPath(workingDirectory))) {
      await git(
        boundaryRoot,
        [
          `--git-dir=${repository}`,
          "fetch",
          "--no-tags",
          "--no-recurse-submodules",
          "--depth=1",
          "--no-write-fetch-head",
          source,
          `${baseCommit}:refs/openmeld/base`,
        ],
        manifest.processSupervisionId
      );
      await git(
        boundaryRoot,
        [
          `--git-dir=${repository}`,
          "worktree",
          "add",
          "--detach",
          workingDirectory,
          baseCommit,
        ],
        manifest.processSupervisionId
      );
    }
    await verifyOwnedRepository(manifest);
    await finishMissingCheckoutFiles(manifest);
    // A prepared checkout may have survived an interruption just before the
    // completed record. Reconcile it only if it has no possible task effects.
    if (!(await isUnchangedCheckout(manifest))) {
      throw failure("workspace_creation_incomplete");
    }
  } else if ((await readdir(boundaryRoot)).length > 0) {
    throw failure("workspace_creation_incomplete");
  }
  await writeManifest(
    recordPath,
    {
      ...manifest,
      status: "completed",
      pristineFingerprint: pristineCreation
        ? await fingerprintDirectory(boundaryRoot)
        : undefined,
    },
    "r+"
  );
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
  if (manifest.status === "released" || manifest.status === "retiring") {
    // Fork reads need the frozen path association, not another live checkout.
    return workspaceResult(manifest);
  }
  if (manifest.status === "preparing" || manifest.status === "restoring") {
    throw failure("workspace_creation_incomplete");
  }
  return await verifyRetainedWorkspace(manifest);
}

export type ExecutionContextWorkspaceUse = {
  lock: OpenMeldLock;
  processSupervisionId: string;
};

export async function markExecutionContextWorkspaceInUse(input: {
  ledgerRootPath: string;
  context?: ExecutionContextTask;
}): Promise<ExecutionContextWorkspaceUse | null> {
  const context = input.context;
  if (
    !context ||
    context.workspace !== "isolated" ||
    context.access === "space_context"
  ) {
    return null;
  }
  const root = await canonicalDirectory(input.ledgerRootPath);
  const lock = await acquireWorkspaceExecutionLock(root, context.id);
  const processSupervisionId = randomUUID();
  try {
    await withWorkspaceLock(root, context.id, async () => {
      await readExecutionContextWorkspace({
        ledgerRootPath: root,
        contextId: context.id,
      });
      const path = join(
        root,
        "execution-context-workspace-records",
        `${context.id}.json`
      );
      const record = await readManifest(path);
      if (record?.status !== "completed") {
        throw failure("workspace_execution_quiescence_unconfirmed");
      }
      await writeManifest(
        path,
        { ...record, status: "in_use", processSupervisionId },
        "r+"
      );
    });
    return { lock, processSupervisionId };
  } catch (error) {
    await releaseLock(lock);
    throw error;
  }
}

export type ExecutionContextWorkspaceRelease =
  | { status: "released" }
  | {
      status: "retained";
      reason:
        | "execution_quiescence_unconfirmed"
        | "workspace_changed"
        | "baseline_unverified"
        | "cleanup_incomplete"
        | "source_commit_unavailable";
    };

export async function releaseExecutionContextWorkspace(input: {
  ledgerRootPath: string;
  context: ExecutionContextTask;
  ownedProcessesQuiescent: boolean;
  use?: ExecutionContextWorkspaceUse | null;
}): Promise<ExecutionContextWorkspaceRelease> {
  const root = await canonicalDirectory(input.ledgerRootPath);
  try {
    return await withWorkspaceLock(root, input.context.id, async () => {
      await readExecutionContextWorkspace({
        ledgerRootPath: root,
        contextId: input.context.id,
      });
      const path = join(
        root,
        "execution-context-workspace-records",
        `${input.context.id}.json`
      );
      let record = await readManifest(path);
      if (!(record && ["completed", "in_use"].includes(record.status))) {
        throw failure("workspace_creation_incomplete");
      }
      if (!input.ownedProcessesQuiescent) {
        return {
          status: "retained",
          reason: "execution_quiescence_unconfirmed",
        };
      }
      const completed: Manifest = { ...record, status: "completed" };
      await writeManifest(path, completed, "r+");
      record = await removePristineRetirement(completed, path);
      if (record.retirement) {
        return { status: "retained", reason: "cleanup_incomplete" };
      }
      // Old records have no pre-execution baseline. Never infer one from a task's
      // current files, including apparently clean commits or ignored outputs.
      if (!record.pristineFingerprint) {
        return { status: "retained", reason: "baseline_unverified" };
      }
      await verifyRetainedWorkspace(record);
      if (
        (await fingerprintDirectory(record.boundaryRoot)) !==
        record.pristineFingerprint
      ) {
        return { status: "retained", reason: "workspace_changed" };
      }
      if (record.sourceWorkingDirectory && !(await sourceHasCommit(record))) {
        return { status: "retained", reason: "source_commit_unavailable" };
      }
      const retired = await retirePristineWorkspace(record, path);
      return retired.status === "released"
        ? { status: "released" }
        : { status: "retained", reason: "workspace_changed" };
    });
  } finally {
    if (input.use) {
      await releaseLock(input.use.lock);
    }
  }
}

async function retirePristineWorkspace(
  record: Manifest,
  recordPath: string
): Promise<Manifest> {
  if (
    !record.pristineFingerprint ||
    (await fingerprintDirectory(record.boundaryRoot)) !==
      record.pristineFingerprint
  ) {
    throw failure("workspace_release_incomplete");
  }
  const retiring: Manifest = {
    ...record,
    status: "retiring",
    retirement: {
      path: `${recordPath}.retired-${randomUUID()}`,
      pristineFingerprint: record.pristineFingerprint,
    },
  };
  await writeManifest(recordPath, retiring, "r+");
  return await finishWorkspaceRetirement(retiring, recordPath);
}

async function finishWorkspaceRetirement(
  record: Manifest,
  recordPath: string
): Promise<Manifest> {
  const retirement = record.retirement;
  if (!retirement) {
    throw failure("workspace_release_incomplete");
  }
  const live = await inspectPath(record.boundaryRoot);
  const retired = await inspectPath(retirement.path);
  if ((live && retired) || !(live || retired)) {
    throw failure("workspace_release_incomplete");
  }
  if (live) {
    await moveWorkspace(record.boundaryRoot, retirement.path);
  }
  if (
    (await fingerprintDirectory(retirement.path)) !==
    retirement.pristineFingerprint
  ) {
    // The path fence caught an edit. Restore that exact copy, including its Git
    // metadata, so continuation sees the output rather than a fresh checkout.
    if (await inspectPath(record.boundaryRoot)) {
      throw failure("workspace_release_incomplete");
    }
    await moveWorkspace(retirement.path, record.boundaryRoot);
    const retained: Manifest = {
      ...record,
      retirement: undefined,
      status: "completed",
    };
    await writeManifest(recordPath, retained, "r+");
    return retained;
  }
  const released: Manifest = { ...record, status: "released" };
  await writeManifest(recordPath, released, "r+");
  return await removePristineRetirement(released, recordPath);
}

async function removePristineRetirement(
  record: Manifest,
  recordPath: string
): Promise<Manifest> {
  const retirement = record.retirement;
  if (!retirement) {
    return record;
  }
  if (await inspectPath(retirement.path)) {
    if (
      (await fingerprintDirectory(retirement.path)) !==
      retirement.pristineFingerprint
    ) {
      return record;
    }
    await rm(retirement.path, { recursive: true });
  }
  const removed = { ...record, retirement: undefined };
  await writeManifest(recordPath, removed, "r+");
  return removed;
}

async function restoreReleasedWorkspace(record: Manifest, recordPath: string) {
  if (record.sourceWorkingDirectory && !(await sourceHasCommit(record))) {
    throw failure("workspace_base_commit_unavailable");
  }
  if (await inspectPath(record.boundaryRoot)) {
    throw failure("workspace_already_exists");
  }
  const restoring: Manifest = {
    ...record,
    status: "restoring",
    processSupervisionId: randomUUID(),
  };
  await writeManifest(recordPath, restoring, "r+");
  await finishWorkspacePreparation(restoring, recordPath, true);
}

async function sourceHasCommit(record: Manifest): Promise<boolean> {
  if (!(record.sourceWorkingDirectory && record.baseCommit)) {
    return false;
  }
  try {
    await git(record.sourceWorkingDirectory, [
      "cat-file",
      "-e",
      `${record.baseCommit}^{commit}`,
    ]);
    return true;
  } catch {
    return false;
  }
}

async function isUnchangedCheckout(record: Manifest): Promise<boolean> {
  return (
    (await git(record.workingDirectory, ["rev-parse", "HEAD"])) ===
      record.baseCommit &&
    (await git(record.workingDirectory, [
      "status",
      "--porcelain",
      "--untracked-files=all",
      "--ignored",
    ])) === ""
  );
}

async function finishMissingCheckoutFiles(record: Manifest) {
  if (
    (await git(record.workingDirectory, ["rev-parse", "HEAD"])) !==
    record.baseCommit
  ) {
    throw failure("workspace_creation_incomplete");
  }
  const flags = await git(record.workingDirectory, ["ls-files", "-v", "-z"]);
  if (flags.split("\0").some((entry) => entry && !entry.startsWith("H "))) {
    throw failure("workspace_creation_incomplete");
  }
  const status = await git(record.workingDirectory, [
    "status",
    "--porcelain",
    "-z",
    "--untracked-files=all",
    "--ignored",
  ]);
  if (!status) {
    return;
  }
  const changes = status.split("\0").filter(Boolean);
  if (changes.some((entry) => !entry.startsWith(" D "))) {
    throw failure("workspace_creation_incomplete");
  }
  // checkout-index without --force writes only absent files. Existing edits,
  // staged changes and extra files were rejected, never overwritten.
  const paths = changes.map((entry) => entry.slice(3));
  for (let offset = 0; offset < paths.length; offset += 100) {
    await git(
      record.workingDirectory,
      ["checkout-index", "--", ...paths.slice(offset, offset + 100)],
      record.processSupervisionId
    );
  }
}

async function fingerprintDirectory(root: string): Promise<string> {
  const hash = createHash("sha256");
  const visit = async (directory: string) => {
    for (const name of (await readdir(directory)).sort()) {
      const path = join(directory, name);
      const info = await lstat(path);
      hash.update(
        JSON.stringify([relative(root, path), info.mode, info.nlink])
      );
      if (info.isSymbolicLink()) {
        hash.update(JSON.stringify(await readlink(path)));
      } else if (info.isDirectory()) {
        await visit(path);
      } else if (info.isFile() && info.nlink === 1) {
        hash.update(String(info.size));
        hash.update(await fingerprintFile(path));
      } else {
        throw failure("workspace_git_metadata_changed");
      }
    }
  };
  await visit(root);
  return hash.digest("hex");
}

async function fingerprintFile(path: string) {
  const hash = createHash("sha256");
  const file = await open(path, "r");
  try {
    const buffer = Buffer.alloc(64 * 1024);
    for (;;) {
      const { bytesRead } = await file.read(buffer);
      if (!bytesRead) {
        break;
      }
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    await file.close();
  }
  return hash.digest("hex");
}

async function withWorkspaceLock<T>(
  root: string,
  contextId: string,
  run: () => Promise<T>
): Promise<T> {
  if (!executionContextAssignmentSchema.shape.id.safeParse(contextId).success) {
    throw failure("invalid_workspace_context");
  }
  return await runWithHeldLock({
    lock: await acquireLock({
      openMeldProfileId: "execution-context-workspaces",
      key: contextId,
      pathResolution: { env: { OPENMELD_HOME: root } },
    }),
    run,
  });
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

async function acquireWorkspaceExecutionLock(root: string, contextId: string) {
  return await acquireLock({
    openMeldProfileId: "execution-context-workspaces",
    key: `${contextId}-execution`,
    pathResolution: { env: { OPENMELD_HOME: root } },
  });
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
  const retirement = parsed.data.retirement;
  const prefix = `${path}.retired-`;
  if (
    (parsed.data.status === "retiring" && !retirement) ||
    (retirement &&
      !(
        retirement.path.startsWith(prefix) &&
        z.uuid().safeParse(retirement.path.slice(prefix.length)).success
      ))
  ) {
    throw failure("workspace_record_invalid");
  }
  return parsed.data;
}

async function writeManifest(
  path: string,
  manifest: Manifest,
  flags: "wx" | "r+"
): Promise<void> {
  const temporaryPath = flags === "wx" ? path : `${path}.${randomUUID()}.tmp`;
  const file = await open(temporaryPath, "wx", 0o600);
  try {
    await file.writeFile(
      `${JSON.stringify({ ...manifest, version: 2 })}\n`,
      "utf8"
    );
    await file.sync();
  } finally {
    await file.close();
  }
  if (flags !== "wx") {
    await rename(temporaryPath, path);
  }
  await syncDirectory(dirname(path));
}

async function moveWorkspace(from: string, to: string) {
  await rename(from, to);
  await syncDirectory(dirname(from));
  await syncDirectory(dirname(to));
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

async function git(
  cwd: string,
  args: string[],
  processSupervisionId?: string
): Promise<string> {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))
  );
  Object.assign(env, {
    ...(processSupervisionId
      ? { OPENMELD_PROCESS_SUPERVISION_ID: processSupervisionId }
      : {}),
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
  return result.stdout.trimEnd();
}

function failure(code: string): Error {
  return new Error(`execution_context.${code}`);
}
