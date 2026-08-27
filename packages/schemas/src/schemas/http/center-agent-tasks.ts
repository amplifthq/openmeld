import * as z from "zod/v4";
import { openMeldRequestContextSchema } from "../daemon/profile-identity";
import { CENTER_AGENT_INTERACTION_CLIENT_MAX_CHARS } from "../protocol/center-agent-interaction-source";
import { agentTaskHandleSchema } from "../runtime/agent-task-coordination";
import { messageChannelConversationLocatorSchema } from "../runtime/message-channel";
import { centerAgentToolSpeakerSchema } from "./center-agent-speaker";

export const CENTER_AGENT_TASK_TITLE_MAX_CHARS = 160;
export const CENTER_AGENT_TASK_GOAL_MAX_CHARS = 4000;
export const CENTER_AGENT_TASK_EVENT_TEXT_MAX_CHARS = 4000;
export const CENTER_AGENT_TASK_LIST_DEFAULT_LIMIT = 40;
export const CENTER_AGENT_TASK_LIST_MAX_LIMIT = 100;
export const CENTER_AGENT_TASK_RESPONSE_CONTRACT_VERSION = 3 as const;
export const CENTER_AGENT_TASK_RESPONSE_CONTRACT_VERSION_HEADER =
  "x-openmeld-center-agent-task-response-version";

const identifierSchema = z.string().trim().min(1).max(256);
const idempotencyKeySchema = z.string().trim().min(1).max(512);
const isoDateTimeSchema = z.iso.datetime({ offset: true });
const taskTextSchema = z.string().trim().min(1);

export const centerAgentTaskStatusSchema = z.enum([
  "queued",
  "running",
  "stopping",
  "needs_attention",
  "succeeded",
  "failed",
  "stopped",
]);

export const centerAgentTaskStateSchema = z.enum([
  "active",
  "needs_action",
  "finished",
]);

export const centerAgentTaskPhaseSchema = z.enum([
  "queued",
  "working",
  "stopping",
  "waiting",
]);

export const centerAgentTaskOutcomeSchema = z.enum([
  "completed",
  "failed",
  "stopped",
]);

export const centerAgentTaskResponseContractVersionSchema = z.union([
  z.literal(2),
  z.literal(CENTER_AGENT_TASK_RESPONSE_CONTRACT_VERSION),
]);
export const centerAgentTaskResponseContractVersionHeaderSchema = z.union([
  z.literal("2").transform(() => 2 as const),
  z
    .literal(String(CENTER_AGENT_TASK_RESPONSE_CONTRACT_VERSION))
    .transform(() => CENTER_AGENT_TASK_RESPONSE_CONTRACT_VERSION),
]);

export const centerAgentTaskExecutionEvidenceSchema = z.strictObject({
  attemptGeneration: z.number().int().positive(),
  kind: z.literal("native_delivery"),
  observedAt: isoDateTimeSchema,
});

export function resolveCenterAgentTaskPresentation(
  status: z.infer<typeof centerAgentTaskStatusSchema>,
  executionEvidence: z.infer<
    typeof centerAgentTaskExecutionEvidenceSchema
  > | null = null
): {
  outcome: z.infer<typeof centerAgentTaskOutcomeSchema> | null;
  phase: z.infer<typeof centerAgentTaskPhaseSchema> | null;
  state: z.infer<typeof centerAgentTaskStateSchema>;
} {
  switch (status) {
    case "queued":
      return { outcome: null, phase: "queued", state: "active" };
    case "running":
      return {
        outcome: null,
        phase: executionEvidence ? "working" : null,
        state: "active",
      };
    case "stopping":
      return { outcome: null, phase: "stopping", state: "active" };
    case "needs_attention":
      return { outcome: null, phase: "waiting", state: "needs_action" };
    case "succeeded":
      return { outcome: "completed", phase: null, state: "finished" };
    case "failed":
      return { outcome: "failed", phase: null, state: "finished" };
    case "stopped":
      return { outcome: "stopped", phase: null, state: "finished" };
    default:
      return assertNeverTaskStatus(status);
  }
}

function assertNeverTaskStatus(value: never): never {
  throw new Error(`Unsupported Center Agent Task status: ${String(value)}`);
}

const centerAgentTaskOriginV2Schema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("open_meld") }),
  z.strictObject({
    destination: messageChannelConversationLocatorSchema,
    kind: z.literal("message_channel"),
  }),
]);

export const centerAgentTaskRequesterSchema = z.strictObject({
  displayName: z.string().trim().min(1).max(160),
  profileId: identifierSchema,
  userId: identifierSchema,
});

export const centerAgentTaskLocalAgentSourceSchema = z.strictObject({
  client: z
    .string()
    .trim()
    .min(1)
    .max(CENTER_AGENT_INTERACTION_CLIENT_MAX_CHARS),
  kind: z.literal("local_agent"),
});

export const centerAgentTaskOriginSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("open_meld"),
    localAgent: centerAgentTaskLocalAgentSourceSchema.optional(),
    requestedBy: centerAgentTaskRequesterSchema.optional(),
  }),
  z.strictObject({
    destination: messageChannelConversationLocatorSchema,
    kind: z.literal("message_channel"),
    requestedBy: centerAgentTaskRequesterSchema.optional(),
  }),
]);

/** Frozen response parser for Web and Gateway builds released before v2. */
export const centerAgentTaskResponseV1Schema = z
  .strictObject({
    activeAttemptGeneration: z.number().int().positive().nullable(),
    createdAt: isoDateTimeSchema,
    finishedAt: isoDateTimeSchema.nullable(),
    goal: taskTextSchema.max(CENTER_AGENT_TASK_GOAL_MAX_CHARS),
    id: identifierSchema,
    organizationId: identifierSchema,
    origin: centerAgentTaskOriginV2Schema,
    outcome: centerAgentTaskOutcomeSchema.nullable().optional(),
    phase: centerAgentTaskPhaseSchema.nullable().optional(),
    requesterUserId: identifierSchema.nullable(),
    state: centerAgentTaskStateSchema.optional(),
    status: centerAgentTaskStatusSchema,
    title: taskTextSchema.max(CENTER_AGENT_TASK_TITLE_MAX_CHARS),
    updatedAt: isoDateTimeSchema,
    version: z.number().int().positive(),
  })
  .superRefine((task, context) => {
    const presentation = resolveCenterAgentTaskPresentationV1(task.status);
    for (const field of ["outcome", "phase", "state"] as const) {
      if (task[field] !== undefined && task[field] !== presentation[field]) {
        context.addIssue({
          code: "custom",
          message: `Task ${field} must match its version-one status projection.`,
          path: [field],
        });
      }
    }
    validateCenterAgentTaskLifecycle(task, context);
  })
  .transform((task) => ({
    ...task,
    ...resolveCenterAgentTaskPresentationV1(task.status),
  }));

export const centerAgentTaskResponseV2Schema = z
  .strictObject({
    activeAttemptGeneration: z.number().int().positive().nullable(),
    createdAt: isoDateTimeSchema,
    executionEvidence: centerAgentTaskExecutionEvidenceSchema.optional(),
    finishedAt: isoDateTimeSchema.nullable(),
    goal: taskTextSchema.max(CENTER_AGENT_TASK_GOAL_MAX_CHARS),
    id: identifierSchema,
    organizationId: identifierSchema,
    origin: centerAgentTaskOriginV2Schema,
    outcome: centerAgentTaskOutcomeSchema.nullable().optional(),
    phase: centerAgentTaskPhaseSchema.nullable().optional(),
    requesterUserId: identifierSchema.nullable(),
    state: centerAgentTaskStateSchema.optional(),
    status: centerAgentTaskStatusSchema,
    title: taskTextSchema.max(CENTER_AGENT_TASK_TITLE_MAX_CHARS),
    updatedAt: isoDateTimeSchema,
    version: z.number().int().positive(),
  })
  .superRefine((task, context) => {
    const executionEvidence = task.executionEvidence ?? null;
    const presentation = resolveCenterAgentTaskPresentation(
      task.status,
      executionEvidence
    );
    for (const field of ["outcome", "phase", "state"] as const) {
      if (task[field] !== undefined && task[field] !== presentation[field]) {
        context.addIssue({
          code: "custom",
          message: `Task ${field} must match its canonical status projection.`,
          path: [field],
        });
      }
    }
    validateCenterAgentTaskLifecycle(task, context);
    if (
      executionEvidence &&
      (task.status !== "running" ||
        executionEvidence.attemptGeneration !== task.activeAttemptGeneration)
    ) {
      context.addIssue({
        code: "custom",
        message: "Task executionEvidence must name the active running attempt.",
        path: ["executionEvidence"],
      });
    }
  })
  .transform((task) => ({
    ...task,
    ...resolveCenterAgentTaskPresentation(
      task.status,
      task.executionEvidence ?? null
    ),
  }));

export const centerAgentTaskSchema = z
  .strictObject({
    activeAttemptGeneration: z.number().int().positive().nullable(),
    createdAt: isoDateTimeSchema,
    executionEvidence: centerAgentTaskExecutionEvidenceSchema.optional(),
    finishedAt: isoDateTimeSchema.nullable(),
    goal: taskTextSchema.max(CENTER_AGENT_TASK_GOAL_MAX_CHARS),
    id: identifierSchema,
    organizationId: identifierSchema,
    origin: centerAgentTaskOriginSchema,
    outcome: centerAgentTaskOutcomeSchema.nullable().optional(),
    phase: centerAgentTaskPhaseSchema.nullable().optional(),
    requesterUserId: identifierSchema.nullable(),
    state: centerAgentTaskStateSchema.optional(),
    status: centerAgentTaskStatusSchema,
    title: taskTextSchema.max(CENTER_AGENT_TASK_TITLE_MAX_CHARS),
    updatedAt: isoDateTimeSchema,
    version: z.number().int().positive(),
  })
  .superRefine((task, context) => {
    const executionEvidence = task.executionEvidence ?? null;
    const presentation = resolveCenterAgentTaskPresentation(
      task.status,
      executionEvidence
    );
    for (const field of ["outcome", "phase", "state"] as const) {
      if (task[field] !== undefined && task[field] !== presentation[field]) {
        context.addIssue({
          code: "custom",
          message: `Task ${field} must match its canonical status projection.`,
          path: [field],
        });
      }
    }
    validateCenterAgentTaskLifecycle(task, context);
    if (
      executionEvidence &&
      (task.status !== "running" ||
        executionEvidence.attemptGeneration !== task.activeAttemptGeneration)
    ) {
      context.addIssue({
        code: "custom",
        message: "Task executionEvidence must name the active running attempt.",
        path: ["executionEvidence"],
      });
    }
  })
  .transform((task) => ({
    ...task,
    ...resolveCenterAgentTaskPresentation(
      task.status,
      task.executionEvidence ?? null
    ),
  }));

export const centerAgentTaskAttemptSchema = z
  .strictObject({
    createdAt: isoDateTimeSchema,
    failureCode: z.string().trim().min(1).max(160).nullable(),
    finishedAt: isoDateTimeSchema.nullable(),
    generation: z.number().int().positive(),
    id: identifierSchema,
    startedAt: isoDateTimeSchema.nullable(),
    status: centerAgentTaskStatusSchema,
    taskHandle: agentTaskHandleSchema,
    taskId: identifierSchema,
  })
  .superRefine((attempt, context) => {
    const isQueued = attempt.status === "queued";
    const isTerminal = isCenterAgentTaskTerminalStatus(attempt.status);
    const validTimestamps =
      (isQueued && attempt.startedAt === null && attempt.finishedAt === null) ||
      (!isQueued &&
        attempt.startedAt !== null &&
        (isTerminal
          ? attempt.finishedAt !== null
          : attempt.finishedAt === null));
    if (!validTimestamps) {
      context.addIssue({
        code: "custom",
        message: "Attempt timestamps must match its status.",
        path: ["status"],
      });
    }
    const validFailureCode =
      (attempt.status === "failed" && attempt.failureCode !== null) ||
      (attempt.status !== "failed" && attempt.failureCode === null);
    if (!validFailureCode) {
      context.addIssue({
        code: "custom",
        message: "Attempt failureCode must match its status.",
        path: ["failureCode"],
      });
    }
    if (
      attempt.startedAt !== null &&
      Date.parse(attempt.startedAt) < Date.parse(attempt.createdAt)
    ) {
      context.addIssue({
        code: "custom",
        message: "Attempt startedAt must not be before createdAt.",
        path: ["startedAt"],
      });
    }
    if (
      attempt.startedAt !== null &&
      attempt.finishedAt !== null &&
      Date.parse(attempt.finishedAt) < Date.parse(attempt.startedAt)
    ) {
      context.addIssue({
        code: "custom",
        message: "Attempt finishedAt must not be before startedAt.",
        path: ["finishedAt"],
      });
    }
  });

export const centerAgentTaskEventKindSchema = z.enum([
  "task_created",
  "requester_message",
  "center_agent_update",
  "needs_attention",
  "stop_requested",
  "task_succeeded",
  "task_failed",
  "task_stopped",
]);

export const centerAgentTaskEventActorSchema = z.enum([
  "requester",
  "center_agent",
  "system",
]);

export const centerAgentTaskEventSchema = z.strictObject({
  actor: centerAgentTaskEventActorSchema,
  attemptGeneration: z.number().int().positive().nullable(),
  id: identifierSchema,
  kind: centerAgentTaskEventKindSchema,
  occurredAt: isoDateTimeSchema,
  taskId: identifierSchema,
  text: taskTextSchema.max(CENTER_AGENT_TASK_EVENT_TEXT_MAX_CHARS),
});

export const centerAgentTaskDetailSchema = z.strictObject({
  attempts: z.array(centerAgentTaskAttemptSchema),
  events: z.array(centerAgentTaskEventSchema),
  task: centerAgentTaskSchema,
});

export const centerAgentTaskDetailResponseV1Schema = z.strictObject({
  attempts: z.array(centerAgentTaskAttemptSchema),
  events: z.array(centerAgentTaskEventSchema),
  task: centerAgentTaskResponseV1Schema,
});

export const centerAgentTaskDetailResponseV2Schema = z.strictObject({
  attempts: z.array(centerAgentTaskAttemptSchema),
  events: z.array(centerAgentTaskEventSchema),
  task: centerAgentTaskResponseV2Schema,
});

export const centerAgentCreateTaskToolRpcInputSchema = z.strictObject({
  context: openMeldRequestContextSchema,
  goal: taskTextSchema.max(CENTER_AGENT_TASK_GOAL_MAX_CHARS),
  idempotencyKey: idempotencyKeySchema,
  speakerMember: centerAgentToolSpeakerSchema,
  submissionId: identifierSchema,
  title: taskTextSchema.max(CENTER_AGENT_TASK_TITLE_MAX_CHARS),
});

export const createCenterAgentTaskResponseSchema = z.strictObject({
  task: centerAgentTaskSchema,
});

export const listCenterAgentTasksQuerySchema = z.strictObject({
  cursor: z.string().trim().min(1).max(1024).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(CENTER_AGENT_TASK_LIST_MAX_LIMIT)
    .optional(),
  status: centerAgentTaskStatusSchema.optional(),
});

export const listCenterAgentTasksResponseSchema = z.strictObject({
  nextCursor: z.string().trim().min(1).max(1024).nullable(),
  organizationId: identifierSchema,
  tasks: z.array(centerAgentTaskSchema),
});

export const listCenterAgentTasksResponseV1Schema = z.strictObject({
  nextCursor: z.string().trim().min(1).max(1024).nullable(),
  organizationId: identifierSchema,
  tasks: z.array(centerAgentTaskResponseV1Schema),
});

export const listCenterAgentTasksResponseV2Schema = z.strictObject({
  nextCursor: z.string().trim().min(1).max(1024).nullable(),
  organizationId: identifierSchema,
  tasks: z.array(centerAgentTaskResponseV2Schema),
});

export const centerAgentTaskRouteParamsSchema = z.strictObject({
  taskId: identifierSchema,
});

export const getCenterAgentTaskResponseSchema = centerAgentTaskDetailSchema;
export const getCenterAgentTaskResponseV1Schema =
  centerAgentTaskDetailResponseV1Schema;
export const getCenterAgentTaskResponseV2Schema =
  centerAgentTaskDetailResponseV2Schema;

export const continueCenterAgentTaskBodySchema = z.strictObject({
  expectedVersion: z.number().int().positive(),
  idempotencyKey: idempotencyKeySchema,
  text: taskTextSchema.max(CENTER_AGENT_TASK_EVENT_TEXT_MAX_CHARS),
});

export const stopCenterAgentTaskBodySchema = z.strictObject({
  expectedVersion: z.number().int().positive(),
});

export const retryCenterAgentTaskBodySchema = z.strictObject({
  expectedVersion: z.number().int().positive(),
  idempotencyKey: idempotencyKeySchema,
});

export const listCenterAgentTasksRpcInputSchema =
  listCenterAgentTasksQuerySchema.extend({
    context: openMeldRequestContextSchema,
    responseContractVersion:
      centerAgentTaskResponseContractVersionSchema.optional(),
  });

export const getCenterAgentTaskRpcInputSchema =
  centerAgentTaskRouteParamsSchema.extend({
    context: openMeldRequestContextSchema,
    responseContractVersion:
      centerAgentTaskResponseContractVersionSchema.optional(),
  });

export const continueCenterAgentTaskRpcInputSchema =
  centerAgentTaskRouteParamsSchema
    .extend(continueCenterAgentTaskBodySchema.shape)
    .extend({
      context: openMeldRequestContextSchema,
      responseContractVersion:
        centerAgentTaskResponseContractVersionSchema.optional(),
    });

export const stopCenterAgentTaskRpcInputSchema =
  centerAgentTaskRouteParamsSchema
    .extend(stopCenterAgentTaskBodySchema.shape)
    .extend({
      context: openMeldRequestContextSchema,
      responseContractVersion:
        centerAgentTaskResponseContractVersionSchema.optional(),
    });

export const retryCenterAgentTaskRpcInputSchema =
  centerAgentTaskRouteParamsSchema
    .extend(retryCenterAgentTaskBodySchema.shape)
    .extend({
      context: openMeldRequestContextSchema,
      responseContractVersion:
        centerAgentTaskResponseContractVersionSchema.optional(),
    });

/** Read-only model-visible canonical Task list. Cursor/limit/status semantics
 * match the Gateway `listCenterAgentTasksQuerySchema`; the requester always
 * comes from the verified speaker, never from model text. */
export const centerAgentListTasksToolRpcInputSchema =
  listCenterAgentTasksQuerySchema.extend({
    context: openMeldRequestContextSchema,
    speakerMember: centerAgentToolSpeakerSchema,
  });

export const centerAgentGetTaskToolRpcInputSchema =
  centerAgentTaskRouteParamsSchema.extend({
    context: openMeldRequestContextSchema,
    speakerMember: centerAgentToolSpeakerSchema,
  });

export const mutateCenterAgentTaskResponseSchema = centerAgentTaskDetailSchema;
export const mutateCenterAgentTaskResponseV1Schema =
  centerAgentTaskDetailResponseV1Schema;
export const mutateCenterAgentTaskResponseV2Schema =
  centerAgentTaskDetailResponseV2Schema;

function resolveCenterAgentTaskPresentationV1(
  status: z.infer<typeof centerAgentTaskStatusSchema>
): {
  outcome: z.infer<typeof centerAgentTaskOutcomeSchema> | null;
  phase: z.infer<typeof centerAgentTaskPhaseSchema> | null;
  state: z.infer<typeof centerAgentTaskStateSchema>;
} {
  if (status === "running") {
    return { outcome: null, phase: "working", state: "active" };
  }
  return resolveCenterAgentTaskPresentation(status);
}

function validateCenterAgentTaskLifecycle(
  task: {
    activeAttemptGeneration: number | null;
    createdAt: string;
    finishedAt: string | null;
    status: z.infer<typeof centerAgentTaskStatusSchema>;
    updatedAt: string;
  },
  context: z.RefinementCtx
): void {
  const isTerminal = isCenterAgentTaskTerminalStatus(task.status);
  if (isTerminal !== (task.finishedAt !== null)) {
    context.addIssue({
      code: "custom",
      message: "Task finishedAt must match its terminal status.",
      path: ["finishedAt"],
    });
  }
  if (task.status !== "queued" && task.activeAttemptGeneration === null) {
    context.addIssue({
      code: "custom",
      message: "A non-queued task requires an active attempt generation.",
      path: ["activeAttemptGeneration"],
    });
  }
  if (Date.parse(task.updatedAt) < Date.parse(task.createdAt)) {
    context.addIssue({
      code: "custom",
      message: "Task updatedAt must not be before createdAt.",
      path: ["updatedAt"],
    });
  }
  if (
    task.finishedAt !== null &&
    Date.parse(task.finishedAt) < Date.parse(task.createdAt)
  ) {
    context.addIssue({
      code: "custom",
      message: "Task finishedAt must not be before createdAt.",
      path: ["finishedAt"],
    });
  }
}

export function isCenterAgentTaskTerminalStatus(
  status: z.infer<typeof centerAgentTaskStatusSchema>
): status is "failed" | "stopped" | "succeeded" {
  return status === "failed" || status === "stopped" || status === "succeeded";
}
