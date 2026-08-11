import {
  type AgentProfileBindingDispatchReadableFacts,
  type AgentProfileBindingState,
  createAgentProfileBindingDisplayProjection,
} from "@openmeld/agent-runtime";
import { describe, expect, it } from "vitest";
import {
  type DispatchClaimEligibilityProjection,
  type DispatchClaimEligibilityReadableFacts,
  projectClaimEligibilityFromDispatchReadableFacts,
} from "../dispatch/rules/dispatch-claim-eligibility-projection";

const FORBIDDEN_FINAL_CLAIM_FIELDS = [
  "attempt",
  "attemptId",
  "attemptNo",
  "bindingId",
  "agentControllerRef",
  "claimDecision",
  "claimResult",
  "claimState",
  "claimSucceeded",
  "claimToken",
  "lease",
  "leaseEpoch",
  "leaseId",
  "ownerAccountId",
  "result",
  "resultId",
  "openMeldServiceRuntimeId",
  "status",
] as const;

const FINAL_CLAIM_FIELD_PATTERN = /claimSucceeded|leaseId|attemptId|resultId/;

type BindingFactsFixture = {
  readonly bindingState: AgentProfileBindingState;
  readonly expectedCandidateForClaimRequest: boolean;
  readonly expectedReasonCode: string;
  readonly reasonCodes: readonly string[];
  readonly routable: boolean;
};

const BINDING_FACTS_FIXTURES = [
  {
    bindingState: "enabled_primary",
    expectedCandidateForClaimRequest: true,
    expectedReasonCode: "dispatch.claim_eligibility.binding.enabled_primary",
    reasonCodes: ["agent_profile_binding.enabled_primary"],
    routable: true,
  },
  {
    bindingState: "disabled_historical",
    expectedCandidateForClaimRequest: false,
    expectedReasonCode:
      "dispatch.claim_eligibility.binding.disabled_historical",
    reasonCodes: ["agent_profile_binding.disabled_historical"],
    routable: false,
  },
  {
    bindingState: "conflict",
    expectedCandidateForClaimRequest: false,
    expectedReasonCode: "dispatch.claim_eligibility.binding.conflict",
    reasonCodes: ["agent_profile_binding.conflict"],
    routable: false,
  },
  {
    bindingState: "owner_mismatch",
    expectedCandidateForClaimRequest: false,
    expectedReasonCode: "dispatch.claim_eligibility.binding.owner_mismatch",
    reasonCodes: ["agent_profile_binding.owner_mismatch"],
    routable: false,
  },
] as const satisfies readonly BindingFactsFixture[];

const PRODUCER_TO_CONSUMER_PARITY_FIXTURES = [
  {
    bindingState: "enabled_primary",
    expectedCandidateForClaimRequest: true,
  },
  {
    bindingState: "disabled_historical",
    expectedCandidateForClaimRequest: false,
  },
  {
    bindingState: "owner_mismatch",
    expectedCandidateForClaimRequest: false,
  },
  {
    bindingState: "missing",
    expectedCandidateForClaimRequest: false,
  },
] as const satisfies readonly {
  readonly bindingState: AgentProfileBindingState;
  readonly expectedCandidateForClaimRequest: boolean;
}[];

describe("dispatch claim eligibility projection", () => {
  it.each(
    BINDING_FACTS_FIXTURES
  )("projects $bindingState Binding facts as claim eligibility only", (fixture) => {
    const projection = projectClaimEligibilityFromDispatchReadableFacts(
      buildDispatchReadableFacts(fixture)
    );

    expect(projection).toMatchObject({
      bindingFactsObserved: true,
      bindingState: fixture.bindingState,
      candidateForClaimRequest: fixture.expectedCandidateForClaimRequest,
      resolutionSource: "dispatch_claim_eligibility_projection",
    });
    expect(projection.reasonCodes).toContain(
      fixture.expectedCandidateForClaimRequest
        ? "dispatch.claim_eligibility.candidate"
        : "dispatch.claim_eligibility.blocked"
    );
    expect(projection.reasonCodes).toContain(fixture.expectedReasonCode);
    expect(projection.diagnosticPointer).toEqual({
      reasonCodes: projection.reasonCodes,
      resolutionSource: "binding_read_facts",
    });
    expect(listFinalClaimFieldHits(projection)).toEqual([]);
  });

  it("keeps missing Binding facts blocked instead of synthesizing claim readiness", () => {
    const projection = projectClaimEligibilityFromDispatchReadableFacts(null);

    expect(projection).toMatchObject({
      bindingFactsObserved: false,
      bindingState: "missing",
      candidateForClaimRequest: false,
      reasonCodes: [
        "dispatch.claim_eligibility.blocked",
        "dispatch.claim_eligibility.binding.missing",
      ],
    });
    expect(projection.diagnosticPointer).toEqual({
      reasonCodes: projection.reasonCodes,
      resolutionSource: "missing_binding_read_facts",
    });
    expect(listFinalClaimFieldHits(projection)).toEqual([]);
  });

  it.each(
    PRODUCER_TO_CONSUMER_PARITY_FIXTURES
  )("accepts producer dispatchReadableFacts for $bindingState without leaking claim fields", (fixture) => {
    const sharedFacts = createSharedDispatchReadableFacts(fixture.bindingState);
    const projection =
      projectClaimEligibilityFromDispatchReadableFacts(sharedFacts);

    expect(projection).toMatchObject({
      bindingFactsObserved: sharedFacts !== null,
      bindingState: fixture.bindingState,
      candidateForClaimRequest: fixture.expectedCandidateForClaimRequest,
    });
    expect(listFinalClaimFieldHits(projection)).toEqual([]);
    expect(JSON.stringify(projection)).not.toMatch(FINAL_CLAIM_FIELD_PATTERN);

    if (sharedFacts) {
      expect(sharedFacts).toEqual(
        expect.objectContaining({
          agentControllerRef: expect.any(String),
          openMeldServiceRuntimeId: expect.any(String),
        })
      );
      expect(JSON.stringify(projection)).not.toContain(
        sharedFacts.openMeldServiceRuntimeId
      );
      expect(JSON.stringify(projection)).not.toContain(
        sharedFacts.agentControllerRef
      );
      if (sharedFacts.bindingId) {
        expect(JSON.stringify(projection)).not.toContain(sharedFacts.bindingId);
      }
    }
  });

  it("passes unknown Binding reasons through without promoting them into final claim schema", () => {
    const projection = projectClaimEligibilityFromDispatchReadableFacts(
      buildDispatchReadableFacts({
        bindingState: "enabled_primary",
        expectedCandidateForClaimRequest: true,
        expectedReasonCode:
          "dispatch.claim_eligibility.binding.enabled_primary",
        reasonCodes: [
          "agent_profile_binding.enabled_primary",
          "agent_profile_binding.experimental_custom_reason",
        ],
        routable: true,
      })
    );

    expect(projection).toMatchObject({
      candidateForClaimRequest: true,
      reasonCodes: [
        "dispatch.claim_eligibility.candidate",
        "dispatch.claim_eligibility.binding.enabled_primary",
        "agent_profile_binding.experimental_custom_reason",
      ],
    });
    expect(listFinalClaimFieldHits(projection)).toEqual([]);
  });

  it("requires final Core claim decision before any lease, attempt, or result can exist", () => {
    const projection = projectClaimEligibilityFromDispatchReadableFacts(
      buildDispatchReadableFacts({
        bindingState: "enabled_primary",
        expectedCandidateForClaimRequest: true,
        expectedReasonCode:
          "dispatch.claim_eligibility.binding.enabled_primary",
        reasonCodes: ["agent_profile_binding.enabled_primary"],
        routable: true,
      })
    );

    expect(projection.candidateForClaimRequest).toBe(true);
    expect(listFinalClaimFieldHits(projection)).toEqual([]);
    expect(JSON.stringify(projection)).not.toMatch(FINAL_CLAIM_FIELD_PATTERN);
  });

  it("keeps Gateway, Web, and CLI as read-only consumers of eligibility projection", () => {
    const projection = projectClaimEligibilityFromDispatchReadableFacts(
      buildDispatchReadableFacts({
        bindingState: "enabled_primary",
        expectedCandidateForClaimRequest: true,
        expectedReasonCode:
          "dispatch.claim_eligibility.binding.enabled_primary",
        reasonCodes: ["agent_profile_binding.enabled_primary"],
        routable: true,
      })
    );

    expect(projection).not.toHaveProperty("dispatchTruthWrite");
    expect(projection).not.toHaveProperty("ledgerWrite");
    expect(projection).not.toHaveProperty("resultWrite");
    expect(projection).not.toHaveProperty("writer");
    expect(projection.reasonCodes).toEqual([
      "dispatch.claim_eligibility.candidate",
      "dispatch.claim_eligibility.binding.enabled_primary",
    ]);
  });
});

const buildDispatchReadableFacts = (
  fixture: BindingFactsFixture
): DispatchClaimEligibilityReadableFacts => ({
  bindingState: fixture.bindingState,
  reasonCodes: fixture.reasonCodes,
  routable: fixture.routable,
});

const createSharedDispatchReadableFacts = (
  bindingState: AgentProfileBindingState
): AgentProfileBindingDispatchReadableFacts | null => {
  switch (bindingState) {
    case "enabled_primary":
      return createAgentProfileBindingDisplayProjection({
        agentProfileId: "agt_enabled_primary",
        bindingId: "bind_enabled_primary",
        bindingState,
        executionTarget: {
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: "runtime-enabled-primary",
        },
      }).dispatchReadableFacts;
    case "disabled_historical":
      return createAgentProfileBindingDisplayProjection({
        agentProfileId: "agt_disabled_historical",
        bindingId: "bind_disabled_historical",
        bindingState,
        executionTarget: {
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: "runtime-disabled-historical",
        },
      }).dispatchReadableFacts;
    case "owner_mismatch":
      return createAgentProfileBindingDisplayProjection({
        agentProfileId: "agt_owner_mismatch",
        agentProfileOwner: {
          id: "owner-account-a",
          kind: "owner_account",
        },
        bindingId: "bind_owner_mismatch",
        bindingState,
        executionTarget: {
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: "runtime-owner-mismatch",
        },
        runtimeOwner: {
          id: "owner-account-b",
          kind: "owner_account",
        },
      }).dispatchReadableFacts;
    case "missing":
      return createAgentProfileBindingDisplayProjection({
        agentProfileId: "agt_missing",
        bindingState,
      }).dispatchReadableFacts;
    case "conflict":
      return createAgentProfileBindingDisplayProjection({
        agentProfileId: "agt_conflict",
        bindingState,
      }).dispatchReadableFacts;
    default:
      return assertUnreachable(bindingState);
  }
};

const listFinalClaimFieldHits = (
  projection: DispatchClaimEligibilityProjection
): readonly string[] => {
  const hits: string[] = [];
  collectFinalClaimFieldHits({
    hits,
    path: "projection",
    value: projection,
  });
  return hits;
};

const collectFinalClaimFieldHits = (input: {
  readonly hits: string[];
  readonly path: string;
  readonly value: unknown;
}): void => {
  if (!input.value || typeof input.value !== "object") {
    return;
  }

  for (const [fieldName, fieldValue] of Object.entries(input.value)) {
    const fieldPath = `${input.path}.${fieldName}`;
    if (
      FORBIDDEN_FINAL_CLAIM_FIELDS.includes(
        fieldName as (typeof FORBIDDEN_FINAL_CLAIM_FIELDS)[number]
      )
    ) {
      input.hits.push(fieldPath);
    }
    collectFinalClaimFieldHits({
      hits: input.hits,
      path: fieldPath,
      value: fieldValue,
    });
  }
};

function assertUnreachable(value: never): never {
  throw new Error(`Unhandled Binding state: ${String(value)}`);
}
