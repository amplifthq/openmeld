import * as z from "zod/v4";
import { openMeldProfileIdSchema } from "../daemon/profile-identity";
import {
  START_BOUNDED_ID_SCHEMA,
  START_TRIMMED_NON_EMPTY_STRING_SCHEMA,
} from "./shared";

// Onboarding plan contract.
//
// The shared start planner (`buildOnboardingPlan` in `packages/start`) reads
// the six onboarding fact families and emits an ordered decision list. Web
// first-run, the in-Space "Get set up" checklist, and `openmeld setup` / `openmeld doctor`
// (human and agent views) all render slices of the same list. Renderers resolve
// copy from the decision `id`; the contract carries no user-facing strings.
//
// Owner: developing/product/onboarding.md ("The Start Planner").

export const onboardingActionIdSchema = z.enum([
  "sign_in",
  "set_display_name",
  "enter_space",
  "bring_agents",
  "connect_this_computer",
]);

export const onboardingDecisionStatusSchema = z.enum([
  "done",
  "available",
  "blocked",
]);

export const onboardingReasonCodeSchema = z.enum([
  "auth.signed_out",
  "auth.signed_in",
  "identity.name_missing",
  "identity.name_present",
  "space.none_in_context",
  "space.not_joined",
  "space.joined",
  "agents.none_yet",
  "agents.addable_present",
  "agents.member_present",
  "computer.connected",
  "computer.connecting",
  "computer.not_connected",
  "computer.evidence_unavailable",
]);

// One decision. `blocking` marks a prerequisite later decisions depend on
// (pre-join identity/space gates); setup decisions after the joined fact are
// non-blocking per onboarding.md Invariant 2. `run` is the exact agent-view
// command for CLI-executable actions (null otherwise). `afterRun` is a machine
// hint for the agent loop after running (e.g. "rerun_setup"; null otherwise).
export const onboardingPlanDecisionSchema = z.strictObject({
  id: onboardingActionIdSchema,
  status: onboardingDecisionStatusSchema,
  blocking: z.boolean(),
  reason: onboardingReasonCodeSchema,
  run: z.union([START_TRIMMED_NON_EMPTY_STRING_SCHEMA, z.null()]),
  afterRun: z.union([START_TRIMMED_NON_EMPTY_STRING_SCHEMA, z.null()]),
});

export const onboardingPlanSummarySchema = z.enum([
  "nothing_to_do",
  "actions_pending",
]);

export const onboardingPlanSchema = z.strictObject({
  decisions: z.array(onboardingPlanDecisionSchema).readonly(),
  summary: onboardingPlanSummarySchema,
});

// ---- Fact families (the planner inputs) ----

export const onboardingProfileKindSchema = z.enum(["human", "agent"]);

export const onboardingAccountProfileSchema = z.strictObject({
  profileId: openMeldProfileIdSchema,
  kind: onboardingProfileKindSchema,
  name: START_TRIMMED_NON_EMPTY_STRING_SCHEMA,
  active: z.boolean(),
});

// 1. Auth session. The signed-in branch carries the acting human profile id
// (used to build executable agent-view commands) and its display name (null
// when the account has no usable name yet, e.g. email signup); a name is the
// @-mention and Wake addressing label.
export const onboardingAuthFactSchema = z.discriminatedUnion("signedIn", [
  z.strictObject({
    signedIn: z.literal(true),
    userId: START_BOUNDED_ID_SCHEMA,
    actingProfileId: openMeldProfileIdSchema,
    actingDisplayName: z.union([
      START_TRIMMED_NON_EMPTY_STRING_SCHEMA,
      z.null(),
    ]),
  }),
  z.strictObject({ signedIn: z.literal(false) }),
]);

// 3. Target-Space membership snapshot. Null when no Space is in context
// (first-run "choose where to work"). `memberAgentProfileIds` contains every
// active agent member, including Organization-managed agents.
export const onboardingSpaceContextSchema = z.union([
  z.strictObject({
    spaceId: START_BOUNDED_ID_SCHEMA,
    actingProfileIsMember: z.boolean(),
    memberAgentProfileIds: z.array(openMeldProfileIdSchema).readonly(),
  }),
  z.null(),
]);

// 4. Device / service evidence: is this computer's OpenMeld Service connected. This
// is the live "OpenMeld Service Connected" fact (heartbeat-driven), consumed here,
// never re-derived. Whether an agent can be woken right now is a separate fact
// shown by the Space member badge (agentWakeAvailability), not the onboarding
// plan — Service is Service, Agent is Agent.
export const onboardingDeviceStatusSchema = z.enum([
  "connected",
  "connecting",
  "not_connected",
  "unknown",
]);
export const onboardingDeviceFactSchema = z.strictObject({
  status: onboardingDeviceStatusSchema,
});

// 5. Context slot. Reserved so a later Invite context becomes a new variant
// without changing the planner signature.
export const onboardingContextSlotSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("none") }),
  z.strictObject({
    kind: z.literal("web_setup_handoff"),
    startSessionToken: START_BOUNDED_ID_SCHEMA,
  }),
]);

export const onboardingFactsSchema = z
  .strictObject({
    auth: onboardingAuthFactSchema,
    accountProfiles: z.array(onboardingAccountProfileSchema).readonly(),
    space: onboardingSpaceContextSchema,
    device: onboardingDeviceFactSchema,
    context: onboardingContextSlotSchema,
  })
  .superRefine((value, ctx) => {
    const seenProfileIds = new Set<string>();
    for (const [index, profile] of value.accountProfiles.entries()) {
      if (seenProfileIds.has(profile.profileId)) {
        ctx.addIssue({
          code: "custom",
          message:
            "accountProfiles must not contain duplicate profileId values",
          path: ["accountProfiles", index, "profileId"],
        });
        continue;
      }
      seenProfileIds.add(profile.profileId);
    }
  });
