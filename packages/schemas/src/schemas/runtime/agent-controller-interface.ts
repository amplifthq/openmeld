import * as z from "zod/v4";
import { localAgentCatalogLaunchStatusSchema } from "./local-agent-catalog";

export const AGENT_CONTROLLER_MODEL_INVENTORY_LIMIT = 256;

const ACI_BOUNDED_ID_SCHEMA = z.string().trim().min(1).max(256);
const ACI_BOUNDED_LABEL_SCHEMA = z.string().trim().min(1).max(256);
const ACI_BOUNDED_TEXT_SCHEMA = z.string().trim().min(1).max(32_000);
const ACI_COMMAND_PATH_SCHEMA = z.string().trim().min(1).max(4096);
const ACI_ISO_DATE_TIME_SCHEMA = z.iso.datetime({ offset: true });

// Authentication and quota are different observations. Native account checks
// expire after two minutes; quota retains its independent capacity policy.
export const AGENT_CONTROLLER_AUTH_STALE_AFTER_MS = 2 * 60_000;
export const AGENT_CONTROLLER_USAGE_LIMIT_STALE_AFTER_MS = 20 * 60_000;

export const agentControllerUsageLimitStatusSchema = z.enum([
  "available",
  "exhausted",
  "stale",
  "unavailable",
  "unsupported",
]);

export const agentControllerUsageProviderSchema = z.strictObject({
  displayName: ACI_BOUNDED_LABEL_SCHEMA,
  id: ACI_BOUNDED_ID_SCHEMA,
});

export const agentControllerUsageLimitSchema = z
  .strictObject({
    key: ACI_BOUNDED_ID_SCHEMA,
    label: ACI_BOUNDED_LABEL_SCHEMA,
    observedAt: ACI_ISO_DATE_TIME_SCHEMA,
    provider: agentControllerUsageProviderSchema.optional(),
    reason: z
      .enum([
        "not_authenticated",
        "not_applicable",
        "not_reported",
        "refresh_failed",
      ])
      .optional(),
    resetsAt: ACI_ISO_DATE_TIME_SCHEMA.nullable(),
    status: agentControllerUsageLimitStatusSchema,
    usedPercent: z.number().finite().min(0).max(100).nullable(),
  })
  .superRefine((value, context) => {
    if (
      (value.status === "available" || value.status === "exhausted") &&
      value.usedPercent === null
    ) {
      context.addIssue({
        code: "custom",
        message: `${value.status} usage limits require usedPercent`,
        path: ["usedPercent"],
      });
    }
    if (value.status === "stale" && value.usedPercent === null) {
      context.addIssue({
        code: "custom",
        message: "stale usage limits require a last-known usedPercent",
        path: ["usedPercent"],
      });
    }
    if (value.status === "exhausted" && value.usedPercent !== 100) {
      context.addIssue({
        code: "custom",
        message: "exhausted usage limits require usedPercent to equal 100",
        path: ["usedPercent"],
      });
    }
    if (value.status === "available" && value.usedPercent === 100) {
      context.addIssue({
        code: "custom",
        message: "available usage limits require usedPercent below 100",
        path: ["usedPercent"],
      });
    }
    if (
      (value.status === "unavailable" || value.status === "unsupported") &&
      (value.usedPercent !== null ||
        (value.status === "unsupported" && value.resetsAt !== null))
    ) {
      context.addIssue({
        code: "custom",
        message: `${value.status} usage limits require unknown usage; unsupported limits also require unknown reset`,
      });
    }
  });

export const agentControllerUsageLimitsSchema = z
  .array(agentControllerUsageLimitSchema)
  .max(32)
  .superRefine((limits, context) => {
    const keys = new Set<string>();
    for (const [index, limit] of limits.entries()) {
      if (keys.has(limit.key)) {
        context.addIssue({
          code: "custom",
          message: "usage limit keys must be unique within one controller",
          path: [index, "key"],
        });
      }
      keys.add(limit.key);
    }
  });

// One account-level observation from the controller. Window percentages remain
// usage facts; they do not establish whether credits permit another turn.
export const agentControllerUsageAdmissionSchema = z.strictObject({
  blocksNewWork: z.boolean().nullable(),
  observedAt: ACI_ISO_DATE_TIME_SCHEMA,
});

export const agentControllerInterfaceStatusSchema = z.enum([
  "disabled",
  "error",
  "ready",
  "unavailable",
  "unknown",
  "warning",
]);

export const agentControllerInterfaceAuthStatusSchema = z.enum([
  "authenticated",
  "unauthenticated",
  "unknown",
]);

export const agentControllerInterfaceAuthSnapshotSchema = z.strictObject({
  // Owner-only opaque native account subject. Cloud projection omits it.
  accountKey: ACI_BOUNDED_ID_SCHEMA.optional(),
  email: z.string().trim().email().max(320).optional(),
  label: ACI_BOUNDED_LABEL_SCHEMA.optional(),
  status: agentControllerInterfaceAuthStatusSchema,
  type: ACI_BOUNDED_ID_SCHEMA.optional(),
});

export const agentControllerInterfaceCheckStatusSchema = z.enum([
  "failed",
  "not_run",
  "succeeded",
]);

export const agentControllerInterfaceCheckSnapshotSchema = z.discriminatedUnion(
  "status",
  [
    z.strictObject({
      lastSucceededAt: ACI_ISO_DATE_TIME_SCHEMA.nullable(),
      status: z.literal("failed"),
    }),
    z.strictObject({
      lastSucceededAt: z.null(),
      status: z.literal("not_run"),
    }),
    z.strictObject({
      lastSucceededAt: ACI_ISO_DATE_TIME_SCHEMA,
      status: z.literal("succeeded"),
    }),
  ]
);

export const agentControllerInterfaceVersionAdvisoryStatusSchema = z.enum([
  "behind_latest",
  "current",
  "unknown",
]);

export const agentControllerInterfaceVersionAdvisorySchema = z.strictObject({
  checkedAt: ACI_ISO_DATE_TIME_SCHEMA.nullable(),
  currentVersion: ACI_BOUNDED_ID_SCHEMA.nullable(),
  latestVersion: ACI_BOUNDED_ID_SCHEMA.nullable(),
  message: ACI_BOUNDED_TEXT_SCHEMA.nullable(),
  status: agentControllerInterfaceVersionAdvisoryStatusSchema,
  updateCommand: ACI_BOUNDED_TEXT_SCHEMA.nullable(),
});

export const agentControllerInterfaceModelSchema = z.strictObject({
  displayName: ACI_BOUNDED_LABEL_SCHEMA,
  id: ACI_BOUNDED_ID_SCHEMA,
});

export const agentControllerInterfaceSkillSchema = z.strictObject({
  description: ACI_BOUNDED_TEXT_SCHEMA.optional(),
  displayName: ACI_BOUNDED_LABEL_SCHEMA.optional(),
  id: ACI_BOUNDED_ID_SCHEMA,
});

export const agentControllerInterfaceCapabilitiesSchema = z.strictObject({
  approvals: z.boolean(),
  cancel: z.boolean(),
  interrupt: z.boolean(),
  modelSelection: z.boolean(),
  nativeEventStream: z.boolean(),
  permissionModes: z.boolean(),
  structuredUserInput: z.boolean(),
});

export const agentControllerInterfaceLaunchSnapshotSchema = z.strictObject({
  failureReason: z
    .enum(["installation_missing", "installation_access_denied"])
    .optional(),
  argsPrefix: z.array(ACI_BOUNDED_TEXT_SCHEMA).max(64),
  commandPath: ACI_COMMAND_PATH_SCHEMA.nullable(),
  installChoiceCount: z.number().int().nonnegative(),
  status: localAgentCatalogLaunchStatusSchema,
});

export const agentControllerInterfaceNativeInterfaceSchema = z.enum([
  "acp",
  "claude-agent-sdk",
  "claude-cli",
  "codex-app-server",
  "local-cli",
]);

export const agentControllerInterfaceSnapshotSchema = z.strictObject({
  agentControllerRef: ACI_BOUNDED_ID_SCHEMA,
  auth: agentControllerInterfaceAuthSnapshotSchema,
  capabilities: agentControllerInterfaceCapabilitiesSchema,
  check: agentControllerInterfaceCheckSnapshotSchema.optional(),
  checkedAt: ACI_ISO_DATE_TIME_SCHEMA,
  controllerId: ACI_BOUNDED_ID_SCHEMA,
  displayName: ACI_BOUNDED_LABEL_SCHEMA,
  launch: agentControllerInterfaceLaunchSnapshotSchema,
  message: ACI_BOUNDED_TEXT_SCHEMA.nullable(),
  models: z
    .array(agentControllerInterfaceModelSchema)
    .max(AGENT_CONTROLLER_MODEL_INVENTORY_LIMIT),
  nativeInterface: agentControllerInterfaceNativeInterfaceSchema,
  schemaVersion: z.literal(1),
  skills: z.array(agentControllerInterfaceSkillSchema).max(512),
  status: agentControllerInterfaceStatusSchema,
  usageAdmission: agentControllerUsageAdmissionSchema.optional(),
  usageLimits: agentControllerUsageLimitsSchema.optional(),
  usageLimitsSupportMatrixVersion: z.int().positive().optional(),
  version: ACI_BOUNDED_ID_SCHEMA.nullable(),
  versionAdvisory: agentControllerInterfaceVersionAdvisorySchema.optional(),
});
