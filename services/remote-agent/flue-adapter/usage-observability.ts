import type { RemoteAgentUsageRecord } from "../agent-core/usage";

type UsageObservabilityEnv = {
  OPENMELD_OBSERVABILITY?: AnalyticsEngineDataset;
};

export function emitRemoteAgentUsageRecord(
  env: UsageObservabilityEnv,
  record: RemoteAgentUsageRecord
): void {
  try {
    env.OPENMELD_OBSERVABILITY?.writeDataPoint({
      indexes: [record.organizationId],
      doubles: [
        record.usage.inputTokens,
        record.usage.outputTokens,
        record.usage.cacheReadTokens,
        record.usage.cacheWriteTokens,
        record.usage.totalTokens,
        record.usage.cost.total,
      ],
      blobs: [
        "remote_agent.turn_usage.v1",
        record.dispatchId,
        record.triggerMessageId,
        record.agentProfileId,
        record.bindingId,
        record.modelId ?? "",
        record.recordedAt,
        // Analytics Engine accepts a single index, so per-Space and
        // per-submission attribution must travel in blobs instead.
        record.spaceId,
        record.submissionId,
      ],
    });
  } catch (error) {
    console.error("[remote-agent.usage.observability_failed]", {
      error: error instanceof Error ? error.message : String(error),
      organizationId: record.organizationId,
      spaceId: record.spaceId,
      submissionId: record.submissionId,
    });
  }
}
