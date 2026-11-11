import type { PostgresDatabase } from "@openmeld/db/postgresql";
import type { OpenMeldRequestContext } from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import {
  rpcAgentProfileExecutionMode,
  rpcExecuteAgentProfileWorkRecovery,
} from "../src/rpc/methods";
import {
  createPostgresHarness,
  postgresTestBinding,
} from "./helpers/postgresql-harness.test-support";

const AGENT_PROFILE_ID = "agt_11111111-1111-4111-8111-111111111111";
const SPACE_ID = "a".repeat(64);
const TARGET_WAKE_LIFECYCLE_ID = "twl_interrupted";
type ResolveProfileByIdRpc = NonNullable<
  NonNullable<CoreBindings["OPENMELD_AUTH_WORKER"]>["resolveProfileById"]
>;
const CONTEXT: OpenMeldRequestContext = {
  activeOrganizationId: "org-1",
  actorContext: {
    openMeldProfileId: "11111111-1111-4111-8111-111111111111",
    ownerUserId: "owner-1",
    profileKind: "human",
    profileName: "Mira",
    requestId: "req-work-recovery",
  },
};

describe("Agent Profile work recovery Core RPC", () => {
  it("applies serial admission only through current Organization owner authorization", async () => {
    const harness = await createRecoveryHarness();
    const runtimeTransportStub = createRuntimeTransportStub();
    const env = createEnv({ db: harness.db, runtimeTransportStub });
    try {
      for (const context of [
        { ...CONTEXT, activeOrganizationId: "org-2" },
        {
          ...CONTEXT,
          actorContext: { ...CONTEXT.actorContext, ownerUserId: "other-owner" },
        },
      ]) {
        await expect(
          rpcAgentProfileExecutionMode(env, {
            agentProfileId: AGENT_PROFILE_ID,
            body: { mode: "serial" },
            context,
          })
        ).rejects.toThrow();
      }
      expect(
        runtimeTransportStub.rpcAgentProfileExecutionMode
      ).not.toHaveBeenCalled();
      await expect(
        rpcAgentProfileExecutionMode(env, {
          agentProfileId: AGENT_PROFILE_ID,
          body: { mode: "serial" },
          context: CONTEXT,
        })
      ).resolves.toMatchObject({ mode: "serial", migration: "contexts" });
      expect(
        runtimeTransportStub.rpcAgentProfileExecutionMode
      ).toHaveBeenCalledWith({
        ownerUserId: "owner-1",
        targetProfileId: AGENT_PROFILE_ID,
        mode: "serial",
      });
    } finally {
      await harness.close();
    }
  });
  it("rejects requests outside the Profile's canonical Organization before reading recovery state", async () => {
    const harness = await createRecoveryHarness();
    const runtimeTransportStub = createRuntimeTransportStub();
    try {
      await expect(
        rpcExecuteAgentProfileWorkRecovery(
          createEnv({ db: harness.db, runtimeTransportStub }),
          {
            agentProfileId: AGENT_PROFILE_ID,
            body: {
              action: "approve_queued_work",
              expectedInterruptedTargetWakeLifecycleId:
                TARGET_WAKE_LIFECYCLE_ID,
            },
            context: {
              ...CONTEXT,
              activeOrganizationId: "org-2",
            },
          }
        )
      ).rejects.toMatchObject({
        cause: {
          code: "agent_profile.organization_mismatch",
          status: 403,
        },
      });
      expect(
        runtimeTransportStub.rpcReadAgentProfileWorkRecovery
      ).not.toHaveBeenCalled();
    } finally {
      await harness.close();
    }
  });

  it("rejects a non-owner before reading recovery state", async () => {
    const harness = await createRecoveryHarness();
    const runtimeTransportStub = createRuntimeTransportStub();
    try {
      await expect(
        rpcExecuteAgentProfileWorkRecovery(
          createEnv({ db: harness.db, runtimeTransportStub }),
          {
            agentProfileId: AGENT_PROFILE_ID,
            body: {
              action: "approve_queued_work",
              expectedInterruptedTargetWakeLifecycleId:
                TARGET_WAKE_LIFECYCLE_ID,
            },
            context: {
              ...CONTEXT,
              actorContext: {
                ...CONTEXT.actorContext,
                ownerUserId: "other-owner",
              },
            },
          }
        )
      ).rejects.toMatchObject({
        cause: {
          code: "agent_profile.not_found",
          status: 404,
        },
      });
      expect(
        runtimeTransportStub.rpcReadAgentProfileWorkRecovery
      ).not.toHaveBeenCalled();
    } finally {
      await harness.close();
    }
  });

  it("fails closed before reading recovery state when Auth omits Organization scope", async () => {
    const harness = await createRecoveryHarness();
    const runtimeTransportStub = createRuntimeTransportStub();
    try {
      await expect(
        rpcExecuteAgentProfileWorkRecovery(
          createEnv({
            authResolveProfileById: vi.fn(async () => ({
              ok: true as const,
              profile: {
                ownerUserId: "owner-1",
                profileHandle: "agent-one",
                profileId: AGENT_PROFILE_ID,
                profileKind: "agent" as const,
                profileName: "Agent One",
                status: "active" as const,
              },
            })),
            db: harness.db,
            runtimeTransportStub,
          }),
          {
            agentProfileId: AGENT_PROFILE_ID,
            body: {
              action: "approve_queued_work",
              expectedInterruptedTargetWakeLifecycleId:
                TARGET_WAKE_LIFECYCLE_ID,
            },
            context: CONTEXT,
          }
        )
      ).rejects.toMatchObject({
        cause: {
          code: "agent_profile.unavailable",
          status: 503,
        },
      });
      expect(
        runtimeTransportStub.rpcReadAgentProfileWorkRecovery
      ).not.toHaveBeenCalled();
    } finally {
      await harness.close();
    }
  });

  it.each([
    {
      bodyAction: "approve_queued_work" as const,
      recovery: { status: "not_pending" as const },
      scenario: "stale action",
    },
    {
      bodyAction: "continue_interrupted_work" as const,
      recovery: buildAvailableRecovery({ action: "approve_queued_work" }),
      scenario: "mismatched action",
    },
    {
      bodyAction: "continue_interrupted_work" as const,
      recovery: buildAvailableRecovery({ action: "fork_interrupted_work" }),
      scenario: "Continue without a saved Fork choice",
    },
    ...(
      [
        "approve_queued_work",
        "continue_interrupted_work",
        "skip_interrupted_work",
        "fork_interrupted_work",
      ] as const
    ).map((action) => ({
      bodyAction: action,
      recovery: {
        ...buildAvailableRecovery({ action }),
        interruptedTargetWakeLifecycleId: "twl_newer_recovery",
      },
      scenario: `old ${action} against newer interrupted work`,
    })),
  ])("returns 409 for a $scenario", async ({ bodyAction, recovery }) => {
    const harness = await createRecoveryHarness();
    const runtimeTransportStub = createRuntimeTransportStub({ recovery });
    try {
      await expect(
        rpcExecuteAgentProfileWorkRecovery(
          createEnv({ db: harness.db, runtimeTransportStub }),
          {
            agentProfileId: AGENT_PROFILE_ID,
            body: {
              action: bodyAction,
              expectedInterruptedTargetWakeLifecycleId:
                TARGET_WAKE_LIFECYCLE_ID,
            },
            context: CONTEXT,
          }
        )
      ).rejects.toMatchObject({
        cause: {
          code: "agent_profile_work_recovery.not_pending",
          status: 409,
        },
      });
      expect(
        runtimeTransportStub.rpcReadAgentProfileWorkRecovery
      ).toHaveBeenCalledOnce();
      expect(
        runtimeTransportStub.rpcApproveAgentProfileWorkQueue
      ).not.toHaveBeenCalled();
      expect(
        runtimeTransportStub.rpcAuthorizeAgentProfileWorkContinuation
      ).not.toHaveBeenCalled();
      expect(
        runtimeTransportStub.rpcSkipAgentProfileInterruptedWork
      ).not.toHaveBeenCalled();
      expect(
        runtimeTransportStub.rpcRequestAgentProfileWorkLocalAttemptWithdrawal
      ).not.toHaveBeenCalled();
    } finally {
      await harness.close();
    }
  });

  it.each([
    false,
    true,
  ])("approves queued work from Auth scope despite a conflicting Core profile row (transient read: %s)", async (transientRead) => {
    const harness = await createRecoveryHarness();
    const runtimeTransportStub = createRuntimeTransportStub({
      recovery: buildAvailableRecovery({ action: "approve_queued_work" }),
    });
    const brokenStub = createRuntimeTransportStub();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const firstReadFailed = Promise.withResolvers<void>();
    brokenStub.rpcReadAgentProfileWorkRecovery.mockImplementation(() => {
      firstReadFailed.resolve();
      return Promise.reject(
        Object.assign(new Error("Transient owner-shard failure"), {
          retryable: true,
        })
      );
    });
    try {
      await harness.query({
        values: ["org-stale", "stale-owner", AGENT_PROFILE_ID],
        text: `UPDATE "openmeld"."openmeld_profiles"
          SET organization_id = $1, owner_user_id = $2
          WHERE profile_id = $3`,
      });
      if (transientRead) {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      }
      const result = expect(
        rpcExecuteAgentProfileWorkRecovery(
          createEnv({
            db: harness.db,
            runtimeTransportStub,
            ...(transientRead ? { firstRuntimeTransportStub: brokenStub } : {}),
          }),
          {
            agentProfileId: AGENT_PROFILE_ID,
            body: {
              action: "approve_queued_work",
              expectedInterruptedTargetWakeLifecycleId:
                TARGET_WAKE_LIFECYCLE_ID,
            },
            context: CONTEXT,
          }
        )
      ).resolves.toEqual({
        action: "approve_queued_work",
        status: "accepted",
      });
      if (transientRead) {
        await firstReadFailed.promise;
        await vi.advanceTimersByTimeAsync(1000);
        expect(
          brokenStub.rpcReadAgentProfileWorkRecovery
        ).toHaveBeenCalledOnce();
        expect(
          brokenStub.rpcApproveAgentProfileWorkQueue
        ).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalledWith(
          "[core.runtime_transport.read_attempt_failed]",
          expect.objectContaining({
            operation: "rpcReadAgentProfileWorkRecovery",
            requestId: CONTEXT.actorContext.requestId,
            decision: "retry",
          })
        );
      }
      await result;
      expect(
        runtimeTransportStub.rpcReadAgentProfileWorkRecovery
      ).toHaveBeenCalledExactlyOnceWith({
        ownerUserId: "owner-1",
        targetProfileId: AGENT_PROFILE_ID,
      });
      expect(
        runtimeTransportStub.rpcApproveAgentProfileWorkQueue
      ).toHaveBeenCalledOnce();
      expect(
        runtimeTransportStub.rpcApproveAgentProfileWorkQueue
      ).toHaveBeenCalledWith({
        expectedInterruptedTargetWakeLifecycleId: TARGET_WAKE_LIFECYCLE_ID,
        ownerUserId: "owner-1",
        targetProfileId: AGENT_PROFILE_ID,
      });
    } finally {
      vi.useRealTimers();
      warn.mockRestore();
      await harness.close();
    }
  });

  it("does not replay a recovery approval when its write fails", async () => {
    const harness = await createRecoveryHarness();
    const runtimeTransportStub = createRuntimeTransportStub({
      recovery: buildAvailableRecovery({ action: "approve_queued_work" }),
    });
    const failure = Object.assign(new Error("Approval outcome unavailable"), {
      retryable: true,
    });
    runtimeTransportStub.rpcApproveAgentProfileWorkQueue.mockRejectedValue(
      failure
    );
    try {
      await expect(
        rpcExecuteAgentProfileWorkRecovery(
          createEnv({ db: harness.db, runtimeTransportStub }),
          {
            agentProfileId: AGENT_PROFILE_ID,
            body: {
              action: "approve_queued_work",
              expectedInterruptedTargetWakeLifecycleId:
                TARGET_WAKE_LIFECYCLE_ID,
            },
            context: CONTEXT,
          }
        )
      ).rejects.toBe(failure);
      expect(
        runtimeTransportStub.rpcReadAgentProfileWorkRecovery
      ).toHaveBeenCalledOnce();
      expect(
        runtimeTransportStub.rpcApproveAgentProfileWorkQueue
      ).toHaveBeenCalledOnce();
    } finally {
      await harness.close();
    }
  });

  it("skips interrupted work through the owner Hub", async () => {
    const harness = await createRecoveryHarness();
    const runtimeTransportStub = createRuntimeTransportStub({
      recovery: buildAvailableRecovery({ action: "skip_interrupted_work" }),
    });
    try {
      await expect(
        rpcExecuteAgentProfileWorkRecovery(
          createEnv({ db: harness.db, runtimeTransportStub }),
          {
            agentProfileId: AGENT_PROFILE_ID,
            body: {
              action: "skip_interrupted_work",
              expectedInterruptedTargetWakeLifecycleId:
                TARGET_WAKE_LIFECYCLE_ID,
            },
            context: CONTEXT,
          }
        )
      ).resolves.toEqual({
        action: "skip_interrupted_work",
        status: "accepted",
      });
      expect(
        runtimeTransportStub.rpcSkipAgentProfileInterruptedWork
      ).toHaveBeenCalledOnce();
      expect(
        runtimeTransportStub.rpcSkipAgentProfileInterruptedWork
      ).toHaveBeenCalledWith({
        expectedInterruptedTargetWakeLifecycleId: TARGET_WAKE_LIFECYCLE_ID,
        ownerUserId: "owner-1",
        targetProfileId: AGENT_PROFILE_ID,
      });
    } finally {
      await harness.close();
    }
  });

  it.each([
    "approve_queued_work",
    "continue_interrupted_work",
    "skip_interrupted_work",
    "fork_interrupted_work",
  ] as const)("rejects unfenced %s before reading or mutating owner state", async (action) => {
    const harness = await createRecoveryHarness();
    const runtimeTransportStub = createRuntimeTransportStub({
      recovery: buildAvailableRecovery({ action }),
    });
    try {
      await expect(
        rpcExecuteAgentProfileWorkRecovery(
          createEnv({ db: harness.db, runtimeTransportStub }),
          {
            agentProfileId: AGENT_PROFILE_ID,
            body: { action } as never,
            context: CONTEXT,
          }
        )
      ).rejects.toMatchObject({
        cause: { code: "invalid_payload", status: 400 },
      });
      expect(
        runtimeTransportStub.rpcReadAgentProfileWorkRecovery
      ).not.toHaveBeenCalled();
      expect(
        runtimeTransportStub.rpcSkipAgentProfileInterruptedWork
      ).not.toHaveBeenCalled();
    } finally {
      await harness.close();
    }
  });

  it("authorizes one deterministic continuation identity before asking Space to start it", async () => {
    const harness = await createRecoveryHarness();
    const callOrder: string[] = [];
    let authorizedContinuationClientMessageId: string | null = null;
    const runtimeTransportStub = createRuntimeTransportStub({
      recovery: () =>
        buildAvailableRecovery({
          action: "continue_interrupted_work",
          authorizedContinuationClientMessageId,
        }),
    });
    runtimeTransportStub.rpcAuthorizeAgentProfileWorkContinuation.mockImplementation(
      (input: { continuationClientMessageId: string }) => {
        callOrder.push("authorize");
        authorizedContinuationClientMessageId =
          input.continuationClientMessageId;
        return Promise.resolve({ status: "authorized" as const });
      }
    );
    const startedContinuations: unknown[] = [];
    const spaceStub = {
      rpcExecuteExecutionRecovery: vi.fn(),
      rpcInspectExecutionRecovery: vi.fn(),
      rpcStartUsageExhaustedContinuation: vi.fn(
        (continuation: Record<string, unknown>) => {
          callOrder.push("start");
          startedContinuations.push(continuation);
          return Promise.resolve({
            continuationClientMessageId: String(
              continuation.continuationClientMessageId
            ),
            operationId: String(continuation.operationId),
            status: "started" as const,
          });
        }
      ),
    };
    const env = createEnv({ db: harness.db, runtimeTransportStub, spaceStub });
    const input = {
      agentProfileId: AGENT_PROFILE_ID,
      body: {
        action: "continue_interrupted_work" as const,
        expectedInterruptedTargetWakeLifecycleId: TARGET_WAKE_LIFECYCLE_ID,
      },
      context: CONTEXT,
    };
    try {
      await expect(
        rpcExecuteAgentProfileWorkRecovery(env, input)
      ).resolves.toEqual({
        action: "continue_interrupted_work",
        status: "accepted",
      });
      await expect(
        rpcExecuteAgentProfileWorkRecovery(env, input)
      ).resolves.toEqual({
        action: "continue_interrupted_work",
        status: "accepted",
      });

      expect(callOrder).toEqual(["authorize", "start", "start"]);
      expect(
        runtimeTransportStub.rpcAuthorizeAgentProfileWorkContinuation
      ).toHaveBeenCalledOnce();
      expect(startedContinuations).toHaveLength(2);
      expect(startedContinuations[0]).toEqual(startedContinuations[1]);
      expect(startedContinuations[0]).toMatchObject({
        interruptedClientMessageId: "client-interrupted",
        interruptedDispatchId: "dispatch-interrupted",
        interruptedSourceSignalId: "signal-interrupted",
        operationId:
          "agent-profile-work-continuation:5da1ee755432c68f046b7b774852d3f589118fa5c83839da03807fdde2423430",
        spaceId: SPACE_ID,
        targetProfileId: AGENT_PROFILE_ID,
      });
      expect(
        runtimeTransportStub.rpcAuthorizeAgentProfileWorkContinuation
      ).toHaveBeenCalledWith({
        continuationClientMessageId:
          "agent-profile-work-continuation-5da1ee755432c68f046b7b774852d3f589118fa5c83839da03807fdde2423430",
        currentAgentControllerRef: "builtin:codex",
        currentBindingId: "binding-1",
        currentConfigurationRevision: 1,
        currentDefaultProjectId: "project-a",
        expectedInterruptedTargetWakeLifecycleId: TARGET_WAKE_LIFECYCLE_ID,
        ownerUserId: "owner-1",
        requireAcceptedExecutionTargetRevision: true,
        targetProfileId: AGENT_PROFILE_ID,
      });
      expect(spaceStub.rpcStartUsageExhaustedContinuation).toHaveBeenCalledWith(
        expect.objectContaining({
          continuationClientMessageId:
            "agent-profile-work-continuation-5da1ee755432c68f046b7b774852d3f589118fa5c83839da03807fdde2423430",
          spaceAccess: expect.objectContaining({
            actor: expect.objectContaining({
              dispatchId: "dispatch-interrupted",
              kind: "dispatch_continuation",
              sourceSignalId: "signal-interrupted",
              targetProfileId: AGENT_PROFILE_ID,
            }),
          }),
        })
      );
      expect(spaceStub.rpcInspectExecutionRecovery).not.toHaveBeenCalled();
      expect(spaceStub.rpcExecuteExecutionRecovery).not.toHaveBeenCalled();
    } finally {
      await harness.close();
    }
  });

  it("defers a continuation from an older owner shard before any Space side effect", async () => {
    const harness = await createRecoveryHarness();
    const recovery = buildAvailableRecovery({
      action: "continue_interrupted_work",
    });
    const {
      interruptedSourceSignalId: _missingOnOlderShard,
      ...legacyRecovery
    } = recovery;
    const runtimeTransportStub = createRuntimeTransportStub({
      recovery: legacyRecovery,
    });
    const spaceGet = vi.fn();
    const env = {
      ...createEnv({ db: harness.db, runtimeTransportStub }),
      OPENMELD_SPACES: {
        get: spaceGet,
        idFromString: vi.fn((value: string) => value),
      },
    } as unknown as CoreBindings;
    try {
      await expect(
        rpcExecuteAgentProfileWorkRecovery(env, {
          agentProfileId: AGENT_PROFILE_ID,
          body: {
            action: "continue_interrupted_work",
            expectedInterruptedTargetWakeLifecycleId: TARGET_WAKE_LIFECYCLE_ID,
          },
          context: CONTEXT,
        })
      ).rejects.toMatchObject({
        cause: {
          code: "agent_profile_work_recovery.temporarily_unavailable",
          status: 503,
        },
      });
      expect(spaceGet).not.toHaveBeenCalled();
      expect(
        runtimeTransportStub.rpcAuthorizeAgentProfileWorkContinuation
      ).not.toHaveBeenCalled();
    } finally {
      await harness.close();
    }
  });

  it.each([
    "owner",
    "requester",
    "other-task",
  ] as const)("scopes occupied work skip to %s", async (actor) => {
    const harness = await createRecoveryHarness();
    const runtimeTransportStub = createRuntimeTransportStub({
      recovery: buildAvailableRecovery({ action: "fork_interrupted_work" }),
    });
    const spaceStub = {
      rpcInputQueue: vi.fn(async () => ({
        items: [],
        recoveries:
          actor === "requester"
            ? [
                {
                  targetProfileId: AGENT_PROFILE_ID,
                  profileName: "Agent One",
                  action: "fork_interrupted_work" as const,
                  expectedInterruptedTargetWakeLifecycleId:
                    TARGET_WAKE_LIFECYCLE_ID,
                },
              ]
            : [],
      })),
    };
    try {
      const result = rpcExecuteAgentProfileWorkRecovery(
        createEnv({ db: harness.db, runtimeTransportStub, spaceStub }),
        {
          agentProfileId: AGENT_PROFILE_ID,
          body: {
            action: "skip_interrupted_work",
            ...(actor !== "owner" ? { spaceId: SPACE_ID } : {}),
            expectedInterruptedTargetWakeLifecycleId: TARGET_WAKE_LIFECYCLE_ID,
          },
          context:
            actor === "owner"
              ? CONTEXT
              : {
                  ...CONTEXT,
                  actorContext: {
                    ...CONTEXT.actorContext,
                    ownerUserId: "requester-owner",
                  },
                },
        }
      );
      if (actor === "other-task") {
        await expect(result).rejects.toMatchObject({
          code: "agent_profile_work_recovery.not_allowed",
        });
        expect(
          runtimeTransportStub.rpcSkipAgentProfileInterruptedWork
        ).not.toHaveBeenCalled();
        expect(
          runtimeTransportStub.rpcRequestAgentProfileWorkLocalAttemptWithdrawal
        ).not.toHaveBeenCalled();
        return;
      }
      await expect(result).resolves.toEqual({
        action: "skip_interrupted_work",
        status: "accepted",
      });
      expect(
        runtimeTransportStub.rpcSkipAgentProfileInterruptedWork
      ).toHaveBeenCalledOnce();
      expect(
        runtimeTransportStub.rpcSkipAgentProfileInterruptedWork
      ).toHaveBeenCalledWith({
        requesterProfileId:
          actor === "requester"
            ? CONTEXT.actorContext.openMeldProfileId
            : undefined,
        expectedInterruptedTargetWakeLifecycleId: TARGET_WAKE_LIFECYCLE_ID,
        ownerUserId: "owner-1",
        targetProfileId: AGENT_PROFILE_ID,
      });
      // Skip tells the owner the work will not continue, so it also asks the
      // computer to withdraw the attempt rather than leaving it able to start.
      expect(
        runtimeTransportStub.rpcRequestAgentProfileWorkLocalAttemptWithdrawal
      ).toHaveBeenCalledWith({
        expectedInterruptedTargetWakeLifecycleId: TARGET_WAKE_LIFECYCLE_ID,
        ownerUserId: "owner-1",
        targetProfileId: AGENT_PROFILE_ID,
      });
    } finally {
      await harness.close();
    }
  });

  it("still skips the work when the withdrawal request cannot be delivered", async () => {
    const harness = await createRecoveryHarness();
    const runtimeTransportStub = createRuntimeTransportStub({
      recovery: buildAvailableRecovery({ action: "fork_interrupted_work" }),
    });
    runtimeTransportStub.rpcRequestAgentProfileWorkLocalAttemptWithdrawal.mockRejectedValue(
      new Error("owner shard unavailable")
    );
    try {
      await expect(
        rpcExecuteAgentProfileWorkRecovery(
          createEnv({ db: harness.db, runtimeTransportStub }),
          {
            agentProfileId: AGENT_PROFILE_ID,
            body: {
              action: "skip_interrupted_work",
              expectedInterruptedTargetWakeLifecycleId:
                TARGET_WAKE_LIFECYCLE_ID,
            },
            context: CONTEXT,
          }
        )
      ).resolves.toEqual({
        action: "skip_interrupted_work",
        status: "accepted",
      });
      expect(
        runtimeTransportStub.rpcSkipAgentProfileInterruptedWork
      ).toHaveBeenCalledOnce();
    } finally {
      await harness.close();
    }
  });

  it("persists fork intent across continuation retry after initial Space creation failure", async () => {
    const harness = await createRecoveryHarness();
    let currentRecovery = buildAvailableRecovery({
      action: "fork_interrupted_work",
    });
    const runtimeTransportStub = createRuntimeTransportStub({
      recovery: () => currentRecovery,
    });
    runtimeTransportStub.rpcAuthorizeAgentProfileWorkContinuation.mockImplementation(
      (input) => {
        currentRecovery = {
          ...buildAvailableRecovery({
            action: "fork_interrupted_work",
            authorizedContinuationClientMessageId:
              input.continuationClientMessageId,
            forkInterruptedConversation: true,
          }),
        };
        return Promise.resolve({ status: "authorized" as const });
      }
    );

    let spaceCallCount = 0;
    const startedContinuations: Record<string, unknown>[] = [];
    const spaceStub = {
      rpcExecuteExecutionRecovery: vi.fn(),
      rpcInspectExecutionRecovery: vi.fn(),
      rpcStartUsageExhaustedContinuation: vi.fn(
        (continuation: Record<string, unknown>) => {
          spaceCallCount++;
          if (spaceCallCount === 1) {
            return Promise.reject(new Error("temporary space failure"));
          }
          startedContinuations.push(continuation);
          return Promise.resolve({
            continuationClientMessageId: String(
              continuation.continuationClientMessageId
            ),
            operationId: String(continuation.operationId),
            status: "started" as const,
          });
        }
      ),
    };
    const env = createEnv({ db: harness.db, runtimeTransportStub, spaceStub });

    try {
      // First attempt: user triggers fork, authorization succeeds on Hub, but Space start fails
      await expect(
        rpcExecuteAgentProfileWorkRecovery(env, {
          agentProfileId: AGENT_PROFILE_ID,
          body: {
            action: "fork_interrupted_work",
            expectedInterruptedTargetWakeLifecycleId: TARGET_WAKE_LIFECYCLE_ID,
          },
          context: CONTEXT,
        })
      ).rejects.toThrow("temporary space failure");

      expect(
        runtimeTransportStub.rpcAuthorizeAgentProfileWorkContinuation
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          forkInterruptedConversation: true,
        })
      );

      // Second attempt (retry / page refresh): client retries with continue_interrupted_work
      await expect(
        rpcExecuteAgentProfileWorkRecovery(env, {
          agentProfileId: AGENT_PROFILE_ID,
          body: {
            action: "continue_interrupted_work",
            expectedInterruptedTargetWakeLifecycleId: TARGET_WAKE_LIFECYCLE_ID,
          },
          context: CONTEXT,
        })
      ).resolves.toEqual({
        action: "continue_interrupted_work",
        status: "accepted",
      });

      // Assert Space received contextSelection mode: "fork" on retry
      expect(startedContinuations).toHaveLength(1);
      expect(startedContinuations[0]).toMatchObject({
        contextSelection: {
          mode: "fork",
          sourceWakeId: TARGET_WAKE_LIFECYCLE_ID,
        },
      });
    } finally {
      await harness.close();
    }
  });

  it("withholds the replacement branch until the original attempt is confirmed stopped", async () => {
    const harness = await createRecoveryHarness();
    const runtimeTransportStub = createRuntimeTransportStub({
      localAttemptWithdrawal: "requested",
      recovery: buildAvailableRecovery({ action: "fork_interrupted_work" }),
    });
    const spaceStub = {
      rpcExecuteExecutionRecovery: vi.fn(),
      rpcInspectExecutionRecovery: vi.fn(),
      rpcStartUsageExhaustedContinuation: vi.fn(),
    };
    try {
      await expect(
        rpcExecuteAgentProfileWorkRecovery(
          createEnv({ db: harness.db, runtimeTransportStub, spaceStub }),
          {
            agentProfileId: AGENT_PROFILE_ID,
            body: {
              action: "fork_interrupted_work",
              expectedInterruptedTargetWakeLifecycleId:
                TARGET_WAKE_LIFECYCLE_ID,
            },
            context: CONTEXT,
          }
        )
      ).rejects.toMatchObject({
        code: "agent_profile_work_recovery.awaiting_original_stop",
      });
      // The owner's decision is kept, and nothing replaced the work yet.
      expect(
        runtimeTransportStub.rpcAuthorizeAgentProfileWorkContinuation
      ).toHaveBeenCalledOnce();
      expect(
        runtimeTransportStub.rpcRequestAgentProfileWorkLocalAttemptWithdrawal
      ).toHaveBeenCalledWith({
        expectedInterruptedTargetWakeLifecycleId: TARGET_WAKE_LIFECYCLE_ID,
        ownerUserId: "owner-1",
        targetProfileId: AGENT_PROFILE_ID,
      });
      expect(
        spaceStub.rpcStartUsageExhaustedContinuation
      ).not.toHaveBeenCalled();
    } finally {
      await harness.close();
    }
  });

  it("re-asks for the withdrawal on a retry that reuses a stored authorization", async () => {
    const harness = await createRecoveryHarness();
    const runtimeTransportStub = createRuntimeTransportStub({
      localAttemptWithdrawal: "requested",
      recovery: buildAvailableRecovery({
        action: "fork_interrupted_work",
        authorizedContinuationClientMessageId: "client-message-continuation",
        forkInterruptedConversation: true,
      }),
    });
    const spaceStub = {
      rpcExecuteExecutionRecovery: vi.fn(),
      rpcInspectExecutionRecovery: vi.fn(),
      rpcStartUsageExhaustedContinuation: vi.fn(),
    };
    try {
      await expect(
        rpcExecuteAgentProfileWorkRecovery(
          createEnv({ db: harness.db, runtimeTransportStub, spaceStub }),
          {
            agentProfileId: AGENT_PROFILE_ID,
            body: {
              action: "fork_interrupted_work",
              expectedInterruptedTargetWakeLifecycleId:
                TARGET_WAKE_LIFECYCLE_ID,
            },
            context: CONTEXT,
          }
        )
      ).rejects.toMatchObject({
        code: "agent_profile_work_recovery.awaiting_original_stop",
      });
      // A stored authorization is not evidence that the first cancellation
      // landed, so the prerequisite is asked again rather than assumed.
      expect(
        runtimeTransportStub.rpcAuthorizeAgentProfileWorkContinuation
      ).not.toHaveBeenCalled();
      expect(
        runtimeTransportStub.rpcRequestAgentProfileWorkLocalAttemptWithdrawal
      ).toHaveBeenCalledOnce();
      expect(
        spaceStub.rpcStartUsageExhaustedContinuation
      ).not.toHaveBeenCalled();
    } finally {
      await harness.close();
    }
  });

  it("starts the replacement branch once the computer confirms the attempt is gone", async () => {
    const harness = await createRecoveryHarness();
    const runtimeTransportStub = createRuntimeTransportStub({
      localAttemptWithdrawal: "withdrawn",
      recovery: buildAvailableRecovery({ action: "fork_interrupted_work" }),
    });
    const spaceStub = {
      rpcExecuteExecutionRecovery: vi.fn(),
      rpcInspectExecutionRecovery: vi.fn(),
      rpcStartUsageExhaustedContinuation: vi.fn(
        (continuation: Record<string, unknown>) =>
          Promise.resolve({
            continuationClientMessageId: String(
              continuation.continuationClientMessageId
            ),
            operationId: String(continuation.operationId),
            status: "started" as const,
          })
      ),
    };
    try {
      await expect(
        rpcExecuteAgentProfileWorkRecovery(
          createEnv({ db: harness.db, runtimeTransportStub, spaceStub }),
          {
            agentProfileId: AGENT_PROFILE_ID,
            body: {
              action: "fork_interrupted_work",
              expectedInterruptedTargetWakeLifecycleId:
                TARGET_WAKE_LIFECYCLE_ID,
            },
            context: CONTEXT,
          }
        )
      ).resolves.toEqual({
        action: "fork_interrupted_work",
        status: "accepted",
      });
      expect(
        spaceStub.rpcStartUsageExhaustedContinuation
      ).toHaveBeenCalledOnce();
    } finally {
      await harness.close();
    }
  });

  it("defers replacement work when an owner shard predates the prerequisite", async () => {
    const harness = await createRecoveryHarness();
    const runtimeTransportStub = createRuntimeTransportStub({
      recovery: buildAvailableRecovery({ action: "fork_interrupted_work" }),
    });
    // Durable Object code propagates after a Worker deploy, so a live shard can
    // still be one that never learned this call.
    runtimeTransportStub.rpcRequestAgentProfileWorkLocalAttemptWithdrawal.mockRejectedValue(
      new Error(
        "rpcRequestAgentProfileWorkLocalAttemptWithdrawal is not a function"
      )
    );
    const spaceStub = {
      rpcExecuteExecutionRecovery: vi.fn(),
      rpcInspectExecutionRecovery: vi.fn(),
      rpcStartUsageExhaustedContinuation: vi.fn(),
    };
    try {
      await expect(
        rpcExecuteAgentProfileWorkRecovery(
          createEnv({ db: harness.db, runtimeTransportStub, spaceStub }),
          {
            agentProfileId: AGENT_PROFILE_ID,
            body: {
              action: "fork_interrupted_work",
              expectedInterruptedTargetWakeLifecycleId:
                TARGET_WAKE_LIFECYCLE_ID,
            },
            context: CONTEXT,
          }
        )
      ).rejects.toMatchObject({
        code: "agent_profile_work_recovery.temporarily_unavailable",
      });
      expect(
        spaceStub.rpcStartUsageExhaustedContinuation
      ).not.toHaveBeenCalled();
    } finally {
      await harness.close();
    }
  });

  it("defers replacement work when the owner shard cannot answer the prerequisite", async () => {
    const harness = await createRecoveryHarness();
    const runtimeTransportStub = createRuntimeTransportStub({
      localAttemptWithdrawal: "unavailable",
      recovery: buildAvailableRecovery({ action: "fork_interrupted_work" }),
    });
    const spaceStub = {
      rpcExecuteExecutionRecovery: vi.fn(),
      rpcInspectExecutionRecovery: vi.fn(),
      rpcStartUsageExhaustedContinuation: vi.fn(),
    };
    try {
      await expect(
        rpcExecuteAgentProfileWorkRecovery(
          createEnv({ db: harness.db, runtimeTransportStub, spaceStub }),
          {
            agentProfileId: AGENT_PROFILE_ID,
            body: {
              action: "fork_interrupted_work",
              expectedInterruptedTargetWakeLifecycleId:
                TARGET_WAKE_LIFECYCLE_ID,
            },
            context: CONTEXT,
          }
        )
      ).rejects.toMatchObject({
        code: "agent_profile_work_recovery.temporarily_unavailable",
      });
      expect(
        spaceStub.rpcStartUsageExhaustedContinuation
      ).not.toHaveBeenCalled();
    } finally {
      await harness.close();
    }
  });
});

async function createRecoveryHarness() {
  const harness = await createPostgresHarness();
  await harness.query({
    text: `INSERT INTO "openmeld"."users" (id,name,email) VALUES ('owner-1','Owner','owner-1@example.com'),('stale-owner','Stale Owner','stale@example.com');
    INSERT INTO "openmeld"."organizations" (id,name,slug,created_at) VALUES ('org-1','Organization','org-1',1700000000000),('org-stale','Stale Organization','org-stale',1700000000000)`,
  });

  const now = Date.now();
  await harness.query({
    values: [
      AGENT_PROFILE_ID,
      "Agent One",
      "agent-one",
      "agent",
      0,
      "active",
      "org-1",
      "owner-1",
      "cli_create",
      now,
      now,
    ],
    text: `INSERT INTO "openmeld"."openmeld_profiles" (
      profile_id,
      profile_name,
      profile_handle,
      profile_kind,
      is_default,
      status,
      organization_id,
      owner_user_id,
      source,
      created_at,
      updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
  });
  await harness.query({
    values: [
      "binding-1",
      "owner-1",
      AGENT_PROFILE_ID,
      "runtime-1",
      "builtin:codex",
      "conversation-1",
      now,
      now,
    ],
    text: `INSERT INTO "openmeld"."openMeldDaemon_agent_profile_bindings" (
      binding_id,
      owner_kind,
      owner_id,
      agent_profile_id,
      openmeld_service_runtime_id,
      runtime_kind,
      agent_controller_ref,
      agent_controller_conversation_id,
      binding_state,
      configuration_revision,
      created_at_ms,
      updated_at_ms
    ) VALUES ($1, 'owner_account', $2, $3, $4, 'openmeld_service', $5, $6, 'enabled_primary', 1, $7, $8)`,
  });
  return harness;
}

function createRuntimeTransportStub(input?: {
  localAttemptWithdrawal?:
    | "not_pending"
    | "not_started"
    | "requested"
    | "unavailable"
    | "withdrawn";
  recovery?:
    | ReturnType<typeof buildAvailableRecovery>
    | Omit<
        ReturnType<typeof buildAvailableRecovery>,
        "interruptedSourceSignalId"
      >
    | { status: "not_pending" }
    | (() =>
        | ReturnType<typeof buildAvailableRecovery>
        | { status: "not_pending" });
}) {
  return {
    rpcAgentProfileExecutionMode: vi.fn(
      async (request: { mode?: "parallel" | "serial" }) => ({
        agentProfileId: AGENT_PROFILE_ID,
        mode: request.mode ?? "parallel",
        migration: "contexts" as const,
        revision: 4,
      })
    ),
    rpcApproveAgentProfileWorkQueue: vi.fn(async () => ({
      status: "approved" as const,
    })),
    rpcAuthorizeAgentProfileWorkContinuation: vi.fn(
      (_input: {
        continuationClientMessageId: string;
        currentAgentControllerRef: string;
        currentBindingId: string;
        currentConfigurationRevision: number;
        currentDefaultProjectId: string | null;
        expectedInterruptedTargetWakeLifecycleId: string;
        ownerUserId: string;
        requireAcceptedExecutionTargetRevision: true;
        targetProfileId: string;
      }) => Promise.resolve({ status: "authorized" as const })
    ),
    rpcReadAgentProfileWorkRecovery: vi.fn(() => {
      const recovery = input?.recovery;
      return Promise.resolve(
        typeof recovery === "function"
          ? recovery()
          : (recovery ?? { status: "not_pending" as const })
      );
    }),
    rpcRequestAgentProfileWorkLocalAttemptWithdrawal: vi.fn(
      async (_input: {
        expectedInterruptedTargetWakeLifecycleId: string;
        ownerUserId: string;
        targetProfileId: string;
      }) => ({
        status: input?.localAttemptWithdrawal ?? ("withdrawn" as const),
      })
    ),
    rpcSkipAgentProfileInterruptedWork: vi.fn(
      async (_input: {
        expectedInterruptedTargetWakeLifecycleId: string;
        ownerUserId: string;
        targetProfileId: string;
      }) => ({
        status: "skipped" as const,
      })
    ),
  };
}

function createEnv(input: {
  authResolveProfileById?: ResolveProfileByIdRpc;
  db: PostgresDatabase;
  firstRuntimeTransportStub?: ReturnType<typeof createRuntimeTransportStub>;
  runtimeTransportStub: ReturnType<typeof createRuntimeTransportStub>;
  spaceStub?: Record<string, unknown>;
}): CoreBindings {
  return {
    OPENMELD_AUTH_WORKER: {
      resolveProfileById:
        input.authResolveProfileById ??
        vi.fn(async () => ({
          ok: true as const,
          profile: {
            defaultProjectId: "project-a",
            organizationId: "org-1",
            ownerUserId: "owner-1",
            profileHandle: "agent-one",
            profileId: AGENT_PROFILE_ID,
            profileKind: "agent" as const,
            profileName: "Agent One",
            status: "active" as const,
          },
        })),
    },
    OPENMELD_POSTGRESQL: postgresTestBinding(input.db),
    OPENMELD_RUNTIME_TRANSPORT: {
      get: vi
        .fn(() => input.runtimeTransportStub)
        .mockReturnValueOnce(
          input.firstRuntimeTransportStub ?? input.runtimeTransportStub
        ),
      idFromName: vi.fn((value: string) => value),
    } as unknown as CoreBindings["OPENMELD_RUNTIME_TRANSPORT"],
    OPENMELD_SPACES: {
      get: vi.fn(() => input.spaceStub ?? {}),
      idFromString: vi.fn((value: string) => value),
    } as unknown as CoreBindings["OPENMELD_SPACES"],
  };
}

function buildAvailableRecovery(input: {
  action:
    | "approve_queued_work"
    | "continue_interrupted_work"
    | "fork_interrupted_work"
    | "skip_interrupted_work";
  authorizedContinuationClientMessageId?: string | null;
  forkInterruptedConversation?: boolean;
}) {
  return {
    action: input.action,
    authorizedContinuationClientMessageId:
      input.authorizedContinuationClientMessageId ?? null,
    ...(input.forkInterruptedConversation
      ? { forkInterruptedConversation: true }
      : {}),
    interruptedClientMessageId: "client-interrupted",
    interruptedDispatchId: "dispatch-interrupted",
    interruptedSourceSignalId: "signal-interrupted",
    interruptedTargetWakeLifecycleId: TARGET_WAKE_LIFECYCLE_ID,
    spaceId: SPACE_ID,
    status: "available" as const,
  };
}
