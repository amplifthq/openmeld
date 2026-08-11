import { describe, expect, it } from "vitest";
import {
  DISPATCH_LEGACY_REASON_MAPPINGS,
  type DispatchCompatibilityReasonMapping,
  mapDispatchCompatibilityReason,
} from "../dispatch/rules/dispatch-legacy-reason-mapping";

const EXPECTED_REASON_MAPPINGS = [
  {
    agentProfileBindingReason: "agent_profile_binding.missing",
    compatibilityFailureReason: "missing",
    sourceReason: "controller.binding.missing",
    traceReason: "agent_profile_binding.missing",
  },
  {
    agentProfileBindingReason: "agent_profile_binding.disabled",
    compatibilityFailureReason: "disabled",
    sourceReason: "controller.binding.disabled",
    traceReason: "agent_profile_binding.disabled",
  },
  {
    agentProfileBindingReason: "agent_profile_binding.missing",
    compatibilityFailureReason: "missing",
    sourceReason: "controller.binding.incomplete",
    traceReason: "agent_profile_binding.missing",
  },
  {
    agentProfileBindingReason: "agent_profile_binding.conflict",
    compatibilityFailureReason: "conflict",
    sourceReason: "controller.binding.conflict",
    traceReason: "agent_profile_binding.conflict",
  },
  {
    agentProfileBindingReason: "agent_profile_binding.lookup_failed",
    compatibilityFailureReason: "lookup_failed",
    sourceReason: "controller.binding.lookup_failed",
    traceReason: "agent_profile_binding.lookup_failed",
  },
  {
    agentProfileBindingReason: "agent_profile_binding.owner_mismatch",
    compatibilityFailureReason: "owner_mismatch",
    sourceReason: "agent_profile_binding.owner_mismatch",
    traceReason: "agent_profile_binding.owner_mismatch",
  },
  {
    agentProfileBindingReason: "agent_profile_binding.owner_mismatch",
    compatibilityFailureReason: "owner_mismatch",
    sourceReason: "controller.binding.owner_mismatch",
    traceReason: "agent_profile_binding.owner_mismatch",
  },
  {
    agentProfileBindingReason: null,
    compatibilityFailureReason: "runtime_unavailable",
    sourceReason: "daemon.profile.offline",
    traceReason: "runtime_unavailable",
  },
  {
    agentProfileBindingReason: null,
    compatibilityFailureReason: "runtime_unavailable",
    sourceReason: "daemon.session.not_found",
    traceReason: "runtime_unavailable",
  },
  {
    agentProfileBindingReason: null,
    compatibilityFailureReason: "runtime_unavailable",
    sourceReason: "runtime.unavailable",
    traceReason: "runtime_unavailable",
  },
  {
    agentProfileBindingReason: null,
    compatibilityFailureReason: "runtime_forgotten",
    sourceReason: "controller.runtime.missing",
    traceReason: "runtime_forgotten",
  },
  {
    agentProfileBindingReason: null,
    compatibilityFailureReason: "runtime_forgotten",
    sourceReason: "runtime.forgotten",
    traceReason: "runtime_forgotten",
  },
  {
    agentProfileBindingReason: null,
    compatibilityFailureReason: "capability_unavailable",
    sourceReason: "controller.kind.unsupported",
    traceReason: "capability_unavailable",
  },
  {
    agentProfileBindingReason: null,
    compatibilityFailureReason: "capability_unavailable",
    sourceReason: "controller.ref.invalid",
    traceReason: "capability_unavailable",
  },
  {
    agentProfileBindingReason: null,
    compatibilityFailureReason: "capability_unavailable",
    sourceReason: "capability.unavailable",
    traceReason: "capability_unavailable",
  },
] as const satisfies readonly DispatchCompatibilityReasonMapping[];

describe("dispatch legacy reason mapping", () => {
  it("covers the full legacy binding, runtime, and capability reason fixture set", () => {
    expect(DISPATCH_LEGACY_REASON_MAPPINGS).toEqual(EXPECTED_REASON_MAPPINGS);

    for (const mapping of EXPECTED_REASON_MAPPINGS) {
      expect(mapDispatchCompatibilityReason(mapping.sourceReason)).toEqual(
        mapping
      );
    }
  });

  it("keeps unknown compatibility reasons outside the legacy mapping table", () => {
    expect(mapDispatchCompatibilityReason("dispatch.rules.denied")).toBeNull();
    expect(
      mapDispatchCompatibilityReason("policy_version_mismatch")
    ).toBeNull();
    expect(mapDispatchCompatibilityReason(" stale_policy ")).toBeNull();
  });
});
