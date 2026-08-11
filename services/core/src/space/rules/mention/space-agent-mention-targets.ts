import type { Profile } from "@openmeld/protocol";
import { resolveSpaceMentionLabels } from "@openmeld/schemas";
import {
  listSpaceMemberRecords,
  type SpaceMemberRecord,
} from "../../infrastructure/sql/space-member-repo";
import { parseStoredSignal } from "../parsers/stored-signal";

const MENTION_ALIAS_SIGNAL_SCAN_LIMIT = 512;

type LiveSessionLike = {
  profile?: Profile;
  enforcedProfile?: Profile;
};

type AgentMentionTargetEntry = {
  profileId: string;
  profileHandle: string | null;
  profileName: string | null;
  mentionAlias: string | null;
  addedAt: string | null;
  createdAt: string | null;
  targetable: boolean;
};

type PersistedMentionTargetRow = {
  profile_id: string | null;
  ts: number | null;
  payload_json: string;
};

type CursorMentionAliasRow = {
  profile_id: string | null;
  mention_alias: string | null;
};

export function buildAgentMentionTargetAliasIndex(input: {
  sessions: Iterable<LiveSessionLike> | null;
  sql: SqlStorage;
}): Map<string, Set<string>> {
  const entries = listAgentMentionTargetEntries(input);
  const aliasIndex = new Map<string, Set<string>>();
  const resolvedLabelsByProfileId =
    resolveAgentMentionLabelsByProfileId(entries);

  for (const entry of entries) {
    if (!entry.targetable) {
      continue;
    }
    const resolvedLabels = resolvedLabelsByProfileId.get(entry.profileId);
    if (!resolvedLabels) {
      continue;
    }
    for (const exactMentionLabel of resolvedLabels.exactMentionLabels) {
      addAlias(aliasIndex, exactMentionLabel, entry.profileId);
    }
  }

  return aliasIndex;
}

export function buildEffectiveAgentMentionLabelByProfileId(input: {
  sessions: Iterable<LiveSessionLike> | null;
  sql: SqlStorage;
}): Map<string, string> {
  const entries = listAgentMentionTargetEntries(input);
  const resolvedLabelsByProfileId =
    resolveAgentMentionLabelsByProfileId(entries);
  return new Map(
    [...resolvedLabelsByProfileId.entries()].map(([profileId, labels]) => [
      profileId,
      labels.primaryMentionLabel,
    ])
  );
}

function listAgentMentionTargetEntries(input: {
  sessions: Iterable<LiveSessionLike> | null;
  sql: SqlStorage;
}): AgentMentionTargetEntry[] {
  const cursorMentionAliasesByProfileId = listCursorMentionAliasesByProfileId(
    input.sql
  );
  const entryByProfileId = new Map<string, AgentMentionTargetEntry>();

  for (const record of listSpaceMemberRecords(input.sql)) {
    mergeAgentMentionTargetEntry(entryByProfileId, {
      profileId: record.profileId,
      profileKind: record.profileKindSnapshot,
      profileHandle: null,
      profileName: record.profileNameSnapshot,
      mentionAlias:
        cursorMentionAliasesByProfileId.get(record.profileId) ?? null,
      addedAt: record.addedAt,
      createdAt: record.createdAt,
      targetable: record.status === "active",
    });
  }

  for (const session of input.sessions ?? []) {
    const profile = session.profile ?? session.enforcedProfile;
    if (!profile) {
      continue;
    }
    mergeAgentMentionTargetEntry(entryByProfileId, {
      profileId: profile.profileId,
      profileKind: profile.kind,
      profileHandle: normalizeOptionalText(profile.profileHandle),
      profileName: normalizeOptionalText(profile.profileName),
      mentionAlias:
        cursorMentionAliasesByProfileId.get(profile.profileId) ?? null,
      addedAt: null,
      createdAt: null,
      targetable: true,
    });
  }

  for (const row of listPersistedMentionTargetRows(input.sql)) {
    const signal = parseStoredSignal(row.payload_json);
    if (signal?.profile?.kind !== "agent") {
      continue;
    }
    mergeAgentMentionTargetEntry(entryByProfileId, {
      profileId:
        normalizeOptionalText(row.profile_id) ??
        normalizeOptionalText(signal.profile.profileId),
      profileKind: signal.profile.kind,
      profileHandle: normalizeOptionalText(signal.profile.profileHandle),
      profileName: normalizeOptionalText(signal.profile.profileName),
      mentionAlias:
        cursorMentionAliasesByProfileId.get(signal.profile.profileId) ?? null,
      addedAt: null,
      createdAt:
        typeof row.ts === "number" && Number.isFinite(row.ts)
          ? new Date(row.ts).toISOString()
          : null,
      targetable: true,
    });
  }

  for (const [profileId, mentionAlias] of cursorMentionAliasesByProfileId) {
    mergeAgentMentionTargetEntry(entryByProfileId, {
      profileId,
      profileKind: "agent",
      profileHandle: null,
      profileName: null,
      mentionAlias,
      addedAt: null,
      createdAt: null,
      targetable: true,
    });
  }

  return [...entryByProfileId.values()];
}

function listPersistedMentionTargetRows(
  sql: SqlStorage
): PersistedMentionTargetRow[] {
  return sql
    .exec<PersistedMentionTargetRow>(
      `
        SELECT profile_id, ts, payload_json
        FROM space_signals
        WHERE profile_id IS NOT NULL
        ORDER BY ts DESC, id DESC
        LIMIT ?
      `,
      MENTION_ALIAS_SIGNAL_SCAN_LIMIT
    )
    .toArray();
}

function listCursorMentionAliasesByProfileId(
  sql: SqlStorage
): Map<string, string> {
  const rows = sql
    .exec<CursorMentionAliasRow>(
      `
        SELECT profile_id, mention_alias
        FROM space_cursors
        WHERE mention_alias IS NOT NULL
      `
    )
    .toArray();
  const aliasesByProfileId = new Map<string, string>();

  for (const row of rows) {
    const profileId = normalizeOptionalText(row.profile_id);
    const mentionAlias = normalizeOptionalText(row.mention_alias);
    if (!(profileId && mentionAlias)) {
      continue;
    }
    aliasesByProfileId.set(profileId, mentionAlias);
  }

  return aliasesByProfileId;
}

function resolveAgentMentionLabelsByProfileId(
  entries: readonly AgentMentionTargetEntry[]
): ReadonlyMap<
  string,
  {
    exactMentionLabels: readonly string[];
    primaryMentionLabel: string;
  }
> {
  return resolveSpaceMentionLabels(
    entries
      .filter((entry) => entry.targetable)
      .map((entry) => ({
        mentionAlias: entry.mentionAlias,
        profileId: entry.profileId,
        profileName: entry.profileName,
      }))
  );
}

function mergeAgentMentionTargetEntry(
  entryByProfileId: Map<string, AgentMentionTargetEntry>,
  input: {
    profileId: string | null;
    profileKind: Profile["kind"] | SpaceMemberRecord["profileKindSnapshot"];
    profileHandle: string | null;
    profileName: string | null;
    mentionAlias: string | null;
    addedAt: string | null;
    createdAt: string | null;
    targetable: boolean;
  }
): void {
  if (input.profileKind !== "agent") {
    return;
  }

  const profileId = normalizeOptionalText(input.profileId);
  if (!profileId) {
    return;
  }

  const existing = entryByProfileId.get(profileId);
  if (!existing) {
    entryByProfileId.set(profileId, {
      profileId,
      profileHandle: input.profileHandle,
      profileName: input.profileName,
      mentionAlias: input.mentionAlias,
      addedAt: input.addedAt,
      createdAt: input.createdAt,
      targetable: input.targetable,
    });
    return;
  }

  entryByProfileId.set(profileId, {
    profileId,
    profileHandle: existing.profileHandle ?? input.profileHandle,
    profileName: resolveMergedProfileName({
      profileId,
      existingProfileName: existing.profileName,
      nextProfileName: input.profileName,
    }),
    mentionAlias: existing.mentionAlias ?? input.mentionAlias,
    addedAt: existing.addedAt ?? input.addedAt,
    createdAt: existing.createdAt ?? input.createdAt,
    targetable: existing.targetable || input.targetable,
  });
}

function resolveMergedProfileName(input: {
  profileId: string;
  existingProfileName: string | null;
  nextProfileName: string | null;
}): string | null {
  if (!input.existingProfileName) {
    return input.nextProfileName;
  }
  if (!input.nextProfileName) {
    return input.existingProfileName;
  }
  if (
    looksLikeProfileIdLabel(input.profileId, input.existingProfileName) &&
    !looksLikeProfileIdLabel(input.profileId, input.nextProfileName)
  ) {
    return input.nextProfileName;
  }
  return input.existingProfileName;
}

function addAlias(
  aliasIndex: Map<string, Set<string>>,
  aliasToken: string,
  targetProfileId: string
): void {
  const normalizedAlias = aliasToken.trim();
  if (normalizedAlias.length === 0 || targetProfileId.length === 0) {
    return;
  }
  const existing = aliasIndex.get(normalizedAlias);
  if (existing) {
    existing.add(targetProfileId);
    return;
  }
  aliasIndex.set(normalizedAlias, new Set([targetProfileId]));
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized =
    typeof value === "string" ? value.trim() : String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function looksLikeProfileIdLabel(
  profileId: string,
  profileName: string | null
): boolean {
  if (!profileName) {
    return false;
  }
  return profileName.trim().toLowerCase() === profileId.trim().toLowerCase();
}
