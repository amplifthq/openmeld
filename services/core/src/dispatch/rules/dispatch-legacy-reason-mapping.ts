export type DispatchCompatibilityFailureReason =
  | "capability_unavailable"
  | "conflict"
  | "disabled"
  | "lookup_failed"
  | "missing"
  | "owner_mismatch"
  | "runtime_forgotten"
  | "runtime_unavailable";

export type DispatchCompatibilityReasonMapping = {
  readonly agentProfileBindingReason: string | null;
  readonly compatibilityFailureReason: DispatchCompatibilityFailureReason;
  readonly sourceReason: string;
  readonly traceReason: string;
};

export const DISPATCH_LEGACY_REASON_MAPPINGS = [
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

const DISPATCH_LEGACY_REASON_MAP = new Map<
  string,
  DispatchCompatibilityReasonMapping
>(
  DISPATCH_LEGACY_REASON_MAPPINGS.map((mapping) => [
    mapping.sourceReason,
    mapping,
  ])
);

export const mapDispatchCompatibilityReason = (
  sourceReason: string
): DispatchCompatibilityReasonMapping | null => {
  const normalized = sourceReason.trim();
  if (normalized.length === 0) {
    return null;
  }
  return DISPATCH_LEGACY_REASON_MAP.get(normalized) ?? null;
};
