import type { z } from "zod/v4";

type SpaceDiagnosticReportProblemTypeSchema =
  typeof import("../../schemas/http/space-diagnostic-report")["spaceDiagnosticReportProblemTypeSchema"];
type SpaceDiagnosticReportWakePointerDerivationStatusSchema =
  typeof import("../../schemas/http/space-diagnostic-report")["spaceDiagnosticReportWakePointerDerivationStatusSchema"];
type SpaceDiagnosticReportReasonCodeSchema =
  typeof import("../../schemas/http/space-diagnostic-report")["spaceDiagnosticReportReasonCodeSchema"];
type CreateSpaceDiagnosticReportRouteParamsSchema =
  typeof import("../../schemas/http/space-diagnostic-report")["createSpaceDiagnosticReportRouteParamsSchema"];
type CreateSpaceDiagnosticReportBodySchema =
  typeof import("../../schemas/http/space-diagnostic-report")["createSpaceDiagnosticReportBodySchema"];
type SpaceDiagnosticReportWakePointerSchema =
  typeof import("../../schemas/http/space-diagnostic-report")["spaceDiagnosticReportWakePointerSchema"];
type SpaceDiagnosticReportWakePointerDerivationSchema =
  typeof import("../../schemas/http/space-diagnostic-report")["spaceDiagnosticReportWakePointerDerivationSchema"];
type CreateSpaceDiagnosticReportResponseSchema =
  typeof import("../../schemas/http/space-diagnostic-report")["createSpaceDiagnosticReportResponseSchema"];

export type SpaceDiagnosticReportProblemType =
  z.infer<SpaceDiagnosticReportProblemTypeSchema>;
export type SpaceDiagnosticReportWakePointerDerivationStatus =
  z.infer<SpaceDiagnosticReportWakePointerDerivationStatusSchema>;
export type SpaceDiagnosticReportReasonCode =
  z.infer<SpaceDiagnosticReportReasonCodeSchema>;
export type CreateSpaceDiagnosticReportRouteParams =
  z.infer<CreateSpaceDiagnosticReportRouteParamsSchema>;
export type CreateSpaceDiagnosticReportBody =
  z.infer<CreateSpaceDiagnosticReportBodySchema>;
export type SpaceDiagnosticReportWakePointer =
  z.infer<SpaceDiagnosticReportWakePointerSchema>;
export type SpaceDiagnosticReportWakePointerDerivation =
  z.infer<SpaceDiagnosticReportWakePointerDerivationSchema>;
export type CreateSpaceDiagnosticReportResponse =
  z.infer<CreateSpaceDiagnosticReportResponseSchema>;
