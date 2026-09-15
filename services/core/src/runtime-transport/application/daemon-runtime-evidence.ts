import { isLeaseMatch } from "@openmeld/agent-runtime";
import type {
  RuntimeTransportDispatchRuntimeEvidenceRequest,
  RuntimeTransportDispatchToolActivityRequest,
} from "@openmeld/schemas/types";
import type { CoreBindings } from "../../lib/bindings";
import { emitCoreCloudflareRuntimeEvidence } from "../../shared/observability/cloudflare-runtime-evidence";
import type {
  PendingDispatchState,
  RuntimeTransportMutableState,
} from "./runtime-transport-state";

export function validateDaemonDispatchRuntimeEvidence(input: {
  evidence: RuntimeTransportDispatchRuntimeEvidenceRequest;
  pending: PendingDispatchState | null;
}): ReturnType<typeof validateDaemonDispatchProgressIdentity> {
  return validateDaemonDispatchProgressIdentity({
    connectionGenerationPolicy: "allow_owned_reconnect",
    progress: input.evidence,
    pending: input.pending,
  });
}

export function validateDaemonDispatchToolActivityIdentity(input: {
  activity: Omit<RuntimeTransportDispatchToolActivityRequest, "part">;
  pending: PendingDispatchState | null;
  state: RuntimeTransportMutableState;
  webSocket: WebSocket;
}): ReturnType<typeof validateDaemonDispatchProgressIdentity> {
  const session = input.state.sessionsById.get(input.activity.daemonSessionId);
  if (!session) {
    return { ok: false, reasonCode: "daemon.session.not_found" };
  }
  if (
    session.socket !== input.webSocket ||
    session.connectionGeneration !== input.activity.connectionGeneration
  ) {
    return { ok: false, reasonCode: "daemon.session.connection_replaced" };
  }
  return validateDaemonDispatchProgressIdentity({
    connectionGenerationPolicy: "allow_owned_reconnect",
    progress: input.activity,
    pending: input.pending,
  });
}

function validateDaemonDispatchProgressIdentity(input: {
  connectionGenerationPolicy: "allow_owned_reconnect" | "require_current";
  progress:
    | RuntimeTransportDispatchRuntimeEvidenceRequest
    | Omit<RuntimeTransportDispatchToolActivityRequest, "part">;
  pending: PendingDispatchState | null;
}): {
  ok: boolean;
  reasonCode?:
    | "daemon.session.connection_replaced"
    | "daemon.session.not_found"
    | "daemon.session.stale_lease"
    | "schema.invalid";
} {
  const pending = input.pending;
  if (!pending) {
    return { ok: false, reasonCode: "daemon.session.not_found" };
  }

  const leaseMatched = isLeaseMatch({
    expectedDaemonSessionId: pending.daemonSessionId,
    expectedLeaseEpoch: pending.leaseEpoch,
    actualDaemonSessionId: input.progress.daemonSessionId,
    actualLeaseEpoch: input.progress.leaseEpoch,
  });
  if (!leaseMatched) {
    return { ok: false, reasonCode: "daemon.session.stale_lease" };
  }
  if (
    pending.spaceId !== input.progress.spaceId ||
    pending.profileId !== input.progress.targetProfileId ||
    pending.sourceSignalId !== input.progress.sourceSignalId ||
    pending.taskId !== input.progress.taskId
  ) {
    return { ok: false, reasonCode: "schema.invalid" };
  }
  const identityEchoMismatch = resolveRuntimeEvidenceIdentityEchoMismatch({
    authoritative: pending.executionIdentity,
    echoed: input.progress.executionIdentityEcho,
  });
  if (identityEchoMismatch) {
    console.warn(
      "[core.runtime_transport.runtime_evidence_identity_echo_mismatch]",
      {
        dispatchId: input.progress.dispatchId,
        attemptId: input.progress.attemptId,
        daemonSessionId: input.progress.daemonSessionId,
        reasonCode: "daemon.runtime_evidence.identity_mismatch",
        mismatchField: identityEchoMismatch,
        authoritativeRuntimeId:
          pending.executionIdentity.core.openMeldServiceRuntimeId.value,
        echoedRuntimeId:
          input.progress.executionIdentityEcho.core.openMeldServiceRuntimeId
            .value,
      }
    );
    return { ok: false, reasonCode: "schema.invalid" };
  }
  if (
    pending.connectionGeneration !== input.progress.connectionGeneration &&
    (input.connectionGenerationPolicy === "require_current" ||
      !hasPendingLocalRuntimeOwnershipEvidence(pending))
  ) {
    return {
      ok: false,
      reasonCode: "daemon.session.connection_replaced",
    };
  }

  return { ok: true };
}

export function emitDaemonDispatchRuntimeEvidence(input: {
  env: CoreBindings;
  evidence: RuntimeTransportDispatchRuntimeEvidenceRequest;
}): void {
  emitCoreCloudflareRuntimeEvidence(input.env, {
    event: "core.openmeld.daemon.runtime_evidence",
    workerEnvironment: input.env.OPENMELD_WORKER_ENVIRONMENT,
    runtimeKind: "durable_object",
    status: input.evidence.phase === "failed" ? "failed" : "succeeded",
    operation: `daemon.${input.evidence.phase}`,
    durationMs: input.evidence.durationMs ?? null,
    reasonCode: input.evidence.reasonCode ?? null,
    errorName: input.evidence.errorName ?? null,
    spaceId: input.evidence.spaceId,
    clientMessageId: input.evidence.sourceClientMessageId ?? null,
    sourceSignalId: input.evidence.sourceSignalId,
    targetProfileId: input.evidence.targetProfileId,
    dispatchId: input.evidence.dispatchId,
    runtimeCoordinatorExecutionId:
      input.evidence.runtimeCoordinatorExecutionId ?? null,
    latestAttemptId: input.evidence.attemptId,
    claimLeaseId: input.evidence.claimLeaseId ?? null,
    bindingId: input.evidence.executionIdentityEcho.core.bindingId,
    openMeldServiceRuntimeId:
      input.evidence.executionIdentityEcho.core.openMeldServiceRuntimeId.value,
    agentControllerRef:
      input.evidence.executionIdentityEcho.core.agentControllerRef,
  });
}

function resolveRuntimeEvidenceIdentityEchoMismatch(input: {
  authoritative: PendingDispatchState["executionIdentity"];
  echoed:
    | RuntimeTransportDispatchRuntimeEvidenceRequest["executionIdentityEcho"]
    | RuntimeTransportDispatchToolActivityRequest["executionIdentityEcho"];
}):
  | "bindingId"
  | "agentControllerRef"
  | "modelVersion"
  | "openMeldServiceRuntimeId"
  | "scope"
  | null {
  const authoritative = input.authoritative.core;
  const echoed = input.echoed.core;
  if (authoritative.modelVersion !== echoed.modelVersion) {
    return "modelVersion";
  }
  if (
    authoritative.spaceId !== echoed.spaceId ||
    authoritative.dispatchId !== echoed.dispatchId ||
    authoritative.targetProfileId !== echoed.targetProfileId
  ) {
    return "scope";
  }
  if (authoritative.bindingId !== echoed.bindingId) {
    return "bindingId";
  }
  if (
    authoritative.openMeldServiceRuntimeId.value !==
    echoed.openMeldServiceRuntimeId.value
  ) {
    return "openMeldServiceRuntimeId";
  }
  if (authoritative.agentControllerRef !== echoed.agentControllerRef) {
    return "agentControllerRef";
  }
  return null;
}

function hasPendingLocalRuntimeOwnershipEvidence(
  pending: PendingDispatchState
): boolean {
  return (
    pending.phase !== "starting" ||
    pending.acceptedLocalAtMs !== null ||
    pending.runningAtMs !== null ||
    pending.completedLocalAtMs !== null
  );
}
