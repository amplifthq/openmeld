import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, join } from "node:path";
import type { SpaceCreator } from "@openmeld/protocol";
import { spaceCreatorSchema } from "@openmeld/schemas";
import { normalizeRecentMentionProfileIds } from "@openmeld/space";
import { resolveCurrentOpenMeldAccountContext } from "../config/account-context";
import {
  accountProfileSpaceCacheDir,
  legacyAccountProfileSpacesDir,
  normalizeOpenMeldProfileId,
} from "../config/paths";

const SPACE_FILE_HASH_LENGTH = 8;
const SPACE_CACHE_SCHEMA_VERSION = 1;
const SPACE_CACHE_SOURCE = "local-cache";
const SPACE_CACHE_MAINTENANCE_SCHEMA_VERSION = 1;
const SPACE_CACHE_MAINTENANCE_FILENAME = "_maintenance.json";
const SPACE_CACHE_DELETION_NOTICE_SCHEMA_VERSION = 1;
const SPACE_CACHE_DELETION_NOTICES_FILENAME = "_deletion-notices.json";
const SPACE_CACHE_DELETION_NOTICE_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const SPACE_CACHE_METADATA_FILENAMES = new Set([
  SPACE_CACHE_MAINTENANCE_FILENAME,
  SPACE_CACHE_DELETION_NOTICES_FILENAME,
]);
const spaceConfigMutationQueueByKey = new Map<string, Promise<void>>();

export type SpaceConfig = {
  v: 2;
  schemaVersion: typeof SPACE_CACHE_SCHEMA_VERSION;
  source: typeof SPACE_CACHE_SOURCE;
  syncedAt: string;
  staleAt?: string;
  baseUrl: string;
  space: string;
  name?: string;
  openMeldProfileId: string;
  profileHandle?: string;
  profileName: string;
  role?: string;
  mentionAlias?: string;
  creator?: SpaceCreator;
  guide?: string;
  passwordProtected?: boolean;
  spaceCreatedAt?: string;
  spaceUpdatedAt?: string;
  spacePurpose?: string;
  activeAgentCount?: number;
  activeHumanCount?: number;
  activeMemberCount?: number;
  lastSeenTs?: number;
  recentMentionProfileIds?: string[];
  createdAt: string;
  updatedAt: string;
};

export type SpaceCacheMaintenanceState = {
  v: typeof SPACE_CACHE_MAINTENANCE_SCHEMA_VERSION;
  lastRunAt: string;
  lastRemovedByRemote?: number;
  lastRemovedByTtl?: number;
  lastTotalRemoved?: number;
};

export type SpaceCacheDeletionNoticeState = {
  v: typeof SPACE_CACHE_DELETION_NOTICE_SCHEMA_VERSION;
  seen: Record<string, string>;
};

export type SpaceCacheFileKind =
  | "space_config"
  | "maintenance_state"
  | "deletion_notice_state";

export type SpaceCacheIntegrityIssueReason =
  | "invalid_json"
  | "invalid_shape"
  | "read_error";

export type SpaceCacheIntegrityIssue = {
  path: string;
  kind: SpaceCacheFileKind;
  reason: SpaceCacheIntegrityIssueReason;
  detail: string | null;
};

export type LocalSpaceStateOkResult<
  TValue,
  TFileKind extends SpaceCacheFileKind,
> = {
  kind: "ok";
  fileKind: TFileKind;
  path: string;
  value: TValue;
};

export type LocalSpaceStateMissingResult<TFileKind extends SpaceCacheFileKind> =
  {
    kind: "missing";
    fileKind: TFileKind;
    path: string;
  };

export type LocalSpaceStateCorruptResult<TFileKind extends SpaceCacheFileKind> =
  {
    kind: SpaceCacheIntegrityIssueReason;
    fileKind: TFileKind;
    path: string;
    detail: string | null;
  };

export type LocalSpaceStateReadResult<
  TValue,
  TFileKind extends SpaceCacheFileKind,
> =
  | LocalSpaceStateOkResult<TValue, TFileKind>
  | LocalSpaceStateMissingResult<TFileKind>
  | LocalSpaceStateCorruptResult<TFileKind>;

export type SpaceConfigReadSource = "current" | "legacy";

export type SpaceConfigOkResult = LocalSpaceStateOkResult<
  SpaceConfig,
  "space_config"
> & {
  source: SpaceConfigReadSource;
};

export type SpaceConfigCorruptResult =
  LocalSpaceStateCorruptResult<"space_config"> & {
    source: SpaceConfigReadSource;
  };

export type SpaceConfigMissingResult = {
  kind: "missing";
  fileKind: "space_config";
  currentPath: string;
  legacyPath: string;
};

export type SpaceConfigReadResult =
  | SpaceConfigOkResult
  | SpaceConfigCorruptResult
  | SpaceConfigMissingResult;

export type SpaceConfigListResult =
  | {
      kind: "ok";
      items: SpaceConfig[];
    }
  | {
      kind: "corrupt";
      issues: SpaceCacheIntegrityIssue[];
    };

export type SpaceCacheMaintenanceStateReadResult = LocalSpaceStateReadResult<
  SpaceCacheMaintenanceState,
  "maintenance_state"
>;

export type SpaceCacheDeletionNoticeStateReadResult = LocalSpaceStateReadResult<
  SpaceCacheDeletionNoticeState,
  "deletion_notice_state"
>;

export class LocalSpaceStateIntegrityError extends Error {
  readonly operation: string;
  readonly fileKind: SpaceCacheFileKind;
  readonly reason: SpaceCacheIntegrityIssueReason;
  readonly path: string;
  readonly detail: string | null;
  readonly source: SpaceConfigReadSource | null;
  readonly issueCount: number;

  constructor(input: {
    operation: string;
    issue: SpaceCacheIntegrityIssue;
    source?: SpaceConfigReadSource;
    issueCount?: number;
  }) {
    const issueCount = input.issueCount ?? 1;
    const sourceText = input.source ? ` (${input.source})` : "";
    const detailText =
      input.issue.detail && input.issue.detail.trim().length > 0
        ? `: ${input.issue.detail}`
        : "";
    const issueCountText =
      issueCount > 1 ? ` (${String(issueCount)} corrupt entries)` : "";
    super(
      `Local space state integrity check failed during ${input.operation}: ${input.issue.kind}${sourceText} at ${input.issue.path} is ${input.issue.reason}${detailText}${issueCountText}`
    );
    this.name = "LocalSpaceStateIntegrityError";
    this.operation = input.operation;
    this.fileKind = input.issue.kind;
    this.reason = input.issue.reason;
    this.path = input.issue.path;
    this.detail = input.issue.detail;
    this.source = input.source ?? null;
    this.issueCount = issueCount;
  }
}

export async function upsertSpaceConfig(input: {
  openMeldProfileId?: string;
  baseUrl: string;
  space: string;
  name?: string | null;
  profileHandle?: string;
  profileName: string;
  role?: string | null;
  mentionAlias?: string | null;
  creator?: SpaceCreator | null;
  passwordProtected?: boolean;
  spaceCreatedAt?: string | null;
  spaceUpdatedAt?: string | null;
  spacePurpose?: string | null;
  activeAgentCount?: number | null;
  activeHumanCount?: number | null;
  activeMemberCount?: number | null;
  guide?: string | null;
}) {
  const openMeldProfileId = resolveOpenMeldProfileIdInput(input);
  await withSpaceConfigMutationLock(
    openMeldProfileId,
    input.space,
    async () => {
      const paths = await resolveSpaceFilePaths(openMeldProfileId, input.space);
      await mkdir(paths.currentDir, { recursive: true });

      const now = new Date().toISOString();
      const existingResult = await readSpaceConfigFromPaths(paths);
      if (isLocalSpaceStateCorruptResult(existingResult)) {
        throw toLocalSpaceStateIntegrityError({
          operation: "upserting a local space config",
          result: existingResult,
        });
      }
      const existing =
        existingResult.kind === "ok" ? existingResult.value : undefined;
      const hasProfileIdentityChanged =
        typeof existing?.openMeldProfileId === "string" &&
        existing.openMeldProfileId !== openMeldProfileId;
      const existingRole = hasProfileIdentityChanged
        ? undefined
        : existing?.role;
      const existingMentionAlias = hasProfileIdentityChanged
        ? undefined
        : existing?.mentionAlias;
      const existingLastSeenTs = hasProfileIdentityChanged
        ? undefined
        : existing?.lastSeenTs;
      const existingRecentMentionProfileIds = hasProfileIdentityChanged
        ? undefined
        : existing?.recentMentionProfileIds;
      const nextProfileHandle = resolveNextProfileHandle(
        hasProfileIdentityChanged ? undefined : existing?.profileHandle,
        input.profileHandle
      );

      const next: SpaceConfig = {
        v: 2,
        schemaVersion: SPACE_CACHE_SCHEMA_VERSION,
        source: SPACE_CACHE_SOURCE,
        syncedAt: now,
        baseUrl: input.baseUrl,
        space: input.space,
        openMeldProfileId,
        ...(nextProfileHandle ? { profileHandle: nextProfileHandle } : {}),
        profileName: input.profileName,
        name: resolveNextName(existing?.name, input.name),
        role: resolveNextRole(existingRole, input.role),
        mentionAlias: resolveNextMentionAlias(
          existingMentionAlias,
          input.mentionAlias
        ),
        creator: resolveNextCreator(existing?.creator, input.creator),
        guide: resolveNextGuide(existing?.guide, input.guide),
        passwordProtected: resolveNextPasswordProtected(
          existing?.passwordProtected,
          input.passwordProtected
        ),
        spaceCreatedAt: resolveNextSpaceTimestamp(
          existing?.spaceCreatedAt,
          input.spaceCreatedAt
        ),
        spaceUpdatedAt: resolveNextSpaceTimestamp(
          existing?.spaceUpdatedAt,
          input.spaceUpdatedAt
        ),
        spacePurpose: resolveNextOptionalString(
          existing?.spacePurpose,
          input.spacePurpose
        ),
        activeAgentCount: resolveNextOptionalNonNegativeInteger(
          existing?.activeAgentCount,
          input.activeAgentCount
        ),
        activeHumanCount: resolveNextOptionalNonNegativeInteger(
          existing?.activeHumanCount,
          input.activeHumanCount
        ),
        activeMemberCount: resolveNextOptionalNonNegativeInteger(
          existing?.activeMemberCount,
          input.activeMemberCount
        ),
        lastSeenTs: existingLastSeenTs,
        recentMentionProfileIds: existingRecentMentionProfileIds,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };

      await writeSpaceConfigFile(paths.currentPath, next);
      await cleanupLegacySpacePath(paths);
    }
  );
}

function resolveNextProfileHandle(
  existingProfileHandle: string | undefined,
  nextProfileHandle: string | undefined
): string | undefined {
  const normalizedNext = normalizeTrimmedOptionalString(nextProfileHandle);
  if (normalizedNext) {
    return normalizedNext;
  }
  return normalizeTrimmedOptionalString(existingProfileHandle);
}

function resolveOpenMeldProfileIdInput(input?: {
  openMeldProfileId?: string;
}): string {
  const resolvedInput = input ?? {};
  const openMeldProfileId = resolveProvidedOpenMeldProfileId(
    resolvedInput.openMeldProfileId,
    "openMeldProfileId"
  );
  const candidate = openMeldProfileId;
  if (!candidate) {
    throw new Error("openMeldProfileId is required");
  }

  return candidate;
}

function resolveProvidedOpenMeldProfileId(
  value: unknown,
  fieldName: string
): string | null {
  if (value === undefined) {
    return null;
  }
  const normalized = normalizeOptionalOpenMeldProfileId(value);
  if (!normalized) {
    throw new Error(`${fieldName} is invalid`);
  }
  return normalized;
}

export async function updateSpaceLastSeenTs(input: {
  openMeldProfileId?: string;
  space: string;
  lastSeenTs: number;
}): Promise<void> {
  const openMeldProfileId = resolveOpenMeldProfileIdInput(input);
  await withSpaceConfigMutationLock(
    openMeldProfileId,
    input.space,
    async () => {
      const paths = await resolveSpaceFilePaths(openMeldProfileId, input.space);
      const existingResult = await readSpaceConfigFromPaths(paths);
      if (existingResult.kind === "missing") {
        return;
      }
      if (isLocalSpaceStateCorruptResult(existingResult)) {
        throw toLocalSpaceStateIntegrityError({
          operation: "updating space lastSeenTs",
          result: existingResult,
        });
      }
      const existing = existingResult.value;
      if (existing.openMeldProfileId !== openMeldProfileId) {
        return;
      }

      const current =
        typeof existing.lastSeenTs === "number" ? existing.lastSeenTs : 0;
      if (input.lastSeenTs <= current) {
        return;
      }

      const now = new Date().toISOString();
      const next: SpaceConfig = {
        ...existing,
        v: 2,
        schemaVersion: SPACE_CACHE_SCHEMA_VERSION,
        source: SPACE_CACHE_SOURCE,
        syncedAt: now,
        lastSeenTs: input.lastSeenTs,
        updatedAt: now,
      };

      await mkdir(paths.currentDir, { recursive: true });
      await writeSpaceConfigFile(paths.currentPath, next);
      await cleanupLegacySpacePath(paths);
    }
  );
}

export async function readSpaceLastSeenTs(input: {
  openMeldProfileId?: string;
  space: string;
}): Promise<number | null> {
  const spaceConfigResult = await readSpaceConfig(input);
  if (spaceConfigResult.kind === "missing") {
    return null;
  }
  if (isLocalSpaceStateCorruptResult(spaceConfigResult)) {
    throw toLocalSpaceStateIntegrityError({
      operation: "reading space lastSeenTs",
      result: spaceConfigResult,
    });
  }
  const ts = spaceConfigResult.value.lastSeenTs;
  if (typeof ts !== "number" || !Number.isFinite(ts) || ts < 0) {
    return null;
  }
  return ts;
}

export async function readSpaceRecentMentionProfileIds(input: {
  openMeldProfileId?: string;
  space: string;
}): Promise<string[]> {
  const spaceConfigResult = await readSpaceConfig(input);
  if (spaceConfigResult.kind === "missing") {
    return [];
  }
  if (isLocalSpaceStateCorruptResult(spaceConfigResult)) {
    throw toLocalSpaceStateIntegrityError({
      operation: "reading space recent mention profile ids",
      result: spaceConfigResult,
    });
  }
  return normalizeRecentMentionProfileIds({
    profileIds: spaceConfigResult.value.recentMentionProfileIds,
  });
}

export async function writeSpaceRecentMentionProfileIds(input: {
  openMeldProfileId?: string;
  space: string;
  recentMentionProfileIds: readonly string[];
  allowedProfileIds?: readonly string[] | ReadonlySet<string> | null;
}): Promise<void> {
  const openMeldProfileId = resolveOpenMeldProfileIdInput(input);
  await withSpaceConfigMutationLock(
    openMeldProfileId,
    input.space,
    async () => {
      const paths = await resolveSpaceFilePaths(openMeldProfileId, input.space);
      const existingResult = await readSpaceConfigFromPaths(paths);
      if (existingResult.kind === "missing") {
        return;
      }
      if (isLocalSpaceStateCorruptResult(existingResult)) {
        throw toLocalSpaceStateIntegrityError({
          operation: "writing space recent mention profile ids",
          result: existingResult,
        });
      }
      const existing = existingResult.value;
      if (existing.openMeldProfileId !== openMeldProfileId) {
        return;
      }

      const currentRecentMentionProfileIds = normalizeRecentMentionProfileIds({
        profileIds: existing.recentMentionProfileIds,
      });
      const nextRecentMentionProfileIds = normalizeRecentMentionProfileIds({
        profileIds: input.recentMentionProfileIds,
        allowedProfileIds: input.allowedProfileIds,
      });
      if (
        areStringListsEqual(
          currentRecentMentionProfileIds,
          nextRecentMentionProfileIds
        )
      ) {
        return;
      }

      const now = new Date().toISOString();
      const next: SpaceConfig = {
        ...existing,
        v: 2,
        schemaVersion: SPACE_CACHE_SCHEMA_VERSION,
        source: SPACE_CACHE_SOURCE,
        syncedAt: now,
        recentMentionProfileIds:
          nextRecentMentionProfileIds.length > 0
            ? nextRecentMentionProfileIds
            : undefined,
        updatedAt: now,
      };

      await mkdir(paths.currentDir, { recursive: true });
      await writeSpaceConfigFile(paths.currentPath, next);
      await cleanupLegacySpacePath(paths);
    }
  );
}

export async function listSpaceConfigs(input?: {
  openMeldProfileId?: string;
}): Promise<SpaceConfigListResult> {
  const openMeldProfileId = resolveOpenMeldProfileIdInput(input);
  const paths = await resolveSpaceDirectoryPaths(openMeldProfileId);
  const list = new Map<string, SpaceConfig>();
  const issues: SpaceCacheIntegrityIssue[] = [];

  await collectSpaceConfigsFromDirectory({
    dir: paths.currentDir,
    source: "current",
    list,
    issues,
  });
  await collectSpaceConfigsFromDirectory({
    dir: paths.legacyDir,
    source: "legacy",
    list,
    issues,
  });

  if (issues.length > 0) {
    return {
      kind: "corrupt",
      issues,
    };
  }

  return {
    kind: "ok",
    items: [...list.values()].sort((a, b) =>
      compareIsoDateDesc(a.updatedAt, b.updatedAt)
    ),
  };
}

export async function readSpaceConfig(input: {
  openMeldProfileId?: string;
  space: string;
}): Promise<SpaceConfigReadResult> {
  const openMeldProfileId = resolveOpenMeldProfileIdInput(input);
  const paths = await resolveSpaceFilePaths(openMeldProfileId, input.space);
  return await readSpaceConfigFromPaths(paths);
}

export async function removeSpaceConfig(input: {
  openMeldProfileId?: string;
  space: string;
}): Promise<void> {
  const openMeldProfileId = resolveOpenMeldProfileIdInput(input);
  await withSpaceConfigMutationLock(
    openMeldProfileId,
    input.space,
    async () => {
      const paths = await resolveSpaceFilePaths(openMeldProfileId, input.space);
      await rm(paths.currentPath, { force: true });
      await rm(paths.legacyPath, { force: true });
    }
  );
}

export async function readSpaceCacheMaintenanceState(input?: {
  openMeldProfileId?: string;
}): Promise<SpaceCacheMaintenanceStateReadResult> {
  const openMeldProfileId = resolveOpenMeldProfileIdInput(input);
  const path = await resolveSpaceCacheMaintenancePath(openMeldProfileId);
  return await readSpaceCacheMaintenanceStateFile(path);
}

export async function writeSpaceCacheMaintenanceState(input: {
  openMeldProfileId?: string;
  lastRunAt: string;
  lastRemovedByRemote?: number;
  lastRemovedByTtl?: number;
  lastTotalRemoved?: number;
}): Promise<void> {
  const openMeldProfileId = resolveOpenMeldProfileIdInput(input);
  const path = await resolveSpaceCacheMaintenancePath(openMeldProfileId);
  const directory =
    await resolveSpaceCacheMaintenanceDirectory(openMeldProfileId);
  const lastRunAt = resolveIsoTimestamp(input.lastRunAt);
  if (!lastRunAt) {
    throw new Error("lastRunAt must be a valid ISO timestamp");
  }
  const lastRemovedByRemote = normalizeOptionalNonNegativeIntegerOrThrow({
    fieldName: "lastRemovedByRemote",
    value: input.lastRemovedByRemote,
  });
  const lastRemovedByTtl = normalizeOptionalNonNegativeIntegerOrThrow({
    fieldName: "lastRemovedByTtl",
    value: input.lastRemovedByTtl,
  });
  const lastTotalRemoved = normalizeOptionalNonNegativeIntegerOrThrow({
    fieldName: "lastTotalRemoved",
    value: input.lastTotalRemoved,
  });

  const payload: SpaceCacheMaintenanceState = {
    v: SPACE_CACHE_MAINTENANCE_SCHEMA_VERSION,
    lastRunAt,
    ...(lastRemovedByRemote === null ? {} : { lastRemovedByRemote }),
    ...(lastRemovedByTtl === null ? {} : { lastRemovedByTtl }),
    ...(lastTotalRemoved === null ? {} : { lastTotalRemoved }),
  };
  await mkdir(directory, { recursive: true });
  await writeSpaceCacheMaintenanceFile(path, payload);
}

export async function readSpaceCacheDeletionNoticeState(input?: {
  openMeldProfileId?: string;
}): Promise<SpaceCacheDeletionNoticeStateReadResult> {
  const openMeldProfileId = resolveOpenMeldProfileIdInput(input);
  const path = await resolveSpaceCacheDeletionNoticesPath(openMeldProfileId);
  const result = await readSpaceCacheDeletionNoticeStateFile(path);
  if (result.kind !== "ok") {
    return result;
  }
  const pruned = pruneSpaceCacheDeletionNoticeState(result.value, Date.now());
  if (pruned.changed) {
    const directory =
      await resolveSpaceCacheDeletionNoticesDirectory(openMeldProfileId);
    await mkdir(directory, { recursive: true });
    await writeSpaceCacheDeletionNoticeFile(path, pruned.state);
  }
  return {
    ...result,
    value: pruned.state,
  };
}

export async function writeSpaceCacheDeletionNoticeState(input: {
  openMeldProfileId?: string;
  seen: Record<string, string>;
}): Promise<void> {
  const openMeldProfileId = resolveOpenMeldProfileIdInput(input);
  const path = await resolveSpaceCacheDeletionNoticesPath(openMeldProfileId);
  const directory =
    await resolveSpaceCacheDeletionNoticesDirectory(openMeldProfileId);
  const normalized = normalizeSpaceCacheDeletionNoticeState({
    v: SPACE_CACHE_DELETION_NOTICE_SCHEMA_VERSION,
    seen: input.seen,
  });
  if (!normalized) {
    throw new Error("seen must be a record of ISO timestamps");
  }

  const payload = pruneSpaceCacheDeletionNoticeState(
    normalized,
    Date.now()
  ).state;
  await mkdir(directory, { recursive: true });
  await writeSpaceCacheDeletionNoticeFile(path, payload);
}

export async function inspectSpaceCacheFile(
  path: string
): Promise<SpaceCacheIntegrityIssue | null> {
  const kind = resolveSpaceCacheFileKind(path);
  if (!kind) {
    return null;
  }
  if (kind === "space_config") {
    const result = await readSpaceConfigFile(path, { source: "current" });
    return isLocalSpaceStateCorruptResult(result)
      ? toSpaceCacheIntegrityIssue(result)
      : null;
  }
  if (kind === "maintenance_state") {
    const result = await readSpaceCacheMaintenanceStateFile(path);
    return isLocalSpaceStateCorruptResult(result)
      ? toSpaceCacheIntegrityIssue(result)
      : null;
  }
  const result = await readSpaceCacheDeletionNoticeStateFile(path);
  return isLocalSpaceStateCorruptResult(result)
    ? toSpaceCacheIntegrityIssue(result)
    : null;
}

async function readSpaceConfigFromPaths(paths: {
  currentPath: string;
  legacyPath: string;
}): Promise<SpaceConfigReadResult> {
  const current = await readSpaceConfigFile(paths.currentPath, {
    source: "current",
  });
  if (current.kind !== "missing") {
    return current;
  }

  const legacy = await readSpaceConfigFile(paths.legacyPath, {
    source: "legacy",
  });
  if (legacy.kind !== "missing") {
    return legacy;
  }

  return {
    kind: "missing",
    fileKind: "space_config",
    currentPath: paths.currentPath,
    legacyPath: paths.legacyPath,
  };
}

async function readSpaceConfigFile(
  path: string,
  input: {
    source: SpaceConfigReadSource;
  }
): Promise<
  | SpaceConfigOkResult
  | SpaceConfigCorruptResult
  | LocalSpaceStateMissingResult<"space_config">
> {
  const result = await readSpaceCacheFile({
    path,
    fileKind: "space_config",
    parse: normalizeSpaceConfig,
  });
  if (result.kind === "missing") {
    return result;
  }
  if (result.kind === "ok") {
    return {
      ...result,
      source: input.source,
    };
  }
  return {
    ...result,
    source: input.source,
  };
}

async function readSpaceCacheMaintenanceStateFile(
  path: string
): Promise<SpaceCacheMaintenanceStateReadResult> {
  return await readSpaceCacheFile({
    path,
    fileKind: "maintenance_state",
    parse: normalizeSpaceCacheMaintenanceState,
  });
}

async function readSpaceCacheDeletionNoticeStateFile(
  path: string
): Promise<SpaceCacheDeletionNoticeStateReadResult> {
  return await readSpaceCacheFile({
    path,
    fileKind: "deletion_notice_state",
    parse: normalizeSpaceCacheDeletionNoticeState,
  });
}

async function readSpaceCacheFile<
  TValue,
  TFileKind extends SpaceCacheFileKind,
>(input: {
  path: string;
  fileKind: TFileKind;
  parse: (value: unknown) => TValue | null;
}): Promise<LocalSpaceStateReadResult<TValue, TFileKind>> {
  let raw: string;
  try {
    raw = await readFile(input.path, "utf8");
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      return {
        kind: "missing",
        fileKind: input.fileKind,
        path: input.path,
      };
    }
    return {
      kind: "read_error",
      fileKind: input.fileKind,
      path: input.path,
      detail: error instanceof Error ? error.message : null,
    };
  }

  const parsed = parseJsonDocument(raw);
  if (!parsed.ok) {
    return {
      kind: "invalid_json",
      fileKind: input.fileKind,
      path: input.path,
      detail: parsed.detail,
    };
  }

  const normalized = input.parse(parsed.value);
  if (!normalized) {
    return {
      kind: "invalid_shape",
      fileKind: input.fileKind,
      path: input.path,
      detail: null,
    };
  }

  return {
    kind: "ok",
    fileKind: input.fileKind,
    path: input.path,
    value: normalized,
  };
}

type DirectoryEntriesReadResult =
  | {
      kind: "ok";
      entries: Dirent[];
    }
  | {
      kind: "missing";
    }
  | {
      kind: "read_error";
      detail: string | null;
    };

async function readDirectoryEntries(
  path: string
): Promise<DirectoryEntriesReadResult> {
  try {
    return {
      kind: "ok",
      entries: await readdir(path, { withFileTypes: true }),
    };
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      return {
        kind: "missing",
      };
    }
    return {
      kind: "read_error",
      detail: error instanceof Error ? error.message : null,
    };
  }
}

type ResolvedSpaceConfigMetadata = {
  createdAt: string;
  updatedAt: string;
  spaceCreatedAt?: string;
  spaceUpdatedAt?: string;
  lastSeenTs?: number;
  spacePurpose?: string;
  activeAgentCount?: number;
  activeHumanCount?: number;
  activeMemberCount?: number;
  creator?: SpaceCreator;
};

type ResolvedCurrentSpaceConfigMetadata = ResolvedSpaceConfigMetadata & {
  syncedAt: string;
  staleAt?: string;
  recentMentionProfileIds?: string[];
};

async function collectSpaceConfigsFromDirectory(input: {
  dir: string;
  source: SpaceConfigReadSource;
  list: Map<string, SpaceConfig>;
  issues: SpaceCacheIntegrityIssue[];
}): Promise<void> {
  const entriesResult = await readDirectoryEntries(input.dir);
  if (entriesResult.kind === "missing") {
    return;
  }
  if (entriesResult.kind === "read_error") {
    input.issues.push({
      path: input.dir,
      kind: "space_config",
      reason: "read_error",
      detail: entriesResult.detail,
    });
    return;
  }

  for (const entry of entriesResult.entries) {
    if (!isReadableSpaceConfigEntry(entry)) {
      continue;
    }
    const parsed = await readSpaceConfigFile(join(input.dir, entry.name), {
      source: input.source,
    });
    if (parsed.kind === "missing") {
      continue;
    }
    if (isLocalSpaceStateCorruptResult(parsed)) {
      input.issues.push(toSpaceCacheIntegrityIssue(parsed));
      continue;
    }
    storeNewestSpaceConfig(input.list, parsed.value);
  }
}

function isReadableSpaceConfigEntry(entry: Dirent): boolean {
  return (
    entry.isFile() &&
    entry.name.endsWith(".json") &&
    !SPACE_CACHE_METADATA_FILENAMES.has(entry.name)
  );
}

function storeNewestSpaceConfig(
  list: Map<string, SpaceConfig>,
  candidate: SpaceConfig
): void {
  const existing = list.get(candidate.space);
  if (
    !existing ||
    compareIsoDateDesc(candidate.updatedAt, existing.updatedAt) < 0
  ) {
    list.set(candidate.space, candidate);
  }
}

function normalizeSpaceConfig(value: unknown): SpaceConfig | null {
  if (!isRecord(value)) {
    return null;
  }

  if (value.v === 2) {
    return normalizeCurrentSpaceConfig(value);
  }
  if (value.v === 1) {
    return normalizeLegacySpaceConfig(value);
  }
  return null;
}

function normalizeCurrentSpaceConfig(
  parsed: Record<string, unknown>
): SpaceConfig | null {
  const metadata = resolveCurrentSpaceConfigMetadata(parsed);
  if (!metadata || hasInvalidCurrentSpaceConfigPrimitives(parsed)) {
    return null;
  }

  const openMeldProfileId = resolveSpaceConfigOpenMeldProfileId(parsed);
  if (!openMeldProfileId) {
    return null;
  }

  return buildSpaceConfig({
    parsed,
    openMeldProfileId,
    syncedAt: metadata.syncedAt,
    staleAt: metadata.staleAt,
    recentMentionProfileIds: metadata.recentMentionProfileIds,
    creator: metadata.creator,
    spaceCreatedAt: metadata.spaceCreatedAt,
    spaceUpdatedAt: metadata.spaceUpdatedAt,
    spacePurpose: metadata.spacePurpose,
    activeAgentCount: metadata.activeAgentCount,
    activeHumanCount: metadata.activeHumanCount,
    activeMemberCount: metadata.activeMemberCount,
    lastSeenTs: metadata.lastSeenTs,
    createdAt: metadata.createdAt,
    updatedAt: metadata.updatedAt,
  });
}

function normalizeSpaceCacheMaintenanceState(
  value: unknown
): SpaceCacheMaintenanceState | null {
  if (!isRecord(value)) {
    return null;
  }

  const lastRunAt = resolveIsoTimestamp(value.lastRunAt);
  const lastRemovedByRemote = resolveOptionalNonNegativeInteger(
    value.lastRemovedByRemote
  );
  const lastRemovedByTtl = resolveOptionalNonNegativeInteger(
    value.lastRemovedByTtl
  );
  const lastTotalRemoved = resolveOptionalNonNegativeInteger(
    value.lastTotalRemoved
  );
  if (
    value.v !== SPACE_CACHE_MAINTENANCE_SCHEMA_VERSION ||
    typeof lastRunAt !== "string" ||
    (hasOwn(value, "lastRemovedByRemote") && lastRemovedByRemote === null) ||
    (hasOwn(value, "lastRemovedByTtl") && lastRemovedByTtl === null) ||
    (hasOwn(value, "lastTotalRemoved") && lastTotalRemoved === null)
  ) {
    return null;
  }

  return {
    v: SPACE_CACHE_MAINTENANCE_SCHEMA_VERSION,
    lastRunAt,
    ...(lastRemovedByRemote === null ? {} : { lastRemovedByRemote }),
    ...(lastRemovedByTtl === null ? {} : { lastRemovedByTtl }),
    ...(lastTotalRemoved === null ? {} : { lastTotalRemoved }),
  };
}

function normalizeSpaceCacheDeletionNoticeState(
  value: unknown
): SpaceCacheDeletionNoticeState | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    value.v !== SPACE_CACHE_DELETION_NOTICE_SCHEMA_VERSION ||
    !isRecord(value.seen)
  ) {
    return null;
  }

  const seen: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(value.seen)) {
    const key = normalizeTrimmedOptionalString(rawKey);
    const timestamp = resolveIsoTimestamp(rawValue);
    if (!(key && timestamp)) {
      return null;
    }
    seen[key] = timestamp;
  }

  return {
    v: SPACE_CACHE_DELETION_NOTICE_SCHEMA_VERSION,
    seen,
  };
}

function normalizeLegacySpaceConfig(
  parsed: Record<string, unknown>
): SpaceConfig | null {
  const metadata = resolveLegacySpaceConfigMetadata(parsed);
  if (!metadata || hasInvalidLegacySpaceConfigPrimitives(parsed)) {
    return null;
  }

  const openMeldProfileId = resolveSpaceConfigOpenMeldProfileId(parsed);
  if (!openMeldProfileId) {
    return null;
  }

  return buildSpaceConfig({
    parsed,
    openMeldProfileId,
    syncedAt: metadata.updatedAt,
    creator: metadata.creator,
    spaceCreatedAt: metadata.spaceCreatedAt,
    spaceUpdatedAt: metadata.spaceUpdatedAt,
    spacePurpose: metadata.spacePurpose,
    activeAgentCount: metadata.activeAgentCount,
    activeHumanCount: metadata.activeHumanCount,
    activeMemberCount: metadata.activeMemberCount,
    lastSeenTs: metadata.lastSeenTs,
    createdAt: metadata.createdAt,
    updatedAt: metadata.updatedAt,
  });
}

function buildSpaceConfig(input: {
  parsed: Record<string, unknown>;
  openMeldProfileId: string;
  syncedAt: string;
  staleAt?: string;
  recentMentionProfileIds?: string[];
  creator?: SpaceCreator;
  spaceCreatedAt?: string;
  spaceUpdatedAt?: string;
  spacePurpose?: string;
  activeAgentCount?: number;
  activeHumanCount?: number;
  activeMemberCount?: number;
  lastSeenTs?: number;
  createdAt: string;
  updatedAt: string;
}): SpaceConfig {
  return {
    v: 2,
    schemaVersion: SPACE_CACHE_SCHEMA_VERSION,
    source: SPACE_CACHE_SOURCE,
    syncedAt: input.syncedAt,
    ...(input.staleAt ? { staleAt: input.staleAt } : {}),
    baseUrl: input.parsed.baseUrl as string,
    space: input.parsed.space as string,
    openMeldProfileId: input.openMeldProfileId,
    profileName: input.parsed.profileName as string,
    ...resolveOptionalStringEntry(input.parsed, "name"),
    ...resolveOptionalStringEntry(input.parsed, "profileHandle"),
    ...resolveOptionalStringEntry(input.parsed, "role"),
    ...resolveOptionalStringEntry(input.parsed, "mentionAlias"),
    ...(input.creator ? { creator: input.creator } : {}),
    ...resolveOptionalStringEntry(input.parsed, "guide"),
    ...resolveOptionalBooleanEntry(input.parsed, "passwordProtected"),
    ...(input.spaceCreatedAt ? { spaceCreatedAt: input.spaceCreatedAt } : {}),
    ...(input.spaceUpdatedAt ? { spaceUpdatedAt: input.spaceUpdatedAt } : {}),
    ...(input.spacePurpose ? { spacePurpose: input.spacePurpose } : {}),
    ...(typeof input.activeAgentCount === "number"
      ? { activeAgentCount: input.activeAgentCount }
      : {}),
    ...(typeof input.activeHumanCount === "number"
      ? { activeHumanCount: input.activeHumanCount }
      : {}),
    ...(typeof input.activeMemberCount === "number"
      ? { activeMemberCount: input.activeMemberCount }
      : {}),
    ...(typeof input.lastSeenTs === "number"
      ? { lastSeenTs: input.lastSeenTs }
      : {}),
    ...(input.recentMentionProfileIds &&
    input.recentMentionProfileIds.length > 0
      ? { recentMentionProfileIds: input.recentMentionProfileIds }
      : {}),
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

function hasInvalidCurrentSpaceConfigPrimitives(
  parsed: Record<string, unknown>
): boolean {
  return [
    parsed.v !== 2,
    parsed.schemaVersion !== SPACE_CACHE_SCHEMA_VERSION,
    parsed.source !== SPACE_CACHE_SOURCE,
    !hasRequiredStringEntries(parsed, ["baseUrl", "space", "profileName"]),
    hasInvalidSpaceProfileIdEntries(parsed),
    hasInvalidOptionalStringEntry(parsed, "name"),
    hasInvalidOptionalStringEntry(parsed, "profileHandle"),
    hasInvalidOptionalStringEntry(parsed, "role"),
    hasInvalidOptionalStringEntry(parsed, "mentionAlias"),
    hasInvalidOptionalStringEntry(parsed, "guide"),
    hasInvalidOptionalStringEntry(parsed, "spacePurpose"),
    hasInvalidOptionalBooleanEntry(parsed, "passwordProtected"),
    hasInvalidOptionalNonNegativeIntegerEntry(parsed, "activeAgentCount"),
    hasInvalidOptionalNonNegativeIntegerEntry(parsed, "activeHumanCount"),
    hasInvalidOptionalNonNegativeIntegerEntry(parsed, "activeMemberCount"),
  ].some(Boolean);
}

function hasInvalidLegacySpaceConfigPrimitives(
  parsed: Record<string, unknown>
): boolean {
  return [
    parsed.v !== 1,
    !hasRequiredStringEntries(parsed, ["baseUrl", "space", "profileName"]),
    hasInvalidSpaceProfileIdEntries(parsed),
    hasInvalidOptionalStringEntry(parsed, "name"),
    hasInvalidOptionalStringEntry(parsed, "profileHandle"),
    hasInvalidOptionalStringEntry(parsed, "role"),
    hasInvalidOptionalStringEntry(parsed, "mentionAlias"),
    hasInvalidOptionalStringEntry(parsed, "guide"),
    hasOwn(parsed, "permissions") && !isRecord(parsed.permissions),
    hasInvalidOptionalBooleanEntry(parsed, "passwordProtected"),
    hasInvalidOptionalStringEntry(parsed, "spacePurpose"),
    hasInvalidOptionalNonNegativeIntegerEntry(parsed, "activeAgentCount"),
    hasInvalidOptionalNonNegativeIntegerEntry(parsed, "activeHumanCount"),
    hasInvalidOptionalNonNegativeIntegerEntry(parsed, "activeMemberCount"),
  ].some(Boolean);
}

function hasInvalidSpaceProfileIdEntries(
  parsed: Record<string, unknown>
): boolean {
  const openMeldProfileId = normalizeOptionalOpenMeldProfileId(
    parsed.openMeldProfileId
  );
  const legacyProfileId = normalizeOptionalOpenMeldProfileId(parsed.profileId);
  if (
    (hasOwn(parsed, "openMeldProfileId") && openMeldProfileId === null) ||
    (hasOwn(parsed, "profileId") && legacyProfileId === null)
  ) {
    return true;
  }
  if (!(openMeldProfileId || legacyProfileId)) {
    return true;
  }
  return (
    openMeldProfileId !== null &&
    legacyProfileId !== null &&
    openMeldProfileId !== legacyProfileId
  );
}

function resolveCurrentSpaceConfigMetadata(
  parsed: Record<string, unknown>
): ResolvedCurrentSpaceConfigMetadata | null {
  const syncedAt = resolveIsoTimestamp(parsed.syncedAt);
  const staleAt = resolveOptionalIsoTimestamp(parsed.staleAt);
  const baseMetadata = resolveSpaceConfigMetadata({
    parsed,
    creator: normalizeOptionalSpaceCreator(parsed.creator),
  });
  const recentMentionProfileIds = normalizeOptionalRecentMentionProfileIds(
    parsed.recentMentionProfileIds
  );

  if (
    !(syncedAt && baseMetadata) ||
    (hasOwn(parsed, "staleAt") && staleAt === null) ||
    (hasOwn(parsed, "recentMentionProfileIds") &&
      recentMentionProfileIds === null)
  ) {
    return null;
  }

  return {
    ...baseMetadata,
    syncedAt,
    ...(staleAt ? { staleAt } : {}),
    ...(recentMentionProfileIds && recentMentionProfileIds.length > 0
      ? { recentMentionProfileIds }
      : {}),
  };
}

function resolveLegacySpaceConfigMetadata(
  parsed: Record<string, unknown>
): ResolvedSpaceConfigMetadata | null {
  return resolveSpaceConfigMetadata({
    parsed,
    creator: normalizeOptionalSpaceCreator(parsed.creator),
  });
}

function resolveSpaceConfigMetadata(input: {
  parsed: Record<string, unknown>;
  creator: SpaceCreator | null | undefined;
}): ResolvedSpaceConfigMetadata | null {
  const createdAt = resolveIsoTimestamp(input.parsed.createdAt);
  const updatedAt = resolveIsoTimestamp(input.parsed.updatedAt);
  const spaceCreatedAt = resolveOptionalIsoTimestamp(
    input.parsed.spaceCreatedAt
  );
  const spaceUpdatedAt = resolveOptionalIsoTimestamp(
    input.parsed.spaceUpdatedAt
  );
  const lastSeenTs = resolveOptionalNonNegativeInteger(input.parsed.lastSeenTs);
  const activeAgentCount = resolveOptionalNonNegativeInteger(
    input.parsed.activeAgentCount
  );
  const activeHumanCount = resolveOptionalNonNegativeInteger(
    input.parsed.activeHumanCount
  );
  const activeMemberCount = resolveOptionalNonNegativeInteger(
    input.parsed.activeMemberCount
  );

  if (
    !(createdAt && updatedAt) ||
    (hasOwn(input.parsed, "creator") && input.creator === null) ||
    (hasOwn(input.parsed, "spaceCreatedAt") && spaceCreatedAt === null) ||
    (hasOwn(input.parsed, "spaceUpdatedAt") && spaceUpdatedAt === null) ||
    (hasOwn(input.parsed, "lastSeenTs") && lastSeenTs === null) ||
    (hasOwn(input.parsed, "activeAgentCount") && activeAgentCount === null) ||
    (hasOwn(input.parsed, "activeHumanCount") && activeHumanCount === null) ||
    (hasOwn(input.parsed, "activeMemberCount") && activeMemberCount === null)
  ) {
    return null;
  }

  return {
    createdAt,
    updatedAt,
    ...resolveOptionalStringEntry(input.parsed, "spacePurpose"),
    ...(spaceCreatedAt ? { spaceCreatedAt } : {}),
    ...(spaceUpdatedAt ? { spaceUpdatedAt } : {}),
    ...(typeof lastSeenTs === "number" ? { lastSeenTs } : {}),
    ...(typeof activeAgentCount === "number" ? { activeAgentCount } : {}),
    ...(typeof activeHumanCount === "number" ? { activeHumanCount } : {}),
    ...(typeof activeMemberCount === "number" ? { activeMemberCount } : {}),
    ...(input.creator ? { creator: input.creator } : {}),
  };
}

function hasRequiredStringEntries(
  parsed: Record<string, unknown>,
  keys: readonly string[]
): boolean {
  return keys.every((key) => typeof parsed[key] === "string");
}

function hasInvalidOptionalStringEntry(
  parsed: Record<string, unknown>,
  key: string
): boolean {
  return hasOwn(parsed, key) && typeof parsed[key] !== "string";
}

function hasInvalidOptionalBooleanEntry(
  parsed: Record<string, unknown>,
  key: string
): boolean {
  return hasOwn(parsed, key) && typeof parsed[key] !== "boolean";
}

function hasInvalidOptionalNonNegativeIntegerEntry(
  parsed: Record<string, unknown>,
  key: string
): boolean {
  return (
    hasOwn(parsed, key) &&
    resolveOptionalNonNegativeInteger(parsed[key]) === null
  );
}

function resolveOptionalStringEntry(
  parsed: Record<string, unknown>,
  key: string
): Record<string, string> {
  const value = parsed[key];
  return typeof value === "string" ? { [key]: value } : {};
}

function resolveOptionalBooleanEntry(
  parsed: Record<string, unknown>,
  key: string
): Record<string, boolean> {
  const value = parsed[key];
  return typeof value === "boolean" ? { [key]: value } : {};
}

function areStringListsEqual(
  left: readonly string[],
  right: readonly string[]
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.hasOwn(value, key);
}

function resolveOptionalIsoTimestamp(
  value: unknown
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  return resolveIsoTimestamp(value);
}

function resolveOptionalNonNegativeInteger(
  value: unknown
): number | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  return normalizeNonNegativeInteger(value);
}

function normalizeOptionalNonNegativeIntegerOrThrow(input: {
  fieldName: string;
  value: unknown;
}): number | undefined {
  if (input.value === undefined) {
    return undefined;
  }
  const normalized = normalizeNonNegativeInteger(input.value);
  if (normalized === null) {
    throw new Error(`${input.fieldName} must be a non-negative integer`);
  }
  return normalized;
}

function normalizeOptionalRecentMentionProfileIds(
  value: unknown
): string[] | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    return null;
  }
  return normalizeRecentMentionProfileIds({
    profileIds: value,
  });
}

function resolveSpaceConfigOpenMeldProfileId(
  parsed: Record<string, unknown>
): string | null {
  const openMeldProfileId = normalizeOptionalOpenMeldProfileId(
    parsed.openMeldProfileId
  );
  const legacyProfileId = normalizeOptionalOpenMeldProfileId(parsed.profileId);
  if (
    openMeldProfileId &&
    legacyProfileId &&
    openMeldProfileId !== legacyProfileId
  ) {
    return null;
  }
  return openMeldProfileId ?? legacyProfileId ?? null;
}

function normalizeOptionalOpenMeldProfileId(value: unknown): string | null {
  const raw = normalizeTrimmedOptionalString(
    typeof value === "string" ? value : undefined
  );
  if (!raw) {
    return null;
  }
  try {
    return normalizeOpenMeldProfileId(raw);
  } catch {
    return null;
  }
}

function normalizeOptionalSpaceCreator(
  value: unknown
): SpaceCreator | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = spaceCreatorSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function isLocalSpaceStateCorruptResult(
  result:
    | LocalSpaceStateReadResult<unknown, SpaceCacheFileKind>
    | SpaceConfigReadResult
): result is
  | LocalSpaceStateCorruptResult<SpaceCacheFileKind>
  | SpaceConfigCorruptResult {
  return (
    result.kind === "invalid_json" ||
    result.kind === "invalid_shape" ||
    result.kind === "read_error"
  );
}

export function toSpaceCacheIntegrityIssue(
  input:
    | {
        path: string;
        fileKind: SpaceCacheFileKind;
        kind: SpaceCacheIntegrityIssueReason;
        detail: string | null;
      }
    | LocalSpaceStateCorruptResult<SpaceCacheFileKind>
    | SpaceConfigCorruptResult
): SpaceCacheIntegrityIssue;
export function toSpaceCacheIntegrityIssue(
  input:
    | {
        path: string;
        fileKind: SpaceCacheFileKind;
        kind: SpaceCacheIntegrityIssueReason;
        detail: string | null;
      }
    | LocalSpaceStateCorruptResult<SpaceCacheFileKind>
    | SpaceConfigCorruptResult
): SpaceCacheIntegrityIssue {
  return {
    path: input.path,
    kind: input.fileKind,
    reason: input.kind,
    detail: input.detail,
  };
}

export function toLocalSpaceStateIntegrityError(input: {
  operation: string;
  result:
    | LocalSpaceStateCorruptResult<SpaceCacheFileKind>
    | SpaceConfigCorruptResult;
}): LocalSpaceStateIntegrityError {
  return new LocalSpaceStateIntegrityError({
    operation: input.operation,
    issue: toSpaceCacheIntegrityIssue(input.result),
    ...("source" in input.result ? { source: input.result.source } : {}),
  });
}

export function toSpaceConfigListIntegrityError(input: {
  operation: string;
  result: Extract<SpaceConfigListResult, { kind: "corrupt" }>;
}): LocalSpaceStateIntegrityError {
  return new LocalSpaceStateIntegrityError({
    operation: input.operation,
    issue: input.result.issues[0] ?? {
      path: "<unknown>",
      kind: "space_config",
      reason: "invalid_shape",
      detail: null,
    },
    issueCount: input.result.issues.length,
  });
}

function resolveNextName(
  existing: string | undefined,
  input: string | null | undefined
): string | undefined {
  if (input === null) {
    return undefined;
  }
  if (typeof input === "string") {
    return input;
  }
  return existing;
}

function resolveNextCreator(
  existing: SpaceCreator | undefined,
  input: SpaceCreator | null | undefined
): SpaceCreator | undefined {
  if (input === null) {
    return undefined;
  }
  return input ?? existing;
}

function resolveNextGuide(
  existing: string | undefined,
  input: string | null | undefined
): string | undefined {
  if (input === null) {
    return undefined;
  }
  if (typeof input === "string") {
    return input;
  }
  return existing;
}

function resolveNextPasswordProtected(
  existing: boolean | undefined,
  input: boolean | undefined
): boolean | undefined {
  if (typeof input === "boolean") {
    return input;
  }
  return existing;
}

function resolveNextRole(
  existing: string | undefined,
  input: string | null | undefined
): string | undefined {
  if (input === null) {
    return undefined;
  }
  if (typeof input === "string") {
    return input;
  }
  return existing;
}

function resolveNextMentionAlias(
  existing: string | undefined,
  input: string | null | undefined
): string | undefined {
  if (input === null) {
    return undefined;
  }
  if (typeof input === "string") {
    return input;
  }
  return existing;
}

function resolveNextSpaceTimestamp(
  existing: string | undefined,
  input: string | null | undefined
): string | undefined {
  if (input === null) {
    return undefined;
  }
  if (typeof input === "string") {
    const normalized = input.trim();
    if (normalized.length === 0) {
      return undefined;
    }
    const isoTimestamp = resolveIsoTimestamp(normalized);
    if (!isoTimestamp) {
      throw new Error("space timestamps must be valid ISO timestamps");
    }
    return isoTimestamp;
  }
  return existing;
}

function resolveNextOptionalString(
  existing: string | undefined,
  input: string | null | undefined
): string | undefined {
  if (input === null) {
    return undefined;
  }
  if (typeof input === "string") {
    const normalized = input.trim();
    return normalized.length > 0 ? normalized : undefined;
  }
  return existing;
}

function resolveNextOptionalNonNegativeInteger(
  existing: number | undefined,
  input: number | null | undefined
): number | undefined {
  if (input === null) {
    return undefined;
  }
  if (input === undefined) {
    return existing;
  }
  const normalized = normalizeNonNegativeInteger(input);
  if (normalized === null) {
    throw new Error("space count metadata must be a non-negative integer");
  }
  return normalized;
}

function normalizeTrimmedOptionalString(
  value: string | undefined
): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

async function withSpaceConfigMutationLock<T>(
  openMeldProfileId: string,
  space: string,
  callback: () => Promise<T>
): Promise<T> {
  const queueKey = `${openMeldProfileId}\n${space}`;
  const previous = spaceConfigMutationQueueByKey.get(queueKey);
  let releaseCurrent!: () => void;
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  spaceConfigMutationQueueByKey.set(queueKey, current);

  try {
    await previous?.catch(() => undefined);
    return await callback();
  } finally {
    releaseCurrent();
    if (spaceConfigMutationQueueByKey.get(queueKey) === current) {
      spaceConfigMutationQueueByKey.delete(queueKey);
    }
  }
}

async function resolveSpaceFilePaths(
  openMeldProfileId: string,
  space: string
): Promise<{
  currentDir: string;
  currentPath: string;
  legacyDir: string;
  legacyPath: string;
}> {
  const { currentDir, legacyDir } =
    await resolveSpaceDirectoryPaths(openMeldProfileId);
  const filename = `${sanitizeFilename(space)}.json`;
  return {
    currentDir,
    currentPath: join(currentDir, filename),
    legacyDir,
    legacyPath: join(legacyDir, filename),
  };
}

async function resolveSpaceCacheMaintenancePath(
  openMeldProfileId: string
): Promise<string> {
  const directory =
    await resolveSpaceCacheMaintenanceDirectory(openMeldProfileId);
  return join(directory, SPACE_CACHE_MAINTENANCE_FILENAME);
}

async function resolveSpaceCacheMaintenanceDirectory(
  openMeldProfileId: string
): Promise<string> {
  const { currentDir } = await resolveSpaceDirectoryPaths(openMeldProfileId);
  return currentDir;
}

async function resolveSpaceCacheDeletionNoticesPath(
  openMeldProfileId: string
): Promise<string> {
  const directory =
    await resolveSpaceCacheDeletionNoticesDirectory(openMeldProfileId);
  return join(directory, SPACE_CACHE_DELETION_NOTICES_FILENAME);
}

async function resolveSpaceCacheDeletionNoticesDirectory(
  openMeldProfileId: string
): Promise<string> {
  const { currentDir } = await resolveSpaceDirectoryPaths(openMeldProfileId);
  return currentDir;
}

async function resolveSpaceDirectoryPaths(openMeldProfileId: string): Promise<{
  currentDir: string;
  legacyDir: string;
}> {
  const accountContext = await resolveCurrentOpenMeldAccountContext();
  return {
    currentDir: accountProfileSpaceCacheDir(
      accountContext.key,
      openMeldProfileId
    ),
    legacyDir: legacyAccountProfileSpacesDir(
      accountContext.key,
      openMeldProfileId
    ),
  };
}

async function cleanupLegacySpacePath(paths: {
  currentPath: string;
  legacyPath: string;
}): Promise<void> {
  if (paths.currentPath === paths.legacyPath) {
    return;
  }
  await rm(paths.legacyPath, { force: true }).catch(() => undefined);
}

function sanitizeFilename(value: string): string {
  const safeBaseRaw = value.replace(/[^a-zA-Z0-9._-]+/g, "_");
  const safeBase = safeBaseRaw.length > 0 ? safeBaseRaw : "space";
  if (safeBase === value) {
    return safeBase;
  }
  const hash = createHash("sha1")
    .update(value, "utf8")
    .digest("hex")
    .slice(0, SPACE_FILE_HASH_LENGTH);
  return `${safeBase}_${hash}`;
}

function parseJsonDocument(
  value: string
): { ok: true; value: unknown } | { ok: false; detail: string | null } {
  try {
    return {
      ok: true,
      value: JSON.parse(value),
    };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : null,
    };
  }
}

function resolveSpaceCacheFileKind(path: string): SpaceCacheFileKind | null {
  const filename = basename(path);
  if (filename === SPACE_CACHE_MAINTENANCE_FILENAME) {
    return "maintenance_state";
  }
  if (filename === SPACE_CACHE_DELETION_NOTICES_FILENAME) {
    return "deletion_notice_state";
  }
  if (filename.endsWith(".json")) {
    return "space_config";
  }
  return null;
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === code
  );
}

function compareIsoDateDesc(left: string, right: string): number {
  const leftTs = Date.parse(left);
  const rightTs = Date.parse(right);
  const safeLeft = Number.isNaN(leftTs) ? 0 : leftTs;
  const safeRight = Number.isNaN(rightTs) ? 0 : rightTs;
  return safeRight - safeLeft;
}

function resolveIsoTimestamp(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return value;
}

function normalizeNonNegativeInteger(value: unknown): number | null {
  if (typeof value !== "number") {
    return null;
  }
  if (!Number.isInteger(value) || value < 0) {
    return null;
  }
  return value;
}

async function writeSpaceConfigFile(
  path: string,
  payload: SpaceConfig
): Promise<void> {
  await writeJsonFile(path, payload);
}

async function writeSpaceCacheMaintenanceFile(
  path: string,
  payload: SpaceCacheMaintenanceState
): Promise<void> {
  await writeJsonFile(path, payload);
}

async function writeSpaceCacheDeletionNoticeFile(
  path: string,
  payload: SpaceCacheDeletionNoticeState
): Promise<void> {
  await writeJsonFile(path, payload);
}

async function writeJsonFile(
  path: string,
  payload:
    | SpaceConfig
    | SpaceCacheMaintenanceState
    | SpaceCacheDeletionNoticeState
): Promise<void> {
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  try {
    await rename(tempPath, path);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function pruneSpaceCacheDeletionNoticeState(
  state: SpaceCacheDeletionNoticeState,
  nowTs: number
): {
  state: SpaceCacheDeletionNoticeState;
  changed: boolean;
} {
  const nextSeen: Record<string, string> = {};
  let changed = false;

  for (const [key, timestamp] of Object.entries(state.seen)) {
    const parsedTs = Date.parse(timestamp);
    if (
      Number.isNaN(parsedTs) ||
      parsedTs + SPACE_CACHE_DELETION_NOTICE_RETENTION_MS < nowTs
    ) {
      changed = true;
      continue;
    }
    nextSeen[key] = timestamp;
  }

  if (
    !changed &&
    Object.keys(nextSeen).length === Object.keys(state.seen).length
  ) {
    return { state, changed: false };
  }

  return {
    state: {
      v: SPACE_CACHE_DELETION_NOTICE_SCHEMA_VERSION,
      seen: nextSeen,
    },
    changed: true,
  };
}
