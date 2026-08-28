import { REMOTE_AGENT_TURN_ENVELOPE_MEMORY_ITEM_TEXT_MAX_CHARS } from "@openmeld/schemas";
import type {
  MessageChannelProvider,
  RemoteAgentTurnEnvelope,
  RemoteAgentTurnEnvelopeMemory,
} from "@openmeld/schemas/types";

export const CENTER_AGENT_MEMORY_PROVIDER = "zep_cloud" as const;
export const CENTER_AGENT_ORGANIZATION_MEMORY_DEFAULT_ENABLED = true;
export const CENTER_AGENT_MEMORY_RECALL_TIMEOUT_MS = 3000;
export const CENTER_AGENT_MEMORY_WRITE_TIMEOUT_MS = 5000;
export const CENTER_AGENT_MEMORY_SEARCH_QUERY_MAX_CHARS = 400;
export const CENTER_AGENT_MEMORY_MAX_ITEMS = 6;
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
export type CenterAgentMemorySubjectKind = "member" | "organization";

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
  | CenterAgentMemoryOrganizationSubject;

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
};

export type CenterAgentMemoryAdapter = {
  addEpisode(input: {
    episode: CenterAgentMemoryEpisode;
    ref: CenterAgentMemoryRef;
  }): Promise<void>;
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

export type CenterAgentMemoryRepository = {
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
};

export type RecallCenterAgentMemoryForTurnInput = {
  organizationId: string;
  query: string;
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
