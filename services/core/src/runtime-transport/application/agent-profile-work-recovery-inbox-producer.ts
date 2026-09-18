import {
  INBOX_CONTEXT_LABEL_MAX_CHARS,
  INBOX_TITLE_MAX_CHARS,
} from "@openmeld/schemas";
import {
  ensureInboxItem,
  resolveInboxItemsBySource,
} from "../../inbox/application/inbox-item-service";
import { truncateInboxText } from "../../inbox/application/inbox-text";

const AGENT_PROFILE_WORK_RECOVERY_SOURCE_KIND =
  "agent_profile_work_recovery" as const;

export type AgentProfileWorkRecoveryInboxStage =
  | "approve_queued_work"
  | "resolve_occupied_conversation"
  | "review_interrupted_work";

type AgentProfileWorkRecoveryInboxIdentity = {
  interruptedClientMessageId: string;
  profileId: string;
  stage: AgentProfileWorkRecoveryInboxStage;
};

export async function projectAgentProfileWorkRecoveryInboxItem(
  input: AgentProfileWorkRecoveryInboxIdentity & {
    db: D1Database;
    nowMs: number;
    occurredAtMs: number;
    organizationId: string;
    ownerUserId: string;
    profileName: string;
    sourceTarget?:
      | { kind: "agent_profile"; profileId: string }
      | { kind: "space"; signalId: string; spaceId: string };
  }
): Promise<{ deliveryId: string | null; itemId: string }> {
  const profileName = requireText(input.profileName, "profileName");
  const presentation = resolveRecoveryPresentation({
    profileName,
    stage: input.stage,
  });
  return await ensureInboxItem({
    candidate: {
      attention: "action_required",
      contextLabel: truncateInboxText(
        profileName,
        INBOX_CONTEXT_LABEL_MAX_CHARS
      ),
      importance: "urgent",
      kind: "system_issue",
      occurredAtMs: input.occurredAtMs,
      organizationId: input.organizationId,
      preview: presentation.preview,
      recipientUserId: input.ownerUserId,
      sourceKey: await buildAgentProfileWorkRecoveryInboxSourceKey(input),
      sourceKind: AGENT_PROFILE_WORK_RECOVERY_SOURCE_KIND,
      sourceFacts: {
        version: 1,
        recipientReasons: ["requester"],
        agentProfileIds: [input.profileId],
        requestCategory:
          input.stage === "approve_queued_work" ? "review" : "action",
      },
      sourceTarget: input.sourceTarget ?? {
        kind: "agent_profile",
        profileId: input.profileId,
      },
      title: truncateInboxText(presentation.title, INBOX_TITLE_MAX_CHARS),
    },
    db: input.db,
    nowMs: input.nowMs,
  });
}

export async function resolveAgentProfileWorkRecoveryInboxItem(
  input: AgentProfileWorkRecoveryInboxIdentity & {
    db: D1Database;
    organizationId: string;
    resolvedAtMs: number;
  }
): Promise<number> {
  return await resolveInboxItemsBySource({
    db: input.db,
    organizationId: input.organizationId,
    resolvedAtMs: input.resolvedAtMs,
    sourceKey: await buildAgentProfileWorkRecoveryInboxSourceKey(input),
    sourceKind: AGENT_PROFILE_WORK_RECOVERY_SOURCE_KIND,
  });
}

export async function buildAgentProfileWorkRecoveryInboxSourceKey(
  input: AgentProfileWorkRecoveryInboxIdentity
): Promise<string> {
  const identity = [
    "agent_profile_work_recovery_v1",
    requireText(input.profileId, "profileId"),
    requireText(input.interruptedClientMessageId, "interruptedClientMessageId"),
    requireRecoveryStage(input.stage),
  ];
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(identity))
  );
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return `agent_profile_work_recovery_${hex}`;
}

function resolveRecoveryPresentation(input: {
  profileName: string;
  stage: AgentProfileWorkRecoveryInboxStage;
}): { preview: string; title: string } {
  switch (input.stage) {
    case "approve_queued_work":
      return {
        preview:
          "The interrupted task finished. Approve the queued work before it starts.",
        title: `Start queued work for ${input.profileName}`,
      };
    case "resolve_occupied_conversation":
      return {
        preview:
          "Another app is using this conversation. Continue on a new branch of it, or skip the work. Queued work waits until you choose.",
        title: `Choose how to continue work for ${input.profileName}`,
      };
    case "review_interrupted_work":
      return {
        preview:
          "Open the interrupted Wake to review the failure. Queued work will wait until you skip it.",
        title: `Review interrupted work for ${input.profileName}`,
      };
    default:
      return assertNeverRecoveryStage(input.stage);
  }
}

export function isAgentProfileWorkRecoveryInboxStage(
  value: unknown
): value is AgentProfileWorkRecoveryInboxStage {
  return (
    value === "approve_queued_work" ||
    value === "resolve_occupied_conversation" ||
    value === "review_interrupted_work"
  );
}

function requireRecoveryStage(
  stage: AgentProfileWorkRecoveryInboxStage
): AgentProfileWorkRecoveryInboxStage {
  switch (stage) {
    case "approve_queued_work":
    case "resolve_occupied_conversation":
    case "review_interrupted_work":
      return stage;
    default:
      return assertNeverRecoveryStage(stage);
  }
}

function requireText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new TypeError(`${field} is required`);
  }
  return normalized;
}

function assertNeverRecoveryStage(value: never): never {
  throw new TypeError(
    `Unsupported Agent Profile work recovery stage: ${String(value)}`
  );
}
