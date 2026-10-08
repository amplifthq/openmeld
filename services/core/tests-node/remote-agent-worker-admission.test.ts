import type { RemoteAgentWorkerSubmitTurnRequest } from "@openmeld/schemas/types";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { createSubmitTurnRequestV2 } from "../../remote-agent/tests/fixtures";
import type { CoreBindings } from "../src/lib/bindings";
import {
  readRemoteAgentWorkerAdmission,
  readRemoteAgentWorkerAdmissionStop,
  resolveRemoteAgentWorkerTaskAttribution,
  submitRemoteAgentWorkerAdmission,
} from "../src/remote-agent/application/remote-agent-worker-admission";
import type { RemoteAgentNativeDeliveryRecord } from "../src/remote-agent/infrastructure/postgresql/native-delivery-ledger-repo";
import { legacySummaryReceiverRequestSchema } from "./helpers/legacy-summary-receiver.test-support";
import {
  createPostgresHarness,
  observeNativePostgresQueries,
  postgresTestBinding,
} from "./helpers/postgresql-harness.test-support";

const CENTER_PROFILE_ID = "agt_11111111-1111-4111-8111-111111111111";
describe("Remote Agent worker admission", () => {
  it.each([
    "transport",
    "malformed",
  ])("does not downgrade task attribution on %s", async (failure) => {
    const worker = {
      readSubmitTurnCapabilities: () => {
        if (failure === "transport") {
          throw new Error("network unavailable");
        }
        return Promise.resolve({ v: 2, taskId: true });
      },
    };
    await expect(
      resolveRemoteAgentWorkerTaskAttribution(
        worker as unknown as NonNullable<
          CoreBindings["OPENMELD_REMOTE_AGENT_WORKER"]
        >,
        "task-1"
      )
    ).rejects.toThrow();
  });
  it("does not infer a Stop fence from an absent or legacy receiver", async () => {
    const request = createRolloverRequest();
    await expect(
      readRemoteAgentWorkerAdmissionStop({ request, worker: {} })
    ).resolves.toBeNull();
    await expect(
      readRemoteAgentWorkerAdmissionStop({
        request,
        worker: {
          readAdmissionStop: vi.fn(() =>
            Promise.reject(
              new Error(
                'The RPC receiver does not implement the method "readAdmissionStop".'
              )
            )
          ),
        },
      })
    ).resolves.toBeNull();
    await expect(
      readRemoteAgentWorkerAdmissionStop({
        request,
        worker: {
          readAdmissionStop: vi.fn(async () => ({
            v: 1 as const,
            status: "not_found" as const,
          })),
        },
      })
    ).resolves.toEqual({ v: 1, status: "not_found" });
  });
  it.each([
    "local_schema",
    "rpc_message",
  ] as const)("preserves an unclassified legacy schema rejection without inventing receiver support: %s", async (failure) => {
    const request = createSubmitTurnRequestV2();
    request.turnEnvelope.trigger = {
      source: "task_continuation",
      delegationId: "delegation-1",
      subscriptionId: "subscription-1",
      summaryOnly: true,
      watchedTask: { v: 1, kind: "native_delivery", deliveryId: "child" },
      outcome: {
        status: "succeeded",
        errorCode: null,
        eventId: "child-completed",
        occurredAtMs: 1100,
        publishedSignalId: "signal-child",
      },
    };
    const parsed = legacySummaryReceiverRequestSchema.safeParse(request);
    if (parsed.success) {
      throw new Error("The strict legacy receiver accepted summaryOnly");
    }
    expect(parsed.error.issues).toMatchObject([
      {
        code: "unrecognized_keys",
        keys: ["summaryOnly"],
        path: ["turnEnvelope", "trigger"],
      },
    ]);
    expect(parsed.error.issues).toHaveLength(1);
    let error: Error = parsed.error;
    if (failure === "rpc_message") {
      // Current legacy Workers RPC loses both the issues and their JSON message.
      error = new Error("ZodError");
    }
    const lookup = readRemoteAgentWorkerAdmissionStop({
      request,
      worker: { readAdmissionStop: vi.fn(() => Promise.reject(error)) },
    });
    await expect(lookup).rejects.toBe(error);
  });
  it.each([
    "organizationId",
    "spaceId",
    "idempotencyKey",
  ] as const)("rejects a Stop fence from another %s", async (field) => {
    const request = createRolloverRequest();
    const stopIntent = {
      v: 1 as const,
      organizationId: request.organizationId,
      spaceId: request.spaceId,
      idempotencyKey: request.idempotencyKey,
      requestedAtMs: 100,
      reason: null,
    };
    await expect(
      readRemoteAgentWorkerAdmissionStop({
        request,
        worker: {
          readAdmissionStop: vi.fn(async () => ({
            v: 1 as const,
            status: "found" as const,
            stopIntent: { ...stopIntent, [field]: "other-identity" },
          })),
        },
      })
    ).rejects.toThrow("remote_agent.admission_stop_receipt_identity_mismatch");
  });
  it("keeps a matching fence separate from execution and preserves real lookup failures", async () => {
    const request = createRolloverRequest();
    const stopIntent = {
      v: 1 as const,
      organizationId: request.organizationId,
      spaceId: request.spaceId,
      idempotencyKey: request.idempotencyKey,
      requestedAtMs: 100,
      reason: null,
    };
    await expect(
      readRemoteAgentWorkerAdmissionStop({
        request,
        worker: {
          readAdmissionStop: vi.fn(async () => ({
            v: 1 as const,
            status: "found" as const,
            stopIntent,
          })),
        },
      })
    ).resolves.toEqual({ v: 1, status: "found", stopIntent });
    const error = new Error("Stop owner storage unavailable");
    await expect(
      readRemoteAgentWorkerAdmissionStop({
        request,
        worker: {
          readAdmissionStop: vi.fn(() => Promise.reject(error)),
        },
      })
    ).rejects.toBe(error);
  });
  it("rejects another operation's admission receipt without publishing ACK evidence or submitting work", async () => {
    const request = createRolloverRequest();
    const worker = {
      readAdmission: vi.fn(async () => ({
        v: 1 as const,
        status: "found" as const,
        ack: {
          accepted: false as const,
          createdAt: 1000,
          idempotencyKey: "another-operation",
          status: "pending" as const,
          submissionId: "another-submission",
        },
      })),
      submitConversationTurn: vi.fn(),
    };
    const evidence = vi.spyOn(console, "info");
    try {
      await expect(
        readRemoteAgentWorkerAdmission({
          request,
          worker,
        })
      ).rejects.toThrow("remote_agent.admission_receipt_identity_mismatch");
      expect(worker.submitConversationTurn).not.toHaveBeenCalled();
      expect(evidence).not.toHaveBeenCalled();
    } finally {
      evidence.mockRestore();
    }
  });
  it("rolls a current conversation into one new runtime generation without surfacing the history limit", async () => {
    const harness = await createPostgresHarness();
    try {
      const request = createRolloverRequest();
      await harness.query({
        values: [
          request.organizationId,
          request.idempotencyKey,
          JSON.stringify(request),
        ],
        text: `
          INSERT INTO "openmeld"."openMeldRemoteAgent_native_delivery_ledger" (
            delivery_id, space_id, profile_id, binding_id, trigger_message_id, dispatch_id, created_at_ms,
            organization_id,
            idempotency_key,
            daily_admission_day_utc,
            updated_at_ms,
            worker_submit_request_json,
            execution_recovery_submit_request_json,
            status,
            submission_id
          ) VALUES ('delivery-1', 'slack:team:channel:thread', 'agt_11111111-1111-4111-8111-111111111111', 'binding-1', 'slack-message-current', 'delivery-1', 900, $1, $2, NULL, 900, $3, NULL, 'submitted', NULL)
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
          env: { OPENMELD_POSTGRESQL: harness.binding } as CoreBindings,
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
        await harness.queryFirst<{
          active_generation: number;
          started_at_ms: number | null;
        }>({
          text: `
            SELECT active_generation, started_at_ms
            FROM "openmeld"."openMeldRemoteAgent_conversation_generations"
            WHERE organization_id = 'org-1'
              AND logical_conversation_id = 'slack:team:channel:thread'
          `,
        })
      ).toEqual({ active_generation: 1, started_at_ms: 1000 });
      const stored = await harness.queryFirst<{
        worker_submit_request_json: string;
      }>({
        text: `
          SELECT worker_submit_request_json
          FROM "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
          WHERE idempotency_key = 'turn-1'
        `,
      });
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
      await harness.close();
    }
  });
  it("rejects a paused Center Agent immediately without consuming quota or calling the worker", async () => {
    const workerSubmit = vi.fn();
    const { db } = await createCenterAdmissionFixture(true);
    const reads = observeNativePostgresQueries(() => Promise.resolve());
    const request = {
      agentProfileId: CENTER_PROFILE_ID,
      idempotencyKey: "turn-1",
      v: 1,
    } as RemoteAgentWorkerSubmitTurnRequest;
    await expect(
      submitRemoteAgentWorkerAdmission({
        db,
        env: {
          OPENMELD_POSTGRESQL: postgresTestBinding(db),
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
          "Center Agent is paused. Ask the Organization owner or admin to resume it before trying again.",
        reasonCode: "remote_agent.center_agent_paused",
      },
      status: "rejected",
    });
    expect(workerSubmit).not.toHaveBeenCalled();
    expect(
      reads.mock.calls.filter(([query]) =>
        (typeof query === "string" ? query : query.text).includes(
          'FROM "openmeld"."center_agent_designations"'
        )
      )
    ).toHaveLength(1);
    reads.mockRestore();
  });
  it.each([
    "acknowledged",
    "outcome_unknown",
  ] as const)("preserves the validated ACK before pause cancellation finishes with %s", async (outcome) => {
    let releaseCancellation: () => void = () => undefined;
    let signalCancellation: () => void = () => undefined;
    const cancellationStarted = new Promise<void>((resolve) => {
      signalCancellation = resolve;
    });
    const cancellationGate = new Promise<void>((resolve) => {
      releaseCancellation = resolve;
    });
    const evidence = vi.spyOn(console, "info").mockImplementation(() => {
      // Inspect receipt evidence while the postprocessing gate is still closed.
    });
    const cancelExecution = vi.fn(async () => {
      signalCancellation();
      await cancellationGate;
      if (outcome === "outcome_unknown") {
        throw new Error("Cancellation response unavailable");
      }
      return {
        execution: {
          acceptedAtMs: 1_700_000_000_000,
          cancellationReason:
            "Center Agent was paused by the Organization owner or admin.",
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
      } as const;
    });
    const { db, pause } = await createCenterAdmissionFixture(false);
    const workerSubmit = vi.fn(async () => {
      await pause();
      return {
        accepted: true,
        createdAt: 1_700_000_000_000,
        idempotencyKey: "turn-1",
        status: "running",
        submissionId: "submission-1",
      } as const;
    });
    const request: RemoteAgentWorkerSubmitTurnRequest = {
      ...createRolloverRequest(),
      v: 1,
      agentProfileId: CENTER_PROFILE_ID,
      idempotencyKey: "turn-1",
      spaceId: "space-1",
    };
    const worker = {
      cancelExecution,
      submitConversationTurn: workerSubmit,
    };
    const admission = submitRemoteAgentWorkerAdmission({
      admissionDelivery: {
        deliveryId: "delivery-1",
        dispatchId: "turn-1",
        idempotencyKey: "turn-1",
        admissionAttemptCount: 1,
        createdAtMs: 1_700_000_000_000,
        submittedAtMs: 1_700_000_000_000,
        admissionRetryDueAtMs: null,
      } as RemoteAgentNativeDeliveryRecord,
      db,
      env: {
        OPENMELD_POSTGRESQL: postgresTestBinding(db),
        OPENMELD_REMOTE_AGENT_WORKER: worker,
      } as unknown as CoreBindings,
      nowMs: 1_700_000_000_000,
      organizationId: "org-1",
      request,
      worker,
    });
    try {
      await cancellationStarted;
      const events = () =>
        evidence.mock.calls
          .filter(
            ([label]) => label === "[core.remote_agent.admission_attempt]"
          )
          .map(([, event]) => event);
      expect(events()).toContainEqual(
        expect.objectContaining({
          phase: "acknowledged",
          submissionId: "submission-1",
          accepted: true,
          elapsedMs: expect.any(Number),
        })
      );
      expect(
        events().some((event) => event.phase === "postprocessing_finished")
      ).toBe(false);
      releaseCancellation();
      await expect(admission).resolves.toMatchObject({ status: outcome });
      expect(events()).toContainEqual(
        expect.objectContaining({
          phase: "postprocessing_finished",
          submissionId: "submission-1",
          outcome,
          elapsedMs: expect.any(Number),
        })
      );
      expect(workerSubmit).toHaveBeenCalledOnce();
      expect(cancelExecution).toHaveBeenCalledWith({
        idempotencyKey: "turn-1",
        organizationId: "org-1",
        reason: "Center Agent was paused by the Organization owner or admin.",
        spaceId: "space-1",
        submissionId: "submission-1",
        v: 1,
      });
    } finally {
      releaseCancellation();
      await admission;
      evidence.mockRestore();
    }
  });
});

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
async function createCenterAdmissionFixture(paused: boolean) {
  const harness = await createPostgresHarness();
  onTestFinished(() => harness.close());
  await harness.query({
    text: 'INSERT INTO "openmeld"."users" (id, name, email) VALUES ($1, $1, $2)',
    values: ["creator", "creator@example.com"],
  });
  await harness.query({
    text: 'INSERT INTO "openmeld"."organizations" (id, name, slug, created_at) VALUES ($1, $1, $1, $2)',
    values: ["org-1", 1_700_000_000_000],
  });
  await harness.query({
    text: `INSERT INTO "openmeld"."openmeld_profiles" (profile_id, profile_name, profile_handle, profile_kind, organization_id, managed_role, source) VALUES ($1, 'Center Agent', 'center-agent', 'agent', 'org-1', 'center_agent', 'migration')`,
    values: [CENTER_PROFILE_ID],
  });
  await harness.query({
    text: `INSERT INTO "openmeld"."center_agent_designations" (organization_id, agent_profile_id, designated_by, created_at) VALUES ('org-1', $1, 'creator', 1700000000000)`,
    values: [CENTER_PROFILE_ID],
  });
  const pause = async () => {
    await harness.query({
      text: `UPDATE "openmeld"."center_agent_designations" SET operating_state = 'paused', paused_at = 1700000000001, paused_by_user_id = 'creator' WHERE organization_id = 'org-1'`,
    });
  };
  if (paused) {
    await pause();
  }
  return { db: harness.db, pause };
}
