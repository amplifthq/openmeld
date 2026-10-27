import { AGENT_CONTROLLER_USAGE_LIMIT_SUPPORT_MATRIX_VERSION } from "@openmeld/agent-runtime";
import type { PostgresDatabase } from "@openmeld/db/postgresql";
import type {
  AgentControllerInterfaceSnapshot,
  OpenMeldRequestContext,
} from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import { createCoreRpcHttpError } from "../src/rpc/errors";
import {
  rpcSubmitRuntimeAgentControllerReports,
  rpcSubmitRuntimeProviderConversationProofs,
  rpcSubmitRuntimeRegistration,
} from "../src/rpc/methods";
import {
  createPostgresHarness,
  postgresTestBinding,
} from "./helpers/postgresql-harness.test-support";

const DEFAULT_CONTEXT: OpenMeldRequestContext = {
  actorContext: {
    openMeldProfileId: "11111111-1111-4111-8111-111111111111",
    ownerUserId: "owner-1",
    profileKind: "human",
    profileName: "Mira",
    requestId: "req-runtime-reporting",
  },
};

describe("runtime reporting Core RPC write", () => {
  it("creates and reuses Runtime registration for the authenticated owner context", async () => {
    const harness = await createPostgresHarness();
    try {
      const env = coreEnv(harness.db);

      const created = await rpcSubmitRuntimeRegistration(env, {
        context: DEFAULT_CONTEXT,
        deviceId: "device-1",
        lane: "openmeld-dev",
      });
      const reused = await rpcSubmitRuntimeRegistration(env, {
        context: DEFAULT_CONTEXT,
        deviceId: "device-1",
        lane: "openmeld-dev",
      });

      expect(created.status).toBe("created");
      expect(reused.status).toBe("reused");
      expect(reused.openMeldServiceRuntimeId).toEqual(
        created.openMeldServiceRuntimeId
      );
      expect(
        await harness.queryFirst<{
          owner_id: string;
          owner_kind: string;
        }>({
          text: `
            SELECT owner_kind, owner_id
            FROM "openmeld"."openMeldDaemon_runtime_registry_records"
            WHERE openmeld_service_runtime_id = $1
          `,
          values: [created.openMeldServiceRuntimeId?.value ?? ""],
        })
      ).toEqual({
        owner_id: "owner-1",
        owner_kind: "owner_account",
      });
    } finally {
      await harness.close();
    }
  });

  it("accepts a Runtime Agent Controller Report and reuses an identical retry", async () => {
    const harness = await createPostgresHarness();
    try {
      const env = coreEnv(harness.db);
      const registration = await rpcSubmitRuntimeRegistration(env, {
        context: DEFAULT_CONTEXT,
        deviceId: "device-1",
        lane: "openmeld-dev",
      });
      if (!registration.openMeldServiceRuntimeId) {
        throw new Error(
          "test registration did not return openMeldServiceRuntimeId"
        );
      }
      const observedAtMs = Date.now();
      const expiresAtMs = observedAtMs + 60_000;

      const first = await rpcSubmitRuntimeAgentControllerReports(env, {
        context: DEFAULT_CONTEXT,
        deviceId: "device-1",
        lane: "openmeld-dev",
        reports: [
          {
            agentControllerRef: "builtin:codex",
            expiresAtMs,
            observedAtMs,
            reasonCodes: ["runtime.agent_controller_report.ready"],
            status: "ready",
          },
        ],
        openMeldServiceRuntimeId: registration.openMeldServiceRuntimeId,
      });
      const retry = await rpcSubmitRuntimeAgentControllerReports(env, {
        context: DEFAULT_CONTEXT,
        deviceId: "device-1",
        lane: "openmeld-dev",
        reports: [
          {
            agentControllerRef: "builtin:codex",
            expiresAtMs,
            observedAtMs,
            reasonCodes: ["runtime.agent_controller_report.ready"],
            status: "ready",
          },
        ],
        openMeldServiceRuntimeId: registration.openMeldServiceRuntimeId,
      });

      expect(first).toMatchObject({
        reports: [
          {
            agentControllerRef: "builtin:codex",
            outcome: "created",
            status: "accepted",
          },
        ],
        status: "accepted",
      });
      expect(retry).toMatchObject({
        reports: [
          {
            agentControllerRef: "builtin:codex",
            outcome: "reused",
            status: "accepted",
          },
        ],
        status: "accepted",
      });
    } finally {
      await harness.close();
    }
  });

  it("does not read recovery for 50 Profiles without a recovery gate", async () => {
    const harness = await createPostgresHarness();
    try {
      const markUsageAvailable = vi.fn().mockResolvedValue({
        changedProfileIds: [],
        continuationProfileIds: [],
        status: "updated",
      });
      const readRecovery = vi.fn().mockResolvedValue({
        status: "not_pending",
      });
      const ownerShard = {
        rpcMarkAgentProfileWorkUsageAvailable: markUsageAvailable,
        rpcReadAgentProfileWorkRecovery: readRecovery,
      };
      const spaceGet = vi.fn();
      const env = {
        ...coreEnv(harness.db),
        OPENMELD_RUNTIME_TRANSPORT: {
          get: vi.fn(() => ownerShard),
          idFromName: vi.fn((name: string) => name),
        },
        OPENMELD_SPACES: {
          get: spaceGet,
          idFromString: vi.fn((value: string) => value),
        },
      } as unknown as CoreBindings;
      const registration = await rpcSubmitRuntimeRegistration(env, {
        context: DEFAULT_CONTEXT,
        deviceId: "device-1",
        lane: "openmeld-dev",
      });
      if (!registration.openMeldServiceRuntimeId) {
        throw new Error(
          "test registration did not return openMeldServiceRuntimeId"
        );
      }
      const observedAtMs = Date.now();
      const profileIds = Array.from({ length: 50 }, (_, index) =>
        buildTestAgentProfileId(index + 1)
      );
      for (const [index, agentProfileId] of profileIds.entries()) {
        await insertPrimaryAgentProfileBinding(harness, {
          agentControllerConversationId: `conversation-usage-recovery-${index}`,
          agentControllerRef: "builtin:codex",
          agentProfileId,
          bindingId: `binding-usage-recovery-${index}`,
          nowMs: observedAtMs,
          openMeldServiceRuntimeId: registration.openMeldServiceRuntimeId.value,
          ownerId: "owner-1",
        });
      }
      const report = {
        agentControllerInterface: createAvailableUsageInterface(),
        agentControllerRef: "builtin:codex",
        expiresAtMs: observedAtMs + 60_000,
        observedAtMs,
        reasonCodes: ["runtime.agent_controller_report.ready"],
        status: "ready" as const,
      };

      const first = await rpcSubmitRuntimeAgentControllerReports(env, {
        context: DEFAULT_CONTEXT,
        deviceId: "device-1",
        lane: "openmeld-dev",
        reports: [report],
        openMeldServiceRuntimeId: registration.openMeldServiceRuntimeId,
      });
      const retry = await rpcSubmitRuntimeAgentControllerReports(env, {
        context: DEFAULT_CONTEXT,
        deviceId: "device-1",
        lane: "openmeld-dev",
        reports: [report],
        openMeldServiceRuntimeId: registration.openMeldServiceRuntimeId,
      });

      expect(first.reports[0]).toMatchObject({ outcome: "created" });
      expect(retry.reports[0]).toMatchObject({ outcome: "reused" });
      expect(markUsageAvailable).toHaveBeenCalledTimes(2);
      expect(markUsageAvailable).toHaveBeenNthCalledWith(1, {
        ownerUserId: "owner-1",
        targetProfileIds: profileIds,
      });
      expect(markUsageAvailable).toHaveBeenNthCalledWith(2, {
        ownerUserId: "owner-1",
        targetProfileIds: profileIds,
      });
      expect(readRecovery).not.toHaveBeenCalled();
      expect(spaceGet).not.toHaveBeenCalled();
    } finally {
      await harness.close();
    }
  });

  it("accepts a Usage report while an older owner shard defers continuation identity", async () => {
    const harness = await createPostgresHarness();
    try {
      const agentProfileId = buildTestAgentProfileId(1);
      const markUsageAvailable = vi.fn().mockResolvedValue({
        changedProfileIds: [agentProfileId],
        continuationProfileIds: [agentProfileId],
        status: "updated",
      });
      const readRecovery = vi.fn().mockResolvedValue({
        action: "continue_interrupted_work",
        authorizedContinuationClientMessageId: null,
        interruptedClientMessageId: "client-interrupted",
        interruptedDispatchId: "dispatch-interrupted",
        spaceId: "a".repeat(64),
        status: "available",
      });
      const spaceGet = vi.fn();
      const env = {
        ...coreEnv(harness.db),
        OPENMELD_RUNTIME_TRANSPORT: {
          get: vi.fn(() => ({
            rpcMarkAgentProfileWorkUsageAvailable: markUsageAvailable,
            rpcReadAgentProfileWorkRecovery: readRecovery,
          })),
          idFromName: vi.fn((name: string) => name),
        },
        OPENMELD_SPACES: {
          get: spaceGet,
          idFromString: vi.fn((value: string) => value),
        },
      } as unknown as CoreBindings;
      const registration = await rpcSubmitRuntimeRegistration(env, {
        context: DEFAULT_CONTEXT,
        deviceId: "device-1",
        lane: "openmeld-dev",
      });
      if (!registration.openMeldServiceRuntimeId) {
        throw new Error(
          "test registration did not return openMeldServiceRuntimeId"
        );
      }
      const observedAtMs = Date.now();
      await insertPrimaryAgentProfileBinding(harness, {
        agentControllerConversationId: "conversation-usage-recovery",
        agentControllerRef: "builtin:codex",
        agentProfileId,
        bindingId: "binding-usage-recovery",
        nowMs: observedAtMs,
        openMeldServiceRuntimeId: registration.openMeldServiceRuntimeId.value,
        ownerId: "owner-1",
      });

      await expect(
        rpcSubmitRuntimeAgentControllerReports(env, {
          context: DEFAULT_CONTEXT,
          deviceId: "device-1",
          lane: "openmeld-dev",
          reports: [
            {
              agentControllerInterface: createAvailableUsageInterface(),
              agentControllerRef: "builtin:codex",
              expiresAtMs: observedAtMs + 60_000,
              observedAtMs,
              reasonCodes: ["runtime.agent_controller_report.ready"],
              status: "ready",
            },
          ],
          openMeldServiceRuntimeId: registration.openMeldServiceRuntimeId,
        })
      ).resolves.toMatchObject({
        reports: [{ outcome: "created", status: "accepted" }],
        status: "accepted",
      });
      expect(readRecovery).toHaveBeenCalledOnce();
      expect(spaceGet).not.toHaveBeenCalled();
    } finally {
      await harness.close();
    }
  });

  it.each([
    "usage",
    "occupied",
    "scope-changed",
  ] as const)("keeps %s continuation fenced after withdrawal and source validation", async (scenario) => {
    const harness = await createPostgresHarness();
    try {
      const agentProfileId = buildTestAgentProfileId(1);
      const markUsageAvailable = vi
        .fn()
        .mockResolvedValueOnce({
          changedProfileIds: [agentProfileId],
          continuationProfileIds: [agentProfileId],
          status: "updated",
        })
        .mockResolvedValue({
          changedProfileIds: [],
          continuationProfileIds: [],
          status: "updated",
        });
      const readRecovery = vi.fn().mockResolvedValue({
        action:
          scenario === "usage"
            ? "continue_interrupted_work"
            : "fork_interrupted_work",
        automaticForkEligible: scenario === "occupied",
        authorizedContinuationClientMessageId: "continuation-client-1",
        interruptedClientMessageId: "client-interrupted",
        interruptedDispatchId: "dispatch-interrupted",
        interruptedSourceSignalId: "signal-interrupted",
        interruptedTargetWakeLifecycleId: "twl-interrupted",
        spaceId: "a".repeat(64),
        status: "available",
      });
      if (scenario === "scope-changed") {
        readRecovery.mockResolvedValueOnce({
          action: "fork_interrupted_work",
          automaticForkEligible: true,
          authorizedContinuationClientMessageId: "continuation-client-1",
          interruptedClientMessageId: "client-interrupted",
          interruptedDispatchId: "dispatch-interrupted",
          interruptedSourceSignalId: "signal-interrupted",
          interruptedTargetWakeLifecycleId: "twl-interrupted",
          spaceId: "a".repeat(64),
          status: "available",
        });
      }
      const markContinuationNeedsAttention = vi.fn().mockResolvedValue({
        status: "marked",
      });
      const approveQueuedWork = vi.fn();
      const skipInterruptedWork = vi.fn();
      // The interrupted attempt is already gone, so Usage recovery reaches the
      // Space start and this case can exercise the source-mismatch decision.
      const requestLocalAttemptWithdrawal = vi
        .fn()
        .mockResolvedValue({ status: "withdrawn" });
      const ownerShard = {
        rpcApproveAgentProfileWorkQueue: approveQueuedWork,
        rpcMarkAgentProfileWorkContinuationNeedsAttention:
          markContinuationNeedsAttention,
        rpcMarkAgentProfileWorkUsageAvailable: markUsageAvailable,
        rpcReadAgentProfileWorkRecovery: readRecovery,
        rpcRequestAgentProfileWorkLocalAttemptWithdrawal:
          requestLocalAttemptWithdrawal,
        rpcSkipAgentProfileInterruptedWork: skipInterruptedWork,
      };
      const startContinuation = vi
        .fn()
        .mockRejectedValue(
          new Error("agent_profile_work_recovery.continuation_source_mismatch")
        );
      const spaceGet = vi.fn(() => ({
        rpcStartUsageExhaustedContinuation: startContinuation,
      }));
      const env = {
        ...coreEnv(harness.db),
        OPENMELD_RUNTIME_TRANSPORT: {
          get: vi.fn(() => ownerShard),
          idFromName: vi.fn((name: string) => name),
        },
        OPENMELD_SPACES: {
          get: spaceGet,
          idFromString: vi.fn((value: string) => value),
        },
      } as unknown as CoreBindings;
      const registration = await rpcSubmitRuntimeRegistration(env, {
        context: DEFAULT_CONTEXT,
        deviceId: "device-1",
        lane: "openmeld-dev",
      });
      if (!registration.openMeldServiceRuntimeId) {
        throw new Error(
          "test registration did not return openMeldServiceRuntimeId"
        );
      }
      const observedAtMs = Date.now();
      await insertPrimaryAgentProfileBinding(harness, {
        agentControllerConversationId: "conversation-source-mismatch",
        agentControllerRef: "builtin:codex",
        agentProfileId,
        bindingId: "binding-source-mismatch",
        nowMs: observedAtMs,
        openMeldServiceRuntimeId: registration.openMeldServiceRuntimeId.value,
        ownerId: "owner-1",
      });
      const createReport = (offsetMs: number) => ({
        agentControllerInterface: createAvailableUsageInterface(),
        agentControllerRef: "builtin:codex",
        expiresAtMs: observedAtMs + 60_000 + offsetMs,
        observedAtMs: observedAtMs + offsetMs,
        reasonCodes: ["runtime.agent_controller_report.ready"],
        status: "ready" as const,
      });

      const first = await rpcSubmitRuntimeAgentControllerReports(env, {
        context: DEFAULT_CONTEXT,
        deviceId: "device-1",
        lane: "openmeld-dev",
        reports: [createReport(0)],
        openMeldServiceRuntimeId: registration.openMeldServiceRuntimeId,
      });
      const retry = await rpcSubmitRuntimeAgentControllerReports(env, {
        context: DEFAULT_CONTEXT,
        deviceId: "device-1",
        lane: "openmeld-dev",
        reports: [createReport(1)],
        openMeldServiceRuntimeId: registration.openMeldServiceRuntimeId,
      });

      expect(first.reports[0]).toMatchObject({ status: "accepted" });
      expect(retry.reports[0]).toMatchObject({ status: "accepted" });
      expect(markUsageAvailable).toHaveBeenCalledTimes(2);
      expect(readRecovery).toHaveBeenCalledTimes(scenario === "usage" ? 1 : 2);
      if (scenario === "scope-changed") {
        expect(startContinuation).not.toHaveBeenCalled();
        expect(markContinuationNeedsAttention).not.toHaveBeenCalled();
        return;
      }
      expect(startContinuation).toHaveBeenCalledOnce();
      if (scenario === "occupied") {
        expect(startContinuation).toHaveBeenCalledWith(
          expect.objectContaining({
            contextSelection: { mode: "fork", sourceWakeId: "twl-interrupted" },
          })
        );
      }
      expect(markContinuationNeedsAttention).toHaveBeenCalledOnce();
      expect(markContinuationNeedsAttention).toHaveBeenCalledWith({
        expectedInterruptedTargetWakeLifecycleId: "twl-interrupted",
        ownerUserId: "owner-1",
        targetProfileId: agentProfileId,
      });
      expect(approveQueuedWork).not.toHaveBeenCalled();
      expect(skipInterruptedWork).not.toHaveBeenCalled();
    } finally {
      await harness.close();
    }
  });

  it("keeps recovery reads without an exact lifecycle retryable while isolating later reports", async () => {
    const harness = await createPostgresHarness();
    try {
      const agentProfileId = buildTestAgentProfileId(1);
      const markContinuationNeedsAttention = vi.fn().mockResolvedValue({
        status: "marked",
      });
      const ownerShard = {
        rpcMarkAgentProfileWorkUsageAvailable: vi.fn().mockResolvedValue({
          changedProfileIds: [agentProfileId],
          continuationProfileIds: [agentProfileId],
          status: "updated",
        }),
        rpcMarkAgentProfileWorkContinuationNeedsAttention:
          markContinuationNeedsAttention,
        rpcReadAgentProfileWorkRecovery: vi
          .fn()
          .mockRejectedValueOnce(new Error("recovery read failed"))
          .mockRejectedValueOnce(
            createCoreRpcHttpError({
              code: "agent_profile_work_recovery.continuation_outcome_unknown",
              reason: "OpenMeld is still confirming the continuation.",
              status: 503,
            })
          )
          .mockRejectedValueOnce(
            createCoreRpcHttpError({
              code: "agent_profile_work_recovery.continuation_unavailable",
              reason: "The accepted Agent configuration changed.",
              status: 409,
            })
          ),
      };
      const env = {
        ...coreEnv(harness.db),
        OPENMELD_RUNTIME_TRANSPORT: {
          get: vi.fn(() => ownerShard),
          idFromName: vi.fn((name: string) => name),
        },
      } as unknown as CoreBindings;
      const registration = await rpcSubmitRuntimeRegistration(env, {
        context: DEFAULT_CONTEXT,
        deviceId: "device-1",
        lane: "openmeld-dev",
      });
      if (!registration.openMeldServiceRuntimeId) {
        throw new Error(
          "test registration did not return openMeldServiceRuntimeId"
        );
      }
      const observedAtMs = Date.now();
      await insertPrimaryAgentProfileBinding(harness, {
        agentControllerConversationId: "conversation-recovery-failure",
        agentControllerRef: "builtin:codex",
        agentProfileId,
        bindingId: "binding-recovery-failure",
        nowMs: observedAtMs,
        openMeldServiceRuntimeId: registration.openMeldServiceRuntimeId.value,
        ownerId: "owner-1",
      });
      const createReport = (offsetMs: number) => ({
        agentControllerInterface: createAvailableUsageInterface(),
        agentControllerRef: "builtin:codex",
        expiresAtMs: observedAtMs + 60_000 + offsetMs,
        observedAtMs: observedAtMs + offsetMs,
        reasonCodes: ["runtime.agent_controller_report.ready"],
        status: "ready" as const,
      });

      const result = await rpcSubmitRuntimeAgentControllerReports(env, {
        context: DEFAULT_CONTEXT,
        deviceId: "device-1",
        lane: "openmeld-dev",
        reports: [createReport(0), createReport(1), createReport(2)],
        openMeldServiceRuntimeId: registration.openMeldServiceRuntimeId,
      });

      expect(result.reports).toHaveLength(3);
      expect(result.reports).toEqual([
        expect.objectContaining({ status: "accepted" }),
        expect.objectContaining({ status: "accepted" }),
        expect.objectContaining({ status: "accepted" }),
      ]);
      expect(markContinuationNeedsAttention).not.toHaveBeenCalled();
    } finally {
      await harness.close();
    }
  });

  it("rejects stale, out-of-order, conflicting, and lookup-derived Runtime Agent Controller Reports", async () => {
    const harness = await createPostgresHarness();
    try {
      const env = coreEnv(harness.db);
      const registration = await rpcSubmitRuntimeRegistration(env, {
        context: DEFAULT_CONTEXT,
        deviceId: "device-1",
        lane: "openmeld-dev",
      });
      if (!registration.openMeldServiceRuntimeId) {
        throw new Error(
          "test registration did not return openMeldServiceRuntimeId"
        );
      }
      const observedAtMs = Date.now();

      await rpcSubmitRuntimeAgentControllerReports(env, {
        context: DEFAULT_CONTEXT,
        deviceId: "device-1",
        lane: "openmeld-dev",
        reports: [
          {
            agentControllerRef: "builtin:codex",
            expiresAtMs: observedAtMs + 60_000,
            observedAtMs,
            reasonCodes: ["runtime.agent_controller_report.ready"],
            status: "ready",
          },
        ],
        openMeldServiceRuntimeId: registration.openMeldServiceRuntimeId,
      });

      await expect(
        rpcSubmitRuntimeAgentControllerReports(env, {
          context: DEFAULT_CONTEXT,
          deviceId: "device-1",
          lane: "openmeld-dev",
          reports: [
            {
              agentControllerRef: "builtin:codex",
              expiresAtMs: observedAtMs - 1,
              observedAtMs: observedAtMs - 2,
              status: "ready",
            },
          ],
          openMeldServiceRuntimeId: registration.openMeldServiceRuntimeId,
        })
      ).resolves.toMatchObject({
        reports: [
          {
            reason: "stale",
            status: "rejected",
          },
        ],
        status: "rejected",
      });

      await expect(
        rpcSubmitRuntimeAgentControllerReports(env, {
          context: DEFAULT_CONTEXT,
          deviceId: "device-1",
          lane: "openmeld-dev",
          reports: [
            {
              agentControllerRef: "builtin:codex",
              expiresAtMs: observedAtMs + 60_000,
              observedAtMs: observedAtMs - 1,
              status: "unavailable",
            },
          ],
          openMeldServiceRuntimeId: registration.openMeldServiceRuntimeId,
        })
      ).resolves.toMatchObject({
        reports: [
          {
            reason: "out_of_order",
            status: "rejected",
          },
        ],
        status: "rejected",
      });

      await expect(
        rpcSubmitRuntimeAgentControllerReports(env, {
          context: DEFAULT_CONTEXT,
          deviceId: "device-1",
          lane: "openmeld-dev",
          reports: [
            {
              agentControllerRef: "builtin:codex",
              expiresAtMs: observedAtMs + 60_000,
              observedAtMs,
              status: "disabled",
            },
          ],
          openMeldServiceRuntimeId: registration.openMeldServiceRuntimeId,
        })
      ).resolves.toMatchObject({
        reports: [
          {
            reason: "conflict",
            status: "rejected",
          },
        ],
        status: "rejected",
      });

      await expect(
        rpcSubmitRuntimeAgentControllerReports(env, {
          context: DEFAULT_CONTEXT,
          deviceId: "device-1",
          lane: "openmeld-dev",
          reports: [
            {
              agentControllerRef: "builtin:codex",
              expiresAtMs: observedAtMs + 60_000,
              observedAtMs: observedAtMs + 1,
              status: "ready",
            },
          ],
          openMeldServiceRuntimeId: {
            source: "runtime_registry_authority",
            value: "owner_account:owner-1:device-1:openmeld-dev",
          },
        })
      ).resolves.toEqual({
        reports: [
          {
            agentControllerRef: "builtin:codex",
            reason: "openmeld_service_runtime_id_invalid",
            status: "rejected",
          },
        ],
        status: "rejected",
      });

      await expect(
        rpcSubmitRuntimeAgentControllerReports(env, {
          context: DEFAULT_CONTEXT,
          deviceId: "device-1",
          lane: "openmeld-dev",
          reports: [
            {
              agentControllerRef: "builtin:codex",
              expiresAtMs: observedAtMs + 60_000,
              observedAtMs: observedAtMs + 1,
              status: "ready",
            },
          ],
          openMeldServiceRuntimeId: {
            source: "runtime_registry_authority",
            value: "runtime_opaque_attacker",
          },
        })
      ).resolves.toEqual({
        reports: [
          {
            agentControllerRef: "builtin:codex",
            reason: "openmeld_service_runtime_id_mismatch",
            status: "rejected",
          },
        ],
        status: "rejected",
      });
    } finally {
      await harness.close();
    }
  });

  it("rejects invalid Agent Controller refs without accepting a Runtime Agent Controller Report", async () => {
    const harness = await createPostgresHarness();
    try {
      const env = coreEnv(harness.db);
      const registration = await rpcSubmitRuntimeRegistration(env, {
        context: DEFAULT_CONTEXT,
        deviceId: "device-1",
        lane: "openmeld-dev",
      });
      if (!registration.openMeldServiceRuntimeId) {
        throw new Error(
          "test registration did not return openMeldServiceRuntimeId"
        );
      }
      const observedAtMs = Date.now();

      await expect(
        rpcSubmitRuntimeAgentControllerReports(env, {
          context: DEFAULT_CONTEXT,
          deviceId: "device-1",
          lane: "openmeld-dev",
          reports: [
            {
              agentControllerRef: "builtin:bad id",
              expiresAtMs: observedAtMs + 60_000,
              observedAtMs,
              status: "ready",
            },
          ],
          openMeldServiceRuntimeId: registration.openMeldServiceRuntimeId,
        })
      ).resolves.toMatchObject({
        reports: [
          {
            agentControllerRef: "builtin:bad id",
            reason: "agent_controller_ref_invalid",
            status: "rejected",
          },
        ],
        status: "rejected",
      });
    } finally {
      await harness.close();
    }
  });

  it("accepts a Provider Conversation Proof and reuses an identical retry", async () => {
    const harness = await createPostgresHarness();
    try {
      const env = coreEnv(harness.db);
      const registration = await rpcSubmitRuntimeRegistration(env, {
        context: DEFAULT_CONTEXT,
        deviceId: "device-1",
        lane: "openmeld-dev",
      });
      if (!registration.openMeldServiceRuntimeId) {
        throw new Error(
          "test registration did not return openMeldServiceRuntimeId"
        );
      }
      const observedAtMs = Date.now();
      const expiresAtMs = observedAtMs + 60_000;
      await insertPrimaryAgentProfileBinding(harness, {
        agentControllerConversationId: "019d8ac0-46e2-78e2-9f4a-a41b3a6674c8",
        agentControllerRef: "builtin:codex",
        agentProfileId: "agt_00000000-0000-4000-8000-000000000001",
        openMeldServiceRuntimeId: registration.openMeldServiceRuntimeId.value,
        bindingId: "binding_1",
        nowMs: observedAtMs,
        ownerId: "owner-1",
      });

      const first = await rpcSubmitRuntimeProviderConversationProofs(env, {
        context: DEFAULT_CONTEXT,
        deviceId: "device-1",
        lane: "openmeld-dev",
        proofs: [
          {
            agentProfileId: "agt_00000000-0000-4000-8000-000000000001",
            bindingId: "binding_1",
            agentControllerRef: "builtin:codex",
            agentControllerConversationId:
              "019d8ac0-46e2-78e2-9f4a-a41b3a6674c8",
            transportMode: "codex-app-server",
            provider: "codex",
            method: "codex_app_server_thread_read",
            intrusive: false,
            observedAtMs,
            expiresAtMs,
            status: "passed",
          },
        ],
        openMeldServiceRuntimeId: registration.openMeldServiceRuntimeId,
      });
      const retry = await rpcSubmitRuntimeProviderConversationProofs(env, {
        context: DEFAULT_CONTEXT,
        deviceId: "device-1",
        lane: "openmeld-dev",
        proofs: [
          {
            agentProfileId: "agt_00000000-0000-4000-8000-000000000001",
            bindingId: "binding_1",
            agentControllerRef: "builtin:codex",
            agentControllerConversationId:
              "019d8ac0-46e2-78e2-9f4a-a41b3a6674c8",
            transportMode: "codex-app-server",
            provider: "codex",
            method: "codex_app_server_thread_read",
            intrusive: false,
            observedAtMs,
            expiresAtMs,
            status: "passed",
          },
        ],
        openMeldServiceRuntimeId: registration.openMeldServiceRuntimeId,
      });

      expect(first).toMatchObject({
        proofs: [
          {
            agentProfileId: "agt_00000000-0000-4000-8000-000000000001",
            bindingId: "binding_1",
            outcome: "created",
            status: "accepted",
          },
        ],
        status: "accepted",
      });
      expect(retry).toMatchObject({
        proofs: [
          {
            outcome: "reused",
            status: "accepted",
          },
        ],
        status: "accepted",
      });
      expect(
        await harness.queryFirst<{
          status: string;
          intrusive: number;
        }>({
          text: `
            SELECT status, intrusive
            FROM "openmeld"."openMeldDaemon_provider_conversation_proofs"
            WHERE agent_profile_id = $1
              AND binding_id = $2
          `,
          values: ["agt_00000000-0000-4000-8000-000000000001", "binding_1"],
        })
      ).toEqual({
        status: "passed",
        intrusive: 0,
      });
    } finally {
      await harness.close();
    }
  });

  it("rejects Provider Conversation Proofs that do not match the primary binding", async () => {
    const harness = await createPostgresHarness();
    try {
      const env = coreEnv(harness.db);
      const registration = await rpcSubmitRuntimeRegistration(env, {
        context: DEFAULT_CONTEXT,
        deviceId: "device-1",
        lane: "openmeld-dev",
      });
      if (!registration.openMeldServiceRuntimeId) {
        throw new Error(
          "test registration did not return openMeldServiceRuntimeId"
        );
      }
      const observedAtMs = Date.now();
      await insertPrimaryAgentProfileBinding(harness, {
        agentControllerConversationId: "019d8ac0-46e2-78e2-9f4a-a41b3a6674c8",
        agentControllerRef: "builtin:codex",
        agentProfileId: "agt_00000000-0000-4000-8000-000000000001",
        openMeldServiceRuntimeId: registration.openMeldServiceRuntimeId.value,
        bindingId: "binding_1",
        nowMs: observedAtMs,
        ownerId: "owner-1",
      });

      await expect(
        rpcSubmitRuntimeProviderConversationProofs(env, {
          context: DEFAULT_CONTEXT,
          deviceId: "device-1",
          lane: "openmeld-dev",
          proofs: [
            {
              agentProfileId: "agt_00000000-0000-4000-8000-000000000001",
              bindingId: "binding_1",
              agentControllerRef: "builtin:codex",
              agentControllerConversationId: "different-thread",
              transportMode: "codex-app-server",
              provider: "codex",
              method: "codex_app_server_thread_resume",
              intrusive: false,
              observedAtMs,
              expiresAtMs: observedAtMs + 60_000,
              status: "passed",
            },
          ],
          openMeldServiceRuntimeId: registration.openMeldServiceRuntimeId,
        })
      ).resolves.toMatchObject({
        proofs: [
          {
            reason: "agent_profile_binding_mismatch",
            status: "rejected",
          },
        ],
        status: "rejected",
      });
    } finally {
      await harness.close();
    }
  });
});

function coreEnv(db: PostgresDatabase): CoreBindings {
  return {
    OPENMELD_POSTGRESQL: postgresTestBinding(db),
    OPENMELD_SPACES: {} as CoreBindings["OPENMELD_SPACES"],
  };
}

function buildTestAgentProfileId(index: number): string {
  return `agt_00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
}

async function insertPrimaryAgentProfileBinding(
  harness: Awaited<ReturnType<typeof createPostgresHarness>>,
  input: {
    agentControllerConversationId: string;
    agentControllerRef: string;
    agentProfileId: string;
    openMeldServiceRuntimeId: string;
    bindingId: string;
    nowMs: number;
    ownerId: string;
  }
): Promise<void> {
  await harness.query({
    text: `INSERT INTO "openmeld"."users" (id,name,email) VALUES ($1,'Owner',$1::text||'@example.com') ON CONFLICT (id) DO NOTHING`,
    values: [input.ownerId],
  });
  await harness.query({
    text: `INSERT INTO "openmeld"."organizations" (id,name,slug,created_at) VALUES ('org-1','Organization','org-1',1700000000000) ON CONFLICT (id) DO NOTHING`,
  });
  await harness.query({
    text: `INSERT INTO "openmeld"."openmeld_profiles" (profile_id,profile_name,profile_handle,profile_kind,organization_id,owner_user_id,source) VALUES ($1,'Agent',$1,'agent','org-1',$2,'migration') ON CONFLICT (profile_id) DO NOTHING`,
    values: [input.agentProfileId, input.ownerId],
  });
  await harness.query({
    text: `
      INSERT INTO "openmeld"."openMeldDaemon_agent_profile_bindings" (
        binding_id,
        owner_kind,
        owner_id,
        agent_profile_id,
        openmeld_service_runtime_id,
        agent_controller_ref,
        agent_controller_conversation_id,
        binding_state,
        created_at_ms,
        updated_at_ms
      )
      VALUES ($1, 'owner_account', $2, $3, $4, $5, $6, 'enabled_primary', $7, $8)
    `,
    values: [
      input.bindingId,
      input.ownerId,
      input.agentProfileId,
      input.openMeldServiceRuntimeId,
      input.agentControllerRef,
      input.agentControllerConversationId,
      input.nowMs,
      input.nowMs,
    ],
  });
}

function createAvailableUsageInterface() {
  const observedAt = new Date().toISOString();
  return {
    agentControllerRef: "builtin:codex",
    auth: { status: "authenticated" as const },
    capabilities: {
      approvals: true,
      cancel: true,
      interrupt: true,
      modelSelection: true,
      nativeEventStream: true,
      permissionModes: true,
      structuredUserInput: true,
    },
    checkedAt: observedAt,
    controllerId: "codex",
    displayName: "Codex",
    launch: {
      argsPrefix: [],
      commandPath: "/usr/local/bin/codex",
      installChoiceCount: 1,
      status: "ready" as const,
    },
    message: null,
    models: [],
    nativeInterface: "codex-app-server" as const,
    schemaVersion: 1 as const,
    skills: [],
    status: "ready" as const,
    usageLimits: [
      {
        key: "five_hour",
        label: "5-hour Usage Limit",
        observedAt,
        resetsAt: new Date(Date.now() + 60_000).toISOString(),
        status: "available" as const,
        usedPercent: 42,
      },
    ],
    usageLimitsSupportMatrixVersion:
      AGENT_CONTROLLER_USAGE_LIMIT_SUPPORT_MATRIX_VERSION,
    version: "1.0.0",
  } satisfies AgentControllerInterfaceSnapshot;
}
