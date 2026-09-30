import type { AgentTaskTerminalOutcome } from "@openmeld/schemas/types";
import {
  ensureInboxItem,
  resolveInboxItemsBySource,
} from "../../inbox/application/inbox-item-service";
import {
  readInboxItemBySource,
  replaceInboxSourceTargetsIfCurrent,
} from "../../inbox/infrastructure/d1/inbox-item-repo";
import type { RemoteAgentNativeDeliveryRecord } from "../infrastructure/d1/native-delivery-ledger-repo";
import type { SlackInboxSourceTarget } from "./slack-inbox-source-target";

type SlackTerminalStatus = AgentTaskTerminalOutcome["status"];

export async function projectTaskContinuationAdmissionExhaustedInboxItem(input: {
  attempts: number;
  db: D1Database;
  delivery: RemoteAgentNativeDeliveryRecord;
  occurredAtMs: number;
}): Promise<void> {
  const recipientUserId = input.delivery.onBehalfOfUserId?.trim() ?? "";
  const trigger = input.delivery.workerSubmitRequest?.turnEnvelope.trigger;
  if (
    input.delivery.conversationKind !== "space" ||
    input.delivery.routineRunId ||
    !recipientUserId ||
    (trigger?.source !== "task_continuation" &&
      trigger?.source !== "task_watch_continuation")
  ) {
    return;
  }
  const resultSignalId =
    "publishedSignalId" in trigger.outcome
      ? trigger.outcome.publishedSignalId?.trim()
      : null;
  await ensureInboxItem({
    candidate: {
      attention: "action_required",
      contextLabel: "Center Agent",
      importance: "urgent",
      kind: "system_issue",
      occurredAtMs: input.occurredAtMs,
      organizationId: input.delivery.organizationId,
      preview: `OpenMeld made ${input.attempts} startup attempts. Open the linked original result in its Space thread and retry from there.`,
      recipientUserId,
      sourceFacts: {
        recipientReasons: ["requester"],
        requestCategory: "action",
        version: 1,
      },
      sourceKey: `${input.delivery.deliveryId}:admission_retry_exhausted`,
      sourceKind: "remote_agent_native_delivery",
      sourceTarget: {
        kind: "space",
        signalId: resultSignalId || input.delivery.triggerMessageId,
        spaceId: input.delivery.spaceId,
        ...(input.delivery.threadContext?.rootSignalId
          ? {
              threadRootSignalId: input.delivery.threadContext.rootSignalId,
            }
          : {}),
      },
      title: "Center Agent could not continue a task",
    },
    db: input.db,
    nowMs: input.occurredAtMs,
  });
}

export async function projectLinkedSlackNativeDeliveryInboxItem(input: {
  db: D1Database;
  delivery: {
    conversationKind: string;
    deliveryId: string;
    onBehalfOfUserId: string | null;
    organizationId: string;
  };
  occurredAtMs: number;
  sourceTarget: SlackInboxSourceTarget;
  status: SlackTerminalStatus;
}): Promise<void> {
  const recipientUserId = input.delivery.onBehalfOfUserId?.trim() ?? "";
  if (input.delivery.conversationKind !== "slack" || !recipientUserId) {
    return;
  }
  const source = {
    organizationId: input.delivery.organizationId,
    recipientUserId,
    sourceKind: "remote_agent_native_delivery" as const,
  };
  const presentation = resolveSlackTerminalPresentation(input.status);
  const unknownSourceKey = buildSlackNativeDeliveryInboxSourceKey(
    input.delivery.deliveryId,
    "publication_unknown"
  );
  const terminalSourceKey = buildSlackNativeDeliveryInboxSourceKey(
    input.delivery.deliveryId,
    "terminal"
  );
  await replaceInboxSourceTargetsIfCurrent({
    currentSourceTarget: { kind: "center_agent" },
    db: input.db,
    nextSourceTarget: input.sourceTarget,
    organizationId: source.organizationId,
    recipientUserId,
    sourceKeys: [unknownSourceKey, terminalSourceKey],
    sourceKind: source.sourceKind,
    updatedAtMs: input.occurredAtMs,
  });
  if (presentation.attention === "action_required") {
    const terminal = await readInboxItemBySource({
      db: input.db,
      ...source,
      sourceKey: terminalSourceKey,
    });
    if (terminal) {
      // A delayed outcome-unknown replay cannot supersede confirmed terminal
      // delivery truth.
      return;
    }
  } else {
    await resolveInboxItemsBySource({
      db: input.db,
      organizationId: source.organizationId,
      resolvedAtMs: input.occurredAtMs,
      sourceKey: unknownSourceKey,
      sourceKind: source.sourceKind,
    });
  }
  await ensureInboxItem({
    candidate: {
      attention: presentation.attention,
      contextLabel: "Center Agent · Slack",
      importance: "normal",
      kind: "center_agent_update",
      occurredAtMs: input.occurredAtMs,
      organizationId: source.organizationId,
      preview: presentation.preview,
      recipientUserId,
      sourceKey:
        presentation.attention === "action_required"
          ? unknownSourceKey
          : terminalSourceKey,
      sourceKind: source.sourceKind,
      sourceTarget: input.sourceTarget,
      title: presentation.title,
    },
    db: input.db,
    nowMs: input.occurredAtMs,
  });
}

export function buildSlackNativeDeliveryInboxSourceKey(
  deliveryId: string,
  event: "publication_unknown" | "terminal"
): string {
  return `${deliveryId}:${event}`;
}

function resolveSlackTerminalPresentation(status: SlackTerminalStatus): {
  attention: "action_required" | "update";
  preview: string;
  title: string;
} {
  switch (status) {
    case "succeeded":
      return {
        attention: "update",
        preview: "The Center Agent posted a reply in Slack.",
        title: "Center Agent replied in Slack",
      };
    case "stopped":
      return {
        attention: "update",
        preview: "The Center Agent request was stopped before it finished.",
        title: "Center Agent stopped in Slack",
      };
    case "publication_failed":
      return {
        attention: "action_required",
        preview:
          "OpenMeld could not confirm whether the Center Agent reply was posted. Check the Slack thread before trying again.",
        title: "Check the Center Agent reply in Slack",
      };
    case "failed":
      return {
        attention: "update",
        preview: "The Center Agent could not complete this Slack request.",
        title: "Center Agent request failed in Slack",
      };
    default:
      throw new TypeError(`Unsupported Slack terminal status: ${status}`);
  }
}
