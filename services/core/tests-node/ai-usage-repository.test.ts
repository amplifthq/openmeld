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
  status: "reported",
  providerRequestId: "request-1",
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
  it("buckets native receipts at calendar boundaries without losing missing usage or crossing scope", async () => {
    const harness = createHarness();
    // New York's spring transition contains a 23-hour day, followed by two full days.
    const edges: [number, number, number, number] = [
      Date.parse("2026-03-08T05:00:00Z"),
      Date.parse("2026-03-09T04:00:00Z"),
      Date.parse("2026-03-10T04:00:00Z"),
      Date.parse("2026-03-11T04:00:00Z"),
    ];
    try {
      for (const [index, receipt] of [
        { occurredAtMs: edges[0] - 1 },
        { occurredAtMs: edges[0], controller: "builtin:codex" },
        { occurredAtMs: edges[1] - 1, controller: "builtin:claude-code" },
        {
          occurredAtMs: edges[1],
          tokens: null,
          status: "unavailable" as const,
        },
        { occurredAtMs: edges[3] },
        { occurredAtMs: edges[0], organizationId: "org-2" },
        { occurredAtMs: edges[0], computerId: "computer-2" },
      ].entries()) {
        await recordAiUsage(harness.db, {
          ...record,
          runtime: "local",
          computerId: "computer-1",
          ...receipt,
          eventId: `bucket-${index}`,
        });
      }
      const result = await queryAiUsage({
        db: harness.db,
        organizationId: "org-1",
        query: {
          fromMs: edges[0],
          toMs: edges[3],
          runtime: "local",
          computerId: "computer-1",
          bucketBoundariesMs: edges,
          groupBy: "task",
          includeIssues: true,
        },
      });
      expect(result.timeSeries).toEqual([
        {
          fromMs: edges[0],
          toMs: edges[1],
          requests: 2,
          inputTokens: 200,
          outputTokens: 40,
          totalTokens: 240,
          missingTokenRequests: 0,
        },
        {
          fromMs: edges[1],
          toMs: edges[2],
          requests: 1,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          missingTokenRequests: 1,
        },
        {
          fromMs: edges[2],
          toMs: edges[3],
          requests: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          missingTokenRequests: 0,
        },
      ]);
      expect(result.models[0]?.totalTokens).toBe(240);
      expect(result.breakdown?.groups[0]?.totalTokens).toBe(240);
      expect(result.issues?.records).toHaveLength(1);
      const grouped = await queryAiUsage({
        db: harness.db,
        organizationId: "org-1",
        query: {
          fromMs: edges[0],
          toMs: edges[3],
          runtime: "local",
          computerId: "computer-1",
          bucketBoundariesMs: edges,
          groupTimeSeriesBy: "controller",
        },
      });
      expect(grouped.timeSeries?.[0]?.controllers).toEqual([
        {
          controller: "builtin:claude-code",
          requests: 1,
          inputTokens: 100,
          outputTokens: 20,
          totalTokens: 120,
          missingTokenRequests: 0,
        },
        {
          controller: "builtin:codex",
          requests: 1,
          inputTokens: 100,
          outputTokens: 20,
          totalTokens: 120,
          missingTokenRequests: 0,
        },
      ]);
      expect(grouped.timeSeries?.[1]?.controllers).toEqual([
        {
          controller: null,
          requests: 1,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          missingTokenRequests: 1,
        },
      ]);
      expect(grouped.timeSeries?.[2]?.controllers).toEqual([]);
      expect(
        grouped.timeSeries?.map(
          ({ controllers: _controllers, ...bucket }) => bucket
        )
      ).toEqual(result.timeSeries);
      await expect(
        queryAiUsage({
          db: harness.db,
          organizationId: "org-1",
          query: {
            fromMs: edges[0],
            toMs: edges[3],
            bucketBoundariesMs: [edges[0], edges[0], edges[3]],
          },
        })
      ).rejects.toThrow("Buckets must increase strictly");
    } finally {
      harness.close();
    }
  });
  it("isolates one local controller on one enrolled computer across model and task reads", async () => {
    const harness = createHarness();
    try {
      for (const [eventId, organizationId, computerId, controller] of [
        ["codex", "org-1", "computer-1", "builtin:codex"],
        ["claude", "org-1", "computer-1", "builtin:claude-code"],
        ["other-computer", "org-1", "computer-2", "builtin:codex"],
        ["other-org", "org-2", "computer-1", "builtin:codex"],
      ] as const) {
        await recordAiUsage(harness.db, {
          ...record,
          eventId,
          organizationId,
          computerId,
          controller,
          runtime: "local",
          cost: null,
        });
      }
      const result = await queryAiUsage({
        db: harness.db,
        organizationId: "org-1",
        query: {
          ...query,
          runtime: "local",
          computerId: "computer-1",
          controller: "builtin:codex",
          groupBy: "task",
        },
      });
      expect(result.models).toMatchObject([
        { requests: 1, totalTokens: 120, missingCostRequests: 1 },
      ]);
      expect(result.breakdown?.groups).toMatchObject([
        { taskId: "task-1", requests: 1, totalTokens: 120 },
      ]);
      expect(result.coverage?.reportedRequests).toBe(1);
    } finally {
      harness.close();
    }
  });
  it("ranks observed tasks and Agents without conflating retries, unknown cost, or other organizations", async () => {
    const harness = createHarness();
    try {
      if (!record.tokens) {
        throw new Error("Fixture requires native tokens");
      }
      for (const value of [
        {
          ...record,
          eventId: "first",
          taskId: "task-a",
          attemptId: "attempt-a",
          dispatchId: "dispatch-a",
        },
        {
          ...record,
          eventId: "retry",
          taskId: "task-a",
          attemptId: "attempt-b",
          dispatchId: "dispatch-a",
        },
        {
          ...record,
          eventId: "tool-loop",
          taskId: "task-a",
          attemptId: "attempt-b",
          dispatchId: "dispatch-a",
        },
        {
          ...record,
          eventId: "local",
          runtime: "local" as const,
          taskId: "task-local",
          agentProfileId: "local-agent",
          attemptId: "local-attempt",
          cost: null,
          tokens: { ...record.tokens, total: 999, input: 979 },
        },
        {
          ...record,
          eventId: "other-org",
          organizationId: "org-2",
          cost: { nanoUsd: 9_000_000_000, kind: "provider_reported" as const },
        },
      ]) {
        await recordAiUsage(harness.db, value);
      }
      const result = await queryAiUsage({
        db: harness.db,
        organizationId: "org-1",
        nowMs,
        query: { ...query, groupBy: "task", sortBy: "cost", limit: 1 },
      });
      expect(result.breakdown).toMatchObject({
        hasMore: true,
        groups: [
          {
            taskId: "task-a",
            requests: 3,
            reportedCostNanoUsd: 1_500_000_000,
            observedExecutionAttempts: 2,
            observedExecutionRetries: 1,
            dispatchIds: ["dispatch-a"],
          },
        ],
      });
      expect(result.models).toHaveLength(2);
      const local = await queryAiUsage({
        db: harness.db,
        organizationId: "org-1",
        nowMs,
        query: { ...query, groupBy: "agent", sortBy: "tokens", limit: 1 },
      });
      expect(local.breakdown?.groups[0]).toMatchObject({
        agentProfileId: "local-agent",
        totalTokens: 999,
        missingCostRequests: 1,
        observedExecutionRetries: null,
      });
    } finally {
      harness.close();
    }
  });

  it("exposes old pending, missing supplier evidence, and collection failures separately", async () => {
    const harness = createHarness();
    try {
      for (const [index, status] of (
        ["pending", "unavailable", "collection_failed"] as const
      ).entries()) {
        await recordAiUsage(harness.db, {
          ...record,
          eventId: `coverage-${index}`,
          status,
          tokens: null,
          cost: null,
        });
      }
      const usage = await queryAiUsage({
        db: harness.db,
        organizationId: "org-1",
        nowMs: nowMs + 3_600_001,
        query: { ...query, includeIssues: true, limit: 1 },
      });
      expect(usage.issues).toMatchObject({
        hasMore: true,
        records: [
          {
            eventId: "coverage-0",
            status: "pending",
            tokens: null,
            cost: null,
          },
        ],
      });
      expect(usage.coverage).toEqual({
        scope: "observed_requests",
        reportedRequests: 0,
        pendingRequests: 1,
        stalePendingRequests: 1,
        unavailableRequests: 1,
        collectionFailedRequests: 1,
        missingTokenRequests: 3,
        missingCostRequests: 3,
        unassignedTaskRequests: 0,
        oldestPendingAtMs: nowMs,
        staleAfterMs: 3_600_000,
      });
      await recordAiUsage(harness.db, { ...record, eventId: "coverage-0" });
      const repaired = await queryAiUsage({
        db: harness.db,
        organizationId: "org-1",
        nowMs: nowMs + 3_600_001,
        query,
      });
      expect(repaired.coverage).toMatchObject({
        pendingRequests: 0,
        stalePendingRequests: 0,
        reportedRequests: 1,
        oldestPendingAtMs: null,
      });
      expect(repaired.models[0]?.requests).toBe(3);
    } finally {
      harness.close();
    }
  });
  it("settles a pending receipt once without changing its execution attribution", async () => {
    const harness = createHarness();
    try {
      await recordAiUsage(harness.db, {
        ...record,
        status: "pending",
        tokens: null,
        cost: null,
        providerRequestId: null,
      });
      await expect(
        recordAiUsage(harness.db, { ...record, taskId: "wrong-task" })
      ).rejects.toThrow("identity conflicts");
      await recordAiUsage(harness.db, record);
      await recordAiUsage(harness.db, record);
      const usage = await queryAiUsage({
        db: harness.db,
        organizationId: "org-1",
        query,
      });
      expect(usage.models).toMatchObject([
        {
          requests: 1,
          totalTokens: 120,
          reportedCostNanoUsd: 500_000_000,
          missingCostRequests: 0,
        },
      ]);
    } finally {
      harness.close();
    }
  });

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
