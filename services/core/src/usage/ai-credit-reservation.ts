import type { PostgresDatabase } from "@openmeld/db/postgresql";
import { AI_CREDITS_PER_USD, AI_FREE_MONTHLY_CREDITS } from "@openmeld/schemas";
import type { AiUsageRecord } from "@openmeld/schemas/types";
import { type AiUsageQueryable, recordAiUsage } from "./ai-usage-repository";

const NANO_USD_PER_CREDIT = 1_000_000_000 / AI_CREDITS_PER_USD;
export function aiCreditsToNanoUsd(credits: number) {
  return Math.floor(credits * NANO_USD_PER_CREDIT);
}
export const AI_FREE_MONTHLY_ALLOWANCE_NANO_USD =
  AI_FREE_MONTHLY_CREDITS * NANO_USD_PER_CREDIT;
// A new task needs room for a useful first turn. Calls of an already admitted
// execution attempt continue while any balance remains (one-request grace).
export const AI_CREDIT_NEW_TASK_FLOOR_NANO_USD = 300 * NANO_USD_PER_CREDIT;
// Normal settlement arrives within seconds. A hold that is still unsettled,
// or settled without a provider cost, stops counting after this window.
export const AI_CREDIT_HOLD_TTL_MS = 30 * 60 * 1000;

export type AiCreditBalance = {
  committedNanoUsd: number;
  availableNanoUsd: number;
  continuation: boolean;
};

export function aiCreditPeriodStartMs(nowMs: number) {
  const now = new Date(nowMs);
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
}

// Rows recorded before the funding_source projection existed carry the
// source only in record_json. They can only appear in the rollout month.
const PLATFORM_FUNDED = `COALESCE(funding_source, ((record_json)::jsonb #>> '{fundingSource}')) = 'free'`;

async function readBalance(
  db: AiUsageQueryable,
  input: { organizationId: string; attemptId: string | null; nowMs: number }
): Promise<AiCreditBalance> {
  const result = await db.query<{
    committed: number;
    continuation: boolean;
  }>({
    // A reported cost replaces its hold. Without one, the hold counts until it
    // expires. Legacy rows without a hold count only their reported cost.
    text: `
    SELECT COALESCE(SUM(CASE
        WHEN cost_nano_usd IS NOT NULL THEN cost_nano_usd
        WHEN credit_hold_expires_at_ms > $3 THEN credit_hold_nano_usd
        ELSE 0 END)::bigint, 0) AS committed,
      COALESCE(BOOL_OR(credit_hold_nano_usd IS NOT NULL
        AND attempt_id = $4::text), false) AS continuation
    FROM "openmeld"."ai_usage_records"
    WHERE organization_id = $1 AND runtime = 'remote' AND occurred_at_ms >= $2
      AND ${PLATFORM_FUNDED}`,
    values: [
      input.organizationId,
      aiCreditPeriodStartMs(input.nowMs),
      input.nowMs,
      input.attemptId,
    ],
  });
  const committedNanoUsd = Number(result.rows[0]?.committed ?? 0);
  return {
    committedNanoUsd,
    availableNanoUsd: AI_FREE_MONTHLY_ALLOWANCE_NANO_USD - committedNanoUsd,
    continuation: result.rows[0]?.continuation === true,
  };
}

/** A cheap pre-check outside the lock; the reservation re-reads under lock. */
export function readAiCreditBalance(
  db: PostgresDatabase,
  input: { organizationId: string; attemptId: string | null; nowMs: number }
) {
  return readBalance(db, input);
}

export function admitsAiCreditHold(input: {
  balance: AiCreditBalance;
  holdNanoUsd: number;
}) {
  const { availableNanoUsd, continuation } = input.balance;
  if (continuation) {
    return availableNanoUsd > 0;
  }
  return (
    availableNanoUsd >= AI_CREDIT_NEW_TASK_FLOOR_NANO_USD &&
    input.holdNanoUsd <= availableNanoUsd
  );
}

/**
 * Serializes platform-funded admission per workspace. Concurrent begins see
 * each other's holds, so jointly admitted requests cannot exceed the allowance
 * by more than one continuation request's hold plus estimate error.
 */
export async function reserveAiCredits(input: {
  db: PostgresDatabase;
  record: AiUsageRecord;
  holdNanoUsd: number;
  nowMs: number;
  // Provider remaining balance observed for a new task, outside the lock.
  providerAvailableNanoUsd: number | null;
}): Promise<{ admitted: boolean; balance: AiCreditBalance }> {
  return await input.db.transaction(async (client) => {
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`ai-credit-reservation:${input.record.organizationId}`]
    );
    const balance = await readBalance(client, {
      organizationId: input.record.organizationId,
      attemptId: input.record.attemptId,
      nowMs: input.nowMs,
    });
    if (input.providerAvailableNanoUsd !== null) {
      balance.availableNanoUsd = Math.min(
        balance.availableNanoUsd,
        input.providerAvailableNanoUsd
      );
    }
    if (!admitsAiCreditHold({ balance, holdNanoUsd: input.holdNanoUsd })) {
      return { admitted: false, balance };
    }
    await recordAiUsage(client, input.record, {
      nanoUsd: input.holdNanoUsd,
      expiresAtMs: input.nowMs + AI_CREDIT_HOLD_TTL_MS,
    });
    return { admitted: true, balance };
  });
}
