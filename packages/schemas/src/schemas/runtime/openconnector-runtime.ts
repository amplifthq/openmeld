import { z } from "zod/v4";

const nonEmptyStringSchema = z.string().trim().min(1);
const jsonSchemaObjectSchema = z.record(z.string(), z.unknown());

export const OPENCONNECTOR_RUNTIME_ACTION_CONTRACT_VERSION = 1 as const;

export const openConnectorRuntimeActionEffectSchema = z.enum([
  "destructive",
  "read",
  "write",
]);

export const openConnectorRuntimeActionExecutionSchema = z
  .strictObject({
    catalogOnly: z.boolean(),
    locallyExecutable: z.boolean(),
    needsCredential: z.boolean(),
    noAuthRunnable: z.boolean(),
    requiredAuthTypes: z.array(
      z.enum(["no_auth", "api_key", "custom_credential", "oauth2"])
    ),
  })
  .superRefine((execution, context) => {
    if (execution.catalogOnly === execution.locallyExecutable) {
      context.addIssue({
        code: "custom",
        message:
          "OpenConnector action execution must be either locally executable or catalog-only.",
        path: ["locallyExecutable"],
      });
    }
    if (execution.needsCredential === execution.noAuthRunnable) {
      context.addIssue({
        code: "custom",
        message:
          "OpenConnector action credential requirements are inconsistent.",
        path: ["needsCredential"],
      });
    }
  });

export const openConnectorRuntimeActionSchema = z.strictObject({
  asyncLifecycle: z
    .strictObject({
      cancelActionId: nonEmptyStringSchema.optional(),
      startActionId: nonEmptyStringSchema,
      statusActionId: nonEmptyStringSchema,
    })
    .nullable(),
  description: nonEmptyStringSchema,
  effect: openConnectorRuntimeActionEffectSchema.optional(),
  execution: openConnectorRuntimeActionExecutionSchema,
  followUpActions: z.array(
    z.strictObject({
      actionId: nonEmptyStringSchema,
    })
  ),
  id: nonEmptyStringSchema,
  inputSchema: jsonSchemaObjectSchema,
  name: nonEmptyStringSchema,
  outputSchema: jsonSchemaObjectSchema,
  providerPermissions: z.array(nonEmptyStringSchema),
  requiredScopes: z.array(nonEmptyStringSchema),
  service: nonEmptyStringSchema,
});

export const openConnectorRuntimeActionListSchema = z.array(
  openConnectorRuntimeActionSchema
);

export const openConnectorRuntimeActionOperationMetaSchema = z.strictObject({
  actionId: nonEmptyStringSchema,
  auditPersisted: z.boolean(),
  executionId: nonEmptyStringSchema,
});
