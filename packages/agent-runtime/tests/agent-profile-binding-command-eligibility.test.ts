import { describe, expect, it } from "vitest";
import {
  createAuthorityOpenMeldServiceRuntimeId,
  createInMemoryRuntimeRegistryContractFixture,
  createRuntimeLookupInput,
  type RuntimeAgentControllerReport,
  type RuntimeLookupInput,
  resolveAgentProfileBindingCommandEligibility,
} from "../src";

const createAllowedOwnerAuthorization = () =>
  ({
    status: "allowed",
  }) as const;

const createValidProfileOwnerValidation = () =>
  ({
    status: "valid",
  }) as const;

const createLookupInput = (): RuntimeLookupInput =>
  createRuntimeLookupInput({
    owner: {
      kind: "owner_account",
      id: "account-1",
    },
    deviceId: "device-1",
    lane: "openmeld-dev",
  });

const createOpaqueRuntimeId = () => {
  const lookupInput = createLookupInput();
  return createAuthorityOpenMeldServiceRuntimeId({
    lookupInput,
    openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
    source: "runtime_registry_authority",
  });
};

const createFreshRuntimeAgentControllerReport =
  (): RuntimeAgentControllerReport => {
    const lookupInput = createLookupInput();
    const openMeldServiceRuntimeId = createOpaqueRuntimeId();
    const registry = createInMemoryRuntimeRegistryContractFixture();
    registry.registerRuntime({
      lookupInput,
      openMeldServiceRuntimeId,
    });
    registry.acceptAgentControllerReport({
      lookupInput,
      now: "2026-05-02T00:05:00.000Z",
      report: {
        agentControllerRef: "builtin:codex",
        observedAt: "2026-05-02T00:00:00.000Z",
        expiresAt: "2026-05-02T00:10:00.000Z",
        status: "ready",
      },
    });
    const report =
      registry.readRuntimeProjection(lookupInput)?.currentAgentControllerReport;
    if (!report) {
      throw new Error(
        "test setup failed: missing runtime agent controller report"
      );
    }
    return report;
  };

const createValidAgentControllerReportInput = () => {
  const lookupInput = createLookupInput();
  return {
    openMeldServiceRuntimeId: createAuthorityOpenMeldServiceRuntimeId({
      lookupInput,
      openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
      source: "runtime_registry_authority",
    }),
    runtimeLookupInput: lookupInput,
    agentControllerRef: "builtin:codex",
  } as const;
};

describe("agent-runtime Agent Profile Binding command eligibility contract", () => {
  it("blocks Binding eligibility when A2 owner authorization denies or cannot prove owner access", () => {
    for (const ownerAuthorization of [
      {
        status: "denied",
        reasonCode: "binding.command.caller_not_allowed",
      },
      {
        status: "unavailable",
        reasonCode: "binding.command.owner_authorization_unavailable",
      },
      {
        status: "unknown",
        reasonCode: "binding.command.owner_authorization_unknown",
      },
    ] as const) {
      expect(
        resolveAgentProfileBindingCommandEligibility({
          agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
          ownerAuthorization,
          profileOwnerValidation: createValidProfileOwnerValidation(),
        })
      ).toEqual({
        bindable: false,
        routable: false,
        grantsClaimSuccess: false,
        executionTarget: null,
        reasonCodes: [ownerAuthorization.reasonCode],
      });
    }
  });

  it("keeps allowed owner authorization as only one input, not a Binding decision", () => {
    expect(
      resolveAgentProfileBindingCommandEligibility({
        agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
        ownerAuthorization: createAllowedOwnerAuthorization(),
        profileOwnerValidation: createValidProfileOwnerValidation(),
      })
    ).toMatchObject({
      bindable: false,
      routable: false,
      grantsClaimSuccess: false,
      executionTarget: null,
    });
  });

  it("blocks Binding eligibility when A2 Profile owner validation is invalid or unavailable", () => {
    for (const profileOwnerValidation of [
      {
        status: "invalid",
        reasonCode: "binding.command.agent_profile_owner_mismatch",
      },
      {
        status: "unavailable",
        reasonCode: "binding.command.agent_profile_validation_unavailable",
      },
      {
        status: "unknown",
        reasonCode: "binding.command.agent_profile_validation_unknown",
      },
    ] as const) {
      expect(
        resolveAgentProfileBindingCommandEligibility({
          agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
          ownerAuthorization: createAllowedOwnerAuthorization(),
          profileOwnerValidation,
        })
      ).toEqual({
        bindable: false,
        routable: false,
        grantsClaimSuccess: false,
        executionTarget: null,
        reasonCodes: [profileOwnerValidation.reasonCode],
      });
    }
  });

  it("requires Binding target to use an opaque openMeldServiceRuntimeId and agentControllerRef together", () => {
    for (const executionTarget of [
      {
        openMeldServiceRuntimeId:
          "owner_account:account-1:device-1:openmeld-dev",
        agentControllerRef: "builtin:codex",
      },
      {
        openMeldServiceRuntimeId: createOpaqueRuntimeId(),
      },
      {
        agentControllerRef: "builtin:codex",
      },
    ] as const) {
      expect(
        resolveAgentProfileBindingCommandEligibility({
          agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
          ownerAuthorization: createAllowedOwnerAuthorization(),
          profileOwnerValidation: createValidProfileOwnerValidation(),
          executionTarget,
        })
      ).toEqual({
        bindable: false,
        routable: false,
        grantsClaimSuccess: false,
        executionTarget: null,
        reasonCodes: ["agent_profile_binding.agent_controller_report_invalid"],
      });
    }
  });

  it("rejects structurally forged Runtime authority ids that are still client-computed lookup strings", () => {
    const lookupInput = createLookupInput();

    expect(
      resolveAgentProfileBindingCommandEligibility({
        agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
        ownerAuthorization: createAllowedOwnerAuthorization(),
        profileOwnerValidation: createValidProfileOwnerValidation(),
        executionTarget: {
          openMeldServiceRuntimeId: {
            source: "runtime_registry_authority",
            value: "owner_account:account-1:device-1:openmeld-dev",
          },
          runtimeLookupInput: lookupInput,
          agentControllerRef: "builtin:codex",
        },
        runtimeAgentControllerReport: {
          agentControllerRef: "builtin:codex",
          observedAt: "2026-05-02T00:00:00.000Z",
          expiresAt: "2026-05-02T00:10:00.000Z",
          status: "ready",
        },
        now: "2026-05-02T00:05:00.000Z",
      })
    ).toEqual({
      bindable: false,
      routable: false,
      grantsClaimSuccess: false,
      executionTarget: null,
      reasonCodes: ["agent_profile_binding.agent_controller_report_invalid"],
    });
  });

  it("blocks bindable and routable eligibility when Agent Controller availability facts are missing, stale, disabled, unavailable, or owner-mismatched", () => {
    const freshReport = createFreshRuntimeAgentControllerReport();

    for (const runtimeEvidence of [
      {
        report: undefined,
        reasonCode: "agent_profile_binding.agent_controller_report_missing",
      },
      {
        report: {
          agentControllerRef: "builtin:codex",
          observedAt: "2026-05-01T00:00:00.000Z",
          expiresAt: "2026-05-01T00:10:00.000Z",
          status: "ready",
        } satisfies RuntimeAgentControllerReport,
        reasonCode: "agent_profile_binding.agent_controller_report_stale",
      },
      {
        report: {
          ...freshReport,
          status: "disabled",
        } satisfies RuntimeAgentControllerReport,
        reasonCode: "agent_profile_binding.agent_controller_report_disabled",
      },
      {
        report: {
          ...freshReport,
          status: "unavailable",
        } satisfies RuntimeAgentControllerReport,
        reasonCode: "agent_profile_binding.agent_controller_report_unavailable",
      },
      {
        report: freshReport,
        runtimeOwnerMatches: false,
        reasonCode: "agent_profile_binding.runtime_owner_mismatch",
      },
    ] as const) {
      expect(
        resolveAgentProfileBindingCommandEligibility({
          agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
          ownerAuthorization: createAllowedOwnerAuthorization(),
          profileOwnerValidation: createValidProfileOwnerValidation(),
          executionTarget: createValidAgentControllerReportInput(),
          runtimeAgentControllerReport: runtimeEvidence.report,
          runtimeOwnerMatches: runtimeEvidence.runtimeOwnerMatches,
          now: "2026-05-02T00:05:00.000Z",
        })
      ).toEqual({
        bindable: false,
        routable: false,
        grantsClaimSuccess: false,
        executionTarget: {
          openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
          agentControllerRef: "builtin:codex",
        },
        reasonCodes: [runtimeEvidence.reasonCode],
      });
    }

    expect(
      resolveAgentProfileBindingCommandEligibility({
        agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
        ownerAuthorization: createAllowedOwnerAuthorization(),
        profileOwnerValidation: createValidProfileOwnerValidation(),
        executionTarget: createValidAgentControllerReportInput(),
        runtimeAgentControllerReport: freshReport,
        now: "2026-05-02T00:05:00.000Z",
      })
    ).toEqual({
      bindable: true,
      routable: true,
      grantsClaimSuccess: false,
      executionTarget: {
        openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
        agentControllerRef: "builtin:codex",
      },
      reasonCodes: ["agent_profile_binding.command_eligible"],
    });
  });

  it("does not create Binding eligibility without execution target evidence", () => {
    expect(
      resolveAgentProfileBindingCommandEligibility({
        agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
        ownerAuthorization: createAllowedOwnerAuthorization(),
        profileOwnerValidation: createValidProfileOwnerValidation(),
      })
    ).toEqual({
      bindable: false,
      routable: false,
      grantsClaimSuccess: false,
      executionTarget: null,
      reasonCodes: ["agent_profile_binding.agent_controller_report_missing"],
    });
  });
});
