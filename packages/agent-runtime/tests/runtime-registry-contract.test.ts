import { describe, expect, it } from "vitest";
import {
  createAuthorityOpenMeldServiceRuntimeId,
  createInMemoryRuntimeRegistryContractFixture,
  createRuntimeLookupInput,
  type RuntimeLookupInput,
} from "../src";

const createAccountRuntimeLookupInput = ({
  accountId = "account-1",
  deviceId = "device-1",
  lane = "openmeld-dev",
}: {
  accountId?: string;
  deviceId?: string;
  lane?: string;
} = {}): RuntimeLookupInput => {
  return createRuntimeLookupInput({
    owner: {
      kind: "owner_account",
      id: accountId,
    },
    deviceId,
    lane,
  });
};

const createRegistryRuntimeId = (
  lookupInput: RuntimeLookupInput,
  openMeldServiceRuntimeId = "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4"
) => {
  return createAuthorityOpenMeldServiceRuntimeId({
    lookupInput,
    openMeldServiceRuntimeId,
    source: "runtime_registry_authority",
  });
};

describe("agent-runtime runtime registry contract", () => {
  it("returns the same opaque openMeldServiceRuntimeId for duplicate registration with the same canonical lookup key", () => {
    const registry = createInMemoryRuntimeRegistryContractFixture();
    const lookupInput = createAccountRuntimeLookupInput();
    const openMeldServiceRuntimeId = createRegistryRuntimeId(lookupInput);

    const firstRegistration = registry.registerRuntime({
      lookupInput,
      openMeldServiceRuntimeId,
    });
    const secondRegistration = registry.registerRuntime({
      lookupInput,
      openMeldServiceRuntimeId,
    });

    expect(firstRegistration).toEqual({
      status: "registered",
      openMeldServiceRuntimeId,
    });
    expect(secondRegistration).toEqual({
      status: "reused",
      openMeldServiceRuntimeId,
    });
  });

  it("does not collapse different owner, device, or lane identities", () => {
    const registry = createInMemoryRuntimeRegistryContractFixture();
    const firstLookupInput = createAccountRuntimeLookupInput({
      accountId: "account-1",
      deviceId: "device-1",
      lane: "openmeld-dev",
    });
    const secondLookupInput = createAccountRuntimeLookupInput({
      accountId: "account-2",
      deviceId: "device-2",
      lane: "openmeld-canary",
    });
    const firstRuntimeId = createRegistryRuntimeId(firstLookupInput);
    const secondRuntimeId = createRegistryRuntimeId(
      secondLookupInput,
      "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D5"
    );

    expect(
      registry.registerRuntime({
        lookupInput: firstLookupInput,
        openMeldServiceRuntimeId: firstRuntimeId,
      })
    ).toEqual({
      status: "registered",
      openMeldServiceRuntimeId: firstRuntimeId,
    });
    expect(
      registry.registerRuntime({
        lookupInput: secondLookupInput,
        openMeldServiceRuntimeId: secondRuntimeId,
      })
    ).toEqual({
      status: "registered",
      openMeldServiceRuntimeId: secondRuntimeId,
    });

    expect(
      registry.readRuntime(firstLookupInput)?.openMeldServiceRuntimeId
    ).toEqual(firstRuntimeId);
    expect(
      registry.readRuntime(secondLookupInput)?.openMeldServiceRuntimeId
    ).toEqual(secondRuntimeId);
  });

  it("reuses the first opaque openMeldServiceRuntimeId when a duplicate registration supplies a different id", () => {
    const registry = createInMemoryRuntimeRegistryContractFixture();
    const lookupInput = createAccountRuntimeLookupInput();
    const firstRuntimeId = createRegistryRuntimeId(lookupInput);
    const ignoredSecondRuntimeId = createRegistryRuntimeId(
      lookupInput,
      "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D5"
    );

    registry.registerRuntime({
      lookupInput,
      openMeldServiceRuntimeId: firstRuntimeId,
    });

    expect(
      registry.registerRuntime({
        lookupInput,
        openMeldServiceRuntimeId: ignoredSecondRuntimeId,
      })
    ).toEqual({
      status: "reused",
      openMeldServiceRuntimeId: firstRuntimeId,
    });
    expect(registry.readRuntime(lookupInput)?.openMeldServiceRuntimeId).toEqual(
      firstRuntimeId
    );
  });

  it("rejects stale agent controller reports without mutating current accepted facts", () => {
    const registry = createInMemoryRuntimeRegistryContractFixture();
    const lookupInput = createAccountRuntimeLookupInput();
    const openMeldServiceRuntimeId = createRegistryRuntimeId(lookupInput);
    const freshReport = {
      agentControllerRef: "builtin:codex",
      observedAt: "2026-05-02T00:00:00.000Z",
      expiresAt: "2026-05-02T00:10:00.000Z",
      status: "ready",
    } as const;
    const staleReport = {
      agentControllerRef: "builtin:codex",
      observedAt: "2026-05-01T00:00:00.000Z",
      expiresAt: "2026-05-01T00:10:00.000Z",
      status: "unavailable",
    } as const;

    registry.registerRuntime({
      lookupInput,
      openMeldServiceRuntimeId,
    });

    expect(
      registry.acceptAgentControllerReport({
        lookupInput,
        now: "2026-05-02T00:05:00.000Z",
        report: freshReport,
      })
    ).toEqual({
      status: "accepted",
      reasonCodes: [],
      currentAgentControllerReport: freshReport,
    });
    expect(
      registry.acceptAgentControllerReport({
        lookupInput,
        now: "2026-05-02T00:05:00.000Z",
        report: staleReport,
      })
    ).toEqual({
      status: "rejected",
      reasonCodes: ["runtime.agent_controller_report_stale"],
      currentAgentControllerReport: freshReport,
    });
    expect(
      registry.readRuntime(lookupInput)?.currentAgentControllerReport
    ).toEqual(freshReport);
  });

  it("rejects out-of-order agent controller reports without overwriting current accepted projection facts", () => {
    const registry = createInMemoryRuntimeRegistryContractFixture();
    const lookupInput = createAccountRuntimeLookupInput();
    const openMeldServiceRuntimeId = createRegistryRuntimeId(lookupInput);
    const newerReport = {
      agentControllerRef: "builtin:codex",
      observedAt: "2026-05-02T10:00:00.000Z",
      expiresAt: "2026-05-02T10:30:00.000Z",
      status: "ready",
    } as const;
    const olderReport = {
      agentControllerRef: "builtin:codex",
      observedAt: "2026-05-02T09:00:00.000Z",
      expiresAt: "2026-05-02T11:00:00.000Z",
      status: "unavailable",
    } as const;

    registry.registerRuntime({
      lookupInput,
      openMeldServiceRuntimeId,
    });

    expect(
      registry.acceptAgentControllerReport({
        lookupInput,
        now: "2026-05-02T10:05:00.000Z",
        report: newerReport,
      })
    ).toEqual({
      status: "accepted",
      reasonCodes: [],
      currentAgentControllerReport: newerReport,
    });
    expect(
      registry.acceptAgentControllerReport({
        lookupInput,
        now: "2026-05-02T10:05:00.000Z",
        report: olderReport,
      })
    ).toEqual({
      status: "rejected",
      reasonCodes: ["runtime.agent_controller_report_out_of_order"],
      currentAgentControllerReport: newerReport,
    });
    expect(
      registry.readRuntime(lookupInput)?.currentAgentControllerReport
    ).toEqual(newerReport);
    expect(
      registry.readRuntimeProjection(lookupInput)?.currentAgentControllerReport
    ).toEqual(newerReport);
  });

  it("does not create projection facts from a rejected agent controller report", () => {
    const registry = createInMemoryRuntimeRegistryContractFixture();
    const lookupInput = createAccountRuntimeLookupInput();
    const openMeldServiceRuntimeId = createRegistryRuntimeId(lookupInput);
    const staleReport = {
      agentControllerRef: "builtin:codex",
      observedAt: "2026-05-01T00:00:00.000Z",
      expiresAt: "2026-05-01T00:10:00.000Z",
      status: "ready",
    } as const;

    registry.registerRuntime({
      lookupInput,
      openMeldServiceRuntimeId,
    });

    expect(
      registry.acceptAgentControllerReport({
        lookupInput,
        now: "2026-05-02T00:05:00.000Z",
        report: staleReport,
      })
    ).toEqual({
      status: "rejected",
      reasonCodes: ["runtime.agent_controller_report_stale"],
      currentAgentControllerReport: undefined,
    });
    expect(
      registry.readRuntimeProjection(lookupInput)?.currentAgentControllerReport
    ).toBeUndefined();
  });
});
