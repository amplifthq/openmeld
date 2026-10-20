import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import {
  MAX_PROFILE_FOLDER_DISPLAY_NAME_LENGTH,
  MAX_PROFILE_FOLDERS,
  profileFolderDisplayNameSchema,
  profileFolderIdSchema,
  profileWorkspaceModeSchema,
  profileWorkspaceOriginSchema,
  providerDispatchRuntimeContextSchema,
} from "@openmeld/schemas";
import type {
  ProfileWorkspaceMode,
  ProfileWorkspaceOrigin,
  ProfileWorkspaceReadResult,
} from "@openmeld/schemas/types";
import { resolveCurrentOpenMeldAccountContext } from "../config/account-context";
import { acquireLock, runWithHeldLock } from "../config/lock";
import {
  accountProfileLocalMetaPath,
  accountProfileWorkspacePath,
  normalizeOpenMeldProfileId,
  type OpenMeldAccountKey,
} from "../config/paths";
import {
  type CustomProfileWorkspacePathValidationResult,
  describeProfileWorkspacePathValidationFailure,
  normalizeCustomProfileWorkspacePath as normalizeCustomProfileWorkspacePathValue,
  ProfileWorkspacePathError,
  type ProfileWorkspacePathErrorReason,
  validateCustomProfileWorkspacePath as validateCustomProfileWorkspacePathValue,
} from "./custom-path";

const PROFILE_LOCAL_META_ENVELOPE_VERSION = 2;
const PROFILE_LOCAL_META_LEGACY_VERSION = 1;
const PROFILE_WORKSPACE_CONFIG_LOCK_KEY = "profile-workspace-config";

export const normalizeCustomProfileWorkspacePath =
  normalizeCustomProfileWorkspacePathValue;
export const validateCustomProfileWorkspacePath =
  validateCustomProfileWorkspacePathValue;

export type ProfileWorkspaceConfig =
  | {
      mode: "openmeld_managed";
    }
  | {
      customWorkspacePath: string;
      mode: "custom";
    };

/**
 * One working folder of a Profile on this computer. Ids are minted by this
 * Service; paths and Project connections never leave the computer.
 */
export type ProfileFolder =
  | { displayName: string; id: string; kind: "openmeld_managed" }
  | { displayName: string; id: string; kind: "custom"; path: string }
  | { displayName: string; id: string; kind: "project"; projectId: string };

export type ProfileFolderList = {
  defaultFolderId: string | null;
  folders: ProfileFolder[];
};

/**
 * Folder content version 3 is stored in the version 2 envelope: older
 * Services reject any other `v`, so `workspace` stays the v2 mirror of the
 * default folder and is the single source of the default. `folders` lists
 * every folder and `defaultFolderId` names the mirrored one.
 */
export type ProfileLocalMetaEnvelope = {
  defaultFolderId?: string;
  folders?: ProfileFolder[];
  foldersRevision?: number;
  openMeldProfileId: string;
  updatedAt: string;
  v: 2;
  workspace?: ProfileWorkspaceConfig;
  workspaceOrigin?: ProfileWorkspaceOrigin;
};

type ProfileLocalMetaLegacyV1 = {
  openMeldProfileId: string;
  providerRuntimeWorkingDirectory: string;
  updatedAt: string;
  v: 1;
};

export type ProfileWorkspaceConfigReadResult =
  | {
      path: string;
      status: "missing";
    }
  | {
      path: string;
      reason: "invalid_json" | "invalid_schema" | "profile_id_mismatch";
      status: "invalid";
    }
  | {
      path: string;
      persistedVersion: 1 | 2;
      status: "valid";
      updatedAt: string;
      value: ProfileWorkspaceConfig;
      origin?: ProfileWorkspaceOrigin;
    };

export type ProfileWorkspaceMigrationResult =
  | {
      path: string;
      status: "already_current";
      value: ProfileWorkspaceConfig;
    }
  | {
      path: string;
      reason: "invalid_json" | "invalid_schema" | "profile_id_mismatch";
      status: "invalid";
    }
  | {
      path: string;
      status: "migrated";
      value: ProfileWorkspaceConfig;
    }
  | {
      path: string;
      status: "missing";
    };

export type ProfileWorkspaceWriteResult = {
  changed: boolean;
  path: string;
  updatedAt: string;
  value: ProfileWorkspaceConfig;
  workspacePath: string;
};

export async function readProfileWorkspaceConfig(input: {
  account?: OpenMeldAccountKey;
  openMeldProfileId: string;
}): Promise<ProfileWorkspaceConfigReadResult> {
  const account = await resolveAccountKey(input.account);
  return await readProfileWorkspaceConfigForAccount({
    account,
    openMeldProfileId: input.openMeldProfileId,
  });
}

export async function readProfileWorkspaceConfigForAccount(input: {
  account: OpenMeldAccountKey;
  openMeldProfileId: string;
}): Promise<ProfileWorkspaceConfigReadResult> {
  const meta = await readProfileLocalMetaForAccount(input);
  if (meta.status !== "valid") {
    return meta;
  }
  if (!meta.workspace) {
    return {
      path: meta.path,
      status: "missing",
    };
  }
  return {
    path: meta.path,
    persistedVersion: meta.persistedVersion,
    status: "valid",
    updatedAt: meta.updatedAt,
    value: meta.workspace,
    ...(meta.origin ? { origin: meta.origin } : {}),
  };
}

export type ProfileFolderListReadResult =
  | {
      path: string;
      status: "missing";
    }
  | {
      path: string;
      reason: "invalid_json" | "invalid_schema" | "profile_id_mismatch";
      status: "invalid";
    }
  | {
      list: ProfileFolderList;
      origin?: ProfileWorkspaceOrigin;
      path: string;
      persistedVersion: 1 | 2;
      /** Folder-save counter; 0 before the first folder-aware save. */
      revision: number;
      status: "valid";
      updatedAt: string;
      workspace?: ProfileWorkspaceConfig;
    };

/**
 * Reads the folder list without rewriting the file. A v1 or v2 envelope
 * without `folders` reads as a one-element list whose id is derived from the
 * saved folder, so the id stays stable until the next explicit save persists it.
 */
export async function readProfileFolderListForAccount(input: {
  account: OpenMeldAccountKey;
  openMeldProfileId: string;
}): Promise<ProfileFolderListReadResult> {
  const meta = await readProfileLocalMetaForAccount(input);
  if (meta.status !== "valid") {
    return meta;
  }
  const openMeldProfileId = normalizeOpenMeldProfileId(input.openMeldProfileId);
  return {
    list: reconcileProfileFolderList({
      defaultFolderId: meta.defaultFolderId,
      folders: meta.folders,
      openMeldProfileId,
      workspace: meta.workspace,
    }),
    path: meta.path,
    persistedVersion: meta.persistedVersion,
    revision: meta.foldersRevision ?? 0,
    status: "valid",
    updatedAt: meta.updatedAt,
    ...(meta.origin ? { origin: meta.origin } : {}),
    ...(meta.workspace ? { workspace: meta.workspace } : {}),
  };
}

type ProfileLocalMetaReadResult =
  | {
      path: string;
      status: "missing";
    }
  | {
      path: string;
      reason: "invalid_json" | "invalid_schema" | "profile_id_mismatch";
      status: "invalid";
    }
  | {
      defaultFolderId?: string;
      folders?: ProfileFolder[];
      foldersRevision?: number;
      origin?: ProfileWorkspaceOrigin;
      path: string;
      persistedVersion: 1 | 2;
      status: "valid";
      updatedAt: string;
      workspace?: ProfileWorkspaceConfig;
    };

async function readProfileLocalMetaForAccount(input: {
  account: OpenMeldAccountKey;
  openMeldProfileId: string;
}): Promise<ProfileLocalMetaReadResult> {
  const openMeldProfileId = normalizeOpenMeldProfileId(input.openMeldProfileId);
  const path = accountProfileLocalMetaPath(input.account, openMeldProfileId);
  const raw = await readOptionalFile(path);
  if (raw === null) {
    return {
      path,
      status: "missing",
    };
  }

  const parsedJson = safeParseJson(raw);
  if (parsedJson === null) {
    return {
      path,
      reason: "invalid_json",
      status: "invalid",
    };
  }

  const legacyV1 = parseProfileLocalMetaLegacyV1(parsedJson);
  if (legacyV1) {
    if (
      !storedProfileIdMatches(legacyV1.openMeldProfileId, openMeldProfileId)
    ) {
      return {
        path,
        reason: "profile_id_mismatch",
        status: "invalid",
      };
    }
    const config = mapLegacyWorkingDirectoryToProfileWorkspaceConfig({
      account: input.account,
      openMeldProfileId,
      providerRuntimeWorkingDirectory: legacyV1.providerRuntimeWorkingDirectory,
    });
    if (!config) {
      return {
        path,
        reason: "invalid_schema",
        status: "invalid",
      };
    }
    return {
      path,
      persistedVersion: 1,
      status: "valid",
      updatedAt: legacyV1.updatedAt,
      workspace: config,
    };
  }

  const envelope = parseProfileLocalMetaEnvelopeV2(parsedJson);
  if (!envelope) {
    return {
      path,
      reason: "invalid_schema",
      status: "invalid",
    };
  }
  if (!storedProfileIdMatches(envelope.openMeldProfileId, openMeldProfileId)) {
    return {
      path,
      reason: "profile_id_mismatch",
      status: "invalid",
    };
  }
  return {
    path,
    persistedVersion: 2,
    status: "valid",
    updatedAt: envelope.updatedAt,
    ...(envelope.workspace ? { workspace: envelope.workspace } : {}),
    ...(envelope.workspaceOrigin ? { origin: envelope.workspaceOrigin } : {}),
    ...(envelope.folders ? { folders: envelope.folders } : {}),
    ...(envelope.defaultFolderId
      ? { defaultFolderId: envelope.defaultFolderId }
      : {}),
    ...(envelope.foldersRevision === undefined
      ? {}
      : { foldersRevision: envelope.foldersRevision }),
  };
}

/**
 * The v2 `workspace` mirror decides the default. An older Service may have
 * changed it without knowing about folders; the matching folder becomes the
 * default, or a folder derived from the mirror is added.
 */
export function reconcileProfileFolderList(input: {
  defaultFolderId?: string;
  folders?: ProfileFolder[];
  openMeldProfileId: string;
  workspace?: ProfileWorkspaceConfig;
}): ProfileFolderList {
  const folders = [...(input.folders ?? [])];
  const workspace = input.workspace;
  if (!workspace) {
    return { defaultFolderId: null, folders };
  }
  const matching = folders.filter((folder) =>
    folderMatchesWorkspaceConfig(folder, workspace)
  );
  const existing =
    matching.find((folder) => folder.id === input.defaultFolderId) ??
    matching[0];
  if (existing) {
    return { defaultFolderId: existing.id, folders };
  }
  const derived = buildProfileFolderFromWorkspaceConfig({
    id: deriveProfileFolderId({
      openMeldProfileId: input.openMeldProfileId,
      workspace,
    }),
    workspace,
  });
  return { defaultFolderId: derived.id, folders: [...folders, derived] };
}

export function deriveProfileFolderId(input: {
  openMeldProfileId: string;
  workspace: ProfileWorkspaceConfig;
}): string {
  const digest = createHash("sha256")
    .update(
      [
        "openmeld.profile-folder.v1",
        normalizeOpenMeldProfileId(input.openMeldProfileId),
        input.workspace.mode,
        input.workspace.mode === "custom"
          ? input.workspace.customWorkspacePath
          : "",
      ].join("\u0000")
    )
    .digest();
  const hex = digest.subarray(0, 16).toString("hex");
  // RFC 9562 name-based layout: version nibble 5, variant nibble 8-b.
  const variant = "89ab"[Number.parseInt(hex.charAt(16), 16) % 4];
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `${variant}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

export const OPENMELD_MANAGED_FOLDER_DISPLAY_NAME = "OpenMeld folder";

export function defaultProfileFolderDisplayName(path: string): string {
  const name = basename(path).trim();
  const parsed = profileFolderDisplayNameSchema.safeParse(
    name.length > 0 ? name : path
  );
  return parsed.success
    ? parsed.data
    : path.slice(-MAX_PROFILE_FOLDER_DISPLAY_NAME_LENGTH);
}

export function buildProfileFolderFromWorkspaceConfig(input: {
  displayName?: string;
  id: string;
  workspace: ProfileWorkspaceConfig;
}): ProfileFolder {
  if (input.workspace.mode === "custom") {
    return {
      displayName:
        input.displayName ??
        defaultProfileFolderDisplayName(input.workspace.customWorkspacePath),
      id: input.id,
      kind: "custom",
      path: input.workspace.customWorkspacePath,
    };
  }
  return {
    displayName: input.displayName ?? OPENMELD_MANAGED_FOLDER_DISPLAY_NAME,
    id: input.id,
    kind: "openmeld_managed",
  };
}

export function folderMatchesWorkspaceConfig(
  folder: ProfileFolder,
  workspace: ProfileWorkspaceConfig
): boolean {
  if (workspace.mode === "openmeld_managed") {
    return folder.kind === "openmeld_managed";
  }
  return (
    folder.kind === "custom" && folder.path === workspace.customWorkspacePath
  );
}

/** The v2 mirror of a default folder. Project folders are never a default. */
function mirrorDefaultProfileFolder(
  list: ProfileFolderList
): ProfileWorkspaceConfig | undefined {
  if (list.defaultFolderId === null) {
    return undefined;
  }
  const folder = list.folders.find((item) => item.id === list.defaultFolderId);
  if (!folder || folder.kind === "project") {
    throw new Error(
      "profile_folder.invalid_default: the default folder must be an OpenMeld or custom folder on this computer."
    );
  }
  return folder.kind === "custom"
    ? { customWorkspacePath: folder.path, mode: "custom" }
    : { mode: "openmeld_managed" };
}

/** The revision the next folder save writes. */
export function nextProfileFolderRevision(
  current: ProfileFolderListReadResult
): number {
  return (current.status === "valid" ? current.revision : 0) + 1;
}

export type ProfileFolderListMutation<T> =
  | { kind: "unchanged"; result: T }
  | {
      kind: "write";
      list: ProfileFolderList;
      origin?: ProfileWorkspaceOrigin;
      result: T;
      /** Overrides the next folder-save counter; repairs restart above it. */
      revision?: number;
      updatedAt: string;
    };

/**
 * The single writer for the local envelope. The mutation reads the current
 * list and replaces it under the existing writer lock, then the envelope is
 * replaced atomically with the v2 mirror recomputed from the default folder.
 */
export async function mutateProfileFolderListForAccount<T>(input: {
  account: OpenMeldAccountKey;
  mutate: (
    current: ProfileFolderListReadResult
  ) => Promise<ProfileFolderListMutation<T>>;
  openMeldProfileId: string;
}): Promise<T> {
  const openMeldProfileId = normalizeOpenMeldProfileId(input.openMeldProfileId);
  const lock = await acquireLock({
    openMeldProfileId,
    key: PROFILE_WORKSPACE_CONFIG_LOCK_KEY,
  });
  return await runWithHeldLock({
    lock,
    run: async () => {
      const path = accountProfileLocalMetaPath(
        input.account,
        openMeldProfileId
      );
      const current = await readProfileFolderListForAccount({
        account: input.account,
        openMeldProfileId,
      });
      const mutation = await input.mutate(current);
      if (mutation.kind === "unchanged") {
        return mutation.result;
      }
      assertValidProfileFolderList(mutation.list);
      const existingDraft = await readExistingEnvelopeDraft({
        openMeldProfileId,
        path,
      });
      const payload: Record<string, unknown> = {
        ...(existingDraft ?? {}),
        openMeldProfileId,
        updatedAt: mutation.updatedAt,
        v: PROFILE_LOCAL_META_ENVELOPE_VERSION,
        workspace: buildWorkspacePayload(
          mirrorDefaultProfileFolder(mutation.list)
        ),
        // An ordinary folder save supersedes the import observation. Omitted
        // origin clears preserved metadata when switching to managed mode.
        workspaceOrigin: mutation.origin,
        folders: mutation.list.folders.map(buildFolderPayload),
        defaultFolderId: mutation.list.defaultFolderId ?? undefined,
        foldersRevision:
          mutation.revision ?? nextProfileFolderRevision(current),
      };
      await mkdir(dirname(path), { recursive: true });
      const tempPath = `${path}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`;
      await writeFile(
        tempPath,
        `${JSON.stringify(payload, null, 2)}\n`,
        "utf8"
      );
      try {
        await rename(tempPath, path);
      } catch (error) {
        await rm(tempPath, { force: true }).catch(() => undefined);
        throw error;
      }
      return mutation.result;
    },
    releaseContext: {
      account: input.account,
      lockKey: PROFILE_WORKSPACE_CONFIG_LOCK_KEY,
      path: accountProfileLocalMetaPath(input.account, openMeldProfileId),
    },
  });
}

/** Reads saved configuration without migration, provisioning, or path validation. */
export async function readSavedProfileWorkspaceForAccount(input: {
  account: OpenMeldAccountKey;
  openMeldProfileId: string;
}): Promise<ProfileWorkspaceReadResult> {
  const result = await readProfileWorkspaceConfigForAccount(input);
  if (result.status === "missing") {
    return { status: "missing" };
  }
  if (result.status === "invalid") {
    return {
      status: "invalid",
      reasonCode: `profile.workspace.${result.reason}`,
    };
  }
  return {
    status: "configured",
    workspaceMode: result.value.mode,
    workspacePath: resolveConfiguredProfileWorkspacePathForAccount({
      ...input,
      value: result.value,
    }),
    configurationVersion: result.persistedVersion,
    updatedAt: result.updatedAt,
    ...(result.origin ? { configurationOrigin: result.origin.kind } : {}),
  };
}

export async function setOpenMeldManagedProfileWorkspace(input: {
  account?: OpenMeldAccountKey;
  openMeldProfileId: string;
  updatedAt?: string;
  onlyIfUnconfigured?: boolean;
}): Promise<ProfileWorkspaceWriteResult> {
  const account = await resolveAccountKey(input.account);
  const openMeldProfileId = normalizeOpenMeldProfileId(input.openMeldProfileId);
  const value: ProfileWorkspaceConfig = { mode: "openmeld_managed" };
  const updatedAt = normalizeUpdatedAt(input.updatedAt);
  const saved = await writeProfileWorkspaceConfigForAccount({
    account,
    openMeldProfileId,
    updatedAt,
    value,
    onlyIfUnconfigured: input.onlyIfUnconfigured,
    prepare: async () => {
      const path = accountProfileWorkspacePath(account, openMeldProfileId);
      try {
        await mkdir(path, { recursive: true });
      } catch (cause) {
        throw new Error(
          `Couldn’t prepare working folder '${path}'. Check that the path is a folder and that you can write to it.`,
          { cause }
        );
      }
      const validation = await validateCustomProfileWorkspacePath(path);
      if (validation.status === "invalid") {
        throw buildWorkspacePathValidationError(validation);
      }
    },
  });
  return {
    path: accountProfileLocalMetaPath(account, openMeldProfileId),
    ...saved,
    workspacePath: resolveConfiguredProfileWorkspacePathForAccount({
      account,
      openMeldProfileId,
      value: saved.value,
    }),
  };
}

export async function setCustomProfileWorkspace(input: {
  account?: OpenMeldAccountKey;
  openMeldProfileId: string;
  customWorkspacePath: string;
  updatedAt?: string;
  importedSession?: Pick<
    Extract<ProfileWorkspaceOrigin, { kind: "imported_native_session" }>,
    "agentControllerRef" | "agentControllerConversationId"
  >;
  onlyIfUnconfigured?: boolean;
}): Promise<ProfileWorkspaceWriteResult> {
  const account = await resolveAccountKey(input.account);
  const openMeldProfileId = normalizeOpenMeldProfileId(input.openMeldProfileId);
  const validation = await validateCustomProfileWorkspacePath(
    input.customWorkspacePath
  );
  if (validation.status === "invalid") {
    throw buildWorkspacePathValidationError(validation);
  }

  const value: ProfileWorkspaceConfig = {
    customWorkspacePath: validation.value,
    mode: "custom",
  };
  const updatedAt = normalizeUpdatedAt(input.updatedAt);
  const saved = await writeProfileWorkspaceConfigForAccount({
    account,
    openMeldProfileId,
    updatedAt,
    value,
    origin: profileWorkspaceOriginSchema.parse(
      input.importedSession
        ? {
            kind: "imported_native_session",
            configurationUpdatedAt: updatedAt,
            ...input.importedSession,
          }
        : { kind: "explicit", configurationUpdatedAt: updatedAt }
    ),
    onlyIfUnconfigured: input.onlyIfUnconfigured,
  });
  return {
    path: accountProfileLocalMetaPath(account, openMeldProfileId),
    ...saved,
    workspacePath: resolveConfiguredProfileWorkspacePathForAccount({
      account,
      openMeldProfileId,
      value: saved.value,
    }),
  };
}

export const ensureOpenMeldManagedProfileWorkspace =
  setOpenMeldManagedProfileWorkspace;

export async function migrateLegacyProfileWorkspaceConfigIfNeeded(input: {
  account?: OpenMeldAccountKey;
  openMeldProfileId: string;
  updatedAt?: string;
}): Promise<ProfileWorkspaceMigrationResult> {
  const account = await resolveAccountKey(input.account);
  const readResult = await readProfileWorkspaceConfigForAccount({
    account,
    openMeldProfileId: input.openMeldProfileId,
  });
  if (readResult.status === "missing" || readResult.status === "invalid") {
    return readResult;
  }
  if (readResult.persistedVersion === 2) {
    return {
      path: readResult.path,
      status: "already_current",
      value: readResult.value,
    };
  }

  const updatedAt = normalizeUpdatedAt(input.updatedAt ?? readResult.updatedAt);
  await writeProfileWorkspaceConfigForAccount({
    account,
    openMeldProfileId: input.openMeldProfileId,
    updatedAt,
    value: readResult.value,
  });

  return {
    path: readResult.path,
    status: "migrated",
    value: readResult.value,
  };
}

export async function resolveConfiguredProfileWorkspacePath(input: {
  account?: OpenMeldAccountKey;
  openMeldProfileId: string;
  value: ProfileWorkspaceConfig;
}): Promise<string> {
  const account = await resolveAccountKey(input.account);
  return resolveConfiguredProfileWorkspacePathForAccount({
    account,
    openMeldProfileId: input.openMeldProfileId,
    value: input.value,
  });
}

export function resolveConfiguredProfileWorkspacePathForAccount(input: {
  account: OpenMeldAccountKey;
  openMeldProfileId: string;
  value: ProfileWorkspaceConfig;
}): string {
  const openMeldProfileId = normalizeOpenMeldProfileId(input.openMeldProfileId);
  if (input.value.mode === "custom") {
    return input.value.customWorkspacePath;
  }
  return accountProfileWorkspacePath(input.account, openMeldProfileId);
}

async function writeProfileWorkspaceConfigForAccount(input: {
  account: OpenMeldAccountKey;
  openMeldProfileId: string;
  updatedAt: string;
  value: ProfileWorkspaceConfig;
  onlyIfUnconfigured?: boolean;
  origin?: ProfileWorkspaceOrigin;
  prepare?: () => Promise<void>;
}): Promise<
  Pick<ProfileWorkspaceWriteResult, "changed" | "updatedAt" | "value">
> {
  const openMeldProfileId = normalizeOpenMeldProfileId(input.openMeldProfileId);
  return await mutateProfileFolderListForAccount<
    Pick<ProfileWorkspaceWriteResult, "changed" | "updatedAt" | "value">
  >({
    account: input.account,
    openMeldProfileId,
    mutate: async (current) => {
      if (input.onlyIfUnconfigured) {
        if (current.status === "invalid") {
          throw new Error(
            `The working folder settings are invalid (${current.reason}). Repair them before retrying setup.`
          );
        }
        if (current.status === "valid" && current.workspace) {
          if (
            current.workspace.mode === "openmeld_managed" &&
            input.value.mode === "openmeld_managed"
          ) {
            await input.prepare?.();
          }
          return {
            kind: "unchanged",
            result: {
              changed: false,
              updatedAt: current.updatedAt,
              value: current.workspace,
            },
          };
        }
      }
      // Preparation and persistence share the writer lock. A failed folder
      // operation must leave the previously saved choice intact.
      await input.prepare?.();
      const list =
        current.status === "valid"
          ? current.list
          : { defaultFolderId: null, folders: [] };
      return {
        kind: "write",
        list: selectWorkspaceConfigAsDefaultFolder({
          list,
          openMeldProfileId,
          workspace: input.value,
        }),
        ...(input.origin ? { origin: input.origin } : {}),
        result: {
          changed: true,
          updatedAt: input.updatedAt,
          value: input.value,
        },
        updatedAt: input.updatedAt,
      };
    },
  });
}

/** Reuses the folder that already names this choice, or adds one. */
function selectWorkspaceConfigAsDefaultFolder(input: {
  list: ProfileFolderList;
  openMeldProfileId: string;
  workspace: ProfileWorkspaceConfig;
}): ProfileFolderList {
  const existing = input.list.folders.find((folder) =>
    folderMatchesWorkspaceConfig(folder, input.workspace)
  );
  if (existing) {
    return { defaultFolderId: existing.id, folders: input.list.folders };
  }
  const added = buildProfileFolderFromWorkspaceConfig({
    id: randomUUID(),
    workspace: input.workspace,
  });
  return {
    defaultFolderId: added.id,
    folders: [...input.list.folders, added],
  };
}

function buildFolderPayload(folder: ProfileFolder): Record<string, unknown> {
  switch (folder.kind) {
    case "custom":
      return {
        displayName: folder.displayName,
        id: folder.id,
        kind: folder.kind,
        path: folder.path,
      };
    case "project":
      return {
        displayName: folder.displayName,
        id: folder.id,
        kind: folder.kind,
        projectId: folder.projectId,
      };
    default:
      return {
        displayName: folder.displayName,
        id: folder.id,
        kind: folder.kind,
      };
  }
}

export class ProfileFolderListLimitError extends Error {
  readonly code = "profile_folder.limit_reached";
  constructor() {
    super(
      `An Agent can have at most ${String(MAX_PROFILE_FOLDERS)} folders on one computer. Remove a folder before adding another.`
    );
    this.name = "ProfileFolderListLimitError";
  }
}

function assertValidProfileFolderList(list: ProfileFolderList): void {
  if (list.folders.length > MAX_PROFILE_FOLDERS) {
    throw new ProfileFolderListLimitError();
  }
  if (!isValidProfileFolderCollection(list.folders)) {
    throw new Error("profile_folder.invalid_list: folders must be unique.");
  }
  if (
    list.defaultFolderId !== null &&
    !list.folders.some((folder) => folder.id === list.defaultFolderId)
  ) {
    throw new Error(
      "profile_folder.invalid_default: the default folder is not in the list."
    );
  }
}

function buildWorkspacePayload(
  value: ProfileWorkspaceConfig | undefined
): Record<string, unknown> | undefined {
  if (!value) {
    return undefined;
  }
  if (value.mode === "custom") {
    return {
      customWorkspacePath: value.customWorkspacePath,
      mode: value.mode,
    };
  }
  return {
    mode: value.mode,
  };
}

async function readExistingEnvelopeDraft(input: {
  openMeldProfileId: string;
  path: string;
}): Promise<Record<string, unknown> | null> {
  const raw = await readOptionalFile(input.path);
  if (raw === null) {
    return null;
  }
  const parsed = safeParseJson(raw);
  if (!(parsed && typeof parsed === "object")) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  if (record.v !== PROFILE_LOCAL_META_ENVELOPE_VERSION) {
    return null;
  }
  if (
    !storedProfileIdMatches(record.openMeldProfileId, input.openMeldProfileId)
  ) {
    return null;
  }
  return record;
}

function parseProfileLocalMetaEnvelopeV2(
  value: unknown
): ProfileLocalMetaEnvelope | null {
  if (!(value && typeof value === "object")) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.v !== PROFILE_LOCAL_META_ENVELOPE_VERSION) {
    return null;
  }
  const openMeldProfileId = normalizeStoredOpenMeldProfileId(
    record.openMeldProfileId
  );
  const updatedAt = normalizeTimestamp(record.updatedAt);
  const workspace = parseWorkspaceSection(record.workspace);
  const parsedOrigin = profileWorkspaceOriginSchema.safeParse(
    record.workspaceOrigin
  );
  const folders = parseFoldersSection(record.folders);
  const defaultFolderId = parseDefaultFolderId(record.defaultFolderId);
  const foldersRevision = parseFoldersRevision(record.foldersRevision);
  if (
    !(openMeldProfileId && updatedAt) ||
    workspace === null ||
    folders === null ||
    defaultFolderId === null ||
    foldersRevision === null
  ) {
    return null;
  }
  return {
    ...(workspace ? { workspace } : {}),
    ...(folders ? { folders } : {}),
    ...(defaultFolderId ? { defaultFolderId } : {}),
    ...(foldersRevision === undefined ? {} : { foldersRevision }),
    ...(workspace?.mode === "custom" &&
    parsedOrigin.success &&
    parsedOrigin.data.configurationUpdatedAt === updatedAt
      ? { workspaceOrigin: parsedOrigin.data }
      : {}),
    openMeldProfileId,
    updatedAt,
    v: 2,
  };
}

function parseFoldersSection(
  value: unknown
): ProfileFolder[] | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.length > MAX_PROFILE_FOLDERS) {
    return null;
  }
  const folders: ProfileFolder[] = [];
  for (const item of value) {
    const folder = parseFolderEntry(item);
    if (!folder) {
      return null;
    }
    folders.push(folder);
  }
  return isValidProfileFolderCollection(folders) ? folders : null;
}

function parseFolderEntry(value: unknown): ProfileFolder | null {
  if (!(value && typeof value === "object")) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const id = profileFolderIdSchema.safeParse(record.id);
  const displayName = profileFolderDisplayNameSchema.safeParse(
    record.displayName
  );
  if (!(id.success && displayName.success)) {
    return null;
  }
  const base = { displayName: displayName.data, id: id.data };
  switch (record.kind) {
    case "openmeld_managed":
      return hasOnlyExpectedKeys(record, ["displayName", "id", "kind"])
        ? { ...base, kind: "openmeld_managed" }
        : null;
    case "custom": {
      const path = normalizeStoredCustomWorkspacePath(record.path);
      return path &&
        hasOnlyExpectedKeys(record, ["displayName", "id", "kind", "path"])
        ? { ...base, kind: "custom", path }
        : null;
    }
    case "project": {
      const projectId =
        typeof record.projectId === "string" ? record.projectId.trim() : "";
      return projectId.length > 0 &&
        projectId.length <= 256 &&
        hasOnlyExpectedKeys(record, ["displayName", "id", "kind", "projectId"])
        ? { ...base, kind: "project", projectId }
        : null;
    }
    default:
      return null;
  }
}

function parseFoldersRevision(value: unknown): number | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function parseDefaultFolderId(value: unknown): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = profileFolderIdSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function profileFolderTargetKey(folder: ProfileFolder): string {
  switch (folder.kind) {
    case "custom":
      return `custom:${folder.path}`;
    case "project":
      return `project:${folder.projectId}`;
    default:
      return "openmeld_managed";
  }
}

/** Ids, custom paths and Project ids are unique; at most one managed folder. */
function isValidProfileFolderCollection(folders: ProfileFolder[]): boolean {
  const ids = new Set<string>();
  const keys = new Set<string>();
  for (const folder of folders) {
    const key = profileFolderTargetKey(folder);
    if (ids.has(folder.id) || keys.has(key)) {
      return false;
    }
    ids.add(folder.id);
    keys.add(key);
  }
  return true;
}

function parseWorkspaceSection(
  value: unknown
): ProfileWorkspaceConfig | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!(value && typeof value === "object")) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const mode = normalizeWorkspaceMode(record.mode);
  if (!mode) {
    return null;
  }
  if (mode === "openmeld_managed") {
    return hasOnlyExpectedKeys(record, ["mode"]) ? { mode } : null;
  }
  if (!hasOnlyExpectedKeys(record, ["customWorkspacePath", "mode"])) {
    return null;
  }
  const customWorkspacePath = normalizeStoredCustomWorkspacePath(
    record.customWorkspacePath
  );
  if (!customWorkspacePath) {
    return null;
  }
  return {
    customWorkspacePath,
    mode,
  };
}

function parseProfileLocalMetaLegacyV1(
  value: unknown
): ProfileLocalMetaLegacyV1 | null {
  if (!(value && typeof value === "object")) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.v !== PROFILE_LOCAL_META_LEGACY_VERSION) {
    return null;
  }
  const openMeldProfileId = normalizeStoredOpenMeldProfileId(
    record.openMeldProfileId
  );
  const updatedAt = normalizeTimestamp(record.updatedAt);
  const providerRuntimeWorkingDirectory =
    normalizeLegacyProviderRuntimeWorkingDirectory(
      record.providerRuntimeWorkingDirectory
    );
  if (
    !(
      openMeldProfileId &&
      updatedAt &&
      providerRuntimeWorkingDirectory &&
      hasOnlyExpectedKeys(record, [
        "openMeldProfileId",
        "providerRuntimeWorkingDirectory",
        "updatedAt",
        "v",
      ])
    )
  ) {
    return null;
  }
  return {
    openMeldProfileId,
    providerRuntimeWorkingDirectory,
    updatedAt,
    v: 1,
  };
}

function mapLegacyWorkingDirectoryToProfileWorkspaceConfig(input: {
  account: OpenMeldAccountKey;
  openMeldProfileId: string;
  providerRuntimeWorkingDirectory: string;
}): ProfileWorkspaceConfig | null {
  let normalizedLegacyWorkingDirectory: string;
  try {
    normalizedLegacyWorkingDirectory = normalizeCustomProfileWorkspacePath(
      input.providerRuntimeWorkingDirectory
    );
  } catch {
    return null;
  }
  const managedWorkspacePath = accountProfileWorkspacePath(
    input.account,
    input.openMeldProfileId
  );
  if (normalizedLegacyWorkingDirectory === managedWorkspacePath) {
    return {
      mode: "openmeld_managed",
    };
  }
  return {
    customWorkspacePath: normalizedLegacyWorkingDirectory,
    mode: "custom",
  };
}

function normalizeStoredCustomWorkspacePath(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  try {
    return normalizeCustomProfileWorkspacePath(value);
  } catch {
    return null;
  }
}

function normalizeLegacyProviderRuntimeWorkingDirectory(
  value: unknown
): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const parsed = providerDispatchRuntimeContextSchema.safeParse({
    providerRuntimeWorkingDirectory: value,
  });
  return parsed.success ? parsed.data.providerRuntimeWorkingDirectory : null;
}

function normalizeWorkspaceMode(value: unknown): ProfileWorkspaceMode | null {
  const parsed = profileWorkspaceModeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function normalizeStoredOpenMeldProfileId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  try {
    return normalizeOpenMeldProfileId(value);
  } catch {
    return null;
  }
}

function storedProfileIdMatches(
  value: unknown,
  expectedOpenMeldProfileId: string
): boolean {
  const storedOpenMeldProfileId = normalizeStoredOpenMeldProfileId(value);
  return (
    storedOpenMeldProfileId ===
    normalizeOpenMeldProfileId(expectedOpenMeldProfileId)
  );
}

function normalizeTimestamp(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  if (normalized.length === 0 || Number.isNaN(Date.parse(normalized))) {
    return null;
  }
  return normalized;
}

function normalizeUpdatedAt(value: string | undefined): string {
  return normalizeTimestamp(value) ?? new Date().toISOString();
}

function hasOnlyExpectedKeys(
  record: Record<string, unknown>,
  expectedKeys: string[]
): boolean {
  const allowedKeys = new Set(expectedKeys);
  return Object.keys(record).every((key) => allowedKeys.has(key));
}

function safeParseJson(raw: string): unknown | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function readOptionalFile(path: string): Promise<string | null> {
  return await readFile(path, "utf8").catch((error) => {
    if (isFileNotFoundError(error)) {
      return null;
    }
    throw error;
  });
}

function isFileNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}

function buildWorkspacePathValidationError(
  validation: Extract<
    CustomProfileWorkspacePathValidationResult,
    { status: "invalid" }
  >
): ProfileWorkspacePathError {
  return new ProfileWorkspacePathError({
    message: resolvePathValidationMessage(validation),
    path: validation.path,
    reason: validation.reason,
  });
}

function resolvePathValidationMessage(input: {
  path: string;
  reason: ProfileWorkspacePathErrorReason;
}): string {
  return describeProfileWorkspacePathValidationFailure(input);
}

async function resolveAccountKey(
  account: OpenMeldAccountKey | undefined
): Promise<OpenMeldAccountKey> {
  if (account) {
    return account;
  }
  const accountContext = await resolveCurrentOpenMeldAccountContext();
  return accountContext.key;
}
