import {
  buildOpenMeldOrganizationWebUrl,
  deriveCenterAgentDirectMessageSpaceProjection,
} from "@openmeld/schemas";
import type {
  AgentDelegationSnapshot,
  AgentTaskCompletionObservation,
  AgentTaskHandle,
  AgentTaskTerminalOutcome,
  CenterAgentRoutineAuthorizedAction,
  CenterAgentRoutineExternalActionPolicy,
  OpenMeldDaemonDispatchQueueMessage,
  RemoteAgentTurnEnvelope,
  RemoteAgentWorkerAuthorContext,
} from "@openmeld/schemas/types";
import { OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE } from "@openmeld/space";
import {
  type CenterAgentProfileIdentity,
  readCenterAgentDesignationRecord,
  readCenterAgentProfileIdentity,
} from "../../center-agent/center-agent-repository";
import { readCenterAgentDirectMessageProjectionCandidateBySpaceId } from "../../space-index/space-index-repository";
import { parseCoreOwnedRemoteAgentTurnEnvelope } from "./center-agent-context-scope";

type OrganizationEnvelopeFacts = {
  id: string;
  memberCount: number;
  name: string;
  personal: boolean;
  webUrl?: string;
};

type SenderEnvelopeFacts = {
  displayName: string;
  id: string;
  kind: "agent_profile" | "member";
  ownerUserId?: string;
  profileId?: string;
  role?: string;
  verified: boolean;
};

type SpaceEnvelopeFacts = {
  id: string;
  isCenterAgentDm: boolean;
  kind: "dm" | "space";
  name: string;
};

type RemoteAgentTurnEnvelopeFacts = {
  centerAgent: CenterAgentProfileIdentity;
  centerAgentInteractionSource?: RemoteAgentTurnEnvelope["centerAgentInteractionSource"];
  organization: OrganizationEnvelopeFacts;
  sender: SenderEnvelopeFacts;
  space: SpaceEnvelopeFacts;
};

type OrganizationRow = {
  member_count: number | null;
  metadata: string | null;
  name: string;
  slug: string;
};

type SenderRow = {
  member_id: string | null;
  owner_user_id: string;
  profile_id: string;
  profile_kind: "agent" | "human" | "system";
  profile_name: string;
  role: string | null;
};

type RoutineSpaceRow = {
  direct_message_pair_key: string | null;
  organization_id: string;
  space_name: string | null;
  space_purpose: string | null;
};

export async function resolveRemoteAgentTurnEnvelope(input: {
  author: RemoteAgentWorkerAuthorContext;
  centerAgentProfileId: string;
  db: D1Database;
  message: OpenMeldDaemonDispatchQueueMessage;
  organizationId: string;
  webAppUrl?: string;
}): Promise<RemoteAgentTurnEnvelope> {
  const [centerAgent, organization, sender, space] = await Promise.all([
    readCenterAgentEnvelopeFacts({
      centerAgentProfileId: input.centerAgentProfileId,
      db: input.db,
    }),
    readOrganizationEnvelopeFacts({
      db: input.db,
      organizationId: input.organizationId,
      webAppUrl: input.webAppUrl,
    }),
    readSenderEnvelopeFacts({
      author: input.author,
      db: input.db,
      message: input.message,
      organizationId: input.organizationId,
    }),
    readSpaceEnvelopeFacts({
      centerAgentProfileId: input.centerAgentProfileId,
      db: input.db,
      message: input.message,
      organizationId: input.organizationId,
    }),
  ]);

  return buildRemoteAgentTurnEnvelope({
    centerAgent,
    centerAgentInteractionSource:
      input.message.sourceSignalSnapshot?.centerAgentInteractionSource,
    organization,
    sender,
    space,
  });
}

export async function resolveRemoteAgentRoutineTurnEnvelope(input: {
  authorizedActions?: CenterAgentRoutineAuthorizedAction[];
  centerAgentProfileId: string;
  createdByUserId: string;
  db: D1Database;
  delegatedMember: {
    displayName: string;
    memberId: string;
    userId: string;
  };
  externalActionPolicy: CenterAgentRoutineExternalActionPolicy;
  destination:
    | { kind: "space"; spaceId: string }
    | {
        channelId: string;
        conversationId: string;
        kind: "slack_thread";
        label: string | null;
        teamId: string;
        threadTs: string;
      };
  organizationId: string;
  routineId: string;
  routineName: string;
  runId: string;
  scheduledFor: number;
  webAppUrl?: string;
}): Promise<RemoteAgentTurnEnvelope> {
  const [centerAgent, organization] = await Promise.all([
    readCenterAgentEnvelopeFacts({
      centerAgentProfileId: input.centerAgentProfileId,
      db: input.db,
    }),
    readOrganizationEnvelopeFacts({
      db: input.db,
      organizationId: input.organizationId,
      webAppUrl: input.webAppUrl,
    }),
  ]);
  let space: SpaceEnvelopeFacts;
  if (input.destination.kind === "space") {
    const spaceRow = await input.db
      .prepare(
        `
          SELECT
            organization_id,
            space_name,
            space_purpose,
            direct_message_pair_key
          FROM space_index_spaces
          WHERE space_id = ?
            AND status = 'active'
          LIMIT 1
        `
      )
      .bind(input.destination.spaceId)
      .first<RoutineSpaceRow>();
    if (!spaceRow || spaceRow.organization_id !== input.organizationId) {
      throw new Error(
        `Remote Agent Routine envelope could not resolve target Space ${input.destination.spaceId}`
      );
    }
    const directMessageProjection =
      deriveCenterAgentDirectMessageSpaceProjection({
        centerAgentProfileId: input.centerAgentProfileId,
        directMessagePairKey: spaceRow.direct_message_pair_key,
        organizationId: input.organizationId,
        spaceId: input.destination.spaceId,
        spacePurpose: spaceRow.space_purpose,
      });
    space = {
      id: input.destination.spaceId,
      isCenterAgentDm: directMessageProjection !== null,
      kind:
        spaceRow.space_purpose === OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE
          ? "dm"
          : "space",
      name: normalizeOptionalText(spaceRow.space_name) ?? "this Space",
    };
  } else {
    space = {
      id: input.destination.conversationId,
      isCenterAgentDm: false,
      kind: "space",
      name: input.destination.label ?? "Slack thread",
    };
  }
  return parseCoreOwnedRemoteAgentTurnEnvelope({
    interactionEnvironment:
      input.destination.kind === "slack_thread"
        ? "externally_shared"
        : resolveSpaceInteractionEnvironment(space),
    sender: {
      kind: "routine",
      routineId: input.routineId,
      createdByUserId: input.createdByUserId,
      delegatedBy: {
        displayName: input.delegatedMember.displayName,
        id: input.delegatedMember.memberId,
        ownerUserId: input.delegatedMember.userId,
        verified: true,
      },
    },
    space,
    organization,
    centerAgent,
    trigger: {
      authorizedActions: input.authorizedActions ?? [],
      destination:
        input.destination.kind === "space"
          ? {
              kind: "space",
              spaceId: input.destination.spaceId,
            }
          : {
              channelId: input.destination.channelId,
              conversationId: input.destination.conversationId,
              kind: "slack_thread",
              label: input.destination.label ?? undefined,
              teamId: input.destination.teamId,
              threadTs: input.destination.threadTs,
            },
      source: "routine",
      externalActionPolicy: input.externalActionPolicy,
      routineId: input.routineId,
      runId: input.runId,
      scheduledFor: input.scheduledFor,
      routineName: input.routineName,
    },
  });
}

export async function resolveRemoteAgentMemberResearchTurnEnvelope(input: {
  centerAgentProfileId: string;
  db: D1Database;
  directMessageSpaceId: string;
  organizationId: string;
  requester: {
    displayName: string;
    memberId: string;
    profileId: string;
    role: string;
    userId: string;
  };
  subjectDisplayName: string;
  subjectUserId: string;
  taskId: string;
  webAppUrl?: string;
}): Promise<RemoteAgentTurnEnvelope> {
  const [centerAgent, organization, spaceRow] = await Promise.all([
    readCenterAgentEnvelopeFacts({
      centerAgentProfileId: input.centerAgentProfileId,
      db: input.db,
    }),
    readOrganizationEnvelopeFacts({
      db: input.db,
      organizationId: input.organizationId,
      webAppUrl: input.webAppUrl,
    }),
    input.db
      .prepare(
        `
          SELECT organization_id, space_name, space_purpose, direct_message_pair_key
          FROM space_index_spaces
          WHERE space_id = ?
            AND status = 'active'
          LIMIT 1
        `
      )
      .bind(input.directMessageSpaceId)
      .first<RoutineSpaceRow>(),
  ]);
  if (spaceRow?.organization_id !== input.organizationId) {
    throw new Error(
      `Remote Agent member research envelope could not resolve Center Agent DM ${input.directMessageSpaceId}`
    );
  }
  const directMessageProjection = deriveCenterAgentDirectMessageSpaceProjection(
    {
      centerAgentProfileId: input.centerAgentProfileId,
      directMessagePairKey: spaceRow.direct_message_pair_key,
      organizationId: input.organizationId,
      spaceId: input.directMessageSpaceId,
      spacePurpose: spaceRow.space_purpose,
    }
  );
  if (!directMessageProjection) {
    throw new Error(
      `Remote Agent member research target ${input.directMessageSpaceId} is not a Center Agent DM`
    );
  }
  return parseCoreOwnedRemoteAgentTurnEnvelope({
    interactionEnvironment: "requester_private",
    sender: {
      kind: "member",
      id: input.requester.memberId,
      displayName: input.requester.displayName,
      ownerUserId: input.requester.userId,
      profileId: input.requester.profileId,
      role: input.requester.role,
      verified: true,
    },
    space: {
      id: input.directMessageSpaceId,
      isCenterAgentDm: true,
      kind: "dm",
      name: normalizeOptionalText(spaceRow.space_name) ?? "Center Agent DM",
    },
    organization,
    centerAgent,
    trigger: {
      source: "member_research",
      subjectDisplayName: input.subjectDisplayName,
      subjectUserId: input.subjectUserId,
      taskId: input.taskId,
    },
  });
}

export async function resolveRemoteAgentTaskContinuationTurnEnvelope(input: {
  centerAgentProfileId: string;
  db: D1Database;
  delegation: AgentDelegationSnapshot;
  delegationId: string;
  externalSpace?: SpaceEnvelopeFacts;
  organizationId: string;
  outcome: AgentTaskTerminalOutcome;
  requesterProfileId: string;
  requesterUserId: string;
  spaceId: string;
  subscriptionId: string;
  watchedTask: AgentTaskHandle;
  webAppUrl?: string;
}): Promise<RemoteAgentTurnEnvelope> {
  return await resolveRemoteAgentContinuationTurnEnvelope({
    ...input,
    trigger: {
      delegation: input.delegation,
      delegationId: input.delegationId,
      outcome: input.outcome,
      source: "task_continuation",
      subscriptionId: input.subscriptionId,
      watchedTask: input.watchedTask,
    },
  });
}

export async function resolveRemoteAgentRoutineTaskContinuationTurnEnvelope(input: {
  centerAgentProfileId: string;
  db: D1Database;
  delegation: AgentDelegationSnapshot;
  delegationId: string;
  organizationId: string;
  originalEnvelope: RemoteAgentTurnEnvelope;
  outcome: AgentTaskTerminalOutcome;
  requesterProfileId: string;
  requesterUserId: string;
  subscriptionId: string;
  watchedTask: AgentTaskHandle;
  webAppUrl?: string;
}): Promise<RemoteAgentTurnEnvelope> {
  if (
    input.originalEnvelope.sender.kind !== "routine" ||
    input.originalEnvelope.trigger.source !== "routine" ||
    input.originalEnvelope.organization.id !== input.organizationId
  ) {
    throw new Error(
      "Remote Agent Routine continuation lost its original Routine envelope"
    );
  }
  const [centerAgent, organization, requester] = await Promise.all([
    readCenterAgentEnvelopeFacts({
      centerAgentProfileId: input.centerAgentProfileId,
      db: input.db,
    }),
    readOrganizationEnvelopeFacts({
      db: input.db,
      organizationId: input.organizationId,
      webAppUrl: input.webAppUrl,
    }),
    readActiveRepresentedHumanSender({
      db: input.db,
      organizationId: input.organizationId,
      profileId: input.requesterProfileId,
      userId: input.requesterUserId,
    }),
  ]);
  if (
    !requester?.member_id ||
    requester.owner_user_id !== input.originalEnvelope.sender.createdByUserId ||
    requester.owner_user_id !== input.requesterUserId
  ) {
    throw new Error(
      "Remote Agent Routine continuation requester is no longer an active Organization member"
    );
  }
  return parseCoreOwnedRemoteAgentTurnEnvelope({
    ...input.originalEnvelope,
    interactionEnvironment:
      input.originalEnvelope.interactionEnvironment ??
      (input.originalEnvelope.trigger.destination?.kind === "slack_thread"
        ? "externally_shared"
        : resolveSpaceInteractionEnvironment(input.originalEnvelope.space)),
    centerAgent,
    organization,
    sender: {
      ...input.originalEnvelope.sender,
      delegatedBy: {
        displayName: requester.profile_name,
        id: requester.member_id,
        ownerUserId: requester.owner_user_id,
        ...(requester.role ? { role: requester.role } : {}),
        verified: true,
      },
    },
    trigger: {
      ...input.originalEnvelope.trigger,
      continuation: {
        delegation: input.delegation,
        delegationId: input.delegationId,
        outcome: input.outcome,
        subscriptionId: input.subscriptionId,
        watchedTask: input.watchedTask,
      },
    },
  });
}

export async function resolveRemoteAgentTaskWatchContinuationTurnEnvelope(input: {
  centerAgentProfileId: string;
  db: D1Database;
  externalSpace?: SpaceEnvelopeFacts;
  organizationId: string;
  outcome: AgentTaskCompletionObservation;
  requesterProfileId: string;
  requesterUserId: string;
  spaceId: string;
  subscriptionId: string;
  watchedTask: AgentTaskHandle;
  watchId: string;
  webAppUrl?: string;
}): Promise<RemoteAgentTurnEnvelope> {
  return await resolveRemoteAgentContinuationTurnEnvelope({
    ...input,
    trigger: {
      outcome: input.outcome,
      source: "task_watch_continuation",
      subscriptionId: input.subscriptionId,
      watchedTask: input.watchedTask,
      watchId: input.watchId,
    },
  });
}

async function resolveRemoteAgentContinuationTurnEnvelope(input: {
  centerAgentProfileId: string;
  db: D1Database;
  externalSpace?: SpaceEnvelopeFacts;
  organizationId: string;
  requesterProfileId: string;
  requesterUserId: string;
  spaceId: string;
  trigger: Extract<
    RemoteAgentTurnEnvelope["trigger"],
    { source: "task_continuation" | "task_watch_continuation" }
  >;
  webAppUrl?: string;
}): Promise<RemoteAgentTurnEnvelope> {
  const [centerAgent, organization, requester, spaceRow] = await Promise.all([
    readCenterAgentEnvelopeFacts({
      centerAgentProfileId: input.centerAgentProfileId,
      db: input.db,
    }),
    readOrganizationEnvelopeFacts({
      db: input.db,
      organizationId: input.organizationId,
      webAppUrl: input.webAppUrl,
    }),
    readActiveRepresentedHumanSender({
      db: input.db,
      organizationId: input.organizationId,
      profileId: input.requesterProfileId,
      userId: input.requesterUserId,
    }),
    input.externalSpace
      ? Promise.resolve(null)
      : input.db
          .prepare(
            `
              SELECT organization_id, space_name, space_purpose, direct_message_pair_key
              FROM space_index_spaces
              WHERE space_id = ?
                AND status = 'active'
              LIMIT 1
            `
          )
          .bind(input.spaceId)
          .first<RoutineSpaceRow>(),
  ]);
  if (
    !requester?.member_id ||
    requester.owner_user_id !== input.requesterUserId ||
    requester.profile_id !== input.requesterProfileId
  ) {
    throw new Error(
      "Remote Agent continuation requester is no longer an active Organization member"
    );
  }
  const sender = {
    displayName: requester.profile_name,
    id: requester.member_id,
    kind: "member" as const,
    ownerUserId: requester.owner_user_id,
    profileId: requester.profile_id,
    ...(requester.role ? { role: requester.role } : {}),
    verified: true,
  };
  if (input.externalSpace) {
    if (
      input.externalSpace.id !== input.spaceId ||
      input.externalSpace.kind !== "space" ||
      input.externalSpace.isCenterAgentDm
    ) {
      throw new Error(
        "Remote Agent continuation lost its external conversation identity"
      );
    }
    return parseCoreOwnedRemoteAgentTurnEnvelope({
      centerAgent,
      interactionEnvironment: "externally_shared",
      organization,
      sender,
      space: input.externalSpace,
      trigger: input.trigger,
    });
  }
  if (spaceRow?.organization_id !== input.organizationId) {
    throw new Error(
      `Remote Agent continuation could not resolve target Space ${input.spaceId}`
    );
  }
  const directMessageProjection = deriveCenterAgentDirectMessageSpaceProjection(
    {
      centerAgentProfileId: input.centerAgentProfileId,
      directMessagePairKey: spaceRow.direct_message_pair_key,
      organizationId: input.organizationId,
      spaceId: input.spaceId,
      spacePurpose: spaceRow.space_purpose,
    }
  );
  const space: SpaceEnvelopeFacts = {
    id: input.spaceId,
    isCenterAgentDm: directMessageProjection !== null,
    kind:
      spaceRow.space_purpose === OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE
        ? "dm"
        : "space",
    name: normalizeOptionalText(spaceRow.space_name) ?? "this Space",
  };
  return parseCoreOwnedRemoteAgentTurnEnvelope({
    centerAgent,
    interactionEnvironment: resolveSpaceInteractionEnvironment(space),
    organization,
    sender,
    space,
    trigger: input.trigger,
  });
}

export async function readActiveRepresentedHumanSender(input: {
  db: D1Database;
  organizationId: string;
  profileId: string;
  userId: string;
}): Promise<SenderRow | null> {
  return await input.db
    .prepare(
      `
        SELECT
          m.id AS member_id,
          m.role,
          p.profile_id,
          p.profile_kind,
          p.profile_name,
          p.owner_user_id
        FROM members m
        INNER JOIN openmeld_profiles p
          ON p.owner_user_id = m.user_id
          AND p.profile_kind = 'human'
          AND p.status = 'active'
        WHERE m.organization_id = ?
          AND m.user_id = ?
          AND p.profile_id = ?
        LIMIT 1
      `
    )
    .bind(input.organizationId, input.userId, input.profileId)
    .first<SenderRow>();
}

export function buildRemoteAgentTurnEnvelope(
  input: RemoteAgentTurnEnvelopeFacts
): RemoteAgentTurnEnvelope {
  return parseCoreOwnedRemoteAgentTurnEnvelope({
    ...(input.centerAgentInteractionSource
      ? { centerAgentInteractionSource: input.centerAgentInteractionSource }
      : {}),
    interactionEnvironment: resolveSpaceInteractionEnvironment(input.space),
    sender: input.sender,
    space: input.space,
    organization: input.organization,
    centerAgent: input.centerAgent,
    trigger: {
      source: input.space.isCenterAgentDm ? "web_dm" : "space_wake",
    },
  });
}

function resolveSpaceInteractionEnvironment(
  space: SpaceEnvelopeFacts
): NonNullable<RemoteAgentTurnEnvelope["interactionEnvironment"]> {
  return space.kind === "dm" || space.isCenterAgentDm
    ? "requester_private"
    : "organization_shared";
}

async function readCenterAgentEnvelopeFacts(input: {
  centerAgentProfileId: string;
  db: D1Database;
}): Promise<CenterAgentProfileIdentity> {
  const identity = await readCenterAgentProfileIdentity({
    agentProfileId: input.centerAgentProfileId,
    db: input.db,
  });

  if (!identity) {
    throw new Error(
      `Remote Agent turn envelope could not resolve Center Agent profile ${input.centerAgentProfileId}`
    );
  }

  return identity;
}

async function readOrganizationEnvelopeFacts(input: {
  db: D1Database;
  organizationId: string;
  webAppUrl?: string;
}): Promise<OrganizationEnvelopeFacts> {
  const row = await input.db
    .prepare(
      `
        SELECT
          o.name,
          o.slug,
          o.metadata,
          COUNT(m.id) AS member_count
        FROM organizations o
        LEFT JOIN members m ON m.organization_id = o.id
        WHERE o.id = ?
        GROUP BY o.id
        LIMIT 1
      `
    )
    .bind(input.organizationId)
    .first<OrganizationRow>();

  if (!row) {
    throw new Error(
      `Remote Agent turn envelope could not resolve Organization ${input.organizationId}`
    );
  }

  const webAppUrl = normalizeOptionalText(input.webAppUrl);
  return {
    id: input.organizationId,
    memberCount: Math.max(0, Number(row.member_count ?? 0)),
    name: normalizeOptionalText(row.name) ?? "this organization",
    personal:
      row.slug.startsWith("personal-") ||
      hasPersonalOrganizationMetadata(row.metadata),
    ...(webAppUrl
      ? {
          webUrl: buildOpenMeldOrganizationWebUrl({
            organizationSlug: row.slug,
            webAppUrl,
          }),
        }
      : {}),
  };
}

async function readSenderEnvelopeFacts(input: {
  author: RemoteAgentWorkerAuthorContext;
  db: D1Database;
  message: OpenMeldDaemonDispatchQueueMessage;
  organizationId: string;
}): Promise<SenderEnvelopeFacts> {
  const sourceProfileId = normalizeOptionalText(
    input.message.sourceSignalSnapshot?.profileId
  );
  if (!sourceProfileId) {
    return {
      displayName:
        normalizeOptionalText(input.author.displayName) ?? "Unknown sender",
      id: input.message.sourceEventId,
      kind: input.author.profileKind === "agent" ? "agent_profile" : "member",
      verified: false,
    };
  }

  const row = await input.db
    .prepare(
      `
        SELECT
          p.profile_id,
          p.profile_name,
          p.profile_kind,
          p.owner_user_id,
          m.id AS member_id,
          m.role
        FROM openmeld_profiles p
        LEFT JOIN members m
          ON m.organization_id = ?
          AND m.user_id = p.owner_user_id
        WHERE p.profile_id = ?
        LIMIT 1
      `
    )
    .bind(input.organizationId, sourceProfileId)
    .first<SenderRow>();

  const sourceKind =
    row?.profile_kind ?? input.message.sourceSignalSnapshot?.profileKind;
  const kind = sourceKind === "agent" ? "agent_profile" : "member";
  const role = normalizeOptionalText(row?.role);
  return {
    displayName:
      normalizeOptionalText(row?.profile_name) ??
      normalizeOptionalText(input.message.sourceProfileNameSnapshot) ??
      normalizeOptionalText(input.author.displayName) ??
      "Unknown sender",
    id:
      kind === "member" ? (row?.member_id ?? sourceProfileId) : sourceProfileId,
    kind,
    ...(kind === "member" && row?.owner_user_id
      ? { ownerUserId: row.owner_user_id }
      : {}),
    ...(kind === "member" && row?.profile_id
      ? { profileId: row.profile_id }
      : {}),
    ...(kind === "member" && role ? { role } : {}),
    verified: kind === "member" ? Boolean(row?.member_id) : Boolean(row),
  };
}

async function readSpaceEnvelopeFacts(input: {
  centerAgentProfileId: string;
  db: D1Database;
  message: OpenMeldDaemonDispatchQueueMessage;
  organizationId: string;
}): Promise<SpaceEnvelopeFacts> {
  const candidate =
    await readCenterAgentDirectMessageProjectionCandidateBySpaceId({
      db: input.db,
      spaceId: input.message.spaceId,
    });
  const projection = candidate
    ? deriveCenterAgentDirectMessageSpaceProjection({
        centerAgentProfileId: input.centerAgentProfileId,
        directMessagePairKey: candidate.directMessagePairKey,
        organizationId: candidate.organizationId,
        spaceId: candidate.spaceId,
        spacePurpose: candidate.spacePurpose,
      })
    : null;

  return {
    id: input.message.spaceId,
    isCenterAgentDm: projection !== null,
    kind:
      candidate?.spacePurpose === OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE
        ? "dm"
        : "space",
    name:
      normalizeOptionalText(input.message.spaceNameSnapshot) ?? "this Space",
  };
}

export async function readDesignatedCenterAgentProfileId(input: {
  db: D1Database;
  organizationId: string;
}): Promise<string | null> {
  const designation = await readCenterAgentDesignationRecord({
    db: input.db,
    organizationId: input.organizationId,
  });
  return designation?.agentProfileId ?? null;
}

function hasPersonalOrganizationMetadata(metadata: string | null): boolean {
  const normalized = normalizeOptionalText(metadata);
  if (!normalized) {
    return false;
  }
  try {
    const parsed = JSON.parse(normalized) as { personal?: unknown };
    return parsed.personal === true || parsed.personal === 1;
  } catch {
    return false;
  }
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
