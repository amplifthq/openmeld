import type { AiUsageRecord } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { readAiUsageAllowance } from "../src/usage/ai-usage-policy";
import { queryAiUsage, recordAiUsage } from "../src/usage/ai-usage-repository";
import {
  applyDrizzleMigrationForTable,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

const nowMs = Date.parse("2026-10-01T12:00:00Z");
const record: AiUsageRecord = {
  eventId: "openrouter:request-1",
  provider: "openrouter",
  model: "openai/test",
  source: "openrouter_response",
  occurredAtMs: nowMs,
  tokens: {
    input: 100,
    output: 20,
    total: 120,
    cacheRead: 50,
    cacheWrite: null,
    reasoning: 10,
  },
  cost: { nanoUsd: 500_000_000, kind: "provider_reported" },
  organizationId: "org-1",
  runtime: "remote",
  purpose: "agent",
  agentProfileId: "agent-1",
  spaceId: "space-1",
  taskId: "task-1",
  attemptId: null,
  computerId: null,
  controller: null,
};
const query = { fromMs: nowMs - 1, toMs: nowMs + 1 };

describe("Organization AI consumption", () => {
  it("deduplicates delivery, preserves missing evidence, and isolates organization and task queries", async () => {
    const harness = createHarness();
    try {
      await Promise.all([
        recordAiUsage(harness.db, record),
        recordAiUsage(harness.db, record),
      ]);
      await recordAiUsage(harness.db, { ...record, organizationId: "org-2" });
      await recordAiUsage(harness.db, {
        ...record,
        eventId: "missing",
        tokens: null,
        cost: null,
      });
      const usage = await queryAiUsage({
        db: harness.db,
        organizationId: "org-1",
        query,
      });
      expect(usage.models).toMatchObject([
        {
          requests: 2,
          totalTokens: 120,
          inputTokens: 100,
          outputTokens: 20,
          reportedCostNanoUsd: 500_000_000,
          missingTokenRequests: 1,
          missingCostRequests: 1,
        },
      ]);
      expect(
        (
          await queryAiUsage({
            db: harness.db,
            organizationId: "org-1",
            query: { ...query, taskId: "another-task" },
          })
        ).models
      ).toEqual([]);
      await expect(
        recordAiUsage(harness.db, {
          ...record,
          cost: { nanoUsd: 1, kind: "provider_reported" },
        })
      ).rejects.toThrow("identity conflicts");
    } finally {
      harness.close();
    }
  });

  it("defaults to unlimited and applies a configured daily allowance only to platform spend", async () => {
    const harness = createHarness();
    try {
      await recordAiUsage(harness.db, record);
      await recordAiUsage(harness.db, {
        ...record,
        runtime: "local",
        eventId: "local-1",
        cost: { nanoUsd: 9_000_000_000, kind: "provider_estimate" },
      });
      const input = { db: harness.db, organizationId: "org-1", nowMs };
      expect(await readAiUsageAllowance(input)).toMatchObject({
        dailyLimitNanoUsd: null,
        usedNanoUsd: 500_000_000,
        exhausted: false,
      });
      harness.run({
        sql: "INSERT INTO organization_ai_usage_policies VALUES (?, ?, ?)",
        params: ["org-1", 500_000_000, nowMs],
      });
      expect(await readAiUsageAllowance(input)).toMatchObject({
        exhausted: true,
      });
      expect(
        await readAiUsageAllowance({ ...input, nowMs: nowMs + 86_400_000 })
      ).toMatchObject({ usedNanoUsd: 0, exhausted: false });
    } finally {
      harness.close();
    }
  });
});

function createHarness() {
  const harness = createSqliteD1Harness();
  // Identity is a foreign-key fixture; usage tables use their real migrations.
  harness.run({ sql: "CREATE TABLE organizations (id TEXT PRIMARY KEY)" });
  for (const organizationId of ["org-1", "org-2"]) {
    harness.run({
      sql: "INSERT INTO organizations (id) VALUES (?)",
      params: [organizationId],
    });
  }
  applyDrizzleMigrationForTable(harness, "ai_usage_records");
  applyDrizzleMigrationForTable(harness, "organization_ai_usage_policies");
  return harness;
}
