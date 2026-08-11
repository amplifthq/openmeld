import { z } from "zod/v4";
import { agentControllerRefSchema } from "../daemon/agent-controller-ref";
import { MAX_TEXT_LENGTH } from "../protocol/constants";
import { agentProfileIdSchema } from "../protocol/profile";
import { spaceThreadContextSchema } from "../space-mesh/space-thread";

export const AGENT_TASK_COORDINATION_SCHEMA_VERSION = 1 as const;

const nonEmptyIdSchema = z.string().trim().min(1).max(512);
const boundedAgentControllerRefSchema = agentControllerRefSchema.pipe(
  z.string().max(512)
);
const nullableNonEmptyIdSchema = z.union([nonEmptyIdSchema, z.null()]);
const nullableReasonCodeSchema = z.union([
  z.string().trim().min(1).max(160),
  z.null(),
]);

const agentTaskHandleBaseShape = {
  v: z.literal(AGENT_TASK_COORDINATION_SCHEMA_VERSION),
};

export const spaceWakeAgentTaskHandleSchema = z.strictObject({
  ...agentTaskHandleBaseShape,
  kind: z.literal("space_wake"),
  sourceClientMessageId: nonEmptyIdSchema,
  spaceId: nonEmptyIdSchema,
  targetProfileId: agentProfileIdSchema,
});

export const controllerAgentTaskHandleSchema = z.strictObject({
  ...agentTaskHandleBaseShape,
  agentControllerRef: boundedAgentControllerRefSchema,
  hostId: nonEmptyIdSchema,
  kind: z.literal("controller_task"),
  taskId: nonEmptyIdSchema,
});

export const agentTaskHandleSchema = z.discriminatedUnion("kind", [
  spaceWakeAgentTaskHandleSchema,
  z.strictObject({
    ...agentTaskHandleBaseShape,
    deliveryId: nonEmptyIdSchema,
    kind: z.literal("native_delivery"),
  }),
  controllerAgentTaskHandleSchema,
]);

export const agentTaskTerminalStatusSchema = z.enum([
  "succeeded",
  "completed",
  "failed",
  "stopped",
  "stayed_silent",
  "publication_failed",
]);

export const agentTaskTerminalOutcomeSchema = z.strictObject({
  errorCode: nullableReasonCodeSchema,
  eventId: nonEmptyIdSchema,
  occurredAtMs: z.number().int().nonnegative(),
  publishedSignalId: nullableNonEmptyIdSchema,
  status: agentTaskTerminalStatusSchema,
});

export function areAgentTaskTerminalOutcomesEqual(
  left: z.infer<typeof agentTaskTerminalOutcomeSchema>,
  right: z.infer<typeof agentTaskTerminalOutcomeSchema>
): boolean {
  return (
    left.errorCode === right.errorCode &&
    left.eventId === right.eventId &&
    left.occurredAtMs === right.occurredAtMs &&
    left.publishedSignalId === right.publishedSignalId &&
    left.status === right.status
  );
}

export const agentTaskNeedsAttentionObservationSchema = z.strictObject({
  attentionCode: nullableReasonCodeSchema,
  eventId: nonEmptyIdSchema,
  occurredAtMs: z.number().int().nonnegative(),
  status: z.literal("needs_attention"),
});

export const agentTaskCompletionObservationSchema = z.union([
  agentTaskTerminalOutcomeSchema,
  agentTaskNeedsAttentionObservationSchema,
]);

export const agentTaskCompletionConditionSchema = z.enum([
  "terminal",
  "succeeded",
  "failed",
  "needs_attention",
]);

export const agentDelegationBarrierSchema = z.enum([
  "all_terminal",
  "first_success",
  "on_failure",
  "on_each_terminal",
]);

const legacyAgentTaskContinuationDestinationShape = {
  sourceSignalId: nonEmptyIdSchema,
  spaceId: nonEmptyIdSchema,
  threadContext: z.union([spaceThreadContextSchema, z.null()]),
};

const resumeAgentContinuationShape = {
  delegationId: nonEmptyIdSchema,
  instruction: z.string().trim().min(1).max(4000),
  kind: z.literal("resume_agent"),
};

const resumeTaskWatchContinuationShape = {
  instruction: z.string().trim().min(1).max(4000),
  kind: z.literal("resume_task_watch"),
  watchId: nonEmptyIdSchema,
};

export const agentTaskContinuationSchema = z.union([
  z.strictObject(resumeAgentContinuationShape),
  z.strictObject({
    ...resumeAgentContinuationShape,
    ...legacyAgentTaskContinuationDestinationShape,
  }),
  z.strictObject({
    agentProfileId: agentProfileIdSchema,
    delegationId: nonEmptyIdSchema,
    kind: z.literal("activate_fallback"),
    spaceId: nonEmptyIdSchema,
    text: z.string().trim().min(1).max(MAX_TEXT_LENGTH),
  }),
  z.strictObject(resumeTaskWatchContinuationShape),
  z.strictObject({
    ...resumeTaskWatchContinuationShape,
    ...legacyAgentTaskContinuationDestinationShape,
  }),
]);

export const agentDelegationCompletionPolicySchema = z.discriminatedUnion(
  "mode",
  [
    z.strictObject({
      mode: z.literal("child_reports_directly"),
    }),
    z.strictObject({
      mode: z.literal("resume_parent"),
      when: agentDelegationBarrierSchema,
    }),
  ]
);

export const agentDelegationChildSnapshotSchema = z.strictObject({
  agentProfileId: agentProfileIdSchema,
  role: z.enum(["primary", "fallback"]),
  state: z.enum(["planned", "active", "terminal", "skipped", "cancelled"]),
  task: agentTaskHandleSchema,
  terminalOutcome: z.union([agentTaskTerminalOutcomeSchema, z.null()]),
});

export const agentDelegationSnapshotSchema = z.strictObject({
  barrier: z.union([agentDelegationBarrierSchema, z.null()]),
  children: z.array(agentDelegationChildSnapshotSchema).min(1).max(26),
  delegationId: nonEmptyIdSchema,
  generation: z.number().int().positive(),
});

export function buildAgentTaskKey(
  handleInput: z.input<typeof agentTaskHandleSchema>
): string {
  const handle = agentTaskHandleSchema.parse(handleInput);
  switch (handle.kind) {
    case "space_wake":
      return [
        handle.kind,
        handle.spaceId,
        handle.sourceClientMessageId,
        handle.targetProfileId,
      ]
        .map(encodeURIComponent)
        .join(":");
    case "native_delivery":
      return [handle.kind, handle.deliveryId].map(encodeURIComponent).join(":");
    case "controller_task":
      return [
        handle.kind,
        handle.agentControllerRef,
        handle.hostId,
        handle.taskId,
      ]
        .map(encodeURIComponent)
        .join(":");
    default:
      return assertNever(handle);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported Agent Task Handle: ${String(value)}`);
}
