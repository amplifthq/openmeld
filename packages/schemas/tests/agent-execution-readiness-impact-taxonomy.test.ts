import { describe, expect, it } from "vitest";
import {
  AGENT_EXECUTION_READINESS_IMPACT_FRESH_TTL_MS,
  AGENT_EXECUTION_READINESS_IMPACT_REASON_CODE_ALIASES,
  AGENT_EXECUTION_READINESS_IMPACT_TAXONOMY,
  agentExecutionReadinessImpactKindSchema,
  agentExecutionReadinessImpactReasonCodeSchema,
  agentExecutionReadinessImpactSourceSchema,
  isAgentExecutionReadinessImpactReasonCode,
  isKnownFinalFailureReasonCodeWithoutReadinessImpact,
  resolveAgentExecutionReadinessImpactReasonCode,
  resolveAgentExecutionReadinessImpactTaxonomyEntry,
} from "../src";

describe("agent execution readiness impact taxonomy", () => {
  it("defines the current readiness blocker taxonomy as a shared contract", () => {
    expect(AGENT_EXECUTION_READINESS_IMPACT_TAXONOMY).toEqual([
      {
        clearingTriggers: [
          "fresh_ttl_expires",
          "matching_execution_running",
          "matching_execution_success",
        ],
        effect: "current_readiness_blocker",
        freshTtlMs: AGENT_EXECUTION_READINESS_IMPACT_FRESH_TTL_MS,
        impactKind: "local_execution",
        reasonCode: "controller.launch.choice_required",
        scope: "agent_profile_binding_agent_controller_report",
        source: "wake_failure",
      },
      {
        clearingTriggers: [
          "fresh_ttl_expires",
          "matching_execution_running",
          "matching_execution_success",
        ],
        effect: "current_readiness_blocker",
        freshTtlMs: AGENT_EXECUTION_READINESS_IMPACT_FRESH_TTL_MS,
        impactKind: "local_execution",
        reasonCode: "controller.launch.needs_repair",
        scope: "agent_profile_binding_agent_controller_report",
        source: "wake_failure",
      },
      {
        clearingTriggers: [
          "fresh_ttl_expires",
          "matching_execution_running",
          "matching_execution_success",
        ],
        effect: "current_readiness_blocker",
        freshTtlMs: AGENT_EXECUTION_READINESS_IMPACT_FRESH_TTL_MS,
        impactKind: "local_execution",
        reasonCode: "controller.client.upgrade_required",
        scope: "agent_profile_binding_agent_controller_report",
        source: "wake_failure",
      },
      {
        clearingTriggers: [
          "fresh_ttl_expires",
          "matching_execution_running",
          "matching_execution_success",
        ],
        effect: "current_readiness_blocker",
        freshTtlMs: AGENT_EXECUTION_READINESS_IMPACT_FRESH_TTL_MS,
        impactKind: "local_execution",
        reasonCode: "controller.runtime.missing",
        scope: "agent_profile_binding_agent_controller_report",
        source: "wake_failure",
      },
      {
        clearingTriggers: [
          "fresh_ttl_expires",
          "matching_execution_running",
          "matching_execution_success",
        ],
        effect: "current_readiness_blocker",
        freshTtlMs: AGENT_EXECUTION_READINESS_IMPACT_FRESH_TTL_MS,
        impactKind: "local_execution",
        reasonCode: "runtime_coordinator.delivery_expired",
        scope: "agent_profile_binding_agent_controller_report",
        source: "wake_failure",
      },
      {
        clearingTriggers: [
          "fresh_ttl_expires",
          "matching_execution_running",
          "matching_execution_success",
        ],
        effect: "current_readiness_blocker",
        freshTtlMs: AGENT_EXECUTION_READINESS_IMPACT_FRESH_TTL_MS,
        impactKind: "local_execution",
        reasonCode: "workspace.invalid",
        scope: "agent_profile_binding_agent_controller_report",
        source: "wake_failure",
      },
      {
        clearingTriggers: [
          "fresh_ttl_expires",
          "matching_execution_running",
          "matching_execution_success",
        ],
        effect: "current_readiness_blocker",
        freshTtlMs: AGENT_EXECUTION_READINESS_IMPACT_FRESH_TTL_MS,
        impactKind: "local_execution",
        reasonCode: "workspace.missing",
        scope: "agent_profile_binding_agent_controller_report",
        source: "wake_failure",
      },
    ]);
  });

  it.each([
    "controller.launch.choice_required",
    "controller.launch.needs_repair",
    "controller.client.upgrade_required",
    "controller.runtime.missing",
    "runtime_coordinator.delivery_expired",
    "workspace.invalid",
    "workspace.missing",
  ])("accepts readiness impact reason code %s", (reasonCode) => {
    expect(isAgentExecutionReadinessImpactReasonCode(reasonCode)).toBe(true);
    expect(resolveAgentExecutionReadinessImpactReasonCode(reasonCode)).toBe(
      reasonCode
    );
    expect(
      agentExecutionReadinessImpactReasonCodeSchema.parse(reasonCode)
    ).toBe(reasonCode);
    expect(
      resolveAgentExecutionReadinessImpactTaxonomyEntry(reasonCode)
    ).toMatchObject({
      effect: "current_readiness_blocker",
      impactKind: "local_execution",
      scope: "agent_profile_binding_agent_controller_report",
      source: "wake_failure",
    });
  });

  it.each([
    ["project.local_connection.folder_missing", "workspace.missing"],
    ["project.local_connection.missing", "workspace.missing"],
    ["profile.workspace.invalid", "workspace.invalid"],
    ["profile.workspace.missing", "workspace.missing"],
  ] as const)("normalizes accepted failure alias %s to canonical readiness impact %s", (aliasReasonCode, canonicalReasonCode) => {
    expect(AGENT_EXECUTION_READINESS_IMPACT_REASON_CODE_ALIASES).toMatchObject({
      [aliasReasonCode]: canonicalReasonCode,
    });
    expect(isAgentExecutionReadinessImpactReasonCode(aliasReasonCode)).toBe(
      true
    );
    expect(
      resolveAgentExecutionReadinessImpactReasonCode(aliasReasonCode)
    ).toBe(canonicalReasonCode);
    expect(
      resolveAgentExecutionReadinessImpactTaxonomyEntry(aliasReasonCode)
    )?.toMatchObject({
      effect: "current_readiness_blocker",
      reasonCode: canonicalReasonCode,
    });
    expect(
      agentExecutionReadinessImpactReasonCodeSchema.safeParse(aliasReasonCode)
        .success
    ).toBe(false);
  });

  it.each([
    "openmeld.space_action.repair_failed",
    "daemon.delivery.execution_stalled",
    "daemon.delivery.finalization_timeout",
    "daemon.delivery.start_timeout",
    "daemon.delivery.timeout",
    "reply.invalid_space_action",
    "reply.publication_failed",
    "runtime.progress_stale",
    "runtime.reply.empty_output",
    "runtime.reply.metadata_missing.agent_controller_ref",
    "runtime_coordinator.failure_publication_failed",
    "runtime_coordinator.publication_retry_exhausted",
    "timed_out_after_output",
    "timed_out_no_output",
  ])("keeps non-taxonomy final failure reason code %s out of readiness impact", (reasonCode) => {
    expect(isAgentExecutionReadinessImpactReasonCode(reasonCode)).toBe(false);
    expect(
      agentExecutionReadinessImpactReasonCodeSchema.safeParse(reasonCode)
        .success
    ).toBe(false);
    expect(
      resolveAgentExecutionReadinessImpactTaxonomyEntry(reasonCode)
    ).toBeNull();
    expect(
      isKnownFinalFailureReasonCodeWithoutReadinessImpact(reasonCode)
    ).toBe(true);
  });

  it("does not track delivery_expired as a known final failure without readiness impact", () => {
    expect(
      isKnownFinalFailureReasonCodeWithoutReadinessImpact(
        "runtime_coordinator.delivery_expired"
      )
    ).toBe(false);
    expect(
      isAgentExecutionReadinessImpactReasonCode(
        "runtime_coordinator.delivery_expired"
      )
    ).toBe(true);
    expect(
      isKnownFinalFailureReasonCodeWithoutReadinessImpact(
        "controller.runtime.missing"
      )
    ).toBe(false);
  });

  it("exports schemas for the readiness impact fact fields used by HTTP readiness", () => {
    expect(
      agentExecutionReadinessImpactKindSchema.parse("local_execution")
    ).toBe("local_execution");
    expect(
      agentExecutionReadinessImpactSourceSchema.parse("wake_failure")
    ).toBe("wake_failure");
  });
});
