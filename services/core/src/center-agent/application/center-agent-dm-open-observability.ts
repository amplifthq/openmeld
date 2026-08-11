import type { CoreBindings } from "../../lib/bindings";
import { emitCoreCloudflareRuntimeEvidence } from "../../shared/observability/cloudflare-runtime-evidence";

export type CenterAgentDirectMessageOpenTimingStage =
  | "membership"
  | "designation"
  | "human_member"
  | "center_agent_member"
  | "legacy_candidate_lookup"
  | "reusable_candidate_lookup"
  | "generation_count"
  | "meta_upsert"
  | "members_upsert"
  | "direct_message_open"
  | "welcome"
  | "response_validation";

export type CenterAgentDirectMessageOpenTimingRecorder = {
  measure<T>(
    stage: CenterAgentDirectMessageOpenTimingStage,
    operation: () => Promise<T> | T
  ): Promise<T>;
};

type CenterAgentDirectMessageOpenTimingMetric = {
  durationMs: number;
  errorName: string | null;
  reasonCode: CenterAgentDirectMessageOpenTimingStage;
  status: "failed" | "succeeded";
};

export function createCenterAgentDirectMessageOpenTiming(input: {
  env: CoreBindings;
  nowMs?: () => number;
  requestId: string;
}) {
  const nowMs = input.nowMs ?? defaultNowMs;
  const totalStartedAtMs = nowMs();
  const metrics: CenterAgentDirectMessageOpenTimingMetric[] = [];
  let lastStage: CenterAgentDirectMessageOpenTimingStage | null = null;

  const record = (
    stage: CenterAgentDirectMessageOpenTimingStage,
    startedAtMs: number,
    error?: unknown
  ) => {
    metrics.push({
      durationMs: Math.max(0, nowMs() - startedAtMs),
      errorName: resolveErrorName(error),
      reasonCode: stage,
      status: error === undefined ? "succeeded" : "failed",
    });
  };

  return {
    async measure<T>(
      stage: CenterAgentDirectMessageOpenTimingStage,
      operation: () => Promise<T> | T
    ): Promise<T> {
      lastStage = stage;
      const startedAtMs = nowMs();
      try {
        const result = await operation();
        record(stage, startedAtMs);
        return result;
      } catch (error) {
        record(stage, startedAtMs, error);
        throw error;
      }
    },
    measureSync<T>(
      stage: CenterAgentDirectMessageOpenTimingStage,
      operation: () => T
    ): T {
      lastStage = stage;
      const startedAtMs = nowMs();
      try {
        const result = operation();
        record(stage, startedAtMs);
        return result;
      } catch (error) {
        record(stage, startedAtMs, error);
        throw error;
      }
    },
    emit(result: {
      centerAgentProfileId?: string | null;
      created?: boolean;
      failure?: unknown;
      spaceId?: string | null;
    }): void {
      const totalReasonCode = resolveTotalReasonCode({
        created: result.created,
        failed: result.failure !== undefined,
        lastStage,
      });
      const allMetrics = [
        ...metrics,
        {
          durationMs: Math.max(0, nowMs() - totalStartedAtMs),
          errorName: resolveErrorName(result.failure),
          reasonCode: totalReasonCode,
          status:
            result.failure === undefined
              ? ("succeeded" as const)
              : ("failed" as const),
        },
      ];

      for (const metric of allMetrics) {
        emitCoreCloudflareRuntimeEvidence(input.env, {
          durationMs: metric.durationMs,
          errorName: metric.errorName,
          event: "core.openmeld.center_agent_dm_open_timing",
          operation: "openCenterAgentDirectMessageSpace",
          reasonCode: metric.reasonCode,
          requestId: input.requestId,
          runtimeKind: "rpc",
          spaceId: result.spaceId,
          status: metric.status,
          targetProfileId: result.centerAgentProfileId,
          workerEnvironment: input.env.OPENMELD_WORKER_ENVIRONMENT,
        });
      }
    },
  };
}

function resolveTotalReasonCode(input: {
  created?: boolean;
  failed: boolean;
  lastStage: CenterAgentDirectMessageOpenTimingStage | null;
}): string {
  if (input.failed) {
    return `total_failed_after_${input.lastStage ?? "start"}`;
  }
  return input.created ? "total_created" : "total_existing";
}

function defaultNowMs(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function resolveErrorName(error: unknown): string | null {
  if (error === undefined) {
    return null;
  }
  return error instanceof Error ? error.name : typeof error;
}
