import {
  REMOTE_AGENT_NATIVE_DELIVERY_DEADLINE_PROBE_QUEUE_SCHEMA_VERSION,
  remoteAgentNativeDeliveryDeadlineProbeQueueMessageSchema,
} from "@openmeld/schemas";
import type { RemoteAgentNativeDeliveryDeadlineProbeQueueMessage } from "@openmeld/schemas/types";
import type { CoreBindings } from "../../lib/bindings";
import { CORE_LOG_EVENTS } from "../../shared/observability/log-events";

export const REMOTE_AGENT_ADMISSION_WATCHDOG_DELAY_SECONDS = 240;
export const REMOTE_AGENT_ACCEPTED_DELIVERY_PROBE_DELAY_SECONDS = 300;
const REMOTE_AGENT_ADMISSION_WATCHDOG_SUBMISSION_PREFIX = "admission_watchdog:";

export type RemoteAgentDeadlineProbeTarget = {
  dispatchId: string;
  idempotencyKey: string;
  organizationId: string;
  profileId: string;
  spaceId: string;
};

export async function enqueueRemoteAgentAdmissionWatchdog(input: {
  ack: { submissionId: string };
  env: CoreBindings;
  nowMs: number;
  target: RemoteAgentDeadlineProbeTarget;
}): Promise<boolean> {
  return await enqueueRemoteAgentNativeDeliveryProbe({
    ...input,
    delaySeconds: REMOTE_AGENT_ADMISSION_WATCHDOG_DELAY_SECONDS,
    enqueueFailedLog:
      "[core.remote_agent.native_delivery.admission_watchdog_enqueue_failed]",
    queueMissingLog:
      "[core.remote_agent.native_delivery.admission_watchdog_queue_missing]",
  });
}

export async function enqueueRemoteAgentAcceptedDeliveryProbe(input: {
  ack: { submissionId: string };
  env: CoreBindings;
  nowMs: number;
  target: RemoteAgentDeadlineProbeTarget;
}): Promise<boolean> {
  return await enqueueRemoteAgentNativeDeliveryProbe({
    ...input,
    delaySeconds: REMOTE_AGENT_ACCEPTED_DELIVERY_PROBE_DELAY_SECONDS,
    enqueueFailedLog:
      "[core.remote_agent.native_delivery.accepted_probe_enqueue_failed]",
    queueMissingLog:
      "[core.remote_agent.native_delivery.accepted_probe_queue_missing]",
  });
}

async function enqueueRemoteAgentNativeDeliveryProbe(input: {
  ack: { submissionId: string };
  delaySeconds: number;
  enqueueFailedLog: string;
  env: CoreBindings;
  nowMs: number;
  queueMissingLog: string;
  target: RemoteAgentDeadlineProbeTarget;
}): Promise<boolean> {
  const queue = input.env.OPENMELD_DAEMON_DISPATCH_QUEUE;
  if (!queue?.send) {
    console.warn(input.queueMissingLog, {
      event: CORE_LOG_EVENTS.coreInternalError,
      dispatchId: input.target.dispatchId,
      submissionId: input.ack.submissionId,
      targetProfileId: input.target.profileId,
    });
    return false;
  }

  const probe = remoteAgentNativeDeliveryDeadlineProbeQueueMessageSchema.parse({
    v: REMOTE_AGENT_NATIVE_DELIVERY_DEADLINE_PROBE_QUEUE_SCHEMA_VERSION,
    kind: "remote_agent_native_delivery_deadline_probe",
    submissionId: input.ack.submissionId,
    idempotencyKey: input.target.idempotencyKey,
    organizationId: input.target.organizationId,
    spaceId: input.target.spaceId,
    dispatchId: input.target.dispatchId,
    enqueuedAtMs: input.nowMs,
    deadlineAtMs: input.nowMs + input.delaySeconds * 1000,
  });

  try {
    await queue.send(probe, {
      delaySeconds: input.delaySeconds,
    });
    return true;
  } catch (error) {
    console.warn(input.enqueueFailedLog, {
      event: CORE_LOG_EVENTS.coreInternalError,
      dispatchId: input.target.dispatchId,
      error: toErrorMessage(error),
      submissionId: input.ack.submissionId,
      targetProfileId: input.target.profileId,
    });
    return false;
  }
}

export function buildRemoteAgentAdmissionWatchdogSubmissionId(
  idempotencyKey: string
): string {
  return `${REMOTE_AGENT_ADMISSION_WATCHDOG_SUBMISSION_PREFIX}${idempotencyKey}`;
}

export function isRemoteAgentAdmissionWatchdogProbe(
  probe: RemoteAgentNativeDeliveryDeadlineProbeQueueMessage
): boolean {
  return (
    probe.submissionId ===
    buildRemoteAgentAdmissionWatchdogSubmissionId(probe.idempotencyKey)
  );
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
