import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  chmod,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { resolveOpenMeldRootDir } from "../config/paths";
import { touchDaemonCatalogSyncSignal } from "../local-service/state/catalog-sync-signal";
import {
  withAgentActivityDeliveryLock,
  withAgentActivityLocalStateLock,
} from "./local-state-lock";
import {
  canonicalizeLocalProjectPath,
  findExactLocalProjectConnection,
  isProjectConnectionUsableByOwner,
  resolveCanonicalLocalProjectConnection,
} from "./project-binding-resolution";

const LEGACY_STORE_VERSION = 2 as const;
const PREVIOUS_STORE_VERSION = 3 as const;
export const PROJECT_BINDING_STORE_VERSION = 4 as const;
const REPOSITORY_FINGERPRINT_PATTERN = /^sha256:[a-f0-9]{64}$/u;

export type ProjectBinding = {
  bindingGeneration: string;
  boundAtMs: number;
  organizationId: string;
  ownerUserId?: string;
  projectId: string;
  projectSlug: string;
  repositoryFingerprint: string | null;
  repositoryPath: string;
  isDefault: boolean;
};

export type ProjectBindingV4 = ProjectBinding;

export type ProjectBindingStoreV4 = {
  bindings: ProjectBindingV4[];
  version: typeof PROJECT_BINDING_STORE_VERSION;
};

export type ProjectBindingMoveImpact =
  | "additional_connection"
  | "default_connection"
  | "only_connection";

export type ProjectBindingPathConflict = {
  conflictingProjectSlug: string;
  conflictScope: "another_organization" | "same_organization";
  moveConfirmationToken: string;
  shareConfirmationToken?: string;
  moveImpact: ProjectBindingMoveImpact;
};

export class ProjectBindingStoreUpdateRequiredError extends Error {
  readonly code = "project_bindings.update_required" as const;

  constructor(path: string, version: number) {
    super(
      `Project binding store version ${version} requires a newer OpenMeld version on this computer: ${path}`
    );
    this.name = "ProjectBindingStoreUpdateRequiredError";
  }
}

export type ProjectBindingOperationErrorCode =
  | "binding_generation_stale"
  | "default_missing_requires_replacement"
  | "owner_mismatch"
  | "path_conflict"
  | "path_not_directory"
  | "path_not_found"
  | "path_unreadable"
  | "replacement_invalid"
  | "replacement_required";

export class ProjectBindingOperationError extends Error {
  readonly code: ProjectBindingOperationErrorCode;
  readonly conflictingProjectSlug?: string;
  readonly pathConflict?: ProjectBindingPathConflict;

  constructor(
    code: ProjectBindingOperationErrorCode,
    message: string,
    options: {
      conflictingProjectSlug?: string;
      pathConflict?: ProjectBindingPathConflict;
    } = {}
  ) {
    super(message);
    this.name = "ProjectBindingOperationError";
    this.code = code;
    this.pathConflict = options.pathConflict;
    this.conflictingProjectSlug =
      options.pathConflict?.conflictingProjectSlug ??
      options.conflictingProjectSlug;
  }
}

type ProjectBindingStore = ProjectBindingStoreV4 & {
  sourceVersion: 1 | 2 | 3 | 4 | null;
};

type StoreLocationInput = { rootDir?: string };

export async function listProjectBindings(
  input: StoreLocationInput & { organizationId?: string }
): Promise<ProjectBinding[]> {
  const store = await readStore(input);
  return store.bindings
    .filter(
      (binding) =>
        input.organizationId === undefined ||
        binding.organizationId === input.organizationId
    )
    .sort((left, right) => left.projectSlug.localeCompare(right.projectSlug));
}

export async function listProjectConnectionsWithStatus(
  input: StoreLocationInput & { organizationId?: string }
): Promise<Array<ProjectBinding & { status: "available" | "missing" }>> {
  return await Promise.all(
    (await listProjectBindings(input)).map(async (binding) => {
      return {
        ...binding,
        status: (await projectConnectionDirectoryExists(binding.repositoryPath))
          ? ("available" as const)
          : ("missing" as const),
      };
    })
  );
}

export async function bindProject(
  input: StoreLocationInput & {
    boundAtMs?: number;
    moveConfirmationToken?: string;
    shareConfirmationToken?: string;
    organizationId: string;
    ownerUserId?: string;
    projectId: string;
    projectSlug: string;
    repositoryFingerprint: string | null;
    repositoryPath: string;
  }
): Promise<ProjectBinding> {
  return await withAgentActivityDeliveryLock(
    input,
    async () =>
      await withAgentActivityLocalStateLock(input, async () => {
        const store = await readStore(input);
        const repositoryPath = await requireRepositoryDirectory(
          input.repositoryPath
        );
        const organizationId = requireText(
          input.organizationId,
          "organizationId"
        );
        const ownerUserId = input.ownerUserId
          ? requireText(input.ownerUserId, "ownerUserId")
          : undefined;
        const projectId = requireText(input.projectId, "projectId");
        const projectSlug = requireText(input.projectSlug, "projectSlug");
        const repositoryFingerprint = normalizeFingerprint(
          input.repositoryFingerprint
        );
        const existingProjectConnections = store.bindings.filter(
          (current) =>
            current.organizationId === organizationId &&
            current.projectId === projectId
        );
        if (
          existingProjectConnections.some(
            (current) => !isProjectConnectionUsableByOwner(current, ownerUserId)
          )
        ) {
          throw new ProjectBindingOperationError(
            "owner_mismatch",
            "This Project has local connections under another OpenMeld account."
          );
        }
        const existingConnection = findExactLocalProjectConnection({
          canonicalPath: repositoryPath,
          connections: store.bindings,
          organizationId,
          projectId,
        });
        if (
          existingConnection &&
          existingConnection.projectSlug === projectSlug &&
          existingConnection.repositoryFingerprint === repositoryFingerprint &&
          existingConnection.ownerUserId === ownerUserId
        ) {
          return existingConnection;
        }
        const binding: ProjectBinding = {
          bindingGeneration: randomUUID(),
          boundAtMs: input.boundAtMs ?? Date.now(),
          isDefault:
            existingConnection?.isDefault ??
            existingProjectConnections.length === 0,
          organizationId,
          ...(ownerUserId ? { ownerUserId } : {}),
          projectId,
          projectSlug,
          repositoryFingerprint,
          repositoryPath,
        };
        const conflictingBinding = store.bindings.find(
          (current) =>
            current.repositoryPath === binding.repositoryPath &&
            (current.organizationId !== organizationId ||
              current.projectId !== projectId)
        );
        if (
          existingConnection?.ownerUserId &&
          existingConnection.ownerUserId !== ownerUserId
        ) {
          throw new ProjectBindingOperationError(
            "owner_mismatch",
            "This folder is connected under another OpenMeld account. The current account cannot take over that connection."
          );
        }
        const bindings = prepareBindingsForProjectConnection({
          bindings: store.bindings,
          conflictingBinding,
          existingConnection,
          moveConfirmationToken: input.moveConfirmationToken,
          shareConfirmationToken: input.shareConfirmationToken,
          requestedOrganizationId: organizationId,
          requestedOwnerUserId: ownerUserId,
          requestedProjectId: projectId,
          requestedRepositoryPath: repositoryPath,
        });
        bindings.push(binding);
        await writeStore(input, {
          bindings,
          version: PROJECT_BINDING_STORE_VERSION,
        });
        return binding;
      })
  );
}

function buildProjectBindingPathConflict(
  bindings: readonly ProjectBinding[],
  conflictingBinding: ProjectBinding,
  requestedDestination: {
    organizationId: string;
    ownerUserId?: string;
    projectId: string;
    repositoryPath: string;
  }
): ProjectBindingPathConflict {
  const conflictingProjectConnections = bindings
    .filter(
      (binding) =>
        binding.organizationId === conflictingBinding.organizationId &&
        binding.projectId === conflictingBinding.projectId
    )
    .sort(compareProjectBindings);
  const pathConnections = bindings
    .filter(
      (binding) =>
        binding.repositoryPath === requestedDestination.repositoryPath
    )
    .sort(compareProjectBindings);
  let moveImpact: ProjectBindingMoveImpact = "additional_connection";
  if (conflictingProjectConnections.length === 1) {
    moveImpact = "only_connection";
  } else if (conflictingBinding.isDefault) {
    moveImpact = "default_connection";
  }
  const moveConfirmationToken = createHash("sha256")
    .update(
      JSON.stringify({
        connections: conflictingProjectConnections.map((connection) => ({
          bindingGeneration: connection.bindingGeneration,
          isDefault: connection.isDefault,
        })),
        conflictingBindingGeneration: conflictingBinding.bindingGeneration,
        pathConnections: pathConnections.map(
          (connection) => connection.bindingGeneration
        ),
        organizationId: conflictingBinding.organizationId,
        projectId: conflictingBinding.projectId,
        requestedOrganizationId: requestedDestination.organizationId,
        requestedProjectId: requestedDestination.projectId,
        requestedRepositoryPath: requestedDestination.repositoryPath,
      })
    )
    .digest("hex");
  return {
    conflictingProjectSlug: conflictingBinding.projectSlug,
    conflictScope:
      conflictingBinding.organizationId === requestedDestination.organizationId
        ? "same_organization"
        : "another_organization",
    moveConfirmationToken,
    ...(conflictingBinding.organizationId ===
      requestedDestination.organizationId &&
    conflictingBinding.ownerUserId &&
    conflictingBinding.ownerUserId === requestedDestination.ownerUserId
      ? {
          shareConfirmationToken: createHash("sha256")
            .update(`share:${moveConfirmationToken}`)
            .digest("hex"),
        }
      : {}),
    moveImpact,
  };
}

function prepareBindingsForProjectConnection(input: {
  bindings: readonly ProjectBinding[];
  conflictingBinding: ProjectBinding | undefined;
  existingConnection: ProjectBinding | null;
  moveConfirmationToken: string | undefined;
  shareConfirmationToken: string | undefined;
  requestedOrganizationId: string;
  requestedOwnerUserId: string | undefined;
  requestedProjectId: string;
  requestedRepositoryPath: string;
}): ProjectBinding[] {
  if (!input.conflictingBinding) {
    return input.bindings.filter(
      (binding) => binding !== input.existingConnection
    );
  }
  if (
    input.conflictingBinding.ownerUserId &&
    input.conflictingBinding.ownerUserId !== input.requestedOwnerUserId
  ) {
    throw new ProjectBindingOperationError(
      "owner_mismatch",
      "This folder is connected under another OpenMeld account. The current account cannot move or share that connection."
    );
  }
  const pathConflict = buildProjectBindingPathConflict(
    input.bindings,
    input.conflictingBinding,
    {
      organizationId: input.requestedOrganizationId,
      ownerUserId: input.requestedOwnerUserId,
      projectId: input.requestedProjectId,
      repositoryPath: input.requestedRepositoryPath,
    }
  );
  if (input.shareConfirmationToken) {
    if (
      pathConflict.conflictScope !== "same_organization" ||
      input.shareConfirmationToken !== pathConflict.shareConfirmationToken ||
      !input.requestedOwnerUserId ||
      input.conflictingBinding.ownerUserId !== input.requestedOwnerUserId
    ) {
      throw new ProjectBindingOperationError(
        "binding_generation_stale",
        "The folder connections changed before sharing was confirmed. Check this computer again."
      );
    }
    return input.bindings.filter(
      (binding) => binding !== input.existingConnection
    );
  }
  if (input.moveConfirmationToken !== pathConflict.moveConfirmationToken) {
    if (input.moveConfirmationToken) {
      throw new ProjectBindingOperationError(
        "binding_generation_stale",
        "The folder connection changed before the move was confirmed. Check this computer again."
      );
    }
    const location =
      pathConflict.conflictScope === "same_organization"
        ? `the “${input.conflictingBinding.projectSlug}” Project`
        : `the “${input.conflictingBinding.projectSlug}” Project in another Organization`;
    throw new ProjectBindingOperationError(
      "path_conflict",
      `This folder is already connected to ${location}.`,
      { pathConflict }
    );
  }
  if (
    input.bindings.filter(
      (binding) => binding.repositoryPath === input.requestedRepositoryPath
    ).length > 1
  ) {
    throw new ProjectBindingOperationError(
      "path_conflict",
      "This shared folder has more than one Project use. Remove its existing connections before moving it.",
      { pathConflict }
    );
  }
  return removeConflictingBindingAndRestoreDefault(
    input.bindings.filter((binding) => binding !== input.existingConnection),
    input.conflictingBinding
  );
}

function removeConflictingBindingAndRestoreDefault(
  bindings: readonly ProjectBinding[],
  conflictingBinding: ProjectBinding | undefined
): ProjectBinding[] {
  if (!conflictingBinding) {
    return [...bindings];
  }
  const remaining = bindings.filter(
    (binding) =>
      binding.bindingGeneration !== conflictingBinding.bindingGeneration
  );
  if (!conflictingBinding.isDefault) {
    return remaining;
  }
  const replacement = remaining
    .filter(
      (binding) =>
        binding.organizationId === conflictingBinding.organizationId &&
        binding.projectId === conflictingBinding.projectId
    )
    .sort(compareProjectBindings)[0];
  if (!replacement) {
    return remaining;
  }
  return remaining.map((binding) =>
    binding.bindingGeneration === replacement.bindingGeneration
      ? { ...binding, isDefault: true }
      : binding
  );
}

function compareProjectBindings(
  left: ProjectBinding,
  right: ProjectBinding
): number {
  return (
    left.boundAtMs - right.boundAtMs ||
    left.repositoryPath.localeCompare(right.repositoryPath) ||
    left.bindingGeneration.localeCompare(right.bindingGeneration)
  );
}

async function requireRepositoryDirectory(value: string): Promise<string> {
  const requestedPath = resolve(requireText(value, "repositoryPath"));
  const canonicalPath = await realpath(requestedPath).catch(
    (error: unknown) => {
      if (isNodeError(error, "ENOENT")) {
        throw new ProjectBindingOperationError(
          "path_not_found",
          `Local repository does not exist: ${requestedPath}`
        );
      }
      if (isNodeError(error, "EACCES")) {
        throw new ProjectBindingOperationError(
          "path_unreadable",
          `Local repository is not readable: ${requestedPath}`
        );
      }
      throw error;
    }
  );
  const metadata = await stat(canonicalPath);
  if (!metadata.isDirectory()) {
    throw new ProjectBindingOperationError(
      "path_not_directory",
      `Local repository must be a directory: ${canonicalPath}`
    );
  }
  await access(canonicalPath, constants.R_OK).catch((error: unknown) => {
    if (isNodeError(error, "EACCES")) {
      throw new ProjectBindingOperationError(
        "path_unreadable",
        `Local repository is not readable: ${canonicalPath}`
      );
    }
    throw error;
  });
  return canonicalPath;
}

export async function setDefaultProjectConnection(
  input: StoreLocationInput & {
    expectedBindingGeneration: string;
    organizationId: string;
    projectId: string;
  }
): Promise<ProjectBinding> {
  return await withAgentActivityDeliveryLock(
    input,
    async () =>
      await withAgentActivityLocalStateLock(input, async () => {
        const store = await readStore(input);
        const connection = requireCurrentProjectConnection(store, input);
        if (connection.isDefault) {
          return connection;
        }
        const bindings = store.bindings.map((current) =>
          current.organizationId === connection.organizationId &&
          current.projectId === connection.projectId
            ? {
                ...current,
                isDefault:
                  current.bindingGeneration === connection.bindingGeneration,
              }
            : current
        );
        await writeStore(input, {
          bindings,
          version: PROJECT_BINDING_STORE_VERSION,
        });
        return { ...connection, isDefault: true };
      })
  );
}

export async function removeProjectConnection(
  input: StoreLocationInput & {
    expectedBindingGeneration: string;
    organizationId: string;
    projectId: string;
    replacementBindingGeneration?: string;
  }
): Promise<{
  removed: ProjectBinding;
  replacementDefault: ProjectBinding | null;
}> {
  return await withAgentActivityDeliveryLock(
    input,
    async () =>
      await withAgentActivityLocalStateLock(input, async () => {
        const store = await readStore(input);
        const connection = requireCurrentProjectConnection(store, input);
        const remainingProjectConnections = store.bindings.filter(
          (current) =>
            current.organizationId === connection.organizationId &&
            current.projectId === connection.projectId &&
            current.bindingGeneration !== connection.bindingGeneration
        );
        let replacementDefault: ProjectBinding | null = null;
        if (connection.isDefault && remainingProjectConnections.length > 0) {
          if (!input.replacementBindingGeneration) {
            throw new ProjectBindingOperationError(
              "replacement_required",
              "Removing the default Project connection requires a replacement default in the same operation."
            );
          }
          const replacement = remainingProjectConnections.find(
            (current) =>
              current.bindingGeneration === input.replacementBindingGeneration
          );
          if (!replacement) {
            throw new ProjectBindingOperationError(
              "replacement_invalid",
              "The replacement default Project connection is missing or stale."
            );
          }
          replacementDefault = { ...replacement, isDefault: true };
        }
        const bindings = store.bindings
          .filter(
            (current) =>
              current.bindingGeneration !== connection.bindingGeneration
          )
          .map((current) =>
            replacementDefault &&
            current.bindingGeneration === replacementDefault.bindingGeneration
              ? replacementDefault
              : current
          );
        await writeStore(input, {
          bindings,
          version: PROJECT_BINDING_STORE_VERSION,
        });
        return { removed: connection, replacementDefault };
      })
  );
}

export async function removeMissingProjectConnections(
  input: StoreLocationInput & {
    organizationId: string;
    projectId: string;
  }
): Promise<{
  remaining: ProjectBinding[];
  removed: ProjectBinding[];
}> {
  return await withAgentActivityDeliveryLock(
    input,
    async () =>
      await withAgentActivityLocalStateLock(input, async () => {
        const store = await readStore(input);
        const projectConnections = store.bindings.filter(
          (binding) =>
            binding.organizationId === input.organizationId &&
            binding.projectId === input.projectId
        );
        const connectionStatus = await Promise.all(
          projectConnections.map(async (connection) => ({
            connection,
            missing: !(await projectConnectionDirectoryExists(
              connection.repositoryPath
            )),
          }))
        );
        const removed = connectionStatus
          .filter((entry) => entry.missing)
          .map((entry) => entry.connection);
        const remaining = connectionStatus
          .filter((entry) => !entry.missing)
          .map((entry) => entry.connection);
        if (
          remaining.length > 0 &&
          removed.some((connection) => connection.isDefault)
        ) {
          throw new ProjectBindingOperationError(
            "default_missing_requires_replacement",
            "The missing default connection must be removed with an explicit healthy replacement."
          );
        }
        if (removed.length === 0) {
          return { remaining: projectConnections, removed: [] };
        }
        const removedGenerations = new Set(
          removed.map((connection) => connection.bindingGeneration)
        );
        await writeStore(input, {
          bindings: store.bindings.filter(
            (binding) => !removedGenerations.has(binding.bindingGeneration)
          ),
          version: PROJECT_BINDING_STORE_VERSION,
        });
        return { remaining, removed };
      })
  );
}

async function projectConnectionDirectoryExists(
  path: string
): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTDIR")
    ) {
      return false;
    }
    throw new Error(`Failed to inspect Project connection path: ${path}`, {
      cause: error,
    });
  }
}

function requireCurrentProjectConnection(
  store: ProjectBindingStore,
  input: {
    expectedBindingGeneration: string;
    organizationId: string;
    projectId: string;
  }
): ProjectBinding {
  const connection = findExactLocalProjectConnection({
    bindingGeneration: input.expectedBindingGeneration,
    connections: store.bindings,
    organizationId: input.organizationId,
    projectId: input.projectId,
  });
  if (!connection) {
    throw new ProjectBindingOperationError(
      "binding_generation_stale",
      "The Project connection is missing or stale."
    );
  }
  return connection;
}

export async function unbindProject(
  input: StoreLocationInput & {
    afterRemove?: (binding: ProjectBinding) => Promise<void> | void;
    organizationId: string;
    projectId: string;
  }
): Promise<boolean> {
  return await withAgentActivityDeliveryLock(input, async () => {
    const removed = await removeAgentActivityBindingsWhileDeliveryLocked({
      organizationId: input.organizationId,
      projectId: input.projectId,
      rootDir: input.rootDir,
    });
    for (const binding of removed) {
      await input.afterRemove?.(binding);
    }
    return removed.length > 0;
  });
}

export async function disableAgentActivityBindings(
  input: StoreLocationInput & {
    organizationId: string;
    projectId?: string;
  }
): Promise<ProjectBinding[]> {
  return await withAgentActivityDeliveryLock(
    input,
    async () => await removeAgentActivityBindingsWhileDeliveryLocked(input)
  );
}

/** Caller must already hold the Agent Activity delivery lock. */
export async function removeAgentActivityBindingsWhileDeliveryLocked(
  input: StoreLocationInput & {
    organizationId: string;
    projectId?: string;
    projectSlug?: string;
  }
): Promise<ProjectBinding[]> {
  return await withAgentActivityLocalStateLock(input, async () => {
    const store = await readStore(input);
    const removed = store.bindings.filter(
      (binding) =>
        binding.organizationId === input.organizationId &&
        (input.projectId === undefined ||
          binding.projectId === input.projectId) &&
        (input.projectSlug === undefined ||
          binding.projectSlug === input.projectSlug)
    );
    if (removed.length === 0) {
      return [];
    }
    const removedSet = new Set(removed);
    await writeStore(input, {
      bindings: store.bindings.filter((binding) => !removedSet.has(binding)),
      version: PROJECT_BINDING_STORE_VERSION,
    });
    return removed;
  });
}

export async function isProjectBound(
  input: StoreLocationInput & { organizationId: string; projectId: string }
): Promise<boolean> {
  const store = await readStore(input);
  return store.bindings.some(
    (binding) =>
      binding.organizationId === input.organizationId &&
      binding.projectId === input.projectId
  );
}

export async function runIfAgentActivityBindingGenerationIsCurrent<T>(
  input: StoreLocationInput & {
    bindingGeneration: string;
    organizationId: string;
    projectId: string;
  },
  operation: () => Promise<T>
): Promise<T | null> {
  return await withAgentActivityLocalStateLock(input, async () => {
    const store = await readStore(input);
    const current = store.bindings.some(
      (binding) =>
        binding.organizationId === input.organizationId &&
        binding.projectId === input.projectId &&
        binding.bindingGeneration === input.bindingGeneration
    );
    return current ? await operation() : null;
  });
}

export async function resolveProjectBinding(
  input: StoreLocationInput & { organizationId: string; path: string }
): Promise<ProjectBinding | null> {
  const candidatePath = await canonicalizeLocalProjectPath(input.path);
  if (candidatePath === null) {
    return null;
  }
  const bindings = await listProjectBindings({
    organizationId: input.organizationId,
    rootDir: input.rootDir,
  });
  return resolveCanonicalPathBinding(candidatePath, bindings);
}

export async function resolveProjectBindingForPath(
  input: StoreLocationInput & { path: string }
): Promise<ProjectBinding | null> {
  const candidatePath = await canonicalizeLocalProjectPath(input.path);
  if (candidatePath === null) {
    return null;
  }
  return resolveCanonicalPathBinding(
    candidatePath,
    await listProjectBindings({ rootDir: input.rootDir })
  );
}

export async function hasProjectBindingForPath(
  input: StoreLocationInput & { path: string }
): Promise<boolean> {
  const candidatePath = await canonicalizeLocalProjectPath(input.path);
  if (candidatePath === null) {
    return false;
  }
  return (await listProjectBindings({ rootDir: input.rootDir })).some(
    (binding) =>
      candidatePath === binding.repositoryPath ||
      candidatePath.startsWith(`${binding.repositoryPath}${sep}`)
  );
}

const resolveCanonicalPathBinding = resolveCanonicalLocalProjectConnection;

function storePath(input: StoreLocationInput): string {
  return join(
    input.rootDir ?? resolveOpenMeldRootDir(),
    "device",
    "agent-activity",
    "project-bindings.json"
  );
}

async function readStore(
  input: StoreLocationInput
): Promise<ProjectBindingStore> {
  const path = storePath(input);
  const raw = await readFile(path, "utf8").catch((error: unknown) => {
    if (isNodeError(error, "ENOENT")) {
      return null;
    }
    throw error;
  });
  if (raw === null) {
    return {
      bindings: [],
      sourceVersion: null,
      version: PROJECT_BINDING_STORE_VERSION,
    };
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Agent Activity Project binding store is invalid: ${path}`,
      {
        cause: error,
      }
    );
  }
  return parseStore(value, path);
}

async function writeStore(
  input: StoreLocationInput,
  store: ProjectBindingStoreV4
): Promise<void> {
  assertProjectBindingStoreV4Invariants(
    store.bindings,
    storePath(input),
    PROJECT_BINDING_STORE_VERSION
  );
  const path = storePath(input);
  const directory = dirname(path);
  await mkdir(directory, { mode: 0o700, recursive: true });
  await chmod(directory, 0o700);
  const temporaryPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, path);
    await chmod(path, 0o600);
    // This signal accelerates catalog refresh across CLI and Service writers.
    // Dispatch safety does not depend on delivery: admission compares this
    // durable store's current binding generation with the observed route.
    await touchDaemonCatalogSyncSignal({
      reason: "project_connections_changed",
      ...(input.rootDir ? { rootDir: input.rootDir } : {}),
    }).catch(() => undefined);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

function parseStore(value: unknown, path: string): ProjectBindingStore {
  const parsed = parseProjectBindingStore(value, path);
  return {
    ...parsed,
    sourceVersion: readProjectBindingStoreVersion(value),
  };
}

export async function migrateProjectBindingStore(
  input: StoreLocationInput
): Promise<"current" | "migrated" | "missing"> {
  return await withAgentActivityDeliveryLock(
    input,
    async () =>
      await withAgentActivityLocalStateLock(input, async () => {
        const store = await readStore(input);
        if (store.sourceVersion === null) {
          return "missing";
        }
        if (store.sourceVersion === PROJECT_BINDING_STORE_VERSION) {
          return "current";
        }
        await writeStore(input, {
          bindings: store.bindings,
          version: PROJECT_BINDING_STORE_VERSION,
        });
        return "migrated";
      })
  );
}

export function parseProjectBindingStore(
  value: unknown,
  path: string
): ProjectBindingStoreV4 {
  if (
    isRecord(value) &&
    typeof value.version === "number" &&
    Number.isSafeInteger(value.version) &&
    value.version > PROJECT_BINDING_STORE_VERSION
  ) {
    throw new ProjectBindingStoreUpdateRequiredError(path, value.version);
  }
  if (
    !(
      isRecord(value) &&
      (value.version === 1 ||
        value.version === LEGACY_STORE_VERSION ||
        value.version === PREVIOUS_STORE_VERSION ||
        value.version === PROJECT_BINDING_STORE_VERSION) &&
      Array.isArray(value.bindings)
    )
  ) {
    throw new Error(`Project binding store is invalid: ${path}`);
  }

  const storeVersion = value.version;
  const bindings = value.bindings.map((binding, index) => {
    const label = `${path} bindings[${index}]`;
    const parsed = parseBinding(
      binding,
      label,
      storeVersion === 1 ? 1 : LEGACY_STORE_VERSION
    );
    const isDefault =
      storeVersion >= PREVIOUS_STORE_VERSION
        ? requireBoolean(
            isRecord(binding) ? binding.isDefault : undefined,
            `${label}.isDefault`
          )
        : true;
    return { ...parsed, isDefault };
  });

  assertProjectBindingStoreV4Invariants(bindings, path, storeVersion);
  return { bindings, version: PROJECT_BINDING_STORE_VERSION };
}

function assertProjectBindingStoreV4Invariants(
  bindings: readonly ProjectBindingV4[],
  path: string,
  sourceVersion: 1 | 2 | 3 | 4
): void {
  const bindingsByProject = new Map<string, ProjectBindingV4[]>();
  const canonicalPaths = new Map<string, ProjectBindingV4[]>();
  const bindingGenerations = new Set<string>();
  for (const binding of bindings) {
    const pathBindings = canonicalPaths.get(binding.repositoryPath) ?? [];
    if (
      pathBindings.some(
        (existing) =>
          sourceVersion < PROJECT_BINDING_STORE_VERSION ||
          existing.organizationId !== binding.organizationId ||
          !existing.ownerUserId ||
          existing.ownerUserId !== binding.ownerUserId ||
          existing.projectId === binding.projectId
      )
    ) {
      throw new Error(
        `Project binding store has an invalid shared canonical path: ${path}`
      );
    }
    pathBindings.push(binding);
    canonicalPaths.set(binding.repositoryPath, pathBindings);
    if (bindingGenerations.has(binding.bindingGeneration)) {
      throw new Error(
        `Project binding store has a duplicate binding generation: ${path}`
      );
    }
    bindingGenerations.add(binding.bindingGeneration);
    const projectKey = `${binding.organizationId}\0${binding.projectId}`;
    const projectBindings = bindingsByProject.get(projectKey) ?? [];
    projectBindings.push(binding);
    bindingsByProject.set(projectKey, projectBindings);
  }

  for (const projectBindings of bindingsByProject.values()) {
    const knownOwners = new Set(
      projectBindings.flatMap((binding) =>
        binding.ownerUserId ? [binding.ownerUserId] : []
      )
    );
    if (knownOwners.size > 1) {
      throw new Error(
        `Project binding store has mixed owners for one Project: ${path}`
      );
    }
    if (sourceVersion < PREVIOUS_STORE_VERSION) {
      if (projectBindings.length !== 1) {
        throw new Error(
          `Legacy Project binding store has multiple connections for one Project: ${path}`
        );
      }
      continue;
    }
    const defaultCount = projectBindings.filter(
      (binding) => binding.isDefault
    ).length;
    if (defaultCount !== 1) {
      throw new Error(
        `Project binding store must have exactly one default connection per Project: ${path}`
      );
    }
  }
}

function parseBinding(
  value: unknown,
  label: string,
  storeVersion: 1 | typeof LEGACY_STORE_VERSION
): Omit<ProjectBinding, "isDefault"> {
  if (!isRecord(value)) {
    throw new Error(`Agent Activity Project binding is invalid: ${label}`);
  }
  const repositoryFingerprint =
    value.repositoryFingerprint === null
      ? null
      : normalizeFingerprint(value.repositoryFingerprint);
  const boundAtMs = Number(value.boundAtMs);
  if (!Number.isSafeInteger(boundAtMs) || boundAtMs < 0) {
    throw new Error(`Agent Activity Project binding is invalid: ${label}`);
  }
  return {
    bindingGeneration:
      storeVersion === LEGACY_STORE_VERSION
        ? requireText(value.bindingGeneration, `${label}.bindingGeneration`)
        : `legacy-${createHash("sha256")
            .update(
              `${String(value.organizationId)}\0${String(value.projectId)}\0${String(value.repositoryPath)}\0${String(value.boundAtMs)}`
            )
            .digest("hex")}`,
    boundAtMs,
    organizationId: requireText(
      value.organizationId,
      `${label}.organizationId`
    ),
    ...(value.ownerUserId === undefined
      ? {}
      : {
          ownerUserId: requireText(value.ownerUserId, `${label}.ownerUserId`),
        }),
    projectId: requireText(value.projectId, `${label}.projectId`),
    projectSlug: requireText(value.projectSlug, `${label}.projectSlug`),
    repositoryFingerprint,
    repositoryPath: resolve(
      requireText(value.repositoryPath, `${label}.repositoryPath`)
    ),
  };
}

function readProjectBindingStoreVersion(value: unknown): 1 | 2 | 3 | 4 {
  if (
    !(
      isRecord(value) &&
      (value.version === 1 ||
        value.version === LEGACY_STORE_VERSION ||
        value.version === PREVIOUS_STORE_VERSION ||
        value.version === PROJECT_BINDING_STORE_VERSION)
    )
  ) {
    throw new Error("Project binding store version is invalid");
  }
  return value.version;
}

function normalizeFingerprint(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  const fingerprint = requireText(value, "repositoryFingerprint");
  if (!REPOSITORY_FINGERPRINT_PATTERN.test(fingerprint)) {
    throw new Error("repositoryFingerprint is invalid");
  }
  return fingerprint;
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is required`);
  }
  return value.trim();
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${label} is required`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isNodeError(error: unknown, code: string): boolean {
  return Boolean(
    error && typeof error === "object" && "code" in error && error.code === code
  );
}
