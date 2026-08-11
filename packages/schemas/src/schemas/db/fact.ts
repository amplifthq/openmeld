import { z } from "zod/v4";

const trimmedNonEmptyStringSchema = z.string().trim().min(1);
const nullableTrimmedStringSchema = z.union([
  trimmedNonEmptyStringSchema,
  z.null(),
]);

export const DB_FACT_SCHEMA_VERSION = 3 as const;

export const dbFactModeSchema = z.enum(["runtime", "tooling"]);
export const dbFactPhaseSchema = z.enum([
  "refactor_no_physical_change",
  "migration_phase",
]);
export const dbFactResultSchema = z.enum([
  "no_diff",
  "diff_detected",
  "blocked",
  "applied",
]);
export const dbInspectionCheckStatusSchema = z.enum([
  "ok",
  "drift_detected",
  "blocked",
]);
export const dbInspectionModeSchema = z.enum(["dev", "prod"]);
export const dbInspectionResultSchema = z.enum([
  "ready",
  "drift_detected",
  "blocked",
]);
export const dbFactServiceSchema = z.enum(["auth", "core"]);
export const dbFactSubjectSchema = z.enum(["auth", "core", "shared"]);

export const dbFactSourceSchema = z.strictObject({
  kind: trimmedNonEmptyStringSchema,
  owner: trimmedNonEmptyStringSchema,
  path: trimmedNonEmptyStringSchema,
  note: nullableTrimmedStringSchema,
});

export const dbFactTargetSchema = z.strictObject({
  targetKind: z.enum(["worker_binding", "d1_local_sqlite", "d1_http"]),
  bindingName: trimmedNonEmptyStringSchema,
  databaseId: nullableTrimmedStringSchema,
  databaseName: nullableTrimmedStringSchema,
  localPath: nullableTrimmedStringSchema,
  resolvedFrom: nullableTrimmedStringSchema,
});

export const dbDebtRegistryItemSchema = z.strictObject({
  id: trimmedNonEmptyStringSchema,
  service: dbFactServiceSchema,
  path: trimmedNonEmptyStringSchema,
  marker: trimmedNonEmptyStringSchema,
  owner: trimmedNonEmptyStringSchema,
  keepReason: trimmedNonEmptyStringSchema,
  replacementDirection: trimmedNonEmptyStringSchema,
  note: nullableTrimmedStringSchema,
});

export const dbFactSnapshotSchema = z.strictObject({
  subject: dbFactSubjectSchema,
  mode: dbFactModeSchema,
  bindingName: trimmedNonEmptyStringSchema,
  schemaSources: z.array(dbFactSourceSchema),
  migrationSources: z.array(dbFactSourceSchema),
  target: dbFactTargetSchema,
  d1LocalDbPath: nullableTrimmedStringSchema,
  notes: z.array(trimmedNonEmptyStringSchema),
});

export const dbDiagnosticsPayloadSchema = z.strictObject({
  contractVersion: z.literal(DB_FACT_SCHEMA_VERSION),
  auth: dbFactSnapshotSchema.extend({
    subject: z.literal("auth"),
  }),
  core: dbFactSnapshotSchema.extend({
    subject: z.literal("core"),
  }),
});

export const dbCommandFactSummarySchema = z.strictObject({
  contractVersion: z.literal(DB_FACT_SCHEMA_VERSION),
  command: trimmedNonEmptyStringSchema,
  cwd: trimmedNonEmptyStringSchema,
  phase: dbFactPhaseSchema,
  subject: dbFactSubjectSchema,
  result: dbFactResultSchema,
  blockedReason: nullableTrimmedStringSchema,
  snapshot: dbFactSnapshotSchema,
});

export const dbInspectionCheckSchema = z.strictObject({
  status: dbInspectionCheckStatusSchema,
  detail: nullableTrimmedStringSchema,
});

export const dbInspectionSummarySchema = z.strictObject({
  contractVersion: z.literal(DB_FACT_SCHEMA_VERSION),
  command: trimmedNonEmptyStringSchema,
  cwd: trimmedNonEmptyStringSchema,
  subject: z.literal("shared"),
  mode: dbInspectionModeSchema,
  result: dbInspectionResultSchema,
  blockedReason: nullableTrimmedStringSchema,
  snapshot: dbFactSnapshotSchema.extend({
    subject: z.literal("shared"),
    mode: z.literal("tooling"),
  }),
  checks: z.strictObject({
    legacyCoreDispatchShape: dbInspectionCheckSchema,
    sharedCoreDispatchPhysicalContract: dbInspectionCheckSchema,
  }),
  notes: z.array(trimmedNonEmptyStringSchema),
});
