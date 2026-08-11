import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  profileWorkspaceModeSchema,
  providerDispatchRuntimeContextSchema,
} from "@openmeld/schemas";
import type { ProfileWorkspaceMode } from "@openmeld/schemas/types";
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

export type ProfileLocalMetaEnvelope = {
  openMeldProfileId: string;
  updatedAt: string;
  v: 2;
  workspace?: ProfileWorkspaceConfig;
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
      value: config,
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
  if (!envelope.workspace) {
    return {
      path,
      status: "missing",
    };
  }
  return {
    path,
    persistedVersion: 2,
    status: "valid",
    updatedAt: envelope.updatedAt,
    value: envelope.workspace,
  };
}

export async function setOpenMeldManagedProfileWorkspace(input: {
  account?: OpenMeldAccountKey;
  openMeldProfileId: string;
  updatedAt?: string;
}): Promise<ProfileWorkspaceWriteResult> {
  const account = await resolveAccountKey(input.account);
  const openMeldProfileId = normalizeOpenMeldProfileId(input.openMeldProfileId);
  const value: ProfileWorkspaceConfig = { mode: "openmeld_managed" };
  const updatedAt = normalizeUpdatedAt(input.updatedAt);
  await writeProfileWorkspaceConfigForAccount({
    account,
    openMeldProfileId,
    updatedAt,
    value,
  });
  return {
    path: accountProfileLocalMetaPath(account, openMeldProfileId),
    updatedAt,
    value,
    workspacePath: resolveConfiguredProfileWorkspacePathForAccount({
      account,
      openMeldProfileId,
      value,
    }),
  };
}

export async function setCustomProfileWorkspace(input: {
  account?: OpenMeldAccountKey;
  openMeldProfileId: string;
  customWorkspacePath: string;
  updatedAt?: string;
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
  await writeProfileWorkspaceConfigForAccount({
    account,
    openMeldProfileId,
    updatedAt,
    value,
  });
  return {
    path: accountProfileLocalMetaPath(account, openMeldProfileId),
    updatedAt,
    value,
    workspacePath: validation.value,
  };
}

export async function ensureOpenMeldManagedProfileWorkspace(input: {
  account?: OpenMeldAccountKey;
  openMeldProfileId: string;
  updatedAt?: string;
}): Promise<ProfileWorkspaceWriteResult> {
  const account = await resolveAccountKey(input.account);
  const openMeldProfileId = normalizeOpenMeldProfileId(input.openMeldProfileId);
  const workspacePath = accountProfileWorkspacePath(account, openMeldProfileId);
  await mkdir(workspacePath, { recursive: true });
  const result = await setOpenMeldManagedProfileWorkspace({
    account,
    openMeldProfileId,
    updatedAt: input.updatedAt,
  });
  return {
    ...result,
    workspacePath,
  };
}

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
}): Promise<void> {
  const openMeldProfileId = normalizeOpenMeldProfileId(input.openMeldProfileId);
  const lock = await acquireLock({
    openMeldProfileId,
    key: PROFILE_WORKSPACE_CONFIG_LOCK_KEY,
  });
  await runWithHeldLock({
    lock,
    run: async () => {
      const path = accountProfileLocalMetaPath(
        input.account,
        openMeldProfileId
      );
      const existingDraft = await readExistingEnvelopeDraft({
        openMeldProfileId,
        path,
      });
      const payload: Record<string, unknown> = {
        ...(existingDraft ?? {}),
        openMeldProfileId,
        updatedAt: input.updatedAt,
        v: PROFILE_LOCAL_META_ENVELOPE_VERSION,
        workspace: buildWorkspacePayload(input.value),
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
    },
    releaseContext: {
      account: input.account,
      lockKey: PROFILE_WORKSPACE_CONFIG_LOCK_KEY,
      path: accountProfileLocalMetaPath(input.account, openMeldProfileId),
    },
  });
}

function buildWorkspacePayload(
  value: ProfileWorkspaceConfig
): Record<string, unknown> {
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
  if (!(openMeldProfileId && updatedAt) || workspace === null) {
    return null;
  }
  return {
    ...(workspace ? { workspace } : {}),
    openMeldProfileId,
    updatedAt,
    v: 2,
  };
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
