export type RemoteAgentToolUsageOutcome = "failed" | "succeeded";

export type RemoteAgentToolUsageRecord = {
  browserMs?: number;
  durationMs: number;
  inputBytes?: number;
  operation: string;
  organizationId: string;
  outcome: RemoteAgentToolUsageOutcome;
  outputBytes?: number;
  provider:
    | "cloudflare_browser"
    | "cloudflare_codemode"
    | "cloudflare_computer"
    | "cloudflare_sandbox"
    | "openrouter";
  recordedAt: string;
  requestCount?: number;
  spaceId: string;
  submissionId: string;
  toolName: string;
};

export type RemoteAgentToolUsageObservabilityEnv = {
  OPENMELD_OBSERVABILITY?: AnalyticsEngineDataset;
};

export function emitRemoteAgentToolUsage(
  env: RemoteAgentToolUsageObservabilityEnv,
  record: RemoteAgentToolUsageRecord
): void {
  try {
    env.OPENMELD_OBSERVABILITY?.writeDataPoint({
      indexes: [record.organizationId, record.spaceId, record.submissionId],
      doubles: [
        record.durationMs,
        record.requestCount ?? 1,
        record.inputBytes ?? 0,
        record.outputBytes ?? 0,
        record.browserMs ?? 0,
        record.outcome === "succeeded" ? 0 : 1,
      ],
      blobs: [
        "remote_agent.tool_usage.v1",
        record.toolName,
        record.provider,
        record.operation,
        record.outcome,
        record.recordedAt,
      ],
    });
  } catch (error) {
    console.error("[remote-agent.tool-usage.observability_failed]", {
      error: error instanceof Error ? error.message : String(error),
      organizationId: record.organizationId,
      provider: record.provider,
      spaceId: record.spaceId,
      submissionId: record.submissionId,
      toolName: record.toolName,
    });
  }
}
