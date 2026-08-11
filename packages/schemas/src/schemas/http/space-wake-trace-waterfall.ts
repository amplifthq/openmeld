import { z } from "zod/v4";
import { clientMessageIdSchema } from "../protocol/client-message-id";
import { nonEmptyTrimmedStringFromUnknown } from "../protocol/shared";
import { observabilityWakeCorrelationSchema } from "./observability-correlation";

const optionalSelectorSchema = z.preprocess((value) => {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : undefined;
}, z.string().min(1).optional());
const optionalClientMessageIdSchema = z.preprocess((value) => {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : undefined;
}, clientMessageIdSchema.optional());

const nullableTrimmedIdentifierSchema = z.string().trim().min(1).nullable();
const nullableReasonCodeSchema = z.string().trim().min(1).max(512).nullable();
const nullableIsoDateTimeSchema = z.iso.datetime({ offset: true }).nullable();

export const WAKE_TRACE_WATERFALL_STEP_NAMES = [
  "source_signal",
  "planner",
  "dispatch",
  "head_lifecycle",
  "attempt",
  "result_inbox",
  "result",
  "reply_signal",
] as const;

export const wakeTraceWaterfallStepNameSchema = z.enum(
  WAKE_TRACE_WATERFALL_STEP_NAMES
);

export const wakeTraceWaterfallStepStatusSchema = z.enum([
  "found",
  "missing",
  "pending",
  "failed",
  "degraded",
  "not_applicable",
]);

export const wakeTraceWaterfallSummaryStatusSchema = z.enum([
  "missing",
  "pending",
  "running",
  "failed",
  "stopped",
  "replied",
]);

export const wakeTargetExecutionContextResolutionStatusSchema = z.enum([
  "resolved",
  "not_started",
  "not_resolved",
  "redacted",
]);

export const wakeTargetExecutionContextFactSourceSchema = z.enum([
  "dispatch_trace_origin",
  "runtime_coordinator_execution",
  "dispatch_attempt_execution_identity",
  "dispatch_record",
  "none",
]);

export const wakeTraceWaterfallFactSourceSchema = z.enum([
  "space_signal_by_client_message_id",
  "space_signal_by_source_signal_id",
  "dispatch_outbox",
  "dispatch_lookup",
  "dispatch_ledger",
  "dispatch_attempt",
  "runtime_coordinator_head_lifecycle",
  "dispatch_result_inbox",
  "dispatch_result",
  "space_signal_by_published_signal_id",
  "space_final_reply_claim",
  "space_signal_recent_window",
  "lookup_error",
]);

export const wakeTraceWaterfallStepIdsSchema = z.strictObject({
  clientMessageId: clientMessageIdSchema.nullable(),
  sourceSignalId: nullableTrimmedIdentifierSchema,
  targetProfileId: nullableTrimmedIdentifierSchema,
  targetWakeLifecycleId: nullableTrimmedIdentifierSchema,
  dispatchId: nullableTrimmedIdentifierSchema,
  attemptId: nullableTrimmedIdentifierSchema,
  claimLeaseId: nullableTrimmedIdentifierSchema,
  bindingId: nullableTrimmedIdentifierSchema,
  openMeldServiceRuntimeId: nullableTrimmedIdentifierSchema,
  agentControllerRef: nullableTrimmedIdentifierSchema,
  resultKey: nullableTrimmedIdentifierSchema,
  resultRef: nullableTrimmedIdentifierSchema,
  publishedSignalId: nullableTrimmedIdentifierSchema,
  replySignalId: nullableTrimmedIdentifierSchema,
});

export const wakeTraceWaterfallStepSchema = z.strictObject({
  order: z.int().min(0),
  name: wakeTraceWaterfallStepNameSchema,
  status: wakeTraceWaterfallStepStatusSchema,
  factSource: wakeTraceWaterfallFactSourceSchema.nullable(),
  observedAt: nullableIsoDateTimeSchema,
  reasonCode: nullableReasonCodeSchema,
  ids: wakeTraceWaterfallStepIdsSchema,
});

export const wakeTargetExecutionContextSchema = z.strictObject({
  resolutionStatus: wakeTargetExecutionContextResolutionStatusSchema,
  factSource: wakeTargetExecutionContextFactSourceSchema,
  reasonCode: nullableReasonCodeSchema,
  bindingId: nullableTrimmedIdentifierSchema,
  openMeldServiceRuntimeId: nullableTrimmedIdentifierSchema,
  agentControllerRef: nullableTrimmedIdentifierSchema,
  agentControllerConversationId: nullableTrimmedIdentifierSchema,
  agentControllerConversationKind: nullableTrimmedIdentifierSchema,
  runtimeWorkspacePath: nullableTrimmedIdentifierSchema,
  runtimeWorkspaceFingerprint: nullableTrimmedIdentifierSchema,
});

export const wakeTraceWaterfallItemSchema = z.strictObject({
  targetProfileId: z.string().trim().min(1),
  targetLabel: z.string().trim().min(1),
  correlation: observabilityWakeCorrelationSchema,
  executionContext: wakeTargetExecutionContextSchema,
  summary: z.strictObject({
    status: wakeTraceWaterfallSummaryStatusSchema,
    terminalStep: wakeTraceWaterfallStepNameSchema.nullable(),
    reasonCode: nullableReasonCodeSchema,
  }),
  steps: z.array(wakeTraceWaterfallStepSchema),
});

export const getSpaceWakeTraceWaterfallInputSchema = z
  .strictObject({
    spaceId: nonEmptyTrimmedStringFromUnknown,
    sourceSignalId: optionalSelectorSchema,
    clientMessageId: optionalClientMessageIdSchema,
    targetProfileId: optionalSelectorSchema,
  })
  .superRefine((value, context) => {
    const selectorCount =
      Number(value.sourceSignalId !== undefined) +
      Number(value.clientMessageId !== undefined);
    if (selectorCount === 1) {
      return;
    }

    context.addIssue({
      code: "custom",
      message: "exactly one of sourceSignalId or clientMessageId is required",
      path: ["sourceSignalId"],
    });
  });

export const getSpaceWakeTraceWaterfallResponseSchema = z
  .strictObject({
    query: z.strictObject({
      spaceId: z.string().trim().min(1),
      sourceSignalId: z.string().trim().min(1).nullable(),
      clientMessageId: clientMessageIdSchema.nullable(),
      targetProfileId: z.string().trim().min(1).nullable(),
    }),
    items: z.array(wakeTraceWaterfallItemSchema),
  })
  .superRefine((value, context) => {
    validateWaterfallResponseQuerySelector(value, context);
    for (const [itemIndex, item] of value.items.entries()) {
      validateWaterfallResponseItem(value, context, item, itemIndex);
    }
  });

type WakeTraceWaterfallResponseRefinementValue = {
  items: z.infer<typeof wakeTraceWaterfallItemSchema>[];
  query: {
    clientMessageId: string | null;
    sourceSignalId: string | null;
    spaceId: string;
    targetProfileId: string | null;
  };
};

function validateWaterfallResponseQuerySelector(
  value: WakeTraceWaterfallResponseRefinementValue,
  context: z.RefinementCtx
): void {
  const selectorCount =
    Number(value.query.sourceSignalId !== null) +
    Number(value.query.clientMessageId !== null);
  if (selectorCount === 1) {
    return;
  }
  context.addIssue({
    code: "custom",
    message: "response query must include exactly one Wake trace selector",
    path: ["query", "sourceSignalId"],
  });
}

function validateWaterfallResponseItem(
  value: WakeTraceWaterfallResponseRefinementValue,
  context: z.RefinementCtx,
  item: z.infer<typeof wakeTraceWaterfallItemSchema>,
  itemIndex: number
): void {
  validateWaterfallItemTargetProfile(value, context, item, itemIndex);
  validateWaterfallItemSelector(value, context, item, itemIndex);
  validateWaterfallItemCorrelation(value, context, item, itemIndex);
  validateWaterfallItemSteps(value, context, item, itemIndex);
}

function validateWaterfallItemTargetProfile(
  value: WakeTraceWaterfallResponseRefinementValue,
  context: z.RefinementCtx,
  item: z.infer<typeof wakeTraceWaterfallItemSchema>,
  itemIndex: number
): void {
  if (
    value.query.targetProfileId === null ||
    item.targetProfileId === value.query.targetProfileId
  ) {
    return;
  }
  context.addIssue({
    code: "custom",
    message: "item targetProfileId must match query.targetProfileId",
    path: ["items", itemIndex, "targetProfileId"],
  });
}

function validateWaterfallItemSelector(
  value: WakeTraceWaterfallResponseRefinementValue,
  context: z.RefinementCtx,
  item: z.infer<typeof wakeTraceWaterfallItemSchema>,
  itemIndex: number
): void {
  if (value.query.clientMessageId !== null) {
    validateWaterfallItemClientMessageSelector(value, context, item, itemIndex);
    return;
  }
  if (value.query.sourceSignalId !== null) {
    validateWaterfallItemSourceSignalSelector(value, context, item, itemIndex);
  }
}

function validateWaterfallItemClientMessageSelector(
  value: WakeTraceWaterfallResponseRefinementValue,
  context: z.RefinementCtx,
  item: z.infer<typeof wakeTraceWaterfallItemSchema>,
  itemIndex: number
): void {
  if (item.correlation.selector.kind === "client_message") {
    expectWaterfallEvidence(
      context,
      item.correlation.selector.spaceId,
      value.query.spaceId,
      ["items", itemIndex, "correlation", "selector", "spaceId"],
      "correlation selector spaceId must match query.spaceId"
    );
    expectWaterfallEvidence(
      context,
      item.correlation.selector.clientMessageId,
      value.query.clientMessageId,
      ["items", itemIndex, "correlation", "selector", "clientMessageId"],
      "correlation selector clientMessageId must match query.clientMessageId"
    );
    expectWaterfallEvidence(
      context,
      item.correlation.selector.targetProfileId,
      item.targetProfileId,
      ["items", itemIndex, "correlation", "selector", "targetProfileId"],
      "correlation selector targetProfileId must match item targetProfileId"
    );
    return;
  }
  context.addIssue({
    code: "custom",
    message: "waterfall correlation selector must be client_message",
    path: ["items", itemIndex, "correlation", "selector", "kind"],
  });
}

function validateWaterfallItemSourceSignalSelector(
  value: WakeTraceWaterfallResponseRefinementValue,
  context: z.RefinementCtx,
  item: z.infer<typeof wakeTraceWaterfallItemSchema>,
  itemIndex: number
): void {
  if (item.correlation.selector.kind === "source_signal") {
    expectWaterfallEvidence(
      context,
      item.correlation.selector.spaceId,
      value.query.spaceId,
      ["items", itemIndex, "correlation", "selector", "spaceId"],
      "correlation selector spaceId must match query.spaceId"
    );
    expectWaterfallEvidence(
      context,
      item.correlation.selector.sourceSignalId,
      value.query.sourceSignalId,
      ["items", itemIndex, "correlation", "selector", "sourceSignalId"],
      "correlation selector sourceSignalId must match query.sourceSignalId"
    );
    expectWaterfallEvidence(
      context,
      item.correlation.selector.targetProfileId,
      item.targetProfileId,
      ["items", itemIndex, "correlation", "selector", "targetProfileId"],
      "correlation selector targetProfileId must match item targetProfileId"
    );
    return;
  }
  context.addIssue({
    code: "custom",
    message: "waterfall correlation selector must be source_signal",
    path: ["items", itemIndex, "correlation", "selector", "kind"],
  });
}

function validateWaterfallItemCorrelation(
  value: WakeTraceWaterfallResponseRefinementValue,
  context: z.RefinementCtx,
  item: z.infer<typeof wakeTraceWaterfallItemSchema>,
  itemIndex: number
): void {
  expectWaterfallEvidence(
    context,
    item.correlation.spaceId,
    value.query.spaceId,
    ["items", itemIndex, "correlation", "spaceId"],
    "correlation spaceId must match query.spaceId"
  );
  if (value.query.clientMessageId !== null) {
    expectWaterfallEvidence(
      context,
      item.correlation.clientMessageId,
      value.query.clientMessageId,
      ["items", itemIndex, "correlation", "clientMessageId"],
      "correlation clientMessageId must match query.clientMessageId"
    );
  }
  if (value.query.sourceSignalId !== null) {
    expectWaterfallEvidence(
      context,
      item.correlation.sourceSignalId,
      value.query.sourceSignalId,
      ["items", itemIndex, "correlation", "sourceSignalId"],
      "correlation sourceSignalId must match query.sourceSignalId"
    );
  }
  expectWaterfallEvidence(
    context,
    item.correlation.targetProfileId,
    item.targetProfileId,
    ["items", itemIndex, "correlation", "targetProfileId"],
    "correlation targetProfileId must match item targetProfileId"
  );
}

function validateWaterfallItemSteps(
  value: WakeTraceWaterfallResponseRefinementValue,
  context: z.RefinementCtx,
  item: z.infer<typeof wakeTraceWaterfallItemSchema>,
  itemIndex: number
): void {
  if (item.steps.length !== WAKE_TRACE_WATERFALL_STEP_NAMES.length) {
    context.addIssue({
      code: "custom",
      message: "waterfall item must include all canonical steps",
      path: ["items", itemIndex, "steps"],
    });
  }

  for (const [
    stepIndex,
    expectedName,
  ] of WAKE_TRACE_WATERFALL_STEP_NAMES.entries()) {
    const step = item.steps[stepIndex];
    if (!step) {
      continue;
    }
    validateWaterfallItemStep(
      value,
      context,
      item,
      itemIndex,
      step,
      stepIndex,
      expectedName
    );
  }
}

function validateWaterfallItemStep(
  value: WakeTraceWaterfallResponseRefinementValue,
  context: z.RefinementCtx,
  item: z.infer<typeof wakeTraceWaterfallItemSchema>,
  itemIndex: number,
  step: z.infer<typeof wakeTraceWaterfallStepSchema>,
  stepIndex: number,
  expectedName: (typeof WAKE_TRACE_WATERFALL_STEP_NAMES)[number]
): void {
  expectWaterfallEvidence(
    context,
    step.order,
    stepIndex,
    ["items", itemIndex, "steps", stepIndex, "order"],
    "waterfall step order must match canonical order"
  );
  expectWaterfallEvidence(
    context,
    step.name,
    expectedName,
    ["items", itemIndex, "steps", stepIndex, "name"],
    "waterfall step name must match canonical order"
  );
  if (value.query.clientMessageId !== null) {
    expectWaterfallEvidence(
      context,
      step.ids.clientMessageId,
      value.query.clientMessageId,
      ["items", itemIndex, "steps", stepIndex, "ids", "clientMessageId"],
      "waterfall step clientMessageId must match query.clientMessageId"
    );
  }
  if (value.query.sourceSignalId !== null) {
    expectWaterfallEvidence(
      context,
      step.ids.sourceSignalId,
      value.query.sourceSignalId,
      ["items", itemIndex, "steps", stepIndex, "ids", "sourceSignalId"],
      "waterfall step sourceSignalId must match query.sourceSignalId"
    );
  }
  expectWaterfallEvidence(
    context,
    step.ids.targetProfileId,
    item.targetProfileId,
    ["items", itemIndex, "steps", stepIndex, "ids", "targetProfileId"],
    "waterfall step targetProfileId must match item targetProfileId"
  );
}

function expectWaterfallEvidence(
  context: z.RefinementCtx,
  actual: unknown,
  expected: unknown,
  path: (string | number)[],
  message: string
): void {
  if (actual === expected) {
    return;
  }
  context.addIssue({
    code: "custom",
    message,
    path,
  });
}
