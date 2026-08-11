import type {
  RemoteAgentTurnEnvelope,
  RemoteAgentWorkerSubmitTurnRequest,
} from "@openmeld/schemas/types";
import { type CoreBindings, wakeEvidenceDb } from "../lib/bindings";
import type { CenterAgentMemoryEpisodeOrigin } from "./contract";

export function resolveExplicitMemorySourceDeliveryDb(
  env: Pick<CoreBindings, "OPENMELD_DB" | "OPENMELD_WAKE_EVIDENCE_DB">
): D1Database | undefined {
  return wakeEvidenceDb(env);
}

export function resolveExplicitMemorySourceTurnRequest(input: {
  executionRecoverySubmitRequest: RemoteAgentWorkerSubmitTurnRequest | null;
  workerSubmitRequest: RemoteAgentWorkerSubmitTurnRequest | null;
  workerSubmitRequestState: "absent" | "invalid" | "valid";
}): RemoteAgentWorkerSubmitTurnRequest {
  if (input.executionRecoverySubmitRequest) {
    return input.executionRecoverySubmitRequest;
  }
  if (input.workerSubmitRequestState === "valid" && input.workerSubmitRequest) {
    return input.workerSubmitRequest;
  }
  throw new Error("Remote Agent source delivery request is unavailable");
}

export function resolveExplicitMemoryEpisodeOrigin(input: {
  createdAtMs: number;
  expectedOrganizationId: string;
  expectedProfileId: string;
  organizationId: string;
  profileId: string;
  sourceMessageId: string;
  turnEnvelope: RemoteAgentTurnEnvelope;
}): CenterAgentMemoryEpisodeOrigin {
  if (
    input.organizationId !== input.expectedOrganizationId ||
    input.turnEnvelope.organization.id !== input.expectedOrganizationId
  ) {
    throw new Error(
      "Explicit memory source organization identity does not match the authorized Organization"
    );
  }
  if (input.profileId !== input.expectedProfileId) {
    throw new Error(
      "Explicit memory source profile identity does not match the designated Center Agent"
    );
  }

  const base = {
    occurredAtMs: requireDateTimestamp(input.createdAtMs),
    sourceConversationId: input.turnEnvelope.space.id,
    sourceMessageId: requireNonEmptyText(
      input.sourceMessageId,
      "Explicit memory source message identity is unavailable"
    ),
  };
  const trigger = input.turnEnvelope.trigger;
  switch (trigger.source) {
    case "message_channel":
      return {
        ...base,
        messageChannelProvider: trigger.provider,
        source: "message_channel_conversation",
        sourceConversationId: trigger.conversationId,
      };
    case "slack":
      return {
        ...base,
        source: "slack_conversation",
        sourceConversationId:
          trigger.conversationId ?? base.sourceConversationId,
      };
    case "space_wake":
      return {
        ...base,
        source: input.turnEnvelope.space.isCenterAgentDm
          ? "ca_dm"
          : "space_conversation",
      };
    case "web_dm":
      if (!input.turnEnvelope.space.isCenterAgentDm) {
        throw new Error(
          "Explicit memory Web DM source is not a Center Agent Direct Message"
        );
      }
      return { ...base, source: "ca_dm" };
    default:
      throw new Error(
        `Explicit memory trigger ${trigger.source} does not preserve an original conversation source`
      );
  }
}

function requireDateTimestamp(value: number): number {
  if (!(Number.isSafeInteger(value) && value >= 0)) {
    throw new Error("Explicit memory source occurrence time is invalid");
  }
  if (!Number.isFinite(new Date(value).getTime())) {
    throw new Error("Explicit memory source occurrence time is out of range");
  }
  return value;
}

function requireNonEmptyText(value: string, message: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(message);
  }
  return normalized;
}
