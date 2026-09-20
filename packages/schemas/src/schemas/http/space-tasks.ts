import * as z from "zod/v4";
import { openMeldRuntimeProfileIdSchema } from "../protocol/profile";

export const SPACE_TASK_TITLE_MAX_CHARS = 200;
export const SPACE_TASK_DESCRIPTION_MAX_CHARS = 8000;
export const SPACE_TASK_COMPLETION_CONDITION_MAX_CHARS = 500;
export const SPACE_TASK_COMPLETION_CONDITION_MAX_ITEMS = 12;
export const SPACE_TASK_RESULT_SUMMARY_MAX_CHARS = 8000;
export const SPACE_TASK_REVIEW_FEEDBACK_MAX_CHARS = 8000;
export const SPACE_TASK_OPERATION_ID_MAX_CHARS = 200;
export const SPACE_TASK_LIST_MAX_ITEMS = 500;

const optionalTrimmedText = (max: number) =>
  z.union([z.string().trim().min(1).max(max), z.null()]);

export const spaceTaskIdSchema = z
  .string()
  .trim()
  .regex(/^tsk_[0-9a-f-]{36}$/u);

export const spaceTaskPhaseSchema = z.enum([
  "to_do",
  "in_progress",
  "in_review",
  "done",
  "canceled",
]);

export const spaceTaskActorSchema = z.strictObject({
  profileId: openMeldRuntimeProfileIdSchema,
  profileKind: z.enum(["human", "agent"]),
  profileName: z.string().min(1).max(200),
  ownerUserId: z.string().min(1).max(512).nullable(),
});

export const spaceTaskResultSchema = z.strictObject({
  resultRevision: z.number().int().min(1),
  summary: z.string().trim().min(1).max(SPACE_TASK_RESULT_SUMMARY_MAX_CHARS),
  submittedAt: z.string().datetime(),
  submittedBy: spaceTaskActorSchema,
});

export const spaceTaskReviewSchema = z.strictObject({
  decision: z.enum(["accepted", "changes_requested"]),
  feedback: optionalTrimmedText(SPACE_TASK_REVIEW_FEEDBACK_MAX_CHARS),
  resultRevision: z.number().int().min(1),
  reviewedAt: z.string().datetime(),
  reviewedBy: spaceTaskActorSchema,
});

export const spaceTaskEventTypeSchema = z.enum([
  "created",
  "assigned",
  "brief_updated",
  "reviewer_set",
  "marked_in_progress",
  "result_submitted",
  "review_accepted",
  "changes_requested",
  "canceled",
  "reopened",
  "rework_continued",
]);

export const spaceTaskEventSchema = z.strictObject({
  eventId: z
    .string()
    .trim()
    .regex(/^tse_[0-9a-f-]{36}$/u),
  taskId: spaceTaskIdSchema,
  operationId: z.string().trim().min(1).max(SPACE_TASK_OPERATION_ID_MAX_CHARS),
  type: spaceTaskEventTypeSchema,
  actor: spaceTaskActorSchema,
  fromPhase: z.union([spaceTaskPhaseSchema, z.null()]),
  toPhase: spaceTaskPhaseSchema,
  taskRevision: z.number().int().min(1),
  detail: optionalTrimmedText(SPACE_TASK_RESULT_SUMMARY_MAX_CHARS),
  createdAt: z.string().datetime(),
});

export const spaceTaskSchema = z.strictObject({
  taskId: spaceTaskIdSchema,
  spaceId: z.string().trim().min(1).max(512),
  title: z.string().trim().min(1).max(SPACE_TASK_TITLE_MAX_CHARS),
  description: optionalTrimmedText(SPACE_TASK_DESCRIPTION_MAX_CHARS),
  completionConditions: z
    .array(
      z.string().trim().min(1).max(SPACE_TASK_COMPLETION_CONDITION_MAX_CHARS)
    )
    .max(SPACE_TASK_COMPLETION_CONDITION_MAX_ITEMS),
  sourceSignalId: z.string().trim().min(1).max(512).nullable(),
  threadId: z.string().trim().min(1).max(512).nullable(),
  requestedBy: spaceTaskActorSchema,
  createdBy: spaceTaskActorSchema,
  assignee: z.union([spaceTaskActorSchema, z.null()]),
  reviewer: z.union([spaceTaskActorSchema, z.null()]),
  phase: spaceTaskPhaseSchema,
  result: z.union([spaceTaskResultSchema, z.null()]),
  review: z.union([spaceTaskReviewSchema, z.null()]),
  automaticReworkRounds: z.number().int().min(0).max(2),
  needsHumanDecision: z.boolean(),
  revision: z.number().int().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

const operationIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(SPACE_TASK_OPERATION_ID_MAX_CHARS);
const expectedRevisionSchema = z.number().int().min(1);

export const createSpaceTaskBodySchema = z
  .strictObject({
    operationId: operationIdSchema,
    title: spaceTaskSchema.shape.title,
    description: spaceTaskSchema.shape.description.optional(),
    completionConditions: spaceTaskSchema.shape.completionConditions.optional(),
    sourceSignalId: spaceTaskSchema.shape.sourceSignalId.optional(),
    threadId: spaceTaskSchema.shape.threadId.optional(),
    assigneeProfileId: openMeldRuntimeProfileIdSchema.nullable().optional(),
    reviewerProfileId: openMeldRuntimeProfileIdSchema.nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.assigneeProfileId &&
      value.reviewerProfileId === value.assigneeProfileId
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["reviewerProfileId"],
        message: "An independent Reviewer must differ from the assignee",
      });
    }
  });

const taskMutationBase = {
  operationId: operationIdSchema,
  expectedRevision: expectedRevisionSchema,
};

export const mutateSpaceTaskBodySchema = z.discriminatedUnion("action", [
  z.strictObject({
    ...taskMutationBase,
    action: z.literal("assign"),
    assigneeProfileId: openMeldRuntimeProfileIdSchema.nullable(),
  }),
  z.strictObject({
    ...taskMutationBase,
    action: z.literal("update_brief"),
    title: spaceTaskSchema.shape.title.optional(),
    description: spaceTaskSchema.shape.description.optional(),
    completionConditions: spaceTaskSchema.shape.completionConditions.optional(),
  }),
  z.strictObject({
    ...taskMutationBase,
    action: z.literal("set_reviewer"),
    reviewerProfileId: openMeldRuntimeProfileIdSchema.nullable(),
  }),
  z.strictObject({
    ...taskMutationBase,
    action: z.literal("mark_in_progress"),
  }),
  z.strictObject({
    ...taskMutationBase,
    action: z.literal("submit_result"),
    summary: spaceTaskResultSchema.shape.summary,
  }),
  z.strictObject({
    ...taskMutationBase,
    action: z.literal("review"),
    decision: spaceTaskReviewSchema.shape.decision,
    feedback: spaceTaskReviewSchema.shape.feedback.optional(),
  }),
  z.strictObject({
    ...taskMutationBase,
    action: z.literal("cancel"),
    reason: z.string().trim().min(1).max(1000),
  }),
  z.strictObject({
    ...taskMutationBase,
    action: z.literal("reopen"),
    reason: z.string().trim().min(1).max(1000),
  }),
  z.strictObject({
    ...taskMutationBase,
    action: z.literal("continue_rework"),
    reason: z.string().trim().min(1).max(1000),
  }),
]);

export const spaceTaskResponseSchema = z.strictObject({
  task: spaceTaskSchema,
  events: z.array(spaceTaskEventSchema),
});

export const listSpaceTasksQuerySchema = z.strictObject({
  phase: spaceTaskPhaseSchema.optional(),
});

export const listSpaceTasksResponseSchema = z.strictObject({
  tasks: z.array(spaceTaskSchema),
  truncated: z.boolean(),
});

export const spaceTaskMutationReceiptSchema = z.strictObject({
  task: spaceTaskSchema,
  event: spaceTaskEventSchema,
  applied: z.boolean(),
});

export const SPACE_TASK_OPERATION_CONFLICT_ERROR_CODE =
  "space_task.operation_conflict" as const;
export const SPACE_TASK_REVISION_CONFLICT_ERROR_CODE =
  "space_task.revision_conflict" as const;

export const SPACE_TASK_ERROR_CODES = [
  SPACE_TASK_OPERATION_CONFLICT_ERROR_CODE,
  SPACE_TASK_REVISION_CONFLICT_ERROR_CODE,
] as const;

export const spaceTaskErrorCodeSchema = z.enum(SPACE_TASK_ERROR_CODES);
