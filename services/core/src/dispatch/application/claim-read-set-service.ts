import {
  type AuthorityOpenMeldServiceRuntimeId,
  type ClaimEligibilityAgentControllerReport,
  type ClaimEligibilityBindingFacts,
  type ClaimEligibilityCallerAuthorization,
  type ClaimEligibilityDispatchState,
  type ClaimEligibilityReadSet,
  type ClaimEligibilityResult,
  type ClaimEligibilitySpaceClaimTimeLiveness,
  type ClaimEligibilitySpaceCreationEvidence,
  type RuntimeLookupInput,
  resolveClaimEligibility,
} from "@openmeld/agent-runtime";

export type ClaimReadSetOwner = RuntimeLookupInput["owner"];

export type ClaimReadSetRequest = {
  agentControllerRef: string;
  dispatchId: string;
  owner: ClaimReadSetOwner;
  openMeldServiceRuntimeId?: AuthorityOpenMeldServiceRuntimeId | string;
  runtimeLookupInput: RuntimeLookupInput;
  sourceSignalId: string;
  spaceId: string;
  targetProfileId: string;
};

export type ClaimRuntimeReadResult =
  | {
      openMeldServiceRuntimeId: AuthorityOpenMeldServiceRuntimeId;
      status: "found";
    }
  | {
      reasonCode?: string;
      status: "missing" | "conflict" | "invalid_identity" | "unavailable";
    };

export type ClaimAgentControllerReportReadResult =
  | ClaimEligibilityAgentControllerReport
  | {
      reasonCode?: string;
      status: "unknown";
    };

export type ClaimBindingReadResult = ClaimEligibilityBindingFacts & {
  bindingId: string;
  agentControllerRef: string;
  openMeldServiceRuntimeId: AuthorityOpenMeldServiceRuntimeId | string;
};

export type ClaimDispatchEvidenceReadResult = {
  dispatchState: ClaimEligibilityDispatchState;
  owner?: ClaimReadSetOwner | null;
  sourceClientMessageId?: string | null;
  spaceCreationEvidence: ClaimEligibilitySpaceCreationEvidence;
};

export type ClaimReadSetReaderPorts = {
  readBindingFacts: (input: {
    agentControllerRef: string;
    owner: ClaimReadSetOwner;
    openMeldServiceRuntimeId?: AuthorityOpenMeldServiceRuntimeId | string;
    targetProfileId: string;
  }) => Promise<ClaimBindingReadResult | null>;
  readCallerAuthorization: (input: {
    owner: ClaimReadSetOwner;
    targetProfileId: string;
  }) => Promise<ClaimEligibilityCallerAuthorization>;
  readDispatchEvidence: (input: {
    dispatchId: string;
    sourceSignalId: string;
    spaceId: string;
    targetProfileId: string;
  }) => Promise<ClaimDispatchEvidenceReadResult>;
  readRuntime: (input: {
    runtimeLookupInput: RuntimeLookupInput;
  }) => Promise<ClaimRuntimeReadResult>;
  readAgentControllerReport: (input: {
    agentControllerRef: string;
    nowMs: number;
    openMeldServiceRuntimeId?: AuthorityOpenMeldServiceRuntimeId | string;
  }) => Promise<ClaimAgentControllerReportReadResult>;
  readSpaceLiveness: (input: {
    owner: ClaimReadSetOwner;
    sourceSignalId: string;
    spaceId: string;
    targetProfileId: string;
  }) => Promise<ClaimEligibilitySpaceClaimTimeLiveness>;
};

export type ClaimReadSetDecisionResult = {
  authorityFacts: {
    bindingId?: string;
    sourceClientMessageId?: string | null;
  };
  decision: ClaimEligibilityResult;
  readSet: ClaimEligibilityReadSet;
};

// GUARD (audit 2026-06-26): `resolveClaimReadSetDecision` is a PRE-FLIGHT
// eligibility gate over a snapshot read-set -- not a real-time availability
// verdict -- and is currently unwired (referenced only by tests). Its
// `executionTarget` input is an agent-controller REPORT, an asynchronous
// snapshot read by `readAgentControllerReport`. Before wiring the resulting
// `eligibleForCoreClaimDecision` into any real Wake/dispatch gate, the verdict
// MUST defer to live liveness (ServiceRuntime lease freshness / live route
// lookup); the report status may only inform diagnostics, never decide
// online/offline. Wiring report status as the verdict reproduces the production
// Available<->Offline flap. Canonical "report = metadata, liveness = verdict"
// reference: createUnavailableAgentWakeRouteRegistrationFromLookup
// (services/core/src/agent-execution/application/agent-execution-readiness-service.ts).
// Owner rule: agent-transport-contract.md, "Service Online Evidence" (socket /
// report = delivery / snapshot evidence, not online evidence).
export async function resolveClaimReadSetDecision(input: {
  canDispatch?: boolean;
  nowMs: number;
  readers: ClaimReadSetReaderPorts;
  request: ClaimReadSetRequest;
}): Promise<ClaimReadSetDecisionResult> {
  const callerAuthorization = await input.readers.readCallerAuthorization({
    owner: input.request.owner,
    targetProfileId: input.request.targetProfileId,
  });
  if (callerAuthorization.status !== "allowed") {
    const readSet = createCallerAuthorizationFailedReadSet({
      callerAuthorization,
      canDispatch: input.canDispatch,
      request: input.request,
    });

    return {
      authorityFacts: {},
      decision: resolveClaimEligibility(readSet),
      readSet,
    };
  }

  const [dispatchEvidence, runtime, bindingReadResult, spaceClaimTimeLiveness] =
    await Promise.all([
      input.readers.readDispatchEvidence({
        dispatchId: input.request.dispatchId,
        sourceSignalId: input.request.sourceSignalId,
        spaceId: input.request.spaceId,
        targetProfileId: input.request.targetProfileId,
      }),
      input.readers.readRuntime({
        runtimeLookupInput: input.request.runtimeLookupInput,
      }),
      input.readers.readBindingFacts({
        agentControllerRef: input.request.agentControllerRef,
        owner: input.request.owner,
        openMeldServiceRuntimeId: input.request.openMeldServiceRuntimeId,
        targetProfileId: input.request.targetProfileId,
      }),
      input.readers.readSpaceLiveness({
        owner: input.request.owner,
        sourceSignalId: input.request.sourceSignalId,
        spaceId: input.request.spaceId,
        targetProfileId: input.request.targetProfileId,
      }),
    ]);

  const executionTarget =
    runtime.status === "found" &&
    openMeldServiceRuntimeIdValuesMatch({
      expected: runtime.openMeldServiceRuntimeId,
      submitted: input.request.openMeldServiceRuntimeId,
    })
      ? normalizeAgentControllerReport(
          await input.readers.readAgentControllerReport({
            agentControllerRef: input.request.agentControllerRef,
            nowMs: input.nowMs,
            openMeldServiceRuntimeId: runtime.openMeldServiceRuntimeId,
          })
        )
      : runtimeReadFailureToAgentControllerReport(runtime);

  const sameRequestAndRuntimeOwner = ownerMatches({
    left: input.request.owner,
    right: input.request.runtimeLookupInput.owner,
  });
  const sameDispatchOwner = ownerMatches({
    left: input.request.owner,
    right: dispatchEvidence.owner,
  });
  const readSet: ClaimEligibilityReadSet = {
    bindingEligibility: normalizeBindingEligibility({
      binding: bindingReadResult,
      request: input.request,
    }),
    callerAuthorization,
    canDispatch: input.canDispatch,
    dispatchState: dispatchEvidence.dispatchState,
    ownerScope: {
      reasonCode:
        sameRequestAndRuntimeOwner && sameDispatchOwner
          ? undefined
          : "claim_eligibility.owner_mismatch",
      sameOwner: sameRequestAndRuntimeOwner && sameDispatchOwner,
    },
    executionTarget,
    openMeldServiceRuntimeIdentity: {
      lookupInput: input.request.runtimeLookupInput,
      openMeldServiceRuntimeId: input.request.openMeldServiceRuntimeId,
    },
    spaceClaimTimeLiveness,
    spaceCreationEvidence: dispatchEvidence.spaceCreationEvidence,
  };

  return {
    authorityFacts: {
      ...(bindingReadResult?.bindingId
        ? { bindingId: bindingReadResult.bindingId }
        : {}),
      ...(dispatchEvidence.sourceClientMessageId === undefined
        ? {}
        : { sourceClientMessageId: dispatchEvidence.sourceClientMessageId }),
    },
    decision: resolveClaimEligibility(readSet),
    readSet,
  };
}

function createCallerAuthorizationFailedReadSet(input: {
  callerAuthorization: ClaimEligibilityCallerAuthorization;
  canDispatch?: boolean;
  request: ClaimReadSetRequest;
}): ClaimEligibilityReadSet {
  return {
    bindingEligibility: null,
    callerAuthorization: input.callerAuthorization,
    canDispatch: input.canDispatch,
    dispatchState: {
      reasonCode:
        "claim_eligibility.not_read_after_caller_authorization_failed",
      status: "missing",
    },
    ownerScope: {
      reasonCode:
        "claim_eligibility.not_read_after_caller_authorization_failed",
      sameOwner: false,
    },
    executionTarget: {
      reasonCode:
        "claim_eligibility.not_read_after_caller_authorization_failed",
      status: "unavailable",
    },
    openMeldServiceRuntimeIdentity: {
      lookupInput: input.request.runtimeLookupInput,
      openMeldServiceRuntimeId: input.request.openMeldServiceRuntimeId,
    },
    spaceClaimTimeLiveness: {
      reasonCode:
        "claim_eligibility.not_read_after_caller_authorization_failed",
      status: "missing",
    },
    spaceCreationEvidence: {
      reasonCode:
        "claim_eligibility.not_read_after_caller_authorization_failed",
      relation: "wake",
      status: "missing",
    },
  };
}

function ownerMatches(input: {
  left: ClaimReadSetOwner;
  right?: ClaimReadSetOwner | null;
}): boolean {
  if (!input.right) {
    return false;
  }

  return (
    input.left.kind === input.right.kind && input.left.id === input.right.id
  );
}

function openMeldServiceRuntimeIdValuesMatch(input: {
  expected: AuthorityOpenMeldServiceRuntimeId;
  submitted?: AuthorityOpenMeldServiceRuntimeId | string;
}): boolean {
  return (
    !!input.submitted &&
    typeof input.submitted === "object" &&
    input.submitted.value === input.expected.value &&
    input.submitted.source === input.expected.source
  );
}

function normalizeBindingEligibility(input: {
  binding: ClaimBindingReadResult | null;
  request: ClaimReadSetRequest;
}): ClaimEligibilityBindingFacts | null {
  if (!input.binding) {
    return null;
  }

  if (
    !bindingRuntimeIdMatches({
      bindingRuntimeId: input.binding.openMeldServiceRuntimeId,
      requestRuntimeId: input.request.openMeldServiceRuntimeId,
    })
  ) {
    return {
      bindingState: "enabled_primary",
      reasonCodes: ["claim_eligibility.binding_runtime_mismatch"],
      routable: false,
    };
  }

  if (input.binding.agentControllerRef !== input.request.agentControllerRef) {
    return {
      bindingState: "enabled_primary",
      reasonCodes: ["claim_eligibility.binding_capability_mismatch"],
      routable: false,
    };
  }

  return input.binding;
}

function bindingRuntimeIdMatches(input: {
  bindingRuntimeId: AuthorityOpenMeldServiceRuntimeId | string;
  requestRuntimeId?: AuthorityOpenMeldServiceRuntimeId | string;
}): boolean {
  if (!input.requestRuntimeId) {
    return false;
  }

  return (
    openMeldServiceRuntimeIdValue(input.bindingRuntimeId) ===
    openMeldServiceRuntimeIdValue(input.requestRuntimeId)
  );
}

function openMeldServiceRuntimeIdValue(
  openMeldServiceRuntimeId: AuthorityOpenMeldServiceRuntimeId | string
): string {
  return typeof openMeldServiceRuntimeId === "string"
    ? openMeldServiceRuntimeId
    : openMeldServiceRuntimeId.value;
}

function runtimeReadFailureToAgentControllerReport(
  runtime: ClaimRuntimeReadResult
): ClaimEligibilityAgentControllerReport {
  if (runtime.status === "found") {
    return {
      reasonCode: "claim_eligibility.openmeld_service_runtime_id_mismatch",
      status: "unavailable",
    };
  }

  return {
    reasonCode:
      runtime.reasonCode ?? RUNTIME_READ_FAILURE_REASON[runtime.status],
    status: "unavailable",
  };
}

const RUNTIME_READ_FAILURE_REASON: Record<
  Exclude<ClaimRuntimeReadResult["status"], "found">,
  string
> = {
  conflict: "claim_eligibility.runtime_conflict",
  invalid_identity:
    "claim_eligibility.openmeld_service_runtime_identity_invalid",
  missing: "claim_eligibility.runtime_missing",
  unavailable: "claim_eligibility.runtime_unavailable",
};

function normalizeAgentControllerReport(
  capability: ClaimAgentControllerReportReadResult
): ClaimEligibilityAgentControllerReport {
  if (capability.status === "unknown") {
    return {
      reasonCode:
        capability.reasonCode ??
        "claim_eligibility.agent_controller_report_unknown",
      status: "unavailable",
    };
  }

  return capability;
}
