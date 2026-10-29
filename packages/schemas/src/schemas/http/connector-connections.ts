import * as z from "../../lazy-zod";
import { pluginConnectionHealthSchema } from "../runtime/openconnector-runtime";

export const CENTER_AGENT_APP_CONNECTOR_SERVICES = [
  "feishu",
  "lark",
  "gmail",
  "googlecalendar",
  "googledrive",
  "notion",
  "linear",
  "figma",
  "posthog",
  "cloudflare_browser_rendering",
  "cloudflare_dns",
  "cloudflare_r2",
  "cloudflare_worker",
] as const;
export const CONNECTOR_SERVICES = [
  "github",
  ...CENTER_AGENT_APP_CONNECTOR_SERVICES,
] as const;
export const CONNECTOR_CONNECTION_STATUSES = [
  "pending",
  "active",
  "disconnected",
] as const;
export const CONNECTOR_CONNECTION_SCOPES = ["member", "shared"] as const;
/** Account-wide mail, calendar and meeting access remains member-private.
 * Other catalog providers support both ownership scopes; Agent permissions
 * still apply to every connection. No provider currently requires shared-only.
 */
export const CONNECTOR_PERSONAL_ONLY_SERVICES: readonly string[] = [
  "gmail",
  "outlook",
  "outlook_calendar",
  "googlecalendar",
  "googlemeet",
  "zoom",
];

export function connectorConnectionScopeAllowed(
  service: string,
  scope: (typeof CONNECTOR_CONNECTION_SCOPES)[number]
): boolean {
  return (
    scope === "member" || !CONNECTOR_PERSONAL_ONLY_SERVICES.includes(service)
  );
}
export const CONNECTOR_CONNECTION_PREFERENCES = [
  "automatic",
  "requester",
  "shared",
] as const;
export const CONNECTOR_APP_REQUEST_SOURCES = [
  "openconnector_catalog",
  "freeform",
] as const;
export const CONNECTOR_APP_REQUEST_STATUSES = [
  "requested",
  "available",
  "declined",
] as const;

type ConnectorAppRequestIdentityInput = {
  providerId?: string | null;
  providerName: string;
  source: (typeof CONNECTOR_APP_REQUEST_SOURCES)[number];
};

export function buildConnectorAppRequestProviderKey(
  input: ConnectorAppRequestIdentityInput
): string {
  const providerId = input.providerId?.trim().toLowerCase();
  if (input.source === "openconnector_catalog" && providerId) {
    return `catalog:${providerId}`;
  }
  return `freeform:${input.providerName
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/gu, " ")}`;
}

const trimmedNonEmptyStringSchema = z.string().trim().min(1);
const timestampMsSchema = z.number().int().nonnegative();
const connectorCredentialValueSchema = z.string().min(1).max(8192);
const connectorAppRequestOptionalTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(2000)
  .nullable();
const connectorAppRequestedCapabilitiesSchema = z
  .array(z.string().trim().min(1).max(80))
  .max(12);

/** Provider identity comes from OpenConnector, not a product-maintained list. */
export const connectorServiceSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_-]{0,99}$/u);
export const connectorServicesResponseSchema = z.object({
  services: z.array(connectorServiceSchema),
});
export const connectorConnectionStatusSchema = z.enum(
  CONNECTOR_CONNECTION_STATUSES
);
export const connectorConnectionScopeSchema = z.enum(
  CONNECTOR_CONNECTION_SCOPES
);
export const connectorConnectionPreferenceSchema = z.enum(
  CONNECTOR_CONNECTION_PREFERENCES
);
export const connectorAppRequestSourceSchema = z.enum(
  CONNECTOR_APP_REQUEST_SOURCES
);
export const connectorAppRequestStatusSchema = z.enum(
  CONNECTOR_APP_REQUEST_STATUSES
);
export const connectorConnectionNameSchema = z
  .string()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/u);
export const githubAppInstallationStateSchema = z
  .string()
  .regex(/^githubapp_[0-9a-f]{64}$/u);
export const githubAppInstallationIdSchema = z.string().regex(/^[1-9][0-9]*$/u);

export const connectorConnectionSchema = z.strictObject({
  health: pluginConnectionHealthSchema.optional(),
  canDisconnect: z.boolean(),
  connectionName: connectorConnectionNameSchema,
  createdAtMs: timestampMsSchema,
  disconnectedAtMs: timestampMsSchema.nullable(),
  organizationId: trimmedNonEmptyStringSchema,
  ownerDisplayName: trimmedNonEmptyStringSchema,
  scope: connectorConnectionScopeSchema.default("member"),
  service: connectorServiceSchema,
  status: connectorConnectionStatusSchema,
  updatedAtMs: timestampMsSchema,
  userId: trimmedNonEmptyStringSchema,
});

export const connectorConnectionListResponseSchema = z.strictObject({
  connections: z.array(connectorConnectionSchema),
  currentUserId: trimmedNonEmptyStringSchema,
  organizationId: trimmedNonEmptyStringSchema,
});

export const connectorAppRequestSchema = z.strictObject({
  availableAtMs: timestampMsSchema.nullable(),
  createdAtMs: timestampMsSchema,
  id: z.string().trim().min(1).max(128),
  notifiedAtMs: timestampMsSchema.nullable(),
  organizationId: trimmedNonEmptyStringSchema,
  providerId: z.string().trim().min(1).max(160).nullable(),
  providerName: z.string().trim().min(1).max(120),
  requestedCapabilities: connectorAppRequestedCapabilitiesSchema,
  requesterMemberId: trimmedNonEmptyStringSchema.nullable(),
  requesterUserId: trimmedNonEmptyStringSchema.nullable(),
  source: connectorAppRequestSourceSchema,
  status: connectorAppRequestStatusSchema,
  updatedAtMs: timestampMsSchema,
  useCase: connectorAppRequestOptionalTextSchema,
});

export const createConnectorAppRequestBodySchema = z
  .strictObject({
    providerId: z.string().trim().min(1).max(160).nullable().optional(),
    providerName: z.string().trim().min(1).max(120),
    requestedCapabilities: connectorAppRequestedCapabilitiesSchema.optional(),
    source: connectorAppRequestSourceSchema,
    useCase: connectorAppRequestOptionalTextSchema.optional(),
  })
  .superRefine((input, context) => {
    if (input.source === "openconnector_catalog" && !input.providerId?.trim()) {
      context.addIssue({
        code: "custom",
        message:
          "A catalog Plugin request requires its OpenConnector provider ID.",
        path: ["providerId"],
      });
    }
    if (input.source === "freeform" && input.providerId != null) {
      context.addIssue({
        code: "custom",
        message: "A freeform Plugin request cannot include a provider ID.",
        path: ["providerId"],
      });
    }
  });

export const connectorAppRequestResponseSchema = z.strictObject({
  request: connectorAppRequestSchema,
});

export const connectorAppRequestListResponseSchema = z.strictObject({
  currentUserId: trimmedNonEmptyStringSchema,
  organizationId: trimmedNonEmptyStringSchema,
  requests: z.array(connectorAppRequestSchema).max(500),
});

export const connectorAppCatalogProviderSchema = z.strictObject({
  connectionAuth: z
    .object({
      oauth: z.boolean(),
      credentials: z.array(
        z.object({
          authType: z.enum(["api_key", "custom_credential"]),
          fields: z.array(
            z.object({
              key: z.string(),
              label: z.string(),
              description: z.string(),
              placeholder: z.string().optional(),
              secret: z.boolean(),
              inputType: z
                .enum(["text", "password", "textarea", "json"])
                .optional(),
              required: z.boolean(),
            })
          ),
        })
      ),
    })
    .optional(),
  authTypes: z.array(z.string().trim().min(1).max(80)).max(12),
  categories: z
    .array(
      z.strictObject({
        displayName: z.string().trim().min(1).max(120),
        id: z.string().trim().min(1).max(120),
      })
    )
    .max(12),
  displayName: z.string().trim().min(1).max(120),
  homepageUrl: z.url().nullable(),
  iconUrl: z.url().nullable(),
  service: z.string().trim().min(1).max(160),
});

export const connectorAppCatalogResponseSchema = z.strictObject({
  organizationId: trimmedNonEmptyStringSchema,
  providers: z.array(connectorAppCatalogProviderSchema).max(5000),
});

export const connectorAuthorizationStartResponseSchema = z.strictObject({
  authorizationUrl: z.url(),
  connection: connectorConnectionSchema,
  expiresAtMs: timestampMsSchema.optional(),
});

export const githubAppInstallationStartResponseSchema = z.strictObject({
  connection: connectorConnectionSchema,
  expiresAtMs: timestampMsSchema,
  state: githubAppInstallationStateSchema,
  verificationConnectionName: connectorConnectionNameSchema,
});

export const githubAppInstallationSetupQuerySchema = z.strictObject({
  installation_id: githubAppInstallationIdSchema,
  setup_action: z.string().trim().min(1).max(64).optional(),
  state: githubAppInstallationStateSchema,
});

export const githubAppInstallationVerificationResponseSchema =
  z.discriminatedUnion("status", [
    z.strictObject({
      actorProfileId: trimmedNonEmptyStringSchema,
      installationId: githubAppInstallationIdSchema,
      organizationId: trimmedNonEmptyStringSchema,
      status: z.literal("valid"),
      targetConnectionName: connectorConnectionNameSchema,
      userId: trimmedNonEmptyStringSchema,
      verificationConnectionName: connectorConnectionNameSchema,
    }),
    z.strictObject({ status: z.literal("expired") }),
    z.strictObject({ status: z.literal("invalid") }),
  ]);

export const pendingGitHubAppInstallationSchema = z
  .strictObject({
    installationId: githubAppInstallationIdSchema.nullable(),
    organizationId: trimmedNonEmptyStringSchema,
    status: z.enum(["installing", "verifying"]),
    targetConnectionName: connectorConnectionNameSchema,
    userId: trimmedNonEmptyStringSchema,
    verificationConnectionName: connectorConnectionNameSchema,
  })
  .nullable();

export const connectorCredentialAuthTypeSchema = z.enum([
  "api_key",
  "custom_credential",
]);

export const connectorCredentialConnectBodySchema = z
  .strictObject({
    authType: connectorCredentialAuthTypeSchema,
    values: z
      .record(
        z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/u),
        connectorCredentialValueSchema
      )
      .refine((values) => Object.keys(values).length <= 16, {
        message: "Too many credential values.",
      }),
  })
  .refine(
    ({ authType, values }) =>
      authType === "custom_credential" || Object.keys(values).length > 0,
    {
      message: "At least one API key value is required.",
      path: ["values"],
    }
  );

export const connectorCredentialConnectResponseSchema = z.strictObject({
  connection: connectorConnectionSchema,
});

export const connectorOrganizationContextQuerySchema = z.strictObject({
  includeMessageContext: z.enum(["true", "false"]).optional(),
  includeIssuePreview: z.enum(["true", "false"]).optional(),
  includeConnectionHealth: z.literal("true").optional(),
  expectedOrganizationId: trimmedNonEmptyStringSchema,
  includeAuthorizationExpiry: z.literal("true").optional(),
});

export const connectorDisconnectBodySchema = z.strictObject({
  userId: trimmedNonEmptyStringSchema,
});

export const connectorDisconnectResponseSchema = z.strictObject({
  connection: connectorConnectionSchema,
});

export const connectorConnectionReconcileInputSchema = z.strictObject({
  availableConnectionNames: z.array(connectorConnectionNameSchema).max(500),
  service: connectorServiceSchema,
});

export const centerAgentConnectorConnectionSelectionSchema = z.strictObject({
  permission: z.enum(["read", "write"]).optional(),
  connection: connectorConnectionSchema.nullable(),
  selection: z.enum(["requester", "shared"]).nullable(),
});

export const centerAgentResolveConnectorConnectionBodySchema = z.strictObject({
  connectionPreference: connectorConnectionPreferenceSchema.optional(),
  includeAccessPolicy: z.literal(true).optional(),
  includeDelegatedRequester: z.literal(true).optional(),
  requesterUserId: z.string().nullable(),
  service: connectorServiceSchema,
});
