import type {
  SpaceTask,
  SpaceTaskActor,
  SpaceTaskMutationReceipt,
} from "@openmeld/schemas/types";
import type {
  SpaceTaskDelivery,
  SpaceTaskDeliveryRepository,
} from "../infrastructure/sql/space-task-delivery-repo";
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
  sourceDispatchChainContext?: SourceDispatchChainContext;
}): void {
  const { task, event } = input.receipt;
  const enqueue = (kind: SpaceTaskDelivery["kind"]) =>
    input.repository.enqueue(
      {
        id: `${event.eventId}:${kind}`,
        kind,
        receipt: input.receipt,
        actor: input.authorizedActor ? event.actor : null,
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
    task.externalWorkItems.length ||
    input.previous?.externalWorkItems.length
  ) {
    enqueue("github_projection");
  }
  if (
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
  if (event.type === "canceled" && input.authorizedActor) {
    enqueue("stop");
  }
}

/** Rechecked inside Signal persistence, after asynchronous admission reads. */
export function isSpaceTaskDeliveryCurrent(
  delivery: SpaceTaskDelivery,
  current: SpaceTask
): boolean {
  const { task, event } = delivery.receipt;
  if (delivery.kind === "completion") {
    return (
      current.phase === "done" &&
      current.result?.resultRevision === task.result?.resultRevision
    );
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
  return (
    current.assignee?.profileId === task.assignee?.profileId &&
    current.review?.reviewedAt === task.review?.reviewedAt &&
    (current.phase === "in_progress" || current.needsHumanDecision)
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
