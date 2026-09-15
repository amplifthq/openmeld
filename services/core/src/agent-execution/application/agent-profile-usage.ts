import {
  createAuthorityOpenMeldServiceRuntimeId,
  resolveAgentControllerUsageLimitSupport,
  resolveAgentControllerUsageProviderId,
} from "@openmeld/agent-runtime";
import { AGENT_CONTROLLER_USAGE_LIMIT_STALE_AFTER_MS } from "@openmeld/schemas";
import type { AgentControllerUsageLimits } from "@openmeld/schemas/types";
import type { AgentExecutionReadinessReads } from "./agent-execution-readiness-reads";
import type { CoreAgentExecutionReadiness } from "./agent-execution-readiness-service";

/** Share only provider usage from this Profile's exact bound Runtime and Controller. */
export async function readAgentProfileUsage(input: {
  db: D1Database | undefined;
  binding: Pick<
    NonNullable<CoreAgentExecutionReadiness["primaryBinding"]>,
    "executionTarget" | "modelSelection"
  > | null;
  reads: Pick<
    AgentExecutionReadinessReads,
    "readCurrentRuntimeAgentControllerReports"
  >;
  nowMs: number;
}): Promise<AgentControllerUsageLimits> {
  const binding = input.binding;
  const target = binding?.executionTarget;
  const db = input.db;
  if (!(target && db)) {
    return [];
  }
  const reports = await input.reads.readCurrentRuntimeAgentControllerReports({
    db,
    agentControllerRefs: [target.agentControllerRef],
    openMeldServiceRuntimeId: createAuthorityOpenMeldServiceRuntimeId({
      openMeldServiceRuntimeId: target.openMeldServiceRuntimeId,
      source: "runtime_registry_authority",
    }),
  });
  const report = reports.find(
    (report) => report.agentControllerRef === target.agentControllerRef
  );
  const limits = (report?.agentControllerInterface?.usageLimits ?? []).map(
    (limit) =>
      limit.usedPercent !== null &&
      ((report?.expiresAtMs ?? 0) <= input.nowMs ||
        Date.parse(limit.observedAt) +
          AGENT_CONTROLLER_USAGE_LIMIT_STALE_AFTER_MS <=
          input.nowMs ||
        (limit.resetsAt !== null && Date.parse(limit.resetsAt) <= input.nowMs))
        ? { ...limit, status: "stale" as const }
        : limit
  );
  if (
    resolveAgentControllerUsageLimitSupport(target.agentControllerRef) !==
    "provider_scoped"
  ) {
    return limits;
  }
  const providerId = resolveAgentControllerUsageProviderId({
    agentControllerRef: target.agentControllerRef,
    modelId: binding?.modelSelection?.modelId,
  });
  return limits.filter((limit) => limit.provider?.id === providerId);
}
