import type { RemoteAgentWorkerSubmitTurnRequest } from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import { submitRemoteAgentWorkerAdmission } from "../src/remote-agent/application/remote-agent-worker-admission";
import { createSqliteD1Harness } from "./helpers/sqlite-d1-harness.test-support";

describe("Remote Agent worker admission", () => {
  it("rolls a current conversation into one new runtime generation without surfacing the history limit", async () => {
    const harness = createSqliteD1Harness();
    try {
      createRolloverAdmissionTables(harness);
      const request = createRolloverRequest();
      harness.run({
        params: [
          request.organizationId,
          request.idempotencyKey,
          JSON.stringify(request),
        ],
        sql: `
          INSERT INTO openMeldRemoteAgent_native_delivery_ledger (
            organization_id,
            idempotency_key,
            daily_admission_day_utc,
            updated_at_ms,
            worker_submit_request_json,
            execution_recovery_submit_request_json,
            status,
            submission_id
          ) VALUES (?, ?, NULL, 900, ?, NULL, 'submitted', NULL)
        `,
      });
      const workerSubmit = vi
        .fn()
        .mockResolvedValueOnce({
          idempotencyKey: request.idempotencyKey,
          message:
            "Remote Agent rejected the turn before replay because its conversation history reached the safety limit.",
          outcome: "rejected",
          reasonCode: "remote_agent.conversation_history_limit_exceeded",
          v: 1,
        })
        .mockResolvedValueOnce({
          accepted: true,
          createdAt: 1000,
          idempotencyKey: request.idempotencyKey,
          status: "pending",
          submissionId: request.dispatchId,
        });
      const worker = { submitConversationTurn: workerSubmit };

      await expect(
        submitRemoteAgentWorkerAdmission({
          db: harness.db,
          env: {} as CoreBindings,
          nowMs: 1000,
          organizationId: request.organizationId,
          request,
          worker,
        })
      ).resolves.toMatchObject({
        ack: { accepted: true, submissionId: request.dispatchId },
        status: "acknowledged",
      });

      expect(workerSubmit).toHaveBeenCalledTimes(2);
      expect(workerSubmit.mock.calls[0]?.[0]).toMatchObject({
        conversationId: request.spaceId,
        runtimeConversation: { generation: 0, id: request.spaceId },
        v: 4,
      });
      expect(workerSubmit.mock.calls[1]?.[0]).toMatchObject({
        continuityContext: {
          entries: [
            {
              content: { text: "Please investigate the deployment failure." },
              source: {
                kind: "message_channel_message",
                messageId: "slack-message-previous",
                provider: "slack",
              },
            },
          ],
          fromGeneration: 0,
          toGeneration: 1,
        },
        runtimeConversation: { generation: 1 },
        v: 4,
      });
      expect(
        harness.queryFirst<{
          active_generation: number;
          started_at_ms: number | null;
        }>({
          sql: `
            SELECT active_generation, started_at_ms
            FROM openMeldRemoteAgent_conversation_generations
            WHERE organization_id = 'org-1'
              AND logical_conversation_id = 'slack:team:channel:thread'
          `,
        })
      ).toEqual({ active_generation: 1, started_at_ms: 1000 });
      const stored = harness.queryFirst<{ worker_submit_request_json: string }>(
        {
          sql: `
          SELECT worker_submit_request_json
          FROM openMeldRemoteAgent_native_delivery_ledger
          WHERE idempotency_key = 'turn-1'
        `,
        }
      );
      expect(
        JSON.parse(stored?.worker_submit_request_json ?? "null")
      ).toMatchObject({
        request: {
          runtimeConversation: { generation: 1 },
          v: 4,
        },
        storageVersion: 1,
      });
    } finally {
      harness.close();
    }
  });

  it("rejects a paused Center Agent immediately without consuming quota or calling the worker", async () => {
    const workerSubmit = vi.fn();
    const db = pausedCenterAgentDb();
    const request = {
      agentProfileId: "agt-center",
      idempotencyKey: "turn-1",
      v: 1,
    } as RemoteAgentWorkerSubmitTurnRequest;

    await expect(
      submitRemoteAgentWorkerAdmission({
        db,
        env: {
          OPENMELD_DB: db,
          OPENMELD_REMOTE_AGENT_WORKER: {
            submitConversationTurn: workerSubmit,
          },
        } as unknown as CoreBindings,
        nowMs: 1_700_000_000_000,
        organizationId: "org-1",
        request,
        worker: {
          submitConversationTurn: workerSubmit,
        },
      })
    ).resolves.toEqual({
      response: {
        message:
          "Center Agent is paused. Ask the Organization creator to resume it before trying again.",
        reasonCode: "remote_agent.center_agent_paused",
      },
      status: "rejected",
    });

    expect(workerSubmit).not.toHaveBeenCalled();
    expect(db.prepare).toHaveBeenCalledTimes(1);
  });

  it("cancels a Center Agent turn that is paused while worker admission is awaiting its acknowledgement", async () => {
    const cancelExecution = vi.fn(() =>
      Promise.resolve({
        execution: {
          acceptedAtMs: 1_700_000_000_000,
          cancellationReason:
            "Center Agent was paused by the Organization creator.",
          completedAtMs: null,
          idempotencyKey: "turn-1",
          lastProgressAtMs: 1_700_000_000_001,
          lastProgressKind: "cancellation_requested",
          organizationId: "org-1",
          spaceId: "space-1",
          status: "cancellation_requested",
          submissionId: "submission-1",
          v: 1,
        },
        status: "cancellation_requested",
      } as const)
    );
    const workerSubmit = vi.fn(() =>
      Promise.resolve({
        accepted: true,
        createdAt: 1_700_000_000_000,
        idempotencyKey: "turn-1",
        status: "running",
        submissionId: "submission-1",
      } as const)
    );
    const db = centerAgentPauseRaceDb();
    const request = {
      agentProfileId: "agt-center",
      idempotencyKey: "turn-1",
      spaceId: "space-1",
      v: 1,
    } as RemoteAgentWorkerSubmitTurnRequest;
    const worker = {
      cancelExecution,
      submitConversationTurn: workerSubmit,
    };

    await expect(
      submitRemoteAgentWorkerAdmission({
        db,
        env: {
          OPENMELD_DB: db,
          OPENMELD_REMOTE_AGENT_WORKER: worker,
        } as unknown as CoreBindings,
        nowMs: 1_700_000_000_000,
        organizationId: "org-1",
        request,
        worker,
      })
    ).resolves.toMatchObject({
      ack: {
        accepted: true,
        submissionId: "submission-1",
      },
      status: "acknowledged",
    });

    expect(workerSubmit).toHaveBeenCalledOnce();
    expect(cancelExecution).toHaveBeenCalledWith({
      idempotencyKey: "turn-1",
      organizationId: "org-1",
      reason: "Center Agent was paused by the Organization creator.",
      spaceId: "space-1",
      submissionId: "submission-1",
      v: 1,
    });
  });
});

function createRolloverAdmissionTables(
  harness: ReturnType<typeof createSqliteD1Harness>
): void {
  harness.run({
    sql: `
      CREATE TABLE openMeldRemoteAgent_native_delivery_ledger (
        organization_id TEXT NOT NULL,
        idempotency_key TEXT PRIMARY KEY,
        daily_admission_day_utc TEXT,
        updated_at_ms INTEGER NOT NULL,
        worker_submit_request_json TEXT,
        execution_recovery_submit_request_json TEXT,
        status TEXT NOT NULL,
        submission_id TEXT
      )
    `,
  });
  harness.run({
    sql: `
      CREATE TABLE openMeldRemoteAgent_daily_admissions (
        organization_id TEXT NOT NULL,
        day_utc TEXT NOT NULL,
        admitted_count INTEGER NOT NULL,
        last_admission_idempotency_key TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        PRIMARY KEY (organization_id, day_utc)
      )
    `,
  });
  harness.run({
    sql: `
      CREATE TABLE openMeldRemoteAgent_conversation_generations (
        organization_id TEXT NOT NULL,
        logical_conversation_id TEXT NOT NULL,
        active_generation INTEGER NOT NULL,
        started_at_ms INTEGER,
        rollover_delivery_id TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        PRIMARY KEY (organization_id, logical_conversation_id)
      )
    `,
  });
}

function createRolloverRequest(): RemoteAgentWorkerSubmitTurnRequest {
  return {
    v: 2,
    organizationId: "org-1",
    spaceId: "slack:team:channel:thread",
    agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
    agentProfileOwnerUserId: "user-1",
    bindingId: "binding-1",
    triggerMessageId: "slack-message-current",
    dispatchId: "delivery-1",
    sourceClientMessageId: null,
    idempotencyKey: "turn-1",
    messages: [{ content: "Continue the investigation.", role: "user" }],
    author: {
      displayName: "Center Agent",
      profileId: "agt_11111111-1111-4111-8111-111111111111",
      profileKind: "agent",
    },
    onBehalfOf: {
      displayName: "Felix",
      profileId: "00000000-0000-4000-8000-000000000001",
      profileKind: "human",
    },
    modelRoute: {
      automaticModelFallback: false,
      catalogUpdatedAt: "2026-08-11T00:00:00.000Z",
      contextWindow: 1_000_000,
      displayName: "Test model",
      imageUnderstandingModel: {
        contextWindow: 128_000,
        displayName: "Test vision model",
        inputModalities: ["text", "image"],
        maxOutputTokens: 8192,
        modelId: "test/vision",
        provider: "openrouter",
        reasoningLevel: "medium",
      },
      inputModalities: ["text"],
      maxOutputTokens: 8192,
      modelId: "test/model",
      preference: { kind: "system_default" },
      provider: "openrouter",
      reasoningLevel: "medium",
    },
    turnEnvelope: {
      sender: {
        displayName: "Felix",
        id: "member-1",
        kind: "member",
        ownerUserId: "user-1",
        profileId: "00000000-0000-4000-8000-000000000001",
        verified: true,
      },
      space: {
        id: "slack:team:channel:thread",
        isCenterAgentDm: false,
        kind: "space",
        name: "Slack conversation",
      },
      organization: {
        id: "org-1",
        memberCount: 3,
        name: "Amplift",
        personal: false,
      },
      centerAgent: {
        profileHandle: "center-agent",
        profileName: "Center Agent",
      },
      trigger: {
        channelId: "channel",
        conversationId: "slack:team:channel:thread",
        source: "slack",
        teamId: "team",
        threadTs: "thread",
      },
      channelContext: {
        provider: "slack",
        conversationId: "slack:team:channel:thread",
        currentMessageId: "slack-message-current",
        messages: [
          {
            author: {
              displayName: "Felix",
              id: "U1",
              kind: "human",
            },
            id: "slack-message-previous",
            sentAtMs: 900,
            text: "Please investigate the deployment failure.",
          },
        ],
        sync: { mode: "snapshot", status: "complete" },
      },
    },
  };
}

function pausedCenterAgentDb(): D1Database {
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () => ({
          agent_profile_id: "agt-center",
          created_at: 1_700_000_000_000,
          designated_by: "creator",
          duty: null,
          operating_state: "paused",
          organization_id: "org-1",
          paused_at: 1_700_000_000_000,
          paused_by_user_id: "creator",
        })),
      })),
    })),
  } as unknown as D1Database;
}

function centerAgentPauseRaceDb(): D1Database {
  let designationReadCount = 0;
  return {
    prepare: vi.fn((sql: string) => {
      const normalizedSql = sql.replace(/\s+/gu, " ").trim().toLowerCase();
      if (normalizedSql.includes("from center_agent_designations")) {
        return {
          bind: vi.fn(() => ({
            first: vi.fn(() => {
              const operatingState =
                designationReadCount === 0 ? "active" : "paused";
              designationReadCount += 1;
              return {
                agent_profile_id: "agt-center",
                created_at: 1_700_000_000_000,
                designated_by: "creator",
                duty: null,
                operating_state: operatingState,
                organization_id: "org-1",
                paused_at:
                  operatingState === "paused" ? 1_700_000_000_001 : null,
                paused_by_user_id:
                  operatingState === "paused" ? "creator" : null,
              };
            }),
          })),
        };
      }
      if (normalizedSql.includes("select daily_admission_day_utc")) {
        return {
          bind: vi.fn(() => ({
            first: vi.fn(() => ({
              daily_admission_day_utc: "2026-07-29",
            })),
          })),
        };
      }
      throw new Error(`Unexpected SQL in admission race test: ${sql}`);
    }),
  } as unknown as D1Database;
}
