import {
  HOSTED_CENTER_AGENT_CONTROLLER_REF,
  resolveAgentWakeAvailability,
  resolveHostedAgentWakeAvailability,
} from "@openmeld/agent-runtime";
import type { Profile, SignalEnvelope, SpaceCreator } from "@openmeld/protocol";
import {
  normalizeOptionalWorkingDirectory,
  SPACE_MEMBER_JOIN_NOTICE_PURPOSE,
  spaceMemberWebActivityWriteSchema,
} from "@openmeld/schemas";
import type {
  LeaveSpaceResponse,
  PostSpaceMembersResponse,
  RemoveSpaceMembersResponse,
  RuntimeTransportLookupOwnerServiceResponse,
  RuntimeTransportLookupRouteResponse,
  SpaceIdentityDirectory,
  SpaceIdentityDirectoryEntry,
  SpaceMemberAgentSnapshot,
  SpaceMemberDirectory,
  SpaceMemberHumanSnapshot,
  SpaceMembersSnapshot,
  SpaceStatusMembersSummary,
} from "@openmeld/schemas/types";
import { buildSpaceMemberDirectoryFromIdentityDirectory } from "@openmeld/space";
import { resolveCoreAgentExecutionReadiness } from "../../agent-execution/application/agent-execution-readiness-service";
import {
  lookupRuntimeTransportOwnerService,
  lookupRuntimeTransportRoutesBatch,
} from "../../dispatch/infrastructure/runtime-transport/runtime-transport-client";
import { type CoreBindings, identityDb } from "../../lib/bindings";
import { CORE_LOG_EVENTS } from "../../shared/observability/log-events";
import {
  clearMemberProfileLivenessEvidence,
  recordMemberProfileNotFoundObservation,
} from "../infrastructure/sql/space-member-liveness-repo";
import {
  listSpaceMemberRecords,
  readSpaceMemberRecord,
  type SpaceMemberRecord,
  upsertSpaceMemberRecord,
} from "../infrastructure/sql/space-member-repo";
import {
  readSpaceMemberHumanTextActivity,
  readSpaceMemberWebActivity,
  recordSpaceMemberWebActivity,
} from "../infrastructure/sql/space-member-web-activity-repo";
import type { SpaceMetaRecord } from "../infrastructure/sql/space-meta-repo";
import { normalizeSpaceMemberNameSnapshot } from "../rules/member-name";
import { parseStoredSignal } from "../rules/parsers/stored-signal";
import { redactProfileForViewer } from "../rules/privacy/agent-profile-visibility";
import { resolveViewerCreatorProfileIdsByProfileId } from "../rules/privacy/profile-lineage";
import type { SpaceBootstrapTimingCollector } from "./space-bootstrap-timing";

const LEGACY_ADD_MEMBERS_NOTICE_REGEX =
  /^(?:(?:🤖|👤)\s*)?(.+?)\s+\((human|agent)(?:,\s+[^)]+)?\)\s+joined the space via add-members\.$/i;
const LEGACY_ADDED_TO_SPACE_NOTICE_REGEX =
  /^.+?\s+added\s+(.+?)\s+to this space\.$/i;
const SPACE_MEMBER_LEADING_EMOJI_REGEX = /^(?:🤖|👤)\s+/u;
const SHORT_LAST_SEEN_MINUTE_MS = 60_000;
const SHORT_LAST_SEEN_HOUR_MS = 3_600_000;
const SHORT_LAST_SEEN_DAY_MS = 86_400_000;
const HUMAN_AVATAR_READ_BATCH_SIZE = 100;

type LiveSessionLike = {
  profile?: Profile;
  enforcedProfile?: Profile;
};

type SpaceMembersSnapshotTiming = {
  collector: SpaceBootstrapTimingCollector;
  descriptionPrefix: string;
  metricPrefix: string;
};

export type ResolvedAddSpaceMemberInput = {
  profileId: string;
  profileName: string | null;
  profileKind: "human" | "agent";
  ownerUserId: string | null;
  ownerName: string | null;
  agentControllerRef: string | null;
};

type SpaceMemberSourceHint = {
  addedAt: string;
  addedByProfileId: string | null;
  addedByDisplayName: string | null;
  profileKind: "human" | "agent" | null;
};

type SpaceMemberSourceHints = {
  byProfileId: Map<string, SpaceMemberSourceHint>;
  byUniqueProfileName: Map<string, SpaceMemberSourceHint>;
};

type CursorMemberSnapshot = {
  profileId: string;
  mentionAlias: string | null;
  lastSeenAt: string | null;
  createdAt: string | null;
};

type LatestSignalActivity = {
  profileId: string;
  lastSignalAt: string;
};

type LatestAgentOriginFacts = {
  profileId: string;
  agentControllerConversationId: string | null;
  ts: number;
  workingDirectory: string | null;
};

type ExistingMemberProfileSnapshot = Pick<
  SpaceMemberRecord,
  | "profileNameSnapshot"
  | "ownerUserIdSnapshot"
  | "ownerNameSnapshot"
  | "controllerRefSnapshot"
>;

export class SpaceMembersUseCaseError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(input: { status: number; code: string; message: string }) {
    super(input.message);
    this.name = "SpaceMembersUseCaseError";
    this.status = input.status;
    this.code = input.code;
  }
}

export function recordSpaceMemberWebActivityUseCase(input: {
  sql: SqlStorage;
  organizationId: string | null;
  activity: unknown;
}): string {
  const parsed = spaceMemberWebActivityWriteSchema.safeParse(input.activity);
  if (!parsed.success) {
    throw new SpaceMembersUseCaseError({
      status: 400,
      code: "space.activity.invalid",
      message: "Invalid Space activity.",
    });
  }
  const activity = parsed.data;
  const member = readSpaceMemberRecord(input.sql, activity.profileId);
  if (
    input.organizationId !== activity.organizationId ||
    member?.status !== "active" ||
    member.profileKindSnapshot !== "human" ||
    member.ownerUserIdSnapshot !== activity.userId
  ) {
    throw new SpaceMembersUseCaseError({
      status: 403,
      code: "space.activity.forbidden",
      message: "Space activity requires an active Human member.",
    });
  }
  recordSpaceMemberWebActivity(
    input.sql,
    activity.profileId,
    activity.lastActiveAt
  );
  return activity.profileId;
}

export const upsertSpaceCreatorMember = (input: {
  sql: SqlStorage;
  spaceId: string;
  creator?: SpaceCreator;
  nowIso?: string;
  addedAt?: string;
}): SpaceMemberRecord | null => {
  const creator = normalizeSpaceCreator(input.creator);
  if (!creator) {
    return null;
  }

  const nowIso = input.nowIso ?? new Date().toISOString();
  const existing = readSpaceMemberRecord(input.sql, creator.profileId);
  const next = buildNextSpaceMemberRecord({
    existing,
    existingProfileSnapshot: existing,
    spaceId: input.spaceId,
    profile: {
      profileId: creator.profileId,
      profileName: creator.profileName,
      profileKind: creator.profileKind,
      ownerUserId: creator.ownerUserId,
      ownerName: creator.ownerName,
      agentControllerRef: null,
    },
    nowIso,
    defaultSource: "space_creator",
    defaultAddedAt: input.addedAt ?? nowIso,
  });
  upsertSpaceMemberRecord(input.sql, next);
  return next;
};

export const upsertJoinedSpaceMember = (input: {
  sql: SqlStorage;
  spaceId: string;
  profile: Profile;
  ownerUserId?: string;
  ownerName?: string;
  nowIso?: string;
}): SpaceMemberRecord | null => {
  const normalizedProfile = normalizeProfileSnapshot({
    profile: input.profile,
    ownerUserId: input.ownerUserId,
    ownerName: input.ownerName,
  });
  if (!normalizedProfile) {
    return null;
  }

  const nowIso = input.nowIso ?? new Date().toISOString();
  const existing = readSpaceMemberRecord(
    input.sql,
    normalizedProfile.profileId
  );
  const next = buildNextSpaceMemberRecord({
    existing,
    existingProfileSnapshot: existing,
    spaceId: input.spaceId,
    profile: {
      ...normalizedProfile,
      profileName:
        existing?.profileNameSnapshot ?? normalizedProfile.profileName,
    },
    nowIso,
    defaultSource: "joined_directly",
    defaultAddedAt: nowIso,
    firstEnteredAt: existing?.firstEnteredAt ?? nowIso,
    lastEnteredAt: nowIso,
  });
  upsertSpaceMemberRecord(input.sql, next);
  return next;
};

export const addSpaceMembersUseCase = (input: {
  sql: SqlStorage;
  env: CoreBindings;
  spaceId: string;
  members: ResolvedAddSpaceMemberInput[];
  actorProfileId: string;
  actorOwnerUserId?: string;
  actorDisplayName?: string;
  viewerOwnerUserId?: string;
  viewerProfileId?: string;
  liveSessions: Iterable<LiveSessionLike>;
  nowIso?: string;
}): PostSpaceMembersResponse => {
  const nowIso = input.nowIso ?? new Date().toISOString();
  const addedMemberIds: string[] = [];
  const alreadyMemberIds: string[] = [];
  const seenProfileIds = new Set<string>();
  const uniqueMembers: ResolvedAddSpaceMemberInput[] = [];
  const memberRecordByProfileId = new Map<string, SpaceMemberRecord>();

  for (const member of input.members) {
    if (seenProfileIds.has(member.profileId)) {
      continue;
    }
    seenProfileIds.add(member.profileId);
    uniqueMembers.push(member);

    const existing = readSpaceMemberRecord(input.sql, member.profileId);
    const next = buildNextSpaceMemberRecord({
      existing,
      existingProfileSnapshot: existing,
      spaceId: input.spaceId,
      profile: member,
      nowIso,
      defaultSource: "added_by_member",
      defaultAddedAt: nowIso,
      addedByProfileId: input.actorProfileId,
      addedByOwnerUserId: normalizeOptionalText(input.actorOwnerUserId),
      addedByDisplayName: normalizeOptionalText(input.actorDisplayName),
    });
    upsertSpaceMemberRecord(input.sql, next);
    memberRecordByProfileId.set(member.profileId, next);
    if (existing?.status === "active") {
      alreadyMemberIds.push(member.profileId);
      continue;
    }
    addedMemberIds.push(member.profileId);
  }

  const itemByProfileId = buildSpaceMemberMutationItems({
    sql: input.sql,
    records: [...memberRecordByProfileId.values()],
    liveSessions: input.liveSessions,
    nowIso,
  });

  return {
    addedMemberIds,
    alreadyMemberIds,
    items: uniqueMembers
      .map((member) => itemByProfileId.get(member.profileId))
      .filter(
        (item): item is SpaceMemberHumanSnapshot | SpaceMemberAgentSnapshot =>
          Boolean(item)
      ),
  };
};

function buildSpaceMemberMutationItems(input: {
  sql: SqlStorage;
  records: SpaceMemberRecord[];
  liveSessions: Iterable<LiveSessionLike>;
  nowIso: string;
}): ReadonlyMap<string, SpaceMemberHumanSnapshot | SpaceMemberAgentSnapshot> {
  if (input.records.length === 0) {
    return new Map();
  }

  const activeRecords = input.records.filter(
    (record) => record.status === "active"
  );
  const liveSessions = [...input.liveSessions];
  const cursorSnapshots = listCursorMemberSnapshots(input.sql);
  const latestSignalActivity = listLatestSignalActivityFromSql(input.sql);
  const liveProfileById = buildLiveProfileById(liveSessions);

  const items = activeRecords.map((record) => {
    if (record.profileKindSnapshot === "human") {
      return buildHumanSnapshot({
        record,
        textLastActiveAt: readSpaceMemberHumanTextActivity(
          input.sql,
          record.profileId
        ),
        webLastActiveAt: readSpaceMemberWebActivity(
          input.sql,
          record.profileId
        ),
        liveProfileById,
        cursorSnapshots,
        generatedAt: input.nowIso,
      });
    }
    return buildAgentMutationSnapshot({
      record,
      liveProfileById,
      cursorSnapshots,
      latestSignalActivity,
      generatedAt: input.nowIso,
    });
  });

  return new Map(items.map((item) => [item.profileId, item] as const));
}

export const removeSpaceMembersUseCase = (input: {
  sql: SqlStorage;
  spaceId: string;
  memberProfileIds: string[];
  actorProfileId: string;
  actorOwnerUserId?: string;
  metaRecord?: SpaceMetaRecord | null;
  nowIso?: string;
  removalReason?: string;
}): RemoveSpaceMembersResponse => {
  const nowIso = input.nowIso ?? new Date().toISOString();
  const removedMemberIds: string[] = [];
  const alreadyAbsentMemberIds: string[] = [];
  const uniqueMemberProfileIds: string[] = [];
  const seenProfileIds = new Set<string>();
  const creatorProfileId = normalizeSpaceCreator(
    input.metaRecord?.creator
  )?.profileId;

  for (const memberProfileId of input.memberProfileIds) {
    if (seenProfileIds.has(memberProfileId)) {
      continue;
    }
    seenProfileIds.add(memberProfileId);
    uniqueMemberProfileIds.push(memberProfileId);
  }

  for (const memberProfileId of uniqueMemberProfileIds) {
    if (memberProfileId === input.actorProfileId) {
      throw new SpaceMembersUseCaseError({
        status: 400,
        code: "space.members.current_profile_forbidden",
        message: "current profile cannot be removed from this space",
      });
    }
    const existing = readSpaceMemberRecord(input.sql, memberProfileId);
    if (
      existing?.status === "active" &&
      (memberProfileId === creatorProfileId ||
        existing.memberSource === "space_creator")
    ) {
      throw new SpaceMembersUseCaseError({
        status: 400,
        code: "space.members.creator_forbidden",
        message: "space creator cannot be removed from this space",
      });
    }
  }

  for (const memberProfileId of uniqueMemberProfileIds) {
    const existing = readSpaceMemberRecord(input.sql, memberProfileId);
    if (existing?.status !== "active") {
      alreadyAbsentMemberIds.push(memberProfileId);
      continue;
    }

    upsertSpaceMemberRecord(
      input.sql,
      buildRemovedSpaceMemberRecord({
        existing,
        nowIso,
        removedByProfileId: input.actorProfileId,
        removedByOwnerUserId: normalizeOptionalText(input.actorOwnerUserId),
        ...(input.removalReason ? { removalReason: input.removalReason } : {}),
      })
    );
    removedMemberIds.push(memberProfileId);
  }

  return {
    removedMemberIds,
    alreadyAbsentMemberIds,
  };
};

export const leaveSpaceUseCase = (input: {
  sql: SqlStorage;
  spaceId: string;
  actorProfileId: string;
  actorOwnerUserId?: string;
  metaRecord?: SpaceMetaRecord | null;
  nowIso?: string;
}): LeaveSpaceResponse => {
  const nowIso = input.nowIso ?? new Date().toISOString();
  const creatorProfileId = normalizeSpaceCreator(
    input.metaRecord?.creator
  )?.profileId;

  if (input.actorProfileId === creatorProfileId) {
    throw new SpaceMembersUseCaseError({
      status: 400,
      code: "space.leave_space.creator_forbidden",
      message:
        "The space creator cannot leave this space. Delete the space instead when only you remain.",
    });
  }

  const existing = readSpaceMemberRecord(input.sql, input.actorProfileId);
  if (existing?.status !== "active") {
    return {
      leftProfileId: input.actorProfileId,
      status: "already_absent",
    };
  }

  upsertSpaceMemberRecord(
    input.sql,
    buildRemovedSpaceMemberRecord({
      existing,
      nowIso,
      removedByProfileId: input.actorProfileId,
      removedByOwnerUserId: normalizeOptionalText(input.actorOwnerUserId),
      removalReason: "left_space",
    })
  );

  return {
    leftProfileId: input.actorProfileId,
    status: "left",
  };
};

export const listSpaceMembersSnapshotUseCase = async (input: {
  sql: SqlStorage;
  env: CoreBindings;
  spaceId: string;
  viewerOwnerUserId?: string;
  viewerProfileId?: string;
  liveSessions: Iterable<LiveSessionLike>;
  metaRecord?: SpaceMetaRecord | null;
  nowIso?: string;
  timing?: SpaceMembersSnapshotTiming;
  // Optional per-request lineage loader shared across bootstrap branches so
  // one bootstrap resolves the viewer lineage exactly once. Same auth data,
  // same request scope — no cross-request staleness.
  lineageLoader?: (
    ownerUserId: string
  ) => Promise<Record<string, string | null> | undefined>;
}): Promise<SpaceMembersSnapshot> => {
  const startedAtMs = Date.now();
  const liveSessions = [...input.liveSessions];

  measureSpaceMembersSnapshotTiming(
    input.timing,
    "backfill",
    "backfill missing members",
    () =>
      ensureSpaceMembersBackfilled({
        sql: input.sql,
        spaceId: input.spaceId,
        liveSessions,
        metaRecord: input.metaRecord ?? null,
        nowIso: input.nowIso,
      })
  );

  const allRecords = measureSpaceMembersSnapshotTiming(
    input.timing,
    "records",
    "load member records",
    () => listSpaceMemberRecords(input.sql)
  );
  const records = allRecords.filter((record) => record.status === "active");
  const cursorSnapshots = measureSpaceMembersSnapshotTiming(
    input.timing,
    "cursors",
    "load cursor snapshots",
    () => listCursorMemberSnapshots(input.sql)
  );
  const latestSignalActivity = measureSpaceMembersSnapshotTiming(
    input.timing,
    "latest_activity",
    "derive latest signal activity",
    () => listLatestSignalActivityFromSql(input.sql)
  );
  const latestAgentOriginFactsByProfileId = measureSpaceMembersSnapshotTiming(
    input.timing,
    "origin_facts",
    "derive latest agent origin facts",
    () => listLatestAgentOriginFactsFromSql(input.sql)
  );
  const liveProfileById = buildLiveProfileById(liveSessions);
  const [
    preloadedHumanAvatarByOwnerUserId,
    preloadedDaemonRouteByProfileId,
    preloadedOwnerServiceByOwnerUserId,
    viewerCreatorProfileIdsByProfileId,
  ] = await Promise.all([
    measureSpaceMembersSnapshotTimingAsync(
      input.timing,
      "human_avatar_batch",
      "preload human member avatars",
      () =>
        preloadHumanMemberAvatars({
          env: input.env,
          records,
        })
    ),
    measureSpaceMembersSnapshotTimingAsync(
      input.timing,
      "route_batch",
      "preload agent member route evidence",
      () =>
        preloadAgentMemberDaemonRoutes({
          env: input.env,
          records,
        })
    ),
    measureSpaceMembersSnapshotTimingAsync(
      input.timing,
      "owner_service_batch",
      "preload agent member owner service evidence",
      () =>
        preloadAgentMemberOwnerServices({
          env: input.env,
          records,
        })
    ),
    measureSpaceMembersSnapshotTimingAsync(
      input.timing,
      "auth_lineage",
      "resolve viewer creator profile ids",
      () =>
        input.lineageLoader && input.viewerOwnerUserId && input.viewerProfileId
          ? input.lineageLoader(input.viewerOwnerUserId)
          : resolveViewerCreatorProfileIdsByProfileId({
              authRpc: input.env.OPENMELD_AUTH_WORKER,
              viewerOwnerUserId: input.viewerOwnerUserId,
              viewerProfileId: input.viewerProfileId,
            })
    ),
  ]);
  const generatedAt = input.nowIso ?? new Date().toISOString();

  const humans: SpaceMemberHumanSnapshot[] = [];
  const agentSnapshotPromises: Promise<SpaceMemberAgentSnapshot>[] = [];
  const activeOrganizationId = input.metaRecord?.organizationId ?? null;

  for (const record of records) {
    if (record.profileKindSnapshot === "human") {
      humans.push(
        buildHumanSnapshot({
          record,
          textLastActiveAt: readSpaceMemberHumanTextActivity(
            input.sql,
            record.profileId
          ),
          webLastActiveAt: readSpaceMemberWebActivity(
            input.sql,
            record.profileId
          ),
          avatarByOwnerUserId: preloadedHumanAvatarByOwnerUserId,
          liveProfileById,
          cursorSnapshots,
          generatedAt,
        })
      );
      continue;
    }

    agentSnapshotPromises.push(
      buildAgentSnapshot({
        activeOrganizationId,
        env: input.env,
        record,
        viewerOwnerUserId: input.viewerOwnerUserId,
        viewerProfileId: input.viewerProfileId,
        viewerCreatorProfileIdsByProfileId,
        liveProfileById,
        cursorSnapshots,
        latestSignalActivity,
        latestAgentOriginFactsByProfileId,
        preloadedDaemonRouteByProfileId,
        preloadedOwnerServiceByOwnerUserId,
        generatedAt,
      })
    );
  }

  const agents = await measureSpaceMembersSnapshotTimingAsync(
    input.timing,
    "agent_snapshots",
    "build agent snapshots and readiness",
    () => Promise.all(agentSnapshotPromises)
  );

  // Membership liveness evidence: only the authoritative deleted-profile
  // verdict reaches the "agent_profile.not_found" availability reason (the
  // resolver keeps transient identity lookup failures away from it). Reads
  // only record observations here; the Space background alarm re-verifies
  // and performs the actual removal once the evidence threshold is met.
  const livenessObservedAtMs = Date.parse(generatedAt);
  measureSpaceMembersSnapshotTiming(
    input.timing,
    "liveness",
    "record member liveness observations",
    () => {
      if (Number.isFinite(livenessObservedAtMs)) {
        for (const agent of agents) {
          if (
            agent.agentWakeAvailability?.reasonCode ===
            "agent_profile.not_found"
          ) {
            recordMemberProfileNotFoundObservation(input.sql, {
              nowMs: livenessObservedAtMs,
              profileId: agent.profileId,
            });
          } else {
            clearMemberProfileLivenessEvidence(input.sql, agent.profileId);
          }
        }
      }
    }
  );

  const memberSummary = measureSpaceMembersSnapshotTiming(
    input.timing,
    "summary",
    "sort and summarize members",
    () => {
      const sortedHumans = sortMemberSnapshots(humans);
      const sortedAgents = sortMemberSnapshots(agents);
      const liveNowCount =
        sortedHumans.filter((item) => item.liveNow).length +
        sortedAgents.filter((item) => item.liveNow).length;
      const wakeableAgentCount = sortedAgents.filter(
        isPublicWakeableAgent
      ).length;
      const checkingAgentCount = sortedAgents.filter(
        isPublicCheckingAgent
      ).length;
      const offlineAgentCount =
        sortedAgents.filter(isPublicOfflineAgent).length;
      const unavailableAgentCount = sortedAgents.filter(
        isPublicUnavailableAgent
      ).length;
      return {
        checkingAgentCount,
        liveNowCount,
        offlineAgentCount,
        sortedAgents,
        sortedHumans,
        unavailableAgentCount,
        wakeableAgentCount,
      };
    }
  );

  const snapshot = {
    spaceId: input.spaceId,
    generatedAt,
    summary: {
      totalCount:
        memberSummary.sortedHumans.length + memberSummary.sortedAgents.length,
      humanCount: memberSummary.sortedHumans.length,
      agentCount: memberSummary.sortedAgents.length,
      liveNowCount: memberSummary.liveNowCount,
      wakeableAgentCount: memberSummary.wakeableAgentCount,
      checkingAgentCount: memberSummary.checkingAgentCount,
      offlineAgentCount: memberSummary.offlineAgentCount,
      unavailableAgentCount: memberSummary.unavailableAgentCount,
    },
    humans: memberSummary.sortedHumans,
    agents: memberSummary.sortedAgents,
  };

  logSpaceMembersSnapshotTiming({
    activeMemberCount: records.length,
    agentCount: memberSummary.sortedAgents.length,
    humanCount: memberSummary.sortedHumans.length,
    liveNowCount: memberSummary.liveNowCount,
    spaceId: input.spaceId,
    startedAtMs,
  });

  return snapshot;
};

export const listSpaceIdentityDirectoryUseCase = (input: {
  sql: SqlStorage;
  spaceId: string;
  liveSessions: Iterable<LiveSessionLike>;
  metaRecord?: SpaceMetaRecord | null;
  nowIso?: string;
}): SpaceIdentityDirectory => {
  const liveSessions = [...input.liveSessions];

  ensureSpaceMembersBackfilled({
    sql: input.sql,
    spaceId: input.spaceId,
    liveSessions,
    metaRecord: input.metaRecord ?? null,
    nowIso: input.nowIso,
  });

  const generatedAt = input.nowIso ?? new Date().toISOString();
  const cursorSnapshots = listCursorMemberSnapshots(input.sql);
  const entries = listSpaceMemberRecords(input.sql)
    .filter((record) => record.status === "active")
    .map((record): SpaceIdentityDirectoryEntry => {
      const cursorSnapshot = cursorSnapshots.get(record.profileId) ?? null;
      return {
        profileId: record.profileId,
        profileName: record.profileNameSnapshot,
        profileKind: record.profileKindSnapshot,
        mentionAlias: cursorSnapshot?.mentionAlias ?? null,
        ownerUserId: normalizeOptionalText(record.ownerUserIdSnapshot),
        ownerName: normalizeOptionalText(record.ownerNameSnapshot),
        agentControllerRef:
          record.profileKindSnapshot === "agent"
            ? normalizeOptionalText(record.controllerRefSnapshot)
            : null,
      };
    })
    .sort(sortSpaceIdentityDirectoryEntries);

  return {
    spaceId: input.spaceId,
    generatedAt,
    entries,
  };
};

export const listSpaceMemberDirectoryUseCase = (input: {
  sql: SqlStorage;
  spaceId: string;
  liveSessions: Iterable<LiveSessionLike>;
  metaRecord?: SpaceMetaRecord | null;
  nowIso?: string;
}): SpaceMemberDirectory => {
  return buildSpaceMemberDirectoryFromIdentityDirectory(
    listSpaceIdentityDirectoryUseCase(input)
  );
};

export const readSpaceStatusMembersSummaryUseCase = async (input: {
  sql: SqlStorage;
  env: CoreBindings;
  spaceId: string;
  liveSessions: Iterable<LiveSessionLike>;
  metaRecord?: SpaceMetaRecord | null;
  nowIso?: string;
  viewerOwnerUserId?: string;
  viewerProfileId?: string;
  timing?: SpaceMembersSnapshotTiming;
}): Promise<SpaceStatusMembersSummary> => {
  const snapshot = await listSpaceMembersSnapshotUseCase({
    sql: input.sql,
    spaceId: input.spaceId,
    env: input.env,
    liveSessions: input.liveSessions,
    metaRecord: input.metaRecord ?? null,
    nowIso: input.nowIso,
    viewerOwnerUserId: input.viewerOwnerUserId,
    viewerProfileId: input.viewerProfileId,
    ...(input.timing ? { timing: input.timing } : {}),
  });

  return buildSpaceStatusMembersSummaryFromSnapshot(snapshot);
};

export const buildSpaceStatusMembersSummaryFromSnapshot = (
  snapshot: SpaceMembersSnapshot
): SpaceStatusMembersSummary => {
  const liveHumanCount = snapshot.humans.filter(
    (item: SpaceMemberHumanSnapshot) => item.liveNow
  ).length;
  const liveAgentCount = snapshot.agents.filter(
    (item: SpaceMemberAgentSnapshot) => item.liveNow
  ).length;

  return {
    ...snapshot.summary,
    liveNowCount: liveHumanCount + liveAgentCount,
    liveHumanCount,
    liveAgentCount,
  };
};

export function ensureSpaceMembersBackfilled(input: {
  sql: SqlStorage;
  spaceId: string;
  liveSessions: Iterable<LiveSessionLike>;
  metaRecord: SpaceMetaRecord | null;
  nowIso?: string;
}): void {
  const nowIso = input.nowIso ?? new Date().toISOString();
  const watermark = readSpaceMembersBackfillWatermark(input.sql);
  const signals = listStoredSignalsAfter(input.sql, watermark);
  const existingRecordsByProfileId = new Map(
    listSpaceMemberRecords(input.sql).map((record) => [
      record.profileId,
      record,
    ])
  );
  const joinNoticeSignals = listJoinNoticeSignalsFromSql(input.sql);
  // Merge full-history join notices with the incremental window, deduped by
  // signal id (a join notice inside the window would otherwise appear twice
  // and break the uniqueness rule legacy hints rely on), in timeline order.
  const hintSignalsById = new Map<string, SignalEnvelope>();
  for (const signal of [...joinNoticeSignals, ...signals]) {
    hintSignalsById.set(signal.id, signal);
  }
  const sourceHints = buildSpaceMemberSourceHints(
    [...hintSignalsById.values()].sort(
      (left, right) => left.ts - right.ts || left.id.localeCompare(right.id)
    )
  );
  const cursorSnapshots = listCursorMemberSnapshots(input.sql);
  const discovered = new Map<string, SpaceMemberRecord>();

  maybeBackfillCreator({
    discovered,
    spaceId: input.spaceId,
    metaRecord: input.metaRecord,
    nowIso,
  });
  backfillMembersFromSignals({
    discovered,
    existingRecordsByProfileId,
    signals,
    spaceId: input.spaceId,
    nowIso,
    sourceHints,
  });
  backfillMembersFromLiveSessions({
    discovered,
    existingRecordsByProfileId,
    liveSessions: input.liveSessions,
    spaceId: input.spaceId,
    nowIso,
    sourceHints,
  });
  backfillMembersFromCursorAliases({
    discovered,
    existingRecordsByProfileId,
    cursorSnapshots,
    spaceId: input.spaceId,
    nowIso,
    sourceHints,
  });
  persistBackfilledMembers(input.sql, discovered, existingRecordsByProfileId);
  const lastSignal = signals.at(-1);
  if (lastSignal) {
    writeSpaceMembersBackfillWatermark(input.sql, {
      lastTs: lastSignal.ts,
      lastSignalId: lastSignal.id,
    });
  }
}

function buildSnapshotBase(input: {
  record: SpaceMemberRecord;
  liveProfileById: Map<string, Profile>;
  cursorSnapshots: Map<string, CursorMemberSnapshot>;
  latestSignalActivity: Map<string, LatestSignalActivity>;
  generatedAt: string;
}): {
  liveProfile: Profile | null;
  liveNow: boolean;
  lastSeenAt: string | null;
  lastSeenLabel: string | null;
} {
  const liveProfile = input.liveProfileById.get(input.record.profileId) ?? null;
  const lastSeenAt = resolveLastSeenAt({
    record: input.record,
    cursorSnapshot: input.cursorSnapshots.get(input.record.profileId) ?? null,
    signalActivity:
      input.latestSignalActivity.get(input.record.profileId) ?? null,
  });
  return {
    liveProfile,
    liveNow: liveProfile !== null,
    lastSeenAt,
    lastSeenLabel: lastSeenAt
      ? formatLastSeenLabel({
          generatedAt: input.generatedAt,
          lastSeenAt,
        })
      : null,
  };
}

function buildHumanSnapshot(input: {
  record: SpaceMemberRecord;
  webLastActiveAt: string | null;
  textLastActiveAt: string | null;
  avatarByOwnerUserId?: ReadonlyMap<string, string | null>;
  liveProfileById: Map<string, Profile>;
  cursorSnapshots: Map<string, CursorMemberSnapshot>;
  generatedAt: string;
}): SpaceMemberHumanSnapshot {
  // Socket reconnects and read watermarks are not evidence of a foreground visit.
  // Historical socket-derived lastEnteredAt is intentionally not a fallback.
  const lastSeenAt = pickLaterIsoTimestamp(
    input.webLastActiveAt,
    input.textLastActiveAt
  );
  const liveNow = Boolean(
    input.webLastActiveAt &&
      input.liveProfileById.has(input.record.profileId) &&
      Date.parse(input.generatedAt) - Date.parse(input.webLastActiveAt) <
        6 * 60_000
  );
  return {
    profileId: input.record.profileId,
    profileName: input.record.profileNameSnapshot,
    profileKind: "human",
    mentionAlias:
      input.cursorSnapshots.get(input.record.profileId)?.mentionAlias ?? null,
    status: input.record.status,
    memberSource: input.record.memberSource,
    memberSourceLabel: buildMemberSourceLabel(input.record),
    addedAt: input.record.addedAt,
    removedAt: input.record.removedAt,
    createdAt: input.record.createdAt,
    updatedAt: input.record.updatedAt,
    addedByProfileId: input.record.addedByProfileId,
    addedByOwnerUserId: input.record.addedByOwnerUserId,
    addedByDisplayName: input.record.addedByDisplayNameSnapshot,
    removedByProfileId: input.record.removedByProfileId,
    removedByOwnerUserId: input.record.removedByOwnerUserId,
    removalReason: input.record.removalReason,
    firstEnteredAt: input.record.firstEnteredAt,
    lastEnteredAt: input.record.lastEnteredAt,
    lastSeenAt,
    lastSeenLabel: lastSeenAt
      ? formatLastSeenLabel({ generatedAt: input.generatedAt, lastSeenAt })
      : null,
    liveNow,
    avatarUrl: input.record.ownerUserIdSnapshot
      ? (input.avatarByOwnerUserId?.get(input.record.ownerUserIdSnapshot) ??
        null)
      : null,
    ownerUserId: input.record.ownerUserIdSnapshot,
    ownerName: input.record.ownerNameSnapshot,
  };
}

async function preloadHumanMemberAvatars(input: {
  env: CoreBindings;
  records: readonly SpaceMemberRecord[];
}): Promise<ReadonlyMap<string, string | null>> {
  const ownerUserIds = [
    ...new Set(
      input.records
        .filter((record) => record.profileKindSnapshot === "human")
        .map((record) => record.ownerUserIdSnapshot?.trim() ?? "")
        .filter(Boolean)
    ),
  ].sort();
  if (ownerUserIds.length === 0) {
    return new Map();
  }

  const db = identityDb(input.env);
  if (!db) {
    return new Map();
  }

  const avatarByOwnerUserId = new Map<string, string | null>();
  for (
    let offset = 0;
    offset < ownerUserIds.length;
    offset += HUMAN_AVATAR_READ_BATCH_SIZE
  ) {
    const batch = ownerUserIds.slice(
      offset,
      offset + HUMAN_AVATAR_READ_BATCH_SIZE
    );
    const placeholders = batch.map(() => "?").join(", ");
    const result = await db
      .prepare(
        `
          SELECT id, image
          FROM users
          WHERE id IN (${placeholders})
        `
      )
      .bind(...batch)
      .all<{ id: string; image: string | null }>();
    for (const row of result.results) {
      const ownerUserId = row.id.trim();
      if (ownerUserId) {
        avatarByOwnerUserId.set(ownerUserId, normalizeOptionalText(row.image));
      }
    }
  }
  return avatarByOwnerUserId;
}

function buildAgentMutationSnapshot(input: {
  record: SpaceMemberRecord;
  liveProfileById: Map<string, Profile>;
  cursorSnapshots: Map<string, CursorMemberSnapshot>;
  latestSignalActivity: Map<string, LatestSignalActivity>;
  generatedAt: string;
}): SpaceMemberAgentSnapshot {
  const snapshotBase = buildSnapshotBase(input);
  return {
    profileId: input.record.profileId,
    profileName: input.record.profileNameSnapshot,
    profileKind: "agent",
    mentionAlias:
      input.cursorSnapshots.get(input.record.profileId)?.mentionAlias ?? null,
    status: input.record.status,
    memberSource: input.record.memberSource,
    memberSourceLabel: buildMemberSourceLabel(input.record),
    addedAt: input.record.addedAt,
    removedAt: input.record.removedAt,
    createdAt: input.record.createdAt,
    updatedAt: input.record.updatedAt,
    addedByProfileId: input.record.addedByProfileId,
    addedByOwnerUserId: input.record.addedByOwnerUserId,
    addedByDisplayName: input.record.addedByDisplayNameSnapshot,
    removedByProfileId: input.record.removedByProfileId,
    removedByOwnerUserId: input.record.removedByOwnerUserId,
    removalReason: input.record.removalReason,
    firstEnteredAt: input.record.firstEnteredAt,
    lastEnteredAt: input.record.lastEnteredAt,
    lastSeenAt: snapshotBase.lastSeenAt,
    lastSeenLabel: snapshotBase.lastSeenLabel,
    liveNow: snapshotBase.liveNow,
    avatarUrl: snapshotBase.liveProfile?.avatarUrl ?? null,
    ownerUserId: input.record.ownerUserIdSnapshot,
    ownerName: input.record.ownerNameSnapshot,
    agentControllerRef: input.record.controllerRefSnapshot,
    agentControllerConversationId: null,
    agentWakeAvailability: undefined,
    ownerWakeDiagnostics: null,
  };
}

async function preloadAgentMemberDaemonRoutes(input: {
  env: CoreBindings;
  records: readonly SpaceMemberRecord[];
}): Promise<ReadonlyMap<string, RuntimeTransportLookupRouteResponse>> {
  const profileIdsByOwnerUserId = new Map<string, Set<string>>();
  for (const record of input.records) {
    if (record.profileKindSnapshot !== "agent") {
      continue;
    }

    const ownerUserId = normalizeOptionalText(record.ownerUserIdSnapshot);
    if (!ownerUserId) {
      continue;
    }

    let profileIds = profileIdsByOwnerUserId.get(ownerUserId);
    if (!profileIds) {
      profileIds = new Set<string>();
      profileIdsByOwnerUserId.set(ownerUserId, profileIds);
    }
    profileIds.add(record.profileId);
  }

  const routesByProfileId = new Map<
    string,
    RuntimeTransportLookupRouteResponse
  >();
  if (
    profileIdsByOwnerUserId.size === 0 ||
    !input.env.OPENMELD_RUNTIME_TRANSPORT
  ) {
    return routesByProfileId;
  }
  await Promise.all(
    [...profileIdsByOwnerUserId.entries()].map(
      async ([ownerUserId, profileIds]) => {
        const batch = await lookupRuntimeTransportRoutesBatch({
          blockForgottenDevices: true,
          env: input.env,
          ownerUserId,
          profileIds: [...profileIds],
        });
        if (!batch) {
          return;
        }

        for (const profileId of profileIds) {
          const route = batch.routes[profileId];
          if (route !== undefined) {
            routesByProfileId.set(profileId, route);
          }
        }
      }
    )
  );

  return routesByProfileId;
}

async function preloadAgentMemberOwnerServices(input: {
  env: CoreBindings;
  records: readonly SpaceMemberRecord[];
}): Promise<ReadonlyMap<string, RuntimeTransportLookupOwnerServiceResponse>> {
  const ownerUserIds = new Set<string>();
  for (const record of input.records) {
    if (record.profileKindSnapshot !== "agent") {
      continue;
    }
    const ownerUserId = normalizeOptionalText(record.ownerUserIdSnapshot);
    if (ownerUserId) {
      ownerUserIds.add(ownerUserId);
    }
  }

  const servicesByOwnerUserId = new Map<
    string,
    RuntimeTransportLookupOwnerServiceResponse
  >();
  if (ownerUserIds.size === 0 || !input.env.OPENMELD_RUNTIME_TRANSPORT) {
    return servicesByOwnerUserId;
  }
  await Promise.all(
    [...ownerUserIds].map(async (ownerUserId) => {
      const ownerService = await lookupRuntimeTransportOwnerService({
        blockForgottenDevices: true,
        env: input.env,
        ownerUserId,
      });
      servicesByOwnerUserId.set(ownerUserId, ownerService);
    })
  );
  return servicesByOwnerUserId;
}

async function buildAgentSnapshot(input: {
  activeOrganizationId?: string | null;
  env: CoreBindings;
  record: SpaceMemberRecord;
  viewerOwnerUserId?: string;
  viewerProfileId?: string;
  viewerCreatorProfileIdsByProfileId?: Record<string, string | null>;
  liveProfileById: Map<string, Profile>;
  cursorSnapshots: Map<string, CursorMemberSnapshot>;
  latestSignalActivity: Map<string, LatestSignalActivity>;
  latestAgentOriginFactsByProfileId: Map<string, LatestAgentOriginFacts>;
  preloadedDaemonRouteByProfileId: ReadonlyMap<
    string,
    RuntimeTransportLookupRouteResponse
  >;
  preloadedOwnerServiceByOwnerUserId: ReadonlyMap<
    string,
    RuntimeTransportLookupOwnerServiceResponse
  >;
  generatedAt: string;
}): Promise<SpaceMemberAgentSnapshot> {
  const snapshotBase = buildSnapshotBase({
    record: input.record,
    liveProfileById: input.liveProfileById,
    cursorSnapshots: input.cursorSnapshots,
    latestSignalActivity: input.latestSignalActivity,
    generatedAt: input.generatedAt,
  });
  const preloadedDaemonRoute = input.preloadedDaemonRouteByProfileId.get(
    input.record.profileId
  );
  const preloadedOwnerService = input.record.ownerUserIdSnapshot
    ? input.preloadedOwnerServiceByOwnerUserId.get(
        input.record.ownerUserIdSnapshot
      )
    : undefined;
  const executionReadiness = await resolveCoreAgentExecutionReadiness({
    activeOrganizationId: input.activeOrganizationId ?? null,
    agent: {
      controllerRefSnapshot: input.record.controllerRefSnapshot,
      ownerUserIdSnapshot: input.record.ownerUserIdSnapshot,
      profileId: input.record.profileId,
      profileNameSnapshot: input.record.profileNameSnapshot,
    },
    env: input.env,
    generatedAt: input.generatedAt,
    ...(preloadedDaemonRoute === undefined ? {} : { preloadedDaemonRoute }),
    ...(preloadedOwnerService === undefined ? {} : { preloadedOwnerService }),
  });
  const profileName =
    executionReadiness.profileName ?? input.record.profileNameSnapshot;
  const ownerUserId =
    executionReadiness.ownerUserId ?? input.record.ownerUserIdSnapshot;
  const agentControllerRef =
    executionReadiness.agentControllerRef ?? input.record.controllerRefSnapshot;
  const latestAgentOriginFacts =
    input.latestAgentOriginFactsByProfileId.get(input.record.profileId) ?? null;
  const redactedOriginFields = resolveRedactedAgentOriginFields({
    candidateAgentControllerConversationId:
      normalizeOptionalText(
        executionReadiness.spaceMemberAgentExecutionReadiness.facts
          .providerConversation.agentControllerConversationId
      ) ??
      normalizeOptionalText(
        snapshotBase.liveProfile?.agentControllerConversationId
      ) ??
      latestAgentOriginFacts?.agentControllerConversationId ??
      null,
    candidateWorkingDirectory:
      normalizeOptionalWorkingDirectory(
        snapshotBase.liveProfile?.workingDirectory
      ) ??
      latestAgentOriginFacts?.workingDirectory ??
      null,
    profileId: input.record.profileId,
    profileName,
    ownerUserId,
    ownerName: input.record.ownerNameSnapshot,
    agentControllerRef,
    viewerOwnerUserId: input.viewerOwnerUserId,
    viewerProfileId: input.viewerProfileId,
    creatorProfileIdByProfileId: input.viewerCreatorProfileIdsByProfileId,
  });
  const agentWakeAvailability =
    agentControllerRef === HOSTED_CENTER_AGENT_CONTROLLER_REF
      ? resolveHostedAgentWakeAvailability({
          readiness: executionReadiness.spaceMemberAgentExecutionReadiness,
        })
      : resolveAgentWakeAvailability({
          agentControllerRef,
          agentWakeRouteRegistration:
            executionReadiness.agentWakeRouteRegistration,
          wakeRouteStatus: executionReadiness.wakeRouteStatus,
          readiness: executionReadiness.spaceMemberAgentExecutionReadiness,
        });
  const canManageAgentProfile = isSameOwnerUserId({
    leftOwnerUserId: input.viewerOwnerUserId,
    rightOwnerUserId: ownerUserId,
  });
  const ownerWakeDiagnostics = canManageAgentProfile
    ? {
        state: resolveOwnerWakeDiagnosticsState({
          agentWakeAvailability,
        }),
        agentExecutionReadiness:
          executionReadiness.spaceMemberAgentExecutionReadiness,
        agentWakeRouteRegistration:
          executionReadiness.agentWakeRouteRegistration,
        wakeRouteEvidence: executionReadiness.daemonRouteObservation,
        wakeRouteStatus: executionReadiness.wakeRouteStatus,
      }
    : null;

  return {
    profileId: input.record.profileId,
    profileName,
    profileKind: "agent",
    mentionAlias:
      input.cursorSnapshots.get(input.record.profileId)?.mentionAlias ?? null,
    status: input.record.status,
    memberSource: input.record.memberSource,
    memberSourceLabel: buildMemberSourceLabel(input.record),
    addedAt: input.record.addedAt,
    removedAt: input.record.removedAt,
    createdAt: input.record.createdAt,
    updatedAt: input.record.updatedAt,
    addedByProfileId: input.record.addedByProfileId,
    addedByOwnerUserId: input.record.addedByOwnerUserId,
    addedByDisplayName: input.record.addedByDisplayNameSnapshot,
    removedByProfileId: input.record.removedByProfileId,
    removedByOwnerUserId: input.record.removedByOwnerUserId,
    removalReason: input.record.removalReason,
    firstEnteredAt: input.record.firstEnteredAt,
    lastEnteredAt: input.record.lastEnteredAt,
    lastSeenAt: snapshotBase.lastSeenAt,
    lastSeenLabel: snapshotBase.lastSeenLabel,
    liveNow: snapshotBase.liveNow,
    avatarUrl: snapshotBase.liveProfile?.avatarUrl ?? null,
    ownerUserId,
    ownerName: input.record.ownerNameSnapshot,
    agentControllerRef,
    ...(executionReadiness.agentControllerPermissionMode
      ? {
          agentControllerPermissionMode:
            executionReadiness.agentControllerPermissionMode,
        }
      : {}),
    ...(canManageAgentProfile && executionReadiness.modelSelection
      ? { modelSelection: executionReadiness.modelSelection }
      : {}),
    ...(canManageAgentProfile && executionReadiness.runtimeDeviceDisplayName
      ? {
          runtimeDeviceDisplayName: executionReadiness.runtimeDeviceDisplayName,
        }
      : {}),
    ...redactedOriginFields,
    agentWakeAvailability,
    ownerWakeDiagnostics,
  };
}

function maybeBackfillCreator(input: {
  discovered: Map<string, SpaceMemberRecord>;
  spaceId: string;
  metaRecord: SpaceMetaRecord | null;
  nowIso: string;
}): void {
  if (!input.metaRecord?.creator) {
    return;
  }
  const creatorRecord = buildCreatorBackfillRecord({
    spaceId: input.spaceId,
    creator: input.metaRecord.creator,
    addedAt: input.metaRecord.createdAt,
    nowIso: input.nowIso,
  });
  if (creatorRecord) {
    input.discovered.set(creatorRecord.profileId, creatorRecord);
  }
}

function backfillMembersFromSignals(input: {
  discovered: Map<string, SpaceMemberRecord>;
  existingRecordsByProfileId: Map<string, SpaceMemberRecord>;
  signals: SignalEnvelope[];
  spaceId: string;
  nowIso: string;
  sourceHints: SpaceMemberSourceHints;
}): void {
  for (const signal of input.signals) {
    if (!isMemberDiscoverySignal(signal)) {
      continue;
    }
    const normalizedProfile = normalizeMemberDiscoveryProfile(signal);
    if (!normalizedProfile) {
      continue;
    }
    const signalIso = new Date(signal.ts).toISOString();
    setDiscoveredMemberRecord({
      discovered: input.discovered,
      existingRecordsByProfileId: input.existingRecordsByProfileId,
      profile: normalizedProfile,
      spaceId: input.spaceId,
      nowIso: input.nowIso,
      sourceHint: resolveSpaceMemberSourceHint({
        sourceHints: input.sourceHints,
        profileId: normalizedProfile.profileId,
        profileName: normalizedProfile.profileName,
      }),
      fallbackSource: "joined_directly",
      fallbackAddedAt: signalIso,
      firstEnteredAt: signalIso,
      lastEnteredAt: signalIso,
    });
  }
}

function isMemberDiscoverySignal(signal: SignalEnvelope): boolean {
  return (
    signal.type === "signal.text" ||
    signal.type === "signal.status" ||
    signal.type === "signal.system_notice"
  );
}

function normalizeMemberDiscoveryProfile(
  signal: SignalEnvelope
): ResolvedAddSpaceMemberInput | null {
  if (signal.type === "signal.system_notice") {
    const actorProfileId = normalizeOptionalText(signal.data.actorProfileId);
    if (!actorProfileId) {
      return null;
    }
    return {
      profileId: actorProfileId,
      profileName: normalizeOptionalText(signal.data.actorName),
      profileKind: "agent",
      ownerUserId: null,
      ownerName: null,
      agentControllerRef: null,
    };
  }
  return normalizeProfileSnapshot({
    profile: signal.profile,
  });
}

function backfillMembersFromLiveSessions(input: {
  discovered: Map<string, SpaceMemberRecord>;
  existingRecordsByProfileId: Map<string, SpaceMemberRecord>;
  liveSessions: Iterable<LiveSessionLike>;
  spaceId: string;
  nowIso: string;
  sourceHints: SpaceMemberSourceHints;
}): void {
  for (const session of input.liveSessions) {
    const profile = session.profile ?? session.enforcedProfile;
    if (!profile) {
      continue;
    }
    const normalizedProfile = normalizeProfileSnapshot({ profile });
    if (!normalizedProfile) {
      continue;
    }
    setDiscoveredMemberRecord({
      discovered: input.discovered,
      existingRecordsByProfileId: input.existingRecordsByProfileId,
      profile: normalizedProfile,
      spaceId: input.spaceId,
      nowIso: input.nowIso,
      sourceHint: resolveSpaceMemberSourceHint({
        sourceHints: input.sourceHints,
        profileId: normalizedProfile.profileId,
        profileName: normalizedProfile.profileName,
      }),
      fallbackSource: "joined_directly",
      fallbackAddedAt: input.nowIso,
      firstEnteredAt: input.nowIso,
      lastEnteredAt: input.nowIso,
    });
  }
}

function backfillMembersFromCursorAliases(input: {
  discovered: Map<string, SpaceMemberRecord>;
  existingRecordsByProfileId: Map<string, SpaceMemberRecord>;
  cursorSnapshots: Map<string, CursorMemberSnapshot>;
  spaceId: string;
  nowIso: string;
  sourceHints: SpaceMemberSourceHints;
}): void {
  for (const cursorSnapshot of input.cursorSnapshots.values()) {
    const sourceHint = input.sourceHints.byProfileId.get(
      cursorSnapshot.profileId
    );
    if (!(cursorSnapshot.mentionAlias && sourceHint?.profileKind)) {
      continue;
    }
    if (input.discovered.has(cursorSnapshot.profileId)) {
      continue;
    }
    setDiscoveredMemberRecord({
      discovered: input.discovered,
      existingRecordsByProfileId: input.existingRecordsByProfileId,
      profile: {
        profileId: cursorSnapshot.profileId,
        profileName: cursorSnapshot.mentionAlias ?? cursorSnapshot.profileId,
        profileKind: sourceHint.profileKind,
        ownerUserId: null,
        ownerName: null,
        agentControllerRef: null,
      },
      spaceId: input.spaceId,
      nowIso: input.nowIso,
      sourceHint,
      fallbackSource: "backfilled",
      fallbackAddedAt: cursorSnapshot.createdAt ?? input.nowIso,
    });
  }
}

function setDiscoveredMemberRecord(input: {
  discovered: Map<string, SpaceMemberRecord>;
  existingRecordsByProfileId: Map<string, SpaceMemberRecord>;
  profile: ResolvedAddSpaceMemberInput;
  spaceId: string;
  nowIso: string;
  sourceHint: SpaceMemberSourceHint | null;
  fallbackSource: "joined_directly" | "backfilled";
  fallbackAddedAt: string;
  firstEnteredAt?: string | null;
  lastEnteredAt?: string | null;
}): void {
  const existing = input.discovered.get(input.profile.profileId) ?? null;
  const existingProfileSnapshot =
    existing ??
    input.existingRecordsByProfileId.get(input.profile.profileId) ??
    null;
  input.discovered.set(
    input.profile.profileId,
    buildNextSpaceMemberRecord({
      existing,
      existingProfileSnapshot,
      spaceId: input.spaceId,
      profile: input.profile,
      nowIso: input.nowIso,
      defaultSource: input.sourceHint
        ? "added_by_member"
        : input.fallbackSource,
      defaultAddedAt: input.sourceHint?.addedAt ?? input.fallbackAddedAt,
      addedByProfileId: input.sourceHint?.addedByProfileId ?? null,
      addedByOwnerUserId: null,
      addedByDisplayName: input.sourceHint?.addedByDisplayName ?? null,
      firstEnteredAt: input.firstEnteredAt ?? existing?.firstEnteredAt ?? null,
      lastEnteredAt: input.lastEnteredAt ?? existing?.lastEnteredAt ?? null,
    })
  );
}

function persistBackfilledMembers(
  sql: SqlStorage,
  discovered: Map<string, SpaceMemberRecord>,
  existingRecordsByProfileId: Map<string, SpaceMemberRecord>
): void {
  if (discovered.size === 0) {
    return;
  }

  // SQLite-backed Durable Objects coalesce sync writes in one turn atomically.
  for (const record of discovered.values()) {
    const existing = existingRecordsByProfileId.get(record.profileId) ?? null;
    const next = existing
      ? mergeBackfilledMemberRecord({
          existing,
          discovered: record,
        })
      : record;
    if (existing && spaceMemberRecordsEqual(existing, next)) {
      continue;
    }
    upsertSpaceMemberRecord(sql, next);
  }
}

function mergeBackfilledMemberRecord(input: {
  existing: SpaceMemberRecord;
  discovered: SpaceMemberRecord;
}): SpaceMemberRecord {
  const shouldPromoteSource = shouldPromoteMemberSource({
    existing: input.existing.memberSource,
    discovered: input.discovered.memberSource,
  });

  return {
    ...input.existing,
    profileKindSnapshot: input.discovered.profileKindSnapshot,
    // Historical activity cannot rename an existing member.
    profileNameSnapshot: input.existing.profileNameSnapshot,
    ownerUserIdSnapshot:
      input.discovered.ownerUserIdSnapshot ??
      input.existing.ownerUserIdSnapshot,
    ownerNameSnapshot:
      input.discovered.ownerNameSnapshot ?? input.existing.ownerNameSnapshot,
    controllerRefSnapshot:
      input.discovered.controllerRefSnapshot ??
      input.existing.controllerRefSnapshot,
    memberSource: shouldPromoteSource
      ? input.discovered.memberSource
      : input.existing.memberSource,
    addedAt: shouldPromoteSource
      ? input.discovered.addedAt
      : input.existing.addedAt,
    addedByProfileId:
      input.discovered.addedByProfileId ?? input.existing.addedByProfileId,
    addedByOwnerUserId:
      input.discovered.addedByOwnerUserId ?? input.existing.addedByOwnerUserId,
    addedByDisplayNameSnapshot:
      input.discovered.addedByDisplayNameSnapshot ??
      input.existing.addedByDisplayNameSnapshot,
    firstEnteredAt: pickEarlierIsoTimestamp(
      input.existing.firstEnteredAt,
      input.discovered.firstEnteredAt
    ),
    lastEnteredAt: pickLaterIsoTimestamp(
      input.existing.lastEnteredAt,
      input.discovered.lastEnteredAt
    ),
    updatedAt: input.discovered.updatedAt,
  };
}

export function refreshSpaceMemberNameSnapshot(input: {
  sql: SqlStorage;
  profileId: string;
  profileName: string;
}): boolean {
  const name = normalizeSpaceMemberNameSnapshot(
    input.profileId,
    input.profileName
  );
  const member = readSpaceMemberRecord(input.sql, input.profileId);
  if (
    !(name && member) ||
    member.status !== "active" ||
    member.profileNameSnapshot === name
  ) {
    return false;
  }
  upsertSpaceMemberRecord(input.sql, {
    ...member,
    profileNameSnapshot: name,
    updatedAt: new Date().toISOString(),
  });
  return true;
}

// Display enrichment must not hold reply publication or status polling open.
export const SPACE_MEMBER_NAME_READ_BUDGET_MS = 500;

export async function refreshSpaceMemberNamesFromAuth(input: {
  sql: SqlStorage;
  env: CoreBindings;
}): Promise<boolean> {
  const auth = input.env.OPENMELD_AUTH_WORKER;
  if (!auth?.resolveProfileById) {
    return false;
  }
  const members = listSpaceMemberRecords(input.sql, {
    status: "active",
  });
  let changed = false;
  const deadlineAtMs = Date.now() + SPACE_MEMBER_NAME_READ_BUDGET_MS;
  // A nonempty snapshot can still predate an Auth rename.
  for (let offset = 0; offset < members.length; offset += 8) {
    if (Date.now() >= deadlineAtMs) {
      break;
    }
    const refreshed = await Promise.all(
      members.slice(offset, offset + 8).map(async (member) => {
        const name = await readSpaceMemberNameFromAuth({
          env: input.env,
          profileId: member.profileId,
          profileKind: member.profileKindSnapshot,
          deadlineAtMs,
        });
        if (!name) {
          return false;
        }
        // Re-read after the Auth RPC: a concurrent rename or removal wins.
        const current = readSpaceMemberRecord(input.sql, member.profileId);
        if (
          !current ||
          current.status !== "active" ||
          current.profileNameSnapshot !== member.profileNameSnapshot
        ) {
          return false;
        }
        return refreshSpaceMemberNameSnapshot({
          sql: input.sql,
          profileId: member.profileId,
          profileName: name,
        });
      })
    );
    changed = refreshed.some(Boolean) || changed;
  }
  return changed;
}

export async function readSpaceMemberNameFromAuth(input: {
  env: CoreBindings;
  profileId: string;
  profileKind: "agent" | "human";
  deadlineAtMs?: number;
}): Promise<string | null> {
  const remainingMs =
    (input.deadlineAtMs ?? Date.now() + SPACE_MEMBER_NAME_READ_BUDGET_MS) -
    Date.now();
  if (remainingMs <= 0) {
    return null;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      input.env.OPENMELD_AUTH_WORKER?.resolveProfileById?.({
        openMeldProfileId: input.profileId,
      }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("Space member name lookup timed out")),
          remainingMs
        );
      }),
    ]);
    if (!result?.ok) {
      console.warn("[core.space.member_name_unavailable]", {
        profileId: input.profileId,
        code: result?.code ?? "auth_unavailable",
      });
      return null;
    }
    if (
      result.profile.profileId !== input.profileId ||
      result.profile.profileKind !== input.profileKind
    ) {
      throw new Error("Space member name identity mismatch");
    }
    return normalizeSpaceMemberNameSnapshot(
      input.profileId,
      result.profile.profileName
    );
  } catch (error) {
    console.warn("[core.space.member_name_failed]", {
      profileId: input.profileId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

function shouldPromoteMemberSource(input: {
  existing: SpaceMemberRecord["memberSource"];
  discovered: SpaceMemberRecord["memberSource"];
}): boolean {
  return (
    resolveMemberSourcePriority(input.discovered) >
    resolveMemberSourcePriority(input.existing)
  );
}

function resolveMemberSourcePriority(
  source: SpaceMemberRecord["memberSource"]
): number {
  switch (source) {
    case "space_creator":
      return 4;
    case "added_by_member":
      return 3;
    case "joined_directly":
      return 2;
    case "backfilled":
      return 1;
    default:
      return 0;
  }
}

function pickEarlierIsoTimestamp(
  left: string | null,
  right: string | null
): string | null {
  if (!(left && right)) {
    return left ?? right;
  }
  return Date.parse(left) <= Date.parse(right) ? left : right;
}

function pickLaterIsoTimestamp(
  left: string | null,
  right: string | null
): string | null {
  if (!(left && right)) {
    return left ?? right;
  }
  return Date.parse(left) >= Date.parse(right) ? left : right;
}

function spaceMemberRecordsEqual(
  left: SpaceMemberRecord,
  right: SpaceMemberRecord
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function buildCreatorBackfillRecord(input: {
  spaceId: string;
  creator: SpaceCreator;
  addedAt: string;
  nowIso: string;
}): SpaceMemberRecord | null {
  const creator = normalizeSpaceCreator(input.creator);
  if (!creator) {
    return null;
  }

  return buildNextSpaceMemberRecord({
    existing: null,
    existingProfileSnapshot: null,
    spaceId: input.spaceId,
    profile: {
      profileId: creator.profileId,
      profileName: creator.profileName,
      profileKind: creator.profileKind,
      ownerUserId: creator.ownerUserId,
      ownerName: creator.ownerName,
      agentControllerRef: null,
    },
    nowIso: input.nowIso,
    defaultSource: "space_creator",
    defaultAddedAt: input.addedAt,
  });
}

function buildNextSpaceMemberRecord(input: {
  existing: SpaceMemberRecord | null;
  existingProfileSnapshot: ExistingMemberProfileSnapshot | null;
  spaceId: string;
  profile: ResolvedAddSpaceMemberInput;
  nowIso: string;
  defaultSource:
    | "space_creator"
    | "joined_directly"
    | "added_by_member"
    | "backfilled";
  defaultAddedAt: string;
  addedByProfileId?: string | null;
  addedByOwnerUserId?: string | null;
  addedByDisplayName?: string | null;
  firstEnteredAt?: string | null;
  lastEnteredAt?: string | null;
}): SpaceMemberRecord {
  const profileNameSnapshot =
    normalizeSpaceMemberNameSnapshot(
      input.profile.profileId,
      input.profile.profileName
    ) ??
    input.existingProfileSnapshot?.profileNameSnapshot ??
    input.profile.profileId;
  return {
    spaceId: input.spaceId,
    profileId: input.profile.profileId,
    profileKindSnapshot: input.profile.profileKind,
    profileNameSnapshot,
    ownerUserIdSnapshot:
      normalizeOptionalText(input.profile.ownerUserId) ??
      input.existingProfileSnapshot?.ownerUserIdSnapshot ??
      null,
    ownerNameSnapshot:
      normalizeOptionalText(input.profile.ownerName) ??
      input.existingProfileSnapshot?.ownerNameSnapshot ??
      null,
    controllerRefSnapshot:
      input.profile.profileKind === "agent"
        ? (normalizeOptionalText(input.profile.agentControllerRef) ??
          input.existingProfileSnapshot?.controllerRefSnapshot ??
          null)
        : null,
    status: "active",
    memberSource: input.existing?.memberSource ?? input.defaultSource,
    addedAt: input.existing?.addedAt ?? input.defaultAddedAt,
    removedAt: null,
    addedByProfileId:
      input.existing?.addedByProfileId ?? input.addedByProfileId ?? null,
    addedByOwnerUserId:
      input.existing?.addedByOwnerUserId ?? input.addedByOwnerUserId ?? null,
    addedByDisplayNameSnapshot:
      input.existing?.addedByDisplayNameSnapshot ??
      input.addedByDisplayName ??
      null,
    removedByProfileId: null,
    removedByOwnerUserId: null,
    removalReason: null,
    firstEnteredAt:
      input.firstEnteredAt ?? input.existing?.firstEnteredAt ?? null,
    lastEnteredAt: input.lastEnteredAt ?? input.existing?.lastEnteredAt ?? null,
    createdAt: input.existing?.createdAt ?? input.nowIso,
    updatedAt: input.nowIso,
  };
}

function buildRemovedSpaceMemberRecord(input: {
  existing: SpaceMemberRecord;
  nowIso: string;
  removedByProfileId: string;
  removedByOwnerUserId: string | null;
  removalReason?: string;
}): SpaceMemberRecord {
  return {
    ...input.existing,
    status: "removed",
    removedAt: input.nowIso,
    removedByProfileId: input.removedByProfileId,
    removedByOwnerUserId: input.removedByOwnerUserId,
    removalReason: input.removalReason ?? "removed_by_member",
    updatedAt: input.nowIso,
  };
}

function buildMemberSourceLabel(record: SpaceMemberRecord): string {
  if (record.memberSource === "space_creator") {
    return "Creator";
  }
  if (record.memberSource === "added_by_member") {
    const actor =
      record.addedByDisplayNameSnapshot ?? record.addedByProfileId ?? "member";
    return `Added by ${actor}`;
  }
  return "Joined directly";
}

function resolveOwnerWakeDiagnosticsState(input: {
  agentWakeAvailability: NonNullable<
    SpaceMemberAgentSnapshot["agentWakeAvailability"]
  >;
}): NonNullable<SpaceMemberAgentSnapshot["ownerWakeDiagnostics"]>["state"] {
  if (input.agentWakeAvailability.status === "available_for_wake") {
    return "none";
  }
  if (input.agentWakeAvailability.status === "checking_connection") {
    return "checking_wake_status";
  }
  return "action_required";
}

function isPublicWakeableAgent(agent: SpaceMemberAgentSnapshot): boolean {
  return agent.agentWakeAvailability?.status === "available_for_wake";
}

function isPublicCheckingAgent(agent: SpaceMemberAgentSnapshot): boolean {
  return agent.agentWakeAvailability?.status === "checking_connection";
}

function isPublicOfflineAgent(agent: SpaceMemberAgentSnapshot): boolean {
  return agent.agentWakeAvailability?.status === "offline_for_wake";
}

function isPublicUnavailableAgent(agent: SpaceMemberAgentSnapshot): boolean {
  return agent.agentWakeAvailability?.status === "unavailable_for_wake";
}

function isSameOwnerUserId(input: {
  leftOwnerUserId: string | null | undefined;
  rightOwnerUserId: string | null | undefined;
}): boolean {
  const left = normalizeOptionalText(input.leftOwnerUserId);
  const right = normalizeOptionalText(input.rightOwnerUserId);
  return Boolean(left && right && left === right);
}

function resolveRedactedAgentOriginFields(input: {
  candidateAgentControllerConversationId: string | null;
  candidateWorkingDirectory: string | null;
  profileId: string;
  profileName: string;
  ownerUserId: string | null;
  ownerName: string | null;
  agentControllerRef: string | null;
  viewerOwnerUserId?: string;
  viewerProfileId?: string;
  creatorProfileIdByProfileId?: Readonly<Record<string, string | null>>;
}): Pick<
  SpaceMemberAgentSnapshot,
  "agentControllerConversationId" | "workingDirectory"
> {
  const redacted = redactProfileForViewer({
    profile: {
      kind: "agent",
      profileId: input.profileId,
      profileName: input.profileName,
      ...(input.ownerUserId ? { owner: input.ownerUserId } : {}),
      ...(input.ownerName ? { ownerName: input.ownerName } : {}),
      ...(input.agentControllerRef
        ? { agentControllerRef: input.agentControllerRef }
        : {}),
      ...(input.candidateAgentControllerConversationId
        ? {
            agentControllerConversationId:
              input.candidateAgentControllerConversationId,
          }
        : {}),
      ...(input.candidateWorkingDirectory
        ? { workingDirectory: input.candidateWorkingDirectory }
        : {}),
    },
    viewerOwnerUserId: input.viewerOwnerUserId,
    viewerProfileId: input.viewerProfileId,
    creatorProfileIdByProfileId: input.creatorProfileIdByProfileId,
  });
  const agentControllerConversationId = normalizeOptionalText(
    redacted.agentControllerConversationId
  );
  const workingDirectory =
    normalizeOptionalWorkingDirectory(redacted.workingDirectory) ?? null;
  return {
    agentControllerConversationId,
    workingDirectory,
  };
}

function resolveLastSeenAt(input: {
  record: SpaceMemberRecord;
  cursorSnapshot: CursorMemberSnapshot | null;
  signalActivity: LatestSignalActivity | null;
}): string | null {
  const candidates = [
    input.signalActivity?.lastSignalAt ?? null,
    input.cursorSnapshot?.lastSeenAt ?? null,
    input.record.lastEnteredAt,
  ].filter((value): value is string => Boolean(value));

  if (candidates.length === 0) {
    return null;
  }

  const [firstCandidate, ...otherCandidates] = candidates;
  if (!firstCandidate) {
    return null;
  }

  let latest = firstCandidate;
  for (const candidate of otherCandidates) {
    if (Date.parse(candidate) > Date.parse(latest)) {
      latest = candidate;
    }
  }
  return latest;
}

function formatLastSeenLabel(input: {
  generatedAt: string;
  lastSeenAt: string;
}): string {
  const deltaMs = Math.max(
    0,
    Date.parse(input.generatedAt) - Date.parse(input.lastSeenAt)
  );
  if (deltaMs < SHORT_LAST_SEEN_MINUTE_MS) {
    return "Seen now";
  }
  if (deltaMs < SHORT_LAST_SEEN_HOUR_MS) {
    return `Seen ${Math.max(1, Math.floor(deltaMs / SHORT_LAST_SEEN_MINUTE_MS))}m ago`;
  }
  if (deltaMs < SHORT_LAST_SEEN_DAY_MS) {
    return `Seen ${Math.max(1, Math.floor(deltaMs / SHORT_LAST_SEEN_HOUR_MS))}h ago`;
  }
  return `Seen ${Math.max(1, Math.floor(deltaMs / SHORT_LAST_SEEN_DAY_MS))}d ago`;
}

function sortMemberSnapshots<
  T extends SpaceMemberHumanSnapshot | SpaceMemberAgentSnapshot,
>(items: T[]): T[] {
  return [...items].sort((left, right) => {
    const leftCreator = left.memberSource === "space_creator" ? 0 : 1;
    const rightCreator = right.memberSource === "space_creator" ? 0 : 1;
    if (leftCreator !== rightCreator) {
      return leftCreator - rightCreator;
    }

    const leftLive = left.liveNow ? 0 : 1;
    const rightLive = right.liveNow ? 0 : 1;
    if (leftLive !== rightLive) {
      return leftLive - rightLive;
    }

    const leftSeen = left.lastSeenAt ? Date.parse(left.lastSeenAt) : 0;
    const rightSeen = right.lastSeenAt ? Date.parse(right.lastSeenAt) : 0;
    if (leftSeen !== rightSeen) {
      return rightSeen - leftSeen;
    }

    const byName = left.profileName.localeCompare(right.profileName);
    if (byName !== 0) {
      return byName;
    }
    return left.profileId.localeCompare(right.profileId);
  });
}

function sortSpaceIdentityDirectoryEntries(
  left: SpaceIdentityDirectoryEntry,
  right: SpaceIdentityDirectoryEntry
): number {
  const leftHuman = left.profileKind === "human" ? 0 : 1;
  const rightHuman = right.profileKind === "human" ? 0 : 1;
  if (leftHuman !== rightHuman) {
    return leftHuman - rightHuman;
  }

  const byName = left.profileName.localeCompare(right.profileName);
  if (byName !== 0) {
    return byName;
  }
  return left.profileId.localeCompare(right.profileId);
}

type SpaceMembersBackfillWatermark = {
  lastTs: number;
  lastSignalId: string;
};

function readSpaceMembersBackfillWatermark(
  sql: SqlStorage
): SpaceMembersBackfillWatermark | null {
  const rows = sql
    .exec<{ last_ts: number; last_signal_id: string }>(
      "SELECT last_ts, last_signal_id FROM space_members_backfill_watermark WHERE id = 1"
    )
    .toArray();
  const row = rows[0];
  if (!row) {
    return null;
  }
  return { lastTs: row.last_ts, lastSignalId: row.last_signal_id };
}

function writeSpaceMembersBackfillWatermark(
  sql: SqlStorage,
  watermark: SpaceMembersBackfillWatermark
): void {
  sql.exec(
    `
      INSERT INTO space_members_backfill_watermark (id, last_ts, last_signal_id)
      VALUES (1, ?, ?)
      ON CONFLICT (id) DO UPDATE SET
        last_ts = excluded.last_ts,
        last_signal_id = excluded.last_signal_id
    `,
    watermark.lastTs,
    watermark.lastSignalId
  );
}

// Incremental read for the member backfill: signals at or before the
// watermark were fully processed by an earlier backfill run (the discovery
// merge is order-preserving and idempotent), so only newer rows are loaded.
function listStoredSignalsAfter(
  sql: SqlStorage,
  watermark: SpaceMembersBackfillWatermark | null
): SignalEnvelope[] {
  const rows = watermark
    ? sql
        .exec<{ payload_json: string }>(
          `
            SELECT payload_json
            FROM space_signals
            WHERE ts > ? OR (ts = ? AND id > ?)
            ORDER BY ts ASC, id ASC
          `,
          watermark.lastTs,
          watermark.lastTs,
          watermark.lastSignalId
        )
        .toArray()
    : sql
        .exec<{ payload_json: string }>(
          `
            SELECT payload_json
            FROM space_signals
            ORDER BY ts ASC, id ASC
          `
        )
        .toArray();

  return rows
    .map((row) => parseStoredSignal(row.payload_json))
    .filter((signal): signal is SignalEnvelope => Boolean(signal));
}

// SQL aggregation twin of listLatestSignalActivity: identical profile-id
// selection (presence excluded, system notices attribute to the actor,
// everything else to the authoring profile) pushed into SQLite so the
// hot path stops parsing the whole signal history.
function listLatestSignalActivityFromSql(
  sql: SqlStorage
): Map<string, LatestSignalActivity> {
  const rows = sql
    .exec<{ pid: string | null; max_ts: number }>(
      `
        SELECT
          CASE
            WHEN json_extract(payload_json, '$.type') IN ('presence.join', 'presence.quit') THEN NULL
            WHEN json_extract(payload_json, '$.type') = 'signal.system_notice' THEN json_extract(payload_json, '$.data.actorProfileId')
            ELSE json_extract(payload_json, '$.profile.profileId')
          END AS pid,
          MAX(ts) AS max_ts
        FROM space_signals
        GROUP BY pid
      `
    )
    .toArray();

  const latestByProfileId = new Map<string, LatestSignalActivity>();
  for (const row of rows) {
    const profileId = normalizeOptionalText(row.pid);
    if (!profileId) {
      continue;
    }
    const current = latestByProfileId.get(profileId);
    if (!current || row.max_ts >= Date.parse(current.lastSignalAt)) {
      latestByProfileId.set(profileId, {
        profileId,
        lastSignalAt: new Date(row.max_ts).toISOString(),
      });
    }
  }
  return latestByProfileId;
}

// SQL twin of listLatestAgentOriginFactsByProfileId: the WHERE clause
// mirrors the JS normalization exactly (conversation id trims non-empty;
// working directory is a 1..4096-char NUL-free string), so the newest
// matching row per profile is the same row the full scan would pick. The
// picked rows still run through the original parse + normalize as a
// defensive re-check.
function listLatestAgentOriginFactsFromSql(
  sql: SqlStorage
): Map<string, LatestAgentOriginFacts> {
  const rows = sql
    .exec<{ payload_json: string }>(
      `
        SELECT payload_json FROM (
          SELECT
            payload_json,
            ROW_NUMBER() OVER (
              PARTITION BY json_extract(payload_json, '$.profile.profileId')
              ORDER BY ts DESC, id DESC
            ) AS rn
          FROM space_signals
          WHERE json_extract(payload_json, '$.profile.kind') = 'agent'
            AND (
              TRIM(COALESCE(json_extract(payload_json, '$.profile.agentControllerConversationId'), '')) != ''
              OR (
                json_type(payload_json, '$.profile.workingDirectory') = 'text'
                AND LENGTH(json_extract(payload_json, '$.profile.workingDirectory')) BETWEEN 1 AND 4096
                AND INSTR(json_extract(payload_json, '$.profile.workingDirectory'), CHAR(0)) = 0
              )
            )
        )
        WHERE rn = 1
      `
    )
    .toArray();

  const candidates = rows
    .map((row) => parseStoredSignal(row.payload_json))
    .filter((signal): signal is SignalEnvelope => Boolean(signal));
  return listLatestAgentOriginFactsByProfileId(candidates);
}

function listLatestAgentOriginFactsByProfileId(
  signals: SignalEnvelope[]
): Map<string, LatestAgentOriginFacts> {
  const latestByProfileId = new Map<string, LatestAgentOriginFacts>();

  for (const signal of signals) {
    if (signal.profile.kind !== "agent") {
      continue;
    }
    const profileId = normalizeOptionalText(signal.profile.profileId);
    const agentControllerConversationId = normalizeOptionalText(
      signal.profile.agentControllerConversationId
    );
    const workingDirectory =
      normalizeOptionalWorkingDirectory(signal.profile.workingDirectory) ??
      null;
    if (!(profileId && (agentControllerConversationId || workingDirectory))) {
      continue;
    }
    const current = latestByProfileId.get(profileId);
    if (!current || signal.ts >= current.ts) {
      latestByProfileId.set(profileId, {
        profileId,
        agentControllerConversationId,
        workingDirectory,
        ts: signal.ts,
      });
    }
  }

  return latestByProfileId;
}

function listCursorMemberSnapshots(
  sql: SqlStorage
): Map<string, CursorMemberSnapshot> {
  const rows = sql
    .exec<{
      profile_id: string;
      mention_alias: string | null;
      last_seen_ts: number | null;
      created_at: number;
    }>(
      `
        SELECT profile_id, mention_alias, last_seen_ts, created_at
        FROM space_cursors
      `
    )
    .toArray();

  return new Map(
    rows.map((row) => {
      const profileId = row.profile_id.trim();
      return [
        profileId,
        {
          profileId,
          mentionAlias: normalizeOptionalText(row.mention_alias),
          lastSeenAt:
            typeof row.last_seen_ts === "number" &&
            Number.isFinite(row.last_seen_ts)
              ? new Date(row.last_seen_ts).toISOString()
              : null,
          createdAt:
            typeof row.created_at === "number" &&
            Number.isFinite(row.created_at)
              ? new Date(row.created_at).toISOString()
              : null,
        },
      ] as const;
    })
  );
}

function buildLiveProfileById(
  liveSessions: Iterable<LiveSessionLike>
): Map<string, Profile> {
  const map = new Map<string, Profile>();
  for (const session of liveSessions) {
    const profile = session.profile ?? session.enforcedProfile;
    if (!profile) {
      continue;
    }
    if (profile.kind !== "human" && profile.kind !== "agent") {
      continue;
    }
    const profileId = profile.profileId.trim();
    if (!profileId) {
      continue;
    }
    map.set(profileId, profile);
  }
  return map;
}

// Join-notice hints must stay full-history even though discovery is now
// incremental: a member's join notice can be arbitrarily older than the
// signal that first discovers them. The purpose filter keeps this read to a
// handful of rows. Legacy (pre-join-notice) hints are only derived from the
// incremental window — for old Spaces a newly discovered member may fall
// back to the joined_directly source label, which is display metadata only.
function listJoinNoticeSignalsFromSql(sql: SqlStorage): SignalEnvelope[] {
  const rows = sql
    .exec<{ payload_json: string }>(
      `
        SELECT payload_json
        FROM space_signals
        WHERE json_extract(payload_json, '$.type') = 'signal.text'
          AND json_extract(payload_json, '$.data.meta.purpose') = ?
        ORDER BY ts ASC, id ASC
      `,
      SPACE_MEMBER_JOIN_NOTICE_PURPOSE
    )
    .toArray();
  return rows
    .map((row) => parseStoredSignal(row.payload_json))
    .filter((signal): signal is SignalEnvelope => Boolean(signal));
}

function buildSpaceMemberSourceHints(
  signals: SignalEnvelope[]
): SpaceMemberSourceHints {
  const sourceHintsByProfileId = new Map<string, SpaceMemberSourceHint>();
  const legacyHintsByProfileName = new Map<string, SpaceMemberSourceHint[]>();

  for (const signal of signals) {
    if (signal.type !== "signal.text") {
      continue;
    }
    const signalMeta = resolveSignalTextMeta(signal);
    const purpose = normalizeOptionalText(signalMeta?.purpose);
    if (purpose !== SPACE_MEMBER_JOIN_NOTICE_PURPOSE) {
      collectLegacySpaceMemberSourceHint({
        signal,
        legacyHintsByProfileName,
      });
      continue;
    }
    const targetProfileId = normalizeOptionalText(signalMeta?.targetProfileId);
    if (!targetProfileId) {
      collectLegacySpaceMemberSourceHint({
        signal,
        legacyHintsByProfileName,
      });
      continue;
    }
    if (sourceHintsByProfileId.has(targetProfileId)) {
      continue;
    }
    sourceHintsByProfileId.set(targetProfileId, {
      addedAt: new Date(signal.ts).toISOString(),
      addedByProfileId: normalizeOptionalText(signalMeta?.addedByProfileId),
      addedByDisplayName:
        normalizeOptionalText(signalMeta?.addedByDisplayName) ??
        normalizeOptionalText(signal.profile.profileName) ??
        normalizeOptionalText(signal.profile.ownerName),
      profileKind: normalizeProfileKindHint(signalMeta?.targetProfileKind),
    });
  }

  return {
    byProfileId: sourceHintsByProfileId,
    byUniqueProfileName: buildUniqueProfileNameHintMap(
      legacyHintsByProfileName
    ),
  };
}

function resolveSignalTextMeta(
  signal: SignalEnvelope
): Record<string, unknown> | null {
  const meta =
    signal.data &&
    typeof signal.data === "object" &&
    !Array.isArray(signal.data)
      ? (signal.data as { meta?: unknown }).meta
      : null;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    return null;
  }
  return meta as Record<string, unknown>;
}

function normalizeProfileSnapshot(input: {
  profile: Profile;
  ownerUserId?: string;
  ownerName?: string;
}): ResolvedAddSpaceMemberInput | null {
  if (input.profile.kind !== "human" && input.profile.kind !== "agent") {
    return null;
  }
  const profileId = normalizeOptionalText(input.profile.profileId);
  if (!profileId) {
    return null;
  }
  const profileName = normalizeSpaceMemberNameSnapshot(
    profileId,
    input.profile.profileName
  );

  return {
    profileId,
    profileName,
    profileKind: input.profile.kind,
    ownerUserId:
      normalizeOptionalText(input.ownerUserId) ??
      normalizeOptionalText(input.profile.owner),
    ownerName:
      normalizeOptionalText(input.ownerName) ??
      normalizeOptionalText(input.profile.ownerName),
    agentControllerRef:
      input.profile.kind === "agent"
        ? normalizeOptionalText(input.profile.agentControllerRef)
        : null,
  };
}

function normalizeSpaceCreator(creator?: SpaceCreator): {
  profileId: string;
  profileName: string;
  profileKind: "human" | "agent";
  ownerUserId: string | null;
  ownerName: string | null;
} | null {
  if (!creator) {
    return null;
  }
  if (creator.kind !== "human" && creator.kind !== "agent") {
    return null;
  }
  const profileId = normalizeOptionalText(creator.profileId);
  if (!profileId) {
    return null;
  }
  return {
    profileId,
    profileName: normalizeOptionalText(creator.profileName) ?? profileId,
    profileKind: creator.kind,
    ownerUserId: normalizeOptionalText(creator.ownerUserId),
    ownerName:
      normalizeOptionalText(creator.ownerName) ??
      normalizeOptionalText(creator.profileName),
  };
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized =
    typeof value === "string" ? value.trim() : String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function resolveSpaceMemberSourceHint(input: {
  sourceHints: SpaceMemberSourceHints;
  profileId: string;
  profileName: string | null;
}): SpaceMemberSourceHint | null {
  return (
    input.sourceHints.byProfileId.get(input.profileId) ??
    input.sourceHints.byUniqueProfileName.get(
      normalizeSpaceMemberProfileName(input.profileName) ?? ""
    ) ??
    null
  );
}

function collectLegacySpaceMemberSourceHint(input: {
  signal: SignalEnvelope;
  legacyHintsByProfileName: Map<string, SpaceMemberSourceHint[]>;
}): void {
  const parsed = parseLegacySpaceMemberJoinNotice(input.signal);
  if (!parsed) {
    return;
  }

  const existing = input.legacyHintsByProfileName.get(parsed.profileName) ?? [];
  existing.push({
    addedAt: new Date(input.signal.ts).toISOString(),
    addedByProfileId:
      normalizeOptionalText(input.signal.profile.profileId) ?? null,
    addedByDisplayName:
      normalizeOptionalText(input.signal.profile.profileName) ??
      normalizeOptionalText(input.signal.profile.ownerName),
    profileKind: parsed.profileKind,
  });
  input.legacyHintsByProfileName.set(parsed.profileName, existing);
}

function buildUniqueProfileNameHintMap(
  legacyHintsByProfileName: Map<string, SpaceMemberSourceHint[]>
): Map<string, SpaceMemberSourceHint> {
  const uniqueHints = new Map<string, SpaceMemberSourceHint>();

  for (const [profileName, hints] of legacyHintsByProfileName) {
    if (hints.length !== 1) {
      continue;
    }
    const [hint] = hints;
    if (!hint) {
      continue;
    }
    uniqueHints.set(profileName, hint);
  }

  return uniqueHints;
}

function parseLegacySpaceMemberJoinNotice(signal: SignalEnvelope): {
  profileName: string;
  profileKind: "human" | "agent";
} | null {
  if (signal.type !== "signal.text") {
    return null;
  }

  const text = normalizeOptionalText(signal.data?.text);
  if (!text) {
    return null;
  }

  const joinedMatch = LEGACY_ADD_MEMBERS_NOTICE_REGEX.exec(text);
  if (joinedMatch) {
    const profileName = normalizeSpaceMemberProfileName(joinedMatch[1] ?? null);
    const profileKind = normalizeProfileKindHint(joinedMatch[2]);
    if (!(profileName && profileKind)) {
      return null;
    }

    return {
      profileName,
      profileKind,
    };
  }

  const addedMatch = LEGACY_ADDED_TO_SPACE_NOTICE_REGEX.exec(text);
  if (!addedMatch) {
    return null;
  }

  const targetLabel = normalizeOptionalText(addedMatch[1]);
  if (!targetLabel) {
    return null;
  }
  const parsedTarget = parseLegacyAddedToSpaceTargetLabel(targetLabel);
  if (!parsedTarget.profileName) {
    return null;
  }

  return {
    profileName: parsedTarget.profileName,
    profileKind: parsedTarget.profileKind,
  };
}

function normalizeSpaceMemberProfileName(value: string | null): string | null {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    return null;
  }
  return normalized.replace(SPACE_MEMBER_LEADING_EMOJI_REGEX, "");
}

function normalizeProfileKindHint(value: unknown): "human" | "agent" | null {
  if (value === "human" || value === "agent") {
    return value;
  }
  return null;
}

function parseLegacyAddedToSpaceTargetLabel(value: string): {
  profileName: string | null;
  profileKind: "human" | "agent";
} {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    return {
      profileName: null,
      profileKind: "human",
    };
  }
  if (normalized.startsWith("🤖")) {
    return {
      profileName: normalizeSpaceMemberProfileName(normalized),
      profileKind: "agent",
    };
  }
  if (normalized.startsWith("👤")) {
    return {
      profileName: normalizeSpaceMemberProfileName(normalized),
      profileKind: "human",
    };
  }
  return {
    profileName: normalized,
    profileKind: "human",
  };
}

function measureSpaceMembersSnapshotTiming<T>(
  timing: SpaceMembersSnapshotTiming | undefined,
  metricSuffix: string,
  description: string,
  read: () => T
): T {
  if (!timing) {
    return read();
  }
  return timing.collector.measureSync(
    {
      name: `${timing.metricPrefix}_${metricSuffix}`,
      description: `${timing.descriptionPrefix}: ${description}`,
    },
    read
  );
}

async function measureSpaceMembersSnapshotTimingAsync<T>(
  timing: SpaceMembersSnapshotTiming | undefined,
  metricSuffix: string,
  description: string,
  read: () => Promise<T>
): Promise<T> {
  if (!timing) {
    return await read();
  }
  return await timing.collector.measure(
    {
      name: `${timing.metricPrefix}_${metricSuffix}`,
      description: `${timing.descriptionPrefix}: ${description}`,
    },
    read
  );
}

function logSpaceMembersSnapshotTiming(input: {
  activeMemberCount: number;
  agentCount: number;
  humanCount: number;
  liveNowCount: number;
  spaceId: string;
  startedAtMs: number;
}) {
  const durationMs = Math.max(0, Date.now() - input.startedAtMs);
  if (durationMs < 500) {
    return;
  }

  console.info("[core.space.members_snapshot_built]", {
    activeMemberCount: input.activeMemberCount,
    agentCount: input.agentCount,
    durationMs,
    event: CORE_LOG_EVENTS.spaceMembersSnapshotBuilt,
    humanCount: input.humanCount,
    liveNowCount: input.liveNowCount,
    spaceId: input.spaceId,
  });
}
