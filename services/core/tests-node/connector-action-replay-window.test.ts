import type { PostgresDatabase } from "@openmeld/db/postgresql";
import { centerAgentRecordConnectorActionOperationBodySchema } from "@openmeld/schemas";
import type { SpaceTask } from "@openmeld/schemas/types";
import { digestCanonicalJson } from "@openmeld/utils";
import { describe, expect, it } from "vitest";
import {
  buildCenterAgentConnectorActionOperationScope,
  readCenterAgentConnectorActionOperationForRequest,
  readConnectorActionReplayPermission,
  recordCenterAgentConnectorActionOperation,
  resolveConnectorActionReplayWindowRemainingMs,
} from "../src/center-agent/connector-action-operation-repository";
import {
  syncCompletedGitHubIssue,
  verifyGitHubIssueCompletion,
} from "../src/center-agent/github-issue-completion";
import type { CoreBindings } from "../src/lib/bindings";
import { applyGitHubIssueProviderObservation } from "../src/space/application/space-task-workflow";
import { projectSpaceTaskGitHubIssueLinks } from "../src/space/infrastructure/postgresql/space-task-github-issue-link-repo";
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
  it.each([
    "exact",
    "changed-input",
    "changed-issue",
  ])("checks GitHub completion against the recorded request: %s", async (variant) => {
    const actionInput = {
      owner: "acme",
      repo: "app",
      issueNumber: 42,
      state: "closed",
    };
    const signed = {
      actionId: "github.update_issue",
      connectionName: "github-personal",
      githubActor: "requester",
      input: actionInput,
      service: "github",
    };
    const request = centerAgentRecordConnectorActionOperationBodySchema.parse({
      actionId: signed.actionId,
      connectionName: signed.connectionName,
      service: signed.service,
      requestSignature: await digestCanonicalJson(signed),
      operationId: "close-issue",
      outcome: "completed",
      providerExecutionId: "execution-1",
      speakerMember: { memberId: "member-1", userId: "user-1" },
      githubIssueCompletion: {
        githubActor: "requester",
        actionInput:
          variant === "changed-input"
            ? { ...actionInput, state: "open" }
            : actionInput,
        observation: {
          owner: "acme",
          repo: "app",
          number: variant === "changed-issue" ? 43 : 42,
          state: "closed",
          stateReason: "completed",
          updatedAt: "2026-10-11T00:00:00.000Z",
        },
      },
    });
    if (variant === "exact") {
      expect(await verifyGitHubIssueCompletion(request)).toEqual(
        request.githubIssueCompletion?.observation
      );
    } else {
      await expect(verifyGitHubIssueCompletion(request)).rejects.toThrow(
        "github.issue_evidence_mismatch"
      );
    }
  });
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

  it.each([
    ["completed", false],
    ["completed", true],
    ["not_planned", false],
  ] as const)("repairs the GitHub %s observation after a Task sync failure without completing the Task, with reviewer=%s", async (stateReason, reviewer) => {
    const harness = await storage();
    try {
      const observation = {
        owner: "acme",
        repo: "app",
        number: 42,
        state: "closed" as const,
        stateReason,
        updatedAt: "2026-10-11T00:00:00.000Z",
      };
      const operation = {
        ...fixture(harness.db),
        service: "github",
        actionId: "github.update_issue",
        sourceSpaceId: "a".repeat(64),
        executionConnection: {
          ...fixture(harness.db).executionConnection,
          service: "github" as const,
        },
      };
      await recordCenterAgentConnectorActionOperation({
        ...operation,
        outcome: "attempted",
      });
      const completed = await recordCenterAgentConnectorActionOperation({
        ...operation,
        outcome: "completed",
        githubIssueObservation: observation,
      });
      const requester = {
        profileId: "22222222-2222-4222-8222-222222222222",
        profileKind: "human" as const,
        profileName: "Synthetic member",
        ownerUserId: "user-1",
      };
      const task: SpaceTask = {
        taskId: "tsk_55555555-5555-4555-8555-555555555555",
        spaceId: "a".repeat(64),
        title: "Linked issue",
        description: null,
        createdBy: requester,
        requestedBy: requester,
        assignee: null,
        reviewer: reviewer ? requester : null,
        phase: "to_do",
        revision: 1,
        result: null,
        review: null,
        sourceSignalId: null,
        threadId: null,
        createdAt: "2026-10-10T00:00:00.000Z",
        updatedAt: "2026-10-10T00:00:00.000Z",
        projectIds: [],
        completionConditions: [],
        automaticReworkRounds: 0,
        needsHumanDecision: false,
        externalWorkItems: [
          {
            provider: "github",
            owner: "acme",
            repo: "app",
            number: 42,
            url: "https://github.com/acme/app/issues/42",
            lastObservedAt: null,
            lastObservedState: "open",
          },
        ],
      };
      await projectSpaceTaskGitHubIssueLinks({
        db: harness.db,
        organizationId: operation.organizationId,
        spaceId: task.spaceId,
        nowMs: 1000,
        task,
      });
      let fail = true;
      let settledTask = task;
      const env = {
        OPENMELD_SPACES: {
          idFromString: (id: string) => id,
          get: () => ({
            rpcApplyGitHubIssueObservation: () => {
              if (fail) {
                throw new Error("Temporary Space outage");
              }
              const result = applyGitHubIssueProviderObservation({
                task,
                identity: observation,
                observedAt: observation.updatedAt,
                observedState: observation.state,
                observedStateReason: observation.stateReason,
              });
              settledTask = result.observe?.task ?? task;
              return Promise.resolve({ task: settledTask });
            },
          }),
        },
      } as unknown as CoreBindings;
      expect(
        await syncCompletedGitHubIssue({
          env,
          db: harness.db,
          operation: completed.operation,
          sourceSpaceId: operation.sourceSpaceId,
        })
      ).toEqual({ status: "pending", closedTaskIds: [] });
      fail = false;
      const replay = await recordCenterAgentConnectorActionOperation({
        ...operation,
        sourceSpaceId: "different-space",
        outcome: "attempted",
        allowReplay: true,
      });
      expect(replay.operation.status).toBe("completed");
      expect(replay.executionAllowed).toBe(false);
      const stored = await readCenterAgentConnectorActionOperationForRequest({
        db: harness.db,
        actionId: operation.actionId,
        service: operation.service,
        requestSignature: operation.requestSignature,
        scope: buildCenterAgentConnectorActionOperationScope(operation),
      });
      if (!stored) {
        throw new Error("Completed operation must remain readable");
      }
      expect(stored.sourceSpaceId).toBe("a".repeat(64));
      expect(stored?.operation.githubIssueObservation).toEqual(observation);
      expect(
        await syncCompletedGitHubIssue({
          env,
          db: harness.db,
          operation: replay.operation,
          sourceSpaceId: stored.sourceSpaceId,
        })
      ).toEqual({
        status: "settled",
        closedTaskIds: [],
      });
      expect(settledTask.phase).toBe(task.phase);
      expect(settledTask.result).toBeNull();
      await expect(
        recordCenterAgentConnectorActionOperation({
          ...operation,
          outcome: "completed",
          githubIssueObservation: { ...observation, number: 43 },
        })
      ).rejects.toThrow("different final outcome");
    } finally {
      await harness.close();
    }
  });

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
