import type { PostgresDatabase } from "@openmeld/db/postgresql";
import {
  INBOX_CONTEXT_LABEL_MAX_CHARS,
  INBOX_PREVIEW_MAX_CHARS,
  INBOX_TITLE_MAX_CHARS,
} from "@openmeld/schemas";
import type { InboxSourceCandidate } from "@openmeld/schemas/types";
import {
  ensureInboxItem,
  resolveInboxItemsBySource,
} from "../../inbox/application/inbox-item-service";
import { truncateInboxText } from "../../inbox/application/inbox-text";
import type {
  AgentAccessRequestNames,
  AgentAccessRequestRecord,
} from "../infrastructure/postgresql/agent-access-repo";

const SOURCE_KIND = "agent_access_request" as const;

export function buildAgentAccessInboxSourceKey(requestId: string): string {
  return `agent-access:${requestId}`;
}

/**
 * The owner's urgent Inbox item for one request (developing/product/inbox.md,
 * Agent owner requests). The copy is fixed: names only, never the message
 * text, so the urgent email cannot leak it.
 */
export function buildAgentAccessInboxCandidate(input: {
  names: AgentAccessRequestNames;
  request: AgentAccessRequestRecord;
}): InboxSourceCandidate {
  const { names, request } = input;
  const copy = resolveAgentAccessInboxCopy({ names, request });
  return {
    attention: "action_required",
    contextLabel: truncateInboxText(
      names.agentProfileName,
      INBOX_CONTEXT_LABEL_MAX_CHARS
    ),
    importance: "urgent",
    kind:
      request.kind === "space_join"
        ? "agent_space_request"
        : "agent_access_request",
    occurredAtMs: request.createdAtMs,
    organizationId: request.organizationId,
    preview: truncateInboxText(copy.preview, INBOX_PREVIEW_MAX_CHARS),
    recipientUserId: request.ownerUserId,
    sourceFacts: {
      version: 1,
      agentProfileIds: [request.agentProfileId],
      personalAgentProfileIds: [request.agentProfileId],
      recipientReasons: ["agent_owner"],
      requestCategory: "action",
    },
    sourceKey: buildAgentAccessInboxSourceKey(request.id),
    sourceKind: SOURCE_KIND,
    sourceTarget: { kind: "agent_access_request", requestId: request.id },
    title: truncateInboxText(copy.title, INBOX_TITLE_MAX_CHARS),
  };
}

function resolveAgentAccessInboxCopy(input: {
  names: AgentAccessRequestNames;
  request: AgentAccessRequestRecord;
}): { title: string; preview: string } {
  const { agentProfileName, requesterName } = input.names;
  switch (input.request.kind) {
    case "direct_message":
      return {
        title: `${requesterName} wants to use ${agentProfileName}`,
        preview: `${requesterName} sent ${agentProfileName} a Direct Message. Allow once, always allow ${requesterName}, or decline. Nothing runs until you choose.`,
      };
    case "external_message":
      return {
        title: `${requesterName} wants to use ${agentProfileName}`,
        preview: `${requesterName} is outside your organization and asked ${agentProfileName} to work. Allow once or decline. Nothing runs until you choose.`,
      };
    case "space_join":
      return {
        title: `${requesterName} wants ${agentProfileName} in a Space`,
        preview: `${requesterName} asked to add ${agentProfileName} to a Space it isn't in. Add it or don't add it. It won't join or run until you choose.`,
      };
    default:
      throw new Error("Unknown Agent access request kind");
  }
}

export async function projectAgentAccessRequestInboxItem(input: {
  db: PostgresDatabase;
  names: AgentAccessRequestNames;
  nowMs: number;
  request: AgentAccessRequestRecord;
}): Promise<void> {
  if (input.request.status !== "pending") {
    return;
  }
  await ensureInboxItem({
    candidate: buildAgentAccessInboxCandidate(input),
    db: input.db,
    nowMs: input.nowMs,
  });
}

/** Any terminal transition closes the item everywhere. */
export async function resolveAgentAccessRequestInboxItem(input: {
  db: PostgresDatabase;
  nowMs: number;
  request: Pick<AgentAccessRequestRecord, "id" | "organizationId">;
}): Promise<void> {
  await resolveInboxItemsBySource({
    db: input.db,
    organizationId: input.request.organizationId,
    resolvedAtMs: input.nowMs,
    sourceKey: buildAgentAccessInboxSourceKey(input.request.id),
    sourceKind: SOURCE_KIND,
  });
}
