import { RUNTIME_EXECUTION_IDENTITY_MODEL_VERSION } from "@openmeld/schemas";
import type { RuntimeTransportDispatchRuntimeEvidenceRequest } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { validateDaemonDispatchRuntimeEvidence } from "../src/runtime-transport/application/daemon-runtime-evidence";
import type { PendingDispatchState } from "../src/runtime-transport/application/runtime-transport-state";

const baseEvidence: RuntimeTransportDispatchRuntimeEvidenceRequest = {
  v: 1,
  dispatchId: "dispatch-1",
  attemptId: "attempt-1",
  executionIdentityEcho: {
    echoSource: "daemon_delivery_context",
    core: {
      modelVersion: RUNTIME_EXECUTION_IDENTITY_MODEL_VERSION,
      spaceId: "space-1",
      dispatchId: "dispatch-1",
      targetProfileId: "agent-profile-1",
      openMeldServiceRuntimeId: {
        source: "runtime_registry_authority",
        value: "runtime-1",
      },
      bindingId: "binding-1",
      agentControllerRef: "builtin:codex",
    },
  },
  daemonSessionId: "daemon-session-1",
  connectionGeneration: 1,
  leaseEpoch: 2,
  phase: "runtime_started",
  evidenceAtMs: 1_700_000_000_123,
  taskId: "task-1",
  spaceId: "space-1",
  sourceSignalId: "signal-1",
  sourceClientMessageId: "client-message-1",
  targetProfileId: "agent-profile-1",
};

function buildPendingDispatch(
  overrides: Partial<PendingDispatchState> = {}
): PendingDispatchState {
  return {
    acceptedLocalAtMs: null,
    attemptId: "attempt-1",
    completedLocalAtMs: null,
    connectionGeneration: 1,
    createdAtMs: 1_700_000_000_000,
    daemonSessionId: "daemon-session-1",
    dispatchId: "dispatch-1",
    executionIdentity: {
      authority: "core_runtime_registry_binding_route",
      core: baseEvidence.executionIdentityEcho.core,
    },
    lastLifecycleAtMs: 1_700_000_000_000,
    leaseEpoch: 2,
    phase: "starting",
    profileId: "agent-profile-1",
    runningAtMs: null,
    spaceAccess: {} as never,
    spaceId: "space-1",
    targetProfileName: null,
    taskId: "task-1",
    ...overrides,
    runtimeCoordinatorExecutionId:
      overrides.runtimeCoordinatorExecutionId ?? "rce-dispatch-1",
    sourceClientMessageId:
      overrides.sourceClientMessageId ?? "client-message-1",
    sourceSignalId: overrides.sourceSignalId ?? "signal-1",
  };
}

describe("daemon runtime evidence validation", () => {
  it("accepts evidence for the pending dispatch lease", () => {
    expect(
      validateDaemonDispatchRuntimeEvidence({
        evidence: baseEvidence,
        pending: buildPendingDispatch(),
      })
    ).toEqual({ ok: true });
  });

  it("rejects evidence for a stale daemon lease", () => {
    expect(
      validateDaemonDispatchRuntimeEvidence({
        evidence: baseEvidence,
        pending: buildPendingDispatch({ leaseEpoch: 3 }),
      })
    ).toEqual({ ok: false, reasonCode: "daemon.session.stale_lease" });
  });

  it("rejects evidence that does not match the pending dispatch identity", () => {
    expect(
      validateDaemonDispatchRuntimeEvidence({
        evidence: baseEvidence,
        pending: buildPendingDispatch({ taskId: "different-task" }),
      })
    ).toEqual({ ok: false, reasonCode: "schema.invalid" });
  });
});
