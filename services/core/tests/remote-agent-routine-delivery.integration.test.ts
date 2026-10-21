import type { QueryResult } from "@openmeld/db/postgresql";
import { getPostgresDatabase } from "@openmeld/db/postgresql";
import type { SignalEnvelope } from "@openmeld/protocol";
import {
  buildRemoteAgentRoutineRunConversationId,
  HOSTED_CENTER_AGENT_CONTROLLER_REF,
  HOSTED_CENTER_AGENT_LOGICAL_RUNTIME_ID,
  HOSTED_CENTER_AGENT_RUNTIME_IDENTITY,
  HOSTED_REMOTE_AGENT_CONTROLLER_REF,
  HOSTED_REMOTE_AGENT_RUNTIME_IDENTITY,
  OBSERVABILITY_CLOUDFLARE_ANALYTICS_BLOBS,
} from "@openmeld/schemas";
import type {
  AuthRpcResolveOrganizationAccountIdentityInput,
  AuthRpcResolveOrganizationAccountIdentityResult,
  RemoteAgentWorkerSubmitTurnRequest,
} from "@openmeld/schemas/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "../test-support/worker-env";

// Routine delivery uses the funding owner's result; its real database and
// provider behavior is verified separately in tests-node/ai-billing.test.ts.
vi.mock("../src/usage/ai-billing-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/usage/ai-billing-service")>()),
  readAiBilling: vi.fn(async () => ({ status: "available", source: "free" })),
}));

import {
  buildRemoteAgentName,
  resolveRemoteAgentTurnEnvelopeForName,
} from "../../remote-agent/agent-core/submission";
import {
  claimReadyAgentTaskCompletionSubscription,
  recordAgentTaskTerminalOutcome,
  registerAgentTaskCompletionSubscription,
} from "../src/agent-task-coordination/infrastructure/postgresql/agent-task-coordination-repo";
import { planCenterAgentWakeDelegation } from "../src/center-agent/application/center-agent-delegation-service";
import {
  executeCenterAgentWakePublication,
  prepareCenterAgentWakePublicationBatch,
} from "../src/center-agent/application/center-agent-wake-publication-service";
import type { CenterAgentMemoryService } from "../src/center-agent-memory/memory-service";
import type { CoreBindings } from "../src/lib/bindings";
import { createOrganizationSkillService } from "../src/organization-skills/organization-skill-service";
import { setOrganizationWorkingLanguagePreference } from "../src/organizations/organization-working-language-repository";
import {
  REMOTE_AGENT_ACCEPTED_DELIVERY_PROBE_DELAY_SECONDS,
  REMOTE_AGENT_ADMISSION_WATCHDOG_DELAY_SECONDS,
} from "../src/remote-agent/application/native-delivery-admission-watchdog";
import {
  completeRemoteAgentNativeDelivery,
  ensureRemoteAgentRoutineWorkflowSubmission,
  finalizeRemoteAgentRoutineContinuationFailure,
  processRemoteAgentNativeDeliveryDeadlineProbe,
  retryRemoteAgentRoutineFailurePublications,
  retryRemoteAgentRoutineSubmissions,
  submitRemoteAgentRoutineDelivery,
  submitRemoteAgentTaskContinuationDelivery,
} from "../src/remote-agent/application/native-delivery-service";
import { resolveRemoteAgentRoutineTurnEnvelope } from "../src/remote-agent/application/turn-envelope";
import {
  claimRemoteAgentFinalPublication,
  claimRemoteAgentRoutineAdmissionFailure as claimRemoteAgentRoutineAdmissionFailureRecord,
  claimRemoteAgentRoutineNativeDelivery as claimRemoteAgentRoutineNativeDeliveryRecord,
  claimRemoteAgentRoutineSubmissionFailure,
  claimRemoteAgentRoutineSubmissionRecoveryAttempt,
  markRemoteAgentFailedCallbackPublicationOutcomeUnknown,
  markRemoteAgentNativeDeliveryAck,
  markRemoteAgentNativeDeliveryCompleted,
  markRemoteAgentNativeDeliveryDeadlineProbeEnqueued,
  readRemoteAgentNativeDeliveryByIdempotencyKey,
} from "../src/remote-agent/infrastructure/postgresql/native-delivery-ledger-repo";
import {
  failStaleClaimedRoutineRuns,
  readRoutineRunRecord,
} from "../src/routines/routine-repository";
import {
  ROUTINE_CLAIM_WATCHDOG_TIMEOUT_MS,
  runRoutineSchedulerTick,
} from "../src/routines/routine-scheduler";
import {
  createRoutineService,
  type RoutineActor,
} from "../src/routines/routine-service";
import { ROUTINE_WORKFLOW_CALLBACK_EVENTS } from "../src/routines/routine-workflow-contract";
import { readAiBilling } from "../src/usage/ai-billing-service";
import { postgresFixtureOperator } from "./postgresql.test-support";

const ownedRoutineOrganizationIds = new Set<string>();
type RoutineDeliveryClaimInput = Parameters<
  typeof claimRemoteAgentRoutineNativeDeliveryRecord
>[0];
async function claimRemoteAgentRoutineNativeDelivery(
  input: Omit<
    RoutineDeliveryClaimInput,
    | "conversationKind"
    | "onBehalfOfDisplayName"
    | "onBehalfOfProfileId"
    | "onBehalfOfUserId"
    | "slackChannelId"
    | "slackTeamId"
    | "slackThreadTs"
  > &
    Partial<RoutineDeliveryClaimInput>
) {
  return await claimRemoteAgentRoutineNativeDeliveryRecord({
    conversationKind: "space",
    onBehalfOfDisplayName: "Routine Creator",
    onBehalfOfProfileId: "routine-creator-profile",
    onBehalfOfUserId: "routine-creator-user",
    slackChannelId: null,
    slackTeamId: null,
    slackThreadTs: null,
    ...input,
  });
}
type RoutineAdmissionFailureClaimInput = Parameters<
  typeof claimRemoteAgentRoutineAdmissionFailureRecord
>[0];
async function claimRemoteAgentRoutineAdmissionFailure(
  input: Omit<
    RoutineAdmissionFailureClaimInput,
    | "conversationKind"
    | "onBehalfOfDisplayName"
    | "onBehalfOfProfileId"
    | "onBehalfOfUserId"
    | "slackChannelId"
    | "slackTeamId"
    | "slackThreadTs"
  > &
    Partial<RoutineAdmissionFailureClaimInput>
) {
  return await claimRemoteAgentRoutineAdmissionFailureRecord({
    conversationKind: "space",
    onBehalfOfDisplayName: "Routine Creator",
    onBehalfOfProfileId: "routine-creator-profile",
    onBehalfOfUserId: "routine-creator-user",
    slackChannelId: null,
    slackTeamId: null,
    slackThreadTs: null,
    ...input,
  });
}
function readAnalyticsBlobIndex(
  key: (typeof OBSERVABILITY_CLOUDFLARE_ANALYTICS_BLOBS)[number]
): number {
  const index = OBSERVABILITY_CLOUDFLARE_ANALYTICS_BLOBS.indexOf(key);
  if (index < 0) {
    throw new Error(`Unknown Analytics Engine blob key: ${key}`);
  }
  return index;
}
afterEach(async () => {
  try {
    await cleanupOwnedRoutineRows();
  } finally {
    vi.restoreAllMocks();
  }
});
async function seedPersonalRoutineDeliveryFixture() {
  const fixture = await seedRoutineDeliveryFixture();
  await getPostgresDatabase(env).transaction(async (client) =>
    (async () => {
      const results: QueryResult[] = [];
      for (const query of [
        {
          ...{
            text: 'DELETE FROM "openmeld"."center_agent_designations" WHERE organization_id = $1',
            values: [],
          },
          values: [fixture.organizationId],
        },
        {
          ...{
            text: 'UPDATE "openmeld"."openMeldDaemon_agent_profile_bindings" SET binding_state = \'disabled_historical\', disabled_at_ms = $1 WHERE binding_id = $2',
            values: [],
          },
          values: [fixture.nowMs, fixture.bindingId],
        },
        {
          ...{
            text: 'UPDATE "openmeld"."openmeld_profiles" SET managed_role = NULL, owner_user_id = $1 WHERE profile_id = $2',
            values: [],
          },
          values: [fixture.creatorUserId, fixture.profileId],
        },
        {
          ...{
            text: "UPDATE \"openmeld\".\"openMeldDaemon_agent_profile_bindings\" SET binding_state = 'enabled_primary', disabled_at_ms = NULL, owner_kind = 'owner_account', owner_id = $1, runtime_kind = 'hosted_remote_agent', agent_controller_ref = $2, openmeld_service_runtime_id = $3, hosted_runtime_identity_json = $4 WHERE binding_id = $5",
            values: [],
          },
          values: [
            fixture.creatorUserId,
            HOSTED_REMOTE_AGENT_CONTROLLER_REF,
            HOSTED_REMOTE_AGENT_CONTROLLER_REF,
            JSON.stringify(HOSTED_REMOTE_AGENT_RUNTIME_IDENTITY),
            fixture.bindingId,
          ],
        },
        {
          ...{
            text: "INSERT INTO \"openmeld\".\"space_index_memberships\" (space_id, profile_id, profile_kind_snapshot, profile_name_snapshot, owner_user_id_snapshot, status, member_source, added_at_ms, source_updated_at_ms, projected_at_ms, projection_event_id) VALUES ($1, $2, 'human', 'Routine Creator', $3, 'active', 'member_add', $4, $5, $6, $7)",
            values: [],
          },
          values: [
            fixture.spaceId,
            fixture.creatorProfileId,
            fixture.creatorUserId,
            fixture.nowMs,
            fixture.nowMs,
            fixture.nowMs,
            crypto.randomUUID(),
          ],
        },
        {
          ...{
            text: 'UPDATE "openmeld"."routines" SET agent_profile_id = $1 WHERE id = $2',
            values: [],
          },
          values: [fixture.profileId, fixture.routineId],
        },
        {
          ...{
            text: 'UPDATE "openmeld"."routine_runs" SET agent_profile_id_snapshot = $1 WHERE id = $2',
            values: [],
          },
          values: [fixture.profileId, fixture.runId],
        },
      ]) {
        results.push(await client.query(query));
      }
      return results;
    })()
  );
  return fixture;
}
describe("Remote Agent Routine native delivery", () => {
  it("gives later occurrences of the same existing Routine separate execution conversations", async () => {
    const fixture = await seedRoutineDeliveryFixture();
    const nextRunId = `routine_run_${crypto.randomUUID()}`;
    const nextScheduledFor = fixture.nowMs + 24 * 60 * 60 * 1000;
    await getPostgresDatabase(env).query({
      ...{
        text: 'INSERT INTO "openmeld"."routine_runs" (id, routine_id, organization_id, scheduled_for, status, routine_name_snapshot, target_space_id_snapshot, started_at_ms) VALUES ($1, $2, $3, $4, \'claimed\', $5, $6, $7)',
        values: [],
      },
      values: [
        nextRunId,
        fixture.routineId,
        fixture.organizationId,
        nextScheduledFor,
        fixture.routine.name,
        fixture.spaceId,
        nextScheduledFor,
      ],
    });
    const nextRun = await readRoutineRunRecord({
      db: getPostgresDatabase(env),
      runId: nextRunId,
    });
    if (!nextRun) {
      throw new Error("The next Routine Run fixture was not created");
    }
    const workerSubmit = vi.fn(
      async (request: RemoteAgentWorkerSubmitTurnRequest) => ({
        accepted: true,
        createdAt: fixture.nowMs,
        idempotencyKey: request.idempotencyKey,
        status: "pending" as const,
        submissionId: `submission_${request.dispatchId}`,
      })
    );
    const testEnv = buildEnv({ fixture, workerSubmit });
    for (const run of [fixture.run, nextRun]) {
      await expect(
        submitRemoteAgentRoutineDelivery({
          db: getPostgresDatabase(env),
          env: testEnv,
          nowMs: run.scheduledFor,
          routine: fixture.routine,
          run,
        })
      ).resolves.toEqual({ status: "submitted" });
    }
    expect(workerSubmit).toHaveBeenCalledTimes(2);
    expect(workerSubmit.mock.calls.map(([request]) => request.spaceId)).toEqual(
      [fixture.spaceId, fixture.spaceId]
    );
    expect(
      workerSubmit.mock.calls.map(([request]) => request.conversationId)
    ).toEqual([
      buildRemoteAgentRoutineRunConversationId({
        agentProfileId: fixture.profileId,
        organizationId: fixture.organizationId,
        runId: fixture.runId,
      }),
      buildRemoteAgentRoutineRunConversationId({
        agentProfileId: fixture.profileId,
        organizationId: fixture.organizationId,
        runId: nextRunId,
      }),
    ]);
  });
  it("runs an existing Routine without reading an unstarted destination conversation", async () => {
    const fixture = await seedRoutineDeliveryFixture();
    await getPostgresDatabase(env).query({
      ...{
        text: `INSERT INTO "openmeld"."openMeldRemoteAgent_conversation_generations" (
        organization_id, logical_conversation_id, active_generation,
        started_at_ms, rollover_delivery_id, created_at_ms, updated_at_ms
      ) VALUES ($1, $2, 1, NULL, $3, $4, $5)`,
        values: [],
      },
      values: [
        fixture.organizationId,
        fixture.spaceId,
        "earlier-interactive-dispatch",
        fixture.nowMs,
        fixture.nowMs,
      ],
    });
    const workerSubmit = vi.fn(
      async (request: RemoteAgentWorkerSubmitTurnRequest) => ({
        accepted: true,
        createdAt: fixture.nowMs,
        idempotencyKey: request.idempotencyKey,
        status: "pending" as const,
        submissionId: fixture.submissionId,
      })
    );
    const testEnv = buildEnv({ fixture, workerSubmit });
    testEnv.__spaceStub.rpcListDispatchConversationContinuitySignalsResult =
      vi.fn(async () => ({
        code: "space.forbidden",
        message: "dispatch source signal was not found",
        ok: false as const,
        status: 403,
      }));
    await expect(
      submitRemoteAgentRoutineDelivery({
        db: getPostgresDatabase(env),
        env: testEnv,
        nowMs: fixture.nowMs,
        routine: fixture.routine,
        run: fixture.run,
      })
    ).resolves.toEqual({ status: "submitted" });
    expect(workerSubmit).toHaveBeenCalledOnce();
    expect(workerSubmit.mock.calls[0]?.[0]).toMatchObject({
      conversationId: expect.not.stringMatching(fixture.spaceId),
      spaceId: fixture.spaceId,
      turnEnvelope: { trigger: { runId: fixture.runId, source: "routine" } },
    });
    expect(
      testEnv.__spaceStub.rpcListDispatchConversationContinuitySignalsResult
    ).not.toHaveBeenCalled();
    await completeRemoteAgentNativeDelivery(
      testEnv,
      buildCompletedCallback(fixture)
    );
    await expect(
      readRoutineRunRecord({
        db: getPostgresDatabase(env),
        runId: fixture.runId,
      })
    ).resolves.toMatchObject({ status: "completed" });
    expect(
      testEnv.__spaceStub.rpcPostSignalOnceByClientMessageId
    ).toHaveBeenCalledOnce();
  });
  it("keeps personal Routine management scoped to its Agent and preserves pause and resume", async () => {
    const fixture = await seedPersonalRoutineDeliveryFixture();
    const stores = {
      db: getPostgresDatabase(env),
      projectionsDb: getPostgresDatabase(env),
      now: () => fixture.nowMs,
    };
    const service = createRoutineService({
      ...stores,
      agentProfileId: fixture.profileId,
    });
    const actor: RoutineActor = {
      attribution: { actorProfileId: fixture.profileId, onBehalfOf: null },
      authority: {
        organizationId: fixture.organizationId,
        userId: fixture.creatorUserId,
        role: "member",
      },
      creationDisplayName: "Routine Creator",
      sourceNativeDeliveryId: null,
    };
    const representedHuman = {
      profileId: fixture.creatorProfileId,
      userId: fixture.creatorUserId,
    };
    expect(
      (await service.list(actor)).routines.map((routine) => routine.id)
    ).toEqual([fixture.routineId]);
    for (const otherService of [
      createRoutineService(stores),
      createRoutineService({ ...stores, agentProfileId: "another-agent" }),
    ]) {
      expect((await otherService.list(actor)).routines).toEqual([]);
      await expect(
        otherService.pause(actor, fixture.routineId)
      ).rejects.toThrow("routine.not_found");
    }
    await expect(
      service.pause(actor, fixture.routineId)
    ).resolves.toMatchObject({ status: "paused", nextDueAt: null });
    await expect(
      service.resume(actor, representedHuman, fixture.routineId)
    ).resolves.toMatchObject({ status: "enabled" });
    await expect(
      service.update(actor, representedHuman, fixture.routineId, {
        authorizedActions: ["organization_documents.save_approved_knowledge"],
      })
    ).rejects.toThrow();
    await service.delete(actor, fixture.routineId);
    expect((await service.list(actor)).routines).toEqual([]);
  });
  it("does not execute a personal Routine after its owner loses access to the destination", async () => {
    const fixture = await seedPersonalRoutineDeliveryFixture();
    await getPostgresDatabase(env).query({
      ...{
        text: 'DELETE FROM "openmeld"."space_index_memberships" WHERE space_id = $1 AND profile_id = $2',
        values: [],
      },
      values: [fixture.spaceId, fixture.creatorProfileId],
    });
    const workerSubmit = vi.fn();
    await submitRemoteAgentRoutineDelivery({
      db: getPostgresDatabase(env),
      env: buildEnv({ fixture, workerSubmit }),
      nowMs: fixture.nowMs,
      routine: fixture.routine,
      run: fixture.run,
    });
    expect(workerSubmit).not.toHaveBeenCalled();
    await expect(
      readRoutineRunRecord({
        db: getPostgresDatabase(env),
        runId: fixture.runId,
      })
    ).resolves.toMatchObject({ status: "failed" });
  });
  it("runs a personal Routine with its own identity and publishes its result exactly once", async () => {
    const fixture = await seedPersonalRoutineDeliveryFixture();
    const workerSubmit = vi.fn(async () => ({
      accepted: true,
      createdAt: fixture.nowMs,
      idempotencyKey: fixture.runId,
      status: "pending" as const,
      submissionId: fixture.submissionId,
    }));
    const testEnv = buildEnv({ fixture, workerSubmit });
    const memoryService = {
      recallForOrganization: vi.fn(),
    } as unknown as CenterAgentMemoryService;
    await expect(
      submitRemoteAgentRoutineDelivery({
        db: getPostgresDatabase(env),
        env: testEnv,
        nowMs: fixture.nowMs,
        routine: fixture.routine,
        run: fixture.run,
        memoryService,
      })
    ).resolves.toEqual({ status: "submitted" });
    expect(workerSubmit).toHaveBeenCalledTimes(1);
    expect(workerSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        v: 4,
        conversationId: buildRemoteAgentRoutineRunConversationId({
          agentProfileId: fixture.profileId,
          organizationId: fixture.organizationId,
          runId: fixture.runId,
        }),
        conversationIdentity: {
          kind: "personal_agent",
          agentProfileId: fixture.profileId,
        },
        agentProfileOwnerUserId: fixture.creatorUserId,
        author: expect.objectContaining({
          profileId: fixture.creatorProfileId,
          profileKind: "human",
        }),
        turnEnvelope: expect.objectContaining({
          sender: expect.objectContaining({ kind: "routine" }),
        }),
      })
    );
    expect(memoryService.recallForOrganization).not.toHaveBeenCalled();
    await completeRemoteAgentNativeDelivery(
      testEnv,
      buildCompletedCallback(fixture)
    );
    await completeRemoteAgentNativeDelivery(
      testEnv,
      buildCompletedCallback(fixture)
    );
    expect(
      testEnv.__spaceStub.rpcPostSignalOnceByClientMessageId
    ).toHaveBeenCalledTimes(1);
    await expect(
      readRoutineRunRecord({
        db: getPostgresDatabase(env),
        runId: fixture.runId,
      })
    ).resolves.toMatchObject({ status: "completed" });
  });
  it("lets concurrent scanners produce one Run, one worker turn, and one visible result", async () => {
    const fixture = await seedRoutineDeliveryFixture();
    await getPostgresDatabase(env).transaction(async (client) =>
      (async () => {
        const results: QueryResult[] = [];
        for (const query of [
          {
            ...{
              text: 'DELETE FROM "openmeld"."routine_runs" WHERE id = $1',
              values: [],
            },
            values: [fixture.runId],
          },
          {
            ...{
              text: 'UPDATE "openmeld"."routines" SET next_due_at = $1 WHERE id = $2',
              values: [],
            },
            values: [fixture.nowMs, fixture.routineId],
          },
        ]) {
          results.push(await client.query(query));
        }
        return results;
      })()
    );
    const workerSubmit = vi.fn(async () => ({
      accepted: true,
      createdAt: fixture.nowMs,
      idempotencyKey: fixture.runId,
      status: "pending" as const,
      submissionId: fixture.submissionId,
    }));
    const testEnv = buildEnv({ fixture, workerSubmit });
    const submitRoutineDelivery = async (
      deliveryInput: Pick<
        Parameters<typeof submitRemoteAgentRoutineDelivery>[0],
        "db" | "nowMs" | "routine" | "run"
      >
    ) =>
      await submitRemoteAgentRoutineDelivery({
        ...deliveryInput,
        env: testEnv,
      });
    await Promise.all([
      runRoutineSchedulerTick({
        db: getPostgresDatabase(env),
        generateRunId: () => fixture.runId,
        nowMs: fixture.nowMs,
        submitRoutineDelivery,
      }),
      runRoutineSchedulerTick({
        db: getPostgresDatabase(env),
        generateRunId: () => fixture.runId,
        nowMs: fixture.nowMs,
        submitRoutineDelivery,
      }),
    ]);
    expect(workerSubmit).toHaveBeenCalledTimes(1);
    await expect(
      readRoutineRunRecord({
        db: getPostgresDatabase(env),
        runId: fixture.runId,
      })
    ).resolves.toMatchObject({ status: "submitted" });
    vi.spyOn(Date, "now").mockReturnValue(fixture.nowMs + 1000);
    await completeRemoteAgentNativeDelivery(
      testEnv,
      buildCompletedCallback(fixture)
    );
    expect(
      testEnv.__spaceStub.rpcPostSignalOnceByClientMessageId
    ).toHaveBeenCalledTimes(1);
    expect(
      testEnv.__spaceStub.rpcPostSignalOnceByClientMessageId
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        agentStreamId: `stream:${fixture.submissionId}`,
      })
    );
    await expect(
      readRoutineRunRecord({
        db: getPostgresDatabase(env),
        runId: fixture.runId,
      })
    ).resolves.toMatchObject({ status: "completed" });
  });
  it("keeps watchdog and initial native-delivery claim from tearing the Run and ledger apart", async () => {
    const fixture = await seedRoutineDeliveryFixture();
    await getPostgresDatabase(env).query({
      ...{
        text: 'UPDATE "openmeld"."routine_runs" SET started_at_ms = $1 WHERE id = $2',
        values: [],
      },
      values: [
        fixture.nowMs - ROUTINE_CLAIM_WATCHDOG_TIMEOUT_MS - 1,
        fixture.runId,
      ],
    });
    const workerSubmit = vi.fn(async () => ({
      accepted: true,
      createdAt: fixture.nowMs,
      idempotencyKey: fixture.runId,
      status: "pending" as const,
      submissionId: fixture.submissionId,
    }));
    const testEnv = buildEnv({ fixture, workerSubmit });
    await Promise.allSettled([
      submitRemoteAgentRoutineDelivery({
        db: getPostgresDatabase(env),
        env: testEnv,
        nowMs: fixture.nowMs,
        routine: fixture.routine,
        run: fixture.run,
      }),
      failStaleClaimedRoutineRuns({
        cutoffMs: fixture.nowMs - ROUTINE_CLAIM_WATCHDOG_TIMEOUT_MS,
        db: getPostgresDatabase(env),
        limit: 1,
        nowMs: fixture.nowMs,
      }),
    ]);
    const run = await readRoutineRunRecord({
      db: getPostgresDatabase(env),
      runId: fixture.runId,
    });
    const delivery = await readRemoteAgentNativeDeliveryByIdempotencyKey({
      db: getPostgresDatabase(env),
      idempotencyKey: fixture.runId,
    });
    if (run?.status === "failed") {
      expect(run).toMatchObject({
        failureCode: "routine.claim_timeout",
        nativeDeliveryId: null,
      });
      expect(delivery).toBeNull();
      expect(workerSubmit).not.toHaveBeenCalled();
    } else {
      expect(run).toMatchObject({
        nativeDeliveryId: delivery?.deliveryId,
        status: "submitted",
      });
      expect(delivery).toMatchObject({ routineRunId: fixture.runId });
      expect(workerSubmit).toHaveBeenCalledTimes(1);
    }
  });
  it("submits one unattended turn, links both ledgers, and projects the final Space result", async () => {
    const fixture = await seedRoutineDeliveryFixture();
    const workerSubmit = vi.fn(
      (request: RemoteAgentWorkerSubmitTurnRequest) => {
        resolveRemoteAgentTurnEnvelopeForName({
          agentName: buildRemoteAgentName(request),
          requestContext: request,
        });
        return {
          accepted: true,
          createdAt: fixture.nowMs,
          idempotencyKey: fixture.runId,
          requestId: "request_routine_1",
          status: "pending" as const,
          submissionId: fixture.submissionId,
        };
      }
    );
    const memoryService = createMemoryService();
    const testEnv = buildEnv({
      fixture,
      spaceGuide: "Publish decisions with evidence.",
      workerSubmit,
    });
    await expect(
      submitRemoteAgentRoutineDelivery({
        db: getPostgresDatabase(env),
        env: testEnv,
        memoryService,
        nowMs: fixture.nowMs,
        routine: fixture.routine,
        run: fixture.run,
      })
    ).resolves.toEqual({ status: "submitted" });
    expect(workerSubmit).toHaveBeenCalledTimes(1);
    expect(workerSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        dispatchId: fixture.runId,
        idempotencyKey: fixture.runId,
        onBehalfOf: null,
        sourceClientMessageId: null,
        spaceId: fixture.spaceId,
        triggerMessageId: fixture.runId,
        turnEnvelope: expect.objectContaining({
          space: expect.objectContaining({
            guide: "Publish decisions with evidence.",
          }),
          sender: expect.objectContaining({
            kind: "routine",
            routineId: fixture.routineId,
            createdByUserId: fixture.creatorUserId,
            delegatedBy: expect.objectContaining({
              id: fixture.creatorMemberId,
              ownerUserId: fixture.creatorUserId,
              verified: true,
            }),
          }),
          trigger: expect.objectContaining({
            destination: {
              kind: "space",
              spaceId: fixture.spaceId,
            },
            externalActionPolicy: "read_only",
            source: "routine",
            routineId: fixture.routineId,
            runId: fixture.runId,
            routineName: fixture.routine.name,
          }),
        }),
      })
    );
    expect(testEnv.__spaceStub.rpcGetMeta).toHaveBeenCalledOnce();
    expect(memoryService.recallForOrganization).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: fixture.organizationId,
        query: fixture.routine.instructions,
      })
    );
    const delivery = await readRemoteAgentNativeDeliveryByIdempotencyKey({
      db: getPostgresDatabase(env),
      idempotencyKey: fixture.runId,
    });
    expect(delivery).toMatchObject({
      routineNameSnapshot: fixture.routine.name,
      routineRunId: fixture.runId,
      status: "accepted",
    });
    await expect(
      readRoutineRunRecord({
        db: getPostgresDatabase(env),
        runId: fixture.runId,
      })
    ).resolves.toMatchObject({
      nativeDeliveryId: delivery?.deliveryId,
      status: "submitted",
    });
    const callback = {
      ...buildCompletedCallback(fixture),
      conversationCompaction: {
        completedAtMs: fixture.nowMs + 500,
        count: 1,
        v: 1 as const,
      },
    };
    vi.spyOn(Date, "now").mockReturnValue(fixture.nowMs + 1000);
    const memoryWork: Promise<unknown>[] = [];
    await expect(
      completeRemoteAgentNativeDelivery(testEnv, callback, {
        memoryService,
        waitUntil: (promise) => memoryWork.push(promise),
      })
    ).resolves.toEqual({
      publishedSignalId: fixture.publishedSignalId,
      status: "accepted",
    });
    await Promise.all(memoryWork);
    const published = testEnv.__spaceStub.rpcPostSignalOnceByClientMessageId;
    expect(published).toHaveBeenCalledTimes(1);
    expect(testEnv.__spaceStub.rpcListSignalsResult).not.toHaveBeenCalled();
    expect(
      testEnv.__spaceStub.rpcReadFinalReplyClaimSignalId
    ).not.toHaveBeenCalled();
    expect(memoryService.rememberTurn).not.toHaveBeenCalled();
    expect(published).toHaveBeenCalledWith(
      expect.objectContaining({
        clientMessageId: fixture.runId,
        messageEnvelope: expect.not.objectContaining({
          replyToSignalId: expect.anything(),
        }),
        meta: expect.objectContaining({
          conversationCompaction: callback.conversationCompaction,
        }),
        spaceAccess: expect.objectContaining({
          actor: expect.objectContaining({ kind: "authenticated" }),
        }),
      })
    );
    await expect(
      readRoutineRunRecord({
        db: getPostgresDatabase(env),
        runId: fixture.runId,
      })
    ).resolves.toMatchObject({
      publishedSignalId: fixture.publishedSignalId,
      status: "completed",
    });
    await expect(
      completeRemoteAgentNativeDelivery(testEnv, {
        agentProfileId: callback.agentProfileId,
        bindingId: callback.bindingId,
        dispatchId: callback.dispatchId,
        failureCode: "remote_agent.late_failure",
        failureMessage: "Late failure.",
        idempotencyKey: callback.idempotencyKey,
        organizationId: callback.organizationId,
        spaceId: callback.spaceId,
        status: "failed",
        submissionId: callback.submissionId,
        triggerMessageId: callback.triggerMessageId,
      })
    ).resolves.toMatchObject({ status: "duplicate_rejected" });
    expect(published).toHaveBeenCalledTimes(1);
    await expect(
      readRoutineRunRecord({
        db: getPostgresDatabase(env),
        runId: fixture.runId,
      })
    ).resolves.toMatchObject({
      failureCode: null,
      publishedSignalId: fixture.publishedSignalId,
      status: "completed",
    });
  });

  it("keeps a Routine open when its initial callback precedes every batch publication", async () => {
    const fixture = await seedRoutineDeliveryFixture();
    await getPostgresDatabase(env).query({
      text: 'UPDATE "openmeld"."routine_runs" SET execution_engine = \'workflow\' WHERE id = $1',
      values: [fixture.runId],
    });
    const workerSubmit = vi.fn(async () => ({
      accepted: true,
      createdAt: fixture.nowMs,
      idempotencyKey: fixture.runId,
      requestId: `request_${fixture.runId}`,
      status: "pending" as const,
      submissionId: fixture.submissionId,
    }));
    const testEnv = buildEnv({ fixture, workerSubmit });
    await submitRemoteAgentRoutineDelivery({
      db: getPostgresDatabase(env),
      env: testEnv,
      nowMs: fixture.nowMs,
      routine: fixture.routine,
      run: fixture.run,
    });
    const destinations = ["alpha", "beta"].map((name) => ({
      childSpaceId: `space_${name}_${crypto.randomUUID()}`,
      clientMessageId: `ca-wake:${crypto.randomUUID()}`,
      targetProfileIds: [fixture.profileId],
    }));
    const [root, second] = destinations;
    if (!(root && second)) {
      throw new Error("Missing batch destinations");
    }
    const plan = planCenterAgentWakeDelegation({
      ...root,
      additionalDestinations: [second],
    });
    await prepareCenterAgentWakePublicationBatch({
      commands: destinations.map((destination, index) => ({
        activationTargets: destination.targetProfileIds,
        attribution: {
          actorProfileId: fixture.profileId,
          onBehalfOf: {
            displayName: "Routine Creator",
            profileId: fixture.creatorProfileId,
            userId: fixture.creatorUserId,
          },
        },
        batchRootPublicationId: root.clientMessageId,
        ...(index === 0
          ? {
              batchPublicationIds: destinations.map(
                (item) => item.clientMessageId
              ),
            }
          : {}),
        clientMessageId: destination.clientMessageId,
        completionMode: "resume_parent_when_all_terminal",
        context: {
          actorContext: {
            profileKind: "agent",
            profileName: "Routine Center Agent",
            requestId: fixture.runId,
            openMeldProfileId: fixture.profileId,
          },
          activeOrganizationId: fixture.organizationId,
          agentControllerConversationId: fixture.submissionId,
        },
        delegationId: plan.delegationId,
        fallbackAgentProfileId: null,
        mentionTargets: [],
        organizationId: fixture.organizationId,
        parentSubmissionId: fixture.submissionId,
        profile: {
          kind: "agent",
          profileId: fixture.profileId,
          profileName: "Routine Center Agent",
        },
        referenceTargets: [],
        spaceId: destination.childSpaceId,
        subscriptionIds: plan.childTasks
          .filter((child) => child.task.spaceId === destination.childSpaceId)
          .map((child) => child.subscriptionId),
        text: "Complete the delegated work.",
        v: 1,
      })),
      db: getPostgresDatabase(env),
      nowMs: fixture.nowMs + 100,
    });
    await expect(
      completeRemoteAgentNativeDelivery(
        testEnv,
        buildCompletedCallback(fixture),
        {
          bypassRoutineWorkflowRouting: true,
        }
      )
    ).resolves.toEqual({ publishedSignalId: null, status: "accepted" });
    expect(
      testEnv.__spaceStub.rpcPostSignalOnceByClientMessageId
    ).not.toHaveBeenCalled();
    await expect(
      readRoutineRunRecord({
        db: getPostgresDatabase(env),
        runId: fixture.runId,
      })
    ).resolves.toMatchObject({ status: "submitted" });
    const publishedSpaces: string[] = [];
    for (const destination of destinations) {
      await expect(
        executeCenterAgentWakePublication({
          db: getPostgresDatabase(env),
          nowMs: fixture.nowMs + 200,
          publicationId: destination.clientMessageId,
          publishSignal: (command) => {
            publishedSpaces.push(command.spaceId);
            return Promise.resolve(
              createSignal(
                `signal_${crypto.randomUUID()}`,
                fixture,
                command.spaceId
              )
            );
          },
          resolveSignal: async () => null,
        })
      ).resolves.toMatchObject({ status: "accepted" });
    }
    expect(publishedSpaces).toEqual(
      destinations.map((destination) => destination.childSpaceId)
    );
  });

  it.each([
    "completed",
    "failed",
  ] as const)("publishes only the resumed Routine's %s result in its chosen language", async (continuationStatus) => {
    const fixture = await seedRoutineDeliveryFixture();
    await setOrganizationWorkingLanguagePreference({
      db: getPostgresDatabase(env),
      organizationId: fixture.organizationId,
      mode: "selected",
      languageTag: "en",
      nowMs: fixture.nowMs,
      updatedByUserId: fixture.routine.createdByUserId,
    });
    await getPostgresDatabase(env).query({
      ...{
        text: 'UPDATE "openmeld"."routine_runs" SET execution_engine = \'workflow\' WHERE id = $1',
        values: [],
      },
      values: [fixture.runId],
    });
    const subscriptionId = `subscription_${crypto.randomUUID()}`;
    const continuationIdempotencyKey = `agent-task-continuation:${subscriptionId}`;
    const continuationSubmissionId = `submission_continuation_${crypto.randomUUID()}`;
    let deliveryIdDuringContinuationAdmission: string | null = null;
    const workerSubmit = vi.fn(
      async (request: RemoteAgentWorkerSubmitTurnRequest) => {
        if (request.idempotencyKey === continuationIdempotencyKey) {
          deliveryIdDuringContinuationAdmission =
            (
              await readRoutineRunRecord({
                db: getPostgresDatabase(env),
                runId: fixture.runId,
              })
            )?.nativeDeliveryId ?? null;
        }
        return {
          accepted: true,
          createdAt: fixture.nowMs,
          idempotencyKey: request.idempotencyKey,
          requestId: `request_${request.idempotencyKey}`,
          status: "pending" as const,
          submissionId:
            request.idempotencyKey === fixture.runId
              ? fixture.submissionId
              : continuationSubmissionId,
        };
      }
    );
    const testEnv = buildEnv({ fixture, workerSubmit });
    await submitRemoteAgentRoutineDelivery({
      db: getPostgresDatabase(env),
      env: testEnv,
      nowMs: fixture.nowMs,
      routine: fixture.routine,
      run: fixture.run,
    });
    const parentDelivery = await readRemoteAgentNativeDeliveryByIdempotencyKey({
      db: getPostgresDatabase(env),
      idempotencyKey: fixture.runId,
    });
    if (!parentDelivery) {
      throw new Error("Routine parent delivery was not created");
    }
    const watchedTask = {
      kind: "space_wake" as const,
      sourceClientMessageId: `client_child_${crypto.randomUUID()}`,
      spaceId: fixture.spaceId,
      targetProfileId: `agt_${crypto.randomUUID()}`,
      v: 1 as const,
    };
    const outcome = {
      errorCode: null,
      eventId: `terminal_child_${crypto.randomUUID()}`,
      occurredAtMs: fixture.nowMs + 500,
      publishedSignalId: `signal_child_${crypto.randomUUID()}`,
      status: "succeeded" as const,
    };
    const delegation = {
      barrier: "all_terminal" as const,
      children: [
        {
          agentProfileId: watchedTask.targetProfileId,
          role: "primary" as const,
          state: "terminal" as const,
          task: watchedTask,
          terminalOutcome: outcome,
        },
      ],
      delegationId: `delegation_${crypto.randomUUID()}`,
      generation: 1,
    };
    await registerAgentTaskCompletionSubscription({
      completionCondition: "terminal",
      continuation: {
        delegationId: delegation.delegationId,
        instruction: "Synthesize the delegated findings into the final report.",
        kind: "resume_agent",
        replyLanguageTag: "zh-Hans",
        sourceSignalId: fixture.runId,
        spaceId: fixture.spaceId,
        threadContext: null,
      },
      db: getPostgresDatabase(env),
      idempotencyKey: `subscription-key:${subscriptionId}`,
      nowMs: fixture.nowMs + 600,
      observerTask: {
        deliveryId: parentDelivery.deliveryId,
        kind: "native_delivery",
        v: 1,
      },
      organizationId: fixture.organizationId,
      subscriptionId,
      watchedTask,
    });
    vi.spyOn(Date, "now").mockReturnValue(fixture.nowMs + 1000);
    const intermediateCallback = {
      ...buildCompletedCallback(fixture),
      text: "Private notes before delegated research returns.",
    };
    await expect(
      completeRemoteAgentNativeDelivery(testEnv, intermediateCallback, {
        bypassRoutineWorkflowRouting: true,
      })
    ).resolves.toEqual({ publishedSignalId: null, status: "accepted" });
    expect(
      testEnv.__spaceStub.rpcPostSignalOnceByClientMessageId
    ).not.toHaveBeenCalled();
    await expect(
      readRoutineRunRecord({
        db: getPostgresDatabase(env),
        runId: fixture.runId,
      })
    ).resolves.toMatchObject({
      nativeDeliveryId: parentDelivery.deliveryId,
      status: "submitted",
    });
    await expect(
      completeRemoteAgentNativeDelivery(testEnv, intermediateCallback, {
        bypassRoutineWorkflowRouting: true,
      })
    ).resolves.toMatchObject({ status: "duplicate_rejected" });
    await expect(
      readRoutineRunRecord({
        db: getPostgresDatabase(env),
        runId: fixture.runId,
      })
    ).resolves.toMatchObject({
      nativeDeliveryId: parentDelivery.deliveryId,
      status: "submitted",
    });
    const terminalParentDelivery =
      await readRemoteAgentNativeDeliveryByIdempotencyKey({
        db: getPostgresDatabase(env),
        idempotencyKey: fixture.runId,
      });
    if (!terminalParentDelivery) {
      throw new Error("Routine parent delivery disappeared");
    }
    await recordAgentTaskTerminalOutcome({
      db: getPostgresDatabase(env),
      nowMs: fixture.nowMs + 1400,
      outcome,
      task: watchedTask,
    });
    await claimReadyAgentTaskCompletionSubscription({
      db: getPostgresDatabase(env),
      claimId: `claim:${subscriptionId}`,
      claimLeaseMs: 30_000,
      nowMs: fixture.nowMs + 1401,
      subscriptionId,
    });
    const skillInstalledAfterRunAdmission =
      await createOrganizationSkillService({
        bucket: env.OPENMELD_ORGANIZATION_SKILLS,
        db: getPostgresDatabase(env),
      }).create(
        {
          organizationId: fixture.organizationId,
          role: "owner",
          userId: fixture.userId,
        },
        {
          description: "This Skill should affect only later Routine Runs.",
          instructions: "Do not activate this Skill in the current Run.",
          name: "future-routine-skill",
        }
      );
    const continuation = await submitRemoteAgentTaskContinuationDelivery({
      db: getPostgresDatabase(env),
      delegation,
      delegationId: delegation.delegationId,
      env: testEnv,
      idempotencyKey: continuationIdempotencyKey,
      instruction: "Synthesize the delegated findings into the final report.",
      replyLanguageTag: "zh-Hans",
      isAuthorized: async () => true,
      nowMs: fixture.nowMs + 1500,
      observerDelivery: terminalParentDelivery,
      outcome,
      subscriptionId,
      watchedTask,
    });
    expect(continuation).toMatchObject({
      status: "submitted",
      task: { kind: "native_delivery" },
    });
    expect(deliveryIdDuringContinuationAdmission).toBe(
      parentDelivery.deliveryId
    );
    const continuationDelivery =
      await readRemoteAgentNativeDeliveryByIdempotencyKey({
        db: getPostgresDatabase(env),
        idempotencyKey: continuationIdempotencyKey,
      });
    if (!continuationDelivery) {
      throw new Error("Routine continuation delivery was not created");
    }
    expect(workerSubmit.mock.calls[1]?.[0]).toMatchObject({
      idempotencyKey: continuationIdempotencyKey,
      onBehalfOf: null,
      organizationSkillReleases: [],
      turnEnvelope: {
        sender: { kind: "routine", routineId: fixture.routineId },
        trigger: {
          continuation: {
            delegationId: delegation.delegationId,
            subscriptionId,
            watchedTask,
          },
          runId: fixture.runId,
          source: "routine",
        },
      },
    });
    expect(
      workerSubmit.mock.calls[1]?.[0]?.organizationSkillReleases
    ).not.toContainEqual({
      digest: skillInstalledAfterRunAdmission.activeRelease.digest,
      releaseId: skillInstalledAfterRunAdmission.activeRelease.id,
      skillId: skillInstalledAfterRunAdmission.id,
    });
    await expect(
      readRoutineRunRecord({
        db: getPostgresDatabase(env),
        runId: fixture.runId,
      })
    ).resolves.toMatchObject({
      nativeDeliveryId: continuationDelivery.deliveryId,
      status: "submitted",
    });
    await expect(
      readRemoteAgentNativeDeliveryByIdempotencyKey({
        db: getPostgresDatabase(env),
        idempotencyKey: fixture.runId,
      })
    ).resolves.toMatchObject({
      status: "completed",
      workerSubmitRequest: null,
    });
    expect(continuationDelivery.workerSubmitRequest).not.toBeNull();
    expect(
      workerSubmit.mock.calls[1]?.[0]?.messages.some((message) =>
        message.content.includes("reply-language decision: zh-Hans")
      )
    ).toBe(true);
    vi.spyOn(Date, "now").mockReturnValue(fixture.nowMs + 2000);
    await expect(
      completeRemoteAgentNativeDelivery(
        testEnv,
        {
          agentProfileId: fixture.profileId,
          bindingId: fixture.bindingId,
          dispatchId: continuationIdempotencyKey,
          idempotencyKey: continuationIdempotencyKey,
          organizationId: fixture.organizationId,
          spaceId: fixture.spaceId,
          submissionId: continuationSubmissionId,
          ...(continuationStatus === "failed"
            ? {
                status: "failed" as const,
                failureCode: "remote_agent.turn.context_window_exceeded",
                failureDetail: "synthetic-private-worker-detail",
                failureMessage:
                  "Center Agent couldn't generate a reply. Your message is saved.",
              }
            : { text: "Final report after delegated research." }),
          triggerMessageId: fixture.runId,
        },
        { bypassRoutineWorkflowRouting: true }
      )
    ).resolves.toEqual({
      publishedSignalId: fixture.publishedSignalId,
      status: "accepted",
    });
    expect(
      testEnv.__spaceStub.rpcPostSignalOnceByClientMessageId
    ).toHaveBeenCalledOnce();
    if (continuationStatus === "failed") {
      const text =
        testEnv.__spaceStub.rpcPostSignalOnceByClientMessageId.mock
          .calls[0]?.[0]?.text;
      expect(text).toContain("对话内容超过了模型一次能处理的范围。");
      expect(text).not.toContain("synthetic-private-worker-detail");
    }
    await expect(
      readRoutineRunRecord({
        db: getPostgresDatabase(env),
        runId: fixture.runId,
      })
    ).resolves.toMatchObject({
      nativeDeliveryId: continuationDelivery.deliveryId,
      publishedSignalId: fixture.publishedSignalId,
      status: continuationStatus,
    });
  });
  it("replays a rejected Routine continuation terminal event without rerunning the worker", async () => {
    const fixture = await seedRoutineDeliveryFixture();
    await getPostgresDatabase(env).query({
      ...{
        text: 'UPDATE "openmeld"."routine_runs" SET execution_engine = \'workflow\' WHERE id = $1',
        values: [],
      },
      values: [fixture.runId],
    });
    const continuationIdempotencyKey = `agent-task-continuation:${crypto.randomUUID()}`;
    const workerSubmit = vi.fn(
      async (request: RemoteAgentWorkerSubmitTurnRequest) =>
        request.idempotencyKey === fixture.runId
          ? {
              accepted: true,
              createdAt: fixture.nowMs,
              idempotencyKey: request.idempotencyKey,
              requestId: `request_${request.idempotencyKey}`,
              status: "pending" as const,
              submissionId: fixture.submissionId,
            }
          : {
              idempotencyKey: request.idempotencyKey,
              message: "The continuation identity is invalid.",
              outcome: "rejected" as const,
              reasonCode:
                "remote_agent.turn_envelope_identity_mismatch" as const,
              v: 1 as const,
            }
    );
    const workflowSendEvent = vi
      .fn()
      .mockRejectedValueOnce(new Error("Workflow event transport unavailable"))
      .mockResolvedValueOnce(undefined);
    const testEnv = buildEnv({
      fixture,
      routineWorkflowSendEvent: workflowSendEvent,
      workerSubmit,
    });
    await submitRemoteAgentRoutineDelivery({
      db: getPostgresDatabase(env),
      env: testEnv,
      nowMs: fixture.nowMs,
      routine: fixture.routine,
      run: fixture.run,
    });
    const admittedParentDelivery =
      await readRemoteAgentNativeDeliveryByIdempotencyKey({
        db: getPostgresDatabase(env),
        idempotencyKey: fixture.runId,
      });
    if (!admittedParentDelivery) {
      throw new Error("Routine parent delivery disappeared");
    }
    const watchedTask = {
      kind: "space_wake" as const,
      sourceClientMessageId: `client_child_${crypto.randomUUID()}`,
      spaceId: fixture.spaceId,
      targetProfileId: `agt_${crypto.randomUUID()}`,
      v: 1 as const,
    };
    const outcome = {
      errorCode: null,
      eventId: `terminal_child_${crypto.randomUUID()}`,
      occurredAtMs: fixture.nowMs + 500,
      publishedSignalId: `signal_child_${crypto.randomUUID()}`,
      status: "succeeded" as const,
    };
    const delegation = {
      barrier: "all_terminal" as const,
      children: [
        {
          agentProfileId: watchedTask.targetProfileId,
          role: "primary" as const,
          state: "terminal" as const,
          task: watchedTask,
          terminalOutcome: outcome,
        },
      ],
      delegationId: `delegation_${crypto.randomUUID()}`,
      generation: 1,
    };
    const subscriptionId = `subscription_${crypto.randomUUID()}`;
    await registerAgentTaskCompletionSubscription({
      completionCondition: "terminal",
      continuation: {
        delegationId: delegation.delegationId,
        instruction: "Synthesize the delegated findings into the final report.",
        kind: "resume_agent",
        sourceSignalId: fixture.runId,
        spaceId: fixture.spaceId,
        threadContext: null,
      },
      db: getPostgresDatabase(env),
      idempotencyKey: `subscription-key:${subscriptionId}`,
      nowMs: fixture.nowMs + 600,
      observerTask: {
        deliveryId: admittedParentDelivery.deliveryId,
        kind: "native_delivery",
        v: 1,
      },
      organizationId: fixture.organizationId,
      subscriptionId,
      watchedTask,
    });
    await completeRemoteAgentNativeDelivery(
      testEnv,
      {
        ...buildCompletedCallback(fixture),
        text: "Private notes before delegated research returns.",
      },
      { bypassRoutineWorkflowRouting: true }
    );
    const parentDelivery = await readRemoteAgentNativeDeliveryByIdempotencyKey({
      db: getPostgresDatabase(env),
      idempotencyKey: fixture.runId,
    });
    if (!parentDelivery) {
      throw new Error("Routine parent delivery disappeared");
    }
    const continuationInput = {
      db: getPostgresDatabase(env),
      delegation,
      delegationId: delegation.delegationId,
      env: testEnv,
      idempotencyKey: continuationIdempotencyKey,
      instruction: "Synthesize the delegated findings into the final report.",
      isAuthorized: async () => true,
      observerDelivery: parentDelivery,
      outcome,
      sourceSignalId: fixture.runId,
      spaceId: fixture.spaceId,
      subscriptionId,
      threadContext: null,
      watchedTask,
    };
    await expect(
      submitRemoteAgentTaskContinuationDelivery({
        ...continuationInput,
        nowMs: fixture.nowMs + 1000,
      })
    ).rejects.toThrow("Workflow event transport unavailable");
    await expect(
      readRoutineRunRecord({
        db: getPostgresDatabase(env),
        runId: fixture.runId,
      })
    ).resolves.toMatchObject({
      status: "submitted",
    });
    const fixtureOperator = postgresFixtureOperator(env);
    await fixtureOperator.query(`
      CREATE FUNCTION openmeld.test_reject_routine_continuation_terminal_projection()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'forced Routine continuation terminal projection failure';
      END
      $$;
      CREATE TRIGGER test_reject_routine_continuation_terminal_projection
      BEFORE UPDATE OF status ON openmeld.routine_runs
      FOR EACH ROW WHEN (NEW.status = 'failed')
      EXECUTE FUNCTION openmeld.test_reject_routine_continuation_terminal_projection();
    `);
    try {
      await expect(
        submitRemoteAgentTaskContinuationDelivery({
          ...continuationInput,
          nowMs: fixture.nowMs + 1100,
        })
      ).rejects.toThrow(
        "forced Routine continuation terminal projection failure"
      );
    } finally {
      await fixtureOperator.query(`
        DROP TRIGGER test_reject_routine_continuation_terminal_projection ON openmeld.routine_runs;
        DROP FUNCTION openmeld.test_reject_routine_continuation_terminal_projection();
      `);
    }
    await expect(
      readRoutineRunRecord({
        db: getPostgresDatabase(env),
        runId: fixture.runId,
      })
    ).resolves.toMatchObject({ status: "submitted" });
    await expect(
      finalizeRemoteAgentRoutineContinuationFailure({
        db: getPostgresDatabase(env),
        env: testEnv,
        failureCode: "remote_agent.turn_envelope_identity_mismatch",
        nowMs: fixture.nowMs + 1200,
        runId: fixture.runId,
      })
    ).resolves.toEqual({ finalized: true, terminal: true });
    await expect(
      submitRemoteAgentTaskContinuationDelivery({
        ...continuationInput,
        nowMs: fixture.nowMs + 1300,
      })
    ).resolves.toMatchObject({
      status: "terminal",
      task: { kind: "native_delivery" },
    });
    await expect(
      readRoutineRunRecord({
        db: getPostgresDatabase(env),
        runId: fixture.runId,
      })
    ).resolves.toMatchObject({
      failureCode: "remote_agent.turn_envelope_identity_mismatch",
      status: "failed",
    });
    expect(
      workerSubmit.mock.calls.filter(
        ([request]) => request.idempotencyKey === continuationIdempotencyKey
      )
    ).toHaveLength(1);
    expect(workflowSendEvent).toHaveBeenCalledTimes(2);
    expect(workflowSendEvent).toHaveBeenLastCalledWith({
      payload: {
        failureCode: "remote_agent.turn_envelope_identity_mismatch",
        kind: "terminal_failure",
      },
      type: ROUTINE_WORKFLOW_CALLBACK_EVENTS.continuation,
    });
  });

  it.each([
    "en",
    "zh-Hans",
  ])("fails immediately in %s when Remote Agent deterministically rejects Routine admission", async (languageTag) => {
    const fixture = await seedRoutineDeliveryFixture();
    await setOrganizationWorkingLanguagePreference({
      db: getPostgresDatabase(env),
      organizationId: fixture.organizationId,
      mode: "selected",
      languageTag,
      nowMs: fixture.nowMs,
      updatedByUserId: fixture.routine.createdByUserId,
    });
    const workerSubmit = vi.fn(async () => ({
      idempotencyKey: fixture.runId,
      message:
        "Remote Agent Routine execution identity does not match its turn envelope.",
      outcome: "rejected" as const,
      reasonCode: "remote_agent.routine_identity_mismatch" as const,
      v: 1 as const,
    }));
    const testEnv = buildEnv({ fixture, workerSubmit });
    await expect(
      submitRemoteAgentRoutineDelivery({
        db: getPostgresDatabase(env),
        env: testEnv,
        nowMs: fixture.nowMs,
        routine: fixture.routine,
        run: fixture.run,
      })
    ).resolves.toEqual({ status: "failed" });
    expect(workerSubmit).toHaveBeenCalledTimes(1);
    expect(
      testEnv.__spaceStub.rpcPostSignalOnceByClientMessageId
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining(
          languageTag === "en"
            ? "Routine “Daily feedback review” could not run because the Agent could not accept the request. Try running the Routine again or open diagnostics."
            : "Routine “Daily feedback review”未能运行，Agent 无法接纳本次请求。"
        ),
      })
    );
    await expect(
      readRoutineRunRecord({
        db: getPostgresDatabase(env),
        runId: fixture.runId,
      })
    ).resolves.toMatchObject({
      failureCode: "remote_agent.routine_identity_mismatch",
      failureDetail:
        "remote_agent.routine_identity_mismatch: Remote Agent Routine execution identity does not match its turn envelope.",
      status: "failed",
    });
    await expect(
      readRemoteAgentNativeDeliveryByIdempotencyKey({
        db: getPostgresDatabase(env),
        idempotencyKey: fixture.runId,
      })
    ).resolves.toMatchObject({
      failureCode: "remote_agent.routine_identity_mismatch",
      status: "failed",
      submissionId: null,
      workerSubmitRequest: null,
    });
  });
  it("fails a history-limited Run explicitly without reading its destination as execution history", async () => {
    const fixture = await seedRoutineDeliveryFixture();
    const workerSubmit = vi.fn().mockResolvedValueOnce({
      idempotencyKey: fixture.runId,
      message: "Worker diagnostic detail only.",
      outcome: "rejected" as const,
      reasonCode: "remote_agent.conversation_history_limit_exceeded" as const,
      v: 1 as const,
    });
    const testEnv = buildEnv({ fixture, workerSubmit });
    await expect(
      submitRemoteAgentRoutineDelivery({
        db: getPostgresDatabase(env),
        env: testEnv,
        nowMs: fixture.nowMs,
        routine: fixture.routine,
        run: fixture.run,
      })
    ).resolves.toEqual({ status: "failed" });
    expect(workerSubmit).toHaveBeenCalledOnce();
    expect(workerSubmit.mock.calls[0]?.[0]).toMatchObject({
      conversationId: buildRemoteAgentRoutineRunConversationId({
        agentProfileId: fixture.profileId,
        organizationId: fixture.organizationId,
        runId: fixture.runId,
      }),
      runtimeConversation: { generation: 0 },
      v: 4,
    });
    expect(
      testEnv.__spaceStub.rpcListDispatchConversationContinuitySignalsResult
    ).not.toHaveBeenCalled();
    await expect(
      readRoutineRunRecord({
        db: getPostgresDatabase(env),
        runId: fixture.runId,
      })
    ).resolves.toMatchObject({
      failureCode: "remote_agent.conversation_history_limit_exceeded",
      status: "failed",
    });
    await expect(
      readRemoteAgentNativeDeliveryByIdempotencyKey({
        db: getPostgresDatabase(env),
        idempotencyKey: fixture.runId,
      })
    ).resolves.toMatchObject({
      status: "failed",
    });
  });
  it("fails a Routine visibly when monthly Free credits are exhausted", async () => {
    const fixture = await seedRoutineDeliveryFixture();
    vi.mocked(readAiBilling).mockResolvedValueOnce({
      plan: "free",
      source: "free",
      policyVersion: "2026-10-v1",
      monthlyCredits: 5000,
      usedCredits: 5000,
      remainingCredits: 0,
      resetsAt: "2026-11-01T00:00:00.000Z",
      keySuffix: null,
      canManage: false,
      status: "exhausted",
    });
    const workerSubmit = vi.fn();
    const testEnv = buildEnv({
      fixture,
      workerSubmit,
    });
    await expect(
      submitRemoteAgentRoutineDelivery({
        db: getPostgresDatabase(env),
        env: testEnv,
        nowMs: fixture.nowMs,
        routine: fixture.routine,
        run: fixture.run,
      })
    ).resolves.toEqual({ status: "failed" });
    expect(workerSubmit).not.toHaveBeenCalled();
    expect(
      testEnv.__spaceStub.rpcPostSignalOnceByClientMessageId
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: expect.objectContaining({
          errorCode: "ai_usage.monthly_limit_reached",
        }),
        text: expect.stringContaining("monthly"),
      })
    );
    const failedRun = await readRoutineRunRecord({
      db: getPostgresDatabase(env),
      runId: fixture.runId,
    });
    expect(failedRun).toMatchObject({
      failureCode: "ai_usage.monthly_limit_reached",
      status: "failed",
    });
    expect(failedRun?.failureDetail).toContain(
      "ai_usage.monthly_limit_reached"
    );
    expect(failedRun?.failureDetail).toContain("monthly");
  });
  it("keeps the claimed target immutable while a Routine update changes only the next occurrence", async () => {
    const fixture = await seedRoutineDeliveryFixture();
    const futureSpaceId = await seedAdditionalRoutineTargetSpace({ fixture });
    await getPostgresDatabase(env).query({
      ...{
        text: 'UPDATE "openmeld"."routines" SET target_space_id = $1, updated_at_ms = $2 WHERE id = $3',
        values: [],
      },
      values: [futureSpaceId, fixture.nowMs + 1, fixture.routineId],
    });
    const nextRunId = `routine_run_${crypto.randomUUID()}`;
    const workerSubmit = vi.fn(
      async (request: RemoteAgentWorkerSubmitTurnRequest) => ({
        accepted: true,
        createdAt: fixture.nowMs,
        idempotencyKey: request.idempotencyKey,
        status: "pending" as const,
        submissionId:
          request.idempotencyKey === fixture.runId
            ? fixture.submissionId
            : `submission_${request.idempotencyKey}`,
      })
    );
    const memoryService = createMemoryService();
    const testEnv = buildEnv({
      additionalSpaceIds: [futureSpaceId],
      fixture,
      workerSubmit,
    });
    await expect(
      submitRemoteAgentRoutineDelivery({
        db: getPostgresDatabase(env),
        env: testEnv,
        memoryService,
        nowMs: fixture.nowMs,
        routine: fixture.routine,
        run: fixture.run,
      })
    ).resolves.toEqual({ status: "submitted" });
    expect(workerSubmit.mock.calls[0]?.[0]).toMatchObject({
      idempotencyKey: fixture.runId,
      spaceId: fixture.spaceId,
      turnEnvelope: {
        space: { id: fixture.spaceId },
      },
    });
    expect(memoryService.recallForOrganization).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ query: fixture.routine.instructions })
    );
    await expect(
      readRemoteAgentNativeDeliveryByIdempotencyKey({
        db: getPostgresDatabase(env),
        idempotencyKey: fixture.runId,
      })
    ).resolves.toMatchObject({ spaceId: fixture.spaceId });
    vi.spyOn(Date, "now").mockReturnValue(fixture.nowMs + 1000);
    await expect(
      completeRemoteAgentNativeDelivery(
        testEnv,
        buildCompletedCallback(fixture)
      )
    ).resolves.toMatchObject({ status: "accepted" });
    expect(
      testEnv.__spaceStubs.get(fixture.spaceId)
        ?.rpcPostSignalOnceByClientMessageId
    ).toHaveBeenCalledTimes(1);
    expect(
      testEnv.__spaceStubs.get(futureSpaceId)
        ?.rpcPostSignalOnceByClientMessageId
    ).not.toHaveBeenCalled();
    await expect(
      completeRemoteAgentNativeDelivery(testEnv, {
        ...buildCompletedCallback(fixture),
        spaceId: futureSpaceId,
      })
    ).resolves.toMatchObject({ status: "rejected" });
    expect(
      testEnv.__spaceStubs.get(fixture.spaceId)
        ?.rpcPostSignalOnceByClientMessageId
    ).toHaveBeenCalledTimes(1);
    expect(
      testEnv.__spaceStubs.get(futureSpaceId)
        ?.rpcPostSignalOnceByClientMessageId
    ).not.toHaveBeenCalled();
    await runRoutineSchedulerTick({
      db: getPostgresDatabase(env),
      generateRunId: () => nextRunId,
      nowMs: fixture.nowMs + 24 * 60 * 60 * 1000,
      submitRoutineDelivery: async (deliveryInput) =>
        await submitRemoteAgentRoutineDelivery({
          ...deliveryInput,
          env: testEnv,
          memoryService,
        }),
    });
    expect(workerSubmit.mock.calls[1]?.[0]).toMatchObject({
      idempotencyKey: nextRunId,
      spaceId: futureSpaceId,
      turnEnvelope: {
        space: { id: futureSpaceId },
      },
    });
    await expect(
      readRemoteAgentNativeDeliveryByIdempotencyKey({
        db: getPostgresDatabase(env),
        idempotencyKey: nextRunId,
      })
    ).resolves.toMatchObject({ spaceId: futureSpaceId });
  });
  it("fails closed against the claimed target when its membership is revoked", async () => {
    const fixture = await seedRoutineDeliveryFixture();
    const futureSpaceId = await seedAdditionalRoutineTargetSpace({ fixture });
    await getPostgresDatabase(env).transaction(async (client) =>
      (async () => {
        const results: QueryResult[] = [];
        for (const query of [
          {
            ...{
              text: 'UPDATE "openmeld"."routines" SET target_space_id = $1, updated_at_ms = $2 WHERE id = $3',
              values: [],
            },
            values: [futureSpaceId, fixture.nowMs + 1, fixture.routineId],
          },
          {
            ...{
              text: 'DELETE FROM "openmeld"."space_index_memberships" WHERE space_id = $1 AND profile_id = $2',
              values: [],
            },
            values: [fixture.spaceId, fixture.profileId],
          },
        ]) {
          results.push(await client.query(query));
        }
        return results;
      })()
    );
    const workerSubmit = vi.fn();
    const testEnv = buildEnv({
      additionalSpaceIds: [futureSpaceId],
      fixture,
      workerSubmit,
    });
    await expect(
      submitRemoteAgentRoutineDelivery({
        db: getPostgresDatabase(env),
        env: testEnv,
        nowMs: fixture.nowMs,
        routine: fixture.routine,
        run: fixture.run,
      })
    ).resolves.toEqual({ status: "failed" });
    expect(workerSubmit).not.toHaveBeenCalled();
    expect(
      testEnv.__spaceStubs.get(fixture.spaceId)
        ?.rpcPostSignalOnceByClientMessageId
    ).toHaveBeenCalledTimes(1);
    expect(
      testEnv.__spaceStubs.get(futureSpaceId)
        ?.rpcPostSignalOnceByClientMessageId
    ).not.toHaveBeenCalled();
    await expect(
      readRoutineRunRecord({
        db: getPostgresDatabase(env),
        runId: fixture.runId,
      })
    ).resolves.toMatchObject({
      failureCode: "remote_agent.routine_target_space_unavailable",
      status: "failed",
    });
  });
  it("accepts a valid callback that arrives before the worker ACK is persisted", async () => {
    const fixture = await seedRoutineDeliveryFixture();
    const workerSubmitRequest = await buildRoutineWorkerSubmitRequest(fixture);
    await claimRemoteAgentRoutineNativeDelivery({
      bindingId: fixture.bindingId,
      db: getPostgresDatabase(env),
      nowMs: fixture.nowMs,
      organizationId: fixture.organizationId,
      profileId: fixture.profileId,
      routineId: fixture.routineId,
      routineName: fixture.routine.name,
      runId: fixture.runId,
      spaceId: fixture.spaceId,
      workerSubmitRequest,
    });
    const workerSubmit = vi.fn();
    const testEnv = buildEnv({ fixture, workerSubmit });
    vi.spyOn(Date, "now").mockReturnValue(fixture.nowMs + 1000);
    await expect(
      completeRemoteAgentNativeDelivery(
        testEnv,
        buildCompletedCallback(fixture)
      )
    ).resolves.toEqual({
      publishedSignalId: fixture.publishedSignalId,
      status: "accepted",
    });
    expect(workerSubmit).not.toHaveBeenCalled();
    expect(
      testEnv.__spaceStub.rpcPostSignalOnceByClientMessageId
    ).toHaveBeenCalledTimes(1);
    await expect(
      readRemoteAgentNativeDeliveryByIdempotencyKey({
        db: getPostgresDatabase(env),
        idempotencyKey: fixture.runId,
      })
    ).resolves.toMatchObject({
      publishedSignalId: fixture.publishedSignalId,
      status: "completed",
      submissionId: fixture.submissionId,
      workerSubmitRequest: null,
    });
    await expect(
      readRoutineRunRecord({
        db: getPostgresDatabase(env),
        runId: fixture.runId,
      })
    ).resolves.toMatchObject({
      publishedSignalId: fixture.publishedSignalId,
      status: "completed",
    });
  });
  it("keeps an ambiguous worker RPC outcome pending, replays the run id, and accepts the late callback", async () => {
    const fixture = await seedRoutineDeliveryFixture();
    const workerSubmit = vi
      .fn()
      .mockRejectedValueOnce(
        new Error("transport disconnected after the worker admitted the turn")
      )
      .mockResolvedValueOnce({
        accepted: false,
        createdAt: fixture.nowMs,
        idempotencyKey: fixture.runId,
        status: "running" as const,
        submissionId: fixture.submissionId,
      });
    const testEnv = buildEnv({ fixture, workerSubmit });
    await expect(
      submitRemoteAgentRoutineDelivery({
        db: getPostgresDatabase(env),
        env: testEnv,
        nowMs: fixture.nowMs,
        routine: fixture.routine,
        run: fixture.run,
      })
    ).resolves.toEqual({ status: "submitted" });
    expect(workerSubmit).toHaveBeenCalledTimes(1);
    expect(
      testEnv.__spaceStub.rpcPostSignalOnceByClientMessageId
    ).not.toHaveBeenCalled();
    await expect(
      readRemoteAgentNativeDeliveryByIdempotencyKey({
        db: getPostgresDatabase(env),
        idempotencyKey: fixture.runId,
      })
    ).resolves.toMatchObject({
      status: "submitted",
      submissionId: null,
      workerSubmitRequest: expect.objectContaining({
        idempotencyKey: fixture.runId,
      }),
    });
    await expect(
      readRoutineRunRecord({
        db: getPostgresDatabase(env),
        runId: fixture.runId,
      })
    ).resolves.toMatchObject({ status: "submitted" });
    await expect(
      retryRemoteAgentRoutineSubmissions({
        db: getPostgresDatabase(env),
        env: testEnv,
        limit: 1,
        nowMs: fixture.nowMs + 60_000,
      })
    ).resolves.toEqual({ errors: 0, recovered: 1, scanned: 1 });
    expect(workerSubmit).toHaveBeenCalledTimes(2);
    expect(
      workerSubmit.mock.calls.map(([request]) => request.idempotencyKey)
    ).toEqual([fixture.runId, fixture.runId]);
    vi.spyOn(Date, "now").mockReturnValue(fixture.nowMs + 61_000);
    await expect(
      completeRemoteAgentNativeDelivery(
        testEnv,
        buildCompletedCallback(fixture)
      )
    ).resolves.toEqual({
      publishedSignalId: fixture.publishedSignalId,
      status: "accepted",
    });
    expect(
      testEnv.__spaceStub.rpcPostSignalOnceByClientMessageId
    ).toHaveBeenCalledTimes(1);
    await expect(
      readRoutineRunRecord({
        db: getPostgresDatabase(env),
        runId: fixture.runId,
      })
    ).resolves.toMatchObject({
      publishedSignalId: fixture.publishedSignalId,
      status: "completed",
    });
  });
  it("terminalizes a legacy Routine request that no longer satisfies the identity contract", async () => {
    const fixture = await seedRoutineDeliveryFixture();
    const workerSubmitRequest = await buildRoutineWorkerSubmitRequest(fixture);
    await claimRemoteAgentRoutineNativeDelivery({
      bindingId: fixture.bindingId,
      db: getPostgresDatabase(env),
      nowMs: fixture.nowMs,
      organizationId: fixture.organizationId,
      profileId: fixture.profileId,
      routineId: fixture.routineId,
      routineName: fixture.routine.name,
      runId: fixture.runId,
      spaceId: fixture.spaceId,
      workerSubmitRequest,
    });
    const storedRequest = await getPostgresDatabase(env)
      .query<{
        worker_submit_request_json: string | null;
      }>({
        ...{
          text: 'SELECT worker_submit_request_json FROM "openmeld"."openMeldRemoteAgent_native_delivery_ledger" WHERE idempotency_key = $1',
          values: [],
        },
        values: [fixture.runId],
      })
      .then((result) => result.rows[0] ?? null);
    expect(
      JSON.parse(storedRequest?.worker_submit_request_json ?? "null")
    ).toEqual({
      request: workerSubmitRequest,
      storageVersion: 1,
    });
    const legacyWorkerSubmitRequest = structuredClone(workerSubmitRequest);
    if (legacyWorkerSubmitRequest.turnEnvelope.sender.kind !== "routine") {
      throw new Error("Expected a Routine worker request");
    }
    (
      legacyWorkerSubmitRequest.turnEnvelope.sender.delegatedBy as {
        ownerUserId?: string;
      }
    ).ownerUserId = undefined;
    await getPostgresDatabase(env).query({
      ...{
        text: 'UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger" SET worker_submit_request_json = $1 WHERE idempotency_key = $2',
        values: [],
      },
      values: [JSON.stringify(legacyWorkerSubmitRequest), fixture.runId],
    });
    const workerSubmit = vi.fn();
    const testEnv = buildEnv({ fixture, workerSubmit });
    await expect(
      retryRemoteAgentRoutineSubmissions({
        db: getPostgresDatabase(env),
        env: testEnv,
        limit: 1,
        nowMs: fixture.nowMs + 60_000,
      })
    ).resolves.toEqual({ errors: 0, recovered: 1, scanned: 1 });
    expect(workerSubmit).not.toHaveBeenCalled();
    expect(
      testEnv.__spaceStub.rpcPostSignalOnceByClientMessageId
    ).toHaveBeenCalledTimes(1);
    expect(
      testEnv.__spaceStub.rpcPostSignalOnceByClientMessageId.mock.calls[0]?.[0]
        ?.text
    ).toContain("could not safely recover its saved execution request");
    await expect(
      readRoutineRunRecord({
        db: getPostgresDatabase(env),
        runId: fixture.runId,
      })
    ).resolves.toMatchObject({
      failureCode: "remote_agent.worker_submit_request_invalid",
      status: "failed",
    });
    await expect(
      readRemoteAgentNativeDeliveryByIdempotencyKey({
        db: getPostgresDatabase(env),
        idempotencyKey: fixture.runId,
      })
    ).resolves.toMatchObject({
      failureCode: "remote_agent.worker_submit_request_invalid",
      status: "failed",
      submissionId: null,
      workerSubmitRequest: null,
      workerSubmitRequestState: "absent",
    });
  });
  it.each([
    ["empty JSON", ""],
    ["malformed JSON", "{"],
    [
      "an unknown storage version",
      JSON.stringify({ request: {}, storageVersion: 2 }),
    ],
  ])("terminalizes %s in a saved Routine request", async (_caseName, value) => {
    const fixture = await seedRoutineDeliveryFixture();
    const workerSubmitRequest = await buildRoutineWorkerSubmitRequest(fixture);
    await claimRemoteAgentRoutineNativeDelivery({
      bindingId: fixture.bindingId,
      db: getPostgresDatabase(env),
      nowMs: fixture.nowMs,
      organizationId: fixture.organizationId,
      profileId: fixture.profileId,
      routineId: fixture.routineId,
      routineName: fixture.routine.name,
      runId: fixture.runId,
      spaceId: fixture.spaceId,
      workerSubmitRequest,
    });
    await getPostgresDatabase(env).query({
      ...{
        text: 'UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger" SET worker_submit_request_json = $1 WHERE idempotency_key = $2',
        values: [],
      },
      values: [value, fixture.runId],
    });
    const workerSubmit = vi.fn();
    const testEnv = buildEnv({ fixture, workerSubmit });
    await expect(
      retryRemoteAgentRoutineSubmissions({
        db: getPostgresDatabase(env),
        env: testEnv,
        limit: 1,
        nowMs: fixture.nowMs + 60_000,
      })
    ).resolves.toEqual({ errors: 0, recovered: 1, scanned: 1 });
    expect(workerSubmit).not.toHaveBeenCalled();
    expect(
      testEnv.__spaceStub.rpcPostSignalOnceByClientMessageId
    ).toHaveBeenCalledTimes(1);
    await expect(
      readRoutineRunRecord({
        db: getPostgresDatabase(env),
        runId: fixture.runId,
      })
    ).resolves.toMatchObject({
      failureCode: "remote_agent.worker_submit_request_invalid",
      status: "failed",
    });
  });
  it("keeps Workflow-owned submissions out of the legacy recovery scanner", async () => {
    const fixture = await seedRoutineDeliveryFixture();
    await getPostgresDatabase(env).query({
      ...{
        text: 'UPDATE "openmeld"."routine_runs" SET execution_engine = \'workflow\' WHERE id = $1',
        values: [],
      },
      values: [fixture.runId],
    });
    const workerSubmit = vi
      .fn()
      .mockRejectedValue(
        new Error("transport disconnected after Workflow admission")
      );
    const testEnv = buildEnv({ fixture, workerSubmit });
    await expect(
      submitRemoteAgentRoutineDelivery({
        db: getPostgresDatabase(env),
        env: testEnv,
        nowMs: fixture.nowMs,
        routine: fixture.routine,
        run: fixture.run,
      })
    ).resolves.toEqual({ status: "submitted" });
    await expect(
      retryRemoteAgentRoutineSubmissions({
        db: getPostgresDatabase(env),
        env: testEnv,
        limit: 1,
        nowMs: fixture.nowMs + 60_000,
      })
    ).resolves.toEqual({ errors: 0, recovered: 0, scanned: 0 });
    expect(workerSubmit).toHaveBeenCalledTimes(1);
  });
  it("forwards a Workflow-owned callback without publishing outside the Workflow", async () => {
    const fixture = await seedRoutineDeliveryFixture();
    await getPostgresDatabase(env).query({
      ...{
        text: 'UPDATE "openmeld"."routine_runs" SET execution_engine = \'workflow\' WHERE id = $1',
        values: [],
      },
      values: [fixture.runId],
    });
    const workerSubmit = vi.fn(async () => ({
      accepted: true,
      createdAt: fixture.nowMs,
      idempotencyKey: fixture.runId,
      status: "running" as const,
      submissionId: fixture.submissionId,
    }));
    const testEnv = buildEnv({ fixture, workerSubmit });
    const writeDataPoint = vi.fn();
    testEnv.OPENMELD_OBSERVABILITY = { writeDataPoint };
    testEnv.OPENMELD_WORKER_ENVIRONMENT = "test";
    const sendEvent = vi.fn(async () => undefined);
    testEnv.OPENMELD_ROUTINE_RUN_WORKFLOW = {
      get: vi.fn(async () => ({ sendEvent })),
    } as unknown as Workflow<{
      runId: string;
    }>;
    await expect(
      submitRemoteAgentRoutineDelivery({
        db: getPostgresDatabase(env),
        env: testEnv,
        nowMs: fixture.nowMs,
        routine: fixture.routine,
        run: fixture.run,
      })
    ).resolves.toEqual({ status: "submitted" });
    vi.spyOn(Date, "now").mockReturnValue(fixture.nowMs + 1000);
    const callback = buildCompletedCallback(fixture);
    await expect(
      completeRemoteAgentNativeDelivery(testEnv, callback)
    ).resolves.toEqual({ status: "accepted" });
    expect(sendEvent).toHaveBeenCalledWith({
      payload: callback,
      type: "remote-agent-initial-callback",
    });
    const point = writeDataPoint.mock.calls[0]?.[0] as
      | {
          blobs: string[];
          indexes: string[];
        }
      | undefined;
    expect(point?.indexes).toEqual([fixture.runId]);
    expect(point?.blobs[readAnalyticsBlobIndex("event")]).toBe(
      "core.openmeld.routine_workflow.callback_forwarded"
    );
    expect(
      testEnv.__spaceStub.rpcPostSignalOnceByClientMessageId
    ).not.toHaveBeenCalled();
    await expect(
      readRoutineRunRecord({
        db: getPostgresDatabase(env),
        runId: fixture.runId,
      })
    ).resolves.toMatchObject({ status: "submitted" });
  });
  it("records a retryable Workflow callback-forwarding failure by Run id", async () => {
    const fixture = await seedRoutineDeliveryFixture();
    await getPostgresDatabase(env).query({
      ...{
        text: 'UPDATE "openmeld"."routine_runs" SET execution_engine = \'workflow\' WHERE id = $1',
        values: [],
      },
      values: [fixture.runId],
    });
    const testEnv = buildEnv({
      fixture,
      workerSubmit: vi.fn(async () => ({
        accepted: true,
        createdAt: fixture.nowMs,
        idempotencyKey: fixture.runId,
        status: "running" as const,
        submissionId: fixture.submissionId,
      })),
    });
    const writeDataPoint = vi.fn();
    testEnv.OPENMELD_OBSERVABILITY = { writeDataPoint };
    testEnv.OPENMELD_WORKER_ENVIRONMENT = "test";
    testEnv.OPENMELD_ROUTINE_RUN_WORKFLOW = {
      get: vi.fn(async () => ({
        sendEvent: vi
          .fn()
          .mockRejectedValue(new Error("Workflow event transport unavailable")),
      })),
    } as unknown as Workflow<{
      runId: string;
    }>;
    await expect(
      submitRemoteAgentRoutineDelivery({
        db: getPostgresDatabase(env),
        env: testEnv,
        nowMs: fixture.nowMs,
        routine: fixture.routine,
        run: fixture.run,
      })
    ).resolves.toEqual({ status: "submitted" });
    vi.spyOn(Date, "now").mockReturnValue(fixture.nowMs + 1000);
    await expect(
      completeRemoteAgentNativeDelivery(
        testEnv,
        buildCompletedCallback(fixture)
      )
    ).resolves.toEqual({
      reasonCode: "routine.workflow_callback_forward_failed",
      status: "retryable",
    });
    const point = writeDataPoint.mock.calls[0]?.[0] as
      | {
          blobs: string[];
          indexes: string[];
        }
      | undefined;
    expect(point?.indexes).toEqual([fixture.runId]);
    expect(point?.blobs[readAnalyticsBlobIndex("event")]).toBe(
      "core.openmeld.routine_workflow.callback_forwarding_failed"
    );
    expect(
      testEnv.__spaceStub.rpcPostSignalOnceByClientMessageId
    ).not.toHaveBeenCalled();
    await expect(
      readRoutineRunRecord({
        db: getPostgresDatabase(env),
        runId: fixture.runId,
      })
    ).resolves.toMatchObject({ status: "submitted" });
  });
  it("replays an ambiguous pre-ACK delivery only to the claimed target after a Routine update", async () => {
    const fixture = await seedRoutineDeliveryFixture();
    const futureSpaceId = await seedAdditionalRoutineTargetSpace({ fixture });
    const workerSubmit = vi
      .fn()
      .mockRejectedValueOnce(new Error("worker ACK outcome is unknown"))
      .mockResolvedValueOnce({
        accepted: true,
        createdAt: fixture.nowMs,
        idempotencyKey: fixture.runId,
        status: "pending" as const,
        submissionId: fixture.submissionId,
      });
    const testEnv = buildEnv({
      additionalSpaceIds: [futureSpaceId],
      fixture,
      workerSubmit,
    });
    await submitRemoteAgentRoutineDelivery({
      db: getPostgresDatabase(env),
      env: testEnv,
      nowMs: fixture.nowMs,
      routine: fixture.routine,
      run: fixture.run,
    });
    await getPostgresDatabase(env).query({
      ...{
        text: 'UPDATE "openmeld"."routines" SET target_space_id = $1, updated_at_ms = $2 WHERE id = $3',
        values: [],
      },
      values: [futureSpaceId, fixture.nowMs + 1, fixture.routineId],
    });
    await expect(
      retryRemoteAgentRoutineSubmissions({
        db: getPostgresDatabase(env),
        env: testEnv,
        limit: 1,
        nowMs: fixture.nowMs + 60_000,
      })
    ).resolves.toEqual({ errors: 0, recovered: 1, scanned: 1 });
    expect(workerSubmit).toHaveBeenCalledTimes(2);
    expect(workerSubmit.mock.calls.map(([request]) => request.spaceId)).toEqual(
      [fixture.spaceId, fixture.spaceId]
    );
    expect(
      testEnv.__spaceStubs.get(futureSpaceId)
        ?.rpcPostSignalOnceByClientMessageId
    ).not.toHaveBeenCalled();
  });
  it("blocks an expired pre-ACK recovery when the ledger target conflicts with the Run snapshot", async () => {
    const fixture = await seedRoutineDeliveryFixture();
    const conflictingSpaceId = await seedAdditionalRoutineTargetSpace({
      fixture,
      spaceName: "Conflicting Recovery Target",
    });
    const claimedTargetRequest = await buildRoutineWorkerSubmitRequest(fixture);
    const conflictingRequest = retargetRoutineWorkerSubmitRequest({
      name: "Conflicting Recovery Target",
      request: claimedTargetRequest,
      spaceId: conflictingSpaceId,
    });
    await claimRemoteAgentRoutineNativeDelivery({
      bindingId: fixture.bindingId,
      db: getPostgresDatabase(env),
      nowMs: fixture.nowMs,
      organizationId: fixture.organizationId,
      profileId: fixture.profileId,
      routineId: fixture.routineId,
      routineName: fixture.routine.name,
      runId: fixture.runId,
      spaceId: fixture.spaceId,
      workerSubmitRequest: claimedTargetRequest,
    });
    await getPostgresDatabase(env).query({
      ...{
        text: 'UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger" SET space_id = $1, worker_submit_request_json = $2 WHERE idempotency_key = $3',
        values: [],
      },
      values: [
        conflictingSpaceId,
        JSON.stringify(conflictingRequest),
        fixture.runId,
      ],
    });
    const corruptedDelivery =
      await readRemoteAgentNativeDeliveryByIdempotencyKey({
        db: getPostgresDatabase(env),
        idempotencyKey: fixture.runId,
      });
    if (!corruptedDelivery) {
      throw new Error("Expected the conflicting delivery ledger");
    }
    await expect(
      claimRemoteAgentRoutineSubmissionRecoveryAttempt({
        db: getPostgresDatabase(env),
        deliveryId: corruptedDelivery.deliveryId,
        expectedUpdatedAtMs: corruptedDelivery.updatedAtMs,
        nowMs: fixture.nowMs + 60_000,
        organizationId: fixture.organizationId,
        runId: fixture.runId,
        runTargetSpaceId: fixture.spaceId,
      })
    ).resolves.toBeNull();
    const workerSubmit = vi.fn(async () => ({
      accepted: true,
      createdAt: fixture.nowMs,
      idempotencyKey: fixture.runId,
      status: "pending" as const,
      submissionId: fixture.submissionId,
    }));
    const testEnv = buildEnv({
      additionalSpaceIds: [conflictingSpaceId],
      fixture,
      workerSubmit,
    });
    const warn = vi.spyOn(console, "warn");
    await expect(
      retryRemoteAgentRoutineSubmissions({
        db: getPostgresDatabase(env),
        env: testEnv,
        limit: 1,
        nowMs: fixture.nowMs + 8 * 60_000,
      })
    ).resolves.toEqual({ errors: 0, recovered: 1, scanned: 1 });
    expect(workerSubmit).not.toHaveBeenCalled();
    expect(
      testEnv.__spaceStub.rpcPostSignalOnceByClientMessageId
    ).not.toHaveBeenCalled();
    expect(
      testEnv.__spaceStubs.get(conflictingSpaceId)
        ?.rpcPostSignalOnceByClientMessageId
    ).not.toHaveBeenCalled();
    await expect(
      readRoutineRunRecord({
        db: getPostgresDatabase(env),
        runId: fixture.runId,
      })
    ).resolves.toMatchObject({ status: "submitted" });
    await expect(
      readRemoteAgentNativeDeliveryByIdempotencyKey({
        db: getPostgresDatabase(env),
        idempotencyKey: fixture.runId,
      })
    ).resolves.toMatchObject({
      failureCode: "remote_agent.routine_target_recovery_blocked",
      status: "submitted",
      submissionId: null,
    });
    expect(warn).toHaveBeenCalledWith(
      "[core.remote_agent.routine_delivery.target_mismatch]",
      expect.objectContaining({
        ledgerSpaceId: conflictingSpaceId,
        resolution: "recovery_blocked",
        routineRunId: fixture.runId,
        runTargetSpaceId: fixture.spaceId,
      })
    );
    await expect(
      retryRemoteAgentRoutineSubmissions({
        db: getPostgresDatabase(env),
        env: testEnv,
        limit: 1,
        nowMs: fixture.nowMs + 16 * 60_000,
      })
    ).resolves.toEqual({ errors: 0, recovered: 0, scanned: 0 });
    expect(workerSubmit).not.toHaveBeenCalled();
  });
  it("rejects a late callback when the ledger target conflicts with the Run snapshot", async () => {
    const fixture = await seedRoutineDeliveryFixture();
    const conflictingSpaceId = await seedAdditionalRoutineTargetSpace({
      fixture,
      spaceName: "Conflicting Callback Target",
    });
    const claimedTargetRequest = await buildRoutineWorkerSubmitRequest(fixture);
    const conflictingRequest = retargetRoutineWorkerSubmitRequest({
      name: "Conflicting Callback Target",
      request: claimedTargetRequest,
      spaceId: conflictingSpaceId,
    });
    await claimRemoteAgentRoutineNativeDelivery({
      bindingId: fixture.bindingId,
      db: getPostgresDatabase(env),
      nowMs: fixture.nowMs,
      organizationId: fixture.organizationId,
      profileId: fixture.profileId,
      routineId: fixture.routineId,
      routineName: fixture.routine.name,
      runId: fixture.runId,
      spaceId: fixture.spaceId,
      workerSubmitRequest: claimedTargetRequest,
    });
    await getPostgresDatabase(env).query({
      ...{
        text: 'UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger" SET space_id = $1, worker_submit_request_json = $2 WHERE idempotency_key = $3',
        values: [],
      },
      values: [
        conflictingSpaceId,
        JSON.stringify(conflictingRequest),
        fixture.runId,
      ],
    });
    const testEnv = buildEnv({
      additionalSpaceIds: [conflictingSpaceId],
      fixture,
      workerSubmit: vi.fn(),
    });
    vi.spyOn(Date, "now").mockReturnValue(fixture.nowMs + 60_000);
    await expect(
      completeRemoteAgentNativeDelivery(testEnv, {
        ...buildCompletedCallback(fixture),
        spaceId: conflictingSpaceId,
      })
    ).resolves.toEqual({
      reasonCode: "remote_agent.routine_target_recovery_blocked",
      status: "rejected",
    });
    expect(
      testEnv.__spaceStub.rpcPostSignalOnceByClientMessageId
    ).not.toHaveBeenCalled();
    expect(
      testEnv.__spaceStubs.get(conflictingSpaceId)
        ?.rpcPostSignalOnceByClientMessageId
    ).not.toHaveBeenCalled();
    await expect(
      readRoutineRunRecord({
        db: getPostgresDatabase(env),
        runId: fixture.runId,
      })
    ).resolves.toMatchObject({ status: "submitted" });
    await expect(
      readRemoteAgentNativeDeliveryByIdempotencyKey({
        db: getPostgresDatabase(env),
        idempotencyKey: fixture.runId,
      })
    ).resolves.toMatchObject({
      failureCode: "remote_agent.routine_target_recovery_blocked",
      status: "callback_rejected",
    });
  });
  it("blocks deadline settlement when the ledger target conflicts with the Run snapshot", async () => {
    const fixture = await seedRoutineDeliveryFixture();
    const conflictingSpaceId = await seedAdditionalRoutineTargetSpace({
      fixture,
      spaceName: "Conflicting Deadline Target",
    });
    const claimedTargetRequest = await buildRoutineWorkerSubmitRequest(fixture);
    await claimRemoteAgentRoutineNativeDelivery({
      bindingId: fixture.bindingId,
      db: getPostgresDatabase(env),
      nowMs: fixture.nowMs,
      organizationId: fixture.organizationId,
      profileId: fixture.profileId,
      routineId: fixture.routineId,
      routineName: fixture.routine.name,
      runId: fixture.runId,
      spaceId: fixture.spaceId,
      workerSubmitRequest: claimedTargetRequest,
    });
    await markRemoteAgentNativeDeliveryAck({
      accepted: true,
      db: getPostgresDatabase(env),
      idempotencyKey: fixture.runId,
      nowMs: fixture.nowMs,
      submissionId: fixture.submissionId,
    });
    await getPostgresDatabase(env).query({
      ...{
        text: 'UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger" SET space_id = $1 WHERE idempotency_key = $2',
        values: [],
      },
      values: [conflictingSpaceId, fixture.runId],
    });
    const testEnv = buildEnv({
      additionalSpaceIds: [conflictingSpaceId],
      fixture,
      workerSubmit: vi.fn(),
    });
    await expect(
      processRemoteAgentNativeDeliveryDeadlineProbe({
        db: getPostgresDatabase(env),
        env: testEnv,
        nowMs: fixture.nowMs + 5 * 60_000,
        probe: {
          deadlineAtMs: fixture.nowMs + 4 * 60_000,
          dispatchId: fixture.runId,
          enqueuedAtMs: fixture.nowMs,
          idempotencyKey: fixture.runId,
          kind: "remote_agent_native_delivery_deadline_probe",
          organizationId: fixture.organizationId,
          spaceId: conflictingSpaceId,
          submissionId: fixture.submissionId,
          v: 3,
        },
      })
    ).resolves.toEqual({
      reasonCode: "remote_agent.routine_target_recovery_blocked",
      status: "skipped",
    });
    expect(
      testEnv.__spaceStub.rpcPostSignalOnceByClientMessageId
    ).not.toHaveBeenCalled();
    expect(
      testEnv.__spaceStubs.get(conflictingSpaceId)
        ?.rpcPostSignalOnceByClientMessageId
    ).not.toHaveBeenCalled();
    await expect(
      readRoutineRunRecord({
        db: getPostgresDatabase(env),
        runId: fixture.runId,
      })
    ).resolves.toMatchObject({ status: "submitted" });
    await expect(
      readRemoteAgentNativeDeliveryByIdempotencyKey({
        db: getPostgresDatabase(env),
        idempotencyKey: fixture.runId,
      })
    ).resolves.toMatchObject({
      failureCode: "remote_agent.routine_target_recovery_blocked",
      status: "accepted",
    });
  });
  it("returns a blocked Workflow submission when the ledger target conflicts with the Run snapshot", async () => {
    const fixture = await seedRoutineDeliveryFixture();
    const conflictingSpaceId = await seedAdditionalRoutineTargetSpace({
      fixture,
      spaceName: "Conflicting Workflow Target",
    });
    const claimedTargetRequest = await buildRoutineWorkerSubmitRequest(fixture);
    const conflictingRequest = retargetRoutineWorkerSubmitRequest({
      name: "Conflicting Workflow Target",
      request: claimedTargetRequest,
      spaceId: conflictingSpaceId,
    });
    await claimRemoteAgentRoutineNativeDelivery({
      bindingId: fixture.bindingId,
      db: getPostgresDatabase(env),
      nowMs: fixture.nowMs,
      organizationId: fixture.organizationId,
      profileId: fixture.profileId,
      routineId: fixture.routineId,
      routineName: fixture.routine.name,
      runId: fixture.runId,
      spaceId: fixture.spaceId,
      workerSubmitRequest: claimedTargetRequest,
    });
    await getPostgresDatabase(env).transaction(async (client) =>
      (async () => {
        const results: QueryResult[] = [];
        for (const query of [
          {
            ...{
              text: 'UPDATE "openmeld"."routine_runs" SET execution_engine = \'workflow\' WHERE id = $1',
              values: [],
            },
            values: [fixture.runId],
          },
          {
            ...{
              text: 'UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger" SET space_id = $1, worker_submit_request_json = $2 WHERE idempotency_key = $3',
              values: [],
            },
            values: [
              conflictingSpaceId,
              JSON.stringify(conflictingRequest),
              fixture.runId,
            ],
          },
        ]) {
          results.push(await client.query(query));
        }
        return results;
      })()
    );
    const workerSubmit = vi.fn();
    const testEnv = buildEnv({
      additionalSpaceIds: [conflictingSpaceId],
      fixture,
      workerSubmit,
    });
    await expect(
      ensureRemoteAgentRoutineWorkflowSubmission({
        db: getPostgresDatabase(env),
        env: testEnv,
        nowMs: fixture.nowMs + 60_000,
        runId: fixture.runId,
      })
    ).resolves.toEqual({
      reasonCode: "remote_agent.routine_target_recovery_blocked",
      status: "blocked",
    });
    expect(workerSubmit).not.toHaveBeenCalled();
    expect(
      testEnv.__spaceStub.rpcPostSignalOnceByClientMessageId
    ).not.toHaveBeenCalled();
    expect(
      testEnv.__spaceStubs.get(conflictingSpaceId)
        ?.rpcPostSignalOnceByClientMessageId
    ).not.toHaveBeenCalled();
  });
  it("returns a terminal Workflow submission after invalid legacy recovery is closed", async () => {
    const fixture = await seedRoutineDeliveryFixture();
    const workerSubmitRequest = await buildRoutineWorkerSubmitRequest(fixture);
    await claimRemoteAgentRoutineNativeDelivery({
      bindingId: fixture.bindingId,
      db: getPostgresDatabase(env),
      nowMs: fixture.nowMs,
      organizationId: fixture.organizationId,
      profileId: fixture.profileId,
      routineId: fixture.routineId,
      routineName: fixture.routine.name,
      runId: fixture.runId,
      spaceId: fixture.spaceId,
      workerSubmitRequest,
    });
    const legacyWorkerSubmitRequest = structuredClone(workerSubmitRequest);
    if (legacyWorkerSubmitRequest.turnEnvelope.sender.kind !== "routine") {
      throw new Error("Expected a Routine worker request");
    }
    (
      legacyWorkerSubmitRequest.turnEnvelope.sender.delegatedBy as {
        ownerUserId?: string;
      }
    ).ownerUserId = undefined;
    await getPostgresDatabase(env).transaction(async (client) =>
      (async () => {
        const results: QueryResult[] = [];
        for (const query of [
          {
            ...{
              text: 'UPDATE "openmeld"."routine_runs" SET execution_engine = \'workflow\' WHERE id = $1',
              values: [],
            },
            values: [fixture.runId],
          },
          {
            ...{
              text: 'UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger" SET worker_submit_request_json = $1 WHERE idempotency_key = $2',
              values: [],
            },
            values: [JSON.stringify(legacyWorkerSubmitRequest), fixture.runId],
          },
        ]) {
          results.push(await client.query(query));
        }
        return results;
      })()
    );
    const workerSubmit = vi.fn();
    const testEnv = buildEnv({ fixture, workerSubmit });
    await expect(
      ensureRemoteAgentRoutineWorkflowSubmission({
        db: getPostgresDatabase(env),
        env: testEnv,
        nowMs: fixture.nowMs + 60_000,
        runId: fixture.runId,
      })
    ).resolves.toEqual({ status: "terminal" });
    expect(workerSubmit).not.toHaveBeenCalled();
    expect(
      testEnv.__spaceStub.rpcPostSignalOnceByClientMessageId
    ).toHaveBeenCalledTimes(1);
    await expect(
      readRoutineRunRecord({
        db: getPostgresDatabase(env),
        runId: fixture.runId,
      })
    ).resolves.toMatchObject({
      failureCode: "remote_agent.worker_submit_request_invalid",
      status: "failed",
    });
  });
  it("keeps Workflow admission retryable when the worker ACK outcome is unknown", async () => {
    const fixture = await seedRoutineDeliveryFixture();
    const workerSubmitRequest = {
      ...(await buildRoutineWorkerSubmitRequest(fixture)),
      toolExecutionDeadlineAtMs:
        fixture.nowMs + REMOTE_AGENT_ADMISSION_WATCHDOG_DELAY_SECONDS * 1000,
    };
    await claimRemoteAgentRoutineNativeDelivery({
      bindingId: fixture.bindingId,
      db: getPostgresDatabase(env),
      nowMs: fixture.nowMs,
      organizationId: fixture.organizationId,
      profileId: fixture.profileId,
      routineId: fixture.routineId,
      routineName: fixture.routine.name,
      runId: fixture.runId,
      spaceId: fixture.spaceId,
      workerSubmitRequest,
    });
    await getPostgresDatabase(env).query({
      ...{
        text: 'UPDATE "openmeld"."routine_runs" SET execution_engine = \'workflow\' WHERE id = $1',
        values: [],
      },
      values: [fixture.runId],
    });
    const recoveryAtMs = fixture.nowMs + 60_000;
    const workerSubmit = vi
      .fn()
      .mockRejectedValue(
        new Error("transport disconnected after the worker admitted the turn")
      );
    const testEnv = buildEnv({ fixture, workerSubmit });
    await expect(
      ensureRemoteAgentRoutineWorkflowSubmission({
        db: getPostgresDatabase(env),
        env: testEnv,
        nowMs: recoveryAtMs,
        runId: fixture.runId,
      })
    ).rejects.toThrow("has no acknowledged Remote Agent submission");
    expect(workerSubmit).toHaveBeenCalledTimes(1);
    await expect(
      readRoutineRunRecord({
        db: getPostgresDatabase(env),
        runId: fixture.runId,
      })
    ).resolves.toMatchObject({ status: "submitted" });
    await expect(
      readRemoteAgentNativeDeliveryByIdempotencyKey({
        db: getPostgresDatabase(env),
        idempotencyKey: fixture.runId,
      })
    ).resolves.toMatchObject({
      status: "submitted",
      submissionId: null,
      workerSubmitRequest: expect.objectContaining({
        idempotencyKey: fixture.runId,
      }),
    });
    await expect(
      readRoutineRunRecord({
        db: getPostgresDatabase(env),
        runId: fixture.runId,
      })
    ).resolves.toMatchObject({ failureCode: null, status: "submitted" });
    expect(
      testEnv.__spaceStub.rpcPostSignalOnceByClientMessageId
    ).not.toHaveBeenCalled();
    workerSubmit.mockResolvedValueOnce({
      accepted: true,
      createdAt: fixture.nowMs,
      idempotencyKey: fixture.runId,
      status: "pending",
      submissionId: fixture.submissionId,
    });
    await expect(
      ensureRemoteAgentRoutineWorkflowSubmission({
        db: getPostgresDatabase(env),
        env: testEnv,
        nowMs: recoveryAtMs + 1000,
        runId: fixture.runId,
      })
    ).resolves.toMatchObject({
      status: "waiting",
      submissionId: fixture.submissionId,
    });
    expect(workerSubmit).toHaveBeenCalledTimes(2);
    expect(
      workerSubmit.mock.calls.map(([request]) => request.idempotencyKey)
    ).toEqual([fixture.runId, fixture.runId]);
  });
  it("keeps a Workflow waiting and retains its Routine envelope after worker ACK", async () => {
    const fixture = await seedRoutineDeliveryFixture();
    const workerSubmitRequest = await buildRoutineWorkerSubmitRequest(fixture);
    await claimRemoteAgentRoutineNativeDelivery({
      bindingId: fixture.bindingId,
      db: getPostgresDatabase(env),
      nowMs: fixture.nowMs,
      organizationId: fixture.organizationId,
      profileId: fixture.profileId,
      routineId: fixture.routineId,
      routineName: fixture.routine.name,
      runId: fixture.runId,
      spaceId: fixture.spaceId,
      workerSubmitRequest,
    });
    await getPostgresDatabase(env).query({
      ...{
        text: 'UPDATE "openmeld"."routine_runs" SET execution_engine = \'workflow\' WHERE id = $1',
        values: [],
      },
      values: [fixture.runId],
    });
    const workerSubmit = vi.fn(async () => ({
      accepted: true,
      createdAt: fixture.nowMs,
      idempotencyKey: fixture.runId,
      status: "pending" as const,
      submissionId: fixture.submissionId,
    }));
    await expect(
      ensureRemoteAgentRoutineWorkflowSubmission({
        db: getPostgresDatabase(env),
        env: buildEnv({ fixture, workerSubmit }),
        nowMs: fixture.nowMs + 60_000,
        runId: fixture.runId,
      })
    ).resolves.toEqual({
      dispatchId: fixture.runId,
      idempotencyKey: fixture.runId,
      organizationId: fixture.organizationId,
      spaceId: fixture.spaceId,
      status: "waiting",
      submissionId: fixture.submissionId,
    });
    await expect(
      readRemoteAgentNativeDeliveryByIdempotencyKey({
        db: getPostgresDatabase(env),
        idempotencyKey: fixture.runId,
      })
    ).resolves.toMatchObject({
      status: "accepted",
      submissionId: fixture.submissionId,
      workerSubmitRequest: expect.objectContaining({
        idempotencyKey: fixture.runId,
        turnEnvelope: expect.objectContaining({
          sender: expect.objectContaining({ kind: "routine" }),
        }),
      }),
    });
  });
  it("lets a real callback win while an expired recovery RPC outcome is still unknown", async () => {
    const fixture = await seedRoutineDeliveryFixture();
    const workerSubmitRequest = await buildRoutineWorkerSubmitRequest(fixture);
    await claimRemoteAgentRoutineNativeDelivery({
      bindingId: fixture.bindingId,
      db: getPostgresDatabase(env),
      nowMs: fixture.nowMs,
      organizationId: fixture.organizationId,
      profileId: fixture.profileId,
      routineId: fixture.routineId,
      routineName: fixture.routine.name,
      runId: fixture.runId,
      spaceId: fixture.spaceId,
      workerSubmitRequest,
    });
    let rejectWorker = (_reason: unknown): void => {
      throw new Error("Worker recovery did not start");
    };
    let signalWorkerStarted = (): void => {
      throw new Error("Worker recovery waiter was not initialized");
    };
    const workerStarted = new Promise<void>((resolve) => {
      signalWorkerStarted = resolve;
    });
    const workerSubmit = vi.fn(
      () =>
        new Promise<never>((_resolve, reject) => {
          rejectWorker = reject;
          signalWorkerStarted();
        })
    );
    const testEnv = buildEnv({ fixture, workerSubmit });
    const recoveryAtMs = fixture.nowMs + 4 * 60_000;
    const recovery = retryRemoteAgentRoutineSubmissions({
      db: getPostgresDatabase(env),
      env: testEnv,
      limit: 1,
      nowMs: recoveryAtMs,
    });
    await workerStarted;
    vi.spyOn(Date, "now").mockReturnValue(recoveryAtMs);
    await expect(
      completeRemoteAgentNativeDelivery(
        testEnv,
        buildCompletedCallback(fixture)
      )
    ).resolves.toEqual({
      publishedSignalId: fixture.publishedSignalId,
      status: "accepted",
    });
    rejectWorker(new Error("transport disconnected after admission"));
    await expect(recovery).resolves.toEqual({
      errors: 1,
      recovered: 0,
      scanned: 1,
    });
    expect(
      testEnv.__spaceStub.rpcPostSignalOnceByClientMessageId
    ).toHaveBeenCalledTimes(1);
    await expect(
      readRemoteAgentNativeDeliveryByIdempotencyKey({
        db: getPostgresDatabase(env),
        idempotencyKey: fixture.runId,
      })
    ).resolves.toMatchObject({
      failureCode: null,
      publishedSignalId: fixture.publishedSignalId,
      status: "completed",
      submissionId: fixture.submissionId,
    });
    await expect(
      readRoutineRunRecord({
        db: getPostgresDatabase(env),
        runId: fixture.runId,
      })
    ).resolves.toMatchObject({
      failureCode: null,
      publishedSignalId: fixture.publishedSignalId,
      status: "completed",
    });
  });
  it("keeps the expiry-boundary replay pending when the worker admitted it but the ACK was lost", async () => {
    const fixture = await seedRoutineDeliveryFixture();
    const workerSubmitRequest = await buildRoutineWorkerSubmitRequest(fixture);
    await claimRemoteAgentRoutineNativeDelivery({
      bindingId: fixture.bindingId,
      db: getPostgresDatabase(env),
      nowMs: fixture.nowMs,
      organizationId: fixture.organizationId,
      profileId: fixture.profileId,
      routineId: fixture.routineId,
      routineName: fixture.routine.name,
      runId: fixture.runId,
      spaceId: fixture.spaceId,
      workerSubmitRequest,
    });
    const workerSubmit = vi.fn(() =>
      Promise.reject(
        new Error("transport disconnected after the worker admitted the turn")
      )
    );
    const testEnv = buildEnv({ fixture, workerSubmit });
    const replayedAtMs = fixture.nowMs + 4 * 60_000;
    await expect(
      retryRemoteAgentRoutineSubmissions({
        db: getPostgresDatabase(env),
        env: testEnv,
        limit: 1,
        nowMs: replayedAtMs,
      })
    ).resolves.toEqual({ errors: 1, recovered: 0, scanned: 1 });
    expect(workerSubmit).toHaveBeenCalledTimes(1);
    expect(
      testEnv.__spaceStub.rpcPostSignalOnceByClientMessageId
    ).not.toHaveBeenCalled();
    await expect(
      readRoutineRunRecord({
        db: getPostgresDatabase(env),
        runId: fixture.runId,
      })
    ).resolves.toMatchObject({ status: "submitted" });
    vi.spyOn(Date, "now").mockReturnValue(replayedAtMs + 1);
    await expect(
      completeRemoteAgentNativeDelivery(
        testEnv,
        buildCompletedCallback(fixture)
      )
    ).resolves.toEqual({
      publishedSignalId: fixture.publishedSignalId,
      status: "accepted",
    });
    expect(
      testEnv.__spaceStub.rpcPostSignalOnceByClientMessageId
    ).toHaveBeenCalledTimes(1);
    await expect(
      readRoutineRunRecord({
        db: getPostgresDatabase(env),
        runId: fixture.runId,
      })
    ).resolves.toMatchObject({
      failureCode: null,
      publishedSignalId: fixture.publishedSignalId,
      status: "completed",
    });
  });
  it("fails visibly when the member who delegated the Routine leaves the Organization", async () => {
    const fixture = await seedRoutineDeliveryFixture();
    await getPostgresDatabase(env).query({
      ...{
        text: 'DELETE FROM "openmeld"."members" WHERE organization_id = $1 AND user_id = $2',
        values: [],
      },
      values: [fixture.organizationId, fixture.creatorUserId],
    });
    const workerSubmit = vi.fn(async () => ({
      accepted: true,
      createdAt: fixture.nowMs,
      idempotencyKey: fixture.runId,
      status: "pending" as const,
      submissionId: fixture.submissionId,
    }));
    await expect(
      submitRemoteAgentRoutineDelivery({
        db: getPostgresDatabase(env),
        env: buildEnv({ fixture, workerSubmit }),
        nowMs: fixture.nowMs,
        routine: fixture.routine,
        run: fixture.run,
      })
    ).resolves.toEqual({ status: "failed" });
    expect(workerSubmit).not.toHaveBeenCalled();
    await expect(
      readRoutineRunRecord({
        db: getPostgresDatabase(env),
        runId: fixture.runId,
      })
    ).resolves.toMatchObject({
      failureCode: "routine.member_actor_required",
      status: "failed",
    });
  });
  it("fences concurrent failure-redrive scanners with one Space publication key", async () => {
    const fixture = await seedRoutineDeliveryFixture();
    await getPostgresDatabase(env).query({
      ...{
        text: "UPDATE \"openmeld\".\"routine_runs\" SET status = 'failed', failure_code = 'remote_agent.test_failure', failure_detail = 'Visible failure', finished_at_ms = $1 WHERE id = $2",
        values: [],
      },
      values: [fixture.nowMs, fixture.runId],
    });
    const testEnv = buildEnv({ fixture, workerSubmit: vi.fn() });
    await Promise.all([
      retryRemoteAgentRoutineFailurePublications({
        db: getPostgresDatabase(env),
        env: testEnv,
        limit: 1,
        nowMs: fixture.nowMs + 60_000,
      }),
      retryRemoteAgentRoutineFailurePublications({
        db: getPostgresDatabase(env),
        env: testEnv,
        limit: 1,
        nowMs: fixture.nowMs + 60_000,
      }),
    ]);
    expect(
      new Set(
        testEnv.__spaceStub.rpcPostSignalOnceByClientMessageId.mock.calls.map(
          ([call]) => call.clientMessageId
        )
      )
    ).toEqual(new Set([fixture.runId]));
    await expect(
      readRoutineRunRecord({
        db: getPostgresDatabase(env),
        runId: fixture.runId,
      })
    ).resolves.toMatchObject({
      publishedSignalId: fixture.publishedSignalId,
      status: "failed",
    });
  });
  it.each([
    "paused",
    "deleted",
  ] as const)("skips a claimed Run when the Routine is %s before admission", async (race) => {
    const fixture = await seedRoutineDeliveryFixture();
    if (race === "paused") {
      await getPostgresDatabase(env).query({
        ...{
          text: 'UPDATE "openmeld"."routines" SET status = \'paused\', next_due_at = NULL WHERE id = $1',
          values: [],
        },
        values: [fixture.routineId],
      });
    } else {
      await getPostgresDatabase(env).query({
        ...{
          text: 'DELETE FROM "openmeld"."routines" WHERE id = $1',
          values: [],
        },
        values: [fixture.routineId],
      });
    }
    const workerSubmit = vi.fn();
    const testEnv = buildEnv({ fixture, workerSubmit });
    await expect(
      submitRemoteAgentRoutineDelivery({
        db: getPostgresDatabase(env),
        env: testEnv,
        nowMs: fixture.nowMs,
        routine: fixture.routine,
        run: fixture.run,
      })
    ).resolves.toEqual({ status: "skipped" });
    expect(workerSubmit).not.toHaveBeenCalled();
    expect(
      testEnv.__spaceStub.rpcPostSignalOnceByClientMessageId
    ).not.toHaveBeenCalled();
    expect(
      await readRemoteAgentNativeDeliveryByIdempotencyKey({
        db: getPostgresDatabase(env),
        idempotencyKey: fixture.runId,
      })
    ).toBeNull();
    await expect(
      readRoutineRunRecord({
        db: getPostgresDatabase(env),
        runId: fixture.runId,
      })
    ).resolves.toMatchObject({
      failureCode: "routine.not_enabled_at_admission",
      status: "skipped",
    });
  });
  it.each([
    [
      "remote_agent.empty_assistant_response",
      "The Agent produced no reply.",
      "en",
    ],
    [
      "remote_agent.turn.output_limit_exceeded",
      "The Agent reached the model's response limit before it could reply.",
      "en",
    ],
    [
      "remote_agent.turn_not_completed",
      "OpenMeld could not confirm this task's outcome. Earlier actions may have taken effect.",
      "en",
    ],
    [
      "remote_agent.provider.connection_missing",
      "Routine Center Agent couldn't connect to its model provider.",
      "en",
    ],
    [
      "remote_agent.turn.context_window_exceeded",
      "The conversation has grown too long for this model.",
      "en",
    ],
    [
      "remote_agent.execution_identity_mismatch",
      "OpenMeld could not confirm the reply's Agent identity.",
      "en",
    ],
    [
      "remote_agent.work_loop_continuation_limit_exceeded",
      "The Agent reached the safe execution limit before finishing.",
      "en",
    ],
    [
      "remote_agent.turn.context_window_exceeded",
      "对话内容超过了模型一次能处理的范围。",
      "zh-Hans",
    ],
  ])("projects a %s callback once and keeps late callbacks from reopening the Run in %s", async (failureCode, expectedFailureText, languageTag) => {
    const fixture = await seedRoutineDeliveryFixture();
    await setOrganizationWorkingLanguagePreference({
      db: getPostgresDatabase(env),
      organizationId: fixture.organizationId,
      mode: "selected",
      languageTag,
      nowMs: fixture.nowMs,
      updatedByUserId: fixture.routine.createdByUserId,
    });
    const futureSpaceId = await seedAdditionalRoutineTargetSpace({ fixture });
    const workerSubmit = vi.fn(async () => ({
      accepted: true,
      createdAt: fixture.nowMs,
      idempotencyKey: fixture.runId,
      status: "pending" as const,
      submissionId: fixture.submissionId,
    }));
    const testEnv = buildEnv({
      additionalSpaceIds: [futureSpaceId],
      fixture,
      webAppUrl: "https://openmeld.ai",
      workerSubmit,
    });
    await submitRemoteAgentRoutineDelivery({
      db: getPostgresDatabase(env),
      env: testEnv,
      nowMs: fixture.nowMs,
      routine: fixture.routine,
      run: fixture.run,
    });
    await getPostgresDatabase(env).query({
      ...{
        text: 'UPDATE "openmeld"."routines" SET target_space_id = $1, updated_at_ms = $2 WHERE id = $3',
        values: [],
      },
      values: [futureSpaceId, fixture.nowMs + 1, fixture.routineId],
    });
    vi.spyOn(Date, "now").mockReturnValue(fixture.nowMs + 1000);
    const failedCallback = {
      agentProfileId: fixture.profileId,
      bindingId: fixture.bindingId,
      dispatchId: fixture.runId,
      failureCode,
      failureDetail: "synthetic-private-worker-detail",
      failureMessage:
        "Center Agent couldn't generate a reply. Your message is saved.",
      idempotencyKey: fixture.runId,
      organizationId: fixture.organizationId,
      spaceId: fixture.spaceId,
      status: "failed" as const,
      submissionId: fixture.submissionId,
      triggerMessageId: fixture.runId,
    };
    await expect(
      completeRemoteAgentNativeDelivery(testEnv, failedCallback)
    ).resolves.toEqual({
      publishedSignalId: fixture.publishedSignalId,
      status: "accepted",
    });
    expect(
      testEnv.__spaceStub.rpcPostSignalOnceByClientMessageId
    ).toHaveBeenCalledTimes(1);
    expect(
      testEnv.__spaceStubs.get(futureSpaceId)
        ?.rpcPostSignalOnceByClientMessageId
    ).not.toHaveBeenCalled();
    expect(
      testEnv.__spaceStub.rpcPostSignalOnceByClientMessageId.mock.calls[0]?.[0]
        ?.text
    ).toContain(`Routine “${fixture.routine.name}”: ${expectedFailureText}`);
    expect(
      testEnv.__spaceStub.rpcPostSignalOnceByClientMessageId.mock.calls[0]?.[0]
        ?.text
    ).not.toContain("could not run");
    expect(
      testEnv.__spaceStub.rpcPostSignalOnceByClientMessageId.mock.calls[0]?.[0]
        ?.text
    ).not.toContain("synthetic-private-worker-detail");
    expect(
      testEnv.__spaceStub.rpcPostSignalOnceByClientMessageId.mock.calls[0]?.[0]
        ?.text
    ).toContain(`Run ID: ${fixture.runId}`);
    expect(
      testEnv.__spaceStub.rpcPostSignalOnceByClientMessageId.mock.calls[0]?.[0]
        ?.text
    ).toContain(
      languageTag === "zh-Hans"
        ? "[查看 Run 详情](https://openmeld.ai/o/"
        : "[View Run details](https://openmeld.ai/o/"
    );
    expect(
      testEnv.__spaceStub.rpcPostSignalOnceByClientMessageId.mock.calls[0]?.[0]
        ?.text
    ).toContain(
      `/center-agent/routines?routineId=${fixture.routineId}&runId=${fixture.runId})`
    );
    await expect(
      readRoutineRunRecord({
        db: getPostgresDatabase(env),
        runId: fixture.runId,
      })
    ).resolves.toMatchObject({
      failureCode,
      publishedSignalId: fixture.publishedSignalId,
      status: "failed",
    });
    await expect(
      completeRemoteAgentNativeDelivery(
        testEnv,
        buildCompletedCallback(fixture)
      )
    ).resolves.toMatchObject({ status: "duplicate_rejected" });
    expect(
      testEnv.__spaceStub.rpcPostSignalOnceByClientMessageId
    ).toHaveBeenCalledTimes(1);
    await expect(
      readRoutineRunRecord({
        db: getPostgresDatabase(env),
        runId: fixture.runId,
      })
    ).resolves.toMatchObject({
      failureCode,
      status: "failed",
    });
  });
  it("keeps a Routine completion retryable after the former callback ceiling", async () => {
    const fixture = await seedRoutineDeliveryFixture();
    const workerSubmit = vi.fn(async () => ({
      accepted: true,
      createdAt: fixture.nowMs,
      idempotencyKey: fixture.runId,
      status: "pending" as const,
      submissionId: fixture.submissionId,
    }));
    const testEnv = buildEnv({ fixture, workerSubmit });
    await submitRemoteAgentRoutineDelivery({
      db: getPostgresDatabase(env),
      env: testEnv,
      nowMs: fixture.nowMs,
      routine: fixture.routine,
      run: fixture.run,
    });
    testEnv.__spaceStub.rpcPostSignalOnceByClientMessageId.mockRejectedValueOnce(
      new Error("Space success publication unavailable")
    );
    vi.spyOn(Date, "now").mockReturnValue(fixture.nowMs + 1000);
    await expect(
      completeRemoteAgentNativeDelivery(testEnv, {
        ...buildCompletedCallback(fixture),
        callbackAttempt: 5,
      })
    ).resolves.toEqual({
      reasonCode: "remote_agent.callback_publish_failed",
      status: "retryable",
    });
    await expect(
      readRoutineRunRecord({
        db: getPostgresDatabase(env),
        runId: fixture.runId,
      })
    ).resolves.toMatchObject({
      failureCode: null,
      publishedSignalId: null,
      status: "submitted",
    });
  });
  it("projects an outcome-unknown failed callback immediately", async () => {
    const fixture = await seedRoutineDeliveryFixture();
    const futureSpaceId = await seedAdditionalRoutineTargetSpace({ fixture });
    const workerSubmit = vi.fn(async () => ({
      accepted: true,
      createdAt: fixture.nowMs,
      idempotencyKey: fixture.runId,
      status: "pending" as const,
      submissionId: fixture.submissionId,
    }));
    const testEnv = buildEnv({
      additionalSpaceIds: [futureSpaceId],
      fixture,
      workerSubmit,
    });
    await submitRemoteAgentRoutineDelivery({
      db: getPostgresDatabase(env),
      env: testEnv,
      nowMs: fixture.nowMs,
      routine: fixture.routine,
      run: fixture.run,
    });
    await getPostgresDatabase(env).query({
      ...{
        text: 'UPDATE "openmeld"."routines" SET target_space_id = $1, updated_at_ms = $2 WHERE id = $3',
        values: [],
      },
      values: [futureSpaceId, fixture.nowMs + 1, fixture.routineId],
    });
    testEnv.__spaceStub.rpcPostSignalOnceByClientMessageId.mockResolvedValueOnce(
      null
    );
    vi.spyOn(Date, "now").mockReturnValue(fixture.nowMs + 1000);
    await expect(
      completeRemoteAgentNativeDelivery(testEnv, {
        agentProfileId: fixture.profileId,
        bindingId: fixture.bindingId,
        dispatchId: fixture.runId,
        failureCode: "remote_agent.turn_not_completed",
        failureMessage: "Remote Agent could not finish this request.",
        idempotencyKey: fixture.runId,
        organizationId: fixture.organizationId,
        spaceId: fixture.spaceId,
        status: "failed",
        submissionId: fixture.submissionId,
        triggerMessageId: fixture.runId,
      })
    ).resolves.toMatchObject({
      reasonCode: "remote_agent.callback_publication_outcome_unknown",
      status: "rejected",
    });
    await expect(
      readRoutineRunRecord({
        db: getPostgresDatabase(env),
        runId: fixture.runId,
      })
    ).resolves.toMatchObject({
      failureCode: "remote_agent.turn_not_completed",
      publishedSignalId: null,
      status: "failed",
    });
    await expect(
      retryRemoteAgentRoutineFailurePublications({
        db: getPostgresDatabase(env),
        env: testEnv,
        limit: 1,
        nowMs: fixture.nowMs + 60_000,
      })
    ).resolves.toEqual({ errors: 0, published: 1, scanned: 1 });
    expect(
      testEnv.__spaceStubs.get(fixture.spaceId)
        ?.rpcPostSignalOnceByClientMessageId
    ).toHaveBeenCalledTimes(2);
    expect(
      testEnv.__spaceStubs.get(futureSpaceId)
        ?.rpcPostSignalOnceByClientMessageId
    ).not.toHaveBeenCalled();
  });
  it("repairs a Run after a failed callback crashes in outcome-unknown state", async () => {
    const fixture = await seedRoutineDeliveryFixture();
    const workerSubmit = vi.fn(async () => ({
      accepted: true,
      createdAt: fixture.nowMs,
      idempotencyKey: fixture.runId,
      status: "pending" as const,
      submissionId: fixture.submissionId,
    }));
    const testEnv = buildEnv({ fixture, workerSubmit });
    await submitRemoteAgentRoutineDelivery({
      db: getPostgresDatabase(env),
      env: testEnv,
      nowMs: fixture.nowMs,
      routine: fixture.routine,
      run: fixture.run,
    });
    const claimId = crypto.randomUUID();
    await claimRemoteAgentFinalPublication({
      claimExpiresAtMs: fixture.nowMs + 30_000,
      claimId,
      db: getPostgresDatabase(env),
      idempotencyKey: fixture.runId,
      nowMs: fixture.nowMs + 1000,
      payload: {
        failureCode: "remote_agent.turn_not_completed",
        failureDetail: null,
        resumeStatus: "accepted",
        storageVersion: 1,
        text: "The hosted Routine could not complete.",
      },
      submissionId: fixture.submissionId,
      terminalFailureCode: "remote_agent.turn_not_completed",
    });
    await markRemoteAgentFailedCallbackPublicationOutcomeUnknown({
      claimId,
      db: getPostgresDatabase(env),
      failureCode: "remote_agent.turn_not_completed",
      idempotencyKey: fixture.runId,
      nowMs: fixture.nowMs + 2000,
      submissionId: fixture.submissionId,
    });
    await expect(
      readRoutineRunRecord({
        db: getPostgresDatabase(env),
        runId: fixture.runId,
      })
    ).resolves.toMatchObject({ status: "submitted" });
    vi.spyOn(Date, "now").mockReturnValue(fixture.nowMs + 3000);
    await completeRemoteAgentNativeDelivery(testEnv, {
      agentProfileId: fixture.profileId,
      bindingId: fixture.bindingId,
      dispatchId: fixture.runId,
      failureCode: "remote_agent.turn_not_completed",
      failureMessage: "Remote Agent could not finish this request.",
      idempotencyKey: fixture.runId,
      organizationId: fixture.organizationId,
      spaceId: fixture.spaceId,
      status: "failed",
      submissionId: fixture.submissionId,
      triggerMessageId: fixture.runId,
    });
    await expect(
      readRoutineRunRecord({
        db: getPostgresDatabase(env),
        runId: fixture.runId,
      })
    ).resolves.toMatchObject({
      failureCode: "remote_agent.turn_not_completed",
      status: "failed",
    });
  });
  it.each([
    "space_claim",
    "terminal_ledger",
  ] as const)("repairs the Run from %s deadline recovery evidence", async (recovery) => {
    const fixture = await seedRoutineDeliveryFixture();
    const futureSpaceId = await seedAdditionalRoutineTargetSpace({ fixture });
    const workerSubmit = vi.fn(async () => ({
      accepted: true,
      createdAt: fixture.nowMs,
      idempotencyKey: fixture.runId,
      status: "pending" as const,
      submissionId: fixture.submissionId,
    }));
    const testEnv = buildEnv({
      additionalSpaceIds: [futureSpaceId],
      fixture,
      workerSubmit,
    });
    await submitRemoteAgentRoutineDelivery({
      db: getPostgresDatabase(env),
      env: testEnv,
      nowMs: fixture.nowMs,
      routine: fixture.routine,
      run: fixture.run,
    });
    await getPostgresDatabase(env).query({
      ...{
        text: 'UPDATE "openmeld"."routines" SET target_space_id = $1, updated_at_ms = $2 WHERE id = $3',
        values: [],
      },
      values: [futureSpaceId, fixture.nowMs + 1, fixture.routineId],
    });
    if (recovery === "space_claim") {
      testEnv.__spaceStub.rpcReadFinalReplyClaimSignalId.mockResolvedValue({
        signalId: fixture.publishedSignalId,
      });
    } else {
      await markRemoteAgentNativeDeliveryCompleted({
        db: getPostgresDatabase(env),
        nowMs: fixture.nowMs + 500,
        publishedSignalId: fixture.publishedSignalId,
        submissionId: fixture.submissionId,
      });
    }
    await processRemoteAgentNativeDeliveryDeadlineProbe({
      db: getPostgresDatabase(env),
      env: testEnv,
      nowMs: fixture.nowMs + 1000,
      probe: {
        deadlineAtMs: fixture.nowMs,
        dispatchId: fixture.runId,
        enqueuedAtMs: fixture.nowMs - 1000,
        idempotencyKey: fixture.runId,
        kind: "remote_agent_native_delivery_deadline_probe",
        organizationId: fixture.organizationId,
        spaceId: fixture.spaceId,
        submissionId: fixture.submissionId,
        v: 3,
      },
    });
    await expect(
      readRoutineRunRecord({
        db: getPostgresDatabase(env),
        runId: fixture.runId,
      })
    ).resolves.toMatchObject({
      publishedSignalId: fixture.publishedSignalId,
      status: "completed",
    });
    expect(
      testEnv.__spaceStubs.get(futureSpaceId)
        ?.rpcPostSignalOnceByClientMessageId
    ).not.toHaveBeenCalled();
  });
  it("fences callback and duplicate deadline probes with one Space publication key", async () => {
    const fixture = await seedRoutineDeliveryFixture();
    const testEnv = buildEnv({
      fixture,
      workerSubmit: vi.fn(async () => ({
        accepted: true,
        createdAt: fixture.nowMs,
        idempotencyKey: fixture.runId,
        status: "pending" as const,
        submissionId: fixture.submissionId,
      })),
    });
    await submitRemoteAgentRoutineDelivery({
      db: getPostgresDatabase(env),
      env: testEnv,
      nowMs: fixture.nowMs,
      routine: fixture.routine,
      run: fixture.run,
    });
    const nowMs = fixture.nowMs + 1000;
    vi.spyOn(Date, "now").mockReturnValue(nowMs);
    const probe = {
      deadlineAtMs: fixture.nowMs,
      dispatchId: fixture.runId,
      enqueuedAtMs: fixture.nowMs - 1000,
      idempotencyKey: fixture.runId,
      kind: "remote_agent_native_delivery_deadline_probe" as const,
      organizationId: fixture.organizationId,
      spaceId: fixture.spaceId,
      submissionId: fixture.submissionId,
      v: 3 as const,
    };
    await Promise.allSettled([
      completeRemoteAgentNativeDelivery(
        testEnv,
        buildCompletedCallback(fixture)
      ),
      processRemoteAgentNativeDeliveryDeadlineProbe({
        db: getPostgresDatabase(env),
        env: testEnv,
        nowMs,
        probe,
      }),
      processRemoteAgentNativeDeliveryDeadlineProbe({
        db: getPostgresDatabase(env),
        env: testEnv,
        nowMs,
        probe,
      }),
    ]);
    expect(
      new Set(
        testEnv.__spaceStub.rpcPostSignalOnceByClientMessageId.mock.calls.map(
          ([call]) => call.clientMessageId
        )
      )
    ).toEqual(new Set([fixture.runId]));
    const terminalRun = await readRoutineRunRecord({
      db: getPostgresDatabase(env),
      runId: fixture.runId,
    });
    const terminalDelivery =
      await readRemoteAgentNativeDeliveryByIdempotencyKey({
        db: getPostgresDatabase(env),
        idempotencyKey: fixture.runId,
      });
    expect(["completed", "failed"]).toContain(terminalRun?.status);
    expect(terminalDelivery?.publishedSignalId).toBe(fixture.publishedSignalId);
    expect(terminalRun?.publishedSignalId).toBe(
      terminalDelivery?.publishedSignalId
    );
  });
  it("reconciles an accepted execution against its claimed target after a Routine target update", async () => {
    const fixture = await seedRoutineDeliveryFixture();
    const futureSpaceId = await seedAdditionalRoutineTargetSpace({ fixture });
    const workerSubmit = vi.fn(async () => ({
      accepted: true,
      createdAt: fixture.nowMs,
      idempotencyKey: fixture.runId,
      status: "pending" as const,
      submissionId: fixture.submissionId,
    }));
    const workerReconcile = vi.fn(async () => ({
      execution: {
        acceptedAtMs: fixture.nowMs,
        cancellationReason: null,
        completedAtMs: null,
        idempotencyKey: fixture.runId,
        lastProgressAtMs: fixture.nowMs + 500,
        lastProgressKind: "tool_started" as const,
        organizationId: fixture.organizationId,
        spaceId: fixture.spaceId,
        status: "running" as const,
        submissionId: fixture.submissionId,
        v: 1 as const,
      },
      status: "found" as const,
    }));
    const testEnv = buildEnv({
      additionalSpaceIds: [futureSpaceId],
      fixture,
      workerReconcile,
      workerSubmit,
    });
    await submitRemoteAgentRoutineDelivery({
      db: getPostgresDatabase(env),
      env: testEnv,
      nowMs: fixture.nowMs,
      routine: fixture.routine,
      run: fixture.run,
    });
    await getPostgresDatabase(env).query({
      ...{
        text: 'UPDATE "openmeld"."routines" SET target_space_id = $1, updated_at_ms = $2 WHERE id = $3',
        values: [],
      },
      values: [futureSpaceId, fixture.nowMs + 1, fixture.routineId],
    });
    const probe = {
      deadlineAtMs:
        fixture.nowMs +
        REMOTE_AGENT_ACCEPTED_DELIVERY_PROBE_DELAY_SECONDS * 1000,
      dispatchId: fixture.runId,
      enqueuedAtMs: fixture.nowMs,
      idempotencyKey: fixture.runId,
      kind: "remote_agent_native_delivery_deadline_probe" as const,
      organizationId: fixture.organizationId,
      spaceId: fixture.spaceId,
      submissionId: fixture.submissionId,
      v: 3 as const,
    };
    expect(testEnv.__queueSend).toHaveBeenCalledWith(probe, {
      delaySeconds: REMOTE_AGENT_ACCEPTED_DELIVERY_PROBE_DELAY_SECONDS,
    });
    testEnv.__queueSend.mockClear();
    await expect(
      processRemoteAgentNativeDeliveryDeadlineProbe({
        db: getPostgresDatabase(env),
        env: testEnv,
        nowMs: probe.deadlineAtMs,
        probe,
      })
    ).resolves.toEqual({
      reasonCode: "remote_agent.execution_reconciliation_scheduled",
      status: "skipped",
    });
    expect(workerReconcile).toHaveBeenCalledWith({
      conversationId: buildRemoteAgentRoutineRunConversationId({
        agentProfileId: fixture.profileId,
        organizationId: fixture.organizationId,
        runId: fixture.runId,
      }),
      idempotencyKey: fixture.runId,
      organizationId: fixture.organizationId,
      spaceId: fixture.spaceId,
      submissionId: fixture.submissionId,
      v: 1,
    });
    expect(testEnv.__queueSend).toHaveBeenCalledWith(probe, {
      delaySeconds: REMOTE_AGENT_ACCEPTED_DELIVERY_PROBE_DELAY_SECONDS,
    });
    expect(
      testEnv.__spaceStubs.get(fixture.spaceId)
        ?.rpcPostSignalOnceByClientMessageId
    ).not.toHaveBeenCalled();
    expect(
      testEnv.__spaceStubs.get(futureSpaceId)
        ?.rpcPostSignalOnceByClientMessageId
    ).not.toHaveBeenCalled();
  });
  it("atomically rejects native delivery when the Routine is paused at the claim boundary", async () => {
    const fixture = await seedRoutineDeliveryFixture();
    const workerSubmitRequest = await buildRoutineWorkerSubmitRequest(fixture);
    await getPostgresDatabase(env).query({
      ...{
        text: 'UPDATE "openmeld"."routines" SET status = \'paused\', next_due_at = NULL WHERE id = $1',
        values: [],
      },
      values: [fixture.routineId],
    });
    await expect(
      claimRemoteAgentRoutineNativeDelivery({
        bindingId: fixture.bindingId,
        db: getPostgresDatabase(env),
        nowMs: fixture.nowMs,
        organizationId: fixture.organizationId,
        profileId: fixture.profileId,
        routineId: fixture.routineId,
        routineName: fixture.routine.name,
        runId: fixture.runId,
        spaceId: fixture.spaceId,
        workerSubmitRequest,
      })
    ).resolves.toEqual({ delivery: null, status: "lost_race" });
    await expect(
      readRoutineRunRecord({
        db: getPostgresDatabase(env),
        runId: fixture.runId,
      })
    ).resolves.toMatchObject({ status: "claimed" });
  });
  it("keeps the Run submitted when the worker ACK wins the recovery failure race", async () => {
    const fixture = await seedRoutineDeliveryFixture();
    const workerSubmitRequest = await buildRoutineWorkerSubmitRequest(fixture);
    const claim = await claimRemoteAgentRoutineNativeDelivery({
      bindingId: fixture.bindingId,
      db: getPostgresDatabase(env),
      nowMs: fixture.nowMs,
      organizationId: fixture.organizationId,
      profileId: fixture.profileId,
      routineId: fixture.routineId,
      routineName: fixture.routine.name,
      runId: fixture.runId,
      spaceId: fixture.spaceId,
      workerSubmitRequest,
    });
    if (claim.status !== "claimed") {
      throw new Error("Expected the Routine delivery claim to win");
    }
    await markRemoteAgentNativeDeliveryAck({
      accepted: true,
      db: getPostgresDatabase(env),
      idempotencyKey: fixture.runId,
      nowMs: fixture.nowMs + 1000,
      submissionId: fixture.submissionId,
    });
    await expect(
      claimRemoteAgentRoutineSubmissionFailure({
        db: getPostgresDatabase(env),
        deliveryId: claim.delivery.deliveryId,
        failureCode: "remote_agent.runtime_disabled",
        failureDetail: "Remote Agent is disabled for this Organization.",
        ledgerStatus: "flag_rejected",
        nowMs: fixture.nowMs + 2000,
        organizationId: fixture.organizationId,
        runId: fixture.runId,
      })
    ).resolves.toBeNull();
    await expect(
      readRoutineRunRecord({
        db: getPostgresDatabase(env),
        runId: fixture.runId,
      })
    ).resolves.toMatchObject({ status: "submitted" });
    await expect(
      readRemoteAgentNativeDeliveryByIdempotencyKey({
        db: getPostgresDatabase(env),
        idempotencyKey: fixture.runId,
      })
    ).resolves.toMatchObject({
      failureCode: null,
      status: "accepted",
      submissionId: fixture.submissionId,
    });
    await markRemoteAgentNativeDeliveryDeadlineProbeEnqueued({
      db: getPostgresDatabase(env),
      idempotencyKey: fixture.runId,
      nowMs: fixture.nowMs + 2000,
      submissionId: fixture.submissionId,
    });
  });
  it("redrives an admission failure publication durably on the next Routine tick", async () => {
    const fixture = await seedRoutineDeliveryFixture();
    const futureSpaceId = await seedAdditionalRoutineTargetSpace({ fixture });
    await getPostgresDatabase(env).transaction(async (client) =>
      (async () => {
        const results: QueryResult[] = [];
        for (const query of [
          {
            ...{
              text: 'UPDATE "openmeld"."routines" SET target_space_id = $1, updated_at_ms = $2 WHERE id = $3',
              values: [],
            },
            values: [futureSpaceId, fixture.nowMs + 1, fixture.routineId],
          },
          {
            ...{
              text: 'DELETE FROM "openmeld"."center_agent_designations" WHERE organization_id = $1',
              values: [],
            },
            values: [fixture.organizationId],
          },
        ]) {
          results.push(await client.query(query));
        }
        return results;
      })()
    );
    const workerSubmit = vi.fn();
    const testEnv = buildEnv({
      additionalSpaceIds: [futureSpaceId],
      fixture,
      workerSubmit,
    });
    testEnv.__spaceStub.rpcPostSignalOnceByClientMessageId
      .mockRejectedValueOnce(new Error("Space unavailable 1"))
      .mockRejectedValueOnce(new Error("Space unavailable 2"))
      .mockRejectedValueOnce(new Error("Space unavailable 3"));
    await expect(
      submitRemoteAgentRoutineDelivery({
        db: getPostgresDatabase(env),
        env: testEnv,
        nowMs: fixture.nowMs,
        routine: fixture.routine,
        run: fixture.run,
      })
    ).resolves.toEqual({ status: "failed" });
    await expect(
      readRoutineRunRecord({
        db: getPostgresDatabase(env),
        runId: fixture.runId,
      })
    ).resolves.toMatchObject({ publishedSignalId: null, status: "failed" });
    await expect(
      retryRemoteAgentRoutineFailurePublications({
        db: getPostgresDatabase(env),
        env: testEnv,
        limit: 1,
        nowMs: fixture.nowMs + 60_000,
      })
    ).resolves.toEqual({ errors: 0, published: 1, scanned: 1 });
    expect(
      testEnv.__spaceStub.rpcPostSignalOnceByClientMessageId
    ).toHaveBeenCalledTimes(4);
    expect(
      testEnv.__spaceStubs.get(futureSpaceId)
        ?.rpcPostSignalOnceByClientMessageId
    ).not.toHaveBeenCalled();
    expect(
      testEnv.__spaceStub.rpcPostSignalOnceByClientMessageId.mock.calls[3]?.[0]
        ?.text
    ).toContain(`Routine “${fixture.routine.name}”`);
    await expect(
      readRoutineRunRecord({
        db: getPostgresDatabase(env),
        runId: fixture.runId,
      })
    ).resolves.toMatchObject({
      publishedSignalId: fixture.publishedSignalId,
      status: "failed",
    });
  });
  it("fails closed without a second Space when a submitted ledger conflicts with the Run snapshot", async () => {
    const fixture = await seedRoutineDeliveryFixture();
    const conflictingSpaceId = await seedAdditionalRoutineTargetSpace({
      fixture,
      spaceName: "Conflicting Historical Target",
    });
    const claimedTargetRequest = await buildRoutineWorkerSubmitRequest(fixture);
    const workerSubmitRequest = retargetRoutineWorkerSubmitRequest({
      name: "Conflicting Historical Target",
      request: claimedTargetRequest,
      spaceId: conflictingSpaceId,
    });
    await claimRemoteAgentRoutineNativeDelivery({
      bindingId: fixture.bindingId,
      db: getPostgresDatabase(env),
      nowMs: fixture.nowMs,
      organizationId: fixture.organizationId,
      profileId: fixture.profileId,
      routineId: fixture.routineId,
      routineName: fixture.routine.name,
      runId: fixture.runId,
      spaceId: fixture.spaceId,
      workerSubmitRequest: claimedTargetRequest,
    });
    await getPostgresDatabase(env).transaction(async (client) =>
      (async () => {
        const results: QueryResult[] = [];
        for (const query of [
          {
            ...{
              text: 'UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger" SET space_id = $1, worker_submit_request_json = $2 WHERE idempotency_key = $3',
              values: [],
            },
            values: [
              conflictingSpaceId,
              JSON.stringify(workerSubmitRequest),
              fixture.runId,
            ],
          },
          {
            ...{
              text: "UPDATE \"openmeld\".\"routine_runs\" SET status = 'failed', failure_code = 'remote_agent.test_failure', failure_detail = 'Corrupt target authority', finished_at_ms = $1 WHERE id = $2",
              values: [],
            },
            values: [fixture.nowMs + 1, fixture.runId],
          },
        ]) {
          results.push(await client.query(query));
        }
        return results;
      })()
    );
    const workerSubmit = vi.fn();
    const testEnv = buildEnv({
      additionalSpaceIds: [conflictingSpaceId],
      fixture,
      workerSubmit,
    });
    const warn = vi.spyOn(console, "warn");
    await expect(
      retryRemoteAgentRoutineFailurePublications({
        db: getPostgresDatabase(env),
        env: testEnv,
        limit: 1,
        nowMs: fixture.nowMs + 60_000,
      })
    ).resolves.toEqual({ errors: 1, published: 0, scanned: 1 });
    expect(
      testEnv.__spaceStubs.get(fixture.spaceId)
        ?.rpcPostSignalOnceByClientMessageId
    ).not.toHaveBeenCalled();
    expect(
      testEnv.__spaceStubs.get(conflictingSpaceId)
        ?.rpcPostSignalOnceByClientMessageId
    ).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      "[core.remote_agent.routine_delivery.target_mismatch]",
      expect.objectContaining({
        ledgerSpaceId: conflictingSpaceId,
        routineRunId: fixture.runId,
        runTargetSpaceId: fixture.spaceId,
      })
    );
  });
  it("atomically rejects worker, ledger, and Run target disagreement at claim", async () => {
    const fixture = await seedRoutineDeliveryFixture();
    const conflictingSpaceId = await seedAdditionalRoutineTargetSpace({
      fixture,
    });
    const claimedTargetRequest = await buildRoutineWorkerSubmitRequest(fixture);
    const conflictingRequest = retargetRoutineWorkerSubmitRequest({
      name: "Conflicting Target",
      request: claimedTargetRequest,
      spaceId: conflictingSpaceId,
    });
    await expect(
      claimRemoteAgentRoutineNativeDelivery({
        bindingId: fixture.bindingId,
        db: getPostgresDatabase(env),
        nowMs: fixture.nowMs,
        organizationId: fixture.organizationId,
        profileId: fixture.profileId,
        routineId: fixture.routineId,
        routineName: fixture.routine.name,
        runId: fixture.runId,
        spaceId: fixture.spaceId,
        workerSubmitRequest: conflictingRequest,
      })
    ).rejects.toThrow("worker request does not match its claim authority");
    await expect(
      claimRemoteAgentRoutineNativeDelivery({
        bindingId: fixture.bindingId,
        db: getPostgresDatabase(env),
        nowMs: fixture.nowMs,
        organizationId: fixture.organizationId,
        profileId: fixture.profileId,
        routineId: fixture.routineId,
        routineName: fixture.routine.name,
        runId: fixture.runId,
        spaceId: conflictingSpaceId,
        workerSubmitRequest: conflictingRequest,
      })
    ).resolves.toEqual({ delivery: null, status: "lost_race" });
    await expect(
      claimRemoteAgentRoutineAdmissionFailure({
        bindingId: fixture.bindingId,
        db: getPostgresDatabase(env),
        failureCode: "remote_agent.runtime_disabled",
        failureDetail: "Remote Agent is disabled for this Organization.",
        ledgerStatus: "flag_rejected",
        nowMs: fixture.nowMs,
        organizationId: fixture.organizationId,
        profileId: fixture.profileId,
        routineId: fixture.routineId,
        routineName: fixture.routine.name,
        runId: fixture.runId,
        spaceId: conflictingSpaceId,
      })
    ).resolves.toEqual({ delivery: null, status: "lost_race" });
    await expect(
      readRoutineRunRecord({
        db: getPostgresDatabase(env),
        runId: fixture.runId,
      })
    ).resolves.toMatchObject({ nativeDeliveryId: null, status: "claimed" });
    await expect(
      readRemoteAgentNativeDeliveryByIdempotencyKey({
        db: getPostgresDatabase(env),
        idempotencyKey: fixture.runId,
      })
    ).resolves.toBeNull();
  });
  it("backs off a poison failure publication so a newer Run is not starved", async () => {
    const poison = await seedRoutineDeliveryFixture();
    const healthy = await seedRoutineDeliveryFixture();
    await getPostgresDatabase(env).transaction(async (client) =>
      (async () => {
        const results: QueryResult[] = [];
        for (const query of [
          {
            ...{
              text: "UPDATE \"openmeld\".\"routine_runs\" SET status = 'failed', failure_code = 'remote_agent.test_failure', failure_detail = 'Poison Space', finished_at_ms = $1 WHERE id = $2",
              values: [],
            },
            values: [poison.nowMs, poison.runId],
          },
          {
            ...{
              text: "UPDATE \"openmeld\".\"routine_runs\" SET status = 'failed', failure_code = 'remote_agent.test_failure', failure_detail = 'Healthy Space', finished_at_ms = $1 WHERE id = $2",
              values: [],
            },
            values: [healthy.nowMs + 1, healthy.runId],
          },
        ]) {
          results.push(await client.query(query));
        }
        return results;
      })()
    );
    const workerSubmit = vi.fn();
    const testEnv = buildEnv({
      additionalSpaceIds: [healthy.spaceId],
      fixture: poison,
      workerSubmit,
    });
    testEnv.__spaceStub.rpcPostSignalOnceByClientMessageId.mockImplementation(
      (input: { clientMessageId: string }) => {
        if (input.clientMessageId === poison.runId) {
          throw new Error("Poison Space is unavailable");
        }
        return createSignal(healthy.publishedSignalId, healthy);
      }
    );
    testEnv.__spaceStubs
      .get(healthy.spaceId)
      ?.rpcPostSignalOnceByClientMessageId.mockResolvedValue(
        createSignal(healthy.publishedSignalId, healthy)
      );
    const retryAtMs = poison.nowMs + 60_000;
    await expect(
      retryRemoteAgentRoutineFailurePublications({
        db: getPostgresDatabase(env),
        env: testEnv,
        limit: 1,
        nowMs: retryAtMs,
      })
    ).resolves.toEqual({ errors: 1, published: 0, scanned: 1 });
    await expect(
      getPostgresDatabase(env)
        .query({
          ...{
            text: 'SELECT failure_publication_attempt_count, next_failure_publication_attempt_at_ms FROM "openmeld"."routine_runs" WHERE id = $1',
            values: [],
          },
          values: [poison.runId],
        })
        .then((result) => result.rows[0] ?? null)
    ).resolves.toMatchObject({
      failure_publication_attempt_count: 1,
      next_failure_publication_attempt_at_ms: retryAtMs + 60_000,
    });
    await expect(
      retryRemoteAgentRoutineFailurePublications({
        db: getPostgresDatabase(env),
        env: testEnv,
        limit: 1,
        nowMs: retryAtMs,
      })
    ).resolves.toEqual({ errors: 0, published: 1, scanned: 1 });
    await expect(
      readRoutineRunRecord({
        db: getPostgresDatabase(env),
        runId: healthy.runId,
      })
    ).resolves.toMatchObject({
      publishedSignalId: healthy.publishedSignalId,
      status: "failed",
    });
  });
  it.each([
    "before_ack",
    "after_ack",
  ] as const)("recovers a Routine submission interrupted %s without a second model turn", async (interruption) => {
    const fixture = await seedRoutineDeliveryFixture();
    const workerSubmitRequest = await buildRoutineWorkerSubmitRequest(fixture);
    await claimRemoteAgentRoutineNativeDelivery({
      bindingId: fixture.bindingId,
      db: getPostgresDatabase(env),
      nowMs: fixture.nowMs,
      organizationId: fixture.organizationId,
      profileId: fixture.profileId,
      routineId: fixture.routineId,
      routineName: fixture.routine.name,
      runId: fixture.runId,
      spaceId: fixture.spaceId,
      workerSubmitRequest,
    });
    if (interruption === "after_ack") {
      await markRemoteAgentNativeDeliveryAck({
        accepted: true,
        db: getPostgresDatabase(env),
        idempotencyKey: fixture.runId,
        nowMs: fixture.nowMs,
        submissionId: fixture.submissionId,
      });
    }
    const workerSubmit = vi.fn(async () => ({
      accepted: false,
      createdAt: fixture.nowMs,
      idempotencyKey: fixture.runId,
      status: "running" as const,
      submissionId: fixture.submissionId,
    }));
    const testEnv = buildEnv({ fixture, workerSubmit });
    await expect(
      retryRemoteAgentRoutineSubmissions({
        db: getPostgresDatabase(env),
        env: testEnv,
        limit: 1,
        nowMs: fixture.nowMs + 60_000,
      })
    ).resolves.toEqual(
      interruption === "before_ack"
        ? { errors: 0, recovered: 1, scanned: 1 }
        : { errors: 0, recovered: 0, scanned: 0 }
    );
    expect(workerSubmit).toHaveBeenCalledTimes(
      interruption === "before_ack" ? 1 : 0
    );
    if (interruption === "before_ack") {
      expect(testEnv.__queueSend).toHaveBeenCalledWith(
        expect.objectContaining({
          deadlineAtMs:
            fixture.nowMs +
            60_000 +
            REMOTE_AGENT_ACCEPTED_DELIVERY_PROBE_DELAY_SECONDS * 1000,
          dispatchId: fixture.runId,
          enqueuedAtMs: fixture.nowMs + 60_000,
          idempotencyKey: fixture.runId,
          kind: "remote_agent_native_delivery_deadline_probe",
          submissionId: fixture.submissionId,
        }),
        {
          delaySeconds: REMOTE_AGENT_ACCEPTED_DELIVERY_PROBE_DELAY_SECONDS,
        }
      );
    } else {
      expect(testEnv.__queueSend).not.toHaveBeenCalled();
    }
    await expect(
      readRemoteAgentNativeDeliveryByIdempotencyKey({
        db: getPostgresDatabase(env),
        idempotencyKey: fixture.runId,
      })
    ).resolves.toMatchObject(
      interruption === "before_ack"
        ? {
            acceptedProbeNextDueAtMs:
              fixture.nowMs +
              60_000 +
              REMOTE_AGENT_ACCEPTED_DELIVERY_PROBE_DELAY_SECONDS * 1000,
            deadlineProbeEnqueuedAtMs: fixture.nowMs + 60_000,
            routineRunId: fixture.runId,
            submissionId: fixture.submissionId,
          }
        : {
            acceptedProbeNextDueAtMs: null,
            deadlineProbeEnqueuedAtMs: null,
            routineRunId: fixture.runId,
            submissionId: fixture.submissionId,
          }
    );
    await expect(
      retryRemoteAgentRoutineSubmissions({
        db: getPostgresDatabase(env),
        env: testEnv,
        limit: 1,
        nowMs: fixture.nowMs + 120_000,
      })
    ).resolves.toEqual({ errors: 0, recovered: 0, scanned: 0 });
    expect(testEnv.__queueSend).toHaveBeenCalledTimes(
      interruption === "before_ack" ? 1 : 0
    );
  });
  it("terminalizes a deterministic admission rejection during submission recovery", async () => {
    const fixture = await seedRoutineDeliveryFixture();
    const workerSubmitRequest = await buildRoutineWorkerSubmitRequest(fixture);
    await claimRemoteAgentRoutineNativeDelivery({
      bindingId: fixture.bindingId,
      db: getPostgresDatabase(env),
      nowMs: fixture.nowMs,
      organizationId: fixture.organizationId,
      profileId: fixture.profileId,
      routineId: fixture.routineId,
      routineName: fixture.routine.name,
      runId: fixture.runId,
      spaceId: fixture.spaceId,
      workerSubmitRequest,
    });
    const workerSubmit = vi.fn(async () => ({
      idempotencyKey: fixture.runId,
      message:
        "Remote Agent Routine execution identity does not match its turn envelope.",
      outcome: "rejected" as const,
      reasonCode: "remote_agent.routine_identity_mismatch" as const,
      v: 1 as const,
    }));
    const testEnv = buildEnv({ fixture, workerSubmit });
    await expect(
      retryRemoteAgentRoutineSubmissions({
        db: getPostgresDatabase(env),
        env: testEnv,
        limit: 1,
        nowMs: fixture.nowMs + 60_000,
      })
    ).resolves.toEqual({ errors: 0, recovered: 1, scanned: 1 });
    expect(workerSubmit).toHaveBeenCalledTimes(1);
    expect(testEnv.__queueSend).not.toHaveBeenCalled();
    expect(
      testEnv.__spaceStub.rpcPostSignalOnceByClientMessageId
    ).toHaveBeenCalledTimes(1);
    await expect(
      readRoutineRunRecord({
        db: getPostgresDatabase(env),
        runId: fixture.runId,
      })
    ).resolves.toMatchObject({
      failureCode: "remote_agent.routine_identity_mismatch",
      status: "failed",
    });
    await expect(
      readRemoteAgentNativeDeliveryByIdempotencyKey({
        db: getPostgresDatabase(env),
        idempotencyKey: fixture.runId,
      })
    ).resolves.toMatchObject({
      failureCode: "remote_agent.routine_identity_mismatch",
      status: "failed",
      submissionId: null,
      workerSubmitRequest: null,
    });
  });
  it.each([
    "en",
    "zh-Hans",
  ])("fails an unconfirmed Routine submission in %s after recovery expires without claiming no execution or reopening it", async (languageTag) => {
    const fixture = await seedRoutineDeliveryFixture();
    await setOrganizationWorkingLanguagePreference({
      db: getPostgresDatabase(env),
      organizationId: fixture.organizationId,
      mode: "selected",
      languageTag,
      nowMs: fixture.nowMs,
      updatedByUserId: fixture.routine.createdByUserId,
    });
    const workerSubmitRequest = await buildRoutineWorkerSubmitRequest(fixture);
    await claimRemoteAgentRoutineNativeDelivery({
      bindingId: fixture.bindingId,
      db: getPostgresDatabase(env),
      nowMs: fixture.nowMs,
      organizationId: fixture.organizationId,
      profileId: fixture.profileId,
      routineId: fixture.routineId,
      routineName: fixture.routine.name,
      runId: fixture.runId,
      spaceId: fixture.spaceId,
      workerSubmitRequest,
    });
    const workerSubmit = vi.fn(() =>
      Promise.reject(new Error("Remote Agent worker remains unavailable"))
    );
    const testEnv = buildEnv({ fixture, workerSubmit });
    await expect(
      retryRemoteAgentRoutineSubmissions({
        db: getPostgresDatabase(env),
        env: testEnv,
        limit: 1,
        nowMs: fixture.nowMs + 4 * 60_000,
      })
    ).resolves.toEqual({ errors: 1, recovered: 0, scanned: 1 });
    expect(workerSubmit).toHaveBeenCalledTimes(1);
    expect(
      testEnv.__spaceStub.rpcPostSignalOnceByClientMessageId
    ).not.toHaveBeenCalled();
    await expect(
      retryRemoteAgentRoutineSubmissions({
        db: getPostgresDatabase(env),
        env: testEnv,
        limit: 1,
        nowMs: fixture.nowMs + 5 * 60_000,
      })
    ).resolves.toEqual({ errors: 0, recovered: 0, scanned: 0 });
    expect(workerSubmit).toHaveBeenCalledTimes(1);
    await expect(
      retryRemoteAgentRoutineSubmissions({
        db: getPostgresDatabase(env),
        env: testEnv,
        limit: 1,
        nowMs: fixture.nowMs + 8 * 60_000,
      })
    ).resolves.toEqual({ errors: 0, recovered: 1, scanned: 1 });
    expect(workerSubmit).toHaveBeenCalledTimes(1);
    expect(
      testEnv.__spaceStub.rpcPostSignalOnceByClientMessageId
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        clientMessageId: fixture.runId,
        text: expect.stringContaining(`Routine “${fixture.routine.name}”`),
      })
    );
    await expect(
      readRoutineRunRecord({
        db: getPostgresDatabase(env),
        runId: fixture.runId,
      })
    ).resolves.toMatchObject({
      failureCode: "remote_agent.worker_ack_recovery_expired",
      publishedSignalId: fixture.publishedSignalId,
      status: "failed",
    });
    const failedText =
      testEnv.__spaceStub.rpcPostSignalOnceByClientMessageId.mock.calls[0]?.[0]
        ?.text;
    expect(failedText).toContain(
      languageTag === "en"
        ? "Automatic startup recovery has stopped"
        : "自动启动恢复已停止"
    );
    expect(failedText).toContain(
      languageTag === "en"
        ? "Earlier actions may have taken effect"
        : "之前的操作可能已经生效"
    );
    expect(failedText).not.toContain("could not run");
    expect(failedText).not.toContain("did not start");
    expect(failedText).not.toContain("没有开始");
    await expect(
      retryRemoteAgentRoutineSubmissions({
        db: getPostgresDatabase(env),
        env: testEnv,
        limit: 1,
        nowMs: fixture.nowMs + 9 * 60_000,
      })
    ).resolves.toEqual({ errors: 0, recovered: 0, scanned: 0 });
    await expect(
      retryRemoteAgentRoutineFailurePublications({
        db: getPostgresDatabase(env),
        env: testEnv,
        nowMs: fixture.nowMs + 9 * 60_000,
      })
    ).resolves.toEqual({ errors: 0, published: 0, scanned: 0 });
    expect(
      testEnv.__spaceStub.rpcPostSignalOnceByClientMessageId
    ).toHaveBeenCalledTimes(1);
    vi.spyOn(Date, "now").mockReturnValue(fixture.nowMs + 8 * 60_000 + 1);
    await expect(
      completeRemoteAgentNativeDelivery(
        testEnv,
        buildCompletedCallback(fixture)
      )
    ).resolves.toMatchObject({ status: "rejected" });
    expect(
      testEnv.__spaceStub.rpcPostSignalOnceByClientMessageId
    ).toHaveBeenCalledTimes(1);
    await expect(
      readRoutineRunRecord({
        db: getPostgresDatabase(env),
        runId: fixture.runId,
      })
    ).resolves.toMatchObject({
      failureCode: "remote_agent.worker_ack_recovery_expired",
      publishedSignalId: fixture.publishedSignalId,
      status: "failed",
    });
  });
  it.each([
    "en",
    "zh-Hans",
  ])("keeps an unconfirmed Routine in %s uncertain after its admission record is unavailable", async (languageTag) => {
    const fixture = await seedRoutineDeliveryFixture();
    await setOrganizationWorkingLanguagePreference({
      db: getPostgresDatabase(env),
      organizationId: fixture.organizationId,
      mode: "selected",
      languageTag,
      nowMs: fixture.nowMs,
      updatedByUserId: fixture.routine.createdByUserId,
    });
    await getPostgresDatabase(env).query({
      ...{
        text: "UPDATE \"openmeld\".\"routine_runs\" SET status = 'failed', failure_code = 'remote_agent.worker_ack_recovery_expired', failure_detail = 'The startup acknowledgement was not recovered.', finished_at_ms = $1 WHERE id = $2",
        values: [],
      },
      values: [fixture.nowMs + 8 * 60_000, fixture.runId],
    });
    await expect(
      readRemoteAgentNativeDeliveryByIdempotencyKey({
        db: getPostgresDatabase(env),
        idempotencyKey: fixture.runId,
      })
    ).resolves.toBeNull();
    const workerSubmit = vi.fn();
    const testEnv = buildEnv({ fixture, workerSubmit });
    await expect(
      retryRemoteAgentRoutineFailurePublications({
        db: getPostgresDatabase(env),
        env: testEnv,
        nowMs: fixture.nowMs + 9 * 60_000,
      })
    ).resolves.toEqual({ errors: 0, published: 1, scanned: 1 });
    const text =
      testEnv.__spaceStub.rpcPostSignalOnceByClientMessageId.mock.calls[0]?.[0]
        ?.text;
    expect(text).toContain(
      languageTag === "en"
        ? "Automatic startup recovery has stopped"
        : "自动启动恢复已停止"
    );
    expect(text).toContain(
      languageTag === "en"
        ? "Earlier actions may have taken effect"
        : "之前的操作可能已经生效"
    );
    expect(text).toContain(`Run ID: ${fixture.runId}`);
    expect(text).not.toContain("could not run");
    expect(text).not.toContain("Run the Routine again");
    expect(workerSubmit).not.toHaveBeenCalled();
    await expect(
      retryRemoteAgentRoutineFailurePublications({
        db: getPostgresDatabase(env),
        env: testEnv,
        nowMs: fixture.nowMs + 10 * 60_000,
      })
    ).resolves.toEqual({ errors: 0, published: 0, scanned: 0 });
    expect(
      testEnv.__spaceStub.rpcPostSignalOnceByClientMessageId
    ).toHaveBeenCalledTimes(1);
  });
  it("repairs a failed Run with a submitted ledger without replaying the worker", async () => {
    const fixture = await seedRoutineDeliveryFixture();
    const workerSubmitRequest = await buildRoutineWorkerSubmitRequest(fixture);
    await claimRemoteAgentRoutineNativeDelivery({
      bindingId: fixture.bindingId,
      db: getPostgresDatabase(env),
      nowMs: fixture.nowMs,
      organizationId: fixture.organizationId,
      profileId: fixture.profileId,
      routineId: fixture.routineId,
      routineName: fixture.routine.name,
      runId: fixture.runId,
      spaceId: fixture.spaceId,
      workerSubmitRequest,
    });
    await getPostgresDatabase(env).query({
      ...{
        text: "UPDATE \"openmeld\".\"routine_runs\" SET status = 'failed', failure_code = 'remote_agent.runtime_disabled', failure_detail = 'Remote Agent is disabled for this Organization.', finished_at_ms = $1 WHERE id = $2",
        values: [],
      },
      values: [fixture.nowMs + 1000, fixture.runId],
    });
    const workerSubmit = vi.fn();
    const testEnv = buildEnv({
      fixture,
      runtimeEnabled: "true",
      workerSubmit,
    });
    testEnv.__spaceStub.rpcPostSignalOnceByClientMessageId.mockRejectedValue(
      new Error("Space is unavailable during recovery")
    );
    await expect(
      retryRemoteAgentRoutineSubmissions({
        db: getPostgresDatabase(env),
        env: testEnv,
        limit: 1,
        nowMs: fixture.nowMs + 60_000,
      })
    ).resolves.toEqual({ errors: 0, recovered: 1, scanned: 1 });
    expect(workerSubmit).not.toHaveBeenCalled();
    await expect(
      readRemoteAgentNativeDeliveryByIdempotencyKey({
        db: getPostgresDatabase(env),
        idempotencyKey: fixture.runId,
      })
    ).resolves.toMatchObject({
      failureCode: "remote_agent.runtime_disabled",
      status: "flag_rejected",
      workerSubmitRequest: null,
    });
    await expect(
      readRoutineRunRecord({
        db: getPostgresDatabase(env),
        runId: fixture.runId,
      })
    ).resolves.toMatchObject({
      publishedSignalId: null,
      status: "failed",
    });
    await expect(
      retryRemoteAgentRoutineSubmissions({
        db: getPostgresDatabase(env),
        env: testEnv,
        limit: 1,
        nowMs: fixture.nowMs + 120_000,
      })
    ).resolves.toEqual({ errors: 0, recovered: 0, scanned: 0 });
    expect(workerSubmit).not.toHaveBeenCalled();
  });
  it("rechecks runtime policy before recovering an unacknowledged submission", async () => {
    const fixture = await seedRoutineDeliveryFixture();
    const workerSubmitRequest = await buildRoutineWorkerSubmitRequest(fixture);
    await claimRemoteAgentRoutineNativeDelivery({
      bindingId: fixture.bindingId,
      db: getPostgresDatabase(env),
      nowMs: fixture.nowMs,
      organizationId: fixture.organizationId,
      profileId: fixture.profileId,
      routineId: fixture.routineId,
      routineName: fixture.routine.name,
      runId: fixture.runId,
      spaceId: fixture.spaceId,
      workerSubmitRequest,
    });
    const workerSubmit = vi.fn();
    const testEnv = buildEnv({
      fixture,
      runtimeEnabled: "false",
      workerSubmit,
    });
    await expect(
      retryRemoteAgentRoutineSubmissions({
        db: getPostgresDatabase(env),
        env: testEnv,
        limit: 1,
        nowMs: fixture.nowMs + 60_000,
      })
    ).resolves.toEqual({ errors: 0, recovered: 1, scanned: 1 });
    expect(workerSubmit).not.toHaveBeenCalled();
    await expect(
      readRoutineRunRecord({
        db: getPostgresDatabase(env),
        runId: fixture.runId,
      })
    ).resolves.toMatchObject({
      failureCode: "remote_agent.runtime_disabled",
      publishedSignalId: fixture.publishedSignalId,
      status: "failed",
    });
  });
  it("keeps a non-terminal recovery RPC error pending until the explicit timeout", async () => {
    const fixture = await seedRoutineDeliveryFixture();
    const workerSubmitRequest = await buildRoutineWorkerSubmitRequest(fixture);
    await claimRemoteAgentRoutineNativeDelivery({
      bindingId: fixture.bindingId,
      db: getPostgresDatabase(env),
      nowMs: fixture.nowMs,
      organizationId: fixture.organizationId,
      profileId: fixture.profileId,
      routineId: fixture.routineId,
      routineName: fixture.routine.name,
      runId: fixture.runId,
      spaceId: fixture.spaceId,
      workerSubmitRequest,
    });
    const workerSubmit = vi.fn(() =>
      Promise.reject(new Error("transport reset after an unknown outcome"))
    );
    const testEnv = buildEnv({ fixture, workerSubmit });
    await expect(
      retryRemoteAgentRoutineSubmissions({
        db: getPostgresDatabase(env),
        env: testEnv,
        limit: 1,
        nowMs: fixture.nowMs + 60_000,
      })
    ).resolves.toEqual({ errors: 1, recovered: 0, scanned: 1 });
    expect(workerSubmit).toHaveBeenCalledTimes(1);
    expect(
      testEnv.__spaceStub.rpcPostSignalOnceByClientMessageId
    ).not.toHaveBeenCalled();
    await expect(
      readRoutineRunRecord({
        db: getPostgresDatabase(env),
        runId: fixture.runId,
      })
    ).resolves.toMatchObject({ status: "submitted" });
    await expect(
      readRemoteAgentNativeDeliveryByIdempotencyKey({
        db: getPostgresDatabase(env),
        idempotencyKey: fixture.runId,
      })
    ).resolves.toMatchObject({
      status: "submitted",
      submissionId: null,
      workerSubmitRequest: expect.objectContaining({
        idempotencyKey: fixture.runId,
      }),
    });
    await expect(
      retryRemoteAgentRoutineSubmissions({
        db: getPostgresDatabase(env),
        env: testEnv,
        limit: 1,
        nowMs: fixture.nowMs + 4 * 60_000,
      })
    ).resolves.toEqual({ errors: 1, recovered: 0, scanned: 1 });
    expect(workerSubmit).toHaveBeenCalledTimes(2);
    expect(
      testEnv.__spaceStub.rpcPostSignalOnceByClientMessageId
    ).not.toHaveBeenCalled();
    await expect(
      retryRemoteAgentRoutineSubmissions({
        db: getPostgresDatabase(env),
        env: testEnv,
        limit: 1,
        nowMs: fixture.nowMs + 8 * 60_000,
      })
    ).resolves.toEqual({ errors: 0, recovered: 1, scanned: 1 });
    expect(workerSubmit).toHaveBeenCalledTimes(2);
    expect(
      testEnv.__spaceStub.rpcPostSignalOnceByClientMessageId
    ).toHaveBeenCalledTimes(1);
    await expect(
      readRoutineRunRecord({
        db: getPostgresDatabase(env),
        runId: fixture.runId,
      })
    ).resolves.toMatchObject({
      failureCode: "remote_agent.worker_ack_recovery_expired",
      status: "failed",
    });
  });
  it("maps a missing worker RPC receiver method during recovery to a stable visible failure", async () => {
    const fixture = await seedRoutineDeliveryFixture();
    const workerSubmitRequest = await buildRoutineWorkerSubmitRequest(fixture);
    await claimRemoteAgentRoutineNativeDelivery({
      bindingId: fixture.bindingId,
      db: getPostgresDatabase(env),
      nowMs: fixture.nowMs,
      organizationId: fixture.organizationId,
      profileId: fixture.profileId,
      routineId: fixture.routineId,
      routineName: fixture.routine.name,
      runId: fixture.runId,
      spaceId: fixture.spaceId,
      workerSubmitRequest,
    });
    const workerSubmit = vi.fn(() =>
      Promise.reject(
        new Error(
          'The RPC receiver does not implement the method "submitConversationTurn".'
        )
      )
    );
    const testEnv = buildEnv({ fixture, workerSubmit });
    testEnv.OPENMELD_REMOTE_AGENT_WORKER = new Proxy(
      {},
      { get: () => workerSubmit }
    );
    await expect(
      retryRemoteAgentRoutineSubmissions({
        db: getPostgresDatabase(env),
        env: testEnv,
        limit: 1,
        nowMs: fixture.nowMs + 60_000,
      })
    ).resolves.toEqual({ errors: 0, recovered: 1, scanned: 1 });
    expect(workerSubmit).toHaveBeenCalledTimes(1);
    expect(
      testEnv.__spaceStub.rpcPostSignalOnceByClientMessageId
    ).toHaveBeenCalledTimes(1);
    await expect(
      readRoutineRunRecord({
        db: getPostgresDatabase(env),
        runId: fixture.runId,
      })
    ).resolves.toMatchObject({
      failureCode: "remote_agent.worker_unavailable",
      publishedSignalId: fixture.publishedSignalId,
      status: "failed",
    });
  });
  it.each([
    "paused",
    "deleted",
    "center_agent_paused",
    "target_membership_revoked",
  ] as const)("revalidates full Routine admission before recovery when %s", async (change) => {
    const fixture = await seedRoutineDeliveryFixture();
    const workerSubmitRequest = await buildRoutineWorkerSubmitRequest(fixture);
    await claimRemoteAgentRoutineNativeDelivery({
      bindingId: fixture.bindingId,
      db: getPostgresDatabase(env),
      nowMs: fixture.nowMs,
      organizationId: fixture.organizationId,
      profileId: fixture.profileId,
      routineId: fixture.routineId,
      routineName: fixture.routine.name,
      runId: fixture.runId,
      spaceId: fixture.spaceId,
      workerSubmitRequest,
    });
    if (change === "paused") {
      await getPostgresDatabase(env).query({
        ...{
          text: 'UPDATE "openmeld"."routines" SET status = \'paused\', next_due_at = NULL WHERE id = $1',
          values: [],
        },
        values: [fixture.routineId],
      });
    } else if (change === "deleted") {
      await getPostgresDatabase(env).query({
        ...{
          text: 'DELETE FROM "openmeld"."routines" WHERE id = $1',
          values: [],
        },
        values: [fixture.routineId],
      });
    } else if (change === "center_agent_paused") {
      await getPostgresDatabase(env).query({
        ...{
          text: 'UPDATE "openmeld"."center_agent_designations" SET operating_state = \'paused\', paused_at = $1, paused_by_user_id = $2 WHERE organization_id = $3',
          values: [],
        },
        values: [fixture.nowMs, fixture.userId, fixture.organizationId],
      });
    } else {
      await getPostgresDatabase(env).query({
        ...{
          text: 'DELETE FROM "openmeld"."space_index_memberships" WHERE space_id = $1 AND profile_id = $2',
          values: [],
        },
        values: [fixture.spaceId, fixture.profileId],
      });
    }
    const workerSubmit = vi.fn();
    const testEnv = buildEnv({ fixture, workerSubmit });
    await expect(
      retryRemoteAgentRoutineSubmissions({
        db: getPostgresDatabase(env),
        env: testEnv,
        limit: 1,
        nowMs: fixture.nowMs + 8 * 60_000,
      })
    ).resolves.toEqual({ errors: 0, recovered: 1, scanned: 1 });
    expect(workerSubmit).not.toHaveBeenCalled();
    const shouldSkip = change === "paused" || change === "deleted";
    expect(
      testEnv.__spaceStub.rpcPostSignalOnceByClientMessageId
    ).toHaveBeenCalledTimes(shouldSkip ? 0 : 1);
    const failureCode = shouldSkip
      ? "routine.not_enabled_at_recovery"
      : {
          center_agent_paused: "remote_agent.center_agent_paused",
          target_membership_revoked:
            "remote_agent.routine_target_space_unavailable",
        }[change];
    await expect(
      readRoutineRunRecord({
        db: getPostgresDatabase(env),
        runId: fixture.runId,
      })
    ).resolves.toMatchObject({
      failureCode,
      publishedSignalId: shouldSkip ? null : fixture.publishedSignalId,
      status: shouldSkip ? "skipped" : "failed",
    });
    await expect(
      readRemoteAgentNativeDeliveryByIdempotencyKey({
        db: getPostgresDatabase(env),
        idempotencyKey: fixture.runId,
      })
    ).resolves.toMatchObject({
      failureCode,
      publishedSignalId: shouldSkip ? null : fixture.publishedSignalId,
      routineRunId: fixture.runId,
      status: "failed",
      workerSubmitRequest: null,
    });
  });
  it.each([
    "designation",
    "binding",
    "policy",
    "worker",
  ] as const)("fails closed with a named Space result when %s admission is unavailable", async (failure) => {
    const fixture = await seedRoutineDeliveryFixture();
    if (failure === "designation") {
      await getPostgresDatabase(env).query({
        ...{
          text: 'DELETE FROM "openmeld"."center_agent_designations" WHERE organization_id = $1',
          values: [],
        },
        values: [fixture.organizationId],
      });
    }
    if (failure === "binding") {
      await getPostgresDatabase(env).query({
        ...{
          text: 'UPDATE "openmeld"."openMeldDaemon_agent_profile_bindings" SET hosted_runtime_identity_json = \'{}\' WHERE binding_id = $1',
          values: [],
        },
        values: [fixture.bindingId],
      });
    }
    const workerSubmit =
      failure === "worker"
        ? vi.fn(() =>
            Promise.reject(
              new Error(
                'The RPC receiver does not implement the method "submitConversationTurn".'
              )
            )
          )
        : vi.fn();
    const testEnv = buildEnv({
      fixture,
      workerSubmit,
      runtimeEnabled: failure === "policy" ? "false" : "true",
    });
    if (failure === "worker") {
      testEnv.OPENMELD_REMOTE_AGENT_WORKER = new Proxy(
        {},
        {
          get: () => workerSubmit,
        }
      );
    }
    await expect(
      submitRemoteAgentRoutineDelivery({
        db: getPostgresDatabase(env),
        env: testEnv,
        nowMs: fixture.nowMs,
        routine: fixture.routine,
        run: fixture.run,
      })
    ).resolves.toEqual({ status: "failed" });
    if (failure === "worker") {
      expect(workerSubmit).toHaveBeenCalledTimes(1);
    } else {
      expect(workerSubmit).not.toHaveBeenCalled();
    }
    expect(
      testEnv.__spaceStub.rpcPostSignalOnceByClientMessageId
    ).toHaveBeenCalledTimes(1);
    expect(
      testEnv.__spaceStub.rpcPostSignalOnceByClientMessageId.mock.calls[0]?.[0]
        ?.text
    ).toContain(`Routine “${fixture.routine.name}”`);
    await expect(
      readRoutineRunRecord({
        db: getPostgresDatabase(env),
        runId: fixture.runId,
      })
    ).resolves.toMatchObject({ status: "failed" });
    if (failure === "binding" || failure === "policy" || failure === "worker") {
      const expectedFailure = {
        binding: {
          failureCode: "remote_agent.hosted_binding_invalid",
          status: "failed",
          submittedAtMs: null,
        },
        policy: {
          failureCode: "remote_agent.runtime_disabled",
          status: "flag_rejected",
          submittedAtMs: null,
        },
        worker: {
          failureCode: "remote_agent.worker_unavailable",
          status: "worker_unavailable",
          submittedAtMs: fixture.nowMs,
        },
      }[failure];
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: getPostgresDatabase(env),
          idempotencyKey: fixture.runId,
        })
      ).resolves.toMatchObject({
        ...expectedFailure,
        publishedSignalId: fixture.publishedSignalId,
        routineRunId: fixture.runId,
        workerSubmitRequest: null,
      });
    }
  });
  it("reports a selected-model failure without disguising it as temporary admission trouble", async () => {
    const fixture = await seedRoutineDeliveryFixture();
    await getPostgresDatabase(env).query({
      ...{
        text: 'UPDATE "openmeld"."openMeldDaemon_agent_profile_bindings" SET model_id = $1 WHERE binding_id = $2',
        values: [],
      },
      values: ["openrouter/not-in-the-catalog", fixture.bindingId],
    });
    const workerSubmit = vi.fn();
    const testEnv = buildEnv({ fixture, workerSubmit });
    await expect(
      submitRemoteAgentRoutineDelivery({
        db: getPostgresDatabase(env),
        env: testEnv,
        nowMs: fixture.nowMs,
        routine: fixture.routine,
        run: fixture.run,
      })
    ).resolves.toEqual({ status: "failed" });
    expect(workerSubmit).not.toHaveBeenCalled();
    await expect(
      readRoutineRunRecord({
        db: getPostgresDatabase(env),
        runId: fixture.runId,
      })
    ).resolves.toMatchObject({
      failureCode: "center_agent_model_unknown",
      failureDetail:
        "The selected Center Agent model is not in the model catalog.",
      status: "failed",
    });
    await expect(
      readRemoteAgentNativeDeliveryByIdempotencyKey({
        db: getPostgresDatabase(env),
        idempotencyKey: fixture.runId,
      })
    ).resolves.toMatchObject({
      failureCode: "center_agent_model_unknown",
      status: "failed",
    });
    expect(
      testEnv.__spaceStub.rpcPostSignalOnceByClientMessageId
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: expect.objectContaining({
          errorCode: "center_agent_model_unknown",
        }),
        text: expect.stringContaining(
          "Routine “Daily feedback review” could not run because the selected Center Agent model is unavailable. Ask an organization owner or admin to choose an available model in OpenMeld."
        ),
      })
    );
  });
});
async function seedRoutineDeliveryFixture() {
  const suffix = crypto.randomUUID();
  const nowMs = Date.parse("2026-07-12T12:00:00.000Z");
  const organizationId = `org_routine_delivery_${suffix}`;
  const userId = `user_routine_delivery_${suffix}`;
  const creatorUserId = `creator_routine_delivery_${suffix}`;
  const creatorProfileId = crypto.randomUUID();
  const creatorMemberId = `creator_member_${suffix}`;
  const profileId = `agt_${crypto.randomUUID()}`;
  const routineId = `routine_delivery_${suffix}`;
  const runId = `routine_run_${suffix}`;
  const spaceId = crypto.randomUUID().replaceAll("-", "").repeat(2);
  const bindingId = `binding_routine_delivery_${suffix}`;
  const submissionId = `submission_routine_delivery_${suffix}`;
  const publishedSignalId = `signal_routine_delivery_${suffix}`;
  ownedRoutineOrganizationIds.add(organizationId);
  await getPostgresDatabase(env).transaction(async (client) =>
    (async () => {
      const results: QueryResult[] = [];
      for (const query of [
        {
          ...{
            text: 'INSERT INTO "openmeld"."users" (id, name, email, email_verified, created_at, updated_at) VALUES ($1, \'Routine Owner\', $2, 1, $3, $4)',
            values: [],
          },
          values: [userId, `${userId}@example.com`, nowMs, nowMs],
        },
        {
          ...{
            text: 'INSERT INTO "openmeld"."users" (id, name, email, email_verified, created_at, updated_at) VALUES ($1, \'Routine Creator\', $2, 1, $3, $4)',
            values: [],
          },
          values: [creatorUserId, `${creatorUserId}@example.com`, nowMs, nowMs],
        },
        {
          ...{
            text: 'INSERT INTO "openmeld"."organizations" (id, name, slug, created_at) VALUES ($1, \'Routine Delivery Org\', $2, $3)',
            values: [],
          },
          values: [organizationId, `routine-delivery-${suffix}`, nowMs],
        },
      ]) {
        results.push(await client.query(query));
      }
      return results;
    })()
  );
  await getPostgresDatabase(env).transaction(async (client) =>
    (async () => {
      const results: QueryResult[] = [];
      for (const query of [
        {
          ...{
            text: 'INSERT INTO "openmeld"."members" (id, organization_id, user_id, role, created_at) VALUES ($1, $2, $3, \'owner\', $4)',
            values: [],
          },
          values: [`member_${suffix}`, organizationId, userId, nowMs],
        },
        {
          ...{
            text: 'INSERT INTO "openmeld"."members" (id, organization_id, user_id, role, created_at) VALUES ($1, $2, $3, \'member\', $4)',
            values: [],
          },
          values: [creatorMemberId, organizationId, creatorUserId, nowMs],
        },
        {
          ...{
            text: `
        INSERT INTO "openmeld"."openmeld_profiles" (
          profile_id, profile_name, profile_handle, profile_kind, is_default,
          status, organization_id, owner_user_id, created_by_user_id, source,
          managed_role, created_at, updated_at
        ) VALUES ($1, 'Routine Creator', $2, 'human', 1, 'active', NULL, $3, $4,
          'auth_bootstrap', NULL, $5, $6)
      `,
            values: [],
          },
          values: [
            creatorProfileId,
            `routine-creator-${suffix}`,
            creatorUserId,
            creatorUserId,
            nowMs,
            nowMs,
          ],
        },
        {
          ...{
            text: `
        INSERT INTO "openmeld"."openmeld_profiles" (
          profile_id, profile_name, profile_handle, profile_kind, is_default,
          status, organization_id, owner_user_id, created_by_user_id, source,
          managed_role, created_at, updated_at
        ) VALUES ($1, 'Routine Center Agent', $2, 'agent', 0, 'active', $3, NULL, $4,
          'auth_bootstrap', 'center_agent', $5, $6)
      `,
            values: [],
          },
          values: [
            profileId,
            `routine-center-agent-${suffix}`,
            organizationId,
            userId,
            nowMs,
            nowMs,
          ],
        },
        {
          ...{
            text: 'INSERT INTO "openmeld"."center_agent_designations" (organization_id, agent_profile_id, duty, designated_by, created_at) VALUES ($1, $2, NULL, $3, $4)',
            values: [],
          },
          values: [organizationId, profileId, userId, nowMs],
        },
        {
          ...{
            text: `
        INSERT INTO "openmeld"."space_index_spaces" (
          space_id, organization_id, organization_visibility, status, space_name,
          source_updated_at_ms, projected_at_ms, projection_event_id
        ) VALUES ($1, $2, 'private', 'active', 'Feedback Triage', $3, $4, $5)
      `,
            values: [],
          },
          values: [
            spaceId,
            organizationId,
            nowMs,
            nowMs,
            `projection_${suffix}`,
          ],
        },
        {
          ...{
            text: `
        INSERT INTO "openmeld"."space_index_memberships" (
          space_id, profile_id, profile_kind_snapshot, profile_name_snapshot,
          owner_user_id_snapshot, controller_ref_snapshot, status, member_source,
          added_at_ms, source_updated_at_ms, projected_at_ms, projection_event_id
        ) VALUES ($1, $2, 'agent', 'Routine Center Agent', NULL, $3, 'active',
          'member_add', $4, $5, $6, $7)
      `,
            values: [],
          },
          values: [
            spaceId,
            profileId,
            HOSTED_CENTER_AGENT_CONTROLLER_REF,
            nowMs,
            nowMs,
            nowMs,
            `membership_projection_${suffix}`,
          ],
        },
      ]) {
        results.push(await client.query(query));
      }
      return results;
    })()
  );
  await getPostgresDatabase(env).transaction(async (client) =>
    (async () => {
      const results: QueryResult[] = [];
      for (const query of [
        {
          ...{
            text: `
        INSERT INTO "openmeld"."openMeldDaemon_agent_profile_bindings" (
          binding_id, owner_kind, owner_id, agent_profile_id,
          openmeld_service_runtime_id, runtime_kind, hosted_runtime_identity_json,
          agent_controller_ref, agent_controller_conversation_id, binding_state,
          created_at_ms, updated_at_ms
        ) VALUES ($1, 'organization', $2, $3, $4, 'hosted_center_agent', $5, $6,
          NULL, 'enabled_primary', $7, $8)
      `,
            values: [],
          },
          values: [
            bindingId,
            organizationId,
            profileId,
            HOSTED_CENTER_AGENT_LOGICAL_RUNTIME_ID,
            JSON.stringify(HOSTED_CENTER_AGENT_RUNTIME_IDENTITY),
            HOSTED_CENTER_AGENT_CONTROLLER_REF,
            nowMs,
            nowMs,
          ],
        },
        {
          ...{
            text: "INSERT INTO \"openmeld\".\"routines\" (id, organization_id, name, instructions, external_action_policy, schedule_kind, cron_expression, timezone, target_space_id, status, next_due_at, created_by_user_id, updated_by_user_id, created_at_ms, updated_at_ms) VALUES ($1, $2, 'Daily feedback review', 'Review every open Feedback Issue.', 'read_only', 'cron', '0 12 * * *', 'UTC', $3, 'enabled', $4, $5, $6, $7, $8)",
            values: [],
          },
          values: [
            routineId,
            organizationId,
            spaceId,
            nowMs + 24 * 60 * 60 * 1000,
            creatorUserId,
            creatorUserId,
            nowMs - 1000,
            nowMs - 1000,
          ],
        },
        {
          ...{
            text: "INSERT INTO \"openmeld\".\"routine_runs\" (id, routine_id, organization_id, scheduled_for, status, routine_name_snapshot, target_space_id_snapshot, started_at_ms) VALUES ($1, $2, $3, $4, 'claimed', 'Daily feedback review', $5, $6)",
            values: [],
          },
          values: [runId, routineId, organizationId, nowMs, spaceId, nowMs],
        },
      ]) {
        results.push(await client.query(query));
      }
      return results;
    })()
  );
  const routine = {
    authorizedActions: [],
    createdAtMs: nowMs - 1000,
    createdByUserId: creatorUserId,
    creationAttribution: null,
    cronExpression: "0 12 * * *",
    destinationKind: "space" as const,
    externalActionPolicy: "read_only" as const,
    id: routineId,
    instructions: "Review every open Feedback Issue.",
    lastRun: null,
    name: "Daily feedback review",
    nextDueAt: nowMs + 24 * 60 * 60 * 1000,
    organizationId,
    runAtMs: null,
    scheduleKind: "cron" as const,
    slackChannelId: null,
    slackConversationId: null,
    slackTeamId: null,
    slackThreadLabel: null,
    slackThreadTs: null,
    status: "enabled" as const,
    targetSpaceId: spaceId,
    timezone: "UTC",
    updatedAtMs: nowMs - 1000,
    updatedByUserId: creatorUserId,
  };
  const run = await readRoutineRunRecord({
    db: getPostgresDatabase(env),
    runId,
  });
  if (!run) {
    throw new Error("Routine Run fixture was not created");
  }
  return {
    bindingId,
    creatorProfileId,
    creatorMemberId,
    creatorUserId,
    nowMs,
    organizationId,
    profileId,
    publishedSignalId,
    routine,
    routineId,
    run,
    runId,
    spaceId,
    submissionId,
    userId,
  };
}
function buildEnv(input: {
  additionalSpaceIds?: string[];
  continuitySignals?: SignalEnvelope[];
  fixture: Awaited<ReturnType<typeof seedRoutineDeliveryFixture>>;
  routineWorkflowSendEvent?: ReturnType<typeof vi.fn>;
  runtimeEnabled?: string;
  spaceGuide?: string;
  webAppUrl?: string;
  workerReconcile?: ReturnType<typeof vi.fn>;
  workerSubmit: ReturnType<typeof vi.fn>;
}): CoreBindings & {
  __queueSend: ReturnType<typeof vi.fn>;
  __spaceStub: TestSpaceStub;
  __spaceStubs: Map<string, TestSpaceStub>;
} {
  const queueSend = vi.fn(async () => undefined);
  const spaceStubs = new Map(
    [input.fixture.spaceId, ...(input.additionalSpaceIds ?? [])].map(
      (spaceId) =>
        [
          spaceId,
          {
            rpcCloseAgentStream: vi.fn(async () => null),
            rpcGetMeta: vi.fn(async () => ({
              guide: input.spaceGuide,
              organizationId: input.fixture.organizationId,
              spaceId,
              visibility: "private" as const,
            })),
            rpcListSignalsResult: vi.fn(async () => ({
              ok: true as const,
              value: { signals: input.continuitySignals ?? [] },
            })),
            rpcListDispatchConversationContinuitySignalsResult: vi.fn(
              async () => ({
                ok: true as const,
                value: { signals: input.continuitySignals ?? [] },
              })
            ),
            rpcPostSignalOnceByClientMessageId: vi.fn(async () =>
              createSignal(
                input.fixture.publishedSignalId,
                input.fixture,
                spaceId
              )
            ),
            rpcReadFinalReplyClaimSignalId: vi.fn(async () => ({
              signalId: null,
            })),
          } satisfies TestSpaceStub,
        ] as const
    )
  );
  const spaceStub = spaceStubs.get(input.fixture.spaceId);
  if (!spaceStub) {
    throw new Error("Primary Space stub was not created");
  }
  return {
    __spaceStub: spaceStub,
    __spaceStubs: spaceStubs,
    OPENMELD_AUTH_WORKER: {
      resolveOrganizationAccountIdentity: async (
        request: AuthRpcResolveOrganizationAccountIdentityInput
      ) =>
        await resolveRoutineFixtureOrganizationAccountIdentity(
          input.fixture,
          request
        ),
      resolveProfileById: async () => ({
        ok: true,
        profile: {
          ownerUserId: null,
          profileHandle: "routine-center-agent",
          profileId: input.fixture.profileId,
          profileKind: "agent",
          profileName: "Routine Center Agent",
          status: "active",
        },
      }),
    },
    __queueSend: queueSend,
    OPENMELD_DAEMON_DISPATCH_QUEUE: {
      send: queueSend,
    } as unknown as CoreBindings["OPENMELD_DAEMON_DISPATCH_QUEUE"],
    OPENMELD_POSTGRESQL: env.OPENMELD_POSTGRESQL,
    OPENMELD_REMOTE_AGENT_RUNTIME_ENABLED: input.runtimeEnabled ?? "true",
    WEB_APP_URL: input.webAppUrl,
    OPENMELD_REMOTE_AGENT_WORKER: {
      ...(input.workerReconcile
        ? { reconcileExecution: input.workerReconcile }
        : {}),
      submitConversationTurn: input.workerSubmit,
    },
    ...(input.routineWorkflowSendEvent
      ? {
          OPENMELD_ROUTINE_RUN_WORKFLOW: {
            get: vi.fn(async () => ({
              sendEvent: input.routineWorkflowSendEvent,
            })),
          },
        }
      : {}),
    OPENMELD_SPACES: {
      get: (id: { toString(): string }) => {
        const resolved = spaceStubs.get(id.toString());
        if (!resolved) {
          throw new Error(`Unexpected Space ${id.toString()}`);
        }
        return resolved;
      },
      idFromString: (spaceId: string) => ({ toString: () => spaceId }),
    } as unknown as CoreBindings["OPENMELD_SPACES"],
  } as unknown as CoreBindings & {
    __queueSend: ReturnType<typeof vi.fn>;
    __spaceStub: TestSpaceStub;
    __spaceStubs: Map<string, TestSpaceStub>;
  };
}
type TestSpaceStub = {
  rpcCloseAgentStream: ReturnType<typeof vi.fn>;
  rpcGetMeta: ReturnType<typeof vi.fn>;
  rpcListDispatchConversationContinuitySignalsResult: ReturnType<typeof vi.fn>;
  rpcListSignalsResult: ReturnType<typeof vi.fn>;
  rpcPostSignalOnceByClientMessageId: ReturnType<typeof vi.fn>;
  rpcReadFinalReplyClaimSignalId: ReturnType<typeof vi.fn>;
};
async function buildRoutineWorkerSubmitRequest(
  fixture: Awaited<ReturnType<typeof seedRoutineDeliveryFixture>>
): Promise<RemoteAgentWorkerSubmitTurnRequest> {
  const turnEnvelope = await resolveRemoteAgentRoutineTurnEnvelope({
    centerAgentProfileId: fixture.profileId,
    createdByUserId: fixture.creatorUserId,
    db: getPostgresDatabase(env),
    delegatedMember: {
      displayName: "Routine Creator",
      memberId: fixture.creatorMemberId,
      profileId: fixture.creatorProfileId,
      userId: fixture.creatorUserId,
    },
    destination: { kind: "space", spaceId: fixture.spaceId },
    externalActionPolicy: fixture.routine.externalActionPolicy,
    organizationId: fixture.organizationId,
    routineId: fixture.routineId,
    routineName: fixture.routine.name,
    runId: fixture.runId,
    scheduledFor: fixture.run.scheduledFor,
  });
  return {
    agentProfileId: fixture.profileId,
    agentProfileOwnerUserId: fixture.userId,
    author: {
      displayName: "Routine Center Agent",
      profileId: fixture.profileId,
      profileKind: "agent",
    },
    bindingId: fixture.bindingId,
    dispatchId: fixture.runId,
    idempotencyKey: fixture.runId,
    messages: [
      { content: fixture.routine.instructions, role: "user" as const },
    ],
    onBehalfOf: null,
    organizationId: fixture.organizationId,
    sourceClientMessageId: null,
    spaceId: fixture.spaceId,
    triggerMessageId: fixture.runId,
    turnEnvelope,
    v: 1,
  };
}
async function resolveRoutineFixtureOrganizationAccountIdentity(
  fixture: Awaited<ReturnType<typeof seedRoutineDeliveryFixture>>,
  request: AuthRpcResolveOrganizationAccountIdentityInput
): Promise<AuthRpcResolveOrganizationAccountIdentityResult> {
  if (
    request.organizationId !== fixture.organizationId ||
    request.account?.kind !== "user_id" ||
    request.account.userId !== fixture.creatorUserId
  ) {
    return {
      code: "auth.organization_identity_unavailable",
      message: "Organization identity is unavailable.",
      ok: false,
    };
  }
  const membership = await getPostgresDatabase(env)
    .query<{
      id: string;
      role: "admin" | "member" | "owner";
    }>({
      ...{
        text: 'SELECT id, role FROM "openmeld"."members" WHERE organization_id = $1 AND user_id = $2 LIMIT 1',
        values: [],
      },
      values: [fixture.organizationId, fixture.creatorUserId],
    })
    .then((result) => result.rows[0] ?? null);
  return {
    account: {
      defaultHumanProfile: {
        profileId: fixture.creatorProfileId,
        profileName: "Routine Creator",
      },
      displayName: "Routine Creator",
      email: `${fixture.creatorUserId}@example.com`,
      membership: membership
        ? { memberId: membership.id, role: membership.role }
        : null,
      userId: fixture.creatorUserId,
    },
    ok: true,
    organization: {
      id: fixture.organizationId,
      memberCount: membership ? 2 : 1,
      name: "Routine Delivery Org",
      personal: false,
      slug: `routine-delivery-${fixture.organizationId.replace("org_routine_delivery_", "")}`,
    },
  };
}
function retargetRoutineWorkerSubmitRequest(input: {
  name: string;
  request: RemoteAgentWorkerSubmitTurnRequest;
  spaceId: string;
}): RemoteAgentWorkerSubmitTurnRequest {
  if (input.request.turnEnvelope.trigger.source !== "routine") {
    throw new Error("Expected a Routine worker request");
  }
  return {
    ...input.request,
    spaceId: input.spaceId,
    turnEnvelope: {
      ...input.request.turnEnvelope,
      space: {
        ...input.request.turnEnvelope.space,
        id: input.spaceId,
        name: input.name,
      },
      trigger: {
        ...input.request.turnEnvelope.trigger,
        destination: {
          kind: "space",
          spaceId: input.spaceId,
        },
      },
    },
  };
}
function createMemoryService(): CenterAgentMemoryService {
  return {
    deleteMemberMemory: vi.fn(async () => "deleted" as const),
    deleteOrganizationMemory: vi.fn(async () => "deleted" as const),
    recallForOrganization: vi.fn(async () => ({ items: [], truncated: false })),
    recallForTurn: vi.fn(async () => ({ items: [], truncated: false })),
    readOrganizationMemoryPolicy: vi.fn(async () => ({
      organizationMemoryOptIn: false,
      updatedByUserId: null,
    })),
    rememberFactForOrganization: vi.fn(async () => ({
      status: "processing" as const,
    })),
    rememberTurn: vi.fn(async () => undefined),
    setOrganizationMemoryPolicy: vi.fn(async (input) => ({
      organizationMemoryOptIn: input.organizationMemoryOptIn,
      updatedByUserId: input.updatedByUserId,
    })),
  };
}
function buildCompletedCallback(
  fixture: Awaited<ReturnType<typeof seedRoutineDeliveryFixture>>
) {
  return {
    agentProfileId: fixture.profileId,
    bindingId: fixture.bindingId,
    dispatchId: fixture.runId,
    idempotencyKey: fixture.runId,
    organizationId: fixture.organizationId,
    spaceId: fixture.spaceId,
    submissionId: fixture.submissionId,
    text: "Routine completed.",
    triggerMessageId: fixture.runId,
  };
}
function createSignal(
  id: string,
  fixture: Awaited<ReturnType<typeof seedRoutineDeliveryFixture>>,
  spaceId = fixture.spaceId
): SignalEnvelope {
  return {
    data: { text: "Routine completed." },
    id,
    profile: {
      kind: "agent",
      profileId: fixture.profileId,
      profileName: "Routine Center Agent",
    },
    spaceId,
    ts: fixture.nowMs,
    type: "signal.text",
    v: 1,
  } as SignalEnvelope;
}
async function seedAdditionalRoutineTargetSpace(input: {
  fixture: Awaited<ReturnType<typeof seedRoutineDeliveryFixture>>;
  spaceName?: string;
}): Promise<string> {
  const spaceId = crypto.randomUUID().replaceAll("-", "").repeat(2);
  const projectionSuffix = crypto.randomUUID();
  await getPostgresDatabase(env).transaction(async (client) =>
    (async () => {
      const results: QueryResult[] = [];
      for (const query of [
        {
          ...{
            text: `
        INSERT INTO "openmeld"."space_index_spaces" (
          space_id, organization_id, organization_visibility, status, space_name,
          source_updated_at_ms, projected_at_ms, projection_event_id
        ) VALUES ($1, $2, 'private', 'active', $3, $4, $5, $6)
      `,
            values: [],
          },
          values: [
            spaceId,
            input.fixture.organizationId,
            input.spaceName ?? "Future Routine Target",
            input.fixture.nowMs,
            input.fixture.nowMs,
            `projection_${projectionSuffix}`,
          ],
        },
        {
          ...{
            text: `
        INSERT INTO "openmeld"."space_index_memberships" (
          space_id, profile_id, profile_kind_snapshot, profile_name_snapshot,
          owner_user_id_snapshot, controller_ref_snapshot, status, member_source,
          added_at_ms, source_updated_at_ms, projected_at_ms, projection_event_id
        ) VALUES ($1, $2, 'agent', 'Routine Center Agent', $3, $4, 'active',
          'member_add', $5, $6, $7, $8)
      `,
            values: [],
          },
          values: [
            spaceId,
            input.fixture.profileId,
            input.fixture.userId,
            HOSTED_CENTER_AGENT_CONTROLLER_REF,
            input.fixture.nowMs,
            input.fixture.nowMs,
            input.fixture.nowMs,
            `membership_projection_${projectionSuffix}`,
          ],
        },
      ]) {
        results.push(await client.query(query));
      }
      return results;
    })()
  );
  return spaceId;
}
async function cleanupOwnedRoutineRows(): Promise<void> {
  const cleanupErrors: Error[] = [];
  for (const organizationId of ownedRoutineOrganizationIds) {
    const cleanupSteps = [
      [
        "Agent Task outcome rows",
        {
          ...{
            text: `
            DELETE FROM "openmeld"."agent_task_terminal_outcomes"
            WHERE ((task_handle_json)::jsonb #>> '{deliveryId}') IN (
              SELECT delivery_id
              FROM "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
              WHERE organization_id = $1
            )
          `,
            values: [],
          },
          values: [organizationId],
        },
      ],
      [
        "Agent Task subscriptions",
        {
          ...{
            text: 'DELETE FROM "openmeld"."agent_task_completion_subscriptions" WHERE organization_id = $1',
            values: [],
          },
          values: [organizationId],
        },
      ],
      [
        "daily admission rows",
        {
          ...{
            text: 'DELETE FROM "openmeld"."openMeldRemoteAgent_daily_admissions" WHERE organization_id = $1',
            values: [],
          },
          values: [organizationId],
        },
      ],
      [
        "conversation generation rows",
        {
          ...{
            text: 'DELETE FROM "openmeld"."openMeldRemoteAgent_conversation_generations" WHERE organization_id = $1',
            values: [],
          },
          values: [organizationId],
        },
      ],
      [
        "native delivery rows",
        {
          ...{
            text: 'DELETE FROM "openmeld"."openMeldRemoteAgent_native_delivery_ledger" WHERE organization_id = $1',
            values: [],
          },
          values: [organizationId],
        },
      ],
      [
        "Routine Run rows",
        {
          ...{
            text: 'DELETE FROM "openmeld"."routine_runs" WHERE organization_id = $1',
            values: [],
          },
          values: [organizationId],
        },
      ],
      [
        "Routine rows",
        {
          ...{
            text: 'DELETE FROM "openmeld"."routines" WHERE organization_id = $1',
            values: [],
          },
          values: [organizationId],
        },
      ],
    ] as const;
    for (const [description, statement] of cleanupSteps) {
      try {
        await getPostgresDatabase(env).query({
          text: statement.text,
          values: [...statement.values],
        });
      } catch (cause) {
        cleanupErrors.push(
          new Error(
            `Failed to clean owned ${description} for Organization ${organizationId}.`,
            { cause }
          )
        );
      }
    }
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      cleanupErrors,
      "Failed to clean owned Remote Agent Routine delivery test rows."
    );
  }
  ownedRoutineOrganizationIds.clear();
}
