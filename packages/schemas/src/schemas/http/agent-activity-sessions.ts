import { z } from "zod/v4";
import { agentControllerRefSchema } from "../daemon/agent-controller-ref";
import { openMeldRequestContextSchema } from "../daemon/profile-identity";
import { centerAgentToolSpeakerSchema } from "./center-agent-speaker";
import { projectSlugSchema, repositoryFingerprintSchema } from "./projects";

export const AGENT_ACTIVITY_SESSION_INVENTORY_PAGE_DEFAULT = 50;
export const AGENT_ACTIVITY_SESSION_INVENTORY_PAGE_MAX = 100;
export const AGENT_ACTIVITY_SESSION_RECONCILIATION_PAGE_MAX = 100;
export const AGENT_ACTIVITY_SESSION_RECONCILIATION_MAX_BYTES = 256 * 1024;
export const AGENT_ACTIVITY_SESSION_TITLE_MAX_CHARS = 240;
export const LOCAL_AGENT_SESSION_PROVIDERS = [
  "codex",
  "claude-code",
  "cursor",
  "opencode",
  "grok-build",
] as const;

const LOCAL_AGENT_CONTROLLER_REF_BY_PROVIDER = {
  "claude-code": "builtin:claude-code",
  codex: "builtin:codex",
  cursor: "builtin:cursor",
  "grok-build": "builtin:grok-build",
  opencode: "builtin:opencode",
} as const satisfies Record<
  (typeof LOCAL_AGENT_SESSION_PROVIDERS)[number],
  `builtin:${string}`
>;

const boundedIdentifierSchema = z.string().trim().min(1).max(512);
const displayNameSchema = z.string().trim().min(1).max(256);
const timestampMsSchema = z.number().int().nonnegative();

export const agentActivityNativeSessionIdSchema = boundedIdentifierSchema;

export const localAgentSessionProviderSchema = z.enum(
  LOCAL_AGENT_SESSION_PROVIDERS
);

export const agentActivityInventorySessionStatusSchema = z.enum([
  "working",
  "idle",
  "ended",
  "error",
  "unknown",
]);

export const agentActivityInventorySessionOriginSchema = z.enum([
  "openmeld",
  "local",
  "unknown",
]);

export const agentActivityInventoryComputerStateSchema = z.enum([
  "online",
  "offline",
  "unknown",
]);

export const agentActivityInventoryDataStateSchema = z.enum([
  "current",
  "stale",
]);

export const agentActivityInventoryBindingStateSchema = z.enum([
  "bound",
  "unbound",
  "conflict",
]);

export const agentActivityInventoryCoverageStateSchema = z.enum([
  "waiting",
  "syncing",
  "current",
  "stale",
  "unsupported",
  "error",
  "disconnected",
]);

export const agentActivityInventoryOrganizationSchema = z.strictObject({
  id: boundedIdentifierSchema,
  name: displayNameSchema,
});

export const agentActivityInventoryOwnerSchema = z.strictObject({
  name: displayNameSchema,
  userId: boundedIdentifierSchema,
});

export const agentActivityInventoryProjectSchema = z.strictObject({
  id: boundedIdentifierSchema,
  name: displayNameSchema,
  slug: projectSlugSchema,
});

export const agentActivityInventoryComputerSchema = z.strictObject({
  id: boundedIdentifierSchema,
  lastSeenAtMs: timestampMsSchema.nullable(),
  name: displayNameSchema,
  state: agentActivityInventoryComputerStateSchema,
});

export const agentActivityInventoryLocalAgentSchema = z
  .strictObject({
    agentControllerRef: agentControllerRefSchema,
    name: displayNameSchema,
    provider: localAgentSessionProviderSchema,
  })
  .superRefine(refineLocalAgentProviderControllerPair);

export const agentActivityInventorySessionSchema = z
  .strictObject({
    boundAgentProfileId: boundedIdentifierSchema.nullable(),
    bindingState: agentActivityInventoryBindingStateSchema,
    canFork: z.boolean(),
    canResume: z.boolean(),
    computer: agentActivityInventoryComputerSchema,
    dataState: agentActivityInventoryDataStateSchema,
    inventoryUpdatedAtMs: timestampMsSchema,
    lastActiveAtMs: timestampMsSchema,
    localAgent: agentActivityInventoryLocalAgentSchema,
    nativeSessionId: agentActivityNativeSessionIdSchema,
    nativeSessionTitle: z
      .string()
      .trim()
      .min(1)
      .max(AGENT_ACTIVITY_SESSION_TITLE_MAX_CHARS)
      .nullable(),
    organization: agentActivityInventoryOrganizationSchema,
    origin: agentActivityInventorySessionOriginSchema,
    owner: agentActivityInventoryOwnerSchema,
    project: agentActivityInventoryProjectSchema,
    startedAtMs: timestampMsSchema.nullable(),
    status: agentActivityInventorySessionStatusSchema,
  })
  .superRefine((value, context) => {
    if (
      (value.bindingState === "bound") !==
      (value.boundAgentProfileId !== null)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "A bound Session requires exactly one authoritative Agent Profile.",
        path: ["boundAgentProfileId"],
      });
    }
    if (
      value.startedAtMs !== null &&
      value.startedAtMs > value.lastActiveAtMs
    ) {
      context.addIssue({
        code: "custom",
        message: "Session start time cannot follow its last activity.",
        path: ["startedAtMs"],
      });
    }
  });

export const agentActivityInventoryCoverageSchema = z
  .strictObject({
    agentControllerRef: agentControllerRefSchema,
    computerId: boundedIdentifierSchema,
    lastAttemptAtMs: timestampMsSchema.nullable(),
    lastCompleteAtMs: timestampMsSchema.nullable(),
    problemCode: z.string().trim().min(1).max(128).nullable(),
    projectId: boundedIdentifierSchema,
    provider: localAgentSessionProviderSchema,
    state: agentActivityInventoryCoverageStateSchema,
  })
  .superRefine(refineLocalAgentProviderControllerPair);

export const agentActivitySessionInventoryQuerySchema = z.strictObject({
  cursor: z.string().trim().min(1).max(2048).optional(),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(AGENT_ACTIVITY_SESSION_INVENTORY_PAGE_MAX)
    .default(AGENT_ACTIVITY_SESSION_INVENTORY_PAGE_DEFAULT),
  memberUserId: boundedIdentifierSchema.optional(),
  nativeSessionId: agentActivityNativeSessionIdSchema.optional(),
  origin: agentActivityInventorySessionOriginSchema.optional(),
  projectId: boundedIdentifierSchema.optional(),
  provider: localAgentSessionProviderSchema.optional(),
  query: z.string().trim().min(1).max(256).optional(),
  status: agentActivityInventorySessionStatusSchema.optional(),
});

export const agentActivitySessionInventoryResponseSchema = z.strictObject({
  asOfMs: timestampMsSchema,
  coverage: z.array(agentActivityInventoryCoverageSchema).max(2500),
  nextCursor: z.string().trim().min(1).max(2048).nullable(),
  organization: agentActivityInventoryOrganizationSchema,
  sessions: z
    .array(agentActivityInventorySessionSchema)
    .max(AGENT_ACTIVITY_SESSION_INVENTORY_PAGE_MAX),
});

export const agentActivitySessionInventoryRpcInputSchema = z.strictObject({
  context: openMeldRequestContextSchema.optional(),
  ...agentActivitySessionInventoryQuerySchema.shape,
});

export const centerAgentListAgentActivitySessionsToolRpcInputSchema =
  z.strictObject({
    context: openMeldRequestContextSchema,
    ...agentActivitySessionInventoryQuerySchema.shape,
    speakerMember: centerAgentToolSpeakerSchema,
  });

export const observedLocalAgentSessionSchema = z
  .strictObject({
    canFork: z.boolean(),
    canResume: z.boolean(),
    lastActiveAtMs: timestampMsSchema,
    nativeSessionId: agentActivityNativeSessionIdSchema,
    nativeSessionTitle: z
      .string()
      .trim()
      .min(1)
      .max(AGENT_ACTIVITY_SESSION_TITLE_MAX_CHARS)
      .nullable(),
    origin: agentActivityInventorySessionOriginSchema,
    startedAtMs: timestampMsSchema.nullable(),
    status: agentActivityInventorySessionStatusSchema,
  })
  .superRefine((value, context) => {
    if (
      value.startedAtMs !== null &&
      value.startedAtMs > value.lastActiveAtMs
    ) {
      context.addIssue({
        code: "custom",
        message: "Session start time cannot follow its last activity.",
        path: ["startedAtMs"],
      });
    }
  });

export const agentActivitySessionReconciliationResultSchema = z.enum([
  "sessions",
  "unsupported",
  "error",
  "disconnected",
]);

export const submitAgentActivitySessionReconciliationBodySchema = z
  .strictObject({
    agentControllerRef: agentControllerRefSchema,
    lane: boundedIdentifierSchema,
    localConnectionId: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    observedAtMs: timestampMsSchema,
    openMeldServiceRuntimeId: z.strictObject({
      source: z.literal("runtime_registry_authority"),
      value: boundedIdentifierSchema,
    }),
    pageIndex: z.number().int().nonnegative(),
    organizationId: boundedIdentifierSchema,
    projectId: boundedIdentifierSchema,
    provider: localAgentSessionProviderSchema,
    reconciliationId: boundedIdentifierSchema,
    repositoryFingerprint: repositoryFingerprintSchema.nullable(),
    result: agentActivitySessionReconciliationResultSchema,
    sessions: z
      .array(observedLocalAgentSessionSchema)
      .max(AGENT_ACTIVITY_SESSION_RECONCILIATION_PAGE_MAX),
    terminal: z.boolean(),
    problemCode: z.string().trim().min(1).max(128).optional(),
  })
  .superRefine((value, context) => {
    refineLocalAgentProviderControllerPair(value, context);
    const nativeSessionIds = new Set<string>();
    for (const [index, session] of value.sessions.entries()) {
      if (nativeSessionIds.has(session.nativeSessionId)) {
        context.addIssue({
          code: "custom",
          message:
            "A reconciliation page cannot contain the same native Session ID twice.",
          path: ["sessions", index, "nativeSessionId"],
        });
      }
      nativeSessionIds.add(session.nativeSessionId);
    }
    if (value.result === "sessions") {
      if (value.problemCode !== undefined) {
        context.addIssue({
          code: "custom",
          message: "Successful reconciliation pages cannot include a problem.",
          path: ["problemCode"],
        });
      }
      return;
    }
    if (value.sessions.length > 0 || !value.terminal || value.pageIndex !== 0) {
      context.addIssue({
        code: "custom",
        message:
          "Non-session reconciliation outcomes must be one empty terminal page.",
        path: ["sessions"],
      });
    }
    if (
      (value.result === "unsupported" || value.result === "error") !==
      (value.problemCode !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Unsupported and error outcomes require exactly one stable problem code.",
        path: ["problemCode"],
      });
    }
  });

function refineLocalAgentProviderControllerPair(
  value: {
    agentControllerRef: string;
    provider: (typeof LOCAL_AGENT_SESSION_PROVIDERS)[number];
  },
  context: z.RefinementCtx
): void {
  if (
    value.agentControllerRef !==
    LOCAL_AGENT_CONTROLLER_REF_BY_PROVIDER[value.provider]
  ) {
    context.addIssue({
      code: "custom",
      message:
        "Local Agent provider and Agent Controller reference must identify the same provider.",
      path: ["agentControllerRef"],
    });
  }
}

export const submitAgentActivitySessionReconciliationResponseSchema =
  z.strictObject({
    acceptedPageIndex: z.number().int().nonnegative(),
    publishedSessionCount: z.number().int().nonnegative().nullable(),
    reconciliationId: boundedIdentifierSchema,
    status: z.enum(["accepted", "published", "reused"]),
  });

export const submitAgentActivitySessionReconciliationRpcInputSchema =
  submitAgentActivitySessionReconciliationBodySchema.safeExtend({
    context: openMeldRequestContextSchema.optional(),
    deviceId: boundedIdentifierSchema,
  });
