import type {
  AgentProfileBindingDispatchReadableFacts,
  AgentProfileBindingState,
} from "@openmeld/agent-runtime";

export type DispatchClaimEligibilityReadableFacts = Pick<
  AgentProfileBindingDispatchReadableFacts,
  "bindingState" | "reasonCodes" | "routable"
>;

export type DispatchClaimEligibilityDiagnosticPointer = {
  readonly reasonCodes: readonly string[];
  readonly resolutionSource:
    | "binding_read_facts"
    | "missing_binding_read_facts";
};

export type DispatchClaimEligibilityProjection = {
  readonly bindingFactsObserved: boolean;
  readonly bindingState: AgentProfileBindingState;
  readonly candidateForClaimRequest: boolean;
  readonly diagnosticPointer: DispatchClaimEligibilityDiagnosticPointer;
  readonly reasonCodes: readonly string[];
  readonly resolutionSource: "dispatch_claim_eligibility_projection";
};

const CLAIM_ELIGIBILITY_REASON_BY_BINDING_STATE: Record<
  AgentProfileBindingState,
  string
> = {
  conflict: "dispatch.claim_eligibility.binding.conflict",
  disabled_historical: "dispatch.claim_eligibility.binding.disabled_historical",
  enabled_primary: "dispatch.claim_eligibility.binding.enabled_primary",
  missing: "dispatch.claim_eligibility.binding.missing",
  owner_mismatch: "dispatch.claim_eligibility.binding.owner_mismatch",
};

const CLAIM_ELIGIBILITY_REASON_BY_BINDING_REASON = new Map<string, string>([
  [
    "agent_profile_binding.conflict",
    CLAIM_ELIGIBILITY_REASON_BY_BINDING_STATE.conflict,
  ],
  [
    "agent_profile_binding.disabled",
    CLAIM_ELIGIBILITY_REASON_BY_BINDING_STATE.disabled_historical,
  ],
  [
    "agent_profile_binding.disabled_historical",
    CLAIM_ELIGIBILITY_REASON_BY_BINDING_STATE.disabled_historical,
  ],
  [
    "agent_profile_binding.enabled_primary",
    CLAIM_ELIGIBILITY_REASON_BY_BINDING_STATE.enabled_primary,
  ],
  [
    "agent_profile_binding.missing",
    CLAIM_ELIGIBILITY_REASON_BY_BINDING_STATE.missing,
  ],
  [
    "agent_profile_binding.owner_mismatch",
    CLAIM_ELIGIBILITY_REASON_BY_BINDING_STATE.owner_mismatch,
  ],
]);

export const projectClaimEligibilityFromDispatchReadableFacts = (
  facts: DispatchClaimEligibilityReadableFacts | null
): DispatchClaimEligibilityProjection => {
  if (!facts) {
    return createProjection({
      bindingFactsObserved: false,
      bindingState: "missing",
      candidateForClaimRequest: false,
      reasonCodes: [
        "dispatch.claim_eligibility.blocked",
        CLAIM_ELIGIBILITY_REASON_BY_BINDING_STATE.missing,
      ],
      resolutionSource: "missing_binding_read_facts",
    });
  }

  const bindingReasonCodes = resolveClaimEligibilityBindingReasonCodes(facts);
  // GUARD (audit 2026-06-26, currently unwired -- tests only): this candidacy is
  // a pure binding-relation fact (`routable` derives from bindingState alone)
  // and carries NO liveness dimension. If ever wired into a real Wake/dispatch
  // gate, the gate MUST layer live liveness on top (ServiceRuntime lease
  // freshness / live route lookup) -- a routable binding is not proof the agent
  // is online right now. Using this candidacy as the availability verdict
  // repeats the binding-vs-connectivity regression. See
  // createUnavailableAgentWakeRouteRegistrationFromLookup
  // (agent-execution-readiness-service.ts) and agent-transport-contract.md,
  // "Service Online Evidence".
  const candidateForClaimRequest =
    facts.bindingState === "enabled_primary" && facts.routable;

  return createProjection({
    bindingFactsObserved: true,
    bindingState: facts.bindingState,
    candidateForClaimRequest,
    reasonCodes: uniqueReasonCodes([
      candidateForClaimRequest
        ? "dispatch.claim_eligibility.candidate"
        : "dispatch.claim_eligibility.blocked",
      ...bindingReasonCodes,
    ]),
    resolutionSource: "binding_read_facts",
  });
};

const createProjection = (input: {
  readonly bindingFactsObserved: boolean;
  readonly bindingState: AgentProfileBindingState;
  readonly candidateForClaimRequest: boolean;
  readonly reasonCodes: readonly string[];
  readonly resolutionSource: DispatchClaimEligibilityDiagnosticPointer["resolutionSource"];
}): DispatchClaimEligibilityProjection => ({
  bindingFactsObserved: input.bindingFactsObserved,
  bindingState: input.bindingState,
  candidateForClaimRequest: input.candidateForClaimRequest,
  diagnosticPointer: {
    reasonCodes: input.reasonCodes,
    resolutionSource: input.resolutionSource,
  },
  reasonCodes: input.reasonCodes,
  resolutionSource: "dispatch_claim_eligibility_projection",
});

const resolveClaimEligibilityBindingReasonCodes = (
  facts: DispatchClaimEligibilityReadableFacts
): readonly string[] =>
  uniqueReasonCodes([
    ...facts.reasonCodes.map(mapBindingReasonToClaimEligibilityReason),
    CLAIM_ELIGIBILITY_REASON_BY_BINDING_STATE[facts.bindingState],
  ]);

const mapBindingReasonToClaimEligibilityReason = (
  reasonCode: string
): string => {
  const normalized = reasonCode.trim();
  return (
    CLAIM_ELIGIBILITY_REASON_BY_BINDING_REASON.get(normalized) ?? normalized
  );
};

const uniqueReasonCodes = (reasonCodes: readonly string[]): string[] => {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const reasonCode of reasonCodes) {
    const normalized = reasonCode.trim();
    if (!(normalized && !seen.has(normalized))) {
      continue;
    }
    seen.add(normalized);
    unique.push(normalized);
  }
  return unique;
};
