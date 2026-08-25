import * as z from "zod/v4";
import { agentStreamToolPartSchema } from "../protocol/agent-stream";
import { clientMessageIdSchema } from "../protocol/client-message-id";
import { nonEmptyTrimmedStringFromUnknown } from "../protocol/shared";
import {
  wakeTraceWaterfallStepNameSchema,
  wakeTraceWaterfallStepSchema,
  wakeTraceWaterfallSummaryStatusSchema,
} from "./space-wake-trace-waterfall";

const nullableTrimmedStringSchema = z.string().trim().min(1).nullable();
const nullableReasonCodeSchema = z.string().trim().min(1).max(512).nullable();

export const spaceMessageDetailsFactStateSchema = z.enum([
  "recorded",
  "not_recorded",
  "redacted",
  "not_applicable",
]);

export const spaceMessageDetailsFactSourceSchema = z.enum([
  "space_signal",
  "space_signal_profile",
  "reply_signal",
  "wake_trace",
  "wake_trace_execution_context",
  "wake_trace_correlation",
  "none",
]);

export const spaceMessageDetailsStringFactSchema = z
  .strictObject({
    state: spaceMessageDetailsFactStateSchema,
    value: nullableTrimmedStringSchema,
    source: spaceMessageDetailsFactSourceSchema,
  })
  .superRefine((value, context) => {
    if (value.state === "recorded" && value.value === null) {
      context.addIssue({
        code: "custom",
        message: "recorded facts must include a value",
        path: ["value"],
      });
    }
    if (value.state !== "recorded" && value.value !== null) {
      context.addIssue({
        code: "custom",
        message: "only recorded facts may include a value",
        path: ["value"],
      });
    }
  });

export const spaceMessageDetailsSectionStateSchema = z.enum([
  "recorded",
  "not_recorded",
  "not_applicable",
]);

export const spaceMessageDetailsSignalTypeSchema = z.enum([
  "signal.text",
  "signal.status",
  "signal.system_notice",
]);

export const spaceMessageDetailsActorSchema = z.strictObject({
  profileId: z.string().trim().min(1),
  profileKind: z.enum(["human", "agent", "system"]),
  displayName: z.string().trim().min(1),
  profileName: nullableTrimmedStringSchema,
  profileHandle: nullableTrimmedStringSchema,
});

export const spaceMessageDetailsMessageSectionSchema = z.strictObject({
  signalId: z.string().trim().min(1),
  signalType: spaceMessageDetailsSignalTypeSchema,
  sentAtMs: z.int().nonnegative(),
  actor: spaceMessageDetailsActorSchema,
});

export const spaceMessageDetailsAgentContextSchema = z.strictObject({
  state: spaceMessageDetailsSectionStateSchema,
  profileId: spaceMessageDetailsStringFactSchema,
  profileName: spaceMessageDetailsStringFactSchema,
  agentControllerRef: spaceMessageDetailsStringFactSchema,
  agentControllerConversationId: spaceMessageDetailsStringFactSchema,
  workspacePath: spaceMessageDetailsStringFactSchema,
  openMeldServiceRuntimeId: spaceMessageDetailsStringFactSchema,
  bindingId: spaceMessageDetailsStringFactSchema,
  workspaceFingerprint: spaceMessageDetailsStringFactSchema,
});

export const spaceMessageDetailsWakeTargetSchema = z.strictObject({
  targetProfileId: z.string().trim().min(1),
  targetLabel: nullableTrimmedStringSchema,
  status: wakeTraceWaterfallSummaryStatusSchema.optional(),
  terminalStep: wakeTraceWaterfallStepNameSchema.nullable().optional(),
  reasonCode: nullableReasonCodeSchema.optional(),
  agentContext: spaceMessageDetailsAgentContextSchema.optional(),
  steps: z.array(wakeTraceWaterfallStepSchema).optional(),
});

export const spaceMessageDetailsWakeContextSchema = z.strictObject({
  state: spaceMessageDetailsSectionStateSchema,
  sourceSignalId: spaceMessageDetailsStringFactSchema,
  clientMessageId: spaceMessageDetailsStringFactSchema,
  targets: z.array(spaceMessageDetailsWakeTargetSchema),
});

export const spaceMessageDetailsReplyContextSchema = z.strictObject({
  state: spaceMessageDetailsSectionStateSchema,
  replyingToSignalId: spaceMessageDetailsStringFactSchema,
  replyingToAuthor: spaceMessageDetailsStringFactSchema,
  previewText: spaceMessageDetailsStringFactSchema,
  resolved: z.boolean(),
});

export const spaceMessageDetailsToolActivitySchema = z
  .strictObject({
    toolName: z.string().trim().min(1).max(160),
    state: z.enum(["input-available", "output-available", "output-error"]),
    startedAtMs: z.int().nonnegative(),
    updatedAtMs: z.int().nonnegative(),
    work: agentStreamToolPartSchema.shape.work,
  })
  .superRefine((value, context) => {
    if (value.updatedAtMs < value.startedAtMs) {
      context.addIssue({
        code: "custom",
        message: "updatedAtMs must not precede startedAtMs",
        path: ["updatedAtMs"],
      });
    }
  });

export const spaceMessageDetailsWorkingDetailsSchema = z
  .strictObject({
    state: spaceMessageDetailsSectionStateSchema,
    tools: z.array(spaceMessageDetailsToolActivitySchema).max(50),
    truncated: z.boolean(),
  })
  .superRefine((value, context) => {
    if (value.state === "recorded" && value.tools.length === 0) {
      context.addIssue({
        code: "custom",
        message: "recorded working details must include tool activity",
        path: ["tools"],
      });
    }
    if (value.state !== "recorded" && value.tools.length > 0) {
      context.addIssue({
        code: "custom",
        message: "only recorded working details may include tool activity",
        path: ["tools"],
      });
    }
    if (value.state !== "recorded" && value.truncated) {
      context.addIssue({
        code: "custom",
        message: "only recorded working details may be truncated",
        path: ["truncated"],
      });
    }
  });

export const spaceMessageDetailsTraceSelectorSchema = z.strictObject({
  kind: z.enum(["signal", "client_message", "wake_source_signal", "dispatch"]),
  label: z.string().trim().min(1),
  value: z.string().trim().min(1),
  targetProfileId: nullableTrimmedStringSchema,
});

export const spaceMessageDetailsDiagnosticsSchema = z.strictObject({
  signalId: z.string().trim().min(1),
  traceSelectors: z.array(spaceMessageDetailsTraceSelectorSchema),
});

export const getSpaceMessageDetailsInputSchema = z.strictObject({
  spaceId: nonEmptyTrimmedStringFromUnknown,
  signalId: nonEmptyTrimmedStringFromUnknown,
});

export const getSpaceMessageDetailsResponseSchema = z.strictObject({
  query: z.strictObject({
    spaceId: z.string().trim().min(1),
    signalId: z.string().trim().min(1),
  }),
  message: spaceMessageDetailsMessageSectionSchema,
  agentContext: spaceMessageDetailsAgentContextSchema,
  wakeContext: spaceMessageDetailsWakeContextSchema,
  replyContext: spaceMessageDetailsReplyContextSchema,
  workingDetails: spaceMessageDetailsWorkingDetailsSchema.optional(),
  diagnostics: spaceMessageDetailsDiagnosticsSchema,
});

export const spaceMessageDetailsClientMessageIdSchema =
  clientMessageIdSchema.nullable();
