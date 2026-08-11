import type {
  AgentDelegationCompletionPolicy,
  AgentTaskHandle,
  CenterAgentDelegationCompletionMode,
} from "@openmeld/schemas/types";
import {
  cancelAgentDelegationWithSubscriptions,
  createAgentDelegation,
  readAgentDelegation,
} from "../../agent-task-coordination/infrastructure/d1/agent-delegation-repo";
import { registerAgentTaskCompletionSubscription } from "../../agent-task-coordination/infrastructure/d1/agent-task-coordination-repo";
import {
  readRemoteAgentNativeDeliveryByDeliveryId,
  readRemoteAgentNativeDeliveryBySubmissionId,
} from "../../remote-agent/infrastructure/d1/native-delivery-ledger-repo";
import {
  claimRoutineRunContinuationDelegation,
  readRoutineRunExecutionRecord,
  releaseRoutineRunContinuationDelegation,
} from "../../routines/routine-repository";

export type PreparedCenterAgentWakeDelegation = {
  childTasks: Array<{
    completionCondition: "terminal";
    subscriptionId: string;
    task: AgentTaskHandle & { kind: "space_wake" };
  }>;
  delegationId: string;
  fallbackTask?: {
    activationSubscriptionId: string;
    completionCondition: "terminal";
    subscriptionId: string;
    task: AgentTaskHandle & { kind: "space_wake" };
  };
  subscriptionIds: string[];
};

export type CenterAgentParentDelivery = NonNullable<
  Awaited<ReturnType<typeof readRemoteAgentNativeDeliveryBySubmissionId>>
>;

export function planCenterAgentWakeDelegation(input: {
  childSpaceId: string;
  clientMessageId: string;
  fallbackAgentProfileId?: string;
  targetProfileIds: string[];
}): PreparedCenterAgentWakeDelegation {
  if (input.fallbackAgentProfileId && input.targetProfileIds.length !== 1) {
    throw new CenterAgentDelegationPreparationError(
      "center_agent.delegation_fallback_requires_one_primary",
      "Fallback delegation requires exactly one primary Agent."
    );
  }
  const delegationId = buildDelegationId(input.clientMessageId);
  const childTasks = input.targetProfileIds.map((targetProfileId) => ({
    completionCondition: "terminal" as const,
    subscriptionId: buildSubscriptionId(input.clientMessageId, targetProfileId),
    task: {
      kind: "space_wake" as const,
      sourceClientMessageId: input.clientMessageId,
      spaceId: input.childSpaceId,
      targetProfileId,
      v: 1 as const,
    },
  }));
  const fallbackTask = buildPreparedFallbackTask(input);
  return {
    childTasks,
    delegationId,
    ...(fallbackTask ? { fallbackTask } : {}),
    subscriptionIds: [
      ...childTasks.map((child) => child.subscriptionId),
      ...(fallbackTask
        ? [fallbackTask.activationSubscriptionId, fallbackTask.subscriptionId]
        : []),
    ],
  };
}

export async function prepareCenterAgentWakeDelegation(input: {
  actorProfileId: string;
  childSpaceId: string;
  clientMessageId: string;
  completionMode: CenterAgentDelegationCompletionMode;
  db: D1Database;
  destinationNeutralContinuations?: boolean;
  fallbackAgentProfileId?: string;
  nowMs: number;
  organizationId: string;
  parentSubmissionId: string;
  targetProfileIds: string[];
  text: string;
}): Promise<PreparedCenterAgentWakeDelegation> {
  const prepared = planCenterAgentWakeDelegation(input);
  const resumesParent = input.completionMode !== "child_reports_directly";
  const parentDelivery = await requireCenterAgentContinuationParent({
    actorProfileId: input.actorProfileId,
    destinationNeutralContinuations:
      input.destinationNeutralContinuations === true,
    db: input.db,
    organizationId: input.organizationId,
    parentSubmissionId: input.parentSubmissionId,
    resumesParent,
    ...(resumesParent
      ? { continuationDelegationId: prepared.delegationId }
      : {}),
    ...(resumesParent
      ? { routineDelegationCompletionMode: input.completionMode }
      : {}),
  });

  const parentTask: AgentTaskHandle = {
    deliveryId: parentDelivery.deliveryId,
    kind: "native_delivery",
    v: 1,
  };
  const { childTasks, delegationId, fallbackTask, subscriptionIds } = prepared;
  const completionPolicy = buildDelegationCompletionPolicy(
    input.completionMode
  );

  try {
    const delegation = await createAgentDelegation({
      children: [
        ...childTasks.map((child) => ({
          agentProfileId: child.task.targetProfileId,
          role: "primary" as const,
          task: child.task,
        })),
        ...(fallbackTask
          ? [
              {
                agentProfileId: fallbackTask.task.targetProfileId,
                role: "fallback" as const,
                task: fallbackTask.task,
              },
            ]
          : []),
      ],
      completionPolicy,
      db: input.db,
      delegationId,
      idempotencyKey: buildDelegationIdempotencyKey(input.clientMessageId),
      nowMs: input.nowMs,
      organizationId: input.organizationId,
      parentTask,
      spaceId: input.childSpaceId,
    });
    if (delegation.state === "cancelled" || delegation.state === "failed") {
      throw new CenterAgentDelegationPreparationError(
        "center_agent.delegation_not_reusable",
        "This cancelled delegation cannot be reused. Start a new Wake request."
      );
    }
    await registerPreparedDelegationSubscriptions({
      childTasks,
      db: input.db,
      delegationId,
      fallbackTask,
      input,
      observerTask: parentTask,
      parentDelivery,
      resumesParent,
    });
  } catch (error) {
    await cancelPreparedCenterAgentWakeDelegation({
      db: input.db,
      delegationId,
      nowMs: input.nowMs,
      parentDelivery,
      subscriptionIds,
    });
    throw error;
  }
  return prepared;
}

export async function requireCenterAgentContinuationParent(input: {
  actorProfileId: string;
  continuationDelegationId?: string;
  destinationNeutralContinuations: boolean;
  db: D1Database;
  organizationId: string;
  parentSubmissionId: string;
  resumesParent: boolean;
  routineDelegationCompletionMode?: CenterAgentDelegationCompletionMode;
}): Promise<CenterAgentParentDelivery> {
  const parentDelivery = await readRemoteAgentNativeDeliveryBySubmissionId({
    db: input.db,
    submissionId: input.parentSubmissionId,
  });
  const isActiveParent =
    parentDelivery?.status === "accepted" ||
    parentDelivery?.status === "retry_observed";
  if (
    !parentDelivery ||
    parentDelivery.organizationId !== input.organizationId ||
    parentDelivery.profileId !== input.actorProfileId ||
    !isActiveParent
  ) {
    throw new CenterAgentDelegationPreparationError(
      "center_agent.delegation_parent_unavailable",
      "The active Center Agent task could not be linked to this delegation."
    );
  }
  if (
    input.resumesParent &&
    !input.destinationNeutralContinuations &&
    !parentDelivery.routineRunId &&
    parentDelivery.conversationKind !== "space"
  ) {
    throw new CenterAgentDelegationPreparationError(
      "center_agent.delegation_parent_continuation_unsupported",
      "Parent continuation currently requires an OpenMeld Space conversation."
    );
  }
  if (input.resumesParent && parentDelivery.routineRunId) {
    await assertRoutineDelegationContinuationAllowed({
      completionMode: input.routineDelegationCompletionMode,
      delegationId: input.continuationDelegationId,
      db: input.db,
      parentDelivery: {
        ...parentDelivery,
        routineRunId: parentDelivery.routineRunId,
      },
    });
  }
  if (
    input.resumesParent &&
    !(parentDelivery.onBehalfOfProfileId && parentDelivery.onBehalfOfUserId)
  ) {
    throw new CenterAgentDelegationPreparationError(
      "center_agent.delegation_requester_unavailable",
      "Parent continuation requires a verified human requester."
    );
  }
  return parentDelivery;
}

async function assertRoutineDelegationContinuationAllowed(input: {
  completionMode: CenterAgentDelegationCompletionMode | undefined;
  delegationId: string | undefined;
  db: D1Database;
  parentDelivery: CenterAgentParentDelivery & { routineRunId: string };
}): Promise<void> {
  if (input.completionMode !== "resume_parent_when_all_terminal") {
    throw new CenterAgentDelegationPreparationError(
      input.completionMode
        ? "center_agent.routine_delegation_requires_all_terminal"
        : "center_agent.delegation_routine_continuation_unsupported",
      input.completionMode
        ? "Routine delegation must wait for all child tasks before the Center Agent continues."
        : "Task watch continuation is not available for unattended Routine runs."
    );
  }
  const run = await readRoutineRunExecutionRecord({
    db: input.db,
    runId: input.parentDelivery.routineRunId,
  });
  if (
    run?.executionEngine !== "workflow" ||
    run.status !== "submitted" ||
    run.nativeDeliveryId !== input.parentDelivery.deliveryId
  ) {
    throw new CenterAgentDelegationPreparationError(
      "center_agent.routine_delegation_parent_unavailable",
      "This Routine Run cannot safely hand its final result to a continuation."
    );
  }
  if (
    input.parentDelivery.idempotencyKey !== input.parentDelivery.routineRunId
  ) {
    throw new CenterAgentDelegationPreparationError(
      "center_agent.routine_delegation_limit_reached",
      "A Routine Run can resume its Center Agent once after delegated work. Finish this Run with the available results."
    );
  }
  if (!input.delegationId) {
    throw new CenterAgentDelegationPreparationError(
      "center_agent.routine_delegation_parent_unavailable",
      "This Routine Run cannot identify its continuation delegation."
    );
  }
  const claim = await claimRoutineRunContinuationDelegation({
    db: input.db,
    delegationId: input.delegationId,
    nativeDeliveryId: input.parentDelivery.deliveryId,
    organizationId: input.parentDelivery.organizationId,
    runId: input.parentDelivery.routineRunId,
  });
  if (claim === "conflict") {
    throw new CenterAgentDelegationPreparationError(
      "center_agent.routine_delegation_limit_reached",
      "A Routine Run can resume its Center Agent once after delegated work. Finish this Run with the available results."
    );
  }
}

function buildPreparedFallbackTask(input: {
  childSpaceId: string;
  clientMessageId: string;
  fallbackAgentProfileId?: string;
}): PreparedCenterAgentWakeDelegation["fallbackTask"] {
  if (!input.fallbackAgentProfileId) {
    return undefined;
  }
  const sourceClientMessageId = buildFallbackClientMessageId(
    input.clientMessageId
  );
  return {
    activationSubscriptionId: buildFallbackActivationSubscriptionId(
      input.clientMessageId
    ),
    completionCondition: "terminal",
    subscriptionId: buildSubscriptionId(
      sourceClientMessageId,
      input.fallbackAgentProfileId
    ),
    task: {
      kind: "space_wake",
      sourceClientMessageId,
      spaceId: input.childSpaceId,
      targetProfileId: input.fallbackAgentProfileId,
      v: 1,
    },
  };
}

function buildDelegationCompletionPolicy(
  completionMode: CenterAgentDelegationCompletionMode
): AgentDelegationCompletionPolicy {
  return completionMode === "child_reports_directly"
    ? { mode: "child_reports_directly" }
    : {
        mode: "resume_parent",
        when: mapCompletionModeToBarrier(completionMode),
      };
}

async function registerPreparedDelegationSubscriptions(input: {
  childTasks: PreparedCenterAgentWakeDelegation["childTasks"];
  db: D1Database;
  delegationId: string;
  fallbackTask: PreparedCenterAgentWakeDelegation["fallbackTask"];
  input: Parameters<typeof prepareCenterAgentWakeDelegation>[0];
  observerTask: AgentTaskHandle;
  parentDelivery: CenterAgentParentDelivery;
  resumesParent: boolean;
}): Promise<void> {
  for (const child of input.childTasks) {
    await registerAgentTaskCompletionSubscription({
      completionCondition: child.completionCondition,
      continuation: input.resumesParent
        ? buildResumeParentContinuation({
            delegationId: input.delegationId,
            destinationNeutralContinuations:
              input.input.destinationNeutralContinuations === true,
            instruction:
              "Continue the original request after the delegated Agent task. Use the exact child outcome and published result; do not repeat work that already completed.",
            parentDelivery: input.parentDelivery,
          })
        : null,
      db: input.db,
      idempotencyKey: buildSubscriptionIdempotencyKey(
        input.input.clientMessageId,
        child.task.targetProfileId
      ),
      nowMs: input.input.nowMs,
      observerTask: input.observerTask,
      organizationId: input.input.organizationId,
      subscriptionId: child.subscriptionId,
      watchedTask: child.task,
    });
  }
  if (!input.fallbackTask) {
    return;
  }
  const primaryTask = input.childTasks[0]?.task;
  if (!primaryTask) {
    throw new Error("Fallback delegation lost its primary Agent task");
  }
  await registerAgentTaskCompletionSubscription({
    completionCondition: "failed",
    continuation: {
      agentProfileId: input.fallbackTask.task.targetProfileId,
      delegationId: input.delegationId,
      kind: "activate_fallback",
      spaceId: input.input.childSpaceId,
      text: input.input.text,
    },
    db: input.db,
    idempotencyKey: buildFallbackActivationSubscriptionIdempotencyKey(
      input.input.clientMessageId
    ),
    nowMs: input.input.nowMs,
    observerTask: input.observerTask,
    organizationId: input.input.organizationId,
    subscriptionId: input.fallbackTask.activationSubscriptionId,
    watchedTask: primaryTask,
  });
  await registerAgentTaskCompletionSubscription({
    completionCondition: input.fallbackTask.completionCondition,
    continuation: input.resumesParent
      ? buildResumeParentContinuation({
          delegationId: input.delegationId,
          destinationNeutralContinuations:
            input.input.destinationNeutralContinuations === true,
          instruction:
            "Continue the original request after the delegated Agent tasks. Use the exact delegation outcomes and published results; do not repeat work that already completed.",
          parentDelivery: input.parentDelivery,
        })
      : null,
    db: input.db,
    idempotencyKey: buildSubscriptionIdempotencyKey(
      input.fallbackTask.task.sourceClientMessageId,
      input.fallbackTask.task.targetProfileId
    ),
    nowMs: input.input.nowMs,
    observerTask: input.observerTask,
    organizationId: input.input.organizationId,
    subscriptionId: input.fallbackTask.subscriptionId,
    watchedTask: input.fallbackTask.task,
  });
}

function buildResumeParentContinuation(input: {
  delegationId: string;
  destinationNeutralContinuations: boolean;
  instruction: string;
  parentDelivery: CenterAgentParentDelivery;
}) {
  const continuation = {
    delegationId: input.delegationId,
    instruction: input.instruction,
    kind: "resume_agent" as const,
  };
  return input.destinationNeutralContinuations
    ? continuation
    : {
        ...continuation,
        sourceSignalId: input.parentDelivery.triggerMessageId,
        spaceId: input.parentDelivery.spaceId,
        threadContext: input.parentDelivery.threadContext,
      };
}

export async function cancelPreparedCenterAgentWakeDelegation(input: {
  db: D1Database;
  delegationId: string;
  nowMs: number;
  parentDelivery?: CenterAgentParentDelivery;
  subscriptionIds: string[];
}): Promise<void> {
  const delegation = await readAgentDelegation({
    db: input.db,
    delegationId: input.delegationId,
  });
  const parentDelivery =
    input.parentDelivery ??
    (delegation?.parentTask.kind === "native_delivery"
      ? await readRemoteAgentNativeDeliveryByDeliveryId({
          db: input.db,
          deliveryId: delegation.parentTask.deliveryId,
        })
      : null);
  await cancelAgentDelegationWithSubscriptions({
    db: input.db,
    delegationId: input.delegationId,
    nowMs: input.nowMs,
    subscriptionIds: input.subscriptionIds,
  });
  if (!parentDelivery?.routineRunId) {
    return;
  }
  await releaseRoutineRunContinuationDelegation({
    db: input.db,
    delegationId: input.delegationId,
    nativeDeliveryId: parentDelivery.deliveryId,
    organizationId: parentDelivery.organizationId,
    runId: parentDelivery.routineRunId,
  });
}

export class CenterAgentDelegationPreparationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "CenterAgentDelegationPreparationError";
  }
}

function buildDelegationId(clientMessageId: string): string {
  return `dlg:${clientMessageId}`;
}

function buildDelegationIdempotencyKey(clientMessageId: string): string {
  return `center-agent-delegation:${clientMessageId}`;
}

function buildSubscriptionId(
  clientMessageId: string,
  targetProfileId: string
): string {
  return `sub:${clientMessageId}:${targetProfileId}`;
}

function buildSubscriptionIdempotencyKey(
  clientMessageId: string,
  targetProfileId: string
): string {
  return `center-agent-delegation-subscription:${clientMessageId}:${targetProfileId}`;
}

function buildFallbackClientMessageId(clientMessageId: string): string {
  return `ca-fallback:${clientMessageId}`;
}

function buildFallbackActivationSubscriptionId(
  clientMessageId: string
): string {
  return `sub:${clientMessageId}:activate-fallback`;
}

function buildFallbackActivationSubscriptionIdempotencyKey(
  clientMessageId: string
): string {
  return `center-agent-delegation-fallback:${clientMessageId}`;
}

function mapCompletionModeToBarrier(
  mode: Exclude<CenterAgentDelegationCompletionMode, "child_reports_directly">
): Extract<AgentDelegationCompletionPolicy, { mode: "resume_parent" }>["when"] {
  switch (mode) {
    case "resume_parent_when_all_terminal":
      return "all_terminal";
    case "resume_parent_when_first_success":
      return "first_success";
    case "resume_parent_on_failure":
      return "on_failure";
    case "resume_parent_on_each_terminal":
      return "on_each_terminal";
    default:
      return assertNever(mode);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported Center Agent completion mode: ${String(value)}`);
}
