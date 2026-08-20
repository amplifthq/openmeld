import { z } from "zod/v4";
import { localAgentCatalogLaunchStatusSchema } from "./local-agent-catalog";

const ACI_BOUNDED_ID_SCHEMA = z.string().trim().min(1).max(256);
const ACI_BOUNDED_LABEL_SCHEMA = z.string().trim().min(1).max(256);
const ACI_BOUNDED_TEXT_SCHEMA = z.string().trim().min(1).max(32_000);
const ACI_COMMAND_PATH_SCHEMA = z.string().trim().min(1).max(4096);
const ACI_ISO_DATE_TIME_SCHEMA = z.iso.datetime({ offset: true });

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
  models: z.array(agentControllerInterfaceModelSchema).max(256),
  nativeInterface: agentControllerInterfaceNativeInterfaceSchema,
  schemaVersion: z.literal(1),
  skills: z.array(agentControllerInterfaceSkillSchema).max(512),
  status: agentControllerInterfaceStatusSchema,
  version: ACI_BOUNDED_ID_SCHEMA.nullable(),
  versionAdvisory: agentControllerInterfaceVersionAdvisorySchema.optional(),
});
