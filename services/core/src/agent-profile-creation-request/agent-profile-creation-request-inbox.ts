import type { AgentProfileCreationRequest } from "@openmeld/schemas/types";
import {
  ensureInboxItem,
  resolveInboxItemsBySource,
} from "../inbox/application/inbox-item-service";

const INBOX_SOURCE_KIND = "system_attention_event" as const;

export async function projectAgentProfileCreationRequestInbox(input: {
  db: D1Database;
  nowMs: number;
  request: AgentProfileCreationRequest;
}): Promise<void> {
  if (input.request.status !== "pending") {
    return;
  }
  await ensureInboxItem({
    candidate: {
      attention: "action_required",
      contextLabel: "Agent Profile request",
      importance: "normal",
      kind: "agent_interaction",
      occurredAtMs: Date.parse(input.request.createdAt),
      organizationId: input.request.organizationId,
      preview: buildRequestPreview(input.request),
      recipientUserId: input.request.targetOwnerUserId,
      sourceKey: input.request.id,
      sourceKind: INBOX_SOURCE_KIND,
      sourceTarget: {
        kind: "agent_profile_creation_request",
        requestId: input.request.id,
      },
      title: `Create “${input.request.profileName}” for you?`,
    },
    db: input.db,
    nowMs: input.nowMs,
  });
}

export async function resolveAgentProfileCreationRequestInbox(input: {
  db: D1Database;
  nowMs: number;
  request: AgentProfileCreationRequest;
}): Promise<void> {
  await resolveInboxItemsBySource({
    db: input.db,
    organizationId: input.request.organizationId,
    resolvedAtMs: input.nowMs,
    sourceKey: input.request.id,
    sourceKind: INBOX_SOURCE_KIND,
  });
}

function buildRequestPreview(request: AgentProfileCreationRequest): string {
  switch (request.sessionStrategy) {
    case "new":
      return "Review a request to create an Agent Profile with a new local session.";
    case "resume":
      return "Review a request to create an Agent Profile by resuming one of your local sessions.";
    case "fork":
      return "Review a request to create an Agent Profile by forking one of your local sessions.";
    default:
      return "Review this Agent Profile creation request.";
  }
}
