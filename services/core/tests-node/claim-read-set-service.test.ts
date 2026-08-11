import {
  createAuthorityOpenMeldServiceRuntimeId,
  createRuntimeLookupInput,
  type RuntimeLookupInput,
} from "@openmeld/agent-runtime";
import { describe, expect, it, vi } from "vitest";
import {
  type ClaimReadSetReaderPorts,
  resolveClaimReadSetDecision,
} from "../src/dispatch/application/claim-read-set-service";

describe("claim read-set service", () => {
  it("fails closed on denied caller authorization before reading other domains", async () => {
    const request = createClaimReadSetRequest();
    const readers = createReaders({
      openMeldServiceRuntimeId: request.openMeldServiceRuntimeId,
    });
    vi.mocked(readers.readCallerAuthorization).mockResolvedValue({
      reasonCode: "claim_eligibility.caller_not_allowed",
      status: "denied",
    });

    await expect(
      resolveClaimReadSetDecision({
        nowMs: 2000,
        readers,
        request,
      })
    ).resolves.toMatchObject({
      decision: {
        eligibleForCoreClaimDecision: false,
        grantsClaimSuccess: false,
        reasonCodes: ["claim_eligibility.caller_not_allowed"],
        sideEffects: {
          attemptCreated: false,
          leaseCreated: false,
          leaseRejected: false,
          leaseRenewed: false,
          queueConsumed: false,
          resultAccepted: false,
          resultRejected: false,
          runtimeExecutionStarted: false,
          webSocketHintAuthorized: false,
        },
      },
    });

    expect(readers.readCallerAuthorization).toHaveBeenCalledTimes(1);
    expect(readers.readRuntime).not.toHaveBeenCalled();
    expect(readers.readAgentControllerReport).not.toHaveBeenCalled();
    expect(readers.readBindingFacts).not.toHaveBeenCalled();
    expect(readers.readDispatchEvidence).not.toHaveBeenCalled();
    expect(readers.readSpaceLiveness).not.toHaveBeenCalled();
  });

  it("builds an eligible zero-side-effect decision from authoritative read facts", async () => {
    const request = createClaimReadSetRequest();
    const readers = createReaders({
      openMeldServiceRuntimeId: request.openMeldServiceRuntimeId,
    });

    await expect(
      resolveClaimReadSetDecision({
        canDispatch: true,
        nowMs: 2000,
        readers,
        request,
      })
    ).resolves.toMatchObject({
      decision: {
        eligibleForCoreClaimDecision: true,
        grantsClaimSuccess: false,
        reasonCodes: ["claim_eligibility.eligible"],
        sideEffects: {
          attemptCreated: false,
          leaseCreated: false,
          leaseRejected: false,
          leaseRenewed: false,
          queueConsumed: false,
          resultAccepted: false,
          resultRejected: false,
          runtimeExecutionStarted: false,
          webSocketHintAuthorized: false,
        },
      },
      readSet: {
        bindingEligibility: {
          bindingState: "enabled_primary",
          routable: true,
        },
        canDispatch: true,
        dispatchState: {
          status: "open",
        },
        executionTarget: {
          status: "ready",
        },
        spaceClaimTimeLiveness: {
          status: "valid",
        },
        spaceCreationEvidence: {
          relation: "wake",
          status: "valid",
        },
      },
    });

    expect(readers.readCallerAuthorization).toHaveBeenCalledTimes(1);
    expect(readers.readRuntime).toHaveBeenCalledTimes(1);
    expect(readers.readAgentControllerReport).toHaveBeenCalledTimes(1);
    expect(readers.readBindingFacts).toHaveBeenCalledTimes(1);
    expect(readers.readDispatchEvidence).toHaveBeenCalledTimes(1);
    expect(readers.readSpaceLiveness).toHaveBeenCalledTimes(1);
  });

  it("reads Runtime Agent Controller Report with the authority openMeldServiceRuntimeId returned by Runtime lookup", async () => {
    const request = createClaimReadSetRequest();
    const lookupAuthorityOpenMeldServiceRuntimeId = authorityRuntimeId({
      lookupInput: request.runtimeLookupInput,
    });
    const requestRuntimeId = {
      ...lookupAuthorityOpenMeldServiceRuntimeId,
    };
    const readers = createReaders({
      openMeldServiceRuntimeId: lookupAuthorityOpenMeldServiceRuntimeId,
    });
    const requestWithEquivalentRuntimeId = {
      ...request,
      openMeldServiceRuntimeId: requestRuntimeId,
    };

    await expect(
      resolveClaimReadSetDecision({
        nowMs: 2000,
        readers,
        request: requestWithEquivalentRuntimeId,
      })
    ).resolves.toMatchObject({
      decision: {
        eligibleForCoreClaimDecision: true,
      },
    });

    expect(readers.readAgentControllerReport).toHaveBeenCalledTimes(1);
    const capabilityReadInput = vi.mocked(readers.readAgentControllerReport)
      .mock.calls[0]?.[0];
    expect(capabilityReadInput?.openMeldServiceRuntimeId).toBe(
      lookupAuthorityOpenMeldServiceRuntimeId
    );
    expect(capabilityReadInput?.openMeldServiceRuntimeId).not.toBe(
      requestRuntimeId
    );
  });

  it("rejects non-Wake dispatch evidence even when canDispatch is true", async () => {
    const request = createClaimReadSetRequest();
    const readers = createReaders({
      openMeldServiceRuntimeId: request.openMeldServiceRuntimeId,
    });
    vi.mocked(readers.readDispatchEvidence).mockResolvedValue({
      dispatchState: {
        status: "open",
      },
      owner,
      spaceCreationEvidence: {
        relation: "reference",
        status: "valid",
      },
    });

    await expect(
      resolveClaimReadSetDecision({
        canDispatch: true,
        nowMs: 2000,
        readers,
        request,
      })
    ).resolves.toMatchObject({
      decision: {
        eligibleForCoreClaimDecision: false,
        grantsClaimSuccess: false,
        reasonCodes: ["claim_eligibility.non_wake_relation_not_dispatchable"],
        sideEffects: {
          attemptCreated: false,
          leaseCreated: false,
          resultAccepted: false,
          runtimeExecutionStarted: false,
          webSocketHintAuthorized: false,
        },
      },
    });
  });

  it("rejects unknown Runtime Agent Controller Report facts as not runnable", async () => {
    const request = createClaimReadSetRequest();
    const readers = createReaders({
      openMeldServiceRuntimeId: request.openMeldServiceRuntimeId,
    });
    vi.mocked(readers.readAgentControllerReport).mockResolvedValue({
      status: "unknown",
    });

    await expect(
      resolveClaimReadSetDecision({
        nowMs: 2000,
        readers,
        request,
      })
    ).resolves.toMatchObject({
      decision: {
        eligibleForCoreClaimDecision: false,
        reasonCodes: ["claim_eligibility.agent_controller_report_unknown"],
      },
      readSet: {
        executionTarget: {
          reasonCode: "claim_eligibility.agent_controller_report_unknown",
          status: "unavailable",
        },
      },
    });
  });

  it("rejects stale Runtime Agent Controller Report facts", async () => {
    const request = createClaimReadSetRequest();
    const readers = createReaders({
      openMeldServiceRuntimeId: request.openMeldServiceRuntimeId,
    });
    vi.mocked(readers.readAgentControllerReport).mockResolvedValue({
      status: "stale",
    });

    await expect(
      resolveClaimReadSetDecision({
        nowMs: 2000,
        readers,
        request,
      })
    ).resolves.toMatchObject({
      decision: {
        eligibleForCoreClaimDecision: false,
        reasonCodes: ["claim_eligibility.agent_controller_report_stale"],
      },
    });
  });

  it("rejects forged or lookup-derived openMeldServiceRuntimeId without reading capability facts", async () => {
    const lookupInput = runtimeLookupInput();
    const request = {
      ...createClaimReadSetRequest(),
      openMeldServiceRuntimeId: "owner_account:owner-1:device-1:openmeld-dev",
      runtimeLookupInput: lookupInput,
    };
    const readers = createReaders({
      openMeldServiceRuntimeId: authorityRuntimeId({
        lookupInput,
      }),
    });

    await expect(
      resolveClaimReadSetDecision({
        nowMs: 2000,
        readers,
        request,
      })
    ).resolves.toMatchObject({
      decision: {
        eligibleForCoreClaimDecision: false,
        reasonCodes: [
          "claim_eligibility.openmeld_service_runtime_id_not_opaque",
        ],
      },
    });

    expect(readers.readAgentControllerReport).not.toHaveBeenCalled();
  });

  it("rejects owner mismatch between request owner and dispatch evidence", async () => {
    const request = createClaimReadSetRequest();
    const readers = createReaders({
      openMeldServiceRuntimeId: request.openMeldServiceRuntimeId,
    });
    vi.mocked(readers.readDispatchEvidence).mockResolvedValue({
      dispatchState: {
        status: "open",
      },
      owner: {
        id: "owner-2",
        kind: "owner_account",
      },
      spaceCreationEvidence: {
        relation: "wake",
        status: "valid",
      },
    });

    await expect(
      resolveClaimReadSetDecision({
        nowMs: 2000,
        readers,
        request,
      })
    ).resolves.toMatchObject({
      decision: {
        eligibleForCoreClaimDecision: false,
        reasonCodes: ["claim_eligibility.owner_mismatch"],
      },
    });
  });

  it("rejects missing dispatch owner evidence", async () => {
    const request = createClaimReadSetRequest();
    const readers = createReaders({
      openMeldServiceRuntimeId: request.openMeldServiceRuntimeId,
    });
    vi.mocked(readers.readDispatchEvidence).mockResolvedValue({
      dispatchState: {
        status: "open",
      },
      spaceCreationEvidence: {
        relation: "wake",
        status: "valid",
      },
    });

    await expect(
      resolveClaimReadSetDecision({
        nowMs: 2000,
        readers,
        request,
      })
    ).resolves.toMatchObject({
      decision: {
        eligibleForCoreClaimDecision: false,
        reasonCodes: ["claim_eligibility.owner_mismatch"],
      },
      readSet: {
        ownerScope: {
          sameOwner: false,
        },
      },
    });
  });

  it("rejects missing claim-time Space liveness", async () => {
    const request = createClaimReadSetRequest();
    const readers = createReaders({
      openMeldServiceRuntimeId: request.openMeldServiceRuntimeId,
    });
    vi.mocked(readers.readSpaceLiveness).mockResolvedValue({
      status: "missing",
    });

    await expect(
      resolveClaimReadSetDecision({
        nowMs: 2000,
        readers,
        request,
      })
    ).resolves.toMatchObject({
      decision: {
        eligibleForCoreClaimDecision: false,
        reasonCodes: ["claim_eligibility.space_liveness_missing"],
      },
    });
  });

  it("rejects missing Binding truth", async () => {
    const request = createClaimReadSetRequest();
    const readers = createReaders({
      openMeldServiceRuntimeId: request.openMeldServiceRuntimeId,
    });
    vi.mocked(readers.readBindingFacts).mockResolvedValue(null);

    await expect(
      resolveClaimReadSetDecision({
        nowMs: 2000,
        readers,
        request,
      })
    ).resolves.toMatchObject({
      decision: {
        eligibleForCoreClaimDecision: false,
        reasonCodes: ["claim_eligibility.binding_missing"],
      },
    });
  });

  it("rejects Binding facts for a different Runtime target", async () => {
    const request = createClaimReadSetRequest();
    const readers = createReaders({
      openMeldServiceRuntimeId: request.openMeldServiceRuntimeId,
    });
    vi.mocked(readers.readBindingFacts).mockResolvedValue({
      bindingId: "binding-1",
      bindingState: "enabled_primary",
      agentControllerRef: "builtin:codex",
      reasonCodes: ["agent_profile_binding.enabled_primary"],
      routable: true,
      openMeldServiceRuntimeId: "runtime_opaque_different",
    });

    await expect(
      resolveClaimReadSetDecision({
        nowMs: 2000,
        readers,
        request,
      })
    ).resolves.toMatchObject({
      decision: {
        eligibleForCoreClaimDecision: false,
        reasonCodes: ["claim_eligibility.binding_runtime_mismatch"],
      },
      readSet: {
        bindingEligibility: {
          reasonCodes: ["claim_eligibility.binding_runtime_mismatch"],
          routable: false,
        },
      },
    });
  });

  it("rejects Binding facts for a different capability target", async () => {
    const request = createClaimReadSetRequest();
    const readers = createReaders({
      openMeldServiceRuntimeId: request.openMeldServiceRuntimeId,
    });
    vi.mocked(readers.readBindingFacts).mockResolvedValue({
      bindingId: "binding-1",
      bindingState: "enabled_primary",
      agentControllerRef: "builtin:other",
      reasonCodes: ["agent_profile_binding.enabled_primary"],
      routable: true,
      openMeldServiceRuntimeId: request.openMeldServiceRuntimeId,
    });

    await expect(
      resolveClaimReadSetDecision({
        nowMs: 2000,
        readers,
        request,
      })
    ).resolves.toMatchObject({
      decision: {
        eligibleForCoreClaimDecision: false,
        reasonCodes: ["claim_eligibility.binding_capability_mismatch"],
      },
      readSet: {
        bindingEligibility: {
          reasonCodes: ["claim_eligibility.binding_capability_mismatch"],
          routable: false,
        },
      },
    });
  });
});

const owner = {
  id: "owner-1",
  kind: "owner_account" as const,
};

const runtimeLookupInput = (): RuntimeLookupInput =>
  createRuntimeLookupInput({
    deviceId: "device-1",
    lane: "openmeld-dev",
    owner,
  });

const authorityRuntimeId = (input: { lookupInput: RuntimeLookupInput }) =>
  createAuthorityOpenMeldServiceRuntimeId({
    lookupInput: input.lookupInput,
    openMeldServiceRuntimeId: "runtime_opaque_claim_1",
    source: "runtime_registry_authority",
  });

const createClaimReadSetRequest = () => {
  const lookupInput = runtimeLookupInput();

  return {
    agentControllerRef: "builtin:codex",
    dispatchId: "dispatch-1",
    owner,
    openMeldServiceRuntimeId: authorityRuntimeId({
      lookupInput,
    }),
    runtimeLookupInput: lookupInput,
    sourceSignalId: "signal-1",
    spaceId: "space-1",
    targetProfileId: "profile-1",
  };
};

const createReaders = (input: {
  openMeldServiceRuntimeId: ReturnType<typeof authorityRuntimeId>;
}): ClaimReadSetReaderPorts => ({
  readBindingFacts: vi.fn(async () => ({
    bindingId: "binding-1",
    bindingState: "enabled_primary" as const,
    agentControllerRef: "builtin:codex",
    reasonCodes: ["agent_profile_binding.enabled_primary"] as const,
    routable: true,
    openMeldServiceRuntimeId: input.openMeldServiceRuntimeId,
  })),
  readCallerAuthorization: vi.fn(async () => ({
    status: "allowed" as const,
  })),
  readDispatchEvidence: vi.fn(async () => ({
    dispatchState: {
      status: "open" as const,
    },
    owner,
    spaceCreationEvidence: {
      relation: "wake" as const,
      status: "valid" as const,
    },
  })),
  readRuntime: vi.fn(async () => ({
    openMeldServiceRuntimeId: input.openMeldServiceRuntimeId,
    status: "found" as const,
  })),
  readAgentControllerReport: vi.fn(async () => ({
    status: "ready" as const,
  })),
  readSpaceLiveness: vi.fn(async () => ({
    status: "valid" as const,
  })),
});
