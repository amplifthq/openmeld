import {
  CENTER_AGENT_RETAINED_MEMORY_MAX_ITEMS,
  CENTER_AGENT_RETAINED_MEMORY_QUERY_MAX_CHARS,
  REMOTE_AGENT_TURN_ENVELOPE_MEMORY_ITEM_TEXT_MAX_CHARS,
} from "@openmeld/schemas";
import type {
  CenterAgentContextManifestEntry,
  MessageChannelProvider,
  RemoteAgentTurnEnvelope,
  RemoteAgentTurnEnvelopeMemory,
} from "@openmeld/schemas/types";

export const CENTER_AGENT_MEMORY_PROVIDER = "zep_cloud" as const;
export const CENTER_AGENT_ORGANIZATION_MEMORY_DEFAULT_ENABLED = true;
export const CENTER_AGENT_MEMORY_RECALL_TIMEOUT_MS = 3000;
export const CENTER_AGENT_MEMORY_WRITE_TIMEOUT_MS = 5000;
export const CENTER_AGENT_MEMORY_SEARCH_QUERY_MAX_CHARS =
  CENTER_AGENT_RETAINED_MEMORY_QUERY_MAX_CHARS;
export const CENTER_AGENT_MEMORY_MAX_ITEMS =
  CENTER_AGENT_RETAINED_MEMORY_MAX_ITEMS;
export const CENTER_AGENT_MEMORY_MAX_ITEM_TEXT_CHARS =
  REMOTE_AGENT_TURN_ENVELOPE_MEMORY_ITEM_TEXT_MAX_CHARS;
export const CENTER_AGENT_MEMORY_MAX_ENVELOPE_TEXT_CHARS = 1600;

export type CenterAgentMemoryProvider = typeof CENTER_AGENT_MEMORY_PROVIDER;
export type CenterAgentMemorySource =
  | "ca_dm"
  | "explicit_tool"
  | "message_channel_conversation"
  | "slack_conversation"
  | "space_conversation";
export type CenterAgentMemoryCaptureMethod = "automatic_turn" | "explicit_save";
export type CenterAgentMemorySubjectKind = "member" | "organization" | "space";

export type CenterAgentMemoryPolicy = {
  organizationMemoryOptIn: boolean;
  updatedByUserId: string | null;
};

export type CenterAgentMemoryMemberSubject = {
  kind: "member";
  memberId: string;
  organizationId: string;
  userId: string;
};

export type CenterAgentMemoryOrganizationSubject = {
  kind: "organization";
  organizationId: string;
};

export type CenterAgentMemorySubject =
  | CenterAgentMemoryMemberSubject
  | CenterAgentMemoryOrganizationSubject
  | { kind: "space"; organizationId: string; spaceId: string };

export type CenterAgentMemoryRef = {
  provider: CenterAgentMemoryProvider;
  subject: CenterAgentMemorySubject;
  subjectId: string;
  zepGraphId?: string;
  zepUserId?: string;
};

export type CenterAgentMemoryEpisode = {
  assistantMessage: string;
  captureMethod: CenterAgentMemoryCaptureMethod;
  messageChannelProvider?: MessageChannelProvider;
  occurredAtMs: number;
  source: CenterAgentMemorySource;
  sourceConversationId: string;
  sourceMessageId: string;
  userMessage: string;
  sourceVersion?: string;
  sourceAuthorKind?: "human" | "agent" | "system";
};

export type CenterAgentMemorySearchResult = {
  captureMethod: CenterAgentMemoryCaptureMethod;
  messageChannelProvider?: MessageChannelProvider;
  occurredAtMs: number;
  source: CenterAgentMemorySource;
  sourceConversationId: string;
  sourceMessageId: string;
  subject: CenterAgentMemorySubjectKind;
  text: string;
  sourceVersion?: string;
  sourceAuthorKind?: "human" | "agent" | "system";
  supportingSources?: (CenterAgentMemoryEpisodeOrigin & {
    captureMethod: CenterAgentMemoryCaptureMethod;
  })[];
  validity?: { invalidAtMs?: number; expiredAtMs?: number };
  representation?: "source_message";
  sourceSpeakers?: CenterAgentContextManifestEntry["author"][];
};

export type CenterAgentMemoryDetailedSearchItem = {
  text: string;
  subject: CenterAgentMemorySubjectKind;
  sources: Omit<CenterAgentMemorySearchResult, "text" | "subject">[];
};

export type CenterAgentMemoryDetailedReader = {
  searchDetailed(input: {
    limit: number;
    query: string;
    ref: CenterAgentMemoryRef;
  }): Promise<{
    items: CenterAgentMemoryDetailedSearchItem[];
    status: "complete" | "partial";
  }>;
};

export type CenterAgentMemoryReadRepository = {
  readActiveSubjects(input: {
    organizationId: string;
    speakerMember?: { memberId: string; userId: string };
    spaceId?: string;
  }): Promise<(CenterAgentMemoryRef & { updatedAtMs: number })[]>;
};

export type CenterAgentMemoryAdapter = {
  addEpisode(input: {
    episode: CenterAgentMemoryEpisode;
    ref: CenterAgentMemoryRef;
  }): Promise<{ episodeId: string; processed: boolean }>;
  deleteMemberUser(ref: CenterAgentMemoryRef): Promise<"deleted" | "not_found">;
  deleteOrganizationGraph(
    ref: CenterAgentMemoryRef
  ): Promise<"deleted" | "not_found">;
  ensureMemberUser(ref: CenterAgentMemoryRef): Promise<void>;
  ensureOrganizationGraph(ref: CenterAgentMemoryRef): Promise<void>;
  search(input: {
    limit: number;
    query: string;
    ref: CenterAgentMemoryRef;
  }): Promise<CenterAgentMemorySearchResult[]>;
};

export type CenterAgentMemoryRepository = CenterAgentMemoryReadRepository & {
  upsertSpaceSubject(input: {
    organizationId: string;
    spaceId: string;
    nowMs: number;
  }): Promise<CenterAgentMemoryRef>;
  beginSpaceDeletion(input: {
    organizationId: string;
    spaceId: string;
    nowMs: number;
  }): Promise<void>;
  isSpaceSubjectActive(input: {
    organizationId: string;
    spaceId: string;
  }): Promise<boolean>;
  markSpaceDeleted(input: {
    organizationId: string;
    spaceId: string;
    deletedAtMs: number;
  }): Promise<boolean>;
  markSpaceDeleteFailed(input: {
    organizationId: string;
    spaceId: string;
    nowMs: number;
    error: string;
  }): Promise<void>;
  markMemberDeleted(input: {
    deletedAtMs: number;
    organizationId: string;
    userId: string;
  }): Promise<boolean>;
  markMemberDeleteFailed(input: {
    error: string;
    nowMs: number;
    organizationId: string;
    userId: string;
  }): Promise<void>;
  markOrganizationDeleted(input: {
    deletedAtMs: number;
    organizationId: string;
  }): Promise<boolean>;
  markOrganizationDeleteFailed(input: {
    error: string;
    nowMs: number;
    organizationId: string;
  }): Promise<void>;
  readPolicy(organizationId: string): Promise<CenterAgentMemoryPolicy>;
  upsertPolicy(input: {
    nowMs: number;
    organizationId: string;
    organizationMemoryOptIn: boolean;
    updatedByUserId: string;
  }): Promise<CenterAgentMemoryPolicy>;
  upsertMemberSubject(input: {
    memberId: string;
    nowMs: number;
    organizationId: string;
    userId: string;
  }): Promise<CenterAgentMemoryRef>;
  upsertOrganizationSubject(input: {
    nowMs: number;
    organizationId: string;
  }): Promise<CenterAgentMemoryRef>;
};

export type CenterAgentMemoryNativeDeliveryLedger = {
  clearTriggerTextForMember(input: {
    organizationId: string;
    userId: string;
  }): Promise<void>;
  clearTriggerTextForOrganization(input: {
    organizationId: string;
  }): Promise<void>;
};

export type CenterAgentMemoryLogger = Pick<Console, "warn">;

export type RememberCenterAgentTurnInput = {
  assistantMessage: string;
  interactionEnvironment: NonNullable<
    RemoteAgentTurnEnvelope["interactionEnvironment"]
  >;
  messageChannelProvider?: MessageChannelProvider;
  occurredAtMs: number;
  organizationId: string;
  source: CenterAgentMemorySource;
  sourceConversationId: string;
  sourceMessageId: string;
  speakerMember: {
    memberId: string;
    userId: string;
  };
  userMessage: string;
};

export type CenterAgentMemoryEpisodeOrigin = {
  messageChannelProvider?: MessageChannelProvider;
  occurredAtMs: number;
  source: CenterAgentMemorySource;
  sourceConversationId: string;
  sourceMessageId: string;
  sourceVersion?: string;
  sourceAuthorKind?: "human" | "agent" | "system";
};

export type RecallCenterAgentMemoryForTurnInput = {
  organizationId: string;
  query: string;
  spaceId?: string;
  speakerMember: {
    memberId: string;
    userId: string;
  };
};

export type RecallCenterAgentOrganizationMemoryInput = {
  organizationId: string;
  query: string;
};

export type RecallCenterAgentMemoryForTurnResult =
  RemoteAgentTurnEnvelopeMemory;

export function buildCenterAgentMemberMemoryRef(input: {
  memberId: string;
  organizationId: string;
  userId: string;
}): CenterAgentMemoryRef {
  const zepUserId = `org:${input.organizationId}:member:${input.userId}`;
  return {
    provider: CENTER_AGENT_MEMORY_PROVIDER,
    subject: {
      kind: "member",
      memberId: input.memberId,
      organizationId: input.organizationId,
      userId: input.userId,
    },
    subjectId: zepUserId,
    zepUserId,
  };
}

export function buildCenterAgentOrganizationMemoryRef(input: {
  organizationId: string;
}): CenterAgentMemoryRef {
  const zepGraphId = `org:${input.organizationId}:center-agent`;
  return {
    provider: CENTER_AGENT_MEMORY_PROVIDER,
    subject: {
      kind: "organization",
      organizationId: input.organizationId,
    },
    subjectId: zepGraphId,
    zepGraphId,
  };
}

export function buildCenterAgentSpaceMemoryRef(input: {
  organizationId: string;
  spaceId: string;
}): CenterAgentMemoryRef {
  const zepGraphId = `org:${input.organizationId}:space:${input.spaceId}:center-agent`;
  return {
    provider: "zep_cloud",
    subject: {
      kind: "space",
      organizationId: input.organizationId,
      spaceId: input.spaceId,
    },
    subjectId: zepGraphId,
    zepGraphId,
  };
}

export type CenterAgentMemorySpaceAccess = {
  canRead(input: {
    organizationId: string;
    spaceId: string;
    speakerMember: { memberId: string; userId: string };
  }): Promise<boolean>;
  readSource(input: {
    organizationId: string;
    spaceId: string;
    signalId: string;
    speakerMember: { memberId: string; userId: string };
  }): Promise<{
    text: string;
    version: string;
    occurredAtMs: number;
    author: CenterAgentContextManifestEntry["author"];
  } | null>;
};
