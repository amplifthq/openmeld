import type { AgentProfileBindingState } from "./agent-profile-binding";
import {
  type AuthorityOpenMeldServiceRuntimeId,
  createAuthorityOpenMeldServiceRuntimeId,
  type RuntimeLookupInput,
} from "./runtime-id-contract";

export type ClaimEligibilityCallerAuthorization =
  | {
      status: "allowed";
      reasonCode?: string;
    }
  | {
      status: "denied" | "unavailable" | "unknown";
      reasonCode: string;
    };

export type ClaimEligibilityOwnerScope = {
  sameOwner: boolean;
  reasonCode?: string;
};

export type ClaimEligibilityRuntimeIdentity = {
  openMeldServiceRuntimeId?: AuthorityOpenMeldServiceRuntimeId | string;
  lookupInput?: RuntimeLookupInput;
};

export type ClaimEligibilityAgentControllerReportStatus =
  | "ready"
  | "missing"
  | "stale"
  | "disabled"
  | "unavailable";

export type ClaimEligibilityAgentControllerReport = {
  status: ClaimEligibilityAgentControllerReportStatus;
  reasonCode?: string;
};

export type ClaimEligibilityBindingFacts = {
  bindingId?: string;
  bindingState: AgentProfileBindingState;
  reasonCodes: readonly string[];
  routable: boolean;
};

export type ClaimEligibilitySpaceRelation = "wake" | "reference";

export type ClaimEligibilitySpaceCreationEvidence = {
  relation: ClaimEligibilitySpaceRelation;
  status: "valid" | "missing" | "stale" | "policy_denied";
  reasonCode?: string;
};

export type ClaimEligibilitySpaceClaimTimeLiveness = {
  status:
    | "valid"
    | "missing"
    | "stale"
    | "target_no_longer_member"
    | "policy_denied"
    | "policy_version_mismatch";
  reasonCode?: string;
};

export type ClaimEligibilityDispatchState = {
  status: "open" | "missing" | "terminal" | "lease_conflict";
  reasonCode?: string;
};

export type ClaimEligibilityReadSet = {
  callerAuthorization: ClaimEligibilityCallerAuthorization;
  ownerScope: ClaimEligibilityOwnerScope;
  openMeldServiceRuntimeIdentity: ClaimEligibilityRuntimeIdentity;
  executionTarget: ClaimEligibilityAgentControllerReport;
  bindingEligibility: ClaimEligibilityBindingFacts | null;
  spaceCreationEvidence: ClaimEligibilitySpaceCreationEvidence;
  spaceClaimTimeLiveness: ClaimEligibilitySpaceClaimTimeLiveness;
  dispatchState: ClaimEligibilityDispatchState;
  canDispatch?: boolean;
};

export type ClaimEligibilityZeroSideEffects = {
  leaseCreated: false;
  leaseRenewed: false;
  leaseRejected: false;
  attemptCreated: false;
  resultAccepted: false;
  resultRejected: false;
  runtimeExecutionStarted: false;
  queueConsumed: false;
  webSocketHintAuthorized: false;
};

export type ClaimEligibilityResult = {
  eligibleForCoreClaimDecision: boolean;
  grantsClaimSuccess: false;
  reasonCodes: readonly string[];
  sideEffects: ClaimEligibilityZeroSideEffects;
};

const ZERO_SIDE_EFFECTS: ClaimEligibilityZeroSideEffects = {
  leaseCreated: false,
  leaseRenewed: false,
  leaseRejected: false,
  attemptCreated: false,
  resultAccepted: false,
  resultRejected: false,
  runtimeExecutionStarted: false,
  queueConsumed: false,
  webSocketHintAuthorized: false,
};

const deny = (reasonCode: string): ClaimEligibilityResult => ({
  eligibleForCoreClaimDecision: false,
  grantsClaimSuccess: false,
  reasonCodes: [reasonCode],
  sideEffects: ZERO_SIDE_EFFECTS,
});

const resolveAuthorityOpenMeldServiceRuntimeId = (
  input: ClaimEligibilityRuntimeIdentity
): AuthorityOpenMeldServiceRuntimeId | null => {
  const value = input.openMeldServiceRuntimeId;
  if (!(value && typeof value === "object")) {
    return null;
  }
  const candidate = value as Partial<AuthorityOpenMeldServiceRuntimeId>;
  try {
    return createAuthorityOpenMeldServiceRuntimeId({
      lookupInput: input.lookupInput,
      openMeldServiceRuntimeId: candidate.value ?? "",
      source: candidate.source ?? "",
    });
  } catch {
    return null;
  }
};

const REASON_CODE_BY_AGENT_CONTROLLER_REPORT_STATUS: Record<
  Exclude<ClaimEligibilityAgentControllerReportStatus, "ready">,
  string
> = {
  disabled: "claim_eligibility.agent_controller_report_disabled",
  missing: "claim_eligibility.agent_controller_report_missing",
  stale: "claim_eligibility.agent_controller_report_stale",
  unavailable: "claim_eligibility.agent_controller_report_unavailable",
};

const REASON_CODE_BY_BINDING_STATE: Record<AgentProfileBindingState, string> = {
  conflict: "claim_eligibility.binding_conflict",
  disabled_historical: "claim_eligibility.binding_disabled",
  enabled_primary: "claim_eligibility.binding_not_routable",
  missing: "claim_eligibility.binding_missing",
  owner_mismatch: "claim_eligibility.binding_owner_mismatch",
};

const REASON_CODE_BY_SPACE_CREATION_STATUS: Record<
  Exclude<ClaimEligibilitySpaceCreationEvidence["status"], "valid">,
  string
> = {
  missing: "claim_eligibility.dispatch_evidence_missing",
  policy_denied: "claim_eligibility.wake_not_allowed_at_creation",
  stale: "claim_eligibility.dispatch_evidence_stale",
};

const REASON_CODE_BY_SPACE_LIVENESS_STATUS: Record<
  Exclude<ClaimEligibilitySpaceClaimTimeLiveness["status"], "valid">,
  string
> = {
  missing: "claim_eligibility.space_liveness_missing",
  policy_denied: "claim_eligibility.wake_no_longer_allowed_by_policy",
  policy_version_mismatch: "claim_eligibility.policy_version_mismatch",
  stale: "claim_eligibility.space_liveness_stale",
  target_no_longer_member: "claim_eligibility.target_no_longer_member",
};

const REASON_CODE_BY_DISPATCH_STATE: Record<
  Exclude<ClaimEligibilityDispatchState["status"], "open">,
  string
> = {
  lease_conflict: "claim_eligibility.lease_conflict",
  missing: "claim_eligibility.dispatch_missing",
  terminal: "claim_eligibility.dispatch_terminal",
};

export const resolveClaimEligibility = (
  input: ClaimEligibilityReadSet
): ClaimEligibilityResult => {
  if (input.callerAuthorization.status !== "allowed") {
    return deny(input.callerAuthorization.reasonCode);
  }

  if (!input.ownerScope.sameOwner) {
    return deny(
      input.ownerScope.reasonCode ?? "claim_eligibility.owner_mismatch"
    );
  }

  if (!input.openMeldServiceRuntimeIdentity.openMeldServiceRuntimeId) {
    return deny("claim_eligibility.openmeld_service_runtime_id_missing");
  }

  if (
    !resolveAuthorityOpenMeldServiceRuntimeId(
      input.openMeldServiceRuntimeIdentity
    )
  ) {
    return deny("claim_eligibility.openmeld_service_runtime_id_not_opaque");
  }

  // GUARD: `executionTarget` is an agent-controller REPORT (an asynchronous
  // snapshot). Denying on a non-"ready" status is valid only as a pre-flight
  // candidacy gate, never as a real-time Wake availability verdict -- a live
  // gate must defer to ServiceRuntime liveness (lease freshness / live route
  // lookup) and treat this report status as diagnostic only. See
  // createUnavailableAgentWakeRouteRegistrationFromLookup (services/core
  // agent-execution-readiness-service.ts) and agent-transport-contract.md,
  // "Service Online Evidence".
  if (input.executionTarget.status !== "ready") {
    return deny(
      input.executionTarget.reasonCode ??
        REASON_CODE_BY_AGENT_CONTROLLER_REPORT_STATUS[
          input.executionTarget.status
        ]
    );
  }

  if (!input.bindingEligibility) {
    return deny("claim_eligibility.binding_missing");
  }

  if (
    input.bindingEligibility.bindingState !== "enabled_primary" ||
    !input.bindingEligibility.routable
  ) {
    return deny(
      input.bindingEligibility.reasonCodes.find((reasonCode) =>
        reasonCode.startsWith("claim_eligibility.")
      ) ?? REASON_CODE_BY_BINDING_STATE[input.bindingEligibility.bindingState]
    );
  }

  if (input.spaceCreationEvidence.relation !== "wake") {
    return deny("claim_eligibility.non_wake_relation_not_dispatchable");
  }

  if (input.spaceCreationEvidence.status !== "valid") {
    return deny(
      input.spaceCreationEvidence.reasonCode ??
        REASON_CODE_BY_SPACE_CREATION_STATUS[input.spaceCreationEvidence.status]
    );
  }

  if (input.spaceClaimTimeLiveness.status !== "valid") {
    return deny(
      input.spaceClaimTimeLiveness.reasonCode ??
        REASON_CODE_BY_SPACE_LIVENESS_STATUS[
          input.spaceClaimTimeLiveness.status
        ]
    );
  }

  if (input.dispatchState.status !== "open") {
    return deny(
      input.dispatchState.reasonCode ??
        REASON_CODE_BY_DISPATCH_STATE[input.dispatchState.status]
    );
  }

  return {
    eligibleForCoreClaimDecision: true,
    grantsClaimSuccess: false,
    reasonCodes: ["claim_eligibility.eligible"],
    sideEffects: ZERO_SIDE_EFFECTS,
  };
};
