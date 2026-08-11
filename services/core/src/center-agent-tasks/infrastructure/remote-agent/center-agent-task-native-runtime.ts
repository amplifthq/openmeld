import type { CenterAgentTaskOrigin } from "@openmeld/schemas/types";
import type { CoreBindings } from "../../../lib/bindings";
import { resolveFreshRemoteAgentNativeDeliveryExecutionEvidenceAtMs } from "../../../remote-agent/application/native-delivery-execution-evidence";
import {
  RemoteAgentTaskContinuationTerminalError,
  requireCurrentCenterAgentTaskAdmissionAuthority,
  resolveCenterAgentTaskNativeDeliveryIdentity,
  stopRemoteAgentCenterAgentTaskDelivery,
  submitRemoteAgentCenterAgentTaskTurn,
} from "../../../remote-agent/application/native-delivery-service";
import {
  listRemoteAgentNativeDeliveriesByDeliveryIds,
  type RemoteAgentNativeDeliveryRecord,
  readRemoteAgentNativeDeliveryByDeliveryId,
  readRemoteAgentNativeDeliveryBySubmissionId,
} from "../../../remote-agent/infrastructure/d1/native-delivery-ledger-repo";
import {
  CenterAgentTaskApplicationError,
  type CenterAgentTaskRuntimePort,
} from "../../application/center-agent-task-service";

export function createCenterAgentTaskNativeRuntimePort(input: {
  deliveryDb: D1Database;
  env: CoreBindings;
}): CenterAgentTaskRuntimePort {
  return {
    authorizeTurn: async (request) => {
      const delivery = await readParentDelivery(
        input.deliveryDb,
        request.parent
      );
      requireOwnedDelivery(delivery, request);
      try {
        await requireCurrentCenterAgentTaskAdmissionAuthority({
          env: input.env,
          organizationId: request.organizationId,
          parentDelivery: delivery,
          requesterUserId: request.requesterUserId,
        });
      } catch (error) {
        throwTaskRuntimeAuthorityError(error);
      }
    },
    resolveDeliveryParent: async (request) => {
      const delivery = await readRemoteAgentNativeDeliveryByDeliveryId({
        db: input.deliveryDb,
        deliveryId: request.deliveryId,
      });
      requireOwnedDelivery(delivery, request);
      return { deliveryId: delivery.deliveryId, kind: "delivery" };
    },
    resolveExecutionEvidence: async (request) => {
      const attemptsByDeliveryId = new Map(
        request.attempts.map((attempt) => [attempt.deliveryId, attempt])
      );
      const deliveries = await listRemoteAgentNativeDeliveriesByDeliveryIds({
        db: input.deliveryDb,
        deliveryIds: request.attempts.map((attempt) => attempt.deliveryId),
      });
      return deliveries.flatMap((delivery) => {
        const attempt = attemptsByDeliveryId.get(delivery.deliveryId);
        const taskIdentity =
          resolveCenterAgentTaskNativeDeliveryIdentity(delivery);
        const executionEvidenceAtMs =
          resolveFreshRemoteAgentNativeDeliveryExecutionEvidenceAtMs({
            delivery,
            nowMs: request.nowMs,
          });
        if (
          !attempt ||
          taskIdentity?.taskId !== attempt.taskId ||
          delivery.organizationId !== request.organizationId ||
          delivery.onBehalfOfUserId !== request.requesterUserId ||
          executionEvidenceAtMs === null
        ) {
          return [];
        }
        return [
          {
            attemptGeneration: attempt.attemptGeneration,
            kind: "native_delivery" as const,
            observedAt: new Date(executionEvidenceAtMs).toISOString(),
            taskId: attempt.taskId,
          },
        ];
      });
    },
    resolveParent: async ({ parentSubmissionId }) => {
      const delivery = await readRemoteAgentNativeDeliveryBySubmissionId({
        db: input.deliveryDb,
        submissionId: parentSubmissionId,
      });
      if (!(delivery?.onBehalfOfUserId && delivery.organizationId)) {
        throw taskRuntimeError(
          "center_agent_task.source_delivery_not_found",
          "The source Center Agent delivery was not found."
        );
      }
      return {
        organizationId: delivery.organizationId,
        origin: resolveTaskOrigin(delivery),
        requesterUserId: delivery.onBehalfOfUserId,
      };
    },
    stopDelivery: async (request) => {
      const delivery = await readRemoteAgentNativeDeliveryByDeliveryId({
        db: input.deliveryDb,
        deliveryId: request.deliveryId,
      });
      if (!delivery) {
        return "stopped";
      }
      requireOwnedDelivery(delivery, request);
      return await stopRemoteAgentCenterAgentTaskDelivery({
        db: input.deliveryDb,
        delivery,
        env: input.env,
        nowMs: Date.now(),
      });
    },
    submitTurn: async (request) => {
      try {
        const submission = await submitRemoteAgentCenterAgentTaskTurn({
          ...request,
          db: input.deliveryDb,
          env: input.env,
        });
        return { outcome: submission.outcome };
      } catch (error) {
        const durableDelivery = await readRemoteAgentNativeDeliveryByDeliveryId(
          {
            db: input.deliveryDb,
            deliveryId: request.deliveryId,
          }
        );
        if (durableDelivery) {
          requireOwnedDelivery(durableDelivery, request);
          if (
            durableDelivery.status === "accepted" ||
            durableDelivery.status === "retry_observed" ||
            durableDelivery.status === "completed"
          ) {
            return { outcome: "accepted" };
          }
          if (durableDelivery.status === "submitted") {
            throwTaskRuntimeAuthorityError(error);
          }
          return {
            failureCode:
              durableDelivery.failureCode ??
              "center_agent_task.admission_rejected",
            failureDetail:
              durableDelivery.failureDetail ??
              "The native delivery owner rejected this Task attempt.",
            outcome: "rejected",
          };
        }
        if (error instanceof RemoteAgentTaskContinuationTerminalError) {
          return {
            failureCode: error.reasonCode,
            failureDetail:
              "The native delivery owner rejected this Task attempt before execution started.",
            outcome: "rejected",
          };
        }
        throwTaskRuntimeAuthorityError(error);
      }
    },
  };
}

async function readParentDelivery(
  db: D1Database,
  parent:
    | { deliveryId: string; kind: "delivery" }
    | { kind: "submission"; submissionId: string }
): Promise<RemoteAgentNativeDeliveryRecord | null> {
  return parent.kind === "submission"
    ? await readRemoteAgentNativeDeliveryBySubmissionId({
        db,
        submissionId: parent.submissionId,
      })
    : await readRemoteAgentNativeDeliveryByDeliveryId({
        db,
        deliveryId: parent.deliveryId,
      });
}

function resolveTaskOrigin(
  delivery: RemoteAgentNativeDeliveryRecord
): CenterAgentTaskOrigin {
  const requestedBy = resolveTaskRequester(delivery);
  if (
    delivery.conversationKind === "message_channel" ||
    delivery.conversationKind === "slack"
  ) {
    if (!delivery.messageChannelLocator) {
      throw taskRuntimeError(
        "center_agent_task.source_locator_unavailable",
        "The source message channel is unavailable."
      );
    }
    return {
      destination: delivery.messageChannelLocator,
      kind: "message_channel",
      requestedBy,
    };
  }
  const sourceRequest =
    delivery.workerSubmitRequest ?? delivery.executionRecoverySubmitRequest;
  const localAgent = sourceRequest?.turnEnvelope.centerAgentInteractionSource;
  return {
    kind: "open_meld",
    ...(localAgent
      ? {
          localAgent: {
            client: localAgent.client,
            kind: localAgent.kind,
          },
        }
      : {}),
    requestedBy,
  };
}

function resolveTaskRequester(
  delivery: RemoteAgentNativeDeliveryRecord
): NonNullable<CenterAgentTaskOrigin["requestedBy"]> {
  const displayName = delivery.onBehalfOfDisplayName?.trim();
  const profileId = delivery.onBehalfOfProfileId?.trim();
  const userId = delivery.onBehalfOfUserId?.trim();
  if (!(displayName && profileId && userId)) {
    throw taskRuntimeError(
      "center_agent_task.requester_attribution_unavailable",
      "The Task requester attribution is unavailable."
    );
  }
  return { displayName, profileId, userId };
}

function requireOwnedDelivery(
  delivery: RemoteAgentNativeDeliveryRecord | null,
  request: { organizationId: string; requesterUserId: string }
): asserts delivery is RemoteAgentNativeDeliveryRecord {
  if (
    !delivery ||
    delivery.organizationId !== request.organizationId ||
    delivery.onBehalfOfUserId !== request.requesterUserId
  ) {
    throw taskRuntimeError(
      "center_agent_task.source_delivery_mismatch",
      "The Task execution does not match this Organization member."
    );
  }
}

function taskRuntimeError(code: string, message: string): Error {
  return new CenterAgentTaskApplicationError({ code, message, status: 409 });
}

function throwTaskRuntimeAuthorityError(error: unknown): never {
  if (error instanceof RemoteAgentTaskContinuationTerminalError) {
    throw taskRuntimeError(
      error.reasonCode,
      "This Task can no longer continue under the current Center Agent permissions."
    );
  }
  throw error;
}
