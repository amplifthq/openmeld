import { queryAiUsage } from "./ai-usage-repository";

export function aiUsageDay(nowMs: number) {
  const fromMs = Math.floor(nowMs / 86_400_000) * 86_400_000;
  return { fromMs, toMs: fromMs + 86_400_000 };
}

export async function readAiUsageAllowance(input: {
  db: D1Database;
  organizationId: string;
  nowMs: number;
}) {
  const period = aiUsageDay(input.nowMs);
  const [policy, usage] = await Promise.all([
    input.db
      .prepare(
        "SELECT daily_limit_nano_usd FROM organization_ai_usage_policies WHERE organization_id = ?"
      )
      .bind(input.organizationId)
      .first<{ daily_limit_nano_usd: number | null }>(),
    queryAiUsage({ ...input, query: { ...period, runtime: "remote" } }),
  ]);
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
