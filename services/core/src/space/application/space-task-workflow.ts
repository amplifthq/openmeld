import {
  formatSpaceTaskGitHubIssueLabel,
  SPACE_TASK_EXTERNAL_WORK_ITEM_MAX_ITEMS,
  spaceTaskActionSchema,
  spaceTaskExternalWorkItemIdentityKey,
} from "@openmeld/schemas";
import type {
  MutateSpaceTaskBody,
  SpaceTask,
  SpaceTaskAction,
  SpaceTaskActor,
  SpaceTaskEventType,
  SpaceTaskExternalWorkItem,
} from "@openmeld/schemas/types";

export class SpaceTaskWorkflowError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(input: { code: string; message: string; status: number }) {
    super(input.message);
    this.name = "SpaceTaskWorkflowError";
    this.code = input.code;
    this.status = input.status;
  }
}

export type SpaceTaskMutationContext = {
  actor: SpaceTaskActor;
  // Core resolves this from the current Center Agent delivery, never tool input.
  representedRequester?: SpaceTaskActor;
  isSpaceOwner: boolean;
  resolveMember: (profileId: string) => SpaceTaskActor | null;
};

export type SpaceTaskMutationResult = {
  task: SpaceTask;
  eventType: SpaceTaskEventType;
  detail: string | null;
};

const fail = (code: string, message: string, status = 409): never => {
  throw new SpaceTaskWorkflowError({ code, message, status });
};

const sameActor = (actor: SpaceTaskActor | null, profileId: string) =>
  actor?.profileId === profileId;

const requireManager = (
  task: SpaceTask,
  context: SpaceTaskMutationContext
): void => {
  if (
    context.isSpaceOwner ||
    sameActor(task.requestedBy, context.actor.profileId) ||
    sameActor(
      task.requestedBy,
      context.representedRequester?.profileId ?? ""
    ) ||
    sameActor(task.assignee, context.actor.profileId)
  ) {
    return;
  }
  fail(
    "space_task.forbidden",
    "Only the requester, assignee, or a Space owner can change this Task.",
    403
  );
};

export const requireSpaceTaskRequesterOrOwner = (
  task: Pick<SpaceTask, "requestedBy">,
  context: SpaceTaskMutationContext
): void => {
  if (
    context.isSpaceOwner ||
    sameActor(task.requestedBy, context.actor.profileId) ||
    sameActor(task.requestedBy, context.representedRequester?.profileId ?? "")
  ) {
    return;
  }
  fail(
    "space_task.forbidden",
    "Only the requester or a Space owner can make this change.",
    403
  );
};

const requireAssignee = (
  task: SpaceTask,
  context: SpaceTaskMutationContext
): void => {
  if (sameActor(task.assignee, context.actor.profileId)) {
    return;
  }
  fail(
    "space_task.assignee_required",
    "Only the current assignee can advance or submit this Task.",
    403
  );
};

const requireReviewer = (
  task: SpaceTask,
  context: SpaceTaskMutationContext
): void => {
  if (sameActor(task.reviewer, context.actor.profileId)) {
    return;
  }
  if (context.isSpaceOwner && context.actor.profileKind === "human") {
    return;
  }
  fail(
    "space_task.reviewer_required",
    "Only the current reviewer can review this Task.",
    403
  );
};

const requireActiveTask = (task: SpaceTask): void => {
  if (task.phase === "done" || task.phase === "canceled") {
    fail(
      "space_task.reopen_required",
      "Reopen this Task before changing active work."
    );
  }
};

/**
 * The automatic rework boundary bounds Agent-to-Agent cycles: an Agent
 * reviewer handing work back to an Agent assignee without a person in the
 * loop. Both sides must be Agents, so a human reviewer requesting changes
 * (already the human decision) and a human assignee receiving feedback are
 * both outside the budget and return the Task to In progress directly.
 */
const isAutomaticReworkCycle = (
  task: SpaceTask,
  actor: SpaceTaskActor
): boolean =>
  actor.profileKind === "agent" && task.assignee?.profileKind === "agent";

function assertSpaceTaskActionAllowed(
  task: SpaceTask,
  action: SpaceTaskAction,
  context: SpaceTaskMutationContext
): void {
  switch (action) {
    case "assign":
    case "update_brief":
    case "set_projects":
    case "cancel":
    case "attach_external_work_item":
      requireManager(task, context);
      requireActiveTask(task);
      return;
    case "set_reviewer":
      requireSpaceTaskRequesterOrOwner(task, context);
      requireActiveTask(task);
      if (task.phase === "in_review") {
        fail(
          "space_task.review_in_progress",
          "Complete the current review before changing the reviewer."
        );
      }
      return;
    case "mark_in_progress":
      requireAssignee(task, context);
      if (task.phase !== "to_do") {
        fail(
          "space_task.invalid_transition",
          "Only a Task in To do can move to In progress."
        );
      }
      return;
    case "submit_result":
      requireAssignee(task, context);
      if (task.phase !== "in_progress") {
        fail(
          "space_task.invalid_transition",
          "Only a Task in progress can submit a result."
        );
      }
      return;
    case "review":
      requireReviewer(task, context);
      if (task.phase !== "in_review" || !task.result) {
        fail(
          "space_task.invalid_transition",
          "This Task does not have a result awaiting review."
        );
      }
      return;
    case "reopen":
      requireSpaceTaskRequesterOrOwner(task, context);
      if (task.phase !== "done" && task.phase !== "canceled") {
        fail(
          "space_task.invalid_transition",
          "Only a completed or canceled Task can be reopened."
        );
      }
      return;
    case "continue_rework":
      requireSpaceTaskRequesterOrOwner(task, context);
      if (context.actor.profileKind !== "human") {
        fail(
          "space_task.human_decision_required",
          "A human requester or Space owner must authorize more rework.",
          403
        );
      }
      if (task.phase !== "in_review" || !task.needsHumanDecision) {
        fail(
          "space_task.invalid_transition",
          "This Task is not waiting for a human rework decision."
        );
      }
      return;
    case "detach_external_work_item":
    case "detach_linear_external_work_item":
    case "observe_external_work_item":
      requireManager(task, context);
      return;
    default:
      fail("space_task.invalid_action", "Unsupported Task action.", 400);
  }
}

export function projectSpaceTaskAllowedActions(
  task: SpaceTask,
  context: SpaceTaskMutationContext | null
): SpaceTaskAction[] {
  if (!context) {
    return [];
  }
  return spaceTaskActionSchema.options.filter((action) => {
    try {
      assertSpaceTaskActionAllowed(task, action, context);
      return true;
    } catch (error) {
      if (error instanceof SpaceTaskWorkflowError) {
        return false;
      }
      throw error;
    }
  });
}

const resolveMember = (
  context: SpaceTaskMutationContext,
  profileId: string
): SpaceTaskActor => {
  const member = context.resolveMember(profileId);
  if (!member) {
    return fail(
      "space_task.member_required",
      "The selected person or Agent must be an active Space member.",
      400
    );
  }
  return member;
};

const finishMutation = (input: {
  current: SpaceTask;
  next: Omit<SpaceTask, "revision" | "updatedAt">;
  eventType: SpaceTaskEventType;
  detail?: string | null;
  now: string;
}): SpaceTaskMutationResult => ({
  task: {
    ...input.next,
    revision: input.current.revision + 1,
    updatedAt: input.now,
  },
  eventType: input.eventType,
  detail: input.detail ?? null,
});

type SpaceTaskCommand<Action extends MutateSpaceTaskBody["action"]> = Extract<
  MutateSpaceTaskBody,
  { action: Action }
>;

type CommandHandlerInput<Action extends MutateSpaceTaskBody["action"]> = {
  command: SpaceTaskCommand<Action>;
  context: SpaceTaskMutationContext;
  now: string;
  task: SpaceTask;
};

function resolveAssignmentReviewer(
  task: SpaceTask,
  command: SpaceTaskCommand<"assign">,
  context: SpaceTaskMutationContext
): SpaceTaskActor | null {
  if (command.reviewerProfileId === undefined) {
    return task.reviewer;
  }
  if (command.reviewerProfileId !== (task.reviewer?.profileId ?? null)) {
    requireSpaceTaskRequesterOrOwner(task, context);
    if (task.phase === "in_review") {
      fail(
        "space_task.review_in_progress",
        "Complete the current review before changing the reviewer."
      );
    }
  }
  return command.reviewerProfileId
    ? resolveMember(context, command.reviewerProfileId)
    : null;
}

function assignTask({
  command,
  context,
  now,
  task,
}: CommandHandlerInput<"assign">): SpaceTaskMutationResult {
  const assignee = command.assigneeProfileId
    ? resolveMember(context, command.assigneeProfileId)
    : null;
  const reviewer = resolveAssignmentReviewer(task, command, context);
  if (command.wakeAssignee && (!assignee || assignee.profileKind !== "agent")) {
    fail(
      "space_task.agent_assignee_required",
      "Choose an Agent assignee before requesting a Task handoff.",
      400
    );
  }
  if (command.wakeAssignee && task.phase !== "to_do") {
    fail(
      "space_task.invalid_transition",
      "Only a Task in To do can request an initial handoff."
    );
  }
  if (assignee && sameActor(reviewer, assignee.profileId)) {
    fail(
      "space_task.reviewer_must_be_independent",
      "The reviewer must differ from the assignee.",
      400
    );
  }
  const assignmentChanged = task.assignee?.profileId !== assignee?.profileId;
  return finishMutation({
    current: task,
    next: {
      ...task,
      assignee,
      reviewer,
      phase: assignmentChanged && task.phase !== "to_do" ? "to_do" : task.phase,
      result: assignmentChanged ? null : task.result,
      review: assignmentChanged ? null : task.review,
      needsHumanDecision: assignmentChanged ? false : task.needsHumanDecision,
      automaticReworkRounds: assignmentChanged ? 0 : task.automaticReworkRounds,
    },
    eventType: "assigned",
    detail: command.wakeAssignee
      ? `Assigned to ${assignee?.profileName}; handoff requested. Reviewer: ${reviewer?.profileName ?? "None"}.`
      : (assignee?.profileName ?? "Unassigned"),
    now,
  });
}

function updateTaskBrief({
  command,
  now,
  task,
}: CommandHandlerInput<"update_brief">): SpaceTaskMutationResult {
  if (
    command.title === undefined &&
    command.description === undefined &&
    command.completionConditions === undefined
  ) {
    fail(
      "space_task.empty_update",
      "Change at least one part of the Task brief.",
      400
    );
  }
  return finishMutation({
    current: task,
    next: {
      ...task,
      ...(command.title === undefined ? {} : { title: command.title }),
      ...(command.description === undefined
        ? {}
        : { description: command.description }),
      ...(command.completionConditions === undefined
        ? {}
        : { completionConditions: command.completionConditions }),
    },
    eventType: "brief_updated",
    now,
  });
}

function setTaskReviewer({
  command,
  context,
  now,
  task,
}: CommandHandlerInput<"set_reviewer">): SpaceTaskMutationResult {
  const reviewer = command.reviewerProfileId
    ? resolveMember(context, command.reviewerProfileId)
    : null;
  if (reviewer && sameActor(task.assignee, reviewer.profileId)) {
    fail(
      "space_task.reviewer_must_be_independent",
      "The reviewer must differ from the assignee.",
      400
    );
  }
  return finishMutation({
    current: task,
    next: { ...task, reviewer },
    eventType: "reviewer_set",
    detail: reviewer?.profileName ?? "No reviewer",
    now,
  });
}

function markTaskInProgress({
  now,
  task,
}: CommandHandlerInput<"mark_in_progress">): SpaceTaskMutationResult {
  return finishMutation({
    current: task,
    next: { ...task, phase: "in_progress" },
    eventType: "marked_in_progress",
    now,
  });
}

function submitTaskResult({
  command,
  context,
  now,
  task,
}: CommandHandlerInput<"submit_result">): SpaceTaskMutationResult {
  const resultRevision = task.revision + 1;
  return finishMutation({
    current: task,
    next: {
      ...task,
      phase: task.reviewer ? "in_review" : "done",
      result: {
        resultRevision,
        summary: command.summary,
        submittedAt: now,
        submittedBy: context.actor,
      },
      review: null,
      needsHumanDecision: false,
    },
    eventType: "result_submitted",
    detail: command.summary,
    now,
  });
}

function reviewTaskResult({
  command,
  context,
  now,
  task,
}: CommandHandlerInput<"review">): SpaceTaskMutationResult {
  if (
    !sameActor(task.reviewer, context.actor.profileId) &&
    context.isSpaceOwner &&
    !command.feedback
  ) {
    fail(
      "space_task.override_reason_required",
      "A Space owner must explain a review override.",
      400
    );
  }
  if (task.phase !== "in_review" || !task.result) {
    return fail(
      "space_task.invalid_transition",
      "This Task does not have a result awaiting review."
    );
  }
  if (command.expectedResultRevision !== task.result.resultRevision) {
    fail(
      "space_task.result_revision_conflict",
      "The submitted result changed. Read the current result before reviewing it."
    );
  }
  if (command.decision === "changes_requested" && !command.feedback) {
    fail(
      "space_task.feedback_required",
      "Explain what should change before requesting rework.",
      400
    );
  }
  const review = {
    decision: command.decision,
    feedback: command.feedback ?? null,
    resultRevision: task.result.resultRevision,
    reviewedAt: now,
    reviewedBy: context.actor,
  } as const;
  if (command.decision === "accepted") {
    return finishMutation({
      current: task,
      next: { ...task, phase: "done", review, needsHumanDecision: false },
      eventType: "review_accepted",
      detail: command.feedback ?? null,
      now,
    });
  }
  if (!isAutomaticReworkCycle(task, context.actor)) {
    return finishMutation({
      current: task,
      next: {
        ...task,
        phase: "in_progress",
        review,
        needsHumanDecision: false,
      },
      eventType: "changes_requested",
      detail: command.feedback ?? null,
      now,
    });
  }
  const automaticReworkAvailable = task.automaticReworkRounds < 2;
  return finishMutation({
    current: task,
    next: {
      ...task,
      phase: automaticReworkAvailable ? "in_progress" : "in_review",
      review,
      automaticReworkRounds: automaticReworkAvailable
        ? task.automaticReworkRounds + 1
        : task.automaticReworkRounds,
      needsHumanDecision: !automaticReworkAvailable,
    },
    eventType: "changes_requested",
    detail: command.feedback ?? null,
    now,
  });
}

function cancelTask({
  command,
  now,
  task,
}: CommandHandlerInput<"cancel">): SpaceTaskMutationResult {
  return finishMutation({
    current: task,
    next: { ...task, phase: "canceled", needsHumanDecision: false },
    eventType: "canceled",
    detail: command.reason,
    now,
  });
}

function reopenTask({
  command,
  now,
  task,
}: CommandHandlerInput<"reopen">): SpaceTaskMutationResult {
  return finishMutation({
    current: task,
    next: {
      ...task,
      phase: "to_do",
      result: null,
      review: null,
      automaticReworkRounds: 0,
      needsHumanDecision: false,
    },
    eventType: "reopened",
    detail: command.reason,
    now,
  });
}

function matchingExternalWorkItemIndex(
  items: readonly SpaceTaskExternalWorkItem[],
  identity:
    | { number: number; owner: string; provider: "github"; repo: string }
    | { id: string; provider: "linear" }
): number {
  const key = spaceTaskExternalWorkItemIdentityKey(identity);
  return items.findIndex(
    (item) => spaceTaskExternalWorkItemIdentityKey(item) === key
  );
}

function attachExternalWorkItem({
  command,
  now,
  task,
}: CommandHandlerInput<"attach_external_work_item">): SpaceTaskMutationResult {
  const existingIndex = matchingExternalWorkItemIndex(
    task.externalWorkItems,
    command.item
  );
  if (existingIndex >= 0) {
    const nextItems = task.externalWorkItems.map((item, index) =>
      index === existingIndex ? command.item : item
    );
    return finishMutation({
      current: task,
      next: { ...task, externalWorkItems: nextItems },
      eventType: "external_work_item_observed",
      detail: externalWorkItemLabel(command.item),
      now,
    });
  }
  if (
    task.externalWorkItems.length >= SPACE_TASK_EXTERNAL_WORK_ITEM_MAX_ITEMS
  ) {
    fail(
      "space_task.external_work_item_limit",
      `A Task can link at most ${SPACE_TASK_EXTERNAL_WORK_ITEM_MAX_ITEMS} external issues.`,
      400
    );
  }
  return finishMutation({
    current: task,
    next: {
      ...task,
      externalWorkItems: [...task.externalWorkItems, command.item],
    },
    eventType: "external_work_item_attached",
    detail: externalWorkItemLabel(command.item),
    now,
  });
}

function externalWorkItemLabel(item: SpaceTaskExternalWorkItem): string {
  return item.provider === "github"
    ? formatSpaceTaskGitHubIssueLabel(item)
    : item.identifier;
}

function detachLinearExternalWorkItem({
  command,
  now,
  task,
}: CommandHandlerInput<"detach_linear_external_work_item">): SpaceTaskMutationResult {
  const existingIndex = matchingExternalWorkItemIndex(
    task.externalWorkItems,
    command
  );
  if (existingIndex < 0) {
    fail(
      "space_task.external_work_item_not_found",
      "This Task is not linked to that Linear issue.",
      404
    );
  }
  const item = task.externalWorkItems[existingIndex];
  return finishMutation({
    current: task,
    next: {
      ...task,
      externalWorkItems: task.externalWorkItems.filter(
        (_candidate, index) => index !== existingIndex
      ),
    },
    eventType: "external_work_item_detached",
    detail: item?.provider === "linear" ? item.identifier : null,
    now,
  });
}

function detachExternalWorkItem({
  command,
  now,
  task,
}: CommandHandlerInput<"detach_external_work_item">): SpaceTaskMutationResult {
  const existingIndex = matchingExternalWorkItemIndex(
    task.externalWorkItems,
    command
  );
  if (existingIndex < 0) {
    fail(
      "space_task.external_work_item_not_found",
      "This Task is not linked to that GitHub issue.",
      404
    );
  }
  return finishMutation({
    current: task,
    next: {
      ...task,
      externalWorkItems: task.externalWorkItems.filter(
        (_item, index) => index !== existingIndex
      ),
    },
    eventType: "external_work_item_detached",
    detail: formatSpaceTaskGitHubIssueLabel(command),
    now,
  });
}

function observeExternalWorkItem({
  command,
  now,
  task,
}: CommandHandlerInput<"observe_external_work_item">): SpaceTaskMutationResult {
  const existingIndex = matchingExternalWorkItemIndex(
    task.externalWorkItems,
    command
  );
  if (existingIndex < 0) {
    fail(
      "space_task.external_work_item_not_found",
      "This Task is not linked to that GitHub issue.",
      404
    );
  }
  const current = task.externalWorkItems[existingIndex];
  if (!current || current.provider !== "github") {
    return fail(
      "space_task.external_work_item_not_found",
      "This Task is not linked to that GitHub issue.",
      404
    );
  }
  const nextItem: SpaceTaskExternalWorkItem = {
    ...current,
    lastObservedAt: command.lastObservedAt ?? now,
    lastObservedState: command.lastObservedState,
  };
  return finishMutation({
    current: task,
    next: {
      ...task,
      externalWorkItems: task.externalWorkItems.map((item, index) =>
        index === existingIndex ? nextItem : item
      ),
    },
    eventType: "external_work_item_observed",
    detail: formatSpaceTaskGitHubIssueLabel(command),
    now,
  });
}

export function applyGitHubIssueProviderObservation(input: {
  now?: string;
  observedAt: string;
  observedState: SpaceTaskExternalWorkItem["lastObservedState"];
  observedStateReason?: string | null;
  identity: {
    number: number;
    owner: string;
    repo: string;
  };
  task: SpaceTask;
}): {
  observe: SpaceTaskMutationResult | null;
  skipReason: "not_linked" | "stale" | null;
} {
  const existingIndex = matchingExternalWorkItemIndex(
    input.task.externalWorkItems,
    {
      ...input.identity,
      provider: "github",
    }
  );
  if (existingIndex < 0) {
    return { observe: null, skipReason: "not_linked" };
  }
  const current = input.task.externalWorkItems[existingIndex];
  if (!current || current.provider !== "github") {
    return { observe: null, skipReason: "not_linked" };
  }
  if (current.lastObservedAt && current.lastObservedAt > input.observedAt) {
    return { observe: null, skipReason: "stale" };
  }
  const now = input.now ?? input.observedAt;
  const needsObserve =
    current.lastObservedState !== input.observedState ||
    current.lastObservedAt !== input.observedAt;
  const observe = needsObserve
    ? finishMutation({
        current: input.task,
        next: {
          ...input.task,
          externalWorkItems: input.task.externalWorkItems.map((item, index) =>
            index === existingIndex && item.provider === "github"
              ? {
                  ...item,
                  lastObservedAt: input.observedAt,
                  lastObservedState: input.observedState,
                }
              : item
          ),
        },
        eventType: "external_work_item_observed",
        detail: formatSpaceTaskGitHubIssueLabel(current),
        now,
      })
    : null;
  // Provider closure is evidence about that issue, never a Task result or
  // cancellation. Migration, duplication, and implementation are distinct.
  return { observe, skipReason: null };
}

function continueTaskRework({
  command,
  now,
  task,
}: CommandHandlerInput<"continue_rework">): SpaceTaskMutationResult {
  return finishMutation({
    current: task,
    next: { ...task, phase: "in_progress", needsHumanDecision: false },
    eventType: "rework_continued",
    detail: command.reason,
    now,
  });
}

export function mutateSpaceTask(input: {
  task: SpaceTask;
  command: MutateSpaceTaskBody;
  context: SpaceTaskMutationContext;
  now?: string;
}): SpaceTaskMutationResult {
  const { command, context, task } = input;
  if (task.revision !== command.expectedRevision) {
    fail(
      "space_task.revision_conflict",
      `This Task changed from revision ${command.expectedRevision} to ${task.revision}. Refresh it and try again.`
    );
  }
  assertSpaceTaskActionAllowed(task, command.action, context);
  const now = input.now ?? new Date().toISOString();
  switch (command.action) {
    case "assign":
      return assignTask({ command, context, now, task });
    case "update_brief":
      return updateTaskBrief({ command, context, now, task });
    case "set_projects":
      return finishMutation({
        current: task,
        next: { ...task, projectIds: [...command.projectIds].sort() },
        eventType: "projects_set",
        detail: null,
        now,
      });
    case "set_reviewer":
      return setTaskReviewer({ command, context, now, task });
    case "mark_in_progress":
      return markTaskInProgress({ command, context, now, task });
    case "submit_result":
      return submitTaskResult({ command, context, now, task });
    case "review":
      return reviewTaskResult({ command, context, now, task });
    case "cancel":
      return cancelTask({ command, context, now, task });
    case "reopen":
      return reopenTask({ command, context, now, task });
    case "continue_rework":
      return continueTaskRework({ command, context, now, task });
    case "attach_external_work_item":
      return attachExternalWorkItem({ command, context, now, task });
    case "detach_external_work_item":
      return detachExternalWorkItem({ command, context, now, task });
    case "detach_linear_external_work_item":
      return detachLinearExternalWorkItem({ command, context, now, task });
    case "observe_external_work_item":
      return observeExternalWorkItem({ command, context, now, task });
    default:
      return fail("space_task.invalid_action", "Unsupported Task action.", 400);
  }
}
