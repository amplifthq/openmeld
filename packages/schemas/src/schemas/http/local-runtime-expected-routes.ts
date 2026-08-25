import * as z from "zod/v4";
import {
  agentProfileBindingAgentControllerCollaborationModeSchema,
  agentProfileBindingAgentControllerPermissionModeSchema,
  agentProfileBindingModelSelectionSchema,
  agentProfileBindingOpenCodePermissionSchema,
} from "./agent-profile-binding";

// Contract: developing/architecture/agent-transport-contract.md ("Expected Routes Projection")
// Owner + current runtime/device scoped expected-routes projection. One read
// replaces the per-profile primary-binding fan-out for local route catalogs.

const boundedIdentifierSchema = z.string().trim().min(1).max(256);
const runtimeIdentifierSchema = z.string().trim().min(1).max(512);
const reasonCodeSchema = z.string().trim().min(1).max(256);
const ISO_DATE_TIME_SCHEMA = z.iso.datetime({ offset: true });

export const getLocalRuntimeExpectedRoutesQuerySchema = z.strictObject({
  contractVersion: z.enum(["v2", "v3"]).optional(),
  deviceId: boundedIdentifierSchema,
  lane: boundedIdentifierSchema,
});

export const localRuntimeExpectedRouteSchema = z.strictObject({
  agentProfileId: boundedIdentifierSchema,
  bindingId: boundedIdentifierSchema,
  bindingState: z.literal("enabled_primary"),
  configurationRevision: z.number().int().positive().optional(),
  executionTarget: z.strictObject({
    agentControllerConversationId: z.string().trim().min(1).max(512).nullable(),
    agentControllerRef: boundedIdentifierSchema,
    openMeldServiceRuntimeId: runtimeIdentifierSchema,
  }),
  modelSelection: agentProfileBindingModelSelectionSchema.optional(),
  agentControllerPermissionMode:
    agentProfileBindingAgentControllerPermissionModeSchema.optional(),
  agentControllerCollaborationMode:
    agentProfileBindingAgentControllerCollaborationModeSchema.optional(),
  openCodePermission: agentProfileBindingOpenCodePermissionSchema.optional(),
  profileName: z.string().trim().min(1).max(256).nullable(),
  reasonCodes: z.array(reasonCodeSchema),
  routable: z.boolean(),
});

// Diagnostic-only: explains why a bound profile is absent from
// expectedRoutes. Only meaningful when runtimeResolution === "resolved";
// device-level conditions (missing/conflict) are expressed at the top level
// and never expanded per profile.
export const localRuntimeExpectedRouteExclusionSchema = z.strictObject({
  agentProfileId: boundedIdentifierSchema,
  reasonCode: z.enum([
    "profile.inactive",
    "binding.other_runtime",
    "binding.not_routable",
  ]),
});

export const getLocalRuntimeExpectedRoutesResponseSchema = z.strictObject({
  openMeldServiceRuntimeId: runtimeIdentifierSchema.nullable(),
  excludedProfiles: z.array(localRuntimeExpectedRouteExclusionSchema).max(400),
  expectedRoutes: z.array(localRuntimeExpectedRouteSchema).max(200),
  generatedAt: ISO_DATE_TIME_SCHEMA,
  runtimeResolution: z.enum(["resolved", "missing", "conflict"]),
});
