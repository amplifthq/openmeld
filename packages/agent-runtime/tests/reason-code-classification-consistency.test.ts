import {
  resolveMappedPublicAgentFailureReason,
  resolvePublicAgentAvailabilityCopy,
} from "@openmeld/schemas";
import { describe, expect, it } from "vitest";
import { classifyAgentWakeAvailabilityReason } from "../src/agent-wake-availability";

// Wake failures are explained to users in at least two independent places:
// the members panel's live status (this package, agent-wake-availability.ts)
// and the persisted/rendered failure copy (packages/schemas's shared
// PUBLIC_FAILURE_RECOVERY_BY_CODE table). A 2026-07-12 investigation found
// these had drifted for the organization_binding_authorization reason code
// family -- the members panel recognized all 8 sub-codes via a prefix check,
// but the shared table (and the code that read it) only recognized one,
// so most sub-codes silently fell through to a generic "check the agent
// connection" message instead of naming the real problem.
//
// This test pins the reason codes that investigation confirmed both sides
// must agree on, so a future change that adds a new sub-code to one side
// (a family prefix check, a new pattern) without the other fails loudly
// here instead of silently reintroducing the same drift. It is deliberately
// narrow -- agent-wake-availability.ts recognizes many reason codes the
// shared table doesn't cover yet (that's tracked as follow-on migration
// work, not a regression of this fix) -- so it only covers the families
// this investigation actually reconciled.
const RECONCILED_REASON_CODES = [
  // organization_binding_authorization.* -- the family this fix targeted.
  "organization_binding_authorization.required",
  "organization_binding_authorization.binding_required",
  "organization_binding_authorization.lookup_failed",
  "organization_binding_authorization.no_bindings",
  "organization_binding_authorization.preference_unavailable",
  "organization_binding_authorization.profile_org_mismatch",
  "organization_binding_authorization.profile_owner_mismatch",
  "organization_binding_authorization.space_org_unavailable",
  // agent_profile_binding.* sub-codes this fix specifically checked or
  // added (disabled was missing from both sides before this fix).
  "agent_profile_binding.missing",
  "agent_profile_binding.disabled",
  "agent_profile_binding.owner_mismatch",
  // Reply-recovery reasons reconciled into the legal shared sources by
  // W-ERRH1. Keep exact codes here even when one side uses a family prefix so
  // a future prefix or ordering change cannot silently reopen the split.
  "provider_account.capacity_exhausted",
  "provider_account.subscription_access_unavailable",
  "provider_account.organization_access_disabled",
  "controller.auth.unauthenticated",
  // OpenMeld Service and route reasons with concrete reply-recovery copy.
  "service.not_running",
  "service.not_installed",
  "service.drifted",
  "local_service.reconnecting",
  "local_service.not_connected_for_account",
  "local_service.identity_mismatch",
  "local_service.unavailable",
  "agent_execution.route_missing",
  "agent_execution.route_offline",
  "agent_execution.route_unavailable",
  "route.not_registered",
  "route.offline",
  "route.unavailable",
  // Local setup reasons selected by reply-recovery Sets or copy branches.
  "controller.registry.disabled",
  "controller.bootstrap.failed",
  "controller.gateway.unhealthy",
  "agent_profile_binding.agent_controller_report_missing",
  "agent_profile_binding.agent_controller_report_stale",
] as const;

describe("reason code classification consistency", () => {
  it.each(
    RECONCILED_REASON_CODES
  )("keeps classifier, failure, and availability copy aligned for %s", (reasonCode) => {
    expect(classifyAgentWakeAvailabilityReason(reasonCode)).not.toBe(
      "diagnostic"
    );
    expect(resolveMappedPublicAgentFailureReason(reasonCode)).not.toBeNull();
    expect(
      resolvePublicAgentAvailabilityCopy(reasonCode)?.availabilitySummary
    ).toBeTruthy();
  });
});
