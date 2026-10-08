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
  const policy = await input.db
    .query<{
      daily_limit_nano_usd: number | null;
    }>({
      text: 'SELECT daily_limit_nano_usd FROM "openmeld"."organization_ai_usage_policies" WHERE organization_id = $1',
      values: [input.organizationId],
    })
    .then((result) => result.rows[0] ?? null);
  const usage = await queryAiUsage({
    ...input,
    query: { ...period, runtime: "remote" },
  });
  const dailyLimitNanoUsd = policy?.daily_limit_nano_usd ?? null;
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
    exhausted: dailyLimitNanoUsd !== null && usedNanoUsd >= dailyLimitNanoUsd,
  };
}
