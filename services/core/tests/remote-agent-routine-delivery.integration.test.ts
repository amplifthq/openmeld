import { env } from "cloudflare:test";
import type { SignalEnvelope } from "@openmeld/protocol";
import {
  HOSTED_CENTER_AGENT_CONTROLLER_REF,
  HOSTED_CENTER_AGENT_LOGICAL_RUNTIME_ID,
  HOSTED_CENTER_AGENT_RUNTIME_IDENTITY,
  OBSERVABILITY_CLOUDFLARE_ANALYTICS_BLOBS,
} from "@openmeld/schemas";
import type {
  AuthRpcResolveOrganizationAccountIdentityInput,
  AuthRpcResolveOrganizationAccountIdentityResult,
  RemoteAgentWorkerSubmitTurnRequest,
} from "@openmeld/schemas/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveRemoteAgentTurnEnvelopeForName } from "../../remote-agent/agent-core/submission";
import { registerAgentTaskCompletionSubscription } from "../src/agent-task-coordination/infrastructure/d1/agent-task-coordination-repo";
import type { CenterAgentMemoryService } from "../src/center-agent-memory/memory-service";
import type { CoreBindings } from "../src/lib/bindings";
import { createOrganizationSkillService } from "../src/organization-skills/organization-skill-service";
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
} from "../src/remote-agent/infrastructure/d1/native-delivery-ledger-repo";
import {
  failStaleClaimedRoutineRuns,
  readRoutineRunRecord,
} from "../src/routines/routine-repository";
import {
  ROUTINE_CLAIM_WATCHDOG_TIMEOUT_MS,
  runRoutineSchedulerTick,
} from "../src/routines/routine-scheduler";
import { ROUTINE_WORKFLOW_CALLBACK_EVENTS } from "../src/routines/routine-workflow-contract";

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

describe("Remote Agent Routine native delivery", () => {
  it("lets concurrent scanners produce one Run, one worker turn, and one visible result", async () => {
    const fixture = await seedRoutineDeliveryFixture();
    await env.OPENMELD_DB.batch([
      env.OPENMELD_DB.prepare("DELETE FROM routine_runs WHERE id = ?").bind(
        fixture.runId
      ),
      env.OPENMELD_DB.prepare(
        "UPDATE routines SET next_due_at = ? WHERE id = ?"
      ).bind(fixture.nowMs, fixture.routineId),
    ]);
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
        db: env.OPENMELD_DB,
        generateRunId: () => fixture.runId,
        nowMs: fixture.nowMs,
        submitRoutineDelivery,
      }),
      runRoutineSchedulerTick({
        db: env.OPENMELD_DB,
        generateRunId: () => fixture.runId,
        nowMs: fixture.nowMs,
        submitRoutineDelivery,
      }),
    ]);

    expect(workerSubmit).toHaveBeenCalledTimes(1);
    await expect(
      readRoutineRunRecord({ db: env.OPENMELD_DB, runId: fixture.runId })
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
      readRoutineRunRecord({ db: env.OPENMELD_DB, runId: fixture.runId })
    ).resolves.toMatchObject({ status: "completed" });
  });

  it("keeps watchdog and initial native-delivery claim from tearing the Run and ledger apart", async () => {
    const fixture = await seedRoutineDeliveryFixture();
    await env.OPENMELD_DB.prepare(
      "UPDATE routine_runs SET started_at_ms = ? WHERE id = ?"
    )
      .bind(
        fixture.nowMs - ROUTINE_CLAIM_WATCHDOG_TIMEOUT_MS - 1,
        fixture.runId
      )
      .run();
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
        db: env.OPENMELD_DB,
        env: testEnv,
        nowMs: fixture.nowMs,
        routine: fixture.routine,
        run: fixture.run,
      }),
      failStaleClaimedRoutineRuns({
        cutoffMs: fixture.nowMs - ROUTINE_CLAIM_WATCHDOG_TIMEOUT_MS,
        db: env.OPENMELD_DB,
        limit: 1,
        nowMs: fixture.nowMs,
      }),
    ]);

    const run = await readRoutineRunRecord({
      db: env.OPENMELD_DB,
      runId: fixture.runId,
    });
    const delivery = await readRemoteAgentNativeDeliveryByIdempotencyKey({
      db: env.OPENMELD_DB,
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
          agentName: request.spaceId,
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
        db: env.OPENMELD_DB,
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
      db: env.OPENMELD_DB,
      idempotencyKey: fixture.runId,
    });
    expect(delivery).toMatchObject({
      routineNameSnapshot: fixture.routine.name,
      routineRunId: fixture.runId,
      status: "accepted",
    });
    await expect(
      readRoutineRunRecord({ db: env.OPENMELD_DB, runId: fixture.runId })
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
      readRoutineRunRecord({ db: env.OPENMELD_DB, runId: fixture.runId })
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
      readRoutineRunRecord({ db: env.OPENMELD_DB, runId: fixture.runId })
    ).resolves.toMatchObject({
      failureCode: null,
      publishedSignalId: fixture.publishedSignalId,
      status: "completed",
    });
  });

  it("publishes only the resumed Center Agent result after delegated Routine work", async () => {
    const fixture = await seedRoutineDeliveryFixture();
    await env.OPENMELD_DB.prepare(
      "UPDATE routine_runs SET execution_engine = 'workflow' WHERE id = ?"
    )
      .bind(fixture.runId)
      .run();
    const continuationIdempotencyKey = `agent-task-continuation:${crypto.randomUUID()}`;
    const continuationSubmissionId = `submission_continuation_${crypto.randomUUID()}`;
    let deliveryIdDuringContinuationAdmission: string | null = null;
    const workerSubmit = vi.fn(
      async (request: RemoteAgentWorkerSubmitTurnRequest) => {
        if (request.idempotencyKey === continuationIdempotencyKey) {
          deliveryIdDuringContinuationAdmission =
            (
              await readRoutineRunRecord({
                db: env.OPENMELD_DB,
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
      db: env.OPENMELD_DB,
      env: testEnv,
      nowMs: fixture.nowMs,
      routine: fixture.routine,
      run: fixture.run,
    });
    const parentDelivery = await readRemoteAgentNativeDeliveryByIdempotencyKey({
      db: env.OPENMELD_DB,
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
      db: env.OPENMELD_DB,
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
      readRoutineRunRecord({ db: env.OPENMELD_DB, runId: fixture.runId })
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
      readRoutineRunRecord({ db: env.OPENMELD_DB, runId: fixture.runId })
    ).resolves.toMatchObject({
      nativeDeliveryId: parentDelivery.deliveryId,
      status: "submitted",
    });

    const terminalParentDelivery =
      await readRemoteAgentNativeDeliveryByIdempotencyKey({
        db: env.OPENMELD_DB,
        idempotencyKey: fixture.runId,
      });
    if (!terminalParentDelivery) {
      throw new Error("Routine parent delivery disappeared");
    }
    const skillInstalledAfterRunAdmission =
      await createOrganizationSkillService({
        bucket: env.OPENMELD_ORGANIZATION_SKILLS,
        db: env.OPENMELD_DB,
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
      db: env.OPENMELD_DB,
      delegation,
      delegationId: delegation.delegationId,
      env: testEnv,
      idempotencyKey: continuationIdempotencyKey,
      instruction: "Synthesize the delegated findings into the final report.",
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
        db: env.OPENMELD_DB,
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
      readRoutineRunRecord({ db: env.OPENMELD_DB, runId: fixture.runId })
    ).resolves.toMatchObject({
      nativeDeliveryId: continuationDelivery.deliveryId,
      status: "submitted",
    });
    await expect(
      readRemoteAgentNativeDeliveryByIdempotencyKey({
        db: env.OPENMELD_DB,
        idempotencyKey: fixture.runId,
      })
    ).resolves.toMatchObject({
      status: "completed",
      workerSubmitRequest: null,
    });
    expect(continuationDelivery.workerSubmitRequest).not.toBeNull();

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
          text: "Final report after delegated research.",
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
    await expect(
      readRoutineRunRecord({ db: env.OPENMELD_DB, runId: fixture.runId })
    ).resolves.toMatchObject({
      nativeDeliveryId: continuationDelivery.deliveryId,
      publishedSignalId: fixture.publishedSignalId,
      status: "completed",
    });
  });

  it("replays a rejected Routine continuation terminal event without rerunning the worker", async () => {
    const fixture = await seedRoutineDeliveryFixture();
    await env.OPENMELD_DB.prepare(
      "UPDATE routine_runs SET execution_engine = 'workflow' WHERE id = ?"
    )
      .bind(fixture.runId)
      .run();
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
      db: env.OPENMELD_DB,
      env: testEnv,
      nowMs: fixture.nowMs,
      routine: fixture.routine,
      run: fixture.run,
    });
    const admittedParentDelivery =
      await readRemoteAgentNativeDeliveryByIdempotencyKey({
        db: env.OPENMELD_DB,
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
      db: env.OPENMELD_DB,
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
      db: env.OPENMELD_DB,
      idempotencyKey: fixture.runId,
    });
    if (!parentDelivery) {
      throw new Error("Routine parent delivery disappeared");
    }
    const continuationInput = {
      db: env.OPENMELD_DB,
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
      readRoutineRunRecord({ db: env.OPENMELD_DB, runId: fixture.runId })
    ).resolves.toMatchObject({
      status: "submitted",
    });
    await env.OPENMELD_DB.prepare(
      `
        CREATE TRIGGER test_reject_routine_continuation_terminal_projection
        BEFORE UPDATE OF status ON routine_runs
        WHEN NEW.status = 'failed'
        BEGIN
          SELECT RAISE(
            ABORT,
            'forced Routine continuation terminal projection failure'
          );
        END
      `
    ).run();
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
      await env.OPENMELD_DB.prepare(
        "DROP TRIGGER IF EXISTS test_reject_routine_continuation_terminal_projection"
      ).run();
    }
    await expect(
      readRoutineRunRecord({ db: env.OPENMELD_DB, runId: fixture.runId })
    ).resolves.toMatchObject({ status: "submitted" });
    await expect(
      finalizeRemoteAgentRoutineContinuationFailure({
        db: env.OPENMELD_DB,
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
      readRoutineRunRecord({ db: env.OPENMELD_DB, runId: fixture.runId })
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

  it("fails immediately when Remote Agent deterministically rejects Routine admission", async () => {
    const fixture = await seedRoutineDeliveryFixture();
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
        db: env.OPENMELD_DB,
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
        text: "Routine “Daily feedback review” could not run because Center Agent could not accept the request. Try running the Routine again or open diagnostics.",
      })
    );
    await expect(
      readRoutineRunRecord({ db: env.OPENMELD_DB, runId: fixture.runId })
    ).resolves.toMatchObject({
      failureCode: "remote_agent.routine_identity_mismatch",
      failureDetail:
        "remote_agent.routine_identity_mismatch: Remote Agent Routine execution identity does not match its turn envelope.",
      status: "failed",
    });
    await expect(
      readRemoteAgentNativeDeliveryByIdempotencyKey({
        db: env.OPENMELD_DB,
        idempotencyKey: fixture.runId,
      })
    ).resolves.toMatchObject({
      failureCode: "remote_agent.routine_identity_mismatch",
      status: "failed",
      submissionId: null,
      workerSubmitRequest: null,
    });
  });

  it("rolls a history-limited Routine on the same destination automatically", async () => {
    const fixture = await seedRoutineDeliveryFixture();
    const workerSubmit = vi
      .fn()
      .mockResolvedValueOnce({
        idempotencyKey: fixture.runId,
        message: "Worker diagnostic detail only.",
        outcome: "rejected" as const,
        reasonCode: "remote_agent.conversation_history_limit_exceeded" as const,
        v: 1 as const,
      })
      .mockResolvedValueOnce({
        accepted: true,
        createdAt: fixture.nowMs,
        idempotencyKey: fixture.runId,
        status: "pending" as const,
        submissionId: fixture.submissionId,
      });
    const testEnv = buildEnv({
      continuitySignals: [createSignal("signal_previous_1", fixture)],
      fixture,
      workerSubmit,
    });

    await expect(
      submitRemoteAgentRoutineDelivery({
        db: env.OPENMELD_DB,
        env: testEnv,
        nowMs: fixture.nowMs,
        routine: fixture.routine,
        run: fixture.run,
      })
    ).resolves.toEqual({ status: "submitted" });

    expect(workerSubmit).toHaveBeenCalledTimes(2);
    expect(workerSubmit.mock.calls[1]?.[0]).toMatchObject({
      continuityContext: {
        entries: [
          {
            content: { text: "Routine completed." },
            source: { kind: "space_signal", signalId: "signal_previous_1" },
          },
        ],
        fromGeneration: 0,
        toGeneration: 1,
      },
      runtimeConversation: { generation: 1 },
      v: 4,
    });
    expect(
      testEnv.__spaceStub.rpcPostSignalOnceByClientMessageId
    ).not.toHaveBeenCalled();
    await expect(
      readRoutineRunRecord({ db: env.OPENMELD_DB, runId: fixture.runId })
    ).resolves.toMatchObject({
      failureCode: null,
      status: "submitted",
    });
    await expect(
      readRemoteAgentNativeDeliveryByIdempotencyKey({
        db: env.OPENMELD_DB,
        idempotencyKey: fixture.runId,
      })
    ).resolves.toMatchObject({
      failureCode: null,
      status: "accepted",
      workerSubmitRequest: {
        runtimeConversation: { generation: 1 },
        v: 4,
      },
    });
  });

  it("fails a Routine visibly when the Organization daily admission limit is reached", async () => {
    const fixture = await seedRoutineDeliveryFixture();
    await env.OPENMELD_DB.prepare(
      `
        INSERT INTO openMeldRemoteAgent_daily_admissions (
          organization_id,
          day_utc,
          admitted_count,
          last_admission_idempotency_key,
          created_at_ms,
          updated_at_ms
        ) VALUES (?, ?, 1, 'seeded_admission', ?, ?)
      `
    )
      .bind(fixture.organizationId, "2026-07-12", fixture.nowMs, fixture.nowMs)
      .run();
    const workerSubmit = vi.fn();
    const testEnv = buildEnv({
      dailyAdmissionLimit: "1",
      fixture,
      workerSubmit,
    });

    await expect(
      submitRemoteAgentRoutineDelivery({
        db: env.OPENMELD_DB,
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
          errorCode: "remote_agent.daily_quota_exceeded",
        }),
        text: "Routine “Daily feedback review” could not run because the Organization has reached its daily Remote Agent request limit. The limit resets at 00:00 UTC.",
      })
    );
    const failedRun = await readRoutineRunRecord({
      db: env.OPENMELD_DB,
      runId: fixture.runId,
    });
    expect(failedRun).toMatchObject({
      failureCode: "remote_agent.daily_quota_exceeded",
      status: "failed",
    });
    expect(failedRun?.failureDetail).toContain(
      "remote_agent.daily_quota_exceeded"
    );
    expect(failedRun?.failureDetail).toContain("00:00 UTC");
  });

  it("keeps the claimed target immutable while a Routine update changes only the next occurrence", async () => {
    const fixture = await seedRoutineDeliveryFixture();
    const futureSpaceId = await seedAdditionalRoutineTargetSpace({ fixture });
    await env.OPENMELD_DB.prepare(
      "UPDATE routines SET target_space_id = ?, updated_at_ms = ? WHERE id = ?"
    )
      .bind(futureSpaceId, fixture.nowMs + 1, fixture.routineId)
      .run();
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
        db: env.OPENMELD_DB,
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
        db: env.OPENMELD_DB,
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
      db: env.OPENMELD_DB,
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
        db: env.OPENMELD_DB,
        idempotencyKey: nextRunId,
      })
    ).resolves.toMatchObject({ spaceId: futureSpaceId });
  });

  it("fails closed against the claimed target when its membership is revoked", async () => {
    const fixture = await seedRoutineDeliveryFixture();
    const futureSpaceId = await seedAdditionalRoutineTargetSpace({ fixture });
    await env.OPENMELD_DB.batch([
      env.OPENMELD_DB.prepare(
        "UPDATE routines SET target_space_id = ?, updated_at_ms = ? WHERE id = ?"
      ).bind(futureSpaceId, fixture.nowMs + 1, fixture.routineId),
      env.OPENMELD_DB.prepare(
        "DELETE FROM space_index_memberships WHERE space_id = ? AND profile_id = ?"
      ).bind(fixture.spaceId, fixture.profileId),
    ]);
    const workerSubmit = vi.fn();
    const testEnv = buildEnv({
      additionalSpaceIds: [futureSpaceId],
      fixture,
      workerSubmit,
    });

    await expect(
      submitRemoteAgentRoutineDelivery({
        db: env.OPENMELD_DB,
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
      readRoutineRunRecord({ db: env.OPENMELD_DB, runId: fixture.runId })
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
      db: env.OPENMELD_DB,
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
        db: env.OPENMELD_DB,
        idempotencyKey: fixture.runId,
      })
    ).resolves.toMatchObject({
      publishedSignalId: fixture.publishedSignalId,
      status: "completed",
      submissionId: fixture.submissionId,
      workerSubmitRequest: null,
    });
    await expect(
      readRoutineRunRecord({ db: env.OPENMELD_DB, runId: fixture.runId })
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
        db: env.OPENMELD_DB,
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
        db: env.OPENMELD_DB,
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
      readRoutineRunRecord({ db: env.OPENMELD_DB, runId: fixture.runId })
    ).resolves.toMatchObject({ status: "submitted" });

    await expect(
      retryRemoteAgentRoutineSubmissions({
        db: env.OPENMELD_DB,
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
      readRoutineRunRecord({ db: env.OPENMELD_DB, runId: fixture.runId })
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
      db: env.OPENMELD_DB,
      nowMs: fixture.nowMs,
      organizationId: fixture.organizationId,
      profileId: fixture.profileId,
      routineId: fixture.routineId,
      routineName: fixture.routine.name,
      runId: fixture.runId,
      spaceId: fixture.spaceId,
      workerSubmitRequest,
    });
    const storedRequest = await env.OPENMELD_DB.prepare(
      "SELECT worker_submit_request_json FROM openMeldRemoteAgent_native_delivery_ledger WHERE idempotency_key = ?"
    )
      .bind(fixture.runId)
      .first<{ worker_submit_request_json: string | null }>();
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
    await env.OPENMELD_DB.prepare(
      "UPDATE openMeldRemoteAgent_native_delivery_ledger SET worker_submit_request_json = ? WHERE idempotency_key = ?"
    )
      .bind(JSON.stringify(legacyWorkerSubmitRequest), fixture.runId)
      .run();
    const workerSubmit = vi.fn();
    const testEnv = buildEnv({ fixture, workerSubmit });

    await expect(
      retryRemoteAgentRoutineSubmissions({
        db: env.OPENMELD_DB,
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
      readRoutineRunRecord({ db: env.OPENMELD_DB, runId: fixture.runId })
    ).resolves.toMatchObject({
      failureCode: "remote_agent.worker_submit_request_invalid",
      status: "failed",
    });
    await expect(
      readRemoteAgentNativeDeliveryByIdempotencyKey({
        db: env.OPENMELD_DB,
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
      db: env.OPENMELD_DB,
      nowMs: fixture.nowMs,
      organizationId: fixture.organizationId,
      profileId: fixture.profileId,
      routineId: fixture.routineId,
      routineName: fixture.routine.name,
      runId: fixture.runId,
      spaceId: fixture.spaceId,
      workerSubmitRequest,
    });
    await env.OPENMELD_DB.prepare(
      "UPDATE openMeldRemoteAgent_native_delivery_ledger SET worker_submit_request_json = ? WHERE idempotency_key = ?"
    )
      .bind(value, fixture.runId)
      .run();
    const workerSubmit = vi.fn();
    const testEnv = buildEnv({ fixture, workerSubmit });

    await expect(
      retryRemoteAgentRoutineSubmissions({
        db: env.OPENMELD_DB,
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
      readRoutineRunRecord({ db: env.OPENMELD_DB, runId: fixture.runId })
    ).resolves.toMatchObject({
      failureCode: "remote_agent.worker_submit_request_invalid",
      status: "failed",
    });
  });

  it("keeps Workflow-owned submissions out of the legacy recovery scanner", async () => {
    const fixture = await seedRoutineDeliveryFixture();
    await env.OPENMELD_DB.prepare(
      "UPDATE routine_runs SET execution_engine = 'workflow' WHERE id = ?"
    )
      .bind(fixture.runId)
      .run();
    const workerSubmit = vi
      .fn()
      .mockRejectedValue(
        new Error("transport disconnected after Workflow admission")
      );
    const testEnv = buildEnv({ fixture, workerSubmit });

    await expect(
      submitRemoteAgentRoutineDelivery({
        db: env.OPENMELD_DB,
        env: testEnv,
        nowMs: fixture.nowMs,
        routine: fixture.routine,
        run: fixture.run,
      })
    ).resolves.toEqual({ status: "submitted" });

    await expect(
      retryRemoteAgentRoutineSubmissions({
        db: env.OPENMELD_DB,
        env: testEnv,
        limit: 1,
        nowMs: fixture.nowMs + 60_000,
      })
    ).resolves.toEqual({ errors: 0, recovered: 0, scanned: 0 });
    expect(workerSubmit).toHaveBeenCalledTimes(1);
  });

  it("forwards a Workflow-owned callback without publishing outside the Workflow", async () => {
    const fixture = await seedRoutineDeliveryFixture();
    await env.OPENMELD_DB.prepare(
      "UPDATE routine_runs SET execution_engine = 'workflow' WHERE id = ?"
    )
      .bind(fixture.runId)
      .run();
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
    } as unknown as Workflow<{ runId: string }>;

    await expect(
      submitRemoteAgentRoutineDelivery({
        db: env.OPENMELD_DB,
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
      | { blobs: string[]; indexes: string[] }
      | undefined;
    expect(point?.indexes).toEqual([fixture.runId]);
    expect(point?.blobs[readAnalyticsBlobIndex("event")]).toBe(
      "core.openmeld.routine_workflow.callback_forwarded"
    );
    expect(
      testEnv.__spaceStub.rpcPostSignalOnceByClientMessageId
    ).not.toHaveBeenCalled();
    await expect(
      readRoutineRunRecord({ db: env.OPENMELD_DB, runId: fixture.runId })
    ).resolves.toMatchObject({ status: "submitted" });
  });

  it("records a retryable Workflow callback-forwarding failure by Run id", async () => {
    const fixture = await seedRoutineDeliveryFixture();
    await env.OPENMELD_DB.prepare(
      "UPDATE routine_runs SET execution_engine = 'workflow' WHERE id = ?"
    )
      .bind(fixture.runId)
      .run();
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
    } as unknown as Workflow<{ runId: string }>;

    await expect(
      submitRemoteAgentRoutineDelivery({
        db: env.OPENMELD_DB,
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
      | { blobs: string[]; indexes: string[] }
      | undefined;
    expect(point?.indexes).toEqual([fixture.runId]);
    expect(point?.blobs[readAnalyticsBlobIndex("event")]).toBe(
      "core.openmeld.routine_workflow.callback_forwarding_failed"
    );
    expect(
      testEnv.__spaceStub.rpcPostSignalOnceByClientMessageId
    ).not.toHaveBeenCalled();
    await expect(
      readRoutineRunRecord({ db: env.OPENMELD_DB, runId: fixture.runId })
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
      db: env.OPENMELD_DB,
      env: testEnv,
      nowMs: fixture.nowMs,
      routine: fixture.routine,
      run: fixture.run,
    });
    await env.OPENMELD_DB.prepare(
      "UPDATE routines SET target_space_id = ?, updated_at_ms = ? WHERE id = ?"
    )
      .bind(futureSpaceId, fixture.nowMs + 1, fixture.routineId)
      .run();

    await expect(
      retryRemoteAgentRoutineSubmissions({
        db: env.OPENMELD_DB,
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
      db: env.OPENMELD_DB,
      nowMs: fixture.nowMs,
      organizationId: fixture.organizationId,
      profileId: fixture.profileId,
      routineId: fixture.routineId,
      routineName: fixture.routine.name,
      runId: fixture.runId,
      spaceId: fixture.spaceId,
      workerSubmitRequest: claimedTargetRequest,
    });
    await env.OPENMELD_DB.prepare(
      "UPDATE openMeldRemoteAgent_native_delivery_ledger SET space_id = ?, worker_submit_request_json = ? WHERE idempotency_key = ?"
    )
      .bind(
        conflictingSpaceId,
        JSON.stringify(conflictingRequest),
        fixture.runId
      )
      .run();
    const corruptedDelivery =
      await readRemoteAgentNativeDeliveryByIdempotencyKey({
        db: env.OPENMELD_DB,
        idempotencyKey: fixture.runId,
      });
    if (!corruptedDelivery) {
      throw new Error("Expected the conflicting delivery ledger");
    }
    await expect(
      claimRemoteAgentRoutineSubmissionRecoveryAttempt({
        db: env.OPENMELD_DB,
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
        db: env.OPENMELD_DB,
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
      readRoutineRunRecord({ db: env.OPENMELD_DB, runId: fixture.runId })
    ).resolves.toMatchObject({ status: "submitted" });
    await expect(
      readRemoteAgentNativeDeliveryByIdempotencyKey({
        db: env.OPENMELD_DB,
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
        db: env.OPENMELD_DB,
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
      db: env.OPENMELD_DB,
      nowMs: fixture.nowMs,
      organizationId: fixture.organizationId,
      profileId: fixture.profileId,
      routineId: fixture.routineId,
      routineName: fixture.routine.name,
      runId: fixture.runId,
      spaceId: fixture.spaceId,
      workerSubmitRequest: claimedTargetRequest,
    });
    await env.OPENMELD_DB.prepare(
      "UPDATE openMeldRemoteAgent_native_delivery_ledger SET space_id = ?, worker_submit_request_json = ? WHERE idempotency_key = ?"
    )
      .bind(
        conflictingSpaceId,
        JSON.stringify(conflictingRequest),
        fixture.runId
      )
      .run();
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
      readRoutineRunRecord({ db: env.OPENMELD_DB, runId: fixture.runId })
    ).resolves.toMatchObject({ status: "submitted" });
    await expect(
      readRemoteAgentNativeDeliveryByIdempotencyKey({
        db: env.OPENMELD_DB,
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
      db: env.OPENMELD_DB,
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
      db: env.OPENMELD_DB,
      idempotencyKey: fixture.runId,
      nowMs: fixture.nowMs,
      submissionId: fixture.submissionId,
    });
    await env.OPENMELD_DB.prepare(
      "UPDATE openMeldRemoteAgent_native_delivery_ledger SET space_id = ? WHERE idempotency_key = ?"
    )
      .bind(conflictingSpaceId, fixture.runId)
      .run();
    const testEnv = buildEnv({
      additionalSpaceIds: [conflictingSpaceId],
      fixture,
      workerSubmit: vi.fn(),
    });

    await expect(
      processRemoteAgentNativeDeliveryDeadlineProbe({
        db: env.OPENMELD_DB,
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
      readRoutineRunRecord({ db: env.OPENMELD_DB, runId: fixture.runId })
    ).resolves.toMatchObject({ status: "submitted" });
    await expect(
      readRemoteAgentNativeDeliveryByIdempotencyKey({
        db: env.OPENMELD_DB,
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
      db: env.OPENMELD_DB,
      nowMs: fixture.nowMs,
      organizationId: fixture.organizationId,
      profileId: fixture.profileId,
      routineId: fixture.routineId,
      routineName: fixture.routine.name,
      runId: fixture.runId,
      spaceId: fixture.spaceId,
      workerSubmitRequest: claimedTargetRequest,
    });
    await env.OPENMELD_DB.batch([
      env.OPENMELD_DB.prepare(
        "UPDATE routine_runs SET execution_engine = 'workflow' WHERE id = ?"
      ).bind(fixture.runId),
      env.OPENMELD_DB.prepare(
        "UPDATE openMeldRemoteAgent_native_delivery_ledger SET space_id = ?, worker_submit_request_json = ? WHERE idempotency_key = ?"
      ).bind(
        conflictingSpaceId,
        JSON.stringify(conflictingRequest),
        fixture.runId
      ),
    ]);
    const workerSubmit = vi.fn();
    const testEnv = buildEnv({
      additionalSpaceIds: [conflictingSpaceId],
      fixture,
      workerSubmit,
    });

    await expect(
      ensureRemoteAgentRoutineWorkflowSubmission({
        db: env.OPENMELD_DB,
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
      db: env.OPENMELD_DB,
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
    await env.OPENMELD_DB.batch([
      env.OPENMELD_DB.prepare(
        "UPDATE routine_runs SET execution_engine = 'workflow' WHERE id = ?"
      ).bind(fixture.runId),
      env.OPENMELD_DB.prepare(
        "UPDATE openMeldRemoteAgent_native_delivery_ledger SET worker_submit_request_json = ? WHERE idempotency_key = ?"
      ).bind(JSON.stringify(legacyWorkerSubmitRequest), fixture.runId),
    ]);
    const workerSubmit = vi.fn();
    const testEnv = buildEnv({ fixture, workerSubmit });

    await expect(
      ensureRemoteAgentRoutineWorkflowSubmission({
        db: env.OPENMELD_DB,
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
      readRoutineRunRecord({ db: env.OPENMELD_DB, runId: fixture.runId })
    ).resolves.toMatchObject({
      failureCode: "remote_agent.worker_submit_request_invalid",
      status: "failed",
    });
  });

  it("lets a Workflow wait for its callback when the worker ACK outcome is unknown", async () => {
    const fixture = await seedRoutineDeliveryFixture();
    const workerSubmitRequest = {
      ...(await buildRoutineWorkerSubmitRequest(fixture)),
      toolExecutionDeadlineAtMs:
        fixture.nowMs + REMOTE_AGENT_ADMISSION_WATCHDOG_DELAY_SECONDS * 1000,
    };
    await claimRemoteAgentRoutineNativeDelivery({
      bindingId: fixture.bindingId,
      db: env.OPENMELD_DB,
      nowMs: fixture.nowMs,
      organizationId: fixture.organizationId,
      profileId: fixture.profileId,
      routineId: fixture.routineId,
      routineName: fixture.routine.name,
      runId: fixture.runId,
      spaceId: fixture.spaceId,
      workerSubmitRequest,
    });
    await env.OPENMELD_DB.prepare(
      "UPDATE routine_runs SET execution_engine = 'workflow' WHERE id = ?"
    )
      .bind(fixture.runId)
      .run();
    const recoveryAtMs = fixture.nowMs + 60_000;
    const workerSubmit = vi.fn(() =>
      Promise.reject(
        new Error("transport disconnected after the worker admitted the turn")
      )
    );

    const testEnv = buildEnv({ fixture, workerSubmit });
    const submission = await ensureRemoteAgentRoutineWorkflowSubmission({
      db: env.OPENMELD_DB,
      env: testEnv,
      nowMs: recoveryAtMs,
      runId: fixture.runId,
    });
    expect(submission).toEqual({
      dispatchId: fixture.runId,
      idempotencyKey: fixture.runId,
      organizationId: fixture.organizationId,
      spaceId: fixture.spaceId,
      status: "waiting",
      submissionId: null,
    });

    expect(workerSubmit).toHaveBeenCalledTimes(1);
    await expect(
      readRoutineRunRecord({ db: env.OPENMELD_DB, runId: fixture.runId })
    ).resolves.toMatchObject({ status: "submitted" });
    await expect(
      readRemoteAgentNativeDeliveryByIdempotencyKey({
        db: env.OPENMELD_DB,
        idempotencyKey: fixture.runId,
      })
    ).resolves.toMatchObject({
      status: "submitted",
      submissionId: null,
      workerSubmitRequest: expect.objectContaining({
        idempotencyKey: fixture.runId,
      }),
    });

    expect(submission.status).toBe("waiting");
    await expect(
      readRoutineRunRecord({ db: env.OPENMELD_DB, runId: fixture.runId })
    ).resolves.toMatchObject({ failureCode: null, status: "submitted" });
    expect(
      testEnv.__spaceStub.rpcPostSignalOnceByClientMessageId
    ).not.toHaveBeenCalled();
  });

  it("keeps a Workflow waiting and retains its Routine envelope after worker ACK", async () => {
    const fixture = await seedRoutineDeliveryFixture();
    const workerSubmitRequest = await buildRoutineWorkerSubmitRequest(fixture);
    await claimRemoteAgentRoutineNativeDelivery({
      bindingId: fixture.bindingId,
      db: env.OPENMELD_DB,
      nowMs: fixture.nowMs,
      organizationId: fixture.organizationId,
      profileId: fixture.profileId,
      routineId: fixture.routineId,
      routineName: fixture.routine.name,
      runId: fixture.runId,
      spaceId: fixture.spaceId,
      workerSubmitRequest,
    });
    await env.OPENMELD_DB.prepare(
      "UPDATE routine_runs SET execution_engine = 'workflow' WHERE id = ?"
    )
      .bind(fixture.runId)
      .run();
    const workerSubmit = vi.fn(async () => ({
      accepted: true,
      createdAt: fixture.nowMs,
      idempotencyKey: fixture.runId,
      status: "pending" as const,
      submissionId: fixture.submissionId,
    }));

    await expect(
      ensureRemoteAgentRoutineWorkflowSubmission({
        db: env.OPENMELD_DB,
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
        db: env.OPENMELD_DB,
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
      db: env.OPENMELD_DB,
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
      db: env.OPENMELD_DB,
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
        db: env.OPENMELD_DB,
        idempotencyKey: fixture.runId,
      })
    ).resolves.toMatchObject({
      failureCode: null,
      publishedSignalId: fixture.publishedSignalId,
      status: "completed",
      submissionId: fixture.submissionId,
    });
    await expect(
      readRoutineRunRecord({ db: env.OPENMELD_DB, runId: fixture.runId })
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
      db: env.OPENMELD_DB,
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
        db: env.OPENMELD_DB,
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
      readRoutineRunRecord({ db: env.OPENMELD_DB, runId: fixture.runId })
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
      readRoutineRunRecord({ db: env.OPENMELD_DB, runId: fixture.runId })
    ).resolves.toMatchObject({
      failureCode: null,
      publishedSignalId: fixture.publishedSignalId,
      status: "completed",
    });
  });

  it("fails visibly when the member who delegated the Routine leaves the Organization", async () => {
    const fixture = await seedRoutineDeliveryFixture();
    await env.OPENMELD_DB.prepare(
      "DELETE FROM members WHERE organization_id = ? AND user_id = ?"
    )
      .bind(fixture.organizationId, fixture.creatorUserId)
      .run();
    const workerSubmit = vi.fn(async () => ({
      accepted: true,
      createdAt: fixture.nowMs,
      idempotencyKey: fixture.runId,
      status: "pending" as const,
      submissionId: fixture.submissionId,
    }));

    await expect(
      submitRemoteAgentRoutineDelivery({
        db: env.OPENMELD_DB,
        env: buildEnv({ fixture, workerSubmit }),
        nowMs: fixture.nowMs,
        routine: fixture.routine,
        run: fixture.run,
      })
    ).resolves.toEqual({ status: "failed" });
    expect(workerSubmit).not.toHaveBeenCalled();
    await expect(
      readRoutineRunRecord({ db: env.OPENMELD_DB, runId: fixture.runId })
    ).resolves.toMatchObject({
      failureCode: "routine.member_actor_required",
      status: "failed",
    });
  });

  it("fences concurrent failure-redrive scanners with one Space publication key", async () => {
    const fixture = await seedRoutineDeliveryFixture();
    await env.OPENMELD_DB.prepare(
      "UPDATE routine_runs SET status = 'failed', failure_code = 'remote_agent.test_failure', failure_detail = 'Visible failure', finished_at_ms = ? WHERE id = ?"
    )
      .bind(fixture.nowMs, fixture.runId)
      .run();
    const testEnv = buildEnv({ fixture, workerSubmit: vi.fn() });

    await Promise.all([
      retryRemoteAgentRoutineFailurePublications({
        db: env.OPENMELD_DB,
        env: testEnv,
        limit: 1,
        nowMs: fixture.nowMs + 60_000,
      }),
      retryRemoteAgentRoutineFailurePublications({
        db: env.OPENMELD_DB,
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
      readRoutineRunRecord({ db: env.OPENMELD_DB, runId: fixture.runId })
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
      await env.OPENMELD_DB.prepare(
        "UPDATE routines SET status = 'paused', next_due_at = NULL WHERE id = ?"
      )
        .bind(fixture.routineId)
        .run();
    } else {
      await env.OPENMELD_DB.prepare("DELETE FROM routines WHERE id = ?")
        .bind(fixture.routineId)
        .run();
    }
    const workerSubmit = vi.fn();
    const testEnv = buildEnv({ fixture, workerSubmit });

    await expect(
      submitRemoteAgentRoutineDelivery({
        db: env.OPENMELD_DB,
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
        db: env.OPENMELD_DB,
        idempotencyKey: fixture.runId,
      })
    ).toBeNull();
    await expect(
      readRoutineRunRecord({ db: env.OPENMELD_DB, runId: fixture.runId })
    ).resolves.toMatchObject({
      failureCode: "routine.not_enabled_at_admission",
      status: "skipped",
    });
  });

  it("projects a failed callback once and keeps late callbacks from reopening the Run", async () => {
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
      db: env.OPENMELD_DB,
      env: testEnv,
      nowMs: fixture.nowMs,
      routine: fixture.routine,
      run: fixture.run,
    });
    await env.OPENMELD_DB.prepare(
      "UPDATE routines SET target_space_id = ?, updated_at_ms = ? WHERE id = ?"
    )
      .bind(futureSpaceId, fixture.nowMs + 1, fixture.routineId)
      .run();
    vi.spyOn(Date, "now").mockReturnValue(fixture.nowMs + 1000);
    const failedCallback = {
      agentProfileId: fixture.profileId,
      bindingId: fixture.bindingId,
      dispatchId: fixture.runId,
      failureCode: "remote_agent.turn_not_completed",
      failureMessage: "Remote Agent could not finish this request.",
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
    ).toContain(`Routine “${fixture.routine.name}”`);
    await expect(
      readRoutineRunRecord({ db: env.OPENMELD_DB, runId: fixture.runId })
    ).resolves.toMatchObject({
      failureCode: "remote_agent.turn_not_completed",
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
      readRoutineRunRecord({ db: env.OPENMELD_DB, runId: fixture.runId })
    ).resolves.toMatchObject({
      failureCode: "remote_agent.turn_not_completed",
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
      db: env.OPENMELD_DB,
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
      readRoutineRunRecord({ db: env.OPENMELD_DB, runId: fixture.runId })
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
      db: env.OPENMELD_DB,
      env: testEnv,
      nowMs: fixture.nowMs,
      routine: fixture.routine,
      run: fixture.run,
    });
    await env.OPENMELD_DB.prepare(
      "UPDATE routines SET target_space_id = ?, updated_at_ms = ? WHERE id = ?"
    )
      .bind(futureSpaceId, fixture.nowMs + 1, fixture.routineId)
      .run();
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
      readRoutineRunRecord({ db: env.OPENMELD_DB, runId: fixture.runId })
    ).resolves.toMatchObject({
      failureCode: "remote_agent.turn_not_completed",
      publishedSignalId: null,
      status: "failed",
    });
    await expect(
      retryRemoteAgentRoutineFailurePublications({
        db: env.OPENMELD_DB,
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
      db: env.OPENMELD_DB,
      env: testEnv,
      nowMs: fixture.nowMs,
      routine: fixture.routine,
      run: fixture.run,
    });
    const claimId = crypto.randomUUID();
    await claimRemoteAgentFinalPublication({
      claimExpiresAtMs: fixture.nowMs + 30_000,
      claimId,
      db: env.OPENMELD_DB,
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
      db: env.OPENMELD_DB,
      failureCode: "remote_agent.turn_not_completed",
      idempotencyKey: fixture.runId,
      nowMs: fixture.nowMs + 2000,
      submissionId: fixture.submissionId,
    });
    await expect(
      readRoutineRunRecord({ db: env.OPENMELD_DB, runId: fixture.runId })
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
      readRoutineRunRecord({ db: env.OPENMELD_DB, runId: fixture.runId })
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
      db: env.OPENMELD_DB,
      env: testEnv,
      nowMs: fixture.nowMs,
      routine: fixture.routine,
      run: fixture.run,
    });
    await env.OPENMELD_DB.prepare(
      "UPDATE routines SET target_space_id = ?, updated_at_ms = ? WHERE id = ?"
    )
      .bind(futureSpaceId, fixture.nowMs + 1, fixture.routineId)
      .run();
    if (recovery === "space_claim") {
      testEnv.__spaceStub.rpcReadFinalReplyClaimSignalId.mockResolvedValue({
        signalId: fixture.publishedSignalId,
      });
    } else {
      await markRemoteAgentNativeDeliveryCompleted({
        db: env.OPENMELD_DB,
        nowMs: fixture.nowMs + 500,
        publishedSignalId: fixture.publishedSignalId,
        submissionId: fixture.submissionId,
      });
    }

    await processRemoteAgentNativeDeliveryDeadlineProbe({
      db: env.OPENMELD_DB,
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
      readRoutineRunRecord({ db: env.OPENMELD_DB, runId: fixture.runId })
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
      db: env.OPENMELD_DB,
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
        db: env.OPENMELD_DB,
        env: testEnv,
        nowMs,
        probe,
      }),
      processRemoteAgentNativeDeliveryDeadlineProbe({
        db: env.OPENMELD_DB,
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
      db: env.OPENMELD_DB,
      runId: fixture.runId,
    });
    const terminalDelivery =
      await readRemoteAgentNativeDeliveryByIdempotencyKey({
        db: env.OPENMELD_DB,
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
      db: env.OPENMELD_DB,
      env: testEnv,
      nowMs: fixture.nowMs,
      routine: fixture.routine,
      run: fixture.run,
    });
    await env.OPENMELD_DB.prepare(
      "UPDATE routines SET target_space_id = ?, updated_at_ms = ? WHERE id = ?"
    )
      .bind(futureSpaceId, fixture.nowMs + 1, fixture.routineId)
      .run();
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
        db: env.OPENMELD_DB,
        env: testEnv,
        nowMs: probe.deadlineAtMs,
        probe,
      })
    ).resolves.toEqual({
      reasonCode: "remote_agent.execution_reconciliation_scheduled",
      status: "skipped",
    });
    expect(workerReconcile).toHaveBeenCalledWith({
      conversationId: fixture.spaceId,
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
    await env.OPENMELD_DB.prepare(
      "UPDATE routines SET status = 'paused', next_due_at = NULL WHERE id = ?"
    )
      .bind(fixture.routineId)
      .run();

    await expect(
      claimRemoteAgentRoutineNativeDelivery({
        bindingId: fixture.bindingId,
        db: env.OPENMELD_DB,
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
      readRoutineRunRecord({ db: env.OPENMELD_DB, runId: fixture.runId })
    ).resolves.toMatchObject({ status: "claimed" });
  });

  it("keeps the Run submitted when the worker ACK wins the recovery failure race", async () => {
    const fixture = await seedRoutineDeliveryFixture();
    const workerSubmitRequest = await buildRoutineWorkerSubmitRequest(fixture);
    const claim = await claimRemoteAgentRoutineNativeDelivery({
      bindingId: fixture.bindingId,
      db: env.OPENMELD_DB,
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
      db: env.OPENMELD_DB,
      idempotencyKey: fixture.runId,
      nowMs: fixture.nowMs + 1000,
      submissionId: fixture.submissionId,
    });

    await expect(
      claimRemoteAgentRoutineSubmissionFailure({
        db: env.OPENMELD_DB,
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
      readRoutineRunRecord({ db: env.OPENMELD_DB, runId: fixture.runId })
    ).resolves.toMatchObject({ status: "submitted" });
    await expect(
      readRemoteAgentNativeDeliveryByIdempotencyKey({
        db: env.OPENMELD_DB,
        idempotencyKey: fixture.runId,
      })
    ).resolves.toMatchObject({
      failureCode: null,
      status: "accepted",
      submissionId: fixture.submissionId,
    });
    await markRemoteAgentNativeDeliveryDeadlineProbeEnqueued({
      db: env.OPENMELD_DB,
      idempotencyKey: fixture.runId,
      nowMs: fixture.nowMs + 2000,
      submissionId: fixture.submissionId,
    });
  });

  it("redrives an admission failure publication durably on the next Routine tick", async () => {
    const fixture = await seedRoutineDeliveryFixture();
    const futureSpaceId = await seedAdditionalRoutineTargetSpace({ fixture });
    await env.OPENMELD_DB.batch([
      env.OPENMELD_DB.prepare(
        "UPDATE routines SET target_space_id = ?, updated_at_ms = ? WHERE id = ?"
      ).bind(futureSpaceId, fixture.nowMs + 1, fixture.routineId),
      env.OPENMELD_DB.prepare(
        "DELETE FROM center_agent_designations WHERE organization_id = ?"
      ).bind(fixture.organizationId),
    ]);
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
        db: env.OPENMELD_DB,
        env: testEnv,
        nowMs: fixture.nowMs,
        routine: fixture.routine,
        run: fixture.run,
      })
    ).resolves.toEqual({ status: "failed" });
    await expect(
      readRoutineRunRecord({ db: env.OPENMELD_DB, runId: fixture.runId })
    ).resolves.toMatchObject({ publishedSignalId: null, status: "failed" });

    await expect(
      retryRemoteAgentRoutineFailurePublications({
        db: env.OPENMELD_DB,
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
      readRoutineRunRecord({ db: env.OPENMELD_DB, runId: fixture.runId })
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
      db: env.OPENMELD_DB,
      nowMs: fixture.nowMs,
      organizationId: fixture.organizationId,
      profileId: fixture.profileId,
      routineId: fixture.routineId,
      routineName: fixture.routine.name,
      runId: fixture.runId,
      spaceId: fixture.spaceId,
      workerSubmitRequest: claimedTargetRequest,
    });
    await env.OPENMELD_DB.batch([
      env.OPENMELD_DB.prepare(
        "UPDATE openMeldRemoteAgent_native_delivery_ledger SET space_id = ?, worker_submit_request_json = ? WHERE idempotency_key = ?"
      ).bind(
        conflictingSpaceId,
        JSON.stringify(workerSubmitRequest),
        fixture.runId
      ),
      env.OPENMELD_DB.prepare(
        "UPDATE routine_runs SET status = 'failed', failure_code = 'remote_agent.test_failure', failure_detail = 'Corrupt target authority', finished_at_ms = ? WHERE id = ?"
      ).bind(fixture.nowMs + 1, fixture.runId),
    ]);
    const workerSubmit = vi.fn();
    const testEnv = buildEnv({
      additionalSpaceIds: [conflictingSpaceId],
      fixture,
      workerSubmit,
    });
    const warn = vi.spyOn(console, "warn");

    await expect(
      retryRemoteAgentRoutineFailurePublications({
        db: env.OPENMELD_DB,
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
        db: env.OPENMELD_DB,
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
        db: env.OPENMELD_DB,
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
        db: env.OPENMELD_DB,
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
      readRoutineRunRecord({ db: env.OPENMELD_DB, runId: fixture.runId })
    ).resolves.toMatchObject({ nativeDeliveryId: null, status: "claimed" });
    await expect(
      readRemoteAgentNativeDeliveryByIdempotencyKey({
        db: env.OPENMELD_DB,
        idempotencyKey: fixture.runId,
      })
    ).resolves.toBeNull();
  });

  it("backs off a poison failure publication so a newer Run is not starved", async () => {
    const poison = await seedRoutineDeliveryFixture();
    const healthy = await seedRoutineDeliveryFixture();
    await env.OPENMELD_DB.batch([
      env.OPENMELD_DB.prepare(
        "UPDATE routine_runs SET status = 'failed', failure_code = 'remote_agent.test_failure', failure_detail = 'Poison Space', finished_at_ms = ? WHERE id = ?"
      ).bind(poison.nowMs, poison.runId),
      env.OPENMELD_DB.prepare(
        "UPDATE routine_runs SET status = 'failed', failure_code = 'remote_agent.test_failure', failure_detail = 'Healthy Space', finished_at_ms = ? WHERE id = ?"
      ).bind(healthy.nowMs + 1, healthy.runId),
    ]);
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
        db: env.OPENMELD_DB,
        env: testEnv,
        limit: 1,
        nowMs: retryAtMs,
      })
    ).resolves.toEqual({ errors: 1, published: 0, scanned: 1 });
    await expect(
      env.OPENMELD_DB.prepare(
        "SELECT failure_publication_attempt_count, next_failure_publication_attempt_at_ms FROM routine_runs WHERE id = ?"
      )
        .bind(poison.runId)
        .first()
    ).resolves.toMatchObject({
      failure_publication_attempt_count: 1,
      next_failure_publication_attempt_at_ms: retryAtMs + 60_000,
    });

    await expect(
      retryRemoteAgentRoutineFailurePublications({
        db: env.OPENMELD_DB,
        env: testEnv,
        limit: 1,
        nowMs: retryAtMs,
      })
    ).resolves.toEqual({ errors: 0, published: 1, scanned: 1 });
    await expect(
      readRoutineRunRecord({ db: env.OPENMELD_DB, runId: healthy.runId })
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
      db: env.OPENMELD_DB,
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
        db: env.OPENMELD_DB,
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
        db: env.OPENMELD_DB,
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
        db: env.OPENMELD_DB,
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
        db: env.OPENMELD_DB,
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
      db: env.OPENMELD_DB,
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
        db: env.OPENMELD_DB,
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
      readRoutineRunRecord({ db: env.OPENMELD_DB, runId: fixture.runId })
    ).resolves.toMatchObject({
      failureCode: "remote_agent.routine_identity_mismatch",
      status: "failed",
    });
    await expect(
      readRemoteAgentNativeDeliveryByIdempotencyKey({
        db: env.OPENMELD_DB,
        idempotencyKey: fixture.runId,
      })
    ).resolves.toMatchObject({
      failureCode: "remote_agent.routine_identity_mismatch",
      status: "failed",
      submissionId: null,
      workerSubmitRequest: null,
    });
  });

  it("fails an unconfirmed Routine submission visibly after recovery expires without letting a later callback reopen it", async () => {
    const fixture = await seedRoutineDeliveryFixture();
    const workerSubmitRequest = await buildRoutineWorkerSubmitRequest(fixture);
    await claimRemoteAgentRoutineNativeDelivery({
      bindingId: fixture.bindingId,
      db: env.OPENMELD_DB,
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
        db: env.OPENMELD_DB,
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
        db: env.OPENMELD_DB,
        env: testEnv,
        limit: 1,
        nowMs: fixture.nowMs + 5 * 60_000,
      })
    ).resolves.toEqual({ errors: 0, recovered: 0, scanned: 0 });
    expect(workerSubmit).toHaveBeenCalledTimes(1);

    await expect(
      retryRemoteAgentRoutineSubmissions({
        db: env.OPENMELD_DB,
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
      readRoutineRunRecord({ db: env.OPENMELD_DB, runId: fixture.runId })
    ).resolves.toMatchObject({
      failureCode: "remote_agent.worker_ack_recovery_expired",
      publishedSignalId: fixture.publishedSignalId,
      status: "failed",
    });

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
      readRoutineRunRecord({ db: env.OPENMELD_DB, runId: fixture.runId })
    ).resolves.toMatchObject({
      failureCode: "remote_agent.worker_ack_recovery_expired",
      publishedSignalId: fixture.publishedSignalId,
      status: "failed",
    });
  });

  it("repairs a failed Run with a submitted ledger without replaying the worker", async () => {
    const fixture = await seedRoutineDeliveryFixture();
    const workerSubmitRequest = await buildRoutineWorkerSubmitRequest(fixture);
    await claimRemoteAgentRoutineNativeDelivery({
      bindingId: fixture.bindingId,
      db: env.OPENMELD_DB,
      nowMs: fixture.nowMs,
      organizationId: fixture.organizationId,
      profileId: fixture.profileId,
      routineId: fixture.routineId,
      routineName: fixture.routine.name,
      runId: fixture.runId,
      spaceId: fixture.spaceId,
      workerSubmitRequest,
    });
    await env.OPENMELD_DB.prepare(
      "UPDATE routine_runs SET status = 'failed', failure_code = 'remote_agent.runtime_disabled', failure_detail = 'Remote Agent is disabled for this Organization.', finished_at_ms = ? WHERE id = ?"
    )
      .bind(fixture.nowMs + 1000, fixture.runId)
      .run();
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
        db: env.OPENMELD_DB,
        env: testEnv,
        limit: 1,
        nowMs: fixture.nowMs + 60_000,
      })
    ).resolves.toEqual({ errors: 0, recovered: 1, scanned: 1 });
    expect(workerSubmit).not.toHaveBeenCalled();
    await expect(
      readRemoteAgentNativeDeliveryByIdempotencyKey({
        db: env.OPENMELD_DB,
        idempotencyKey: fixture.runId,
      })
    ).resolves.toMatchObject({
      failureCode: "remote_agent.runtime_disabled",
      status: "flag_rejected",
      workerSubmitRequest: null,
    });
    await expect(
      readRoutineRunRecord({ db: env.OPENMELD_DB, runId: fixture.runId })
    ).resolves.toMatchObject({
      publishedSignalId: null,
      status: "failed",
    });

    await expect(
      retryRemoteAgentRoutineSubmissions({
        db: env.OPENMELD_DB,
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
      db: env.OPENMELD_DB,
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
        db: env.OPENMELD_DB,
        env: testEnv,
        limit: 1,
        nowMs: fixture.nowMs + 60_000,
      })
    ).resolves.toEqual({ errors: 0, recovered: 1, scanned: 1 });
    expect(workerSubmit).not.toHaveBeenCalled();
    await expect(
      readRoutineRunRecord({ db: env.OPENMELD_DB, runId: fixture.runId })
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
      db: env.OPENMELD_DB,
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
        db: env.OPENMELD_DB,
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
      readRoutineRunRecord({ db: env.OPENMELD_DB, runId: fixture.runId })
    ).resolves.toMatchObject({ status: "submitted" });
    await expect(
      readRemoteAgentNativeDeliveryByIdempotencyKey({
        db: env.OPENMELD_DB,
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
        db: env.OPENMELD_DB,
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
        db: env.OPENMELD_DB,
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
      readRoutineRunRecord({ db: env.OPENMELD_DB, runId: fixture.runId })
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
      db: env.OPENMELD_DB,
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
        db: env.OPENMELD_DB,
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
      readRoutineRunRecord({ db: env.OPENMELD_DB, runId: fixture.runId })
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
    "binding_authorization_revoked",
    "target_membership_revoked",
  ] as const)("revalidates full Routine admission before recovery when %s", async (change) => {
    const fixture = await seedRoutineDeliveryFixture();
    const workerSubmitRequest = await buildRoutineWorkerSubmitRequest(fixture);
    await claimRemoteAgentRoutineNativeDelivery({
      bindingId: fixture.bindingId,
      db: env.OPENMELD_DB,
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
      await env.OPENMELD_DB.prepare(
        "UPDATE routines SET status = 'paused', next_due_at = NULL WHERE id = ?"
      )
        .bind(fixture.routineId)
        .run();
    } else if (change === "deleted") {
      await env.OPENMELD_DB.prepare("DELETE FROM routines WHERE id = ?")
        .bind(fixture.routineId)
        .run();
    } else if (change === "center_agent_paused") {
      await env.OPENMELD_DB.prepare(
        "UPDATE center_agent_designations SET operating_state = 'paused', paused_at = ?, paused_by_user_id = ? WHERE organization_id = ?"
      )
        .bind(fixture.nowMs, fixture.userId, fixture.organizationId)
        .run();
    } else if (change === "binding_authorization_revoked") {
      await env.OPENMELD_DB.prepare(
        "DELETE FROM organization_binding_authorizations WHERE organization_id = ? AND binding_id = ?"
      )
        .bind(fixture.organizationId, fixture.bindingId)
        .run();
    } else {
      await env.OPENMELD_DB.prepare(
        "DELETE FROM space_index_memberships WHERE space_id = ? AND profile_id = ?"
      )
        .bind(fixture.spaceId, fixture.profileId)
        .run();
    }

    const workerSubmit = vi.fn();
    const testEnv = buildEnv({ fixture, workerSubmit });
    await expect(
      retryRemoteAgentRoutineSubmissions({
        db: env.OPENMELD_DB,
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
          binding_authorization_revoked:
            "organization_binding_authorization.required",
          target_membership_revoked:
            "remote_agent.routine_target_space_unavailable",
        }[change];
    await expect(
      readRoutineRunRecord({ db: env.OPENMELD_DB, runId: fixture.runId })
    ).resolves.toMatchObject({
      failureCode,
      publishedSignalId: shouldSkip ? null : fixture.publishedSignalId,
      status: shouldSkip ? "skipped" : "failed",
    });
    await expect(
      readRemoteAgentNativeDeliveryByIdempotencyKey({
        db: env.OPENMELD_DB,
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
      await env.OPENMELD_DB.prepare(
        "DELETE FROM center_agent_designations WHERE organization_id = ?"
      )
        .bind(fixture.organizationId)
        .run();
    }
    if (failure === "binding") {
      await env.OPENMELD_DB.prepare(
        "UPDATE openMeldDaemon_agent_profile_bindings SET hosted_runtime_identity_json = '{}' WHERE binding_id = ?"
      )
        .bind(fixture.bindingId)
        .run();
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
        db: env.OPENMELD_DB,
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
      readRoutineRunRecord({ db: env.OPENMELD_DB, runId: fixture.runId })
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
          db: env.OPENMELD_DB,
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
    await env.OPENMELD_DB.prepare(
      "UPDATE openMeldDaemon_agent_profile_bindings SET model_id = ? WHERE binding_id = ?"
    )
      .bind("openrouter/not-in-the-catalog", fixture.bindingId)
      .run();
    const workerSubmit = vi.fn();
    const testEnv = buildEnv({ fixture, workerSubmit });

    await expect(
      submitRemoteAgentRoutineDelivery({
        db: env.OPENMELD_DB,
        env: testEnv,
        nowMs: fixture.nowMs,
        routine: fixture.routine,
        run: fixture.run,
      })
    ).resolves.toEqual({ status: "failed" });

    expect(workerSubmit).not.toHaveBeenCalled();
    await expect(
      readRoutineRunRecord({ db: env.OPENMELD_DB, runId: fixture.runId })
    ).resolves.toMatchObject({
      failureCode: "center_agent_model_unknown",
      failureDetail:
        "The selected Center Agent model is not in the model catalog.",
      status: "failed",
    });
    await expect(
      readRemoteAgentNativeDeliveryByIdempotencyKey({
        db: env.OPENMELD_DB,
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
        text: "Routine “Daily feedback review” could not run because the selected Center Agent model is unavailable. Ask an organization owner or admin to choose an available model in OpenMeld.",
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
  await env.OPENMELD_DB.batch([
    env.OPENMELD_DB.prepare(
      "INSERT INTO users (id, name, email, email_verified, created_at, updated_at) VALUES (?, 'Routine Owner', ?, 1, ?, ?)"
    ).bind(userId, `${userId}@example.com`, nowMs, nowMs),
    env.OPENMELD_DB.prepare(
      "INSERT INTO users (id, name, email, email_verified, created_at, updated_at) VALUES (?, 'Routine Creator', ?, 1, ?, ?)"
    ).bind(creatorUserId, `${creatorUserId}@example.com`, nowMs, nowMs),
    env.OPENMELD_DB.prepare(
      "INSERT INTO organizations (id, name, slug, created_at) VALUES (?, 'Routine Delivery Org', ?, ?)"
    ).bind(organizationId, `routine-delivery-${suffix}`, nowMs),
  ]);
  await env.OPENMELD_DB.batch([
    env.OPENMELD_DB.prepare(
      "INSERT INTO members (id, organization_id, user_id, role, created_at) VALUES (?, ?, ?, 'owner', ?)"
    ).bind(`member_${suffix}`, organizationId, userId, nowMs),
    env.OPENMELD_DB.prepare(
      "INSERT INTO members (id, organization_id, user_id, role, created_at) VALUES (?, ?, ?, 'member', ?)"
    ).bind(creatorMemberId, organizationId, creatorUserId, nowMs),
    env.OPENMELD_DB.prepare(
      `
        INSERT INTO openmeld_profiles (
          profile_id, profile_name, profile_handle, profile_kind, is_default,
          status, organization_id, owner_user_id, created_by_user_id, source,
          managed_role, created_at, updated_at
        ) VALUES (?, 'Routine Creator', ?, 'human', 1, 'active', NULL, ?, ?,
          'auth_bootstrap', NULL, ?, ?)
      `
    ).bind(
      creatorProfileId,
      `routine-creator-${suffix}`,
      creatorUserId,
      creatorUserId,
      nowMs,
      nowMs
    ),
    env.OPENMELD_DB.prepare(
      `
        INSERT INTO openmeld_profiles (
          profile_id, profile_name, profile_handle, profile_kind, is_default,
          status, organization_id, owner_user_id, created_by_user_id, source,
          managed_role, created_at, updated_at
        ) VALUES (?, 'Routine Center Agent', ?, 'agent', 0, 'active', ?, ?, ?,
          'auth_bootstrap', 'center_agent', ?, ?)
      `
    ).bind(
      profileId,
      `routine-center-agent-${suffix}`,
      organizationId,
      userId,
      userId,
      nowMs,
      nowMs
    ),
    env.OPENMELD_DB.prepare(
      "INSERT INTO center_agent_designations (organization_id, agent_profile_id, duty, designated_by, created_at) VALUES (?, ?, NULL, ?, ?)"
    ).bind(organizationId, profileId, userId, nowMs),
    env.OPENMELD_DB.prepare(
      `
        INSERT INTO space_index_spaces (
          space_id, organization_id, organization_visibility, status, space_name,
          source_updated_at_ms, projected_at_ms, projection_event_id
        ) VALUES (?, ?, 'private', 'active', 'Feedback Triage', ?, ?, ?)
      `
    ).bind(spaceId, organizationId, nowMs, nowMs, `projection_${suffix}`),
    env.OPENMELD_DB.prepare(
      `
        INSERT INTO space_index_memberships (
          space_id, profile_id, profile_kind_snapshot, profile_name_snapshot,
          owner_user_id_snapshot, controller_ref_snapshot, status, member_source,
          added_at_ms, source_updated_at_ms, projected_at_ms, projection_event_id
        ) VALUES (?, ?, 'agent', 'Routine Center Agent', ?, ?, 'active',
          'member_add', ?, ?, ?, ?)
      `
    ).bind(
      spaceId,
      profileId,
      userId,
      HOSTED_CENTER_AGENT_CONTROLLER_REF,
      nowMs,
      nowMs,
      nowMs,
      `membership_projection_${suffix}`
    ),
  ]);
  await env.OPENMELD_DB.batch([
    env.OPENMELD_DB.prepare(
      `
        INSERT INTO openMeldDaemon_agent_profile_bindings (
          binding_id, owner_kind, owner_id, agent_profile_id,
          openmeld_service_runtime_id, runtime_kind, hosted_runtime_identity_json,
          agent_controller_ref, agent_controller_conversation_id, binding_state,
          created_at_ms, updated_at_ms
        ) VALUES (?, 'owner_account', ?, ?, ?, 'hosted_center_agent', ?, ?,
          'center-agent', 'enabled_primary', ?, ?)
      `
    ).bind(
      bindingId,
      userId,
      profileId,
      HOSTED_CENTER_AGENT_LOGICAL_RUNTIME_ID,
      JSON.stringify(HOSTED_CENTER_AGENT_RUNTIME_IDENTITY),
      HOSTED_CENTER_AGENT_CONTROLLER_REF,
      nowMs,
      nowMs
    ),
    env.OPENMELD_DB.prepare(
      "INSERT INTO routines (id, organization_id, name, instructions, external_action_policy, schedule_kind, cron_expression, timezone, target_space_id, status, next_due_at, created_by_user_id, updated_by_user_id, created_at_ms, updated_at_ms) VALUES (?, ?, 'Daily feedback review', 'Review every open Feedback Issue.', 'read_only', 'cron', '0 12 * * *', 'UTC', ?, 'enabled', ?, ?, ?, ?, ?)"
    ).bind(
      routineId,
      organizationId,
      spaceId,
      nowMs + 24 * 60 * 60 * 1000,
      creatorUserId,
      creatorUserId,
      nowMs - 1000,
      nowMs - 1000
    ),
    env.OPENMELD_DB.prepare(
      "INSERT INTO routine_runs (id, routine_id, organization_id, scheduled_for, status, routine_name_snapshot, target_space_id_snapshot, started_at_ms) VALUES (?, ?, ?, ?, 'claimed', 'Daily feedback review', ?, ?)"
    ).bind(runId, routineId, organizationId, nowMs, spaceId, nowMs),
  ]);
  await env.OPENMELD_DB.prepare(
    "INSERT INTO organization_binding_authorizations (id, organization_id, binding_id, authorized_by, created_at) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(`authorization_${suffix}`, organizationId, bindingId, userId, nowMs)
    .run();
  const routine = {
    authorizedActions: [],
    createdAtMs: nowMs - 1000,
    createdByUserId: creatorUserId,
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
  const run = await readRoutineRunRecord({ db: env.OPENMELD_DB, runId });
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
  dailyAdmissionLimit?: string;
  fixture: Awaited<ReturnType<typeof seedRoutineDeliveryFixture>>;
  routineWorkflowSendEvent?: ReturnType<typeof vi.fn>;
  runtimeEnabled?: string;
  spaceGuide?: string;
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
          ownerUserId: input.fixture.userId,
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
    OPENMELD_DB: env.OPENMELD_DB,
    OPENMELD_LOCAL_STATE_DB: env.OPENMELD_DB,
    OPENMELD_REMOTE_AGENT_DAILY_ADMISSION_LIMIT: input.dailyAdmissionLimit,
    OPENMELD_REMOTE_AGENT_RUNTIME_ENABLED: input.runtimeEnabled ?? "true",
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
    db: env.OPENMELD_DB,
    delegatedMember: {
      displayName: "Routine Creator",
      memberId: fixture.creatorMemberId,
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

  const membership = await env.OPENMELD_DB.prepare(
    "SELECT id, role FROM members WHERE organization_id = ? AND user_id = ? LIMIT 1"
  )
    .bind(fixture.organizationId, fixture.creatorUserId)
    .first<{ id: string; role: "admin" | "member" | "owner" }>();

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
    rememberFactForOrganization: vi.fn(async () => undefined),
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
  await env.OPENMELD_DB.batch([
    env.OPENMELD_DB.prepare(
      `
        INSERT INTO space_index_spaces (
          space_id, organization_id, organization_visibility, status, space_name,
          source_updated_at_ms, projected_at_ms, projection_event_id
        ) VALUES (?, ?, 'private', 'active', ?, ?, ?, ?)
      `
    ).bind(
      spaceId,
      input.fixture.organizationId,
      input.spaceName ?? "Future Routine Target",
      input.fixture.nowMs,
      input.fixture.nowMs,
      `projection_${projectionSuffix}`
    ),
    env.OPENMELD_DB.prepare(
      `
        INSERT INTO space_index_memberships (
          space_id, profile_id, profile_kind_snapshot, profile_name_snapshot,
          owner_user_id_snapshot, controller_ref_snapshot, status, member_source,
          added_at_ms, source_updated_at_ms, projected_at_ms, projection_event_id
        ) VALUES (?, ?, 'agent', 'Routine Center Agent', ?, ?, 'active',
          'member_add', ?, ?, ?, ?)
      `
    ).bind(
      spaceId,
      input.fixture.profileId,
      input.fixture.userId,
      HOSTED_CENTER_AGENT_CONTROLLER_REF,
      input.fixture.nowMs,
      input.fixture.nowMs,
      input.fixture.nowMs,
      `membership_projection_${projectionSuffix}`
    ),
  ]);
  return spaceId;
}

async function cleanupOwnedRoutineRows(): Promise<void> {
  const cleanupErrors: Error[] = [];

  for (const organizationId of ownedRoutineOrganizationIds) {
    const cleanupSteps = [
      [
        "Agent Task outcome rows",
        env.OPENMELD_DB.prepare(
          `
            DELETE FROM agent_task_terminal_outcomes
            WHERE json_extract(task_handle_json, '$.deliveryId') IN (
              SELECT delivery_id
              FROM openMeldRemoteAgent_native_delivery_ledger
              WHERE organization_id = ?
            )
          `
        ).bind(organizationId),
      ],
      [
        "Agent Task subscriptions",
        env.OPENMELD_DB.prepare(
          "DELETE FROM agent_task_completion_subscriptions WHERE organization_id = ?"
        ).bind(organizationId),
      ],
      [
        "daily admission rows",
        env.OPENMELD_DB.prepare(
          'DELETE FROM "openMeldRemoteAgent_daily_admissions" WHERE organization_id = ?'
        ).bind(organizationId),
      ],
      [
        "native delivery rows",
        env.OPENMELD_DB.prepare(
          'DELETE FROM "openMeldRemoteAgent_native_delivery_ledger" WHERE organization_id = ?'
        ).bind(organizationId),
      ],
      [
        "Routine Run rows",
        env.OPENMELD_DB.prepare(
          "DELETE FROM routine_runs WHERE organization_id = ?"
        ).bind(organizationId),
      ],
      [
        "Routine rows",
        env.OPENMELD_DB.prepare(
          "DELETE FROM routines WHERE organization_id = ?"
        ).bind(organizationId),
      ],
    ] as const;

    for (const [description, statement] of cleanupSteps) {
      try {
        await statement.run();
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
