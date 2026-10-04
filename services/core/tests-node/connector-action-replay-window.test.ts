import type { PostgresDatabase } from "@openmeld/db/postgresql";
import { describe, expect, it } from "vitest";
import {
  readConnectorActionReplayPermission,
  recordCenterAgentConnectorActionOperation,
  resolveConnectorActionReplayWindowRemainingMs,
} from "../src/center-agent/connector-action-operation-repository";
import { createPostgresHarness } from "./helpers/postgresql-harness.test-support";

describe("original provider replay window", () => {
  const hour = 60 * 60 * 1000;
  it.each([
    { elapsed: 0, remaining: 24 * hour },
    { elapsed: 23 * hour, remaining: hour },
    { elapsed: 24 * hour, remaining: 0 },
    { elapsed: 25 * hour, remaining: 0 },
    { elapsed: -1, remaining: 0 },
  ])("does not renew the original reservation after $elapsed ms", ({
    elapsed,
    remaining,
  }) => {
    expect(
      resolveConnectorActionReplayWindowRemainingMs(1000, 1000 + elapsed)
    ).toBe(remaining);
  });
});

describe("durable connector execution admission", () => {
  const fixture = (db: PostgresDatabase) => ({
    db,
    actionId: "linear.create_issue",
    actorProfileId: "agt_00000000-0000-4000-8000-000000000001",
    organizationId: "org-1",
    operationId: "original-operation",
    sourceRequestKey: "native:submission-1",
    effectSignature: "a".repeat(64),
    requestSignature: "b".repeat(64),
    service: "linear",
    connectionName: "linear-personal",
    connectionUpdatedAtMs: 1000,
    executionConnection: {
      service: "linear" as const,
      connectionName: "linear-personal",
      ownerUserId: "user-1",
      ownerDisplayName: "Synthetic member",
      scope: "member" as const,
    },
    requester: {
      kind: "represented_member" as const,
      representedUserId: "user-1",
    },
    attribution: {
      actorProfileId: "agt_00000000-0000-4000-8000-000000000001",
      onBehalfOf: {
        userId: "user-1",
        profileId: "22222222-2222-4222-8222-222222222222",
        displayName: "Synthetic member",
      },
    },
    providerExecutionId: null,
    nowMs: 10_000,
  });
  const storage = async () => {
    const harness = await createPostgresHarness();

    await harness.query({
      text: "INSERT INTO \"openmeld\".\"users\" (id, name, email, created_at, updated_at) VALUES ('user-1', 'Synthetic member', 'synthetic@example.test', 1000, 1000)",
      values: [],
    });
    await harness.query({
      text: "INSERT INTO \"openmeld\".\"organizations\" (id, name, slug, created_at) VALUES ('org-1', 'Synthetic organization', 'synthetic', 1000)",
      values: [],
    });
    await harness.query({
      text: "INSERT INTO \"openmeld\".\"openmeld_profiles\" (profile_id, profile_name, profile_handle, profile_kind, organization_id, owner_user_id, source) VALUES ('agt_00000000-0000-4000-8000-000000000001', 'Synthetic Agent', 'synthetic-agent', 'agent', 'org-1', 'user-1', 'cli_create')",
      values: [],
    });
    await harness.query({
      text: "INSERT INTO \"openmeld\".\"openmeld_profiles\" (profile_id, profile_name, profile_handle, profile_kind, organization_id, owner_user_id, source) VALUES ('22222222-2222-4222-8222-222222222222', 'Synthetic member', 'synthetic-member', 'human', NULL, 'user-1', 'cli_create')",
      values: [],
    });
    return harness;
  };

  it("admits one initial attempt and one replay across concurrency and fresh reads", async () => {
    const harness = await storage();
    try {
      const operation = fixture(harness.db);
      const attempt = () =>
        recordCenterAgentConnectorActionOperation({
          ...operation,
          outcome: "attempted",
          allowReplay: true,
        });
      const initial = await Promise.all([attempt(), attempt()]);
      expect(initial.filter((result) => result.executionAllowed)).toHaveLength(
        1
      );
      expect(
        await readConnectorActionReplayPermission({
          db: harness.db,
          operation: initial[0].operation,
          nowMs: 10_001,
        })
      ).toMatchObject({ allowed: false, reason: "operation_in_progress" });
      const unknown = await recordCenterAgentConnectorActionOperation({
        ...operation,
        outcome: "outcome_unknown",
      });
      expect(
        await readConnectorActionReplayPermission({
          db: harness.db,
          operation: unknown.operation,
          nowMs: 10_001,
        })
      ).toMatchObject({ allowed: true, maxAttempts: 1 });
      const replay = await Promise.all([attempt(), attempt()]);
      expect(replay.filter((result) => result.executionAllowed)).toHaveLength(
        1
      );
      expect((await attempt()).executionAllowed).toBe(false);
      expect(
        await readConnectorActionReplayPermission({
          db: harness.db,
          operation: unknown.operation,
          nowMs: 10_001,
        })
      ).toEqual({ allowed: false, reason: "already_replayed" });
      const duplicate = await recordCenterAgentConnectorActionOperation({
        ...operation,
        operationId: "new-id-same-effect",
        outcome: "attempted",
        allowReplay: true,
      });
      expect(duplicate).toMatchObject({
        executionAllowed: false,
        operation: {
          operationId: "original-operation",
          status: "outcome_unknown",
        },
      });
      const newRequest = await recordCenterAgentConnectorActionOperation({
        ...operation,
        sourceRequestKey: "native:explicit-new-request",
        operationId: "new-request-operation",
        outcome: "attempted",
      });
      expect(newRequest.executionAllowed).toBe(true);
    } finally {
      await harness.close();
    }
  });

  it.each([
    "missing_permission",
    "missing_account_version",
    "at_24h",
    "after_24h",
  ] as const)("does not consume provider work for %s", async (scenario) => {
    const harness = await storage();
    try {
      const operation = fixture(harness.db);
      await recordCenterAgentConnectorActionOperation({
        ...operation,
        outcome: "attempted",
      });
      const unknown = await recordCenterAgentConnectorActionOperation({
        ...operation,
        outcome: "outcome_unknown",
      });
      if (scenario === "missing_account_version") {
        await harness.query({
          text: 'UPDATE "openmeld"."center_agent_connector_action_operations" SET connection_updated_at_ms = NULL',
          values: [],
        });
        expect(
          await readConnectorActionReplayPermission({
            db: harness.db,
            operation: { ...unknown.operation, connectionUpdatedAtMs: null },
            nowMs: operation.nowMs + 1,
          })
        ).toEqual({ allowed: false, reason: "original_account_unverified" });
      }
      const result = await recordCenterAgentConnectorActionOperation({
        ...operation,
        connectionUpdatedAtMs:
          scenario === "missing_account_version"
            ? null
            : operation.connectionUpdatedAtMs,
        outcome: "attempted",
        allowReplay: scenario !== "missing_permission",
        nowMs:
          operation.nowMs +
          (scenario === "missing_permission" ||
          scenario === "missing_account_version"
            ? 1
            : 86_400_000 + (scenario === "after_24h" ? 1 : 0)),
      });
      expect(result.executionAllowed).toBe(false);
      expect(
        await harness.db
          .query({
            text: 'SELECT id FROM "openmeld"."center_agent_audit_journal" WHERE id = $1',
            values: [`${result.operation.id}:replay_attempted`],
          })
          .then((result) => result.rows[0] ?? null)
      ).toBeNull();
    } finally {
      await harness.close();
    }
  });
});
