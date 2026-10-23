import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { homedir, hostname, userInfo } from "node:os";
import { basename, dirname } from "node:path";
import {
  profileFolderProjectionSchema,
  providerDispatchRuntimeContextSchema,
} from "@openmeld/schemas";
import type {
  ProfileFolderOperation,
  ProfileFolderOperationReasonCode,
  ProfileFolderProjection,
  ProviderDispatchRuntimeContext,
} from "@openmeld/schemas/types";
import { isProjectConnectionReadableByOwner } from "../agent-activity/project-binding-resolution";
import {
  claimLegacyProjectConnection,
  listProjectConnectionsWithStatus,
  ProjectBindingOperationError,
} from "../agent-activity/project-bindings";
import { resolveCurrentOpenMeldAccountContext } from "../config/account-context";
import {
  accountProfileWorkspacePath,
  normalizeOpenMeldProfileId,
  type OpenMeldAccountKey,
} from "../config/paths";
import {
  describeProfileWorkspacePathValidationFailure,
  validateCustomProfileWorkspacePath,
} from "./custom-path";
import {
  defaultProfileFolderDisplayName,
  mutateProfileFolderListForAccount,
  nextProfileFolderRevision,
  OPENMELD_MANAGED_FOLDER_DISPLAY_NAME,
  type ProfileFolder,
  type ProfileFolderList,
  ProfileFolderListLimitError,
  type ProfileFolderListMutation,
  type ProfileFolderListReadResult,
  readProfileFolderListForAccount,
} from "./service";

export class ProfileFolderOperationError extends Error {
  readonly reasonCode: ProfileFolderOperationReasonCode;

  constructor(reasonCode: ProfileFolderOperationReasonCode, message: string) {
    super(message);
    this.name = "ProfileFolderOperationError";
    this.reasonCode = reasonCode;
  }
}

export type ProfileFolderOperationOutcome = {
  /** The folder the operation added, renamed, or made default. */
  folderId?: string;
  projection: ProfileFolderProjection;
};

/** Cloud-safe view of the list: ids, kinds and display names only. */
export function projectProfileFolderList(
  list: ProfileFolderList,
  revision: number
): ProfileFolderProjection {
  return profileFolderProjectionSchema.parse({
    defaultFolderId: list.defaultFolderId,
    revision,
    folders: list.folders.map((folder) => ({
      displayName: folder.displayName,
      folderId: folder.id,
      isDefault: folder.id === list.defaultFolderId,
      kind: folder.kind,
      ...(folder.kind === "project" ? { projectId: folder.projectId } : {}),
    })),
  });
}

/**
 * Applies one owner-requested folder change through the single envelope
 * writer. Changes that keep the default keep `updatedAt` and its origin, so
 * the saved working-folder configuration does not read as changed.
 */
export async function applyProfileFolderOperation(input: {
  account?: OpenMeldAccountKey;
  openMeldProfileId: string;
  operation: ProfileFolderOperation;
  ownerUserId?: string;
  updatedAt?: string;
}): Promise<ProfileFolderOperationOutcome> {
  const account = await resolveAccountKey(input.account);
  const openMeldProfileId = normalizeOpenMeldProfileId(input.openMeldProfileId);
  const operation = input.operation;
  if (operation.operation === "list") {
    const current = await readProfileFolderListForAccount({
      account,
      openMeldProfileId,
    });
    return {
      projection: projectProfileFolderList(
        requireList(current),
        current.status === "valid" ? current.revision : 0
      ),
    };
  }
  const now = input.updatedAt ?? new Date().toISOString();
  const prepared = await prepareOperationInput({
    operation,
    ownerUserId: input.ownerUserId,
  });
  try {
    return await mutateProfileFolderListForAccount({
      account,
      openMeldProfileId,
      mutate: async (current) => {
        const mutation = await planProfileFolderMutation({
          account,
          current,
          now,
          openMeldProfileId,
          operation,
          prepared,
        });
        if (prepared.claim) {
          await claimProjectFolderConnection(prepared.claim);
        }
        return mutation;
      },
    });
  } catch (error) {
    if (error instanceof ProfileFolderListLimitError) {
      throw new ProfileFolderOperationError(
        "profile_folder.limit_reached",
        error.message
      );
    }
    throw error;
  }
}

async function claimProjectFolderConnection(
  claim: Parameters<typeof claimLegacyProjectConnection>[0]
): Promise<void> {
  try {
    await claimLegacyProjectConnection(claim);
  } catch (error) {
    // Only a refused claim means "reconnect"; a store that needs an update,
    // a lock timeout or an I/O failure keeps its own handling.
    if (!(error instanceof ProjectBindingOperationError)) {
      throw error;
    }
    throw new ProfileFolderOperationError(
      "profile_folder.project_not_connected",
      `${error.message} Connect this Project on this computer again before adding it as a folder.`
    );
  }
}

type FolderMutation = ProfileFolderListMutation<ProfileFolderOperationOutcome>;

type FolderMutationPlan = {
  account: OpenMeldAccountKey;
  list: ProfileFolderList;
  /** Writes a list whose default is unchanged, keeping `updatedAt` and origin. */
  keep: (next: ProfileFolderList, folderId?: string) => FolderMutation;
  /** The revision this plan's write will persist. */
  nextRevision: number;
  now: string;
  openMeldProfileId: string;
  unchanged: (folderId: string) => FolderMutation;
};

async function planProfileFolderMutation(input: {
  account: OpenMeldAccountKey;
  current: ProfileFolderListReadResult;
  now: string;
  openMeldProfileId: string;
  operation: Exclude<ProfileFolderOperation, { operation: "list" }>;
  prepared: { folder?: ProfileFolder };
}): Promise<FolderMutation> {
  const current = input.current;
  const operation = input.operation;
  if (operation.operation === "repair") {
    return await planRepairFolder({
      ...input,
      candidate: input.prepared.folder,
    });
  }
  const list = requireList(current);
  const nextRevision = nextProfileFolderRevision(current);
  const plan: FolderMutationPlan = {
    account: input.account,
    keep: (next, folderId) => ({
      kind: "write",
      list: next,
      ...(current.status === "valid" && current.origin
        ? { origin: current.origin }
        : {}),
      result: {
        ...(folderId ? { folderId } : {}),
        projection: projectProfileFolderList(next, nextRevision),
      },
      updatedAt: current.status === "valid" ? current.updatedAt : input.now,
    }),
    list,
    nextRevision,
    now: input.now,
    openMeldProfileId: input.openMeldProfileId,
    unchanged: (folderId) => ({
      kind: "unchanged",
      result: {
        folderId,
        projection: projectProfileFolderList(
          list,
          current.status === "valid" ? current.revision : 0
        ),
      },
    }),
  };
  switch (operation.operation) {
    case "add_custom":
    case "add_project":
    case "add_openmeld_managed":
      return planAddFolder(plan, input.prepared.folder);
    case "rename":
      return planRenameFolder(plan, operation);
    case "set_default":
      return await planSetDefaultFolder(plan, operation.folderId);
    case "remove":
      return await planRemoveFolder(plan, operation);
    default:
      throw new Error("Unsupported folder operation.");
  }
}

function planAddFolder(
  plan: FolderMutationPlan,
  candidate: ProfileFolder | undefined
): FolderMutation {
  if (!candidate) {
    throw new Error("A prepared folder is required.");
  }
  const existing = plan.list.folders.find((folder) =>
    sameFolderTarget(folder, candidate)
  );
  if (existing) {
    return plan.unchanged(existing.id);
  }
  return plan.keep(
    { ...plan.list, folders: [...plan.list.folders, candidate] },
    candidate.id
  );
}

/**
 * Makes an OpenMeld or custom folder the default and prepares it again, so a
 * missing OpenMeld folder is recreated and a custom folder is re-checked even
 * when it already is the default. Saved settings that can't be read are
 * replaced by a list holding only this folder; the lost save counter is
 * unknown, so the counter restarts above any it could have reported.
 */
async function planRepairFolder(input: {
  account: OpenMeldAccountKey;
  candidate: ProfileFolder | undefined;
  current: ProfileFolderListReadResult;
  now: string;
  openMeldProfileId: string;
}): Promise<FolderMutation> {
  const candidate = input.candidate;
  if (!candidate) {
    throw new Error("A prepared folder is required.");
  }
  const current = input.current;
  if (current.status === "invalid") {
    await prepareDefaultFolder({
      account: input.account,
      folder: candidate,
      openMeldProfileId: input.openMeldProfileId,
    });
    const revision = Math.max(nextProfileFolderRevision(current), Date.now());
    return {
      ...changeDefault({
        folder: candidate,
        list: { defaultFolderId: null, folders: [candidate] },
        plan: { nextRevision: revision, now: input.now },
      }),
      revision,
    };
  }
  const list = requireList(current);
  const existing = list.folders.find((folder) =>
    sameFolderTarget(folder, candidate)
  );
  const folder = existing ?? candidate;
  await prepareDefaultFolder({
    account: input.account,
    folder,
    openMeldProfileId: input.openMeldProfileId,
  });
  if (list.defaultFolderId === folder.id) {
    return {
      kind: "unchanged",
      result: {
        folderId: folder.id,
        projection: projectProfileFolderList(
          list,
          current.status === "valid" ? current.revision : 0
        ),
      },
    };
  }
  return changeDefault({
    folder,
    list: existing ? list : { ...list, folders: [...list.folders, candidate] },
    plan: { nextRevision: nextProfileFolderRevision(current), now: input.now },
  });
}

function planRenameFolder(
  plan: FolderMutationPlan,
  operation: { displayName: string; folderId: string }
): FolderMutation {
  const folder = requireFolder(plan.list, operation.folderId);
  if (folder.displayName === operation.displayName) {
    return plan.unchanged(folder.id);
  }
  return plan.keep(
    {
      ...plan.list,
      folders: plan.list.folders.map((item) =>
        item.id === folder.id
          ? { ...item, displayName: operation.displayName }
          : item
      ),
    },
    folder.id
  );
}

async function planSetDefaultFolder(
  plan: FolderMutationPlan,
  folderId: string
): Promise<FolderMutation> {
  const folder = requireFolder(plan.list, folderId);
  // Choosing the current default again prepares it again: a missing OpenMeld
  // folder is recreated and a custom folder is re-checked.
  await prepareDefaultFolder({
    account: plan.account,
    folder,
    openMeldProfileId: plan.openMeldProfileId,
  });
  if (plan.list.defaultFolderId === folder.id) {
    return plan.unchanged(folder.id);
  }
  return changeDefault({ folder, list: plan.list, plan });
}

async function planRemoveFolder(
  plan: FolderMutationPlan,
  operation: { folderId: string; nextDefaultFolderId?: string }
): Promise<FolderMutation> {
  const list = plan.list;
  const folder = requireFolder(list, operation.folderId);
  const remaining = list.folders.filter((item) => item.id !== folder.id);
  if (operation.nextDefaultFolderId === folder.id) {
    throw new ProfileFolderOperationError(
      "profile_folder.default_removal_requires_replacement",
      "Choose a different folder as the new default before removing this one."
    );
  }
  const next = operation.nextDefaultFolderId
    ? requireFolder(list, operation.nextDefaultFolderId)
    : null;
  if (list.defaultFolderId === folder.id && !next) {
    throw new ProfileFolderOperationError(
      "profile_folder.default_removal_requires_replacement",
      "This is the Agent's default folder. Choose another default folder before removing it."
    );
  }
  if (next && next.id !== list.defaultFolderId) {
    await prepareDefaultFolder({
      account: plan.account,
      folder: next,
      openMeldProfileId: plan.openMeldProfileId,
    });
    return changeDefault({
      folder: next,
      list: { ...list, folders: remaining },
      plan,
    });
  }
  return plan.keep({ ...list, folders: remaining });
}

export type ProfileFolderRuntimeFailureCode =
  | "profile.workspace.missing"
  | "profile.workspace.invalid"
  | "project.local_connection.missing"
  | "project.local_connection.folder_missing"
  | "project.local_connection.invalid";

export type ProfileFolderRuntimeResolution =
  | {
      folder: ProfileFolder;
      runtimeContext: ProviderDispatchRuntimeContext;
      status: "ready";
    }
  | {
      projectFailureContext?: { bindingGeneration?: string; projectId: string };
      reasonCode: ProfileFolderRuntimeFailureCode;
      reasonText: string;
      status: "failed";
    };

/**
 * Resolves one selected folder for a task. An id this computer does not know
 * fails closed with the existing "folder missing, choose again" outcome; it
 * never falls back to the default folder or another path.
 */
export async function resolveProfileFolderRuntimeForAccount(input: {
  account: OpenMeldAccountKey;
  folderId: string;
  mode: "dispatch" | "inspect";
  openMeldProfileId: string;
  organizationId: string;
  ownerUserId?: string;
}): Promise<ProfileFolderRuntimeResolution> {
  const openMeldProfileId = normalizeOpenMeldProfileId(input.openMeldProfileId);
  const current = await readProfileFolderListForAccount({
    account: input.account,
    openMeldProfileId,
  });
  if (current.status === "invalid") {
    return {
      reasonCode: "profile.workspace.invalid",
      reasonText: `The working folder settings for ${openMeldProfileId} are invalid (${current.reason}). Repair them before starting work.`,
      status: "failed",
    };
  }
  const folder =
    current.status === "valid"
      ? current.list.folders.find((item) => item.id === input.folderId)
      : undefined;
  if (!folder) {
    return {
      reasonCode: "profile.workspace.missing",
      reasonText:
        "The selected folder is no longer set up for this Agent on this computer. Choose a folder again.",
      status: "failed",
    };
  }
  if (folder.kind === "project") {
    return await resolveProjectFolderRuntime({
      folder,
      organizationId: input.organizationId,
      ownerUserId: input.ownerUserId,
    });
  }
  const path =
    folder.kind === "custom"
      ? folder.path
      : accountProfileWorkspacePath(input.account, openMeldProfileId);
  if (folder.kind === "openmeld_managed" && input.mode === "dispatch") {
    try {
      await mkdir(path, { recursive: true });
    } catch {
      return {
        reasonCode: "profile.workspace.invalid",
        // Task failures leave this computer; keep paths out of the text.
        reasonText:
          "Couldn’t prepare the OpenMeld folder on this computer. Check the folder and its permissions.",
        status: "failed",
      };
    }
  }
  let validation = await validateCustomProfileWorkspacePath(path);
  if (
    folder.kind === "openmeld_managed" &&
    input.mode === "inspect" &&
    validation.status === "invalid" &&
    validation.reason === "not_found"
  ) {
    // Managed folders are created at dispatch; inspection checks the parent.
    validation = await validateCustomProfileWorkspacePath(dirname(path));
  }
  if (validation.status === "invalid") {
    return {
      reasonCode: "profile.workspace.invalid",
      reasonText: `The selected folder can’t be used on this computer (${validation.reason}). Choose a folder again.`,
      status: "failed",
    };
  }
  return readyResolution(folder, path);
}

async function resolveProjectFolderRuntime(input: {
  folder: Extract<ProfileFolder, { kind: "project" }>;
  organizationId: string;
  ownerUserId?: string;
}): Promise<ProfileFolderRuntimeResolution> {
  const projectId = input.folder.projectId;
  const connection = await findProjectFolderConnection({
    organizationId: input.organizationId,
    ownerUserId: input.ownerUserId,
    projectId,
  });
  if (
    !connection ||
    (input.ownerUserId !== undefined &&
      connection.ownerUserId !== input.ownerUserId)
  ) {
    return {
      projectFailureContext: { projectId },
      reasonCode: "project.local_connection.missing",
      reasonText:
        "The selected Project folder has no local folder connection on this computer.",
      status: "failed",
    };
  }
  if (connection.status === "missing") {
    return {
      projectFailureContext: {
        bindingGeneration: connection.bindingGeneration,
        projectId,
      },
      reasonCode: "project.local_connection.folder_missing",
      reasonText:
        "The local folder for the selected Project is missing on this computer.",
      status: "failed",
    };
  }
  const resolution = readyResolution(input.folder, connection.repositoryPath);
  if (resolution.status === "failed") {
    return {
      projectFailureContext: {
        bindingGeneration: connection.bindingGeneration,
        projectId,
      },
      reasonCode: "project.local_connection.invalid",
      reasonText:
        "The selected Project folder is not a valid runtime working folder.",
      status: "failed",
    };
  }
  return resolution;
}

function readyResolution(
  folder: ProfileFolder,
  path: string
): ProfileFolderRuntimeResolution {
  const runtimeContext = providerDispatchRuntimeContextSchema.safeParse({
    providerRuntimeWorkingDirectory: path,
  });
  if (!runtimeContext.success) {
    return {
      reasonCode: "profile.workspace.invalid",
      reasonText: "The selected folder is not a valid runtime working folder.",
      status: "failed",
    };
  }
  return { folder, runtimeContext: runtimeContext.data, status: "ready" };
}

/**
 * Chooses the Project's local connection among those the account may see:
 * the default, else the only one. A legacy connection without an owner can be
 * chosen; adding the folder claims it, and running requires the owner, so a
 * Project never silently runs in another of its connections instead.
 */
async function findProjectFolderConnection(input: {
  organizationId: string;
  ownerUserId?: string;
  projectId: string;
}) {
  const ownerUserId = input.ownerUserId;
  const matches = (
    await listProjectConnectionsWithStatus({
      organizationId: input.organizationId,
    })
  ).filter(
    (connection) =>
      connection.projectId === input.projectId &&
      (ownerUserId === undefined ||
        isProjectConnectionReadableByOwner(connection, ownerUserId))
  );
  return (
    matches.find((connection) => connection.isDefault) ??
    (matches.length === 1 ? matches[0] : null)
  );
}

type PreparedFolderOperation = {
  claim?: Parameters<typeof claimLegacyProjectConnection>[0];
  folder?: ProfileFolder;
};

async function prepareOperationInput(input: {
  operation: Exclude<ProfileFolderOperation, { operation: "list" }>;
  ownerUserId?: string;
}): Promise<PreparedFolderOperation> {
  const operation = input.operation;
  switch (operation.operation) {
    case "add_custom": {
      const validation = await validateCustomProfileWorkspacePath(
        operation.path
      );
      if (validation.status === "invalid") {
        throw new ProfileFolderOperationError(
          "profile_folder.path_invalid",
          describeProfileWorkspacePathValidationFailure(validation)
        );
      }
      return {
        folder: {
          displayName:
            operation.displayName ??
            defaultProfileFolderDisplayName(validation.value),
          id: randomUUID(),
          kind: "custom",
          path: validation.value,
        },
      };
    }
    case "add_project": {
      const connection = await findProjectFolderConnection({
        organizationId: operation.organizationId,
        ownerUserId: input.ownerUserId,
        projectId: operation.projectId,
      });
      if (!connection) {
        throw new ProfileFolderOperationError(
          "profile_folder.project_not_connected",
          "Connect this Project on this computer before adding it as a folder."
        );
      }
      return {
        // Choosing a legacy connection's folder is the account's explicit
        // reconnect; it is claimed once the folder change is accepted.
        ...(input.ownerUserId && !connection.ownerUserId
          ? {
              claim: {
                bindingGeneration: connection.bindingGeneration,
                organizationId: operation.organizationId,
                ownerUserId: input.ownerUserId,
                projectId: operation.projectId,
              },
            }
          : {}),
        folder: {
          displayName:
            operation.displayName ??
            defaultProfileFolderDisplayName(connection.repositoryPath),
          id: randomUUID(),
          kind: "project",
          projectId: operation.projectId,
        },
      };
    }
    case "repair":
      if (operation.folder.kind === "custom") {
        return await prepareOperationInput({
          operation: { operation: "add_custom", path: operation.folder.path },
        });
      }
      return await prepareOperationInput({
        operation: { operation: "add_openmeld_managed" },
      });
    case "add_openmeld_managed":
      return {
        folder: {
          displayName:
            operation.displayName ?? OPENMELD_MANAGED_FOLDER_DISPLAY_NAME,
          id: randomUUID(),
          kind: "openmeld_managed",
        },
      };
    default:
      return {};
  }
}

/**
 * A Project's Profile-wide default stays the cloud Default Project; a local
 * Project folder is chosen per task. The default folder must therefore be an
 * OpenMeld or custom folder, which the v2 mirror can express exactly.
 */
async function prepareDefaultFolder(input: {
  account: OpenMeldAccountKey;
  folder: ProfileFolder;
  openMeldProfileId: string;
}): Promise<void> {
  if (input.folder.kind === "project") {
    throw new ProfileFolderOperationError(
      "profile_folder.project_default_unsupported",
      "A Project folder can’t be the default folder. Set the Agent’s Default Project instead, or choose this folder for one task."
    );
  }
  const path =
    input.folder.kind === "custom"
      ? input.folder.path
      : accountProfileWorkspacePath(input.account, input.openMeldProfileId);
  if (input.folder.kind === "openmeld_managed") {
    try {
      await mkdir(path, { recursive: true });
    } catch (cause) {
      throw new ProfileFolderOperationError(
        "profile_folder.path_invalid",
        `Couldn’t prepare working folder '${path}'. Check that the path is a folder and that you can write to it.${cause instanceof Error ? ` ${cause.message}` : ""}`
      );
    }
  }
  const validation = await validateCustomProfileWorkspacePath(path);
  if (validation.status === "invalid") {
    throw new ProfileFolderOperationError(
      "profile_folder.path_invalid",
      describeProfileWorkspacePathValidationFailure(validation)
    );
  }
}

function changeDefault(input: {
  folder: ProfileFolder;
  list: ProfileFolderList;
  plan: Pick<FolderMutationPlan, "nextRevision" | "now">;
}): Extract<FolderMutation, { kind: "write" }> {
  const next = { ...input.list, defaultFolderId: input.folder.id };
  return {
    kind: "write",
    list: next,
    // Same origin rule as an explicit working-folder save.
    ...(input.folder.kind === "custom"
      ? {
          origin: {
            configurationUpdatedAt: input.plan.now,
            kind: "explicit" as const,
          },
        }
      : {}),
    result: {
      folderId: input.folder.id,
      projection: projectProfileFolderList(next, input.plan.nextRevision),
    },
    updatedAt: input.plan.now,
  };
}

function requireList(current: ProfileFolderListReadResult): ProfileFolderList {
  if (current.status === "invalid") {
    throw new ProfileFolderOperationError(
      "profile_folder.configuration_invalid",
      `The working folder settings are invalid (${current.reason}). Repair them before changing folders.`
    );
  }
  return current.status === "valid"
    ? current.list
    : { defaultFolderId: null, folders: [] };
}

function requireFolder(list: ProfileFolderList, folderId: string) {
  const folder = list.folders.find((item) => item.id === folderId);
  if (!folder) {
    throw new ProfileFolderOperationError(
      "profile_folder.not_found",
      "This folder is no longer set up for this Agent on this computer. Refresh the folder list and choose again."
    );
  }
  return folder;
}

function sameFolderTarget(left: ProfileFolder, right: ProfileFolder): boolean {
  if (left.kind === "custom" && right.kind === "custom") {
    return left.path === right.path;
  }
  if (left.kind === "project" && right.kind === "project") {
    return left.projectId === right.projectId;
  }
  return left.kind === "openmeld_managed" && right.kind === "openmeld_managed";
}

/**
 * The display name, never the path, of the folder a task runs in: the selected
 * folder, or the Profile default. Null when it cannot be read or does not
 * exist; the task itself still fails closed on a missing folder elsewhere.
 */
export async function readProfileFolderDisplayName(input: {
  account?: OpenMeldAccountKey;
  folderId?: string;
  openMeldProfileId: string;
}): Promise<string | null> {
  try {
    const current = await readProfileFolderListForAccount({
      account: await resolveAccountKey(input.account),
      openMeldProfileId: normalizeOpenMeldProfileId(input.openMeldProfileId),
    });
    if (current.status !== "valid") {
      return null;
    }
    const folderId = input.folderId ?? current.list.defaultFolderId;
    const name = current.list.folders.find(
      (folder) => folder.id === folderId
    )?.displayName;
    return name && !namesThisComputer(name) ? name : null;
  } catch {
    return null;
  }
}

/**
 * A folder named after the home directory, the OS account, or the computer
 * (for example the folder `/Users/felix`, whose default name is `felix`)
 * would itself reveal local identity.
 */
function namesThisComputer(name: string): boolean {
  const candidate = name.trim().toLowerCase();
  const identity = [
    basename(homedir()),
    safeUserName(),
    hostname(),
    hostname().split(".")[0] ?? "",
  ]
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);
  return identity.some(
    (value) => candidate === value || candidate.includes(value)
  );
}

function safeUserName(): string {
  try {
    return userInfo().username;
  } catch {
    return "";
  }
}

async function resolveAccountKey(
  account: OpenMeldAccountKey | undefined
): Promise<OpenMeldAccountKey> {
  if (account) {
    return account;
  }
  return (await resolveCurrentOpenMeldAccountContext()).key;
}
