import * as z from "zod/v4";
import { type HarnessKind, harnessKindSchema } from "../daemon/harness-kind";
import { agentWakeAvailabilityCategorySchema } from "./agent-execution-readiness";
import { memberAgentSchema } from "./member-agents";

// MemberAgent catalog sync and derived presence
// (design-plans/member-agent-program.md §4.1, §4.5). Both are owner reads or
// writes for the signed-in member's current Organization and are gated by
// MEMBER_AGENTS_ENABLED.

const identifierSchema = z.string().trim().min(1);

// Auth rejects renaming a detected MemberAgent's default Profile: its name is
// the Harness display name.
export const AUTO_DETECTED_PROFILE_NAME_LOCKED_CODE =
  "profile.auto_detected_name_locked";
const reasonCodeSchema = z.string().trim().min(1).max(256);

// Gateway routes. They sit under the current Organization so they never
// collide with Auth's `GET /v1/member-agents` listing.
export const MEMBER_AGENT_SYNC_ROUTE =
  "/v1/organizations/current/member-agents/sync";
export const MEMBER_AGENT_PRESENCE_ROUTE =
  "/v1/organizations/current/member-agents/presence";

/**
 * Deterministic creation key of a detected MemberAgent's default Profile.
 * Auth scopes Profile idempotency keys per owner, so the key names only the
 * Organization and the Harness.
 */
export function buildDetectedMemberAgentIdempotencyKey(input: {
  harnessKind: HarnessKind;
  organizationId: string;
}): string {
  return `auto:${input.organizationId}:${input.harnessKind}`;
}

// Only builtin local Harnesses are detected from a catalog report. `hosted`
// MemberAgents are created manually.
export const detectedHarnessKindSchema = harnessKindSchema.exclude(["hosted"]);
export type DetectedHarnessKind = z.infer<typeof detectedHarnessKindSchema>;

// Core -> Auth RPC: ensure one detected MemberAgent with its default Profile.
export const ensureDetectedMemberAgentRpcInputSchema = z.strictObject({
  organizationId: identifierSchema,
  ownerUserId: identifierSchema,
  harnessKind: detectedHarnessKindSchema,
});
export type EnsureDetectedMemberAgentRpcInput = z.infer<
  typeof ensureDetectedMemberAgentRpcInputSchema
>;

export const ensureDetectedMemberAgentRpcResultSchema = z.discriminatedUnion(
  "ok",
  [
    z.strictObject({
      ok: z.literal(true),
      // True only when this call inserted the MemberAgent row.
      created: z.boolean(),
      memberAgent: memberAgentSchema,
      // While the MemberAgent has no default Profile: its keyed default
      // Profile, which Core binds and assigns under the Profile's
      // assignment lock. Auth sets the default only once Core assigned it.
      defaultProfileCandidateId: identifierSchema.nullable().default(null),
    }),
    z.strictObject({
      ok: z.literal(false),
      code: reasonCodeSchema,
      message: z.string().min(1),
    }),
  ]
);
export type EnsureDetectedMemberAgentRpcResult = z.infer<
  typeof ensureDetectedMemberAgentRpcResultSchema
>;

// Core -> Auth RPC: put a bound Agent Profile under the owner's existing
// MemberAgent for the Harness of its Binding. Core calls it after it accepts
// a Binding write, and catalog sync calls it for Profiles still unassigned.
// It never creates a MemberAgent and never moves an assigned Profile.
export const assignAgentProfileMemberAgentRpcInputSchema = z.strictObject({
  ownerUserId: identifierSchema,
  profileId: identifierSchema,
  harnessKind: harnessKindSchema,
});
export type AssignAgentProfileMemberAgentRpcInput = z.infer<
  typeof assignAgentProfileMemberAgentRpcInputSchema
>;

export const assignAgentProfileMemberAgentOutcomeSchema = z.enum([
  // This call set the Profile's MemberAgent.
  "assigned",
  // The Profile already belongs to the MemberAgent of this Harness.
  "unchanged",
  // The owner has no MemberAgent for this Harness in the Profile's
  // Organization; only catalog sync creates one.
  "no_member_agent",
  // The Profile belongs to the MemberAgent of another Harness.
  "assigned_elsewhere",
  // Not an active ordinary Agent Profile of this owner in an Organization
  // the owner is a member of.
  "not_eligible",
]);
export type AssignAgentProfileMemberAgentOutcome = z.infer<
  typeof assignAgentProfileMemberAgentOutcomeSchema
>;

export const assignAgentProfileMemberAgentRpcResultSchema =
  z.discriminatedUnion("ok", [
    z.strictObject({
      ok: z.literal(true),
      outcome: assignAgentProfileMemberAgentOutcomeSchema,
      memberAgentId: identifierSchema.nullable(),
    }),
    z.strictObject({
      ok: z.literal(false),
      code: reasonCodeSchema,
      message: z.string().min(1),
    }),
  ]);
export type AssignAgentProfileMemberAgentRpcResult = z.infer<
  typeof assignAgentProfileMemberAgentRpcResultSchema
>;

// Core -> Auth RPC: Organizations where the owner already has a MemberAgent.
// A catalog update reconciles only these; it never broadcasts to every
// Organization of the member.
export const listMemberAgentOrganizationIdsRpcResultSchema =
  z.discriminatedUnion("ok", [
    z.strictObject({
      ok: z.literal(true),
      organizationIds: z.array(identifierSchema),
    }),
    z.strictObject({
      ok: z.literal(false),
      code: reasonCodeSchema,
      message: z.string().min(1),
    }),
  ]);
export type ListMemberAgentOrganizationIdsRpcResult = z.infer<
  typeof listMemberAgentOrganizationIdsRpcResultSchema
>;

// `POST MEMBER_AGENT_SYNC_ROUTE` (Core `syncMemberAgents`). Web calls it when
// the member opens the Agents or Direct Message surface of an Organization,
// with an empty body: that finishes and repairs existing Agents but creates
// none. Setup and "add" name the detected Harnesses the member chose in
// `createHarnessKinds`; only those get a new MemberAgent. It is idempotent.
export const syncMemberAgentsRequestSchema = z.strictObject({
  createHarnessKinds: z
    .array(detectedHarnessKindSchema)
    .max(detectedHarnessKindSchema.options.length)
    .default([]),
});
export type SyncMemberAgentsRequest = z.input<
  typeof syncMemberAgentsRequestSchema
>;

// A Harness named in `createHarnessKinds` that no computer of the member
// detects now.
export const MEMBER_AGENT_SYNC_HARNESS_NOT_DETECTED_REASON =
  "member_agent.harness_not_detected";

export const memberAgentSyncOutcomeSchema = z.enum([
  // This call created the MemberAgent and its default Profile.
  "created",
  // The MemberAgent existed; this call finished its Binding.
  "completed",
  // Nothing to do.
  "unchanged",
  // The Harness is present but cannot be set up automatically.
  "skipped",
]);
export type MemberAgentSyncOutcome = z.infer<
  typeof memberAgentSyncOutcomeSchema
>;

export const memberAgentSyncStepStatusSchema = z.enum([
  "not_attempted",
  "succeeded",
  "rejected",
  "failed",
]);

export const memberAgentSyncResultSchema = z.strictObject({
  harnessKind: detectedHarnessKindSchema,
  outcome: memberAgentSyncOutcomeSchema,
  memberAgentId: identifierSchema.nullable(),
  defaultProfileId: identifierSchema.nullable(),
  binding: memberAgentSyncStepStatusSchema,
  directMessage: memberAgentSyncStepStatusSchema,
  directMessageSpaceId: identifierSchema.nullable(),
  reasonCodes: z.array(reasonCodeSchema),
});
export type MemberAgentSyncResult = z.infer<typeof memberAgentSyncResultSchema>;

export const syncMemberAgentsResponseSchema = z.strictObject({
  ok: z.literal(true),
  organizationId: identifierSchema,
  results: z.array(memberAgentSyncResultSchema),
  // Bound Profiles that were unassigned and now belong to the MemberAgent of
  // their Binding's Harness.
  assignedProfileIds: z.array(identifierSchema).default([]),
  // Detected Harnesses with no MemberAgent that the member can add.
  addableHarnessKinds: z.array(detectedHarnessKindSchema).default([]),
});
export type SyncMemberAgentsResponse = z.infer<
  typeof syncMemberAgentsResponseSchema
>;

// `GET MEMBER_AGENT_PRESENCE_ROUTE` (Core `memberAgentPresence`). An owner
// read: it is derived at read time and never stored.
export const memberAgentPresenceStateSchema = z.enum([
  // At least one Profile of the MemberAgent reads Available for Wake.
  "available",
  // The Harness is on an online computer, but no Profile is available yet.
  "checking",
  // Every computer that has the Harness is offline.
  "all_offline",
  // No computer has had the Harness for several consecutive catalog reports
  // or for five minutes (debounced, so a PATH hiccup or upgrade never greys).
  "missing",
]);
export type MemberAgentPresenceState = z.infer<
  typeof memberAgentPresenceStateSchema
>;

export const memberAgentPresenceComputerSchema = z.strictObject({
  openMeldServiceRuntimeId: identifierSchema,
  online: z.boolean(),
});

export const memberAgentPresenceProfileSchema = z.strictObject({
  openMeldProfileId: identifierSchema,
  // The existing four-state Wakeability of this Profile.
  wakeAvailability: agentWakeAvailabilityCategorySchema,
});

export const memberAgentPresenceWorkloadSchema = z.discriminatedUnion(
  "status",
  [
    // Any Profile's workload is unknown: never claim a partial total.
    z.strictObject({ status: z.literal("unavailable") }),
    z.strictObject({
      status: z.literal("ready"),
      runningCount: z.int().nonnegative(),
      queuedCount: z.int().nonnegative(),
    }),
  ]
);

export const memberAgentPresenceSchema = z.strictObject({
  memberAgentId: identifierSchema,
  harnessKind: harnessKindSchema,
  state: memberAgentPresenceStateSchema,
  // Computers that currently have the Harness (owner-only facts).
  computers: z.array(memberAgentPresenceComputerSchema),
  profiles: z.array(memberAgentPresenceProfileSchema),
  workload: memberAgentPresenceWorkloadSchema,
});
export type MemberAgentPresence = z.infer<typeof memberAgentPresenceSchema>;

export const getMemberAgentPresenceResponseSchema = z.strictObject({
  ok: z.literal(true),
  organizationId: identifierSchema,
  generatedAt: z.iso.datetime({ offset: true }),
  memberAgents: z.array(memberAgentPresenceSchema),
});
export type GetMemberAgentPresenceResponse = z.infer<
  typeof getMemberAgentPresenceResponseSchema
>;
