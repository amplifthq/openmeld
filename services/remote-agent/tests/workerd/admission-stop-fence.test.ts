import { runInDurableObject } from "cloudflare:test";
import { buildRemoteAgentRuntimeConversationId } from "@openmeld/schemas";
import { expect, it } from "vitest";
import {
  assertRemoteAgentExecutionCanContinue,
  completeRemoteAgentExecutionState,
  initializeRemoteAgentExecutionState,
  readRemoteAgentAdmissionStopIntent,
  readRemoteAgentExecutionState,
  requestRemoteAgentExecutionCancellation,
} from "../../agent-core/execution-state";
import {
  buildRemoteAgentName,
  type RemoteAgentAdmissionHost,
  readRemoteAgentAdmission,
  readRemoteAgentAdmissionStop,
  submitRemoteAgentConversationTurn,
} from "../../agent-core/submission";
import { createRemoteAgentSqlStorage } from "../../flue-adapter/storage";
import {
  createSubmitTurnRequest,
  createSubmitTurnRequestV2,
} from "../fixtures";
import { env } from "./worker-env";

it("retains recovery provenance across SQL reconstruction and strengthens it on user Stop", async () => {
  const namespace = (env as { COMPUTER_PROBE: DurableObjectNamespace })
    .COMPUTER_PROBE;
  const result = await runInDurableObject(
    namespace.get(namespace.newUniqueId()),
    async (_instance, state) => {
      const identity = {
        v: 1 as const,
        organizationId: "recovery-org",
        spaceId: "recovery-space",
        idempotencyKey: "old-failed-summary",
        submissionId: "failed-summary",
      };
      const storage = createRemoteAgentSqlStorage(state.storage.sql);
      await initializeRemoteAgentExecutionState({
        identity,
        storage,
        acceptedAtMs: 100,
      });
      await completeRemoteAgentExecutionState({
        identity,
        storage,
        nowMs: 200,
        status: "failed",
        terminalFailure: {
          code: "remote_agent.turn_not_completed",
          reasonCode: "remote_agent.turn_not_completed",
        },
      });
      await requestRemoteAgentExecutionCancellation({
        identity,
        storage,
        nowMs: 300,
        summaryRecoveryId: "summary:original",
      });
      const reconstructed = createRemoteAgentSqlStorage(state.storage.sql);
      const ownFence = await readRemoteAgentAdmissionStopIntent({
        identity,
        storage: reconstructed,
      });
      await Promise.all([
        requestRemoteAgentExecutionCancellation({
          identity,
          storage: reconstructed,
          nowMs: 400,
          summaryRecoveryId: "summary:original",
        }),
        requestRemoteAgentExecutionCancellation({
          identity,
          storage: reconstructed,
          nowMs: 400,
        }),
      ]);
      await requestRemoteAgentExecutionCancellation({
        identity,
        storage: reconstructed,
        nowMs: 500,
        summaryRecoveryId: "summary:original",
      });
      return {
        ownFence,
        userFence: await readRemoteAgentAdmissionStopIntent({
          identity,
          storage: reconstructed,
        }),
        execution: await readRemoteAgentExecutionState({
          identity,
          storage: reconstructed,
        }),
      };
    }
  );
  expect(result.ownFence).toMatchObject({
    summaryRecoveryId: "summary:original",
  });
  expect(result.userFence).not.toHaveProperty("summaryRecoveryId");
  expect(result.execution).toMatchObject({
    status: "found",
    execution: { status: "failed", completedAtMs: 200 },
  });
});

it("retains a Stop with no execution across native SQL owner reconstruction", async () => {
  const namespace = (env as { COMPUTER_PROBE: DurableObjectNamespace })
    .COMPUTER_PROBE;
  const stub = namespace.get(namespace.newUniqueId());
  const result = await runInDurableObject(stub, async (_instance, state) => {
    const identity = {
      v: 1 as const,
      organizationId: "stop-org",
      spaceId: "stop-space",
      idempotencyKey: "stopped-original-request",
      submissionId: "reserved-id",
    };
    const storage = createRemoteAgentSqlStorage(state.storage.sql);
    const stop = await requestRemoteAgentExecutionCancellation({
      identity,
      storage,
      nowMs: 100,
    });
    // The durable owner is reconstructed; no in-memory flag can carry Stop.
    const reconstructed = createRemoteAgentSqlStorage(state.storage.sql);
    const duplicate = await requestRemoteAgentExecutionCancellation({
      identity,
      storage: reconstructed,
      nowMs: 200,
    });
    const errors: string[] = [];
    for (const submissionId of ["reserved-id", "late-native-id"]) {
      const lateIdentity = { ...identity, submissionId };
      try {
        await initializeRemoteAgentExecutionState({
          identity: lateIdentity,
          storage: reconstructed,
          acceptedAtMs: 300,
        });
      } catch (error) {
        errors.push((error as Error).name);
      }
      try {
        await assertRemoteAgentExecutionCanContinue({
          identity: lateIdentity,
          storage: reconstructed,
        });
      } catch (error) {
        errors.push((error as Error).name);
      }
    }
    const original = await readRemoteAgentExecutionState({
      identity,
      storage: reconstructed,
    });
    const other = await initializeRemoteAgentExecutionState({
      identity: {
        ...identity,
        idempotencyKey: "another-request",
        submissionId: "another-id",
      },
      storage: reconstructed,
      acceptedAtMs: 300,
    });
    return { stop, duplicate, errors, original, otherStatus: other.status };
  });
  expect(result).toEqual({
    stop: { status: "not_found" },
    duplicate: { status: "not_found" },
    errors: new Array(4).fill("RemoteAgentExecutionCancelledError"),
    original: { status: "not_found" },
    otherStatus: "pending",
  });
});

it.each([
  "completed",
  "failed",
] as const)("persists the fence for a settled %s request without replacing its SQL history", async (status) => {
  const namespace = (env as { COMPUTER_PROBE: DurableObjectNamespace })
    .COMPUTER_PROBE;
  const stub = namespace.get(namespace.newUniqueId());
  const result = await runInDurableObject(stub, async (_instance, state) => {
    const storage = createRemoteAgentSqlStorage(state.storage.sql);
    const request = createSubmitTurnRequest({
      dispatchId: "settled-original",
      idempotencyKey: "settled-original",
    });
    const identity = {
      v: 1 as const,
      organizationId: request.organizationId,
      spaceId: request.spaceId,
      idempotencyKey: request.idempotencyKey,
      submissionId: request.dispatchId,
    };
    await initializeRemoteAgentExecutionState({
      acceptedAtMs: 100,
      identity,
      storage,
    });
    const completed = await completeRemoteAgentExecutionState({
      identity,
      nowMs: 200,
      storage,
      ...(status === "completed"
        ? { status: "completed" as const, completedText: "Retained result." }
        : {
            status: "failed" as const,
            terminalFailure: {
              code: "remote_agent.turn_not_completed",
              reasonCode: "remote_agent.turn_not_completed" as const,
            },
          }),
    });
    const stopped = await requestRemoteAgentExecutionCancellation({
      identity,
      storage,
      nowMs: 300,
    });
    const reconstructed = createRemoteAgentSqlStorage(state.storage.sql);
    const fence = await readRemoteAgentAdmissionStop({
      request,
      storage: reconstructed,
    });
    const retained = await readRemoteAgentExecutionState({
      identity,
      storage: reconstructed,
    });
    let lateError: string | null = null;
    try {
      await initializeRemoteAgentExecutionState({
        acceptedAtMs: 400,
        identity: { ...identity, submissionId: "late-original-copy" },
        storage: reconstructed,
      });
    } catch (error) {
      lateError = (error as Error).name;
    }
    const fresh = await initializeRemoteAgentExecutionState({
      acceptedAtMs: 400,
      identity: {
        ...identity,
        submissionId: "fresh-attempt",
        idempotencyKey: "fresh-attempt",
      },
      storage: reconstructed,
    });
    return { completed, stopped, fence, retained, lateError, fresh };
  });
  expect(result.stopped).toMatchObject({
    status: "not_stoppable",
    execution: { status },
  });
  expect(result.fence).toMatchObject({
    status: "found",
    stopIntent: { idempotencyKey: "settled-original" },
  });
  expect(result.retained).toMatchObject({
    status: "found",
    execution: result.completed,
  });
  expect(result.lateError).toBe("RemoteAgentExecutionCancelledError");
  expect(result.fresh).toMatchObject({ status: "pending" });
});

it.each([
  1, 4,
] as const)("admits exactly one new v%s request after Stop rejects the late original in the same native owner", async (version) => {
  const namespace = (env as { COMPUTER_PROBE: DurableObjectNamespace })
    .COMPUTER_PROBE;
  const stub = namespace.get(namespace.newUniqueId());
  const result = await runInDurableObject(stub, async (_instance, state) => {
    const nowMs = Date.now();
    const logicalConversationId = "center-agent-task:restart-fence";
    const original =
      version === 1
        ? createSubmitTurnRequest({
            dispatchId: "original-dispatch",
            idempotencyKey: "original-request",
            conversationId: logicalConversationId,
          })
        : {
            ...createSubmitTurnRequestV2(),
            v: 4 as const,
            conversationId: logicalConversationId,
            dispatchId: "original-dispatch",
            idempotencyKey: "original-request",
            runtimeConversation: {
              generation: 1,
              id: buildRemoteAgentRuntimeConversationId({
                generation: 1,
                logicalConversationId,
                organizationId: "org_123",
              }),
            },
          };
    const identity = {
      v: 1 as const,
      organizationId: original.organizationId,
      spaceId: original.spaceId,
      idempotencyKey: original.idempotencyKey,
      submissionId: original.dispatchId,
    };
    const storage = createRemoteAgentSqlStorage(state.storage.sql);
    await requestRemoteAgentExecutionCancellation({ identity, storage, nowMs });
    const reconstructed = createRemoteAgentSqlStorage(state.storage.sql);
    const fence = await readRemoteAgentAdmissionStop({
      request: original,
      storage: reconstructed,
    });
    const admitted: string[] = [];
    const host: RemoteAgentAdmissionHost = {
      admitConversationTurn: ({ request, submissionId }) => {
        admitted.push(request.idempotencyKey);
        return Promise.resolve({
          accepted: true,
          createdAt: nowMs,
          idempotencyKey: request.idempotencyKey,
          requestId: submissionId,
          status: "pending",
          submissionId,
        });
      },
    };
    const submit = (request: typeof original) =>
      submitRemoteAgentConversationTurn({
        agentName: buildRemoteAgentName(request),
        host,
        input: request,
        nowMs: () => nowMs,
        storage: reconstructed,
      });
    let lateError: string | null = null;
    try {
      await submit(original);
    } catch (error) {
      lateError = (error as Error).name;
    }
    const restarted = {
      ...original,
      dispatchId: "restart-dispatch",
      idempotencyKey: "restart-request",
    };
    const first = await submit(restarted);
    const repeated = await submit(restarted);
    const oldAdmission = await readRemoteAgentAdmission({
      request: original,
      storage: reconstructed,
    });
    const newAdmission = await readRemoteAgentAdmission({
      request: restarted,
      storage: reconstructed,
    });
    return {
      admitted,
      fence,
      lateError,
      oldAdmission,
      newAdmission,
      first: first.ack,
      repeated: repeated.ack,
    };
  });
  expect(result.fence).toMatchObject({
    status: "found",
    stopIntent: { idempotencyKey: "original-request" },
  });
  expect(result.lateError).toBe("RemoteAgentExecutionCancelledError");
  expect(result.oldAdmission).not.toMatchObject({ status: "found" });
  expect(result.admitted).toEqual(["restart-request"]);
  expect(result.first).toMatchObject({
    accepted: true,
    idempotencyKey: "restart-request",
    submissionId: "restart-dispatch",
  });
  expect(result.repeated).toMatchObject({
    accepted: false,
    idempotencyKey: "restart-request",
    submissionId: "restart-dispatch",
  });
  expect(result.newAdmission).toMatchObject({
    status: "found",
    ack: {
      idempotencyKey: "restart-request",
      submissionId: "restart-dispatch",
    },
  });
});
