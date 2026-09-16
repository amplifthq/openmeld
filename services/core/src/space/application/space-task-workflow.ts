import type {
  MutateSpaceTaskBody,
  SpaceTask,
  SpaceTaskActor,
  SpaceTaskEventType,
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

const requireRequesterOrOwner = (
  task: SpaceTask,
  context: SpaceTaskMutationContext
): void => {
  if (
    context.isSpaceOwner ||
    sameActor(task.requestedBy, context.actor.profileId)
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
const isAutomaticReworkCycle = (task: SpaceTask): boolean =>
  task.reviewer?.profileKind === "agent" &&
  task.assignee?.profileKind === "agent";

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

function assignTask({
  command,
  context,
  now,
  task,
}: CommandHandlerInput<"assign">): SpaceTaskMutationResult {
  requireManager(task, context);
  requireActiveTask(task);
  const assignee = command.assigneeProfileId
    ? resolveMember(context, command.assigneeProfileId)
    : null;
  if (assignee && sameActor(task.reviewer, assignee.profileId)) {
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
      phase: assignmentChanged && task.phase !== "to_do" ? "to_do" : task.phase,
      result: assignmentChanged ? null : task.result,
      review: assignmentChanged ? null : task.review,
      needsHumanDecision: assignmentChanged ? false : task.needsHumanDecision,
      automaticReworkRounds: assignmentChanged ? 0 : task.automaticReworkRounds,
    },
    eventType: "assigned",
    detail: assignee?.profileName ?? "Unassigned",
    now,
  });
}

function updateTaskBrief({
  command,
  context,
  now,
  task,
}: CommandHandlerInput<"update_brief">): SpaceTaskMutationResult {
  requireManager(task, context);
  requireActiveTask(task);
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
  requireRequesterOrOwner(task, context);
  requireActiveTask(task);
  if (task.phase === "in_review") {
    fail(
      "space_task.review_in_progress",
      "Complete the current review before changing the reviewer."
    );
  }
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
  context,
  now,
  task,
}: CommandHandlerInput<"mark_in_progress">): SpaceTaskMutationResult {
  requireAssignee(task, context);
  if (task.phase !== "to_do") {
    fail(
      "space_task.invalid_transition",
      "Only a Task in To do can move to In progress."
    );
  }
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
  requireAssignee(task, context);
  if (task.phase !== "in_progress") {
    fail(
      "space_task.invalid_transition",
      "Only a Task in progress can submit a result."
    );
  }
  const resultRevision = (task.result?.resultRevision ?? 0) + 1;
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
  requireReviewer(task, context);
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
  if (!isAutomaticReworkCycle(task)) {
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
  context,
  now,
  task,
}: CommandHandlerInput<"cancel">): SpaceTaskMutationResult {
  requireManager(task, context);
  requireActiveTask(task);
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
  context,
  now,
  task,
}: CommandHandlerInput<"reopen">): SpaceTaskMutationResult {
  requireRequesterOrOwner(task, context);
  if (task.phase !== "done" && task.phase !== "canceled") {
    fail(
      "space_task.invalid_transition",
      "Only a completed or canceled Task can be reopened."
    );
  }
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

function continueTaskRework({
  command,
  context,
  now,
  task,
}: CommandHandlerInput<"continue_rework">): SpaceTaskMutationResult {
  requireRequesterOrOwner(task, context);
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
  const now = input.now ?? new Date().toISOString();
  switch (command.action) {
    case "assign":
      return assignTask({ command, context, now, task });
    case "update_brief":
      return updateTaskBrief({ command, context, now, task });
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
    default:
      return fail("space_task.invalid_action", "Unsupported Task action.", 400);
  }
}
