import {
  createSpaceTaskBodySchema,
  listSpaceTasksResponseSchema,
  mutateSpaceTaskBodySchema,
  SPACE_TASK_LIST_MAX_ITEMS,
  spaceTaskEventSchema,
  spaceTaskMutationReceiptSchema,
  spaceTaskResponseSchema,
  spaceTaskSchema,
} from "@openmeld/schemas";
import type {
  CreateSpaceTaskBody,
  ListSpaceTasksResponse,
  MutateSpaceTaskBody,
  SpaceTask,
  SpaceTaskActor,
  SpaceTaskEvent,
  SpaceTaskMutationReceipt,
  SpaceTaskPhase,
  SpaceTaskResponse,
} from "@openmeld/schemas/types";
import type { SpaceTaskRepository } from "../infrastructure/sql/space-task-repo";
import {
  applyGitHubIssueProviderObservation,
  mutateSpaceTask,
  requireSpaceTaskRequesterOrOwner,
  type SpaceTaskMutationContext,
  SpaceTaskWorkflowError,
} from "./space-task-workflow";

export type ApplyGitHubIssueObservationInput = {
  identity: {
    number: number;
    owner: string;
    repo: string;
  };
  observeOperationId: string;
  observedAt: string;
  observedState: "closed" | "open";
  observedStateReason?: string | null;
  spaceId: string;
  taskId: string;
};

export type ApplyGitHubIssueObservationResult = {
  canceled: boolean;
  observed: boolean;
  skipReason: "not_found" | "not_linked" | "stale" | null;
  task: SpaceTask | null;
};

export type CreateSpaceTaskContext = SpaceTaskMutationContext & {
  requestedBy: SpaceTaskActor;
};

export type SpaceTaskRepositoryPort = Pick<
  SpaceTaskRepository,
  | "appendEvent"
  | "insertTask"
  | "listEvents"
  | "listTasks"
  | "readOperation"
  | "readTask"
  | "recordOperation"
  | "updateTask"
>;

export class SpaceTaskService {
  private readonly input: {
    onMutation?: (
      receipt: SpaceTaskMutationReceipt,
      previous: SpaceTask | null,
      command?: MutateSpaceTaskBody | CreateSpaceTaskBody
    ) => void;
    repository: SpaceTaskRepositoryPort;
    runTransaction: <T>(callback: () => T) => T;
    spaceId: string;
  };

  constructor(input: {
    onMutation?: (
      receipt: SpaceTaskMutationReceipt,
      previous: SpaceTask | null,
      command?: MutateSpaceTaskBody | CreateSpaceTaskBody
    ) => void;
    repository: SpaceTaskRepositoryPort;
    runTransaction: <T>(callback: () => T) => T;
    spaceId: string;
  }) {
    this.input = input;
  }

  list(phase?: SpaceTaskPhase): ListSpaceTasksResponse {
    const tasks = this.input.repository.listTasks(phase);
    return listSpaceTasksResponseSchema.parse({
      tasks: tasks.slice(0, SPACE_TASK_LIST_MAX_ITEMS),
      truncated: tasks.length > SPACE_TASK_LIST_MAX_ITEMS,
    });
  }

  read(taskId: string): SpaceTaskResponse {
    const task = this.input.repository.readTask(taskId);
    if (!task) {
      throw new SpaceTaskWorkflowError({
        code: "space_task.not_found",
        message: "Task not found.",
        status: 404,
      });
    }
    return spaceTaskResponseSchema.parse({
      task,
      events: this.input.repository.listEvents(taskId),
    });
  }

  create(
    unparsedBody: CreateSpaceTaskBody,
    context: CreateSpaceTaskContext
  ): SpaceTaskMutationReceipt {
    const body = createSpaceTaskBodySchema.parse(unparsedBody);
    const requestJson = JSON.stringify({ kind: "create", body });
    const previous = this.readIdempotentReceipt(body.operationId, requestJson);
    if (previous) {
      return previous;
    }
    const assignee = body.assigneeProfileId
      ? this.requireActiveMember(context, body.assigneeProfileId)
      : null;
    const reviewer = body.reviewerProfileId
      ? this.requireActiveMember(context, body.reviewerProfileId)
      : null;
    if (body.wakeAssignee && assignee?.profileKind !== "agent") {
      throw new SpaceTaskWorkflowError({
        code: "space_task.agent_assignee_required",
        message: "Choose an Agent assignee before requesting a Task handoff.",
        status: 400,
      });
    }
    if (assignee && reviewer?.profileId === assignee.profileId) {
      throw new SpaceTaskWorkflowError({
        code: "space_task.reviewer_must_be_independent",
        message: "The reviewer must differ from the assignee.",
        status: 400,
      });
    }
    const now = new Date().toISOString();
    const task = spaceTaskSchema.parse({
      taskId: `tsk_${crypto.randomUUID()}`,
      spaceId: this.input.spaceId,
      title: body.title,
      description: body.description ?? null,
      completionConditions: body.completionConditions ?? [],
      sourceSignalId: body.sourceSignalId ?? null,
      threadId: body.threadId ?? null,
      requestedBy: context.requestedBy,
      createdBy: context.actor,
      assignee,
      reviewer,
      phase: "to_do",
      result: null,
      review: null,
      automaticReworkRounds: 0,
      needsHumanDecision: false,
      externalWorkItems: body.externalWorkItems ?? [],
      projectIds: body.projectIds ?? [],
      revision: 1,
      createdAt: now,
      updatedAt: now,
    });
    if (body.wakeAssignee) {
      requireSpaceTaskRequesterOrOwner(task, context);
    }
    const event = this.buildEvent({
      task,
      operationId: body.operationId,
      type: "created",
      actor: context.actor,
      fromPhase: null,
      detail: task.title,
      representedRequester: context.representedRequester,
    });
    const receipt = spaceTaskMutationReceiptSchema.parse({
      task,
      event,
      applied: true,
    });
    return this.input.runTransaction(() => {
      const concurrent = this.readIdempotentReceipt(
        body.operationId,
        requestJson
      );
      if (concurrent) {
        return concurrent;
      }
      this.input.repository.insertTask(task);
      this.input.repository.appendEvent(event);
      this.input.repository.recordOperation({
        operationId: body.operationId,
        requestJson,
        receipt,
      });
      this.input.onMutation?.(receipt, null, body);
      return receipt;
    });
  }

  mutate(
    taskId: string,
    unparsedBody: MutateSpaceTaskBody,
    context: SpaceTaskMutationContext
  ): SpaceTaskMutationReceipt {
    const body = mutateSpaceTaskBodySchema.parse(unparsedBody);
    const requestJson = JSON.stringify({ kind: "mutate", taskId, body });
    const previous = this.readIdempotentReceipt(body.operationId, requestJson);
    if (previous) {
      return previous;
    }
    return this.input.runTransaction(() => {
      const concurrent = this.readIdempotentReceipt(
        body.operationId,
        requestJson
      );
      if (concurrent) {
        return concurrent;
      }
      const current = this.input.repository.readTask(taskId);
      if (!current) {
        throw new SpaceTaskWorkflowError({
          code: "space_task.not_found",
          message: "Task not found.",
          status: 404,
        });
      }
      const transition = mutateSpaceTask({
        task: current,
        command: body,
        context,
      });
      const event = this.buildEvent({
        task: transition.task,
        operationId: body.operationId,
        type: transition.eventType,
        actor: context.actor,
        fromPhase: current.phase,
        detail: transition.detail,
        representedRequester: context.representedRequester,
      });
      const receipt = spaceTaskMutationReceiptSchema.parse({
        task: transition.task,
        event,
        applied: true,
      });
      this.input.repository.updateTask(transition.task, current.revision);
      this.input.repository.appendEvent(event);
      this.input.repository.recordOperation({
        operationId: body.operationId,
        requestJson,
        receipt,
      });
      this.input.onMutation?.(receipt, current, body);
      return receipt;
    });
  }

  applyGitHubIssueObservation(
    input: Omit<ApplyGitHubIssueObservationInput, "spaceId">
  ): ApplyGitHubIssueObservationResult {
    return this.input.runTransaction(() => {
      const current = this.input.repository.readTask(input.taskId);
      if (!current) {
        return {
          canceled: false,
          observed: false,
          skipReason: "not_found" as const,
          task: null,
        };
      }
      const observeRequestJson = JSON.stringify({
        body: {
          lastObservedAt: input.observedAt,
          lastObservedState: input.observedState,
          stateReason: input.observedStateReason ?? null,
          number: input.identity.number,
          owner: input.identity.owner,
          repo: input.identity.repo,
        },
        kind: "github_issue_observe",
        taskId: input.taskId,
      });
      const previousObserve = this.readIdempotentReceipt(
        input.observeOperationId,
        observeRequestJson
      );
      const planned = applyGitHubIssueProviderObservation({
        identity: input.identity,
        now: new Date().toISOString(),
        observedAt: input.observedAt,
        observedState: input.observedState,
        observedStateReason: input.observedStateReason,
        task: current,
      });
      if (planned.skipReason) {
        return {
          canceled: false,
          observed: false,
          skipReason: planned.skipReason,
          task: current,
        };
      }
      let observedTask = current;
      if (planned.observe && !previousObserve) {
        const event = this.buildEvent({
          actor: { provider: "github" },
          detail: planned.observe.detail,
          fromPhase: current.phase,
          operationId: input.observeOperationId,
          task: planned.observe.task,
          type: planned.observe.eventType,
        });
        const receipt = spaceTaskMutationReceiptSchema.parse({
          applied: true,
          event,
          task: planned.observe.task,
        });
        this.input.repository.updateTask(
          planned.observe.task,
          current.revision
        );
        this.input.repository.appendEvent(event);
        this.input.repository.recordOperation({
          operationId: input.observeOperationId,
          receipt,
          requestJson: observeRequestJson,
        });
        this.input.onMutation?.(receipt, current);
        observedTask = planned.observe.task;
      }

      return {
        canceled: false,
        observed: Boolean(planned.observe || previousObserve),
        skipReason: null,
        task: observedTask,
      };
    });
  }

  private requireActiveMember(
    context: SpaceTaskMutationContext,
    profileId: string
  ): SpaceTaskActor {
    const member = context.resolveMember(profileId);
    if (!member) {
      throw new SpaceTaskWorkflowError({
        code: "space_task.member_required",
        message: "The selected person or Agent must be an active Space member.",
        status: 400,
      });
    }
    return member;
  }

  private readIdempotentReceipt(
    operationId: string,
    requestJson: string
  ): SpaceTaskMutationReceipt | null {
    const previous = this.input.repository.readOperation(operationId);
    if (!previous) {
      return null;
    }
    if (previous.requestJson !== requestJson) {
      throw new SpaceTaskWorkflowError({
        code: "space_task.operation_conflict",
        message: "This operation ID was already used for another Task change.",
        status: 409,
      });
    }
    return spaceTaskMutationReceiptSchema.parse({
      ...previous.receipt,
      applied: false,
    });
  }

  private buildEvent(input: {
    task: SpaceTaskMutationReceipt["task"];
    operationId: string;
    type: SpaceTaskEvent["type"];
    actor: SpaceTaskEvent["actor"];
    fromPhase: SpaceTaskPhase | null;
    detail: string | null;
    representedRequester?: SpaceTaskActor;
  }): SpaceTaskEvent {
    return spaceTaskEventSchema.parse({
      eventId: `tse_${crypto.randomUUID()}`,
      taskId: input.task.taskId,
      operationId: input.operationId,
      type: input.type,
      actor: input.actor,
      fromPhase: input.fromPhase,
      toPhase: input.task.phase,
      taskRevision: input.task.revision,
      detail: input.representedRequester
        ? `On behalf of ${input.representedRequester.profileName} (${input.representedRequester.profileId}).${input.detail ? ` ${input.detail}` : ""}`
        : input.detail,
      createdAt: input.task.updatedAt,
    });
  }
}
