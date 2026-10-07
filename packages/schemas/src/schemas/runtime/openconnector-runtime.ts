import * as z from "zod/v4";

const nonEmptyStringSchema = z.string().trim().min(1);
const jsonSchemaObjectSchema = z.record(z.string(), z.unknown());

export const pluginConnectionHealthSchema = z.strictObject({
  state: z.enum(["unknown", "ready", "refresh_required", "reconnect_required"]),
  observedAt: z.string().datetime(),
  expiresAt: z.string().nullable(),
  reason: z.string().nullable(),
});

export const pluginNativeHttpSchema = z.strictObject({
  baseUrl: z.string().url(),
  documentationUrl: z.string().url(),
  auth: z.record(z.string(), z.unknown()),
  headers: z.record(z.string(), z.string()).optional(),
  cli: z
    .strictObject({
      command: nonEmptyStringSchema,
      baseUrlEnvironment: nonEmptyStringSchema,
      tokenEnvironment: nonEmptyStringSchema,
      accountEnvironment: nonEmptyStringSchema.optional(),
    })
    .optional(),
  read: z.array(
    z.strictObject({
      method: z.enum(["GET", "POST"]),
      path: nonEmptyStringSchema,
      requiredPermissions: z.array(nonEmptyStringSchema).optional(),
      bodySchema: jsonSchemaObjectSchema.optional(),
      timeWindow: z
        .strictObject({
          from: nonEmptyStringSchema,
          to: nonEmptyStringSchema,
          maxMilliseconds: z.number().positive(),
        })
        .optional(),
    })
  ),
});

export const pluginConnectionDescriptionSchema = z.strictObject({
  service: nonEmptyStringSchema,
  connection: z
    .object({
      connectionName: nonEmptyStringSchema,
      health: pluginConnectionHealthSchema,
      profile: z.object({ accountId: z.string(), displayName: z.string() }),
    })
    .optional(),
  nativeHttp: pluginNativeHttpSchema.nullable(),
});

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
  operationType: openConnectorRuntimeActionEffectSchema.optional(),
  outputSchema: jsonSchemaObjectSchema,
  providerPermissions: z.array(nonEmptyStringSchema),
  requiredScopes: z.array(nonEmptyStringSchema),
  service: nonEmptyStringSchema,
});

export const openConnectorRuntimeActionListSchema = z.array(
  openConnectorRuntimeActionSchema
);

export const openConnectorRuntimeActionSearchResultSchema = z.strictObject({
  authenticated: z.boolean(),
  description: nonEmptyStringSchema,
  effect: openConnectorRuntimeActionEffectSchema.optional(),
  id: nonEmptyStringSchema,
  inputSchema: jsonSchemaObjectSchema,
  name: nonEmptyStringSchema,
  operationType: openConnectorRuntimeActionEffectSchema.optional(),
  outputSchema: jsonSchemaObjectSchema,
  service: nonEmptyStringSchema,
});

export const openConnectorRuntimeActionSearchResultListSchema = z.array(
  openConnectorRuntimeActionSearchResultSchema
);

export const openConnectorRuntimeActionOperationMetaSchema = z.strictObject({
  actionId: nonEmptyStringSchema,
  auditPersisted: z.boolean(),
  executionId: nonEmptyStringSchema,
});

export const openConnectorRuntimeActionSuccessEnvelopeSchema = z.strictObject({
  data: z.json(),
  message: z.literal("OK"),
  meta: openConnectorRuntimeActionOperationMetaSchema,
  outputSchema: jsonSchemaObjectSchema.optional(),
  success: z.literal(true),
});
