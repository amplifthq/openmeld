import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createInflightTaskControlRegistry,
  createPendingAgentInteractionRegistry,
} from "@openmeld/local-service";
import {
  RUNTIME_COORDINATOR_EXECUTION_TOKEN_MODEL_VERSION,
  RUNTIME_EXECUTION_IDENTITY_MODEL_VERSION,
} from "@openmeld/schemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LedgerPaths } from "../src/local-service/core/types";
import { handleDispatchDeliverFrame } from "../src/local-service/dispatch/execute-dispatch-task";
import type { Presenter } from "../src/runtime/presenter/types";

const RUNTIME_COORDINATOR_EXECUTION_ID =
  "rce_space-1_dispatch-1_agent-profile-1";

function createPresenter(): Presenter {
  return {
    data: () => undefined,
    event: () => undefined,
    line: () => undefined,
    view: "human",
  };
}

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function createLedgerPaths(): LedgerPaths {
  const rootDirPath = mkdtempSync(
    join(tmpdir(), "openmeld-token-backed-start-")
  );
  tempDirs.push(rootDirPath);
  return {
    backupStateFilePath: join(rootDirPath, "backup.json"),
    historyFilePath: join(rootDirPath, "history.json"),
    historyTempFilePath: join(rootDirPath, "history.tmp.json"),
    rootDirPath,
    stateFilePath: join(rootDirPath, "state.json"),
    stateTempFilePath: join(rootDirPath, "state.tmp.json"),
  };
}

function createDeliveryExecutionIdentity() {
  return {
    authority: "core_runtime_registry_binding_route" as const,
    core: {
      modelVersion: RUNTIME_EXECUTION_IDENTITY_MODEL_VERSION,
      spaceId: "space-1",
      dispatchId: "dispatch-1",
      targetProfileId: "agent-profile-1",
      openMeldServiceRuntimeId: {
        source: "runtime_registry_authority" as const,
        value: "runtime-1",
      },
      bindingId: "binding-1",
      agentControllerRef: "builtin:codex",
    },
  };
}

function createDeliverRequest() {
  return {
    v: 1 as const,
    dispatchId: "dispatch-1",
    attemptId: "attempt-1",
    ownerUserId: "user-1",
    profileId: "agent-profile-1",
    daemonSessionId: "daemon-session-1",
    connectionGeneration: 1,
    leaseEpoch: 1,
    payload: {
      attemptId: "attempt-1",
      dispatchContractVersion: 2,
      dispatchPolicy: "mention_only" as const,
      controllerSnapshot: {
        targetBindingState: "bound" as const,
        targetBindingEnabled: true,
        agentControllerRef: "builtin:codex",
      },
      contextIdMappingSpec: null,
      dispatchId: "dispatch-1",
      runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      executionIdentity: createDeliveryExecutionIdentity(),
      executionToken: {
        authorityScope: {
          bindingId: "binding-1",
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: "runtime-1",
        },
        deliveryIdempotencyKey: `${RUNTIME_COORDINATOR_EXECUTION_ID}:run-1`,
        deliveryProvenance: {
          connectionGeneration: 1,
          daemonSessionId: "daemon-session-1",
          leaseEpoch: 1,
        },
        executionScope: {
          dispatchId: "dispatch-1",
          runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
          sourceClientMessageId: "client-message-1",
          spaceId: "space-1",
          targetProfileId: "agent-profile-1",
        },
        executionToken:
          "rcet_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        expiresAtMs: null,
        issuedAtMs: 1_700_000_000_000,
        modelVersion: RUNTIME_COORDINATOR_EXECUTION_TOKEN_MODEL_VERSION,
        runId: "run-1",
        tokenFingerprint: "etfp_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        tokenStatus: "active" as const,
      },
      dispatchRulesSnapshot: {
        dispatchPolicy: "mention_only" as const,
        ruleSource: "registry" as const,
        ruleId: "registry.default.all_members.v1",
        ruleReason: "default allow all members mention",
      },
      enqueuedAtMs: 1_700_000_000_000,
      idempotencyKey: "dispatch-1:target:agent-profile-1",
      sourceEventId: "signal-1",
      sourceClientMessageId: "client-message-1",
      sourceSignal: {
        profileId: "user-profile-1",
        profileKind: "human" as const,
        text: "ping",
      },
      sourceSignalSnapshot: {
        profileId: "user-profile-1",
        profileKind: "human" as const,
        text: "ping",
      },
      spaceId: "space-1",
      streamingMode: "final" as const,
      targetProfileId: "agent-profile-1",
      taskId: "task-1",
      transportMode: "local-cli" as const,
    },
  };
}

describe("local service token-backed execution start", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("does not use final claim rejection semantics for the current token-backed task", async () => {
    const socketSend = vi.fn();
    const socket = { send: socketSend } as never;

    const result = await handleDispatchDeliverFrame({
      computerFileAccessStorePath:
        "/tmp/openmeld-test-missing-computer-file-access-policy.json",
      contextStore: new Map(),
      currentSocketRef: { connectionGeneration: 1, socket },
      daemonSessionId: "daemon-session-1",
      deliverRequest: createDeliverRequest(),
      inflightDispatchMetaByTaskId: new Map(),
      inflightTaskControlRegistry: createInflightTaskControlRegistry(),
      pendingAgentInteractionRegistry: createPendingAgentInteractionRegistry(),
      ledgerPaths: createLedgerPaths(),
      leasesByProfileId: new Map([["agent-profile-1", 1]]),
      localAdapterContainer: {
        getAdapter: () => null,
      } as never,
      profileOwnerName: "Owner",
      profileOwnerUserId: "user-1",
      presenter: createPresenter(),
      routeByProfileId: new Map(),
      socket,
    });

    expect(result).toMatchObject({
      errorCode: "controller.kind.unsupported",
      result: "failed",
    });
    const resultFrame = socketSend.mock.calls
      .map(([frame]) => JSON.parse(String(frame)))
      .find((frame) => frame.code === "daemon.dispatch.result");
    const runtimeEvidenceFrames = socketSend.mock.calls
      .map(([frame]) => JSON.parse(String(frame)))
      .filter((frame) => frame.code === "daemon.dispatch.runtime_evidence");
    expect(resultFrame?.payload.taskResult.payload).toMatchObject({
      errorCode: "controller.kind.unsupported",
      status: "failed",
    });
    expect(resultFrame?.payload.taskResult.payload.claimLease).toBeUndefined();
    expect(resultFrame?.payload.taskResult.payload.status).not.toBe("success");
    expect(resultFrame?.payload.executionTokenEcho).toMatchObject({
      executionToken:
        "rcet_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      runId: "run-1",
      runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
      tokenFingerprint: "etfp_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    expect(runtimeEvidenceFrames.map((frame) => frame.payload.phase)).toEqual([
      "failed",
    ]);
    expect(runtimeEvidenceFrames[0]?.payload).not.toHaveProperty(
      "claimLeaseId"
    );
    expect(runtimeEvidenceFrames[0]?.payload).toMatchObject({
      dispatchId: "dispatch-1",
      executionTokenEcho: {
        executionToken:
          "rcet_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        runId: "run-1",
        runtimeCoordinatorExecutionId: RUNTIME_COORDINATOR_EXECUTION_ID,
        tokenFingerprint: "etfp_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
      phase: "failed",
      reasonCode: "controller.kind.unsupported",
      sourceClientMessageId: "client-message-1",
      sourceSignalId: "signal-1",
      spaceId: "space-1",
      targetProfileId: "agent-profile-1",
    });
  });

  it("does not attach legacy claim lease evidence when handling unsupported-controller diagnostics", async () => {
    const socketSend = vi.fn();
    const socket = { send: socketSend } as never;

    const result = await handleDispatchDeliverFrame({
      computerFileAccessStorePath:
        "/tmp/openmeld-test-missing-computer-file-access-policy.json",
      contextStore: new Map(),
      currentSocketRef: { connectionGeneration: 1, socket },
      daemonSessionId: "daemon-session-1",
      deliverRequest: createDeliverRequest(),
      inflightDispatchMetaByTaskId: new Map(),
      inflightTaskControlRegistry: createInflightTaskControlRegistry(),
      pendingAgentInteractionRegistry: createPendingAgentInteractionRegistry(),
      ledgerPaths: createLedgerPaths(),
      leasesByProfileId: new Map([["agent-profile-1", 1]]),
      localAdapterContainer: {
        getAdapter: () => null,
      } as never,
      profileOwnerName: "Owner",
      profileOwnerUserId: "user-1",
      presenter: createPresenter(),
      routeByProfileId: new Map(),
      socket,
    });

    const resultFrame = socketSend.mock.calls
      .map(([frame]) => JSON.parse(String(frame)))
      .find((frame) => frame.code === "daemon.dispatch.result");
    const runtimeEvidenceFrames = socketSend.mock.calls
      .map(([frame]) => JSON.parse(String(frame)))
      .filter((frame) => frame.code === "daemon.dispatch.runtime_evidence");

    expect(result).toMatchObject({
      errorCode: "controller.kind.unsupported",
      result: "failed",
    });
    expect(result.errorMessage).toContain("controller.kind.unsupported:");
    expect(resultFrame?.payload.taskResult.payload).toMatchObject({
      errorCode: "controller.kind.unsupported",
      status: "failed",
    });
    expect(resultFrame?.payload.taskResult.payload.claimLease).toBeUndefined();
    expect(resultFrame?.payload.taskResult.payload.status).not.toBe("success");
    expect(resultFrame?.payload.executionTokenEcho?.executionToken).toBe(
      "rcet_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    );
    expect(runtimeEvidenceFrames.map((frame) => frame.payload.phase)).toEqual([
      "failed",
    ]);
    expect(runtimeEvidenceFrames[0]?.payload).not.toHaveProperty(
      "claimLeaseId"
    );
    expect(runtimeEvidenceFrames[0]?.payload).toMatchObject({
      executionIdentityEcho: {
        echoSource: "daemon_delivery_context",
        core: {
          bindingId: "binding-1",
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: {
            source: "runtime_registry_authority",
            value: "runtime-1",
          },
        },
      },
    });
  });
});
