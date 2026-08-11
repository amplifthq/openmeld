import type { CoreBindings } from "../../lib/bindings";
import { emitCoreCloudflareRuntimeEvidence } from "./cloudflare-runtime-evidence";

export function emitCoreFinalVisibleOutcomeRuntimeEvidence(
  env: CoreBindings,
  input: {
    clientMessageId?: string | null;
    dispatchId?: string | null;
    latestAttemptId?: string | null;
    publishedSignalId?: string | null;
    reasonCode?: string | null;
    replySignalId?: string | null;
    resultRef?: string | null;
    runtimeCoordinatorExecutionId?: string | null;
    runtimeKind: "durable_object" | "queue" | "rpc";
    sourceSignalId?: string | null;
    spaceId: string;
    status: "failed" | "succeeded";
    targetProfileId?: string | null;
  }
): void {
  emitCoreCloudflareRuntimeEvidence(env, {
    event: "core.openmeld.space.final_visible_outcome_observed",
    workerEnvironment: env.OPENMELD_WORKER_ENVIRONMENT,
    runtimeKind: input.runtimeKind,
    status: input.status,
    operation: "finalVisibleOutcome",
    reasonCode: input.reasonCode ?? null,
    spaceId: input.spaceId,
    clientMessageId: input.clientMessageId ?? null,
    sourceSignalId: input.sourceSignalId ?? null,
    targetProfileId: input.targetProfileId ?? null,
    dispatchId: input.dispatchId ?? null,
    runtimeCoordinatorExecutionId: input.runtimeCoordinatorExecutionId ?? null,
    latestAttemptId: input.latestAttemptId ?? null,
    resultRef: input.resultRef ?? null,
    publishedSignalId: input.publishedSignalId ?? null,
    replySignalId: input.replySignalId ?? null,
  });
}
