import * as z from "zod/v4";
import { clientMessageIdSchema } from "../protocol/client-message-id";
import { nonEmptyTrimmedStringFromUnknown } from "../protocol/shared";

const diagnosticReportIdSchema = z.string().trim().min(1).max(128);
const diagnosticIdentifierSchema = z.string().trim().min(1).max(512);

export const spaceDiagnosticReportProblemTypeSchema = z.enum([
  "message_problem",
  "no_reply",
  "reply_problem",
]);

export const spaceDiagnosticReportWakePointerDerivationStatusSchema = z.enum([
  "exact",
  "source_multi_target",
  "fallback_multi_target",
  "not_wake",
  "unavailable",
]);

export const spaceDiagnosticReportReasonCodeSchema = z.enum([
  "diagnostic_report.reply_source_signal_not_found",
  "diagnostic_report.reply_target_exact",
  "diagnostic_report.reply_target_missing_fallback",
  "diagnostic_report.terminal_failure_source_signal_not_found",
  "diagnostic_report.terminal_failure_target_exact",
  "diagnostic_report.source_wake_targets",
  "diagnostic_report.not_wake_related",
  "diagnostic_report.wake_pointer_unavailable",
]);

export const createSpaceDiagnosticReportRouteParamsSchema = z.strictObject({
  spaceId: nonEmptyTrimmedStringFromUnknown,
});

export const createSpaceDiagnosticReportBodySchema = z.strictObject({
  reportedSignalId: diagnosticIdentifierSchema,
  problemType: spaceDiagnosticReportProblemTypeSchema,
});

export const spaceDiagnosticReportWakePointerSchema = z.strictObject({
  spaceId: diagnosticIdentifierSchema,
  clientMessageId: clientMessageIdSchema.nullable(),
  sourceSignalId: diagnosticIdentifierSchema,
  targetProfileId: diagnosticIdentifierSchema,
});

export const spaceDiagnosticReportWakePointerDerivationSchema = z.strictObject({
  status: spaceDiagnosticReportWakePointerDerivationStatusSchema,
  reasonCodes: z.array(spaceDiagnosticReportReasonCodeSchema).min(1).max(8),
});

export const createSpaceDiagnosticReportResponseSchema = z
  .strictObject({
    diagnosticReportId: diagnosticReportIdSchema,
    spaceId: diagnosticIdentifierSchema,
    reportedSignalId: diagnosticIdentifierSchema,
    replyToSignalId: diagnosticIdentifierSchema.nullable(),
    threadId: diagnosticIdentifierSchema.nullable(),
    problemType: spaceDiagnosticReportProblemTypeSchema,
    reporterProfileId: diagnosticIdentifierSchema,
    createdAtMs: z.int().min(0),
    wakePointers: z.array(spaceDiagnosticReportWakePointerSchema).max(64),
    wakePointerDerivation: spaceDiagnosticReportWakePointerDerivationSchema,
  })
  .superRefine((value, context) => {
    for (const [pointerIndex, pointer] of value.wakePointers.entries()) {
      if (pointer.spaceId === value.spaceId) {
        continue;
      }
      context.addIssue({
        code: "custom",
        message: "wake pointer spaceId must match report spaceId",
        path: ["wakePointers", pointerIndex, "spaceId"],
      });
    }

    const pointerCount = value.wakePointers.length;
    switch (value.wakePointerDerivation.status) {
      case "exact":
        if (pointerCount !== 1) {
          context.addIssue({
            code: "custom",
            message: "exact diagnostic report must include one wake pointer",
            path: ["wakePointers"],
          });
        }
        break;
      case "source_multi_target":
      case "fallback_multi_target":
        if (pointerCount < 1) {
          context.addIssue({
            code: "custom",
            message:
              "multi-target diagnostic report must include at least one wake pointer",
            path: ["wakePointers"],
          });
        }
        break;
      case "not_wake":
      case "unavailable":
        if (pointerCount !== 0) {
          context.addIssue({
            code: "custom",
            message:
              "diagnostic report without wake evidence must not include wake pointers",
            path: ["wakePointers"],
          });
        }
        break;
      default: {
        const _exhaustive: never = value.wakePointerDerivation.status;
        return _exhaustive;
      }
    }
  });
