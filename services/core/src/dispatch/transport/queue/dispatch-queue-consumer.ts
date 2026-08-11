import { parseOpenMeldDaemonDispatchQueueIngress } from "@openmeld/schemas";
import type { CoreBindings } from "../../../lib/bindings";
import { emitCoreCloudflareRuntimeEvidence } from "../../../shared/observability/cloudflare-runtime-evidence";
import {
  type DispatchQueueBatchOutcome,
  type DispatchQueueWaitContext,
  handleDispatchQueueBatch as runDispatchQueueBatch,
} from "../../application/dispatch-queue-service";

export const handleDispatchQueueBatch = async (input: {
  batch: MessageBatch<unknown>;
  ctx?: DispatchQueueWaitContext;
  env: CoreBindings;
}): Promise<void> => {
  const startedAt = Date.now();
  emitCoreCloudflareRuntimeEvidence(input.env, {
    event: "core.openmeld.dispatch.queue_batch_started",
    workerEnvironment: input.env.OPENMELD_WORKER_ENVIRONMENT,
    runtimeKind: "queue",
    status: "started",
    operation: input.batch.queue,
    durationMs: 0,
    messageCount: input.batch.messages.length,
  });
  emitQueueMessageStartedEvents(input);

  const localHarnessWaits: Promise<void>[] = [];
  let batchOutcome: DispatchQueueBatchOutcome | null = null;
  try {
    batchOutcome = await runDispatchQueueBatch({
      batch: input.batch,
      ctx: {
        waitUntil(promise) {
          const monitoredPromise = monitorScheduledWait({
            env: input.env,
            operation: input.batch.queue,
            promise,
          });
          if (input.ctx) {
            input.ctx.waitUntil(monitoredPromise);
          } else {
            // Direct unit harnesses do not have a Cloudflare queue context to own
            // waitUntil work; drain those promises to avoid test-only leaks.
            localHarnessWaits.push(monitoredPromise);
          }
        },
      },
      env: input.env,
    });
  } catch (error) {
    emitCoreCloudflareRuntimeEvidence(input.env, {
      event: "core.openmeld.dispatch.queue_batch_failed",
      workerEnvironment: input.env.OPENMELD_WORKER_ENVIRONMENT,
      runtimeKind: "queue",
      status: "failed",
      operation: input.batch.queue,
      durationMs: Date.now() - startedAt,
      messageCount: input.batch.messages.length,
      reasonCode: "queue_batch_failed",
      errorName: error instanceof Error ? error.name : typeof error,
    });
    throw error;
  }

  if (batchOutcome?.status === "retry_scheduled") {
    emitCoreCloudflareRuntimeEvidence(input.env, {
      event: "core.openmeld.dispatch.queue_batch_failed",
      workerEnvironment: input.env.OPENMELD_WORKER_ENVIRONMENT,
      runtimeKind: "queue",
      status: "failed",
      operation: input.batch.queue,
      durationMs: Date.now() - startedAt,
      messageCount: input.batch.messages.length,
      reasonCode: batchOutcome.reasonCode,
    });
    return;
  }

  if (!input.ctx && localHarnessWaits.length > 0) {
    await Promise.allSettled(localHarnessWaits);
  }

  emitCoreCloudflareRuntimeEvidence(input.env, {
    event: "core.openmeld.dispatch.queue_batch_succeeded",
    workerEnvironment: input.env.OPENMELD_WORKER_ENVIRONMENT,
    runtimeKind: "queue",
    status: "succeeded",
    operation: input.batch.queue,
    durationMs: Date.now() - startedAt,
    messageCount: input.batch.messages.length,
  });
};

function monitorScheduledWait(input: {
  env: CoreBindings;
  operation: string;
  promise: Promise<unknown>;
}): Promise<void> {
  return Promise.resolve(input.promise)
    .then(() => undefined)
    .catch((error) => {
      const errorMessage = toErrorMessage(error);
      console.error(
        "[core.openMeldDaemon.dispatch_queue.scheduled_wait_rejected]",
        {
          event: "core.openmeld.dispatch.queue_scheduled_wait_failed",
          error: errorMessage,
        }
      );
      emitCoreCloudflareRuntimeEvidence(input.env, {
        event: "core.openmeld.dispatch.queue_scheduled_wait_failed",
        workerEnvironment: input.env.OPENMELD_WORKER_ENVIRONMENT,
        runtimeKind: "queue",
        status: "failed",
        operation: input.operation,
        reasonCode: "scheduled_wait_rejected",
        errorName: error instanceof Error ? error.name : typeof error,
      });
    });
}

function emitQueueMessageStartedEvents(input: {
  batch: MessageBatch<unknown>;
  env: CoreBindings;
}): void {
  for (const message of input.batch.messages) {
    const parsed = parseOpenMeldDaemonDispatchQueueIngress(message.body);
    if (parsed.kind === "remote_agent_deadline_probe") {
      emitCoreCloudflareRuntimeEvidence(input.env, {
        event: "core.openmeld.dispatch.queue_message_started",
        workerEnvironment: input.env.OPENMELD_WORKER_ENVIRONMENT,
        runtimeKind: "queue",
        status: "started",
        operation: input.batch.queue,
        messageCount: 1,
        spaceId: parsed.message.spaceId,
        clientMessageId: parsed.message.submissionId,
        sourceSignalId: null,
        targetProfileId: null,
        dispatchId: parsed.message.dispatchId,
      });
      continue;
    }
    if (
      parsed.kind === "agent_task_continuation" ||
      parsed.kind === "agent_task_observation_redrive"
    ) {
      emitCoreCloudflareRuntimeEvidence(input.env, {
        event: "core.openmeld.dispatch.queue_message_started",
        workerEnvironment: input.env.OPENMELD_WORKER_ENVIRONMENT,
        runtimeKind: "queue",
        status: "started",
        operation: input.batch.queue,
        messageCount: 1,
        clientMessageId: null,
        sourceSignalId: null,
        targetProfileId: null,
        dispatchId: null,
      });
      continue;
    }
    if (parsed.kind !== "current_v2") {
      emitCoreCloudflareRuntimeEvidence(input.env, {
        event: "core.openmeld.dispatch.queue_message_rejected",
        workerEnvironment: input.env.OPENMELD_WORKER_ENVIRONMENT,
        runtimeKind: "queue",
        status: "failed",
        operation: input.batch.queue,
        messageCount: 1,
        reasonCode:
          parsed.kind === "legacy_v1"
            ? "legacy_queue_message"
            : "invalid_queue_message",
      });
      continue;
    }

    emitCoreCloudflareRuntimeEvidence(input.env, {
      event: "core.openmeld.dispatch.queue_message_started",
      workerEnvironment: input.env.OPENMELD_WORKER_ENVIRONMENT,
      runtimeKind: "queue",
      status: "started",
      operation: input.batch.queue,
      messageCount: 1,
      spaceId: parsed.message.spaceId,
      clientMessageId: parsed.message.sourceClientMessageId ?? null,
      sourceSignalId: parsed.message.sourceEventId,
      targetProfileId: parsed.message.targetProfileId,
      dispatchId: parsed.message.dispatchId,
    });
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
