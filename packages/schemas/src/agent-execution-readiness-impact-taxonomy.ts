import { z } from "zod/v4";

export const AGENT_EXECUTION_READINESS_IMPACT_FRESH_TTL_MS = 30 * 60 * 1000;

export const AGENT_EXECUTION_READINESS_IMPACT_REASON_CODES = [
  "controller.launch.choice_required",
  "controller.launch.needs_repair",
  "controller.client.upgrade_required",
  "controller.runtime.missing",
  "runtime_coordinator.delivery_expired",
  "workspace.invalid",
  "workspace.missing",
] as const;

export const AGENT_EXECUTION_READINESS_IMPACT_KINDS = [
  "local_execution",
] as const;

export const AGENT_EXECUTION_READINESS_IMPACT_SOURCES = [
  "wake_failure",
] as const;

export const AGENT_EXECUTION_READINESS_IMPACT_EFFECTS = [
  "current_readiness_blocker",
] as const;

export const AGENT_EXECUTION_READINESS_IMPACT_SCOPES = [
  "agent_profile_binding_agent_controller_report",
] as const;

export const AGENT_EXECUTION_READINESS_IMPACT_CLEARING_TRIGGERS = [
  "fresh_ttl_expires",
  "matching_execution_running",
  "matching_execution_success",
] as const;

export type AgentExecutionReadinessImpactReasonCode =
  (typeof AGENT_EXECUTION_READINESS_IMPACT_REASON_CODES)[number];

export const AGENT_EXECUTION_READINESS_IMPACT_REASON_CODE_ALIASES = {
  "project.local_connection.folder_missing": "workspace.missing",
  "project.local_connection.missing": "workspace.missing",
  "profile.workspace.invalid": "workspace.invalid",
  "profile.workspace.missing": "workspace.missing",
} as const satisfies Record<string, AgentExecutionReadinessImpactReasonCode>;

export type AgentExecutionReadinessImpactReasonCodeAlias =
  keyof typeof AGENT_EXECUTION_READINESS_IMPACT_REASON_CODE_ALIASES;

export type AgentExecutionReadinessImpactKind =
  (typeof AGENT_EXECUTION_READINESS_IMPACT_KINDS)[number];

export type AgentExecutionReadinessImpactSource =
  (typeof AGENT_EXECUTION_READINESS_IMPACT_SOURCES)[number];

export type AgentExecutionReadinessImpactEffect =
  (typeof AGENT_EXECUTION_READINESS_IMPACT_EFFECTS)[number];

export type AgentExecutionReadinessImpactScope =
  (typeof AGENT_EXECUTION_READINESS_IMPACT_SCOPES)[number];

export type AgentExecutionReadinessImpactClearingTrigger =
  (typeof AGENT_EXECUTION_READINESS_IMPACT_CLEARING_TRIGGERS)[number];

export type AgentExecutionReadinessImpactTaxonomyEntry = {
  clearingTriggers: readonly AgentExecutionReadinessImpactClearingTrigger[];
  effect: AgentExecutionReadinessImpactEffect;
  freshTtlMs: number;
  impactKind: AgentExecutionReadinessImpactKind;
  reasonCode: AgentExecutionReadinessImpactReasonCode;
  scope: AgentExecutionReadinessImpactScope;
  source: AgentExecutionReadinessImpactSource;
};

export const AGENT_EXECUTION_READINESS_IMPACT_TAXONOMY = [
  {
    clearingTriggers: AGENT_EXECUTION_READINESS_IMPACT_CLEARING_TRIGGERS,
    effect: "current_readiness_blocker",
    freshTtlMs: AGENT_EXECUTION_READINESS_IMPACT_FRESH_TTL_MS,
    impactKind: "local_execution",
    reasonCode: "controller.launch.choice_required",
    scope: "agent_profile_binding_agent_controller_report",
    source: "wake_failure",
  },
  {
    clearingTriggers: AGENT_EXECUTION_READINESS_IMPACT_CLEARING_TRIGGERS,
    effect: "current_readiness_blocker",
    freshTtlMs: AGENT_EXECUTION_READINESS_IMPACT_FRESH_TTL_MS,
    impactKind: "local_execution",
    reasonCode: "controller.launch.needs_repair",
    scope: "agent_profile_binding_agent_controller_report",
    source: "wake_failure",
  },
  {
    clearingTriggers: AGENT_EXECUTION_READINESS_IMPACT_CLEARING_TRIGGERS,
    effect: "current_readiness_blocker",
    freshTtlMs: AGENT_EXECUTION_READINESS_IMPACT_FRESH_TTL_MS,
    impactKind: "local_execution",
    reasonCode: "controller.client.upgrade_required",
    scope: "agent_profile_binding_agent_controller_report",
    source: "wake_failure",
  },
  {
    clearingTriggers: AGENT_EXECUTION_READINESS_IMPACT_CLEARING_TRIGGERS,
    effect: "current_readiness_blocker",
    freshTtlMs: AGENT_EXECUTION_READINESS_IMPACT_FRESH_TTL_MS,
    impactKind: "local_execution",
    reasonCode: "controller.runtime.missing",
    scope: "agent_profile_binding_agent_controller_report",
    source: "wake_failure",
  },
  {
    clearingTriggers: AGENT_EXECUTION_READINESS_IMPACT_CLEARING_TRIGGERS,
    effect: "current_readiness_blocker",
    freshTtlMs: AGENT_EXECUTION_READINESS_IMPACT_FRESH_TTL_MS,
    impactKind: "local_execution",
    reasonCode: "runtime_coordinator.delivery_expired",
    scope: "agent_profile_binding_agent_controller_report",
    source: "wake_failure",
  },
  {
    clearingTriggers: AGENT_EXECUTION_READINESS_IMPACT_CLEARING_TRIGGERS,
    effect: "current_readiness_blocker",
    freshTtlMs: AGENT_EXECUTION_READINESS_IMPACT_FRESH_TTL_MS,
    impactKind: "local_execution",
    reasonCode: "workspace.invalid",
    scope: "agent_profile_binding_agent_controller_report",
    source: "wake_failure",
  },
  {
    clearingTriggers: AGENT_EXECUTION_READINESS_IMPACT_CLEARING_TRIGGERS,
    effect: "current_readiness_blocker",
    freshTtlMs: AGENT_EXECUTION_READINESS_IMPACT_FRESH_TTL_MS,
    impactKind: "local_execution",
    reasonCode: "workspace.missing",
    scope: "agent_profile_binding_agent_controller_report",
    source: "wake_failure",
  },
] as const satisfies readonly AgentExecutionReadinessImpactTaxonomyEntry[];

export const KNOWN_FINAL_FAILURE_REASON_CODES_WITHOUT_READINESS_IMPACT = [
  "openmeld.space_action.repair_failed",
  "daemon.delivery.execution_stalled",
  "daemon.delivery.finalization_timeout",
  "daemon.delivery.start_timeout",
  "daemon.delivery.timeout",
  "delivery.result_timeout",
  "delivery.start_timeout",
  "final_visible_outcome.publication_pending",
  "final_visible_outcome.publication_retrying",
  "final_visible_outcome.publication_unresolved",
  "local_adapter.timeout",
  "reply.invalid_space_action",
  "reply.publication_failed",
  "runtime.progress_stale",
  "runtime.reply.empty_output",
  "runtime.reply.metadata_missing.agent_controller_ref",
  "runtime_coordinator.failure_publication_failed",
  "runtime_coordinator.failure_publication_unavailable",
  "runtime_coordinator.publication_retry_exhausted",
  "runtime_coordinator.publication_unresolved",
  "space.signal.persist_failed",
  "timed_out_after_output",
  "timed_out_no_output",
  "timeout",
] as const;

export type KnownFinalFailureReasonCodeWithoutReadinessImpact =
  (typeof KNOWN_FINAL_FAILURE_REASON_CODES_WITHOUT_READINESS_IMPACT)[number];

export const agentExecutionReadinessImpactReasonCodeSchema = z.enum(
  AGENT_EXECUTION_READINESS_IMPACT_REASON_CODES
);

export const agentExecutionReadinessImpactKindSchema = z.enum(
  AGENT_EXECUTION_READINESS_IMPACT_KINDS
);

export const agentExecutionReadinessImpactSourceSchema = z.enum(
  AGENT_EXECUTION_READINESS_IMPACT_SOURCES
);

export const agentExecutionReadinessImpactEffectSchema = z.enum(
  AGENT_EXECUTION_READINESS_IMPACT_EFFECTS
);

export const agentExecutionReadinessImpactScopeSchema = z.enum(
  AGENT_EXECUTION_READINESS_IMPACT_SCOPES
);

export const agentExecutionReadinessImpactClearingTriggerSchema = z.enum(
  AGENT_EXECUTION_READINESS_IMPACT_CLEARING_TRIGGERS
);

export function resolveAgentExecutionReadinessImpactTaxonomyEntry(
  reasonCode: unknown
): AgentExecutionReadinessImpactTaxonomyEntry | null {
  const resolvedReasonCode =
    resolveAgentExecutionReadinessImpactReasonCode(reasonCode);
  if (!resolvedReasonCode) {
    return null;
  }
  return (
    AGENT_EXECUTION_READINESS_IMPACT_TAXONOMY.find(
      (entry) => entry.reasonCode === resolvedReasonCode
    ) ?? null
  );
}

export function resolveAgentExecutionReadinessImpactReasonCode(
  reasonCode: unknown
): AgentExecutionReadinessImpactReasonCode | null {
  if (typeof reasonCode !== "string") {
    return null;
  }
  const normalized = reasonCode.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  const alias =
    AGENT_EXECUTION_READINESS_IMPACT_REASON_CODE_ALIASES[
      normalized as AgentExecutionReadinessImpactReasonCodeAlias
    ];
  if (alias) {
    return alias;
  }
  return AGENT_EXECUTION_READINESS_IMPACT_REASON_CODES.includes(
    normalized as AgentExecutionReadinessImpactReasonCode
  )
    ? (normalized as AgentExecutionReadinessImpactReasonCode)
    : null;
}

export function isAgentExecutionReadinessImpactReasonCode(
  reasonCode: unknown
): boolean {
  return resolveAgentExecutionReadinessImpactReasonCode(reasonCode) !== null;
}

export function isKnownFinalFailureReasonCodeWithoutReadinessImpact(
  reasonCode: unknown
): reasonCode is KnownFinalFailureReasonCodeWithoutReadinessImpact {
  return (
    typeof reasonCode === "string" &&
    KNOWN_FINAL_FAILURE_REASON_CODES_WITHOUT_READINESS_IMPACT.includes(
      reasonCode as KnownFinalFailureReasonCodeWithoutReadinessImpact
    )
  );
}
