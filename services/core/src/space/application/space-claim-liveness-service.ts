import type {
  ClaimEligibilitySpaceClaimTimeLiveness,
  ClaimEligibilitySpaceRelation,
} from "@openmeld/agent-runtime";

export type SpaceClaimTimeLivenessInput = {
  expectedContractVersion?: number;
  expectedDispatchRuleSetVersion?: number;
  expectedMemberUpdatedAtMs?: number;
  nowMs: number;
  relation: ClaimEligibilitySpaceRelation;
  sourceClientMessageId?: string | null;
  sourceSignalId?: string;
  spaceId: string;
  targetProfileId: string;
};

export type SpaceClaimTimeLivenessMemberFact = {
  profileId: string;
  profileKindSnapshot: string;
  status: string;
  updatedAtMs?: number;
};

export type SpaceClaimTimeLivenessDispatchRuleFact = {
  allow: boolean;
  ruleSetVersion: number;
};

export type SpaceClaimTimeLivenessContractFact = {
  version: number;
};

export type SpaceClaimTimeLivenessReaders = {
  readContract: (input: {
    spaceId: string;
  }) => Promise<SpaceClaimTimeLivenessContractFact | null>;
  readDispatchRule: () => Promise<SpaceClaimTimeLivenessDispatchRuleFact | null>;
  readMember: (input: {
    targetProfileId: string;
  }) => Promise<SpaceClaimTimeLivenessMemberFact | null>;
};

export type SpaceClaimTimeLivenessDiagnosticPointer = {
  contractVersion?: number;
  dispatchRuleSetVersion?: number;
  evaluatedAtMs: number;
  livenessContractVersion: "space_claim_time_liveness.v1";
  relation: ClaimEligibilitySpaceRelation;
  sourceClientMessageId?: string | null;
  sourceSignalId?: string;
  spaceId: string;
  targetProfileId: string;
};

export type SpaceClaimTimeLivenessResult =
  ClaimEligibilitySpaceClaimTimeLiveness & {
    diagnosticPointer: SpaceClaimTimeLivenessDiagnosticPointer;
  };

export async function resolveSpaceClaimTimeLiveness(input: {
  input: SpaceClaimTimeLivenessInput;
  readers: SpaceClaimTimeLivenessReaders;
}): Promise<SpaceClaimTimeLivenessResult> {
  const [member, dispatchRule, contract] = await Promise.all([
    input.readers.readMember({
      targetProfileId: input.input.targetProfileId,
    }),
    input.readers.readDispatchRule(),
    input.readers.readContract({
      spaceId: input.input.spaceId,
    }),
  ]);
  const diagnosticPointer = createDiagnosticPointer({
    contract,
    dispatchRule,
    input: input.input,
  });

  if (input.input.relation !== "wake") {
    return {
      diagnosticPointer,
      reasonCode: "claim_eligibility.non_wake_relation_not_dispatchable",
      status: "policy_denied",
    };
  }

  if (member?.status !== "active") {
    return {
      diagnosticPointer,
      reasonCode: "claim_eligibility.target_no_longer_member",
      status: "target_no_longer_member",
    };
  }

  if (member.profileKindSnapshot !== "agent") {
    return {
      diagnosticPointer,
      reasonCode: "claim_eligibility.target_not_claimable_agent_member",
      status: "policy_denied",
    };
  }

  if (!(dispatchRule && contract)) {
    return {
      diagnosticPointer,
      reasonCode: "claim_eligibility.space_liveness_missing",
      status: "missing",
    };
  }

  if (
    input.input.expectedMemberUpdatedAtMs !== undefined &&
    member.updatedAtMs !== input.input.expectedMemberUpdatedAtMs
  ) {
    return {
      diagnosticPointer,
      reasonCode: "claim_eligibility.space_liveness_stale",
      status: "stale",
    };
  }

  if (
    input.input.expectedDispatchRuleSetVersion !== undefined &&
    dispatchRule.ruleSetVersion !== input.input.expectedDispatchRuleSetVersion
  ) {
    return {
      diagnosticPointer,
      reasonCode: "claim_eligibility.policy_version_mismatch",
      status: "policy_version_mismatch",
    };
  }

  if (
    input.input.expectedContractVersion !== undefined &&
    contract.version !== input.input.expectedContractVersion
  ) {
    return {
      diagnosticPointer,
      reasonCode: "claim_eligibility.policy_version_mismatch",
      status: "policy_version_mismatch",
    };
  }

  if (!dispatchRule.allow) {
    return {
      diagnosticPointer,
      reasonCode: "claim_eligibility.wake_no_longer_allowed_by_policy",
      status: "policy_denied",
    };
  }

  return {
    diagnosticPointer,
    status: "valid",
  };
}

function createDiagnosticPointer(input: {
  contract: SpaceClaimTimeLivenessContractFact | null;
  dispatchRule: SpaceClaimTimeLivenessDispatchRuleFact | null;
  input: SpaceClaimTimeLivenessInput;
}): SpaceClaimTimeLivenessDiagnosticPointer {
  return {
    ...(input.contract ? { contractVersion: input.contract.version } : {}),
    ...(input.dispatchRule
      ? { dispatchRuleSetVersion: input.dispatchRule.ruleSetVersion }
      : {}),
    evaluatedAtMs: input.input.nowMs,
    livenessContractVersion: "space_claim_time_liveness.v1",
    relation: input.input.relation,
    ...(input.input.sourceClientMessageId === undefined
      ? {}
      : { sourceClientMessageId: input.input.sourceClientMessageId }),
    ...(input.input.sourceSignalId === undefined
      ? {}
      : { sourceSignalId: input.input.sourceSignalId }),
    spaceId: input.input.spaceId,
    targetProfileId: input.input.targetProfileId,
  };
}
