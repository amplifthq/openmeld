import * as z from "zod/v4";
import { openMeldRuntimeProfileIdSchema } from "../protocol/profile";

export const SPACE_TASK_TITLE_MAX_CHARS = 200;
export const SPACE_TASK_DESCRIPTION_MAX_CHARS = 8000;
export const SPACE_TASK_COMPLETION_CONDITION_MAX_CHARS = 500;
export const SPACE_TASK_COMPLETION_CONDITION_MAX_ITEMS = 12;
export const SPACE_TASK_EXTERNAL_WORK_ITEM_MAX_ITEMS = 12;
export const SPACE_TASK_RESULT_SUMMARY_MAX_CHARS = 8000;
export const SPACE_TASK_REVIEW_FEEDBACK_MAX_CHARS = 8000;
export const SPACE_TASK_OPERATION_ID_MAX_CHARS = 512;
export const SPACE_TASK_LIST_MAX_ITEMS = 500;
export const SPACE_TASK_WORKFLOW_CONTRACT_VERSION = 3;
export const SPACE_TASK_PROJECT_MAX_ITEMS = 12;

const spaceTaskProjectIdsSchema = z
  .array(z.string().trim().min(1).max(256))
  .max(SPACE_TASK_PROJECT_MAX_ITEMS)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "A Project can be associated with a Task only once",
  });

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

export const spaceTaskActionSchema = z.enum([
  "assign",
  "update_brief",
  "set_reviewer",
  "mark_in_progress",
  "submit_result",
  "review",
  "cancel",
  "reopen",
  "continue_rework",
  "attach_external_work_item",
  "detach_external_work_item",
  "detach_linear_external_work_item",
  "observe_external_work_item",
  "set_projects",
]);

export const spaceTaskActorSchema = z.strictObject({
  profileId: openMeldRuntimeProfileIdSchema,
  profileKind: z.enum(["human", "agent"]),
  profileName: z.string().min(1).max(200),
  ownerUserId: z.string().min(1).max(512).nullable(),
});

const spaceTaskAttributionSchema = z.union([
  spaceTaskActorSchema,
  z.strictObject({ provider: z.literal("github") }),
]);

/** Private Core-to-Space attribution, recomputed from live native admission. */
export const spaceTaskRequesterRepresentationSchema = z.strictObject({
  representedRequester: spaceTaskActorSchema.optional(),
});

export const spaceTaskResultSchema = z.strictObject({
  resultRevision: z.number().int().min(1),
  summary: z.string().trim().min(1).max(SPACE_TASK_RESULT_SUMMARY_MAX_CHARS),
  submittedAt: z.string().datetime(),
  submittedBy: spaceTaskAttributionSchema,
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
  "external_work_item_attached",
  "external_work_item_detached",
  "external_work_item_observed",
  "projects_set",
]);

export const spaceTaskExternalWorkItemProviderSchema = z.enum([
  "github",
  "linear",
]);

export const spaceTaskExternalWorkItemObservedStateSchema = z.enum([
  "open",
  "closed",
]);

const githubExternalWorkItemSchema = z.strictObject({
  lastObservedAt: z.string().datetime().nullable(),
  lastObservedState: z.union([
    spaceTaskExternalWorkItemObservedStateSchema,
    z.null(),
  ]),
  number: z.number().int().positive(),
  owner: z.string().trim().min(1).max(100),
  provider: z.literal("github"),
  repo: z.string().trim().min(1).max(100),
  url: z.url().max(2048),
});

export const linearExternalWorkItemSchema = z.strictObject({
  id: z.uuid(),
  identifier: z.string().trim().min(1).max(100),
  teamId: z.uuid(),
  projectId: z.uuid().optional(),
  provider: z.literal("linear"),
  url: z.url().max(2048),
  lastObservedAt: z.null(),
  lastObservedState: z.null(),
});

export const spaceTaskExternalWorkItemSchema = z.discriminatedUnion(
  "provider",
  [githubExternalWorkItemSchema, linearExternalWorkItemSchema]
);

export function spaceTaskExternalWorkItemIdentityKey(
  item:
    | { number: number; owner: string; provider: "github"; repo: string }
    | { id: string; provider: "linear" }
): string {
  return item.provider === "linear"
    ? `linear:${item.id}`
    : `github:${item.owner.toLowerCase()}/${item.repo.toLowerCase()}#${item.number}`;
}

export function formatSpaceTaskGitHubIssueLabel(item: {
  number: number;
  owner: string;
  repo: string;
}): string {
  return `${item.owner}/${item.repo}#${item.number}`;
}

export function spaceTaskGitHubIssueOperationId(
  kind:
    | "attach"
    | "cancel"
    | "settle"
    | "start"
    | "create"
    | "observe-closed"
    | "observe-open",
  identity: {
    number: number;
    owner: string;
    repo: string;
  },
  taskId?: string,
  eventIdentity?: string
): string {
  const base = `github-issue-${kind}:${identity.owner.toLowerCase()}:${identity.repo.toLowerCase()}:${identity.number}`;
  const taskOperationId = taskId ? `${base}:${taskId}` : base;
  return eventIdentity
    ? `${taskOperationId}:${eventIdentity}`
    : taskOperationId;
}

export function describeLinkedGitHubIssueClosePrompt(task: {
  externalWorkItems: readonly z.infer<typeof spaceTaskExternalWorkItemSchema>[];
  phase: string;
}): string | null {
  if (task.phase !== "done" && task.phase !== "canceled") {
    return null;
  }
  const openIssues = task.externalWorkItems
    .filter(
      (item): item is Extract<typeof item, { provider: "github" }> =>
        item.provider === "github"
    )
    .filter((item) => item.lastObservedState !== "closed");
  if (openIssues.length === 0) {
    return null;
  }
  const labels = openIssues.map((item) =>
    formatSpaceTaskGitHubIssueLabel(item)
  );
  if (labels.length === 1) {
    return `This Task is linked to GitHub issue ${labels[0]}. Close that issue in GitHub if the work there is finished.`;
  }
  return `This Task is linked to GitHub issues ${labels.join(", ")}. Close those issues in GitHub if the work there is finished.`;
}

export const spaceTaskEventSchema = z.strictObject({
  eventId: z
    .string()
    .trim()
    .regex(/^tse_[0-9a-f-]{36}$/u),
  taskId: spaceTaskIdSchema,
  operationId: z.string().trim().min(1).max(SPACE_TASK_OPERATION_ID_MAX_CHARS),
  type: spaceTaskEventTypeSchema,
  actor: spaceTaskAttributionSchema,
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
  externalWorkItems: z
    .array(spaceTaskExternalWorkItemSchema)
    .max(SPACE_TASK_EXTERNAL_WORK_ITEM_MAX_ITEMS)
    .default([]),
  projectIds: spaceTaskProjectIdsSchema.default([]),
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
    wakeAssignee: z.boolean().optional(),
    externalWorkItems: spaceTaskSchema.shape.externalWorkItems.optional(),
    projectIds: spaceTaskProjectIdsSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.wakeAssignee &&
      (!value.assigneeProfileId || value.reviewerProfileId === undefined)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["wakeAssignee"],
        message:
          "Delegation requires an assignee and an explicit Reviewer decision",
      });
    }
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
    const items = value.externalWorkItems ?? [];
    const seen = new Set<string>();
    for (const [index, item] of items.entries()) {
      const key = spaceTaskExternalWorkItemIdentityKey(item);
      if (seen.has(key)) {
        ctx.addIssue({
          code: "custom",
          path: ["externalWorkItems", index],
          message: "Each external issue can appear only once on a Task",
        });
        continue;
      }
      seen.add(key);
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
    reviewerProfileId: openMeldRuntimeProfileIdSchema.nullable().optional(),
    wakeAssignee: z.boolean().optional(),
  }),
  z.strictObject({
    ...taskMutationBase,
    action: z.literal("set_projects"),
    projectIds: spaceTaskProjectIdsSchema,
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
    expectedResultRevision: z.number().int().min(1),
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
  z.strictObject({
    ...taskMutationBase,
    action: z.literal("attach_external_work_item"),
    item: spaceTaskExternalWorkItemSchema,
  }),
  z.strictObject({
    ...taskMutationBase,
    action: z.literal("detach_external_work_item"),
    number: githubExternalWorkItemSchema.shape.number,
    owner: githubExternalWorkItemSchema.shape.owner,
    provider: z.literal("github"),
    repo: githubExternalWorkItemSchema.shape.repo,
  }),
  z.strictObject({
    ...taskMutationBase,
    action: z.literal("detach_linear_external_work_item"),
    id: linearExternalWorkItemSchema.shape.id,
    provider: z.literal("linear"),
  }),
  z.strictObject({
    ...taskMutationBase,
    action: z.literal("observe_external_work_item"),
    lastObservedAt: z.string().datetime().optional(),
    lastObservedState: spaceTaskExternalWorkItemObservedStateSchema,
    number: githubExternalWorkItemSchema.shape.number,
    owner: githubExternalWorkItemSchema.shape.owner,
    provider: z.literal("github"),
    repo: githubExternalWorkItemSchema.shape.repo,
  }),
]);

export const spaceTaskResponseSchema = z.strictObject({
  task: spaceTaskSchema,
  events: z.array(spaceTaskEventSchema),
  pendingActions: z
    .array(
      z.strictObject({
        kind: z.enum([
          "handoff",
          "completion",
          "stop",
          "github_projection",
          "project_projection",
        ]),
        state: z.enum(["pending", "failed"]),
        error: z.string().nullable(),
      })
    )
    .optional(),
  allowedActions: z.array(spaceTaskActionSchema).optional(),
});

export const listSpaceTasksQuerySchema = z.strictObject({
  phase: spaceTaskPhaseSchema.optional(),
  taskContractVersion: z
    .union([z.literal(2), z.literal(SPACE_TASK_WORKFLOW_CONTRACT_VERSION)])
    .optional(),
});

export const spaceTaskDetailOptionsSchema = z.strictObject({
  includeAffordances: z.boolean().optional(),
  taskContractVersion: z
    .union([z.literal(2), z.literal(SPACE_TASK_WORKFLOW_CONTRACT_VERSION)])
    .optional(),
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
export const SPACE_TASK_RESULT_REVISION_CONFLICT_ERROR_CODE =
  "space_task.result_revision_conflict" as const;
export const SPACE_TASK_EXTERNAL_WORK_ITEM_LIMIT_ERROR_CODE =
  "space_task.external_work_item_limit" as const;
export const SPACE_TASK_EXTERNAL_WORK_ITEM_NOT_FOUND_ERROR_CODE =
  "space_task.external_work_item_not_found" as const;
export const SPACE_TASK_CONTRACT_UPDATE_REQUIRED_ERROR_CODE =
  "space_task.contract_update_required" as const;

export const SPACE_TASK_ERROR_CODES = [
  SPACE_TASK_OPERATION_CONFLICT_ERROR_CODE,
  SPACE_TASK_REVISION_CONFLICT_ERROR_CODE,
  SPACE_TASK_RESULT_REVISION_CONFLICT_ERROR_CODE,
  SPACE_TASK_EXTERNAL_WORK_ITEM_LIMIT_ERROR_CODE,
  SPACE_TASK_EXTERNAL_WORK_ITEM_NOT_FOUND_ERROR_CODE,
  SPACE_TASK_CONTRACT_UPDATE_REQUIRED_ERROR_CODE,
] as const;

export const spaceTaskErrorCodeSchema = z.enum(SPACE_TASK_ERROR_CODES);
