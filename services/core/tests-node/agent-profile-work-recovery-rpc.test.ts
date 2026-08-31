import type { OpenMeldRequestContext } from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import { rpcExecuteAgentProfileWorkRecovery } from "../src/rpc/methods";
import {
  applyDrizzleMigrationForTable as applyMigrationForTable,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

const AGENT_PROFILE_ID = "agt_11111111-1111-4111-8111-111111111111";
const SPACE_ID = "a".repeat(64);
const TARGET_WAKE_LIFECYCLE_ID = "twl_interrupted";
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
  it("rejects requests outside the Profile's canonical Organization before reading recovery state", async () => {
    const harness = createRecoveryHarness();
    const runtimeTransportStub = createRuntimeTransportStub();
    try {
      await expect(
        rpcExecuteAgentProfileWorkRecovery(
          createEnv({ db: harness.db, runtimeTransportStub }),
          {
            agentProfileId: AGENT_PROFILE_ID,
            body: { action: "approve_queued_work" },
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
      harness.close();
    }
  });

  it("rejects a non-owner before reading recovery state", async () => {
    const harness = createRecoveryHarness();
    const runtimeTransportStub = createRuntimeTransportStub();
    try {
      await expect(
        rpcExecuteAgentProfileWorkRecovery(
          createEnv({ db: harness.db, runtimeTransportStub }),
          {
            agentProfileId: AGENT_PROFILE_ID,
            body: { action: "approve_queued_work" },
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
      harness.close();
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
  ])("returns 409 for a $scenario", async ({ bodyAction, recovery }) => {
    const harness = createRecoveryHarness();
    const runtimeTransportStub = createRuntimeTransportStub({ recovery });
    try {
      await expect(
        rpcExecuteAgentProfileWorkRecovery(
          createEnv({ db: harness.db, runtimeTransportStub }),
          {
            agentProfileId: AGENT_PROFILE_ID,
            body: { action: bodyAction },
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
        runtimeTransportStub.rpcApproveAgentProfileWorkQueue
      ).not.toHaveBeenCalled();
      expect(
        runtimeTransportStub.rpcAuthorizeAgentProfileWorkContinuation
      ).not.toHaveBeenCalled();
    } finally {
      harness.close();
    }
  });

  it("approves queued work through the owner Hub", async () => {
    const harness = createRecoveryHarness();
    const runtimeTransportStub = createRuntimeTransportStub({
      recovery: buildAvailableRecovery({ action: "approve_queued_work" }),
    });
    try {
      await expect(
        rpcExecuteAgentProfileWorkRecovery(
          createEnv({ db: harness.db, runtimeTransportStub }),
          {
            agentProfileId: AGENT_PROFILE_ID,
            body: { action: "approve_queued_work" },
            context: CONTEXT,
          }
        )
      ).resolves.toEqual({
        action: "approve_queued_work",
        status: "accepted",
      });
      expect(
        runtimeTransportStub.rpcReadAgentProfileWorkRecovery
      ).toHaveBeenCalledWith({
        ownerUserId: "owner-1",
        targetProfileId: AGENT_PROFILE_ID,
      });
      expect(
        runtimeTransportStub.rpcApproveAgentProfileWorkQueue
      ).toHaveBeenCalledOnce();
      expect(
        runtimeTransportStub.rpcApproveAgentProfileWorkQueue
      ).toHaveBeenCalledWith({
        ownerUserId: "owner-1",
        targetProfileId: AGENT_PROFILE_ID,
      });
    } finally {
      harness.close();
    }
  });

  it("skips interrupted work through the owner Hub", async () => {
    const harness = createRecoveryHarness();
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
      harness.close();
    }
  });

  it("rejects an unfenced Skip before reading or mutating owner state", async () => {
    const harness = createRecoveryHarness();
    const runtimeTransportStub = createRuntimeTransportStub({
      recovery: buildAvailableRecovery({ action: "skip_interrupted_work" }),
    });
    try {
      await expect(
        rpcExecuteAgentProfileWorkRecovery(
          createEnv({ db: harness.db, runtimeTransportStub }),
          {
            agentProfileId: AGENT_PROFILE_ID,
            body: { action: "skip_interrupted_work" } as never,
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
      harness.close();
    }
  });

  it("authorizes one deterministic continuation identity before asking Space to start it", async () => {
    const harness = createRecoveryHarness();
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
    const projection = buildExecutionRecoveryProjection();
    const executedCommands: unknown[] = [];
    const spaceStub = {
      rpcExecuteExecutionRecovery: vi.fn(
        (input: { body: Record<string, unknown> }) => {
          callOrder.push("execute");
          executedCommands.push(input.body);
          return Promise.resolve({
            action: "retry_as_new_execution" as const,
            newExecutionId: "new-execution-1",
            operationId: String(input.body.operationId),
            publicationId: null,
            reasonCode: "execution_recovery.new_execution_requested",
            recovery: projection,
            status: "new_execution_requested" as const,
          });
        }
      ),
      rpcInspectExecutionRecovery: vi.fn(async () => ({
        recovery: projection,
      })),
    };
    const env = createEnv({ db: harness.db, runtimeTransportStub, spaceStub });
    const input = {
      agentProfileId: AGENT_PROFILE_ID,
      body: { action: "continue_interrupted_work" as const },
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

      expect(callOrder).toEqual(["authorize", "execute", "execute"]);
      expect(
        runtimeTransportStub.rpcAuthorizeAgentProfileWorkContinuation
      ).toHaveBeenCalledOnce();
      expect(executedCommands).toHaveLength(2);
      expect(executedCommands[0]).toEqual(executedCommands[1]);
      expect(executedCommands[0]).toMatchObject({
        action: "retry_as_new_execution",
        destination: {
          spaceId: SPACE_ID,
          surface: "space",
          threadId: "thread-1",
        },
        expectedIdentity: {
          dispatchId: "dispatch-interrupted",
          spaceId: SPACE_ID,
          targetProfileId: AGENT_PROFILE_ID,
        },
        operationId:
          "agent-profile-work-recovery:1dcbcbab75bbfe2b76251862ae4f219ed0a1bd75624570685d3dc817b3f04251",
      });
      expect(
        runtimeTransportStub.rpcAuthorizeAgentProfileWorkContinuation
      ).toHaveBeenCalledWith({
        continuationClientMessageId:
          "execution-recovery-fd96a80aa0d843939d979142d0c5b177b3785c93ae19939e22b772dac929d3a4",
        currentAgentControllerRef: "builtin:codex",
        currentBindingId: "binding-1",
        currentConfigurationRevision: 1,
        expectedInterruptedTargetWakeLifecycleId: TARGET_WAKE_LIFECYCLE_ID,
        ownerUserId: "owner-1",
        requireAcceptedExecutionTargetRevision: true,
        targetProfileId: AGENT_PROFILE_ID,
      });
      expect(spaceStub.rpcInspectExecutionRecovery).toHaveBeenCalledWith({
        context: CONTEXT,
        dispatchId: "dispatch-interrupted",
        spaceAccess: {
          actor: {
            dispatchId: "dispatch-interrupted",
            kind: "dispatch_continuation",
            requestContext: CONTEXT,
            sourceSignalId: "signal-interrupted",
            targetProfileId: AGENT_PROFILE_ID,
          },
          proof: { kind: "none" },
          spaceId: SPACE_ID,
        },
        spaceId: SPACE_ID,
      });
      expect(spaceStub.rpcExecuteExecutionRecovery).toHaveBeenCalledWith(
        expect.objectContaining({
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
    } finally {
      harness.close();
    }
  });

  it("defers a continuation from an older owner shard before any Space side effect", async () => {
    const harness = createRecoveryHarness();
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
          body: { action: "continue_interrupted_work" },
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
      harness.close();
    }
  });
});

function createRecoveryHarness() {
  const harness = createSqliteD1Harness();
  applyMigrationForTable(harness, "openMeldDaemon_agent_profile_bindings");
  harness.run({
    sql: `CREATE TABLE openmeld_profiles (
      profile_id text PRIMARY KEY NOT NULL,
      profile_name text NOT NULL,
      profile_handle text NOT NULL,
      profile_kind text NOT NULL,
      is_default integer NOT NULL,
      status text NOT NULL,
      organization_id text,
      owner_user_id text NOT NULL,
      source text NOT NULL,
      managed_role text,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    )`,
  });
  const now = Date.now();
  harness.run({
    params: [
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
    sql: `INSERT INTO openmeld_profiles (
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
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  });
  harness.run({
    params: [
      "binding-1",
      "owner-1",
      AGENT_PROFILE_ID,
      "runtime-1",
      "builtin:codex",
      "conversation-1",
      now,
      now,
    ],
    sql: `INSERT INTO openMeldDaemon_agent_profile_bindings (
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
    ) VALUES (?, 'owner_account', ?, ?, ?, 'openmeld_service', ?, ?, 'enabled_primary', 1, ?, ?)`,
  });
  return harness;
}

function createRuntimeTransportStub(input?: {
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
    rpcApproveAgentProfileWorkQueue: vi.fn(async () => ({
      status: "approved" as const,
    })),
    rpcAuthorizeAgentProfileWorkContinuation: vi.fn(
      (_input: {
        continuationClientMessageId: string;
        currentAgentControllerRef: string;
        currentBindingId: string;
        currentConfigurationRevision: number;
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
  db: D1Database;
  runtimeTransportStub: ReturnType<typeof createRuntimeTransportStub>;
  spaceStub?: Record<string, unknown>;
}): CoreBindings {
  return {
    OPENMELD_AUTH_WORKER: {
      resolveProfileById: vi.fn(async () => ({
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
    },
    OPENMELD_DB: input.db,
    OPENMELD_RUNTIME_TRANSPORT: {
      get: vi.fn(() => input.runtimeTransportStub),
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
    | "skip_interrupted_work";
  authorizedContinuationClientMessageId?: string | null;
}) {
  return {
    action: input.action,
    authorizedContinuationClientMessageId:
      input.authorizedContinuationClientMessageId ?? null,
    interruptedClientMessageId: "client-interrupted",
    interruptedDispatchId: "dispatch-interrupted",
    interruptedSourceSignalId: "signal-interrupted",
    interruptedTargetWakeLifecycleId: TARGET_WAKE_LIFECYCLE_ID,
    spaceId: SPACE_ID,
    status: "available" as const,
  };
}

function buildExecutionRecoveryProjection() {
  const capability = (
    action:
      | "recover_result"
      | "resume_controller_conversation"
      | "retry_as_new_execution",
    enabled: boolean,
    label: "Recover reply" | "Continue conversation" | "Retry as new execution"
  ) => ({
    action,
    enabled,
    label,
    reasonCode: enabled
      ? "execution_recovery.fresh_execution_available"
      : "execution_recovery.action_unavailable",
    warning: enabled ? "This starts a new execution." : null,
  });
  return {
    actions: {
      recoverResult: capability("recover_result", false, "Recover reply"),
      resumeControllerConversation: capability(
        "resume_controller_conversation",
        false,
        "Continue conversation"
      ),
      retryAsNewExecution: capability(
        "retry_as_new_execution",
        true,
        "Retry as new execution"
      ),
    },
    destination: {
      spaceId: SPACE_ID,
      surface: "space" as const,
      threadId: "thread-1",
    },
    identity: {
      agentControllerConversationId: "conversation-1",
      agentControllerRef: "builtin:codex",
      attemptId: "attempt-1",
      dispatchId: "dispatch-interrupted",
      resultRef: null,
      runtimeCoordinatorExecutionId: "runtime-execution-1",
      spaceId: SPACE_ID,
      targetProfileId: AGENT_PROFILE_ID,
      taskId: "task-1",
    },
    recommendedAction: "retry_as_new_execution" as const,
    recoveredPublicationId: null,
    status: "available" as const,
    tier: "fresh_execution" as const,
    updatedAtMs: 1_777_000_000_000,
  };
}
