import * as z from "zod/v4";
import { clientMessageIdSchema } from "../protocol/client-message-id";

export const OBSERVABILITY_WAKE_CORRELATION_MODEL_VERSION =
  "openmeld.observability.wake.v1" as const;

const observabilityIdentifierSchema = z.string().trim().min(1).max(512);
const nullableObservabilityIdentifierSchema =
  observabilityIdentifierSchema.nullable();

const spaceScopedSelectorBaseSchema = z.strictObject({
  spaceId: observabilityIdentifierSchema,
});

export const observabilityWakeTraceSelectorSchema = z.discriminatedUnion(
  "kind",
  [
    spaceScopedSelectorBaseSchema.extend({
      kind: z.literal("dispatch"),
      dispatchId: observabilityIdentifierSchema,
    }),
    spaceScopedSelectorBaseSchema.extend({
      kind: z.literal("client_message"),
      clientMessageId: clientMessageIdSchema,
      targetProfileId: observabilityIdentifierSchema,
    }),
    spaceScopedSelectorBaseSchema.extend({
      kind: z.literal("source_signal"),
      sourceSignalId: observabilityIdentifierSchema,
      targetProfileId: observabilityIdentifierSchema,
    }),
    // Legacy selector kept only so stored diagnostic pointers can still parse.
    z.strictObject({
      kind: z.literal("claim_lease"),
      claimLeaseId: observabilityIdentifierSchema,
    }),
  ]
);

export const observabilityCloudflareRuntimeEvidenceSchema = z.strictObject({
  cfRayId: nullableObservabilityIdentifierSchema,
  requestId: nullableObservabilityIdentifierSchema,
  traceId: nullableObservabilityIdentifierSchema,
});

export const observabilityWakeCorrelationSchema = z
  .strictObject({
    modelVersion: z.literal(OBSERVABILITY_WAKE_CORRELATION_MODEL_VERSION),
    selector: observabilityWakeTraceSelectorSchema,
    spaceId: nullableObservabilityIdentifierSchema,
    clientMessageId: clientMessageIdSchema.nullable(),
    sourceSignalId: nullableObservabilityIdentifierSchema,
    targetProfileId: nullableObservabilityIdentifierSchema,
    dispatchId: nullableObservabilityIdentifierSchema,
    runtimeCoordinatorExecutionId: nullableObservabilityIdentifierSchema,
    latestAttemptId: nullableObservabilityIdentifierSchema,
    claimLeaseId: nullableObservabilityIdentifierSchema,
    bindingId: nullableObservabilityIdentifierSchema,
    openMeldServiceRuntimeId: nullableObservabilityIdentifierSchema,
    agentControllerRef: nullableObservabilityIdentifierSchema,
    resultRef: nullableObservabilityIdentifierSchema,
    publishedSignalId: nullableObservabilityIdentifierSchema,
    replySignalId: nullableObservabilityIdentifierSchema,
    cloudflare: observabilityCloudflareRuntimeEvidenceSchema,
  })
  .superRefine((value, context) => {
    const addIssue = (path: string[], message: string): void => {
      context.addIssue({
        code: "custom",
        message,
        path,
      });
    };

    switch (value.selector.kind) {
      case "client_message":
        if (value.spaceId !== value.selector.spaceId) {
          addIssue(["spaceId"], "spaceId must match selector.spaceId");
        }
        if (value.clientMessageId !== value.selector.clientMessageId) {
          addIssue(
            ["clientMessageId"],
            "clientMessageId must match selector.clientMessageId"
          );
        }
        if (value.targetProfileId !== value.selector.targetProfileId) {
          addIssue(
            ["targetProfileId"],
            "targetProfileId must match selector.targetProfileId"
          );
        }
        return;
      case "source_signal":
        if (value.spaceId !== value.selector.spaceId) {
          addIssue(["spaceId"], "spaceId must match selector.spaceId");
        }
        if (value.sourceSignalId !== value.selector.sourceSignalId) {
          addIssue(
            ["sourceSignalId"],
            "sourceSignalId must match selector.sourceSignalId"
          );
        }
        if (value.targetProfileId !== value.selector.targetProfileId) {
          addIssue(
            ["targetProfileId"],
            "targetProfileId must match selector.targetProfileId"
          );
        }
        return;
      case "dispatch":
        if (value.spaceId !== value.selector.spaceId) {
          addIssue(["spaceId"], "spaceId must match selector.spaceId");
        }
        if (value.dispatchId !== value.selector.dispatchId) {
          addIssue(["dispatchId"], "dispatchId must match selector.dispatchId");
        }
        return;
      case "claim_lease":
        if (value.claimLeaseId !== value.selector.claimLeaseId) {
          addIssue(
            ["claimLeaseId"],
            "claimLeaseId must match selector.claimLeaseId"
          );
        }
        return;
      default:
        return;
    }
  });

type BuildObservabilityWakeCorrelationInput = {
  selector: z.input<typeof observabilityWakeTraceSelectorSchema>;
  spaceId?: unknown;
  clientMessageId?: unknown;
  sourceSignalId?: unknown;
  targetProfileId?: unknown;
  dispatchId?: unknown;
  runtimeCoordinatorExecutionId?: unknown;
  latestAttemptId?: unknown;
  claimLeaseId?: unknown;
  bindingId?: unknown;
  openMeldServiceRuntimeId?: unknown;
  agentControllerRef?: unknown;
  resultRef?: unknown;
  publishedSignalId?: unknown;
  replySignalId?: unknown;
  cloudflare?: {
    cfRayId?: unknown;
    requestId?: unknown;
    traceId?: unknown;
  } | null;
};

type ObservabilityWakeDispatchFact = {
  dispatchId?: unknown;
  latestAttemptId?: unknown;
  sourceClientMessageId?: unknown;
  sourceEventId?: unknown;
  targetProfileId?: unknown;
};

type ObservabilityWakeLatestAttemptFact = {
  attemptId?: unknown;
  dispatchId?: unknown;
};

type ObservabilityWakeClaimLeaseFact = {
  bindingId?: unknown;
  agentControllerRef?: unknown;
  claimLeaseId?: unknown;
  dispatchId?: unknown;
  openMeldServiceRuntimeId?: unknown;
  sourceClientMessageId?: unknown;
  sourceEventId?: unknown;
  targetProfileId?: unknown;
};

type ObservabilityWakeRuntimeCoordinatorExecutionFact = {
  bindingId?: unknown;
  agentControllerRef?: unknown;
  dispatchId?: unknown;
  runtimeCoordinatorExecutionId?: unknown;
  openMeldServiceRuntimeId?: unknown;
  sourceClientMessageId?: unknown;
  targetProfileId?: unknown;
};

type ObservabilityWakeResultFact = {
  dispatchId?: unknown;
  publishedSignalId?: unknown;
  resultRef?: unknown;
};

type ObservabilityWakeReplySignalFact = {
  signalId?: unknown;
};

export type ProjectObservabilityWakeCorrelationInput =
  BuildObservabilityWakeCorrelationInput & {
    facts?: {
      claimLease?: ObservabilityWakeClaimLeaseFact | null;
      coordinatorExecution?: ObservabilityWakeRuntimeCoordinatorExecutionFact | null;
      dispatch?: ObservabilityWakeDispatchFact | null;
      latestAttempt?: ObservabilityWakeLatestAttemptFact | null;
      replySignal?: ObservabilityWakeReplySignalFact | null;
      result?: ObservabilityWakeResultFact | null;
    };
  };

function buildObservabilityWakeCorrelation(
  input: BuildObservabilityWakeCorrelationInput
): z.infer<typeof observabilityWakeCorrelationSchema> {
  const candidate = {
    modelVersion: OBSERVABILITY_WAKE_CORRELATION_MODEL_VERSION,
    selector: input.selector,
    spaceId: normalizeOptionalObservabilityId(input.spaceId),
    clientMessageId: normalizeOptionalClientMessageId(input.clientMessageId),
    sourceSignalId: normalizeOptionalObservabilityId(input.sourceSignalId),
    targetProfileId: normalizeOptionalObservabilityId(input.targetProfileId),
    dispatchId: normalizeOptionalObservabilityId(input.dispatchId),
    runtimeCoordinatorExecutionId: normalizeOptionalObservabilityId(
      input.runtimeCoordinatorExecutionId
    ),
    latestAttemptId: normalizeOptionalObservabilityId(input.latestAttemptId),
    claimLeaseId: normalizeOptionalObservabilityId(input.claimLeaseId),
    bindingId: normalizeOptionalObservabilityId(input.bindingId),
    openMeldServiceRuntimeId: normalizeOptionalObservabilityId(
      input.openMeldServiceRuntimeId
    ),
    agentControllerRef: normalizeOptionalObservabilityId(
      input.agentControllerRef
    ),
    resultRef: normalizeOptionalObservabilityId(input.resultRef),
    publishedSignalId: normalizeOptionalObservabilityId(
      input.publishedSignalId
    ),
    replySignalId: normalizeOptionalObservabilityId(input.replySignalId),
    cloudflare: {
      cfRayId: normalizeOptionalObservabilityId(input.cloudflare?.cfRayId),
      requestId: normalizeOptionalObservabilityId(input.cloudflare?.requestId),
      traceId: normalizeOptionalObservabilityId(input.cloudflare?.traceId),
    },
  };
  const parsed = observabilityWakeCorrelationSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new Error("invalid observability wake correlation evidence");
  }
  return parsed.data;
}

export function projectObservabilityWakeCorrelation(
  input: ProjectObservabilityWakeCorrelationInput
): z.infer<typeof observabilityWakeCorrelationSchema> {
  const selector = parseObservabilityWakeTraceSelector(input.selector);
  const dispatch = input.facts?.dispatch ?? null;
  const latestAttempt = input.facts?.latestAttempt ?? null;
  const coordinatorExecution = input.facts?.coordinatorExecution ?? null;
  const claimLease = input.facts?.claimLease ?? null;
  const result = input.facts?.result ?? null;
  const replySignal = input.facts?.replySignal ?? null;

  return buildObservabilityWakeCorrelation({
    selector,
    spaceId: consistentObservabilityId(
      input.spaceId,
      getSelectorSpaceId(selector)
    ),
    clientMessageId: consistentClientMessageId(
      dispatch?.sourceClientMessageId,
      coordinatorExecution?.sourceClientMessageId,
      claimLease?.sourceClientMessageId,
      input.clientMessageId,
      getSelectorClientMessageId(selector)
    ),
    sourceSignalId: consistentObservabilityId(
      dispatch?.sourceEventId,
      claimLease?.sourceEventId,
      input.sourceSignalId,
      getSelectorSourceSignalId(selector)
    ),
    targetProfileId: consistentObservabilityId(
      dispatch?.targetProfileId,
      coordinatorExecution?.targetProfileId,
      claimLease?.targetProfileId,
      input.targetProfileId,
      getSelectorTargetProfileId(selector)
    ),
    dispatchId: consistentObservabilityId(
      dispatch?.dispatchId,
      coordinatorExecution?.dispatchId,
      latestAttempt?.dispatchId,
      claimLease?.dispatchId,
      result?.dispatchId,
      input.dispatchId,
      getSelectorDispatchId(selector)
    ),
    latestAttemptId: consistentObservabilityId(
      latestAttempt?.attemptId,
      dispatch?.latestAttemptId,
      input.latestAttemptId
    ),
    runtimeCoordinatorExecutionId: consistentObservabilityId(
      coordinatorExecution?.runtimeCoordinatorExecutionId,
      input.runtimeCoordinatorExecutionId
    ),
    claimLeaseId: consistentObservabilityId(
      claimLease?.claimLeaseId,
      input.claimLeaseId,
      getSelectorClaimLeaseId(selector)
    ),
    bindingId: consistentObservabilityId(
      coordinatorExecution?.bindingId,
      claimLease?.bindingId,
      input.bindingId
    ),
    openMeldServiceRuntimeId: consistentObservabilityId(
      coordinatorExecution?.openMeldServiceRuntimeId,
      claimLease?.openMeldServiceRuntimeId,
      input.openMeldServiceRuntimeId
    ),
    agentControllerRef: consistentObservabilityId(
      coordinatorExecution?.agentControllerRef,
      claimLease?.agentControllerRef,
      input.agentControllerRef
    ),
    resultRef: consistentObservabilityId(result?.resultRef, input.resultRef),
    publishedSignalId: consistentObservabilityId(
      result?.publishedSignalId,
      input.publishedSignalId
    ),
    replySignalId: consistentObservabilityId(
      replySignal?.signalId,
      input.replySignalId
    ),
    cloudflare: projectCloudflareRuntimeEvidence(input.cloudflare),
  });
}

function parseObservabilityWakeTraceSelector(
  value: z.input<typeof observabilityWakeTraceSelectorSchema>
): z.infer<typeof observabilityWakeTraceSelectorSchema> {
  const parsed = observabilityWakeTraceSelectorSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("invalid observability wake trace selector");
  }
  return parsed.data;
}

function getSelectorSpaceId(
  selector: z.infer<typeof observabilityWakeTraceSelectorSchema>
): string | null {
  switch (selector.kind) {
    case "client_message":
    case "dispatch":
    case "source_signal":
      return selector.spaceId;
    case "claim_lease":
      return null;
    default:
      return null;
  }
}

function getSelectorClientMessageId(
  selector: z.infer<typeof observabilityWakeTraceSelectorSchema>
): string | null {
  return selector.kind === "client_message" ? selector.clientMessageId : null;
}

function getSelectorSourceSignalId(
  selector: z.infer<typeof observabilityWakeTraceSelectorSchema>
): string | null {
  return selector.kind === "source_signal" ? selector.sourceSignalId : null;
}

function getSelectorTargetProfileId(
  selector: z.infer<typeof observabilityWakeTraceSelectorSchema>
): string | null {
  switch (selector.kind) {
    case "client_message":
    case "source_signal":
      return selector.targetProfileId;
    case "claim_lease":
    case "dispatch":
      return null;
    default:
      return null;
  }
}

function getSelectorDispatchId(
  selector: z.infer<typeof observabilityWakeTraceSelectorSchema>
): string | null {
  return selector.kind === "dispatch" ? selector.dispatchId : null;
}

function getSelectorClaimLeaseId(
  selector: z.infer<typeof observabilityWakeTraceSelectorSchema>
): string | null {
  return selector.kind === "claim_lease" ? selector.claimLeaseId : null;
}

function consistentObservabilityId(...values: unknown[]): string | null {
  let projected: string | null = null;
  for (const value of values) {
    const normalized = projectOptionalObservabilityId(value);
    if (normalized === null) {
      continue;
    }
    if (projected === null) {
      projected = normalized;
      continue;
    }
    if (projected !== normalized) {
      throw new Error("invalid observability wake correlation evidence");
    }
  }
  return projected;
}

function consistentClientMessageId(...values: unknown[]): string | null {
  let projected: string | null = null;
  for (const value of values) {
    const normalized = projectOptionalClientMessageId(value);
    if (normalized === null) {
      continue;
    }
    if (projected === null) {
      projected = normalized;
      continue;
    }
    if (projected !== normalized) {
      throw new Error("invalid observability wake correlation evidence");
    }
  }
  return projected;
}

function projectCloudflareRuntimeEvidence(
  value: BuildObservabilityWakeCorrelationInput["cloudflare"]
): BuildObservabilityWakeCorrelationInput["cloudflare"] {
  if (value === null || value === undefined) {
    return null;
  }
  return {
    cfRayId: projectOptionalObservabilityId(value.cfRayId),
    requestId: projectOptionalObservabilityId(value.requestId),
    traceId: projectOptionalObservabilityId(value.traceId),
  };
}

function projectOptionalObservabilityId(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = observabilityIdentifierSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("invalid observability wake correlation evidence");
  }
  return parsed.data;
}

function projectOptionalClientMessageId(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = clientMessageIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("invalid observability wake correlation evidence");
  }
  return parsed.data;
}

function normalizeOptionalObservabilityId(value: unknown): string | null {
  const parsed = observabilityIdentifierSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function normalizeOptionalClientMessageId(value: unknown): string | null {
  const parsed = clientMessageIdSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
