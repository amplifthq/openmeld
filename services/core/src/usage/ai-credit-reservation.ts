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

// The provider's remaining balance on the workspace's managed key, read
// outside the lock. It cannot see requests still in flight, nor costs settled
// after the read.
export type ProviderAiCreditBalance = {
  availableNanoUsd: number;
  observedAtMs: number;
};

export function aiCreditPeriodStartMs(nowMs: number) {
  const now = new Date(nowMs);
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
}

// Rows recorded before the funding_source projection existed carry the
// source only in record_json. They can only appear in the rollout month.
const PLATFORM_FUNDED = `COALESCE(funding_source, ((record_json)::jsonb #>> '{fundingSource}')) = 'free'`;

type BalanceInput = {
  organizationId: string;
  attemptId: string | null;
  nowMs: number;
};

async function readBalance(
  db: AiUsageQueryable,
  input: BalanceInput & { providerObservedAtMs?: number }
): Promise<AiCreditBalance & { providerUnseenNanoUsd: number }> {
  const result = await db.query<{
    committed: number;
    continuation: boolean;
    provider_unseen: number;
  }>({
    // A reported cost replaces its hold. Without one, the hold counts until it
    // expires. Legacy rows without a hold count only their reported cost.
    // Admission time, not the Remote Agent's earlier observation time, assigns
    // a held request to its credit period. Admission follows the observation
    // within one hold lifetime, which bounds the index range.
    text: `
    SELECT COALESCE(SUM(CASE
        WHEN cost_nano_usd IS NOT NULL THEN cost_nano_usd
        WHEN credit_hold_admitted_at_ms > $3::bigint - $5::bigint THEN credit_hold_nano_usd
        ELSE 0 END)::bigint, 0) AS committed,
      COALESCE(BOOL_OR(credit_hold_nano_usd IS NOT NULL
        AND attempt_id = $4::text), false) AS continuation,
      COALESCE(SUM(CASE
        WHEN cost_nano_usd IS NULL
          AND credit_hold_admitted_at_ms > $3::bigint - $5::bigint
          THEN credit_hold_nano_usd
        WHEN cost_nano_usd IS NOT NULL
          AND credit_hold_admitted_at_ms >= $6::bigint THEN cost_nano_usd
        ELSE 0 END)::bigint, 0) AS provider_unseen
    FROM "openmeld"."ai_usage_records"
    WHERE organization_id = $1 AND runtime = 'remote'
      AND occurred_at_ms >= $2::bigint - $5::bigint
      AND COALESCE(credit_hold_admitted_at_ms, occurred_at_ms) >= $2::bigint
      AND ${PLATFORM_FUNDED}`,
    values: [
      input.organizationId,
      aiCreditPeriodStartMs(input.nowMs),
      input.nowMs,
      input.attemptId,
      AI_CREDIT_HOLD_TTL_MS,
      input.providerObservedAtMs ?? input.nowMs,
    ],
  });
  const committedNanoUsd = Number(result.rows[0]?.committed ?? 0);
  return {
    committedNanoUsd,
    availableNanoUsd: AI_FREE_MONTHLY_ALLOWANCE_NANO_USD - committedNanoUsd,
    continuation: result.rows[0]?.continuation === true,
    providerUnseenNanoUsd: Number(result.rows[0]?.provider_unseen ?? 0),
  };
}

/** A cheap pre-check outside the lock; the reservation re-reads under lock. */
export async function readAiCreditBalance(
  db: PostgresDatabase,
  input: BalanceInput
): Promise<AiCreditBalance> {
  const { providerUnseenNanoUsd: _, ...balance } = await readBalance(db, input);
  return balance;
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
  // Provider remaining balance observed for a new task, outside the lock.
  providerBalance: ProviderAiCreditBalance | null;
}): Promise<{ admitted: boolean; balance: AiCreditBalance }> {
  return await input.db.transaction(async (client) => {
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`ai-credit-reservation:${input.record.organizationId}`]
    );
    // Read the clock after the lock wait so the period and expiry are current.
    const admittedAtMs = Date.now();
    const { providerUnseenNanoUsd, ...balance } = await readBalance(client, {
      organizationId: input.record.organizationId,
      attemptId: input.record.attemptId,
      nowMs: admittedAtMs,
      providerObservedAtMs: input.providerBalance?.observedAtMs,
    });
    if (input.providerBalance) {
      // Concurrent new tasks share one provider remainder: subtract holds the
      // provider cannot see yet, and costs of requests admitted after the read.
      balance.availableNanoUsd = Math.min(
        balance.availableNanoUsd,
        input.providerBalance.availableNanoUsd - providerUnseenNanoUsd
      );
    }
    if (!admitsAiCreditHold({ balance, holdNanoUsd: input.holdNanoUsd })) {
      return { admitted: false, balance };
    }
    await recordAiUsage(client, input.record, {
      nanoUsd: input.holdNanoUsd,
      admittedAtMs,
    });
    return { admitted: true, balance };
  });
}
