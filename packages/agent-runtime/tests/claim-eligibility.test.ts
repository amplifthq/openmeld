import { describe, expect, it } from "vitest";
import {
  type ClaimEligibilityReadSet,
  type ClaimEligibilityZeroSideEffects,
  createAuthorityOpenMeldServiceRuntimeId,
  createRuntimeLookupInput,
  resolveClaimEligibility,
} from "../src";

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

const createOpaqueRuntimeId = () =>
  createAuthorityOpenMeldServiceRuntimeId({
    openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
    source: "runtime_registry_authority",
  });

const createLookupInput = () =>
  createRuntimeLookupInput({
    owner: {
      kind: "owner_account",
      id: "account-1",
    },
    deviceId: "device-1",
    lane: "openmeld-dev",
  });

const createValidClaimEligibilityReadSet = (): ClaimEligibilityReadSet => ({
  callerAuthorization: {
    status: "allowed",
  },
  ownerScope: {
    sameOwner: true,
  },
  openMeldServiceRuntimeIdentity: {
    openMeldServiceRuntimeId: createOpaqueRuntimeId(),
  },
  executionTarget: {
    status: "ready",
  },
  bindingEligibility: {
    bindingState: "enabled_primary",
    reasonCodes: ["agent_profile_binding.enabled_primary"],
    routable: true,
  },
  spaceCreationEvidence: {
    relation: "wake",
    status: "valid",
  },
  spaceClaimTimeLiveness: {
    status: "valid",
  },
  dispatchState: {
    status: "open",
  },
});

describe("claim eligibility contract", () => {
  it("fails closed when A2 caller authorization denies access", () => {
    const result = resolveClaimEligibility({
      ...createValidClaimEligibilityReadSet(),
      callerAuthorization: {
        status: "denied",
        reasonCode: "claim_eligibility.caller_not_allowed",
      },
    });

    expect(result).toMatchObject({
      eligibleForCoreClaimDecision: false,
      grantsClaimSuccess: false,
      reasonCodes: ["claim_eligibility.caller_not_allowed"],
    });
    expect(result.sideEffects).toEqual(ZERO_SIDE_EFFECTS);
  });

  it("fails closed when read-set facts do not belong to the same owner", () => {
    const result = resolveClaimEligibility({
      ...createValidClaimEligibilityReadSet(),
      ownerScope: {
        sameOwner: false,
        reasonCode: "claim_eligibility.owner_mismatch",
      },
    });

    expect(result).toMatchObject({
      eligibleForCoreClaimDecision: false,
      grantsClaimSuccess: false,
      reasonCodes: ["claim_eligibility.owner_mismatch"],
    });
    expect(result.sideEffects).toEqual(ZERO_SIDE_EFFECTS);
  });

  it("fails closed when Runtime identity is missing or client-computed", () => {
    for (const openMeldServiceRuntimeIdentity of [
      {
        openMeldServiceRuntimeId: undefined,
        expectedReasonCode:
          "claim_eligibility.openmeld_service_runtime_id_missing",
      },
      {
        openMeldServiceRuntimeId:
          "owner_account:account-1:device-1:openmeld-dev",
        expectedReasonCode:
          "claim_eligibility.openmeld_service_runtime_id_not_opaque",
      },
    ] as const) {
      const result = resolveClaimEligibility({
        ...createValidClaimEligibilityReadSet(),
        openMeldServiceRuntimeIdentity,
      });

      expect(result).toMatchObject({
        eligibleForCoreClaimDecision: false,
        grantsClaimSuccess: false,
        reasonCodes: [openMeldServiceRuntimeIdentity.expectedReasonCode],
      });
      expect(result.sideEffects).toEqual(ZERO_SIDE_EFFECTS);
    }
  });

  it("fails closed when Runtime identity is a forged authority object with lookup-derived value", () => {
    const result = resolveClaimEligibility({
      ...createValidClaimEligibilityReadSet(),
      openMeldServiceRuntimeIdentity: {
        lookupInput: createLookupInput(),
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: "owner_account:account-1:device-1:openmeld-dev",
        },
      },
    });

    expect(result).toMatchObject({
      eligibleForCoreClaimDecision: false,
      grantsClaimSuccess: false,
      reasonCodes: ["claim_eligibility.openmeld_service_runtime_id_not_opaque"],
    });
    expect(result.sideEffects).toEqual(ZERO_SIDE_EFFECTS);
  });

  it("fails closed when Agent Controller availability is missing, stale, disabled, or unavailable", () => {
    for (const executionTarget of [
      {
        status: "missing",
        expectedReasonCode: "claim_eligibility.agent_controller_report_missing",
      },
      {
        status: "stale",
        expectedReasonCode: "claim_eligibility.agent_controller_report_stale",
      },
      {
        status: "disabled",
        expectedReasonCode:
          "claim_eligibility.agent_controller_report_disabled",
      },
      {
        status: "unavailable",
        expectedReasonCode:
          "claim_eligibility.agent_controller_report_unavailable",
      },
    ] as const) {
      const result = resolveClaimEligibility({
        ...createValidClaimEligibilityReadSet(),
        executionTarget,
      });

      expect(result).toMatchObject({
        eligibleForCoreClaimDecision: false,
        grantsClaimSuccess: false,
        reasonCodes: [executionTarget.expectedReasonCode],
      });
      expect(result.sideEffects).toEqual(ZERO_SIDE_EFFECTS);
    }
  });

  it("fails closed when Binding eligibility is missing, disabled, or conflicting", () => {
    for (const bindingEligibility of [
      {
        value: null,
        expectedReasonCode: "claim_eligibility.binding_missing",
      },
      {
        value: {
          bindingState: "disabled_historical",
          reasonCodes: ["agent_profile_binding.disabled_historical"],
          routable: false,
        },
        expectedReasonCode: "claim_eligibility.binding_disabled",
      },
      {
        value: {
          bindingState: "conflict",
          reasonCodes: ["agent_profile_binding.conflict"],
          routable: false,
        },
        expectedReasonCode: "claim_eligibility.binding_conflict",
      },
    ] as const) {
      const result = resolveClaimEligibility({
        ...createValidClaimEligibilityReadSet(),
        bindingEligibility: bindingEligibility.value,
      });

      expect(result).toMatchObject({
        eligibleForCoreClaimDecision: false,
        grantsClaimSuccess: false,
        reasonCodes: [bindingEligibility.expectedReasonCode],
      });
      expect(result.sideEffects).toEqual(ZERO_SIDE_EFFECTS);
    }
  });

  it("uses explicit claim Binding reason codes when read-set composition detects a mismatch", () => {
    const result = resolveClaimEligibility({
      ...createValidClaimEligibilityReadSet(),
      bindingEligibility: {
        bindingState: "enabled_primary",
        reasonCodes: ["claim_eligibility.binding_runtime_mismatch"],
        routable: false,
      },
    });

    expect(result).toMatchObject({
      eligibleForCoreClaimDecision: false,
      grantsClaimSuccess: false,
      reasonCodes: ["claim_eligibility.binding_runtime_mismatch"],
    });
    expect(result.sideEffects).toEqual(ZERO_SIDE_EFFECTS);
  });

  it("does not treat non-Binding compatibility as claimable Binding evidence", () => {
    const result = resolveClaimEligibility({
      ...createValidClaimEligibilityReadSet(),
      bindingEligibility: {
        bindingState: "missing",
        reasonCodes: ["claim_eligibility.binding_missing"],
        routable: false,
      },
    });

    expect(result).toMatchObject({
      eligibleForCoreClaimDecision: false,
      grantsClaimSuccess: false,
      reasonCodes: ["claim_eligibility.binding_missing"],
    });
    expect(result.sideEffects).toEqual(ZERO_SIDE_EFFECTS);
  });

  it("fails closed for Reference or missing Wake creation-time evidence", () => {
    for (const spaceCreationEvidence of [
      {
        relation: "reference",
        status: "valid",
        expectedReasonCode:
          "claim_eligibility.non_wake_relation_not_dispatchable",
      },
      {
        relation: "wake",
        status: "missing",
        expectedReasonCode: "claim_eligibility.dispatch_evidence_missing",
      },
    ] as const) {
      const result = resolveClaimEligibility({
        ...createValidClaimEligibilityReadSet(),
        spaceCreationEvidence,
      });

      expect(result).toMatchObject({
        eligibleForCoreClaimDecision: false,
        grantsClaimSuccess: false,
        reasonCodes: [spaceCreationEvidence.expectedReasonCode],
      });
      expect(result.sideEffects).toEqual(ZERO_SIDE_EFFECTS);
    }
  });

  it("fails closed when claim-time Space liveness is missing or stale", () => {
    for (const spaceClaimTimeLiveness of [
      {
        status: "missing",
        expectedReasonCode: "claim_eligibility.space_liveness_missing",
      },
      {
        status: "stale",
        expectedReasonCode: "claim_eligibility.space_liveness_stale",
      },
    ] as const) {
      const result = resolveClaimEligibility({
        ...createValidClaimEligibilityReadSet(),
        spaceClaimTimeLiveness,
      });

      expect(result).toMatchObject({
        eligibleForCoreClaimDecision: false,
        grantsClaimSuccess: false,
        reasonCodes: [spaceClaimTimeLiveness.expectedReasonCode],
      });
      expect(result.sideEffects).toEqual(ZERO_SIDE_EFFECTS);
    }
  });

  it("fails closed when Dispatch state is missing, terminal, or lease-conflicted", () => {
    for (const dispatchState of [
      {
        status: "missing",
        expectedReasonCode: "claim_eligibility.dispatch_missing",
      },
      {
        status: "terminal",
        expectedReasonCode: "claim_eligibility.dispatch_terminal",
      },
      {
        status: "lease_conflict",
        expectedReasonCode: "claim_eligibility.lease_conflict",
      },
    ] as const) {
      const result = resolveClaimEligibility({
        ...createValidClaimEligibilityReadSet(),
        dispatchState,
      });

      expect(result).toMatchObject({
        eligibleForCoreClaimDecision: false,
        grantsClaimSuccess: false,
        reasonCodes: [dispatchState.expectedReasonCode],
      });
      expect(result.sideEffects).toEqual(ZERO_SIDE_EFFECTS);
    }
  });

  it("keeps canDispatch=true as advisory and not claim success", () => {
    const result = resolveClaimEligibility({
      ...createValidClaimEligibilityReadSet(),
      canDispatch: true,
    });

    expect(result).toMatchObject({
      eligibleForCoreClaimDecision: true,
      grantsClaimSuccess: false,
      reasonCodes: ["claim_eligibility.eligible"],
    });
    expect(result.sideEffects).toEqual(ZERO_SIDE_EFFECTS);
  });
});
