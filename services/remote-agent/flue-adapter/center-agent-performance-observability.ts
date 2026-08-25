import {
  CENTER_AGENT_PERFORMANCE_MODEL_VERSION,
  type CenterAgentPerformanceEvent,
  projectCenterAgentPerformanceAnalyticsDataPoint,
} from "@openmeld/schemas";
import type { RemoteAgentTurnEnvelope } from "@openmeld/schemas/types";
import type { RemoteAgentCallbackContext } from "../agent-core/callback-context";

export type CenterAgentPerformanceObservabilityEnv = {
  OPENMELD_CENTER_AGENT_PERFORMANCE?: AnalyticsEngineDataset;
  OPENMELD_WORKER_ENVIRONMENT?: string;
};

export function emitCenterAgentPerformanceMilestone(
  env: CenterAgentPerformanceObservabilityEnv,
  input: {
    availableToolCount?: number | null;
    context: RemoteAgentCallbackContext;
    exposedToolCount?: number | null;
    milestone: CenterAgentPerformanceEvent["milestone"];
    modelId?: string | null;
    observedAtMs: number;
    reasonCode?: string | null;
    stageDurationMs?: number | null;
    status?: "failed" | "succeeded";
    statusCode?: number | null;
  }
): void {
  try {
    const triggerSource = resolveTriggerSource(input.context.turnEnvelope);
    if (!triggerSource) {
      throw new Error(
        "Center Agent performance evidence requires a frozen trigger source."
      );
    }
    const availableToolCount = input.availableToolCount ?? null;
    const exposedToolCount = input.exposedToolCount ?? null;
    env.OPENMELD_CENTER_AGENT_PERFORMANCE?.writeDataPoint(
      projectCenterAgentPerformanceAnalyticsDataPoint({
        agentProfileId: input.context.agentProfileId,
        availableToolCount,
        bindingId: input.context.bindingId,
        deferredToolCount:
          availableToolCount === null || exposedToolCount === null
            ? null
            : Math.max(0, availableToolCount - exposedToolCount),
        dispatchId: input.context.dispatchId,
        elapsedFromAdmissionMs: Math.max(
          0,
          input.observedAtMs - input.context.submissionCreatedAt
        ),
        exposedToolCount,
        milestone: input.milestone,
        modelId:
          input.modelId ??
          input.context.modelId ??
          input.context.modelRoute?.modelId ??
          null,
        modelVersion: CENTER_AGENT_PERFORMANCE_MODEL_VERSION,
        organizationId: input.context.organizationId,
        reasonCode: input.reasonCode ?? null,
        sourceClientMessageId: input.context.sourceClientMessageId,
        spaceId: input.context.spaceId,
        stageDurationMs: input.stageDurationMs ?? null,
        status: input.status ?? "succeeded",
        statusCode: input.statusCode ?? null,
        submissionId: input.context.submissionId,
        triggerSource,
        workerEnvironment: env.OPENMELD_WORKER_ENVIRONMENT?.trim() || null,
      })
    );
  } catch (error) {
    console.error("[remote_agent.center_agent_performance.write_failed]", {
      errorName: error instanceof Error ? error.name : "UnknownError",
      milestone: input.milestone,
      submissionId: input.context.submissionId,
    });
  }
}

function resolveTriggerSource(
  envelope: RemoteAgentTurnEnvelope | undefined
): CenterAgentPerformanceEvent["triggerSource"] | null {
  return envelope?.trigger.source ?? null;
}
