import * as z from "zod/v4";

export const RUNTIME_EXECUTION_IDENTITY_MODEL_VERSION =
  "openmeld.runtime.execution_identity.v1" as const;

const boundedIdentifierSchema = z.string().trim().min(1).max(512);

export const runtimeExecutionAuthorityOpenMeldServiceRuntimeIdSchema =
  z.strictObject({
    source: z.literal("runtime_registry_authority"),
    value: boundedIdentifierSchema,
  });

export const runtimeExecutionIdentityCoreSchema = z.strictObject({
  modelVersion: z.literal(RUNTIME_EXECUTION_IDENTITY_MODEL_VERSION),
  spaceId: boundedIdentifierSchema,
  dispatchId: boundedIdentifierSchema,
  targetProfileId: boundedIdentifierSchema,
  openMeldServiceRuntimeId:
    runtimeExecutionAuthorityOpenMeldServiceRuntimeIdSchema,
  bindingId: boundedIdentifierSchema,
  agentControllerRef: boundedIdentifierSchema,
});

export const runtimeTransportDeliveryExecutionIdentitySchema = z.strictObject({
  authority: z.literal("core_runtime_registry_binding_route"),
  core: runtimeExecutionIdentityCoreSchema,
});

export const runtimeTransportRuntimeEvidenceIdentityEchoSchema = z.strictObject(
  {
    echoSource: z.literal("daemon_delivery_context"),
    core: runtimeExecutionIdentityCoreSchema,
  }
);

export const runtimeTransportResultIdentityEchoSchema = z.strictObject({
  echoSource: z.literal("daemon_delivery_context"),
  core: runtimeExecutionIdentityCoreSchema,
});

export const spaceTraceExecutionIdentityProjectionSchema = z.strictObject({
  factSource: z.enum([
    "runtime_coordinator_projection",
    "dispatch_attempt_execution_identity",
    // Legacy parse-only source for dispatch traces created before RuntimeCoordinator.
    "dispatch_claim_lease_legacy",
  ]),
  authority: z.enum(["authoritative", "legacy_projection"]),
  core: runtimeExecutionIdentityCoreSchema,
});
