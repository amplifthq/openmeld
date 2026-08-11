import type {
  OnboardingAccountProfile,
  OnboardingFacts,
  OnboardingPlan,
  OnboardingPlanDecision,
  OnboardingReasonCode,
} from "@openmeld/schemas/types";

// buildOnboardingPlan — the shared onboarding engine.
//
// Pure function: six fact families in, one ordered decision list out. Web
// first-run, the in-Space "Get set up" checklist, and openmeld setup / openmeld doctor
// (human + agent views) render slices of the same list. No React / DOM /
// network / storage here.
//
// Owner: developing/product/onboarding.md ("The Start Planner").
//
// Service is Service, Agent is Agent: connect_this_computer reflects only the
// live OpenMeld Service connection; whether an agent can be woken right now is the
// Space member badge's job (agentWakeAvailability), not this plan. The plan
// tracks the two onboarding facts separately — is the computer connected, and
// is an agent in this Space.
//
// Invariants enforced structurally here:
// - Membership first (Invariant 2): setup decisions are only emitted after the
//   joined fact and are always non-blocking.
// - Honest: a decision is only emitted from the facts received; missing
//   prerequisites produce a blocked decision naming the gap, never a guess. A
//   joined account with no agent is not "all set" (bring_agents blocked).
// - Blocking means later decisions are not emitted: an unresolved blocker
//   (signed out, name missing, not joined) stops the list.

const RERUN_SETUP_HINT = "rerun_setup";

export function buildOnboardingPlan(facts: OnboardingFacts): OnboardingPlan {
  const decisions: OnboardingPlanDecision[] = [];

  // 1. Auth gate. Signed out: only sign_in is knowable; do not speculate about
  // profiles, Spaces, or this computer.
  if (!facts.auth.signedIn) {
    decisions.push(decide("sign_in", "available", true, "auth.signed_out"));
    return finalize(decisions);
  }
  const setupCommand = resolveSetupCommand(facts.context);
  decisions.push(decide("sign_in", "done", false, "auth.signed_in"));

  // 2. Identity. The acting display name doubles as the mention / Wake label.
  // A missing name is a blocker: stop before the Space decision.
  if (facts.auth.actingDisplayName === null) {
    decisions.push(
      decide("set_display_name", "available", true, "identity.name_missing")
    );
    return finalize(decisions);
  }
  decisions.push(
    decide("set_display_name", "done", false, "identity.name_present")
  );

  // 3. Space. No Space in context is first-run "choose where to work"; the
  // in-Space setup decisions belong to a joined Space, so stop here.
  if (facts.space === null) {
    decisions.push(
      decide("enter_space", "available", true, "space.none_in_context")
    );
    return finalize(decisions);
  }
  if (!facts.space.actingProfileIsMember) {
    decisions.push(
      decide("enter_space", "available", true, "space.not_joined")
    );
    // Membership first: setup decisions only after the joined fact.
    return finalize(decisions);
  }
  decisions.push(decide("enter_space", "done", false, "space.joined"));

  // 4. Agents — is at least one of your agents in this Space (membership)? Zero
  // agents is a blocked gap, not silence, so the plan is never "all set" with
  // no agent.
  decisions.push(
    resolveBringAgentsDecision({
      facts,
      space: facts.space,
      actingProfileId: facts.auth.actingProfileId,
    })
  );

  // 5. Connect this computer — the live OpenMeld Service connection fact only.
  decisions.push(
    resolveConnectComputerDecision({
      deviceStatus: facts.device.status,
      setupCommand,
    })
  );

  return finalize(decisions);
}

function resolveSetupCommand(context: OnboardingFacts["context"]): string {
  if (context.kind === "web_setup_handoff") {
    return `openmeld setup --start-session ${context.startSessionToken} --view agent`;
  }
  return "openmeld setup --view agent";
}

function decide(
  id: OnboardingPlanDecision["id"],
  status: OnboardingPlanDecision["status"],
  blocking: boolean,
  reason: OnboardingReasonCode,
  run: string | null = null,
  afterRun: string | null = null
): OnboardingPlanDecision {
  return { id, status, blocking, reason, run, afterRun };
}

function activeAgentProfiles(
  profiles: readonly OnboardingAccountProfile[]
): OnboardingAccountProfile[] {
  return profiles.filter(
    (profile) => profile.kind === "agent" && profile.active
  );
}

function resolveBringAgentsDecision(input: {
  facts: OnboardingFacts;
  space: NonNullable<OnboardingFacts["space"]>;
  actingProfileId: string;
}): OnboardingPlanDecision {
  const members = new Set<string>(input.space.memberAgentProfileIds);
  // The goal is for this Space to have an agent available for collaboration.
  // Organization-managed agents satisfy that goal just as account-owned agents
  // do, even though they do not appear in the caller's account profile list.
  if (members.size > 0) {
    return decide("bring_agents", "done", false, "agents.member_present");
  }
  const agents = activeAgentProfiles(input.facts.accountProfiles);
  if (agents.length === 0) {
    // The account has no agent at all. This is a real gap (a Space with no
    // agent does no agent work), distinct from the computer fact: getting a
    // first agent happens by setting one up on a computer. Blocked so the plan
    // is not "all set", with the prerequisite named.
    return decide("bring_agents", "blocked", false, "agents.none_yet");
  }
  return decide(
    "bring_agents",
    "available",
    false,
    "agents.addable_present",
    `openmeld space add-agents ${input.space.spaceId} --profile ${input.actingProfileId} --all --view agent`
  );
}

// Connect this computer keys only on the live "OpenMeld Service connected" fact, the
// same fact the Agents page shows. Whether an agent can be woken right now is a
// separate fact shown by the Space member badge, never merged in here — Service
// is Service, Agent is Agent.
function resolveConnectComputerDecision(input: {
  deviceStatus: OnboardingFacts["device"]["status"];
  setupCommand: string;
}): OnboardingPlanDecision {
  const { setupCommand } = input;
  switch (input.deviceStatus) {
    case "connected":
      return decide(
        "connect_this_computer",
        "done",
        false,
        "computer.connected"
      );
    case "connecting":
      return decide(
        "connect_this_computer",
        "available",
        false,
        "computer.connecting",
        setupCommand,
        RERUN_SETUP_HINT
      );
    case "not_connected":
      return decide(
        "connect_this_computer",
        "available",
        false,
        "computer.not_connected",
        setupCommand,
        RERUN_SETUP_HINT
      );
    case "unknown":
      return decide(
        "connect_this_computer",
        "blocked",
        false,
        "computer.evidence_unavailable"
      );
    default:
      return assertNeverDeviceStatus(input.deviceStatus);
  }
}

function finalize(decisions: OnboardingPlanDecision[]): OnboardingPlan {
  const hasPending = decisions.some(
    (decision) =>
      decision.status === "available" || decision.status === "blocked"
  );
  return {
    decisions,
    summary: hasPending ? "actions_pending" : "nothing_to_do",
  };
}

function assertNeverDeviceStatus(value: never): never {
  throw new Error(`unexpected device status: ${String(value)}`);
}
