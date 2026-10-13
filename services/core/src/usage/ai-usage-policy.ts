import type { PostgresDatabase } from "@openmeld/db/postgresql";
import { queryAiUsage } from "./ai-usage-repository";
export const REMOTE_AGENT_DAILY_QUOTA_EXCEEDED_REASON_CODE =
  "remote_agent.daily_quota_exceeded";
export const REMOTE_AGENT_DAILY_QUOTA_EXCEEDED_MESSAGE =
  "This Organization has used its daily AI allowance. It resets at 00:00 UTC.";
export const REMOTE_AGENT_DAILY_QUOTA_EXCEEDED_ROUTINE_REASON =
  "the Organization has used its daily AI allowance. It resets at 00:00 UTC.";
export function aiUsageDay(nowMs: number) {
  const fromMs = Math.floor(nowMs / 86_400_000) * 86_400_000;
  return { fromMs, toMs: fromMs + 86_400_000 };
}
export async function readAiUsageAllowance(input: {
  db: PostgresDatabase;
  organizationId: string;
  nowMs: number;
}) {
  const period = aiUsageDay(input.nowMs);
  const usage = await queryAiUsage({
    ...input,
    query: { ...period, runtime: "remote" },
  });
  // Retain the legacy overview shape for older clients. Native monthly key
  // budgets now own admission; historical daily policies no longer apply.
  const dailyLimitNanoUsd: number | null = null;
  const usedNanoUsd = usage.models.reduce(
    (total, model) => total + model.reportedCostNanoUsd,
    0
  );
  const missingCostRequests = usage.models.reduce(
    (total, model) => total + model.missingCostRequests,
    0
  );
  return {
    dailyLimitNanoUsd,
    usedNanoUsd,
    missingCostRequests,
    resetsAt: new Date(period.toMs).toISOString(),
    exhausted: false,
  };
}
