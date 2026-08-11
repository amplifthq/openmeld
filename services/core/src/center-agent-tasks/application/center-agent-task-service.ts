import {
  CENTER_AGENT_TASK_LIST_DEFAULT_LIMIT,
  CENTER_AGENT_TASK_LIST_MAX_LIMIT,
  centerAgentTaskSchema,
} from "@openmeld/schemas";
import type {
  CenterAgentTask,
  CenterAgentTaskAttempt,
  CenterAgentTaskDetail,
  CenterAgentTaskExecutionEvidence,
  CenterAgentTaskOrigin,
  CenterAgentTaskStatus,
  ListCenterAgentTasksResponse,
} from "@openmeld/schemas/types";
import {
  appendCenterAgentTaskEvent,
  buildCenterAgentTaskReplacementStopIdempotencyKey,
  CenterAgentTaskAttemptConflictError,
  CenterAgentTaskConflictError,
  CenterAgentTaskEventConflictError,
  CenterAgentTaskNotFoundError,
  CenterAgentTaskVersionConflictError,
  createCenterAgentTaskWithInitialAttempt,
  listCenterAgentTaskAttempts,
  listCenterAgentTaskEvents,
  listCenterAgentTasksByRequesterUserId,
  listPendingCenterAgentTaskAdmissions,
  listRunningCenterAgentTaskAttempts,
  listStoppingCenterAgentTaskAttempts,
  projectCenterAgentTaskAttemptEvent,
  readCenterAgentTask,
  readCenterAgentTaskAdmissionOutbox,
  readCenterAgentTaskPendingReplacement,
  recordCenterAgentTaskAdmissionAttempt,
  requestCenterAgentTaskStop,
  settleCenterAgentTaskAdmission,
  startCenterAgentTaskAttempt,
  transitionCenterAgentTaskAttempt,
} from "../infrastructure/d1/center-agent-task-repo";
import {
  projectCenterAgentTaskInboxItem,
  resolveCenterAgentTaskNeedsAttentionInboxItem,
} from "./center-agent-task-inbox-producer";
import { projectCenterAgentTaskTerminal } from "./center-agent-task-terminal-projector";

const BASE64_URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const BASE64_PADDING_PATTERN = /=+$/u;
export const CENTER_AGENT_TASK_STOP_CONFIRMATION_TIMEOUT_MS = 5 * 60_000;
const CENTER_AGENT_TASK_RECOVERY_LIMIT = 50;
const CENTER_AGENT_TASK_STOP_CONFIRMATION_TIMEOUT_FAILURE_CODE =
  "center_agent_task.stop_confirmation_timeout";
const CENTER_AGENT_TASK_STOP_CONFIRMATION_TIMEOUT_TEXT =
  "Task could not confirm that its previous work stopped. Open diagnostics with code center_agent_task.stop_confirmation_timeout, then try Stop again.";

type CenterAgentTaskListCursor = {
  id: string;
  updatedAtMs: number;
};

type TaskMutationAuthority = {
  organizationId: string;
  requesterUserId: string;
  taskId: string;
};

type StartAttemptInput = TaskMutationAuthority & {
  event?: {
    actor: "center_agent" | "requester" | "system";
    attemptGeneration: number | null;
    idempotencyKey: string;
    kind:
      | "center_agent_update"
      | "needs_attention"
      | "requester_message"
      | "stop_requested"
      | "task_created"
      | "task_failed"
      | "task_stopped"
      | "task_succeeded";
    observedAtMs: number;
    occurredAtMs: number;
    text: string;
  };
  instruction: string;
  operationIdempotencyKey: string;
  parent: CenterAgentTaskParentDeliveryRef;
  replacedAttemptGeneration?: number;
  taskEventId: string;
};

export type CenterAgentTaskParentDeliveryRef =
  | { deliveryId: string; kind: "delivery" }
  | { kind: "submission"; submissionId: string };

export type CenterAgentTaskRuntimePort = {
  authorizeTurn(input: {
    organizationId: string;
    parent: CenterAgentTaskParentDeliveryRef;
    requesterUserId: string;
  }): Promise<void>;
  resolveDeliveryParent(input: {
    deliveryId: string;
    organizationId: string;
    requesterUserId: string;
  }): Promise<CenterAgentTaskParentDeliveryRef>;
  resolveExecutionEvidence(input: {
    attempts: readonly {
      attemptGeneration: number;
      deliveryId: string;
      taskId: string;
    }[];
    nowMs: number;
    organizationId: string;
    requesterUserId: string;
  }): Promise<
    readonly (CenterAgentTaskExecutionEvidence & { taskId: string })[]
  >;
  resolveParent(input: { parentSubmissionId: string }): Promise<{
    organizationId: string;
    origin: CenterAgentTaskOrigin;
    requesterUserId: string;
  }>;
  stopDelivery(input: {
    deliveryId: string;
    organizationId: string;
    requesterUserId: string;
  }): Promise<
    "already_terminal" | "not_stoppable" | "stop_requested" | "stopped"
  >;
  submitTurn(input: {
    deliveryId: string;
    idempotencyKey: string;
    instruction: string;
    nowMs: number;
    organizationId: string;
    parent: CenterAgentTaskParentDeliveryRef;
    requesterUserId: string;
    taskEventId: string;
    taskId: string;
  }): Promise<
    | { outcome: "accepted" | "unknown" }
    | {
        failureCode: string;
        failureDetail: string;
        outcome: "rejected";
      }
  >;
};

export class CenterAgentTaskApplicationError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(input: { code: string; message: string; status: number }) {
    super(input.message);
    this.name = "CenterAgentTaskApplicationError";
    this.code = input.code;
    this.status = input.status;
  }
}

class CenterAgentTaskAdmissionRejectedError extends CenterAgentTaskApplicationError {}

export function createCenterAgentTaskService(input: {
  db: D1Database;
  inboxDb?: D1Database;
  now?: () => number;
  runtime: CenterAgentTaskRuntimePort;
}) {
  const now = input.now ?? Date.now;

  const canonicalService = {
    async continue(command: {
      expectedVersion: number;
      idempotencyKey: string;
      organizationId: string;
      requesterUserId: string;
      taskId: string;
      text: string;
    }): Promise<CenterAgentTaskDetail> {
      return await mapRepositoryErrors(async () => {
        const eventId = await buildStableId("event", [
          "continue",
          command.organizationId,
          command.taskId,
          command.idempotencyKey,
        ]);
        const existingDetail = await requireRequesterTaskDetail(
          input.db,
          command
        );
        const existingEvent = existingDetail.events.find(
          (event) => event.id === eventId
        );
        if (existingEvent) {
          requireAcceptedEventReplay(existingEvent, {
            actor: "requester",
            kind: "requester_message",
            text: command.text,
          });
          await resolveAcceptedNeedsAttention({
            detail: existingDetail,
            inboxDb: input.inboxDb ?? input.db,
            requesterEventId: existingEvent.id,
            resolvedAtMs: now(),
          });
          return existingDetail;
        }
        requireTaskVersion(existingDetail.task, command.expectedVersion);
        requireStatus(existingDetail.task, [
          "needs_attention",
          "queued",
          "running",
          "succeeded",
        ]);
        const parent = await resolveContinuationParent({
          detail: existingDetail,
          operationIdempotencyKey: command.idempotencyKey,
          organizationId: command.organizationId,
          requesterUserId: command.requesterUserId,
          runtime: input.runtime,
          taskId: command.taskId,
        });
        await input.runtime.authorizeTurn({
          organizationId: command.organizationId,
          parent,
          requesterUserId: command.requesterUserId,
        });

        if (existingDetail.task.status === "succeeded") {
          const occurredAtMs = now();
          return await startAttempt({
            db: input.db,
            expectedTaskVersion: command.expectedVersion,
            inboxDb: input.inboxDb ?? input.db,
            input: {
              event: {
                actor: "requester",
                attemptGeneration: null,
                idempotencyKey: command.idempotencyKey,
                kind: "requester_message",
                observedAtMs: occurredAtMs,
                occurredAtMs,
                text: command.text,
              },
              instruction: command.text,
              operationIdempotencyKey: command.idempotencyKey,
              organizationId: command.organizationId,
              parent,
              requesterUserId: command.requesterUserId,
              taskEventId: eventId,
              taskId: command.taskId,
            },
            now,
            runtime: input.runtime,
          });
        }

        if (
          existingDetail.task.status === "queued" ||
          existingDetail.task.status === "running"
        ) {
          return await requestActiveInstructionReplacement({
            command,
            db: input.db,
            detail: existingDetail,
            eventId,
            inboxDb: input.inboxDb ?? input.db,
            now,
            parent,
            runtime: input.runtime,
          });
        }

        return await requestActiveInstructionReplacement({
          command,
          db: input.db,
          detail: existingDetail,
          eventId,
          inboxDb: input.inboxDb ?? input.db,
          now,
          parent,
          runtime: input.runtime,
        });
      });
    },

    async create(command: {
      goal: string;
      idempotencyKey: string;
      organizationId: string;
      parentSubmissionId: string;
      requesterUserId: string;
      title: string;
    }): Promise<CenterAgentTaskDetail> {
      return await mapRepositoryErrors(async () => {
        const taskId = await buildStableId("task", [
          command.organizationId,
          command.requesterUserId,
          command.idempotencyKey,
        ]);
        const taskEventId = await buildStableId("event", [
          "create",
          command.organizationId,
          command.requesterUserId,
          command.idempotencyKey,
        ]);
        const attemptId = await buildAttemptId({
          operationIdempotencyKey: command.idempotencyKey,
          organizationId: command.organizationId,
          taskId,
        });
        const deliveryId = await buildStableId("delivery", [
          command.organizationId,
          taskId,
          command.idempotencyKey,
        ]);
        const submissionParent = {
          kind: "submission" as const,
          submissionId: command.parentSubmissionId,
        };
        const accepted = await readCenterAgentTask({
          db: input.db,
          organizationId: command.organizationId,
          taskId,
        });
        if (accepted) {
          const detail = await requireRequesterTaskDetail(input.db, {
            organizationId: command.organizationId,
            requesterUserId: command.requesterUserId,
            taskId,
          });
          await requireAcceptedTaskCreationReplay({
            admission: {
              deliveryId,
              instruction: command.goal,
              operationIdempotencyKey: command.idempotencyKey,
              organizationId: command.organizationId,
              parent: submissionParent,
              requesterUserId: command.requesterUserId,
              taskEventId,
              taskId,
            },
            attemptId,
            db: input.db,
            detail,
            event: {
              actor: "requester",
              kind: "task_created",
              text: command.goal,
            },
            goal: command.goal,
            title: command.title,
          });
          return detail;
        }
        const parent = await input.runtime.resolveParent({
          parentSubmissionId: command.parentSubmissionId,
        });
        if (
          parent.organizationId !== command.organizationId ||
          parent.requesterUserId !== command.requesterUserId
        ) {
          throw new CenterAgentTaskApplicationError({
            code: "center_agent_task.source_delivery_mismatch",
            message:
              "The source Center Agent delivery does not match this Organization member.",
            status: 403,
          });
        }
        await input.runtime.authorizeTurn({
          organizationId: command.organizationId,
          parent: submissionParent,
          requesterUserId: command.requesterUserId,
        });
        const startedAtMs = now();
        const created = await createCenterAgentTaskWithInitialAttempt({
          admission: {
            deliveryId,
            instruction: command.goal,
            operationIdempotencyKey: command.idempotencyKey,
            parent: submissionParent,
            requesterUserId: command.requesterUserId,
            taskEventId,
          },
          attemptId,
          attemptIdempotencyKey: `attempt:${command.idempotencyKey}`,
          db: input.db,
          event: {
            actor: "requester",
            attemptGeneration: null,
            eventId: taskEventId,
            idempotencyKey: `create:${command.idempotencyKey}`,
            kind: "task_created",
            observedAtMs: startedAtMs,
            occurredAtMs: startedAtMs,
            text: command.goal,
          },
          goal: command.goal,
          nowMs: startedAtMs,
          organizationId: command.organizationId,
          origin: parent.origin,
          requesterUserId: command.requesterUserId,
          taskHandle: { deliveryId, kind: "native_delivery", v: 1 },
          taskId,
          taskIdempotencyKey: await buildStableId("create", [
            command.organizationId,
            command.requesterUserId,
            command.idempotencyKey,
          ]),
          title: command.title,
        });
        if (created.outcome === "replay") {
          return await requireRequesterTaskDetail(input.db, {
            organizationId: command.organizationId,
            requesterUserId: command.requesterUserId,
            taskId,
          });
        }
        return await submitQueuedCenterAgentTaskAttempt({
          admission: {
            attemptGeneration: created.attempt.generation,
            deliveryId,
            instruction: command.goal,
            operationIdempotencyKey: command.idempotencyKey,
            organizationId: command.organizationId,
            parent: submissionParent,
            requesterUserId: command.requesterUserId,
            taskEventId,
            taskId,
          },
          db: input.db,
          inboxDb: input.inboxDb ?? input.db,
          now,
          runtime: input.runtime,
        });
      });
    },

    async get(query: TaskMutationAuthority): Promise<CenterAgentTaskDetail> {
      return await mapRepositoryErrors(async () =>
        requireRequesterTaskDetail(input.db, query)
      );
    },

    async list(query: {
      cursor?: string;
      limit?: number;
      organizationId: string;
      requesterUserId: string;
      status?: CenterAgentTaskStatus;
    }): Promise<ListCenterAgentTasksResponse> {
      return await mapRepositoryErrors(async () => {
        const limit = normalizeListLimit(query.limit);
        const cursor = decodeListCursor(query.cursor);
        const tasks = await listCenterAgentTasksByRequesterUserId({
          ...(cursor ? { cursor } : {}),
          db: input.db,
          limit: limit + 1,
          organizationId: query.organizationId,
          requesterUserId: query.requesterUserId,
          ...(query.status ? { status: query.status } : {}),
        });
        const page = tasks.slice(0, limit);
        const lastTask = page.at(-1);
        return {
          nextCursor:
            tasks.length > limit && lastTask
              ? encodeListCursor({
                  id: lastTask.id,
                  updatedAtMs: Date.parse(lastTask.updatedAt),
                })
              : null,
          organizationId: query.organizationId,
          tasks: page,
        };
      });
    },

    async retry(command: {
      expectedVersion: number;
      idempotencyKey: string;
      organizationId: string;
      requesterUserId: string;
      taskId: string;
    }): Promise<CenterAgentTaskDetail> {
      return await mapRepositoryErrors(async () => {
        const eventId = await buildStableId("event", [
          "retry",
          command.organizationId,
          command.taskId,
          command.idempotencyKey,
        ]);
        const detail = await requireRequesterTaskDetail(input.db, command);
        const existingEvent = detail.events.find(
          (event) => event.id === eventId
        );
        const instruction = readLatestRequesterInstruction(detail);
        if (existingEvent) {
          requireAcceptedEventReplay(existingEvent, {
            actor: "requester",
            kind: "center_agent_update",
            text: "Retry requested.",
          });
          return detail;
        }
        requireTaskVersion(detail.task, command.expectedVersion);
        requireStatus(detail.task, ["failed", "stopped"]);
        const parent = await resolveContinuationParent({
          detail,
          operationIdempotencyKey: command.idempotencyKey,
          organizationId: command.organizationId,
          requesterUserId: command.requesterUserId,
          runtime: input.runtime,
          taskId: command.taskId,
        });
        await input.runtime.authorizeTurn({
          organizationId: command.organizationId,
          parent,
          requesterUserId: command.requesterUserId,
        });
        const occurredAtMs = now();
        return await startAttempt({
          db: input.db,
          expectedTaskVersion: command.expectedVersion,
          inboxDb: input.inboxDb ?? input.db,
          input: {
            event: {
              actor: "requester",
              attemptGeneration: null,
              idempotencyKey: command.idempotencyKey,
              kind: "center_agent_update",
              observedAtMs: occurredAtMs,
              occurredAtMs,
              text: "Retry requested.",
            },
            instruction,
            operationIdempotencyKey: command.idempotencyKey,
            organizationId: command.organizationId,
            parent,
            requesterUserId: command.requesterUserId,
            taskEventId: eventId,
            taskId: command.taskId,
          },
          now,
          runtime: input.runtime,
        });
      });
    },

    async stop(command: {
      expectedVersion: number;
      organizationId: string;
      requesterUserId: string;
      taskId: string;
    }): Promise<CenterAgentTaskDetail> {
      return await mapRepositoryErrors(async () => {
        let detail = await requireRequesterTaskDetail(input.db, command);
        const activeAttempt = requireActiveAttempt(detail);
        const stopRequestedEventId =
          await resolveCenterAgentTaskStopRequestedEventId({
            attemptGeneration: activeAttempt.generation,
            detail,
            expectedVersion: command.expectedVersion,
            organizationId: command.organizationId,
            taskId: command.taskId,
          });
        const stopCompletedEventId = await buildStableId("stop-completed", [
          command.organizationId,
          command.taskId,
          String(activeAttempt.generation),
        ]);
        const existingStopRequest = detail.events.find(
          (event) => event.id === stopRequestedEventId
        );
        const allowAlreadyTerminal = wasAttemptWaitingForRequester(
          detail,
          activeAttempt.generation
        );

        if (!existingStopRequest) {
          requireTaskVersion(detail.task, command.expectedVersion);
          requireStatus(detail.task, ["needs_attention", "queued", "running"]);
          await requestCenterAgentTaskStop({
            actor: "requester",
            attemptGeneration: activeAttempt.generation,
            db: input.db,
            eventId: stopRequestedEventId,
            expectedTaskVersion: command.expectedVersion,
            idempotencyKey: stopRequestedEventId,
            nowMs: now(),
            organizationId: command.organizationId,
            taskId: command.taskId,
            text: "Stop requested. Waiting to confirm the current work has stopped.",
          });
          detail = await requireRequesterTaskDetail(input.db, command);
        }
        if (detail.task.status === "stopped") {
          return await replayCompletedTaskStop({
            db: input.db,
            detail,
            eventId: stopCompletedEventId,
            generation: activeAttempt.generation,
            organizationId: command.organizationId,
            requesterUserId: command.requesterUserId,
          });
        }
        requireStatus(detail.task, ["stopping"]);

        const stopOutcome = await requestNativeAttemptStop({
          attempt: requireActiveAttempt(detail),
          organizationId: command.organizationId,
          requesterUserId: command.requesterUserId,
          runtime: input.runtime,
        });
        if (stopOutcome === "stop_requested") {
          return detail;
        }
        if (!isConfirmedTaskStop(stopOutcome, allowAlreadyTerminal)) {
          throw conflict(
            "The current Task delivery could not be stopped safely."
          );
        }
        return await settleExplicitCenterAgentTaskStop({
          activeAttempt,
          command,
          db: input.db,
          detail,
          inboxDb: input.inboxDb ?? input.db,
          now,
          runtime: input.runtime,
          stopCompletedEventId,
        });
      });
    },
  };

  return {
    continue: async (
      command: Parameters<typeof canonicalService.continue>[0]
    ) =>
      await projectCenterAgentTaskDetailExecutionEvidence({
        detail: await canonicalService.continue(command),
        nowMs: now(),
        runtime: input.runtime,
      }),
    create: async (command: Parameters<typeof canonicalService.create>[0]) =>
      await projectCenterAgentTaskDetailExecutionEvidence({
        detail: await canonicalService.create(command),
        nowMs: now(),
        runtime: input.runtime,
      }),
    get: async (query: Parameters<typeof canonicalService.get>[0]) =>
      await projectCenterAgentTaskDetailExecutionEvidence({
        detail: await canonicalService.get(query),
        nowMs: now(),
        runtime: input.runtime,
      }),
    list: async (query: Parameters<typeof canonicalService.list>[0]) => {
      const response = await canonicalService.list(query);
      const attempts = await listRunningCenterAgentTaskAttempts({
        db: input.db,
        organizationId: query.organizationId,
        tasks: response.tasks.flatMap((task) =>
          task.status === "running" && task.activeAttemptGeneration !== null
            ? [
                {
                  generation: task.activeAttemptGeneration,
                  taskId: task.id,
                },
              ]
            : []
        ),
      });
      return {
        ...response,
        tasks: await projectCenterAgentTaskExecutionEvidence({
          attempts,
          nowMs: now(),
          runtime: input.runtime,
          tasks: response.tasks,
        }),
      };
    },
    retry: async (command: Parameters<typeof canonicalService.retry>[0]) =>
      await projectCenterAgentTaskDetailExecutionEvidence({
        detail: await canonicalService.retry(command),
        nowMs: now(),
        runtime: input.runtime,
      }),
    stop: async (command: Parameters<typeof canonicalService.stop>[0]) =>
      await projectCenterAgentTaskDetailExecutionEvidence({
        detail: await canonicalService.stop(command),
        nowMs: now(),
        runtime: input.runtime,
      }),
  };
}

async function projectCenterAgentTaskDetailExecutionEvidence(input: {
  detail: CenterAgentTaskDetail;
  nowMs: number;
  runtime: CenterAgentTaskRuntimePort;
}): Promise<CenterAgentTaskDetail> {
  const [task] = await projectCenterAgentTaskExecutionEvidence({
    attempts: input.detail.attempts,
    nowMs: input.nowMs,
    runtime: input.runtime,
    tasks: [input.detail.task],
  });
  if (!task) {
    throw new Error("center_agent_task.detail_projection_unavailable");
  }
  return { ...input.detail, task };
}

async function projectCenterAgentTaskExecutionEvidence(input: {
  attempts: readonly CenterAgentTaskAttempt[];
  nowMs: number;
  runtime: CenterAgentTaskRuntimePort;
  tasks: readonly CenterAgentTask[];
}): Promise<CenterAgentTask[]> {
  const runningTasks = new Map(
    input.tasks.flatMap((task) =>
      task.status === "running" && task.activeAttemptGeneration !== null
        ? [[task.id, task] as const]
        : []
    )
  );
  const attempts = input.attempts.flatMap((attempt) => {
    const task = runningTasks.get(attempt.taskId);
    return task &&
      attempt.status === "running" &&
      attempt.generation === task.activeAttemptGeneration &&
      attempt.taskHandle.kind === "native_delivery"
      ? [
          {
            attemptGeneration: attempt.generation,
            deliveryId: attempt.taskHandle.deliveryId,
            taskId: attempt.taskId,
          },
        ]
      : [];
  });
  if (attempts.length === 0) {
    return [...input.tasks];
  }
  const requesterUserId = input.tasks[0]?.requesterUserId;
  const organizationId = input.tasks[0]?.organizationId;
  if (!(organizationId && requesterUserId)) {
    return [...input.tasks];
  }
  let evidence: readonly (CenterAgentTaskExecutionEvidence & {
    taskId: string;
  })[];
  try {
    evidence = await input.runtime.resolveExecutionEvidence({
      attempts,
      nowMs: input.nowMs,
      organizationId,
      requesterUserId,
    });
  } catch (error) {
    console.warn("[core.center_agent_task.execution_evidence_unavailable]", {
      error: error instanceof Error ? error.message : String(error),
      organizationId,
      taskCount: attempts.length,
    });
    return [...input.tasks];
  }
  const evidenceByTaskId = new Map(
    evidence.map((entry) => [entry.taskId, entry])
  );
  return input.tasks.map((task) => {
    const {
      executionEvidence: _executionEvidence,
      outcome: _outcome,
      phase: _phase,
      state: _state,
      ...record
    } = task;
    const currentEvidence = evidenceByTaskId.get(task.id);
    return centerAgentTaskSchema.parse({
      ...record,
      ...(currentEvidence
        ? {
            executionEvidence: {
              attemptGeneration: currentEvidence.attemptGeneration,
              kind: currentEvidence.kind,
              observedAt: currentEvidence.observedAt,
            },
          }
        : {}),
    });
  });
}

async function settleExplicitCenterAgentTaskStop(input: {
  activeAttempt: CenterAgentTaskAttempt;
  command: TaskMutationAuthority;
  db: D1Database;
  detail: CenterAgentTaskDetail;
  inboxDb: D1Database;
  now: () => number;
  runtime: CenterAgentTaskRuntimePort;
  stopCompletedEventId: string;
}): Promise<CenterAgentTaskDetail> {
  const stoppedAtMs = input.now();
  const transitioned = await projectCenterAgentTaskAttemptEvent({
    db: input.db,
    event: {
      actor: "requester",
      attemptGeneration: input.activeAttempt.generation,
      eventId: input.stopCompletedEventId,
      idempotencyKey: input.stopCompletedEventId,
      kind: "task_stopped",
      observedAtMs: stoppedAtMs,
      occurredAtMs: stoppedAtMs,
      text: "Task stopped.",
    },
    expectedTaskVersion: input.detail.task.version,
    failureCode: null,
    generation: input.activeAttempt.generation,
    nowMs: stoppedAtMs,
    organizationId: input.command.organizationId,
    status: "stopped",
    taskId: input.command.taskId,
  });
  if (
    transitioned.outcome === "stale_generation" ||
    transitioned.outcome === "terminal_conflict"
  ) {
    throw conflict("The Task changed while it was stopping.");
  }
  await resolveAcceptedNeedsAttention({
    detail: input.detail,
    inboxDb: input.inboxDb,
    resolvedAtMs: requireFinishedAtMs(transitioned.task),
  });
  if (input.activeAttempt.taskHandle.kind !== "native_delivery") {
    throw conflict(
      "This Task attempt does not own a resumable native delivery."
    );
  }
  const resumed = await resumeCenterAgentTaskPendingReplacement({
    db: input.db,
    deliveryId: input.activeAttempt.taskHandle.deliveryId,
    inboxDb: input.inboxDb,
    now: input.now,
    organizationId: input.command.organizationId,
    runtime: input.runtime,
    taskId: input.command.taskId,
  });
  return resumed ?? (await requireRequesterTaskDetail(input.db, input.command));
}

async function resolveCenterAgentTaskStopRequestedEventId(input: {
  attemptGeneration: number;
  detail: CenterAgentTaskDetail;
  expectedVersion: number;
  organizationId: string;
  taskId: string;
}): Promise<string> {
  const initialEventId = await buildStableId("stop-requested", [
    input.organizationId,
    input.taskId,
    String(input.attemptGeneration),
  ]);
  const retryingTimedOutStop =
    input.detail.task.status === "needs_attention" &&
    input.detail.events.some((event) => event.id === initialEventId);
  if (!retryingTimedOutStop) {
    return initialEventId;
  }
  return await buildStableId("stop-requested-retry", [
    input.organizationId,
    input.taskId,
    String(input.attemptGeneration),
    String(input.expectedVersion),
  ]);
}

export async function resumeCenterAgentTaskPendingReplacement(input: {
  db: D1Database;
  deliveryId: string;
  inboxDb: D1Database;
  now?: () => number;
  organizationId: string;
  runtime: Pick<CenterAgentTaskRuntimePort, "authorizeTurn" | "submitTurn">;
  taskId: string;
}): Promise<CenterAgentTaskDetail | null> {
  return await mapRepositoryErrors(async () => {
    const pending = await readCenterAgentTaskPendingReplacement({
      db: input.db,
      deliveryId: input.deliveryId,
      organizationId: input.organizationId,
      taskId: input.taskId,
    });
    if (!pending) {
      return null;
    }
    const now = input.now ?? Date.now;
    const detail = await requireRequesterTaskDetail(input.db, {
      organizationId: input.organizationId,
      requesterUserId: pending.requesterUserId,
      taskId: input.taskId,
    });
    try {
      return await startAttempt({
        db: input.db,
        expectedTaskVersion: detail.task.version,
        inboxDb: input.inboxDb,
        input: {
          instruction: pending.event.text,
          operationIdempotencyKey: pending.operationIdempotencyKey,
          organizationId: input.organizationId,
          parent: { deliveryId: input.deliveryId, kind: "delivery" },
          requesterUserId: pending.requesterUserId,
          taskEventId: pending.event.id,
          taskId: input.taskId,
        },
        now,
        runtime: input.runtime,
      });
    } catch (error) {
      const current = await requireRequesterTaskDetail(input.db, {
        organizationId: input.organizationId,
        requesterUserId: pending.requesterUserId,
        taskId: input.taskId,
      });
      const attemptId = await buildAttemptId({
        operationIdempotencyKey: pending.operationIdempotencyKey,
        organizationId: input.organizationId,
        taskId: input.taskId,
      });
      const submittedAttempt = current.attempts.find(
        (attempt) => attempt.id === attemptId
      );
      if (submittedAttempt) {
        return current;
      }
      throw error;
    }
  });
}

type CenterAgentTaskRecoveryInput = {
  db: D1Database;
  inboxDb: D1Database;
  now: () => number;
  runtime: CenterAgentTaskRuntimePort;
};

type CenterAgentTaskRecoverySummary = {
  admissionsDelivered: number;
  admissionsFailed: number;
  errors: number;
  stopsFailed: number;
  stopsPending: number;
  stopsResolved: number;
};

export async function recoverCenterAgentTaskWork(input: {
  db: D1Database;
  inboxDb: D1Database;
  now?: () => number;
  runtime: CenterAgentTaskRuntimePort;
}): Promise<CenterAgentTaskRecoverySummary> {
  const recoveryInput: CenterAgentTaskRecoveryInput = {
    ...input,
    now: input.now ?? Date.now,
  };
  const summary: CenterAgentTaskRecoverySummary = {
    admissionsDelivered: 0,
    admissionsFailed: 0,
    errors: 0,
    stopsFailed: 0,
    stopsPending: 0,
    stopsResolved: 0,
  };
  await recoverPendingCenterAgentTaskAdmissions(recoveryInput, summary);
  await recoverStoppingCenterAgentTaskAttempts(recoveryInput, summary);
  return summary;
}

async function recoverPendingCenterAgentTaskAdmissions(
  input: CenterAgentTaskRecoveryInput,
  summary: CenterAgentTaskRecoverySummary
): Promise<void> {
  const admissions = await listPendingCenterAgentTaskAdmissions({
    db: input.db,
    limit: CENTER_AGENT_TASK_RECOVERY_LIMIT,
  });
  for (const admission of admissions) {
    try {
      const detail = await requireRequesterTaskDetail(input.db, admission);
      const attempt = detail.attempts.find(
        (candidate) => candidate.generation === admission.attemptGeneration
      );
      if (!(detail.task.status === "queued" && attempt?.status === "queued")) {
        const failed =
          attempt?.status === "failed" || attempt?.status === "stopped";
        await settleCenterAgentTaskAdmission({
          attemptGeneration: admission.attemptGeneration,
          db: input.db,
          ...(failed
            ? {
                failureCode:
                  attempt?.failureCode ??
                  "center_agent_task.admission_cancelled_before_delivery",
              }
            : {}),
          nowMs: input.now(),
          organizationId: admission.organizationId,
          state: failed ? "failed" : "delivered",
          taskId: admission.taskId,
        });
        summary[failed ? "admissionsFailed" : "admissionsDelivered"] += 1;
        continue;
      }
      await submitQueuedCenterAgentTaskAttempt({
        admission,
        db: input.db,
        inboxDb: input.inboxDb,
        now: input.now,
        runtime: input.runtime,
      });
      summary.admissionsDelivered += 1;
    } catch (error) {
      if (error instanceof CenterAgentTaskAdmissionRejectedError) {
        summary.admissionsFailed += 1;
        continue;
      }
      summary.errors += 1;
      console.error("[core.center_agent_task.admission_redrive_failed]", {
        error: readFailureDetail(error),
        organizationId: admission.organizationId,
        taskId: admission.taskId,
      });
    }
  }
}

async function recoverStoppingCenterAgentTaskAttempts(
  input: CenterAgentTaskRecoveryInput,
  summary: CenterAgentTaskRecoverySummary
): Promise<void> {
  const stoppingAttempts = await listStoppingCenterAgentTaskAttempts({
    db: input.db,
    limit: CENTER_AGENT_TASK_RECOVERY_LIMIT,
  });
  for (const stopping of stoppingAttempts) {
    let outcome:
      | "already_terminal"
      | "not_stoppable"
      | "stop_requested"
      | "stopped"
      | null = null;
    let stopError: unknown = null;
    try {
      outcome = await input.runtime.stopDelivery({
        deliveryId: stopping.deliveryId,
        organizationId: stopping.organizationId,
        requesterUserId: stopping.requesterUserId,
      });
    } catch (error) {
      stopError = error;
    }
    if (
      outcome &&
      isConfirmedTaskStop(outcome, stopping.allowAlreadyTerminal)
    ) {
      try {
        await settleRecoveredCenterAgentTaskStop({
          ...stopping,
          db: input.db,
          inboxDb: input.inboxDb,
          now: input.now,
          runtime: input.runtime,
        });
        summary.stopsResolved += 1;
      } catch (error) {
        summary.errors += 1;
        console.error("[core.center_agent_task.stop_recovery_failed]", {
          error: readFailureDetail(error),
          organizationId: stopping.organizationId,
          taskId: stopping.taskId,
        });
      }
      continue;
    }
    if (
      input.now() - stopping.stopRequestedAtMs <
      CENTER_AGENT_TASK_STOP_CONFIRMATION_TIMEOUT_MS
    ) {
      summary.stopsPending += 1;
      continue;
    }
    try {
      await failExpiredCenterAgentTaskStop({
        ...stopping,
        db: input.db,
        inboxDb: input.inboxDb,
        now: input.now,
        stopError,
      });
      summary.stopsFailed += 1;
    } catch (error) {
      summary.errors += 1;
      console.error("[core.center_agent_task.stop_timeout_projection_failed]", {
        error: readFailureDetail(error),
        organizationId: stopping.organizationId,
        taskId: stopping.taskId,
      });
    }
  }
}

async function settleRecoveredCenterAgentTaskStop(input: {
  attemptGeneration: number;
  db: D1Database;
  deliveryId: string;
  inboxDb: D1Database;
  now: () => number;
  organizationId: string;
  requesterUserId: string;
  runtime: CenterAgentTaskRuntimePort;
  taskId: string;
}): Promise<void> {
  const detail = await requireRequesterTaskDetail(input.db, input);
  if (detail.task.status !== "stopping") {
    return;
  }
  const stoppedAtMs = input.now();
  const eventId = await buildStableId("stop-recovery-completed", [
    input.organizationId,
    input.taskId,
    String(input.attemptGeneration),
  ]);
  const projected = await projectCenterAgentTaskAttemptEvent({
    db: input.db,
    event: {
      actor: "system",
      attemptGeneration: input.attemptGeneration,
      eventId,
      idempotencyKey: eventId,
      kind: "task_stopped",
      observedAtMs: stoppedAtMs,
      occurredAtMs: stoppedAtMs,
      text: "Task stopped.",
    },
    expectedTaskVersion: detail.task.version,
    failureCode: null,
    generation: input.attemptGeneration,
    nowMs: stoppedAtMs,
    organizationId: input.organizationId,
    status: "stopped",
    taskId: input.taskId,
  });
  if (
    projected.outcome === "terminal_conflict" &&
    projected.task.status !== "stopped"
  ) {
    return;
  }
  await resolveAcceptedNeedsAttention({
    detail,
    inboxDb: input.inboxDb,
    resolvedAtMs: stoppedAtMs,
  });
  await resumeCenterAgentTaskPendingReplacement({
    db: input.db,
    deliveryId: input.deliveryId,
    inboxDb: input.inboxDb,
    now: input.now,
    organizationId: input.organizationId,
    runtime: input.runtime,
    taskId: input.taskId,
  });
}

async function failExpiredCenterAgentTaskStop(input: {
  attemptGeneration: number;
  db: D1Database;
  inboxDb: D1Database;
  now: () => number;
  organizationId: string;
  requesterUserId: string;
  stopError: unknown;
  taskId: string;
}): Promise<void> {
  const detail = await requireRequesterTaskDetail(input.db, input);
  if (detail.task.status !== "stopping") {
    return;
  }
  const failedAtMs = input.now();
  const eventId = await buildStableId("stop-recovery-failed", [
    input.organizationId,
    input.taskId,
    String(input.attemptGeneration),
  ]);
  const projected = await projectCenterAgentTaskAttemptEvent({
    db: input.db,
    event: {
      actor: "system",
      attemptGeneration: input.attemptGeneration,
      eventId,
      idempotencyKey: eventId,
      kind: "needs_attention",
      observedAtMs: failedAtMs,
      occurredAtMs: failedAtMs,
      text: CENTER_AGENT_TASK_STOP_CONFIRMATION_TIMEOUT_TEXT,
    },
    expectedTaskVersion: detail.task.version,
    failureCode: null,
    generation: input.attemptGeneration,
    nowMs: failedAtMs,
    organizationId: input.organizationId,
    status: "needs_attention",
    taskId: input.taskId,
  });
  if (
    projected.outcome === "stale_generation" ||
    projected.outcome === "terminal_conflict"
  ) {
    return;
  }
  await resolveAcceptedNeedsAttention({
    detail,
    inboxDb: input.inboxDb,
    resolvedAtMs: failedAtMs,
  });
  await projectCenterAgentTaskInboxItem({
    db: input.inboxDb,
    event: projected.event,
    importance: "urgent",
    nowMs: failedAtMs,
    task: projected.task,
  });
  console.error("[core.center_agent_task.stop_confirmation_timed_out]", {
    error: input.stopError ? readFailureDetail(input.stopError) : null,
    failureCode: CENTER_AGENT_TASK_STOP_CONFIRMATION_TIMEOUT_FAILURE_CODE,
    organizationId: input.organizationId,
    taskId: input.taskId,
  });
}

async function requestActiveInstructionReplacement(input: {
  command: {
    expectedVersion: number;
    idempotencyKey: string;
    organizationId: string;
    requesterUserId: string;
    taskId: string;
    text: string;
  };
  db: D1Database;
  detail: CenterAgentTaskDetail;
  eventId: string;
  inboxDb: D1Database;
  now: () => number;
  parent: CenterAgentTaskParentDeliveryRef;
  runtime: CenterAgentTaskRuntimePort;
}): Promise<CenterAgentTaskDetail> {
  const activeAttempt = requireActiveAttempt(input.detail);
  const stopRequestedEventId = await buildStableId(
    "replacement-stop-requested",
    [
      input.command.organizationId,
      input.command.taskId,
      String(activeAttempt.generation),
      input.command.idempotencyKey,
    ]
  );
  const latestEventAtMs = Math.max(
    0,
    ...input.detail.events.map((event) => Date.parse(event.occurredAt))
  );
  const stopRequestedAtMs = Math.max(input.now(), latestEventAtMs + 1);
  const replacementOccurredAtMs = Math.max(input.now(), stopRequestedAtMs + 1);
  await requestCenterAgentTaskStop({
    actor: "requester",
    attemptGeneration: activeAttempt.generation,
    db: input.db,
    eventId: stopRequestedEventId,
    expectedTaskVersion: input.command.expectedVersion,
    idempotencyKey: buildCenterAgentTaskReplacementStopIdempotencyKey(
      input.eventId
    ),
    nowMs: stopRequestedAtMs,
    organizationId: input.command.organizationId,
    replacementInstruction: {
      eventId: input.eventId,
      idempotencyKey: input.command.idempotencyKey,
      occurredAtMs: replacementOccurredAtMs,
      text: input.command.text,
    },
    taskId: input.command.taskId,
    text: "Stop requested before replacing the current instruction.",
  });
  return await finishStoppingReplacement({
    db: input.db,
    detail: await requireRequesterTaskDetail(input.db, input.command),
    eventId: input.eventId,
    inboxDb: input.inboxDb,
    instruction: input.command.text,
    now: input.now,
    operationIdempotencyKey: input.command.idempotencyKey,
    organizationId: input.command.organizationId,
    parent: input.parent,
    requesterUserId: input.command.requesterUserId,
    runtime: input.runtime,
    taskId: input.command.taskId,
  });
}

async function finishStoppingReplacement(input: {
  db: D1Database;
  detail: CenterAgentTaskDetail;
  eventId: string;
  inboxDb: D1Database;
  instruction: string;
  now: () => number;
  operationIdempotencyKey: string;
  organizationId: string;
  parent: CenterAgentTaskParentDeliveryRef;
  requesterUserId: string;
  runtime: CenterAgentTaskRuntimePort;
  taskId: string;
}): Promise<CenterAgentTaskDetail> {
  const activeAttempt = requireActiveAttempt(input.detail);
  const stopOutcome = await requestNativeAttemptStop({
    attempt: activeAttempt,
    organizationId: input.organizationId,
    requesterUserId: input.requesterUserId,
    runtime: input.runtime,
  });
  if (stopOutcome === "stop_requested") {
    return input.detail;
  }
  if (
    !isConfirmedTaskStop(
      stopOutcome,
      wasAttemptWaitingForRequester(input.detail, activeAttempt.generation)
    )
  ) {
    throw conflict("The current Task delivery could not be stopped safely.");
  }
  const stopCompletedEventId = await buildStableId("stop-completed", [
    input.organizationId,
    input.taskId,
    String(activeAttempt.generation),
  ]);
  const stoppedAtMs = input.now();
  const transitioned = await projectCenterAgentTaskAttemptEvent({
    db: input.db,
    event: {
      actor: "requester",
      attemptGeneration: activeAttempt.generation,
      eventId: stopCompletedEventId,
      idempotencyKey: stopCompletedEventId,
      kind: "task_stopped",
      observedAtMs: stoppedAtMs,
      occurredAtMs: stoppedAtMs,
      text: "Task stopped.",
    },
    expectedTaskVersion: input.detail.task.version,
    failureCode: null,
    generation: activeAttempt.generation,
    nowMs: stoppedAtMs,
    organizationId: input.organizationId,
    status: "stopped",
    taskId: input.taskId,
  });
  if (transitioned.outcome === "stale_generation") {
    return await requireRequesterTaskDetail(input.db, input);
  }
  if (
    transitioned.outcome === "terminal_conflict" &&
    transitioned.task.status !== "stopped"
  ) {
    throw conflict("The Task changed while its current work was stopping.");
  }
  await resolveAcceptedNeedsAttention({
    detail: input.detail,
    inboxDb: input.inboxDb,
    requesterEventId: input.eventId,
    resolvedAtMs: stoppedAtMs,
  });
  return await startAttempt({
    db: input.db,
    expectedTaskVersion: transitioned.task.version,
    inboxDb: input.inboxDb,
    input: {
      instruction: input.instruction,
      operationIdempotencyKey: input.operationIdempotencyKey,
      organizationId: input.organizationId,
      parent: input.parent,
      requesterUserId: input.requesterUserId,
      taskEventId: input.eventId,
      taskId: input.taskId,
    },
    now: input.now,
    runtime: input.runtime,
  });
}

async function resolveAcceptedNeedsAttention(input: {
  detail: CenterAgentTaskDetail;
  inboxDb: D1Database;
  requesterEventId?: string;
  resolvedAtMs: number;
}): Promise<void> {
  const requesterEventIndex = input.requesterEventId
    ? input.detail.events.findIndex(
        (event) => event.id === input.requesterEventId
      )
    : input.detail.events.length;
  if (requesterEventIndex < 0) {
    return;
  }
  const attentionEvent = input.detail.events
    .slice(0, requesterEventIndex)
    .findLast((event) => event.kind === "needs_attention");
  if (!attentionEvent) {
    return;
  }
  await resolveCenterAgentTaskNeedsAttentionInboxItem({
    db: input.inboxDb,
    eventId: attentionEvent.id,
    organizationId: input.detail.task.organizationId,
    resolvedAtMs: input.resolvedAtMs,
    taskId: input.detail.task.id,
  });
}

async function startAttempt(input: {
  db: D1Database;
  expectedTaskVersion: number;
  inboxDb: D1Database;
  input: StartAttemptInput;
  now: () => number;
  runtime: Pick<CenterAgentTaskRuntimePort, "authorizeTurn" | "submitTurn">;
}): Promise<CenterAgentTaskDetail> {
  const attemptId = await buildAttemptId(input.input);
  const deliveryId = await buildStableId("delivery", [
    input.input.organizationId,
    input.input.taskId,
    input.input.operationIdempotencyKey,
  ]);
  const currentDetail = await requireRequesterTaskDetail(input.db, input.input);
  if (
    await isAcceptedAttemptReplay({
      admission: {
        deliveryId,
        instruction: input.input.instruction,
        operationIdempotencyKey: input.input.operationIdempotencyKey,
        organizationId: input.input.organizationId,
        parent: input.input.parent,
        requesterUserId: input.input.requesterUserId,
        taskEventId: input.input.taskEventId,
        taskId: input.input.taskId,
      },
      attemptId,
      db: input.db,
      detail: currentDetail,
      ...(input.input.event
        ? {
            event: {
              actor: input.input.event.actor,
              kind: input.input.event.kind,
              text: input.input.event.text,
            },
          }
        : {}),
    })
  ) {
    return currentDetail;
  }
  await input.runtime.authorizeTurn({
    organizationId: input.input.organizationId,
    parent: input.input.parent,
    requesterUserId: input.input.requesterUserId,
  });
  const startedAtMs = input.now();
  const attempt = await startCenterAgentTaskAttempt({
    admission: {
      deliveryId,
      instruction: input.input.instruction,
      operationIdempotencyKey: input.input.operationIdempotencyKey,
      parent: input.input.parent,
      requesterUserId: input.input.requesterUserId,
      taskEventId: input.input.taskEventId,
    },
    attemptId,
    db: input.db,
    ...(input.input.event
      ? {
          event: {
            ...input.input.event,
            eventId: input.input.taskEventId,
          },
        }
      : {}),
    expectedTaskVersion: input.expectedTaskVersion,
    idempotencyKey: `attempt:${input.input.operationIdempotencyKey}`,
    nowMs: startedAtMs,
    organizationId: input.input.organizationId,
    ...(input.input.replacedAttemptGeneration === undefined
      ? {}
      : {
          replacedAttemptGeneration: input.input.replacedAttemptGeneration,
        }),
    taskHandle: { deliveryId, kind: "native_delivery", v: 1 },
    taskId: input.input.taskId,
  });
  if (attempt.outcome === "replay" || attempt.attempt.status !== "queued") {
    return await requireRequesterTaskDetail(input.db, input.input);
  }
  return await submitQueuedCenterAgentTaskAttempt({
    admission: {
      attemptGeneration: attempt.attempt.generation,
      deliveryId,
      instruction: input.input.instruction,
      operationIdempotencyKey: input.input.operationIdempotencyKey,
      organizationId: input.input.organizationId,
      parent: input.input.parent,
      requesterUserId: input.input.requesterUserId,
      taskEventId: input.input.taskEventId,
      taskId: input.input.taskId,
    },
    db: input.db,
    inboxDb: input.inboxDb,
    now: input.now,
    runtime: input.runtime,
  });
}

async function submitQueuedCenterAgentTaskAttempt(input: {
  admission: {
    attemptGeneration: number;
    deliveryId: string;
    instruction: string;
    operationIdempotencyKey: string;
    organizationId: string;
    parent: CenterAgentTaskParentDeliveryRef;
    requesterUserId: string;
    taskEventId: string;
    taskId: string;
  };
  db: D1Database;
  inboxDb: D1Database;
  now: () => number;
  runtime: Pick<CenterAgentTaskRuntimePort, "submitTurn">;
}): Promise<CenterAgentTaskDetail> {
  const attemptedAtMs = input.now();
  await recordCenterAgentTaskAdmissionAttempt({
    attemptGeneration: input.admission.attemptGeneration,
    db: input.db,
    failureCode: null,
    nowMs: attemptedAtMs,
    organizationId: input.admission.organizationId,
    taskId: input.admission.taskId,
  });
  const submission = await input.runtime.submitTurn({
    deliveryId: input.admission.deliveryId,
    idempotencyKey: `center-agent-task-turn:${input.admission.operationIdempotencyKey}`,
    instruction: input.admission.instruction,
    nowMs: attemptedAtMs,
    organizationId: input.admission.organizationId,
    parent: input.admission.parent,
    requesterUserId: input.admission.requesterUserId,
    taskEventId: input.admission.taskEventId,
    taskId: input.admission.taskId,
  });
  if (submission.outcome === "rejected") {
    await projectCenterAgentTaskTerminal({
      inboxDb: input.inboxDb,
      taskDb: input.db,
      delivery: {
        deliveryId: input.admission.deliveryId,
        failureCode: submission.failureCode,
        failureDetail: submission.failureDetail,
        finalPublicationPayload: null,
        organizationId: input.admission.organizationId,
        status: "worker_unavailable",
      },
      nowMs: input.now(),
    });
    await settleCenterAgentTaskAdmission({
      attemptGeneration: input.admission.attemptGeneration,
      db: input.db,
      failureCode: submission.failureCode,
      nowMs: input.now(),
      organizationId: input.admission.organizationId,
      state: "failed",
      taskId: input.admission.taskId,
    });
    throw new CenterAgentTaskAdmissionRejectedError({
      code: submission.failureCode,
      message: "Center Agent could not accept this Task attempt.",
      status: 409,
    });
  }
  if (submission.outcome === "unknown") {
    await settleCenterAgentTaskAdmission({
      attemptGeneration: input.admission.attemptGeneration,
      db: input.db,
      nowMs: input.now(),
      organizationId: input.admission.organizationId,
      state: "delivered",
      taskId: input.admission.taskId,
    });
    return await requireRequesterTaskDetail(input.db, input.admission);
  }
  let detail = await requireRequesterTaskDetail(input.db, input.admission);
  const currentAttempt = detail.attempts.find(
    (attempt) => attempt.generation === input.admission.attemptGeneration
  );
  if (detail.task.status === "queued" && currentAttempt?.status === "queued") {
    await transitionCenterAgentTaskAttempt({
      db: input.db,
      expectedTaskVersion: detail.task.version,
      failureCode: null,
      generation: input.admission.attemptGeneration,
      nowMs: input.now(),
      organizationId: input.admission.organizationId,
      status: "running",
      taskId: input.admission.taskId,
    });
    detail = await requireRequesterTaskDetail(input.db, input.admission);
  }
  await settleCenterAgentTaskAdmission({
    attemptGeneration: input.admission.attemptGeneration,
    db: input.db,
    nowMs: input.now(),
    organizationId: input.admission.organizationId,
    state: "delivered",
    taskId: input.admission.taskId,
  });
  return detail;
}

async function requestNativeAttemptStop(input: {
  attempt: CenterAgentTaskAttempt;
  organizationId: string;
  requesterUserId: string;
  runtime: CenterAgentTaskRuntimePort;
}): Promise<
  "already_terminal" | "not_stoppable" | "stop_requested" | "stopped"
> {
  if (input.attempt.taskHandle.kind !== "native_delivery") {
    throw conflict(
      "This Task attempt does not own a stoppable native delivery."
    );
  }
  return await input.runtime.stopDelivery({
    deliveryId: input.attempt.taskHandle.deliveryId,
    organizationId: input.organizationId,
    requesterUserId: input.requesterUserId,
  });
}

function wasAttemptWaitingForRequester(
  detail: CenterAgentTaskDetail,
  attemptGeneration: number
): boolean {
  return (
    detail.task.status === "needs_attention" ||
    detail.events.some(
      (event) =>
        event.attemptGeneration === attemptGeneration &&
        event.kind === "needs_attention"
    )
  );
}

function isConfirmedTaskStop(
  outcome: Awaited<ReturnType<typeof requestNativeAttemptStop>>,
  allowAlreadyTerminal: boolean
): boolean {
  return (
    outcome === "stopped" ||
    (outcome === "already_terminal" && allowAlreadyTerminal)
  );
}

async function appendTaskStoppedEvent(input: {
  db: D1Database;
  eventId: string;
  generation: number;
  organizationId: string;
  task: CenterAgentTask;
}): Promise<void> {
  const occurredAtMs = requireFinishedAtMs(input.task);
  await appendCenterAgentTaskEvent({
    actor: "requester",
    attemptGeneration: input.generation,
    db: input.db,
    eventId: input.eventId,
    expectedTaskVersion: input.task.version,
    idempotencyKey: input.eventId,
    kind: "task_stopped",
    observedAtMs: occurredAtMs,
    occurredAtMs,
    organizationId: input.organizationId,
    taskId: input.task.id,
    text: "Task stopped.",
  });
}

async function replayCompletedTaskStop(input: {
  db: D1Database;
  detail: CenterAgentTaskDetail;
  eventId: string;
  generation: number;
  organizationId: string;
  requesterUserId: string;
}): Promise<CenterAgentTaskDetail> {
  if (!input.detail.events.some((event) => event.id === input.eventId)) {
    await appendTaskStoppedEvent({
      db: input.db,
      eventId: input.eventId,
      generation: input.generation,
      organizationId: input.organizationId,
      task: input.detail.task,
    });
  }
  return await requireRequesterTaskDetail(input.db, {
    organizationId: input.organizationId,
    requesterUserId: input.requesterUserId,
    taskId: input.detail.task.id,
  });
}

function requireFinishedAtMs(task: CenterAgentTask): number {
  if (task.finishedAt === null) {
    throw new Error("A stopped Task requires a finished timestamp.");
  }
  return Date.parse(task.finishedAt);
}

async function requireRequesterTaskDetail(
  db: D1Database,
  input: TaskMutationAuthority
): Promise<CenterAgentTaskDetail> {
  const task = await readCenterAgentTask({
    db,
    organizationId: input.organizationId,
    taskId: input.taskId,
  });
  if (!task || task.requesterUserId !== input.requesterUserId) {
    throw new CenterAgentTaskApplicationError({
      code: "center_agent_task.not_found",
      message: "Task not found.",
      status: 404,
    });
  }
  const [attempts, events] = await Promise.all([
    listCenterAgentTaskAttempts({
      db,
      organizationId: input.organizationId,
      taskId: input.taskId,
    }),
    listCenterAgentTaskEvents({
      db,
      organizationId: input.organizationId,
      taskId: input.taskId,
    }),
  ]);
  return { attempts, events, task };
}

function requireActiveAttempt(
  detail: CenterAgentTaskDetail
): CenterAgentTaskAttempt {
  const generation = detail.task.activeAttemptGeneration;
  const attempt = detail.attempts.find(
    (candidate) => candidate.generation === generation
  );
  if (!attempt) {
    throw conflict("The Task's current execution attempt is unavailable.");
  }
  return attempt;
}

function requireTaskVersion(
  task: CenterAgentTask,
  expectedVersion: number
): void {
  if (task.version !== expectedVersion) {
    throw new CenterAgentTaskApplicationError({
      code: "center_agent_task.version_conflict",
      message: `The Task changed. Refresh it before trying again (current version ${task.version}).`,
      status: 409,
    });
  }
}

function requireStatus(
  task: CenterAgentTask,
  allowed: CenterAgentTaskStatus[]
): void {
  if (!allowed.includes(task.status)) {
    throw new CenterAgentTaskApplicationError({
      code: "center_agent_task.invalid_state",
      message: `This action is not available while the Task is ${task.status}.`,
      status: 409,
    });
  }
}

function requireAcceptedEventReplay(
  event: CenterAgentTaskDetail["events"][number],
  expected: {
    actor: CenterAgentTaskDetail["events"][number]["actor"];
    kind: CenterAgentTaskDetail["events"][number]["kind"];
    text: string;
  }
): void {
  if (
    event.actor !== expected.actor ||
    event.kind !== expected.kind ||
    event.text !== expected.text
  ) {
    throw conflict(
      "The operation id is already bound to a different Task event."
    );
  }
}

async function requireAcceptedTaskCreationReplay(input: {
  admission: {
    deliveryId: string;
    instruction: string;
    operationIdempotencyKey: string;
    organizationId: string;
    parent: CenterAgentTaskParentDeliveryRef;
    requesterUserId: string;
    taskEventId: string;
    taskId: string;
  };
  attemptId: string;
  db: D1Database;
  detail: CenterAgentTaskDetail;
  event: {
    actor: CenterAgentTaskDetail["events"][number]["actor"];
    kind: CenterAgentTaskDetail["events"][number]["kind"];
    text: string;
  };
  goal: string;
  title: string;
}): Promise<void> {
  if (
    input.detail.task.goal !== input.goal ||
    input.detail.task.title !== input.title
  ) {
    throw conflict(
      "The Task creation operation is already bound to different Task data."
    );
  }
  if (!(await isAcceptedAttemptReplay(input))) {
    throw conflict(
      "The accepted Task creation is missing its exact event, attempt, or admission intent."
    );
  }
}

async function isAcceptedAttemptReplay(input: {
  admission: {
    deliveryId: string;
    instruction: string;
    operationIdempotencyKey: string;
    organizationId: string;
    parent: CenterAgentTaskParentDeliveryRef;
    requesterUserId: string;
    taskEventId: string;
    taskId: string;
  };
  attemptId: string;
  db: D1Database;
  detail: CenterAgentTaskDetail;
  event?: {
    actor: CenterAgentTaskDetail["events"][number]["actor"];
    kind: CenterAgentTaskDetail["events"][number]["kind"];
    text: string;
  };
}): Promise<boolean> {
  const attempt = input.detail.attempts.find(
    (candidate) => candidate.id === input.attemptId
  );
  if (!attempt) {
    return false;
  }
  if (
    attempt.taskHandle.kind !== "native_delivery" ||
    attempt.taskHandle.deliveryId !== input.admission.deliveryId
  ) {
    throw conflict(
      "The operation id is already bound to a different Task attempt."
    );
  }
  const event = input.detail.events.find(
    (candidate) => candidate.id === input.admission.taskEventId
  );
  if (!event) {
    throw conflict(
      "The accepted Task attempt is missing its exact Task event."
    );
  }
  if (input.event) {
    requireAcceptedEventReplay(event, input.event);
  }
  const admission = await readCenterAgentTaskAdmissionOutbox({
    attemptGeneration: attempt.generation,
    db: input.db,
    organizationId: input.admission.organizationId,
    taskId: input.admission.taskId,
  });
  const actualParentId =
    admission?.parent.kind === "delivery"
      ? admission.parent.deliveryId
      : admission?.parent.submissionId;
  const expectedParentId =
    input.admission.parent.kind === "delivery"
      ? input.admission.parent.deliveryId
      : input.admission.parent.submissionId;
  if (
    !admission ||
    admission.deliveryId !== input.admission.deliveryId ||
    admission.instruction !== input.admission.instruction ||
    admission.operationIdempotencyKey !==
      input.admission.operationIdempotencyKey ||
    admission.parent.kind !== input.admission.parent.kind ||
    actualParentId !== expectedParentId ||
    admission.requesterUserId !== input.admission.requesterUserId ||
    admission.taskEventId !== input.admission.taskEventId
  ) {
    throw conflict(
      "The operation id is already bound to a different Task admission."
    );
  }
  return true;
}

function readLatestRequesterInstruction(detail: CenterAgentTaskDetail): string {
  for (let index = detail.events.length - 1; index >= 0; index -= 1) {
    const event = detail.events[index];
    if (event?.kind === "requester_message") {
      return event.text;
    }
  }
  return detail.task.goal;
}

async function resolveContinuationParent(input: {
  detail: CenterAgentTaskDetail;
  operationIdempotencyKey: string;
  organizationId: string;
  requesterUserId: string;
  runtime: CenterAgentTaskRuntimePort;
  taskId: string;
}): Promise<CenterAgentTaskParentDeliveryRef> {
  const operationAttemptId = await buildAttemptId(input);
  const operationAttempt = input.detail.attempts.find(
    (attempt) => attempt.id === operationAttemptId
  );
  const parentAttempt = input.detail.attempts
    .filter(
      (attempt) =>
        !operationAttempt || attempt.generation < operationAttempt.generation
    )
    .sort((left, right) => right.generation - left.generation)[0];
  if (parentAttempt?.taskHandle.kind !== "native_delivery") {
    throw conflict("The Task's source delivery is unavailable.");
  }
  return await input.runtime.resolveDeliveryParent({
    deliveryId: parentAttempt.taskHandle.deliveryId,
    organizationId: input.organizationId,
    requesterUserId: input.requesterUserId,
  });
}

async function buildAttemptId(input: {
  operationIdempotencyKey: string;
  organizationId: string;
  taskId: string;
}): Promise<string> {
  return await buildStableId("attempt", [
    input.organizationId,
    input.taskId,
    input.operationIdempotencyKey,
  ]);
}

async function buildStableId(
  prefix: string,
  components: string[]
): Promise<string> {
  const bytes = new TextEncoder().encode(components.join("\u001f"));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return `center-agent-${prefix}:${hex}`;
}

function readFailureCode(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const candidate = (error as { reasonCode?: unknown }).reasonCode;
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim().slice(0, 160);
    }
  }
  return "center_agent_task.execution_failed";
}

function readFailureDetail(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim().slice(0, 4000);
  }
  return readFailureCode(error);
}

function normalizeListLimit(value: number | undefined): number {
  const limit = value ?? CENTER_AGENT_TASK_LIST_DEFAULT_LIMIT;
  if (
    !(
      Number.isSafeInteger(limit) &&
      limit >= 1 &&
      limit <= CENTER_AGENT_TASK_LIST_MAX_LIMIT
    )
  ) {
    throw invalidCursorOrListInput("Task list limit is invalid.");
  }
  return limit;
}

function encodeListCursor(cursor: CenterAgentTaskListCursor): string {
  const json = JSON.stringify(cursor);
  return bytesToBase64Url(new TextEncoder().encode(json));
}

function decodeListCursor(
  value: string | undefined
): CenterAgentTaskListCursor | null {
  if (value === undefined) {
    return null;
  }
  try {
    const parsed = JSON.parse(
      new TextDecoder().decode(base64UrlToBytes(value))
    ) as unknown;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !("id" in parsed) ||
      !("updatedAtMs" in parsed) ||
      typeof parsed.id !== "string" ||
      !parsed.id.trim() ||
      parsed.id.length > 256 ||
      !Number.isSafeInteger(parsed.updatedAtMs) ||
      (parsed.updatedAtMs as number) < 0
    ) {
      throw new Error("Cursor payload is invalid");
    }
    return {
      id: parsed.id,
      updatedAtMs: parsed.updatedAtMs as number,
    };
  } catch {
    throw invalidCursorOrListInput("Task cursor is invalid.");
  }
}

function invalidCursorOrListInput(
  message: string
): CenterAgentTaskApplicationError {
  return new CenterAgentTaskApplicationError({
    code: "center_agent_task.list_invalid",
    message,
    status: 400,
  });
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(BASE64_PADDING_PATTERN, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  if (!BASE64_URL_PATTERN.test(value)) {
    throw new Error("Cursor is not base64url");
  }
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(base64 + padding);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function mapRepositoryErrors<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof CenterAgentTaskApplicationError) {
      throw error;
    }
    if (error instanceof CenterAgentTaskVersionConflictError) {
      throw new CenterAgentTaskApplicationError({
        code: "center_agent_task.version_conflict",
        message: `The Task changed. Refresh it before trying again (current version ${error.actualVersion}).`,
        status: 409,
      });
    }
    if (
      error instanceof CenterAgentTaskAttemptConflictError ||
      error instanceof CenterAgentTaskConflictError ||
      error instanceof CenterAgentTaskEventConflictError
    ) {
      throw conflict(error.message);
    }
    if (error instanceof CenterAgentTaskNotFoundError) {
      throw new CenterAgentTaskApplicationError({
        code: "center_agent_task.not_found",
        message: "Task not found.",
        status: 404,
      });
    }
    throw error;
  }
}

function conflict(message: string): CenterAgentTaskApplicationError {
  return new CenterAgentTaskApplicationError({
    code: "center_agent_task.conflict",
    message,
    status: 409,
  });
}
