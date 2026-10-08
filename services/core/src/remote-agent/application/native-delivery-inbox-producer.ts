import type { PostgresDatabase } from "@openmeld/db/postgresql";
import { formatPublicAgentFailureFacts } from "@openmeld/schemas";
import type {
  AgentTaskTerminalOutcome,
  InboxSourceCandidate,
  InboxSourceTarget,
} from "@openmeld/schemas/types";
import {
  ensureInboxItem,
  resolveInboxItemsBySource,
} from "../../inbox/application/inbox-item-service";
import {
  readInboxItemBySource,
  repairLegacyTaskContinuationInboxItem,
  replaceInboxSourceTargetsIfCurrent,
} from "../../inbox/infrastructure/postgresql/inbox-item-repo";
import type { RemoteAgentNativeDeliveryRecord } from "../infrastructure/postgresql/native-delivery-ledger-repo";
import { buildTaskContinuationAdmissionFailureFacts } from "./native-delivery-failure-facts";
import type { SlackInboxSourceTarget } from "./slack-inbox-source-target";

type SlackTerminalStatus = AgentTaskTerminalOutcome["status"];

type TaskContinuationInboxInput = {
  attempts: number;
  db: PostgresDatabase;
  delivery: RemoteAgentNativeDeliveryRecord;
  occurredAtMs: number;
  languageTag?: string;
};

export async function projectTaskContinuationAdmissionExhaustedInboxItem(
  input: TaskContinuationInboxInput
): Promise<void> {
  const projection = buildTaskContinuationInboxProjection(input);
  if (!projection) {
    return;
  }
  await repairLegacyTaskContinuationInboxItem({
    ...projection,
    db: input.db,
    nowMs: input.occurredAtMs,
  });
  await ensureInboxItem({
    candidate: projection.candidate,
    db: input.db,
    nowMs: input.occurredAtMs,
  });
}

export async function repairTaskContinuationAdmissionExhaustedInboxItem(
  input: TaskContinuationInboxInput
): Promise<void> {
  const projection = buildTaskContinuationInboxProjection(input);
  if (projection) {
    await repairLegacyTaskContinuationInboxItem({
      ...projection,
      db: input.db,
      nowMs: input.occurredAtMs,
    });
  }
}

function buildTaskContinuationInboxProjection(
  input: TaskContinuationInboxInput
): {
  candidate: InboxSourceCandidate;
  legacySourceTarget: InboxSourceTarget;
} | null {
  const recipientUserId = input.delivery.onBehalfOfUserId?.trim() ?? "";
  const trigger = input.delivery.workerSubmitRequest?.turnEnvelope.trigger;
  if (
    input.delivery.conversationKind !== "space" ||
    input.delivery.routineRunId ||
    !recipientUserId ||
    (trigger?.source !== "task_continuation" &&
      trigger?.source !== "task_watch_continuation")
  ) {
    return null;
  }
  // The trigger's result belongs to the watched task, possibly in another
  // Space. Only this delivery's own publication or thread is a local target.
  const signalId =
    input.delivery.publishedSignalId?.trim() ||
    input.delivery.threadContext?.rootSignalId;
  const presentation = formatPublicAgentFailureFacts(
    buildTaskContinuationAdmissionFailureFacts({
      delivery: input.delivery,
      maxAttempts: input.attempts,
      languageTag: input.languageTag,
    })
  );
  const candidate: InboxSourceCandidate = {
    attention: "update",
    contextLabel: "Center Agent",
    importance: "normal",
    kind: "system_issue",
    occurredAtMs: input.occurredAtMs,
    organizationId: input.delivery.organizationId,
    preview: presentation.body,
    recipientUserId,
    sourceFacts: {
      recipientReasons: ["requester"],
      version: 1,
    },
    sourceKey: `${input.delivery.deliveryId}:admission_retry_exhausted`,
    sourceKind: "remote_agent_native_delivery",
    sourceTarget: {
      kind: "space",
      ...(signalId ? { signalId } : {}),
      spaceId: input.delivery.spaceId,
      ...(input.delivery.threadContext?.rootSignalId
        ? {
            threadRootSignalId: input.delivery.threadContext.rootSignalId,
          }
        : {}),
    },
    title: presentation.title,
  };
  const legacySignalId =
    "publishedSignalId" in trigger.outcome
      ? trigger.outcome.publishedSignalId?.trim()
      : null;
  return {
    candidate,
    legacySourceTarget: {
      kind: "space",
      signalId: legacySignalId || input.delivery.triggerMessageId,
      spaceId: input.delivery.spaceId,
      ...(input.delivery.threadContext?.rootSignalId
        ? { threadRootSignalId: input.delivery.threadContext.rootSignalId }
        : {}),
    },
  };
}
export async function projectLinkedSlackNativeDeliveryInboxItem(input: {
  db: PostgresDatabase;
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
