import { afterEach, describe, expect, it, vi } from "vitest";
import { queryAiUsage } from "../src/usage/ai-usage-repository";
import { recordAcceptedLocalAiUsage } from "../src/usage/local-ai-usage";
import { createPostgresHarness } from "./helpers/postgresql-harness.test-support";

vi.mock(
  "../src/runtime-transport/infrastructure/postgresql/runtime-coordinator-execution-repo",
  () => ({
    readRuntimeCoordinatorExecutionProjectionById: async () => ({
      dispatchId: "dispatch-1",
      targetProfileId: "agent-1",
      spaceId: "space-1",
      openMeldServiceRuntimeId: { value: "runtime-1" },
      agentControllerRef: "builtin:codex",
    }),
  })
);
vi.mock(
  "../src/runtime-registry/infrastructure/postgresql/runtime-registry-repo",
  () => ({
    readRuntimeRegistryRecordByRuntimeId: async () => ({
      status: "found",
      record: {
        runtimeLookupInput: { owner: { id: "user-1" }, deviceId: "device-1" },
      },
    }),
  })
);

let harness: Awaited<ReturnType<typeof createPostgresHarness>> | undefined;
afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

async function fixture() {
  harness = await createPostgresHarness();

  await harness.query({
    text: 'INSERT INTO "openmeld"."organizations" (id, "name", "slug", "created_at") VALUES (\'org-1\', \'Test Organization\', (\'org-1\')::text, 1700000000000)',
  });
  await harness.query({
    text: "INSERT INTO \"openmeld\".\"openMeldDaemon_owned_devices\" (owner_user_id, device_id, connected_computer_id, first_seen_at_ms, updated_at_ms) VALUES ('user-1', 'device-1', 'computer-1', 1, 1)",
  });

  // Other envelope fields are owned by the authenticated result-inbox receiver.
  const input = {
    db: harness.db,
    identityDb: harness.db,
    dispatchMessage: {
      organizationId: "org-1",
      dispatchId: "dispatch-1",
      targetProfileId: "agent-1",
      spaceId: "space-1",
      taskId: "task-1",
    },
    inboxRecord: {
      dispatchId: "dispatch-1",
      targetProfileId: "agent-1",
      taskId: "task-1",
      attemptId: "attempt-1",
      runtimeCoordinatorExecutionId: "execution-1",
      taskResult: {
        payload: {
          telemetry: {
            aiUsage: [
              {
                eventId: "codex:thread-1:turn-1:110",
                provider: "openai",
                model: "gpt-5.5",
                source: "codex_event",
                occurredAtMs: 1000,
                tokens: {
                  input: 100,
                  output: 10,
                  total: 110,
                  cacheRead: 40,
                  cacheWrite: null,
                  reasoning: 5,
                },
                cost: null,
              },
            ],
          },
        },
      },
    },
  } as unknown as Parameters<typeof recordAcceptedLocalAiUsage>[0];
  return input;
}

describe("Accepted Local Agent consumption", () => {
  it("attributes native receipts to the accepted organization, task, and connected Computer once", async () => {
    const input = await fixture();
    await recordAcceptedLocalAiUsage(input);
    await recordAcceptedLocalAiUsage(input);
    const query = {
      fromMs: 0,
      toMs: 2000,
      computerId: "computer-1",
      taskId: "task-1",
      dispatchId: "dispatch-1",
    };
    const usage = await queryAiUsage({
      db: input.db,
      organizationId: "org-1",
      query,
    });
    expect(usage.models).toMatchObject([
      {
        runtime: "local",
        provider: "openai",
        requests: 1,
        inputTokens: 100,
        outputTokens: 10,
        totalTokens: 110,
        missingCostRequests: 1,
        reportedCostNanoUsd: 0,
      },
    ]);
    expect(
      (
        await queryAiUsage({
          db: input.db,
          organizationId: "another-org",
          query,
        })
      ).models
    ).toEqual([]);
    expect(
      (
        await queryAiUsage({
          db: input.db,
          organizationId: "org-1",
          query: { ...query, computerId: "device-1" },
        })
      ).models
    ).toEqual([]);
  });

  it("rejects a result belonging to another execution without recording its consumption", async () => {
    const input = await fixture();
    input.inboxRecord.targetProfileId = "wrong-agent";
    await expect(recordAcceptedLocalAiUsage(input)).rejects.toThrow(
      "matching accepted execution"
    );
    expect(
      (
        await queryAiUsage({
          db: input.db,
          organizationId: "org-1",
          query: { fromMs: 0, toMs: 2000 },
        })
      ).models
    ).toEqual([]);
  });
});
