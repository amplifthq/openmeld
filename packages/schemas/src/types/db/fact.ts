import type { z } from "zod/v4";

type DbCommandFactSummarySchema =
  typeof import("../../schemas/db/fact")["dbCommandFactSummarySchema"];
type DbDebtRegistryItemSchema =
  typeof import("../../schemas/db/fact")["dbDebtRegistryItemSchema"];
type DbDiagnosticsPayloadSchema =
  typeof import("../../schemas/db/fact")["dbDiagnosticsPayloadSchema"];
type DbFactModeSchema =
  typeof import("../../schemas/db/fact")["dbFactModeSchema"];
type DbFactPhaseSchema =
  typeof import("../../schemas/db/fact")["dbFactPhaseSchema"];
type DbFactResultSchema =
  typeof import("../../schemas/db/fact")["dbFactResultSchema"];
type DbFactServiceSchema =
  typeof import("../../schemas/db/fact")["dbFactServiceSchema"];
type DbFactSnapshotSchema =
  typeof import("../../schemas/db/fact")["dbFactSnapshotSchema"];
type DbFactSourceSchema =
  typeof import("../../schemas/db/fact")["dbFactSourceSchema"];
type DbFactSubjectSchema =
  typeof import("../../schemas/db/fact")["dbFactSubjectSchema"];
type DbFactTargetSchema =
  typeof import("../../schemas/db/fact")["dbFactTargetSchema"];
type DbInspectionCheckSchema =
  typeof import("../../schemas/db/fact")["dbInspectionCheckSchema"];
type DbInspectionCheckStatusSchema =
  typeof import("../../schemas/db/fact")["dbInspectionCheckStatusSchema"];
type DbInspectionModeSchema =
  typeof import("../../schemas/db/fact")["dbInspectionModeSchema"];
type DbInspectionResultSchema =
  typeof import("../../schemas/db/fact")["dbInspectionResultSchema"];
type DbInspectionSummarySchema =
  typeof import("../../schemas/db/fact")["dbInspectionSummarySchema"];

export type DbCommandFactSummary = z.infer<DbCommandFactSummarySchema>;
export type DbDebtRegistryItem = z.infer<DbDebtRegistryItemSchema>;
export type DbDiagnosticsPayload = z.infer<DbDiagnosticsPayloadSchema>;
export type DbFactMode = z.infer<DbFactModeSchema>;
export type DbFactPhase = z.infer<DbFactPhaseSchema>;
export type DbFactResult = z.infer<DbFactResultSchema>;
export type DbFactService = z.infer<DbFactServiceSchema>;
export type DbFactSnapshot = z.infer<DbFactSnapshotSchema>;
export type DbFactSource = z.infer<DbFactSourceSchema>;
export type DbFactSubject = z.infer<DbFactSubjectSchema>;
export type DbFactTarget = z.infer<DbFactTargetSchema>;
export type DbInspectionCheck = z.infer<DbInspectionCheckSchema>;
export type DbInspectionCheckStatus = z.infer<DbInspectionCheckStatusSchema>;
export type DbInspectionMode = z.infer<DbInspectionModeSchema>;
export type DbInspectionResult = z.infer<DbInspectionResultSchema>;
export type DbInspectionSummary = z.infer<DbInspectionSummarySchema>;
