import type {
  SpaceTask,
  SpaceTaskActor,
  SpaceTaskMutationReceipt,
} from "@openmeld/schemas/types";
import type {
  SpaceTaskDelivery,
  SpaceTaskDeliveryRepository,
} from "../infrastructure/sql/space-task-delivery-repo";
import type { SpaceTaskRepository } from "../infrastructure/sql/space-task-repo";
import type { SourceDispatchChainContext } from "./types";
export function resolveSpaceTaskHumanDecisionTarget(
  task: SpaceTask,
  activeMembers: readonly SpaceTaskActor[],
  ownerUserIds: readonly string[]
): SpaceTaskActor | null {
  if (task.requestedBy.profileKind === "human") {
    const requester = activeMembers.find(
      (member) => member.profileId === task.requestedBy.profileId
    );
    if (requester) {
      return requester;
    }
  }
  return (
    activeMembers
      .filter(
        (member) =>
          member.profileKind === "human" &&
          member.ownerUserId !== null &&
          ownerUserIds.includes(member.ownerUserId)
      )
      .sort((left, right) =>
        left.profileId.localeCompare(right.profileId)
      )[0] ?? null
  );
}
export function enqueueSpaceTaskDeliveries(input: {
  repository: SpaceTaskDeliveryRepository;
  receipt: SpaceTaskMutationReceipt;
  previous: SpaceTask | null;
  authorizedActor: boolean;
  wakeAssignee?: boolean;
  sourceDispatchChainContext?: SourceDispatchChainContext;
}): void {
  const { task, event } = input.receipt;
  const enqueue = (kind: SpaceTaskDelivery["kind"]) =>
    input.repository.enqueue(
      {
        id: `${event.eventId}:${kind}`,
        kind,
        receipt: input.receipt,
        actor:
          input.authorizedActor && !("provider" in event.actor)
            ? event.actor
            : null,
        ...(kind === "stop"
          ? { wakeTargets: input.repository.wakeRefs(task.taskId) }
          : {}),
        ...(input.sourceDispatchChainContext
          ? { sourceDispatchChainContext: input.sourceDispatchChainContext }
          : {}),
      },
      Date.now()
    );
  if (
    JSON.stringify(task.externalWorkItems) !==
    JSON.stringify(input.previous?.externalWorkItems ?? [])
  ) {
    enqueue("github_projection");
  }
  if (
    task.projectIds.length > 0 ||
    (input.previous?.projectIds.length ?? 0) > 0
  ) {
    enqueue("project_projection");
  }
  if (
    ((event.type === "created" || event.type === "assigned") &&
      input.wakeAssignee) ||
    (event.type === "result_submitted" && task.phase === "in_review") ||
    event.type === "changes_requested" ||
    event.type === "rework_continued"
  ) {
    enqueue("handoff");
  }
  if (
    task.phase === "done" &&
    (event.type === "result_submitted" || event.type === "review_accepted")
  ) {
    enqueue("completion");
  }
  if (
    event.type === "canceled" &&
    input.authorizedActor &&
    input.repository.wakeRefs(task.taskId).length > 0
  ) {
    enqueue("stop");
  }
  enqueue("inbox_projection");
}
/** Rechecked inside Signal persistence, after asynchronous admission reads. */
export function isSpaceTaskDeliveryCurrent(
  delivery: SpaceTaskDelivery,
  current: SpaceTask,
  repository: Pick<SpaceTaskRepository, "listEvents">
): boolean {
  const { task, event } = delivery.receipt;
  if (delivery.kind === "completion") {
    return (
      current.phase === "done" &&
      current.result?.resultRevision === task.result?.resultRevision
    );
  }
  if (delivery.kind === "stop") {
    return current.phase === "canceled";
  }
  if (delivery.kind !== "handoff") {
    return true;
  }
  if (
    current.phase !== task.phase ||
    current.needsHumanDecision !== task.needsHumanDecision ||
    current.result?.resultRevision !== task.result?.resultRevision ||
    current.title !== task.title ||
    current.description !== task.description ||
    JSON.stringify(current.completionConditions) !==
      JSON.stringify(task.completionConditions)
  ) {
    return false;
  }
  if (event.type === "result_submitted") {
    return (
      current.reviewer?.profileId === task.reviewer?.profileId &&
      current.phase === "in_review"
    );
  }
  if (event.type === "created" || event.type === "assigned") {
    const latestAssignment = repository
      .listEvents(task.taskId)
      .findLast(
        (candidate) =>
          candidate.type === "created" ||
          candidate.type === "assigned" ||
          candidate.type === "reopened"
      );
    return (
      latestAssignment?.eventId === event.eventId &&
      current.phase === "to_do" &&
      current.assignee?.profileId === task.assignee?.profileId &&
      current.reviewer?.profileId === task.reviewer?.profileId
    );
  }
  return (
    current.assignee?.profileId === task.assignee?.profileId &&
    current.review?.reviewedAt === task.review?.reviewedAt &&
    (current.phase === "in_progress" || current.needsHumanDecision)
  );
}
export function isSpaceTaskStopSuperseded(
  delivery: SpaceTaskDelivery,
  repository: Pick<SpaceTaskRepository, "listEvents">
): boolean {
  return repository
    .listEvents(delivery.receipt.task.taskId)
    .some(
      (event) =>
        event.type === "reopened" &&
        event.taskRevision > delivery.receipt.event.taskRevision
    );
}
/** Only an exact retained cancellation and Task Wake reference can extend Stop authority. */
export function isAuthorizedSpaceTaskStop(input: {
  actorOwnerUserId: string | null | undefined;
  actorProfileId: string;
  delivery?: SpaceTaskDelivery;
  wake: {
    sourceSignalId: string | null;
    targetProfileId: string;
  };
  taskRepository: Pick<SpaceTaskRepository, "listEvents" | "readOperation">;
  deliveryRepository: Pick<SpaceTaskDeliveryRepository, "hasWake">;
}): boolean {
  const { delivery, wake } = input;
  if (
    delivery?.kind !== "stop" ||
    delivery.receipt.event.type !== "canceled" ||
    !wake.sourceSignalId ||
    !input.actorOwnerUserId ||
    delivery.actor?.profileId !== input.actorProfileId ||
    delivery.actor.ownerUserId !== input.actorOwnerUserId ||
    isSpaceTaskStopSuperseded(delivery, input.taskRepository)
  ) {
    return false;
  }
  const event = input.taskRepository.readOperation(
    delivery.receipt.event.operationId
  )?.receipt.event;
  return (
    event?.eventId === delivery.receipt.event.eventId &&
    event.type === "canceled" &&
    event.taskId === delivery.receipt.task.taskId &&
    !("provider" in event.actor) &&
    event.actor.profileId === input.actorProfileId &&
    event.actor.ownerUserId === input.actorOwnerUserId &&
    input.deliveryRepository.hasWake(
      delivery.receipt.task.taskId,
      wake.sourceSignalId,
      wake.targetProfileId
    )
  );
}
export class SpaceTaskDeliveryError extends Error {
  readonly terminal: boolean;
  constructor(message: string, terminal = false) {
    super(message);
    this.terminal = terminal;
  }
}
export async function flushSpaceTaskDeliveries(input: {
  repository: SpaceTaskDeliveryRepository;
  deliver: (delivery: SpaceTaskDelivery) => Promise<void>;
  onFailure: (delivery: SpaceTaskDelivery, error: unknown) => void;
}): Promise<void> {
  input.repository.cleanupTerminal(Date.now());
  for (const delivery of input.repository.pending(Date.now())) {
    try {
      await input.deliver(delivery);
      input.repository.complete(delivery.id);
    } catch (error) {
      input.onFailure(delivery, error);
      input.repository.fail(
        delivery.id,
        Date.now(),
        error instanceof SpaceTaskDeliveryError
          ? error.message
          : "Delivery failed. OpenMeld will retry automatically.",
        error instanceof SpaceTaskDeliveryError && error.terminal
      );
    }
  }
}
