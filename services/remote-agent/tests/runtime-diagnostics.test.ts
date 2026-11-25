import { remoteAgentWorkerRuntimeDiagnosticsResponseSchema } from "@openmeld/schemas";
import { describe, expect, it } from "vitest";
import { readRemoteAgentRuntimeDiagnostics } from "../flue-adapter/runtime-diagnostics";
import { createCloudflareSqlHarness } from "./helpers/cloudflare-sql-harness.test-support";

type QueryFixture = {
  match: string;
  rows: Record<string, unknown>[];
};

class FakeSqlCursor {
  private readonly rows: Record<string, unknown>[];

  constructor(rows: Record<string, unknown>[]) {
    this.rows = rows;
  }

  toArray(): Record<string, unknown>[] {
    return [...this.rows];
  }
}

class FakeSqlStorage {
  private readonly fixtures: QueryFixture[];
  readonly statements: string[] = [];

  constructor(fixtures: QueryFixture[]) {
    this.fixtures = fixtures;
  }

  exec(query: string): FakeSqlCursor {
    this.statements.push(query);
    const fixture = this.fixtures.find(({ match }) => query.includes(match));
    return new FakeSqlCursor(fixture?.rows ?? []);
  }
}

describe("Remote Agent runtime diagnostics", () => {
  it("reads scheduled work through the SDK after the legacy table is removed", async () => {
    const sql = new FakeSqlStorage([]);
    const exec = sql.exec.bind(sql);
    sql.exec = (query: string) => {
      if (query.includes("cf_agents_schedules")) {
        throw new Error("no such table: cf_agents_schedules");
      }
      return exec(query);
    };
    const result = await readRemoteAgentRuntimeDiagnostics({
      getAlarmAtMs: async () => 10_000,
      listSchedules: async () => [
        {
          id: "schedule-1",
          callback: "retryCallback",
          payload: { secret: "private" },
          type: "delayed",
          time: 9,
          delayInSeconds: 5,
        },
      ],
      nowMs: 1000,
      spaceId: "space-1",
      sql,
    });
    expect(result.v).toBe(3);
    expect(result.schedules).toEqual([
      {
        id: "schedule-1",
        callback: "retryCallback",
        type: "delayed",
        timeMs: 9000,
        delayInSeconds: 5,
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("private");
  });
  it("bounds the schedule projection and preserves SDK read failures", async () => {
    const input = {
      getAlarmAtMs: async () => null,
      listSchedules: async () =>
        Array.from({ length: 52 }, (_, i) => ({
          id: `schedule-${i}`,
          callback: "retryCallback",
          type: "scheduled" as const,
          time: i,
          payload: "private",
        })),
      nowMs: 1000,
      spaceId: "space-1",
      sql: new FakeSqlStorage([]),
    };
    const result = await readRemoteAgentRuntimeDiagnostics(input);
    expect(result.schedules).toHaveLength(50);
    expect(result.schedules[0]?.timeMs).toBe(51_000);
    await expect(
      readRemoteAgentRuntimeDiagnostics({
        ...input,
        listSchedules: () => Promise.reject(new Error("SDK read failed")),
      })
    ).rejects.toThrow("SDK read failed");
  });
  it("reads the actual pinned Flue submission schema without legacy tables", async () => {
    const directory = await mkdtemp(join(tmpdir(), "flue-diagnostics-"));
    const path = join(directory, "flue.sqlite");
    const adapter = sqlite(path);
    await adapter.migrate?.();
    const stores = await adapter.connect();
    await stores.submissionStore.admitDispatch({
      submissionId: "diagnostic-submission",
      agent: "center-agent-v2",
      id: "diagnostic-session",
      acceptedAt: "2026-09-06T00:00:00.000Z",
      message: {
        kind: "user",
        body: "Private input must not appear in diagnostics.",
      },
    });
    const database = new DatabaseSync(path);
    const realSql = createCloudflareSqlHarness(database);
    try {
      const result = await readRemoteAgentRuntimeDiagnostics({
        getAlarmAtMs: async () => null,
        listSchedules: async () => [],
        spaceId: "space-1",
        sql: {
          exec: (query, ...bindings) =>
            query.includes("flue_agent_")
              ? realSql.exec(query, ...bindings)
              : { toArray: () => [] },
        },
      });
      expect(result.submissions).toHaveLength(1);
      expect(result.submissions[0]).toMatchObject({
        submissionId: "diagnostic-submission",
        status: "queued",
        maxAttempts: 10,
      });
      expect(JSON.stringify(result)).not.toContain("Private input");
    } finally {
      database.close();
      await adapter.close?.();
      await rm(directory, { force: true, recursive: true });
    }
  });
  it("projects bounded persisted queue, attempt, fiber, and schedule facts without sensitive payloads", async () => {
    const sql = new FakeSqlStorage([
      {
        match: "FROM flue_agent_submissions",
        rows: [
          {
            abort_requested_at: null,
            accepted_at: 100,
            attempt_count: 2,
            attempt_id: "attempt-1",
            canonical_ready_at: 110,
            input_applied_at: 120,
            kind: "dispatch",
            lease_expires_at: 500,
            max_attempts: 10,
            owner_id: "owner-1",
            joined_into: null,
            sequence: 7,
            settled_at: null,
            started_at: 115,
            status: "running",
            submission_id: "dispatch-1",
            timeout_at: 1000,
          },
        ],
      },
      {
        match: "FROM cf_agents_runs",
        rows: [{ created_at: 115, id: "run-1", name: "flue:dispatch" }],
      },
      {
        match: "FROM cf_agents_fibers",
        rows: [
          {
            completed_at: null,
            created_at: 114,
            fiber_id: "fiber-1",
            idempotency_key: null,
            name: "flue:dispatch",
            started_at: 115,
            status: "running",
          },
        ],
      },
      {
        match: "AS turn_observability",
        rows: [
          {
            key: "openmeld:remote-agent:turn-observability:dispatch-1",
            value_json: JSON.stringify({
              budgetExhaustedAtMs: null,
              capabilityDescribeCount: 0,
              capabilitySearchCount: 1,
              codeModeToolCallCount: 1,
              directToolCallCount: 1,
              expiresAtMs: 10_000,
              firstAssistantTextAtMs: 150,
              firstModelEventAtMs: 140,
              firstProviderRequestPreparedAtMs: 135,
              firstProviderResponseHeadersAtMs: 138,
              firstVisibleContentAtMs: null,
              lastModelCompletedAtMs: null,
              modelCallCount: 0,
              modelId: "openai/gpt-5.4",
              providerAvailableToolCount: 80,
              providerDeferredToolCount: 68,
              providerExposedToolCount: 12,
              providerRequestCount: 1,
              recentCapabilityDiscovery: [],
              recentProviderRequests: [],
              recentToolCalls: [],
              submissionId: "dispatch-1",
              toolCallCount: 2,
              toolCallLimit: 64,
              updatedAtMs: 150,
              v: 1,
            }),
          },
        ],
      },
      {
        match: "FROM openmeld_remote_agent_adapter_kv",
        rows: [
          {
            updated_at_ms: 130,
            value_json: JSON.stringify({
              callbackAttempts: 1,
              conversationCompaction: { v: 1, count: 3, completedAtMs: 129 },
              callbackCompletedAt: null,
              callbackNextAttemptAt: "1970-01-01T00:00:05.000Z",
              callbackStatus: "retryable",
              completedText: "Sensitive model response",
              dispatchId: "dispatch-1",
              lastCoreResponse: {
                reasonCode: "remote_agent.callback_failure_publish_failed",
                status: "retryable",
              },
              lastFailureFact: {
                code: "remote_agent.core_callback_failed",
                detail: "Sensitive failure detail",
              },
              submissionId: "dispatch-1",
            }),
          },
        ],
      },
    ]);

    const result = await readRemoteAgentRuntimeDiagnostics({
      getAlarmAtMs: () => Promise.resolve(850),
      listSchedules: async () => [
        {
          id: "schedule-1",
          callback: "retryCallback",
          payload: "private",
          type: "delayed",
          time: 900,
          delayInSeconds: 10,
        },
      ],
      nowMs: 1000,
      spaceId: "space-1",
      sql,
    });

    expect(
      remoteAgentWorkerRuntimeDiagnosticsResponseSchema.parse(result)
    ).toEqual({
      activeRuns: [{ createdAtMs: 115, id: "run-1", name: "flue:dispatch" }],
      callbackContexts: [
        {
          conversationCompaction: { v: 1, count: 3, completedAtMs: 129 },
          callbackAttempts: 1,
          callbackCompletedAt: null,
          callbackNextAttemptAt: "1970-01-01T00:00:05.000Z",
          callbackStatus: "retryable",
          dispatchId: "dispatch-1",
          hasCompletedText: true,
          lastCoreResponseReasonCode:
            "remote_agent.callback_failure_publish_failed",
          lastCoreResponseStatus: "retryable",
          lastFailureCode: "remote_agent.core_callback_failed",
          submissionId: "dispatch-1",
          updatedAtMs: 130,
        },
      ],
      collectedAt: "1970-01-01T00:00:01.000Z",
      durableObjectAlarmAtMs: 850,
      fibers: [
        {
          completedAtMs: null,
          createdAtMs: 114,
          fiberId: "fiber-1",
          idempotencyKey: null,
          name: "flue:dispatch",
          startedAtMs: 115,
          status: "running",
        },
      ],
      schedules: [
        {
          callback: "retryCallback",
          delayInSeconds: 10,
          id: "schedule-1",
          timeMs: 900_000,
          type: "delayed",
        },
      ],
      spaceId: "space-1",
      submissions: [
        {
          abortRequestedAtMs: null,
          acceptedAtMs: 100,
          attemptCount: 2,
          attemptId: "attempt-1",
          canonicalReadyAtMs: 110,
          inputAppliedAtMs: 120,
          kind: "dispatch",
          leaseExpiresAtMs: 500,
          maxAttempts: 10,
          ownerId: "owner-1",
          joinedInto: null,
          sequence: 7,
          settledAtMs: null,
          startedAtMs: 115,
          status: "running",
          submissionId: "dispatch-1",
          timeoutAtMs: 1000,
        },
      ],
      turnObservability: [
        {
          budgetExhaustedAtMs: null,
          capabilityDescribeCount: 0,
          capabilitySearchCount: 1,
          codeModeToolCallCount: 1,
          directToolCallCount: 1,
          firstAssistantTextAtMs: 150,
          firstModelEventAtMs: 140,
          firstProviderRequestPreparedAtMs: 135,
          firstProviderResponseHeadersAtMs: 138,
          firstVisibleContentAtMs: null,
          lastModelCompletedAtMs: null,
          modelCallCount: 0,
          modelId: "openai/gpt-5.4",
          providerAvailableToolCount: 80,
          providerDeferredToolCount: 68,
          providerExposedToolCount: 12,
          providerRequestCount: 1,
          recentCapabilityDiscovery: [],
          recentProviderRequests: [],
          recentToolCalls: [],
          submissionId: "dispatch-1",
          toolCallCount: 2,
          toolCallLimit: 64,
          updatedAtMs: 150,
        },
      ],
      v: 3,
    });

    const statements = sql.statements.join("\n").toLowerCase();
    expect(statements).not.toContain("payload");
    expect(statements).not.toContain("snapshot");
    expect(statements).not.toContain("settlement_record_json");
    expect(statements).not.toContain("metadata_json");
    expect(JSON.stringify(result)).not.toContain("Sensitive model response");
    expect(JSON.stringify(result)).not.toContain("Sensitive failure detail");
  });
});

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { sqlite } from "@flue/runtime/node";
