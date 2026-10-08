import type { PostgresDatabase } from "@openmeld/db/postgresql";
import {
  buildAgentTaskKey,
  type centerAgentContinueTaskSummaryResponseSchema,
  getSpaceDispatchLookupResponseSchema,
  getSpaceMessageDetailsResponseSchema,
  remoteAgentWorkerExecutionQueryResponseSchema,
  taskSummaryRecoveryAccessResponseSchema,
} from "@openmeld/schemas";
import type {
  AgentTaskContinuation,
  AgentTaskHandle,
  AgentTaskTerminalOutcome,
  RemoteAgentWorkerExecutionQuery,
  WorkingLanguageTag,
} from "@openmeld/schemas/types";
import { digestCanonicalJson } from "@openmeld/utils";
import { enqueueAgentTaskContinuationMessages } from "../../agent-task-coordination/application/agent-task-terminal-outcome-service";
import { readAgentDelegation } from "../../agent-task-coordination/infrastructure/postgresql/agent-delegation-repo";
import {
  type AgentTaskCompletionSubscriptionRecord,
  readAgentTaskCompletionSubscription,
  readAgentTaskTerminalOutcome,
  recordTaskSummaryRecoveryIntent,
  registerManualTaskSummaryRecovery,
} from "../../agent-task-coordination/infrastructure/postgresql/agent-task-coordination-repo";
import type { CoreBindings } from "../../lib/bindings";
import { requestRemoteAgentWorkerCancellation } from "../../remote-agent/application/native-delivery-cancellation-service";
import { resolveRemoteAgentNativeDeliveryRuntimeConversationId } from "../../remote-agent/application/remote-agent-conversation-continuity";
import { readRemoteAgentWorkerAdmissionStop } from "../../remote-agent/application/remote-agent-worker-admission";
import { readActiveRepresentedHumanSender } from "../../remote-agent/application/turn-envelope";
import {
  type RemoteAgentNativeDeliveryRecord,
  readRemoteAgentNativeDeliveryByDeliveryId,
  readRemoteAgentNativeDeliveryByIdempotencyKey,
} from "../../remote-agent/infrastructure/postgresql/native-delivery-ledger-repo";
import { readCoreRpcHttpStatus } from "../../rpc/errors";
import { resolveSpaceStub } from "../../rpc/space-ref";
export async function isTaskSummaryRecoveryAuthorized(input: {
  db: PostgresDatabase;
  env: CoreBindings;
  observer: RemoteAgentNativeDeliveryRecord;
  operatorUserId: string;
}): Promise<boolean> {
  const observer = input.observer;
  // First release supports the original requester only. Both live permission
  // checks therefore refer to the same verified person, never a saved grant.
  if (
    observer.conversationKind !== "space" ||
    observer.onBehalfOfUserId !== input.operatorUserId ||
    !observer.onBehalfOfProfileId
  ) {
    return false;
  }
  const member = await readActiveRepresentedHumanSender({
    db: input.db,
    organizationId: observer.organizationId,
    profileId: observer.onBehalfOfProfileId,
    userId: input.operatorUserId,
  });
  if (!member) {
    return false;
  }
  const space = resolveSpaceStub(input.env.OPENMELD_SPACES, observer.spaceId);
  if (!space) {
    return false;
  }
  return taskSummaryRecoveryAccessResponseSchema.parse(
    await space.rpcCheckTaskSummaryRecoveryAccess({
      spaceId: observer.spaceId,
      profileId: observer.onBehalfOfProfileId,
      ownerUserId: input.operatorUserId,
    })
  ).allowed;
}
/** Starts a fresh summary continuation, never a replay of the child request. */
export async function continueTaskSummary(input: {
  actorProfileId: string;
  db: PostgresDatabase;
  env: CoreBindings;
  inspectOnly: boolean;
  includePublishedResult?: boolean;
  nowMs: number;
  operatorUserId: string;
  organizationId: string;
  sourceSubscriptionId: string;
  replyLanguageTag?: WorkingLanguageTag;
}): Promise<
  ReturnType<typeof centerAgentContinueTaskSummaryResponseSchema.parse>
> {
  const unavailable = (reasonCode: string) => ({
    status: "unavailable" as const,
    sourceSubscriptionId: input.sourceSubscriptionId,
    subscriptionId: null,
    reasonCode,
  });
  const source = await readAgentTaskCompletionSubscription({
    db: input.db,
    subscriptionId: input.sourceSubscriptionId,
  });
  if (!isSummarySource(source, input.organizationId, input.inspectOnly)) {
    return unavailable("task_summary_recovery.unavailable");
  }
  const observer = await readRemoteAgentNativeDeliveryByDeliveryId({
    db: input.db,
    deliveryId: source.observerTask.deliveryId,
  });
  if (
    !observer ||
    observer.profileId !== input.actorProfileId ||
    !(await isTaskSummaryRecoveryAuthorized({ ...input, observer }))
  ) {
    return unavailable("task_summary_recovery.not_authorized");
  }
  const parent = await readAgentTaskTerminalOutcome({
    db: input.db,
    taskKey: buildAgentTaskKey(source.observerTask),
  });
  if (parent?.outcome.status === "stopped") {
    return unavailable("task_summary_recovery.stopped");
  }
  const subscriptionId = `summary:${await digestCanonicalJson({ sourceSubscriptionId: source.subscriptionId })}`;
  const existing = await readAgentTaskCompletionSubscription({
    db: input.db,
    subscriptionId,
  });
  if (existing) {
    return await readExistingSummaryRecovery({
      ...input,
      observer,
      recovery: existing,
    });
  }
  const delegation = await readAgentDelegation({
    db: input.db,
    delegationId: source.continuation.delegationId,
  });
  if (
    !delegation ||
    delegation.state !== "completed" ||
    delegation.organizationId !== source.organizationId ||
    buildAgentTaskKey(delegation.parentTask) !==
      buildAgentTaskKey(source.observerTask)
  ) {
    return unavailable("task_summary_recovery.children_unsettled");
  }
  const old = await readRemoteAgentNativeDeliveryByIdempotencyKey({
    db: input.db,
    idempotencyKey: source.continuationIdempotencyKey,
  });
  const worker = input.env.OPENMELD_REMOTE_AGENT_WORKER;
  const stopRequest =
    old?.workerSubmitRequest ?? old?.executionRecoverySubmitRequest;
  if (
    !(
      old?.submissionId &&
      stopRequest &&
      worker?.reconcileExecution &&
      worker.readAdmissionStop
    )
  ) {
    return unavailable("task_summary_recovery.execution_unconfirmed");
  }
  const conversationId =
    resolveRemoteAgentNativeDeliveryRuntimeConversationId(old);
  const identity = {
    v: 1 as const,
    idempotencyKey: old.idempotencyKey,
    organizationId: old.organizationId,
    spaceId: old.spaceId,
    submissionId: old.submissionId,
    ...(conversationId ? { conversationId } : {}),
  };
  const reconciled = remoteAgentWorkerExecutionQueryResponseSchema.parse(
    await worker.reconcileExecution(identity)
  );
  const executionRejection = resolveSummaryExecutionRejection(
    reconciled,
    identity
  );
  if (executionRejection) {
    return unavailable(executionRejection);
  }
  const receiverRejection = await readSummaryReceiverRejection(
    {
      request: stopRequest,
      worker,
    },
    resolveOwnedSummaryRecoveryId(source, subscriptionId, input.operatorUserId)
  );
  if (receiverRejection) {
    return unavailable(receiverRejection);
  }
  if (
    !(
      await readVerifiedSummaryResults({
        ...input,
        source,
        observer,
        delegation,
      })
    ).length
  ) {
    return unavailable("task_summary_recovery.no_verified_results");
  }
  const currentAccessRejection = await readSummaryRecoveryAccessRejection({
    ...input,
    observer,
  });
  if (currentAccessRejection) {
    return unavailable(currentAccessRejection);
  }
  if (input.inspectOnly) {
    return {
      status: "available" as const,
      sourceSubscriptionId: source.subscriptionId,
      subscriptionId: null,
      reasonCode: null,
    };
  }
  const intent = await recordTaskSummaryRecoveryIntent({
    ...input,
    source,
    recoveryId: subscriptionId,
  });
  if (!intent) {
    return unavailable("task_summary_recovery.stopped");
  }
  await requestRemoteAgentWorkerCancellation({
    delivery: old,
    env: input.env,
    submissionId: old.submissionId,
    reason: "The requester chose a fresh summary of existing results.",
    summaryRecoveryId: subscriptionId,
  });
  const fence = await readRemoteAgentWorkerAdmissionStop({
    request: stopRequest,
    worker,
  });
  const fenceRejection = resolveSummaryFenceRejection(
    fence,
    old,
    subscriptionId
  );
  if (fenceRejection) {
    return unavailable(fenceRejection);
  }
  const admissionAccessRejection = await readSummaryRecoveryAccessRejection({
    ...input,
    observer,
  });
  if (admissionAccessRejection) {
    return unavailable(admissionAccessRejection);
  }
  const recovery = await registerManualTaskSummaryRecovery({
    db: input.db,
    nowMs: input.nowMs,
    operatorUserId: input.operatorUserId,
    source: intent,
    subscriptionId,
    replyLanguageTag: input.replyLanguageTag,
  });
  if (recovery.state !== "ready") {
    return await readExistingSummaryRecovery({ ...input, observer, recovery });
  }
  await enqueueAgentTaskContinuationMessages({
    env: input.env,
    nowMs: input.nowMs,
    subscriptionIds: [subscriptionId],
  });
  return {
    status: "queued" as const,
    sourceSubscriptionId: source.subscriptionId,
    subscriptionId,
    reasonCode: null,
  };
}
function resolveSummaryFenceRejection(
  fence: Awaited<ReturnType<typeof readRemoteAgentWorkerAdmissionStop>>,
  old: RemoteAgentNativeDeliveryRecord,
  recoveryId: string
): string | null {
  if (
    fence?.status !== "found" ||
    fence.stopIntent.idempotencyKey !== old.idempotencyKey ||
    fence.stopIntent.organizationId !== old.organizationId ||
    fence.stopIntent.spaceId !== old.spaceId
  ) {
    return "task_summary_recovery.stop_unconfirmed";
  }
  return fence.stopIntent.summaryRecoveryId === recoveryId
    ? null
    : "task_summary_recovery.stopped";
}
function resolveOwnedSummaryRecoveryId(
  source: SummarySource,
  recoveryId: string,
  operatorUserId: string
): string | undefined {
  const intent = source.continuation.summaryRecoveryIntent;
  return intent?.recoveryId === recoveryId &&
    intent.operatorUserId === operatorUserId
    ? recoveryId
    : undefined;
}
async function readSummaryRecoveryAccessRejection(
  input: Parameters<typeof isTaskSummaryRecoveryAuthorized>[0]
): Promise<string | null> {
  if (!(await isTaskSummaryRecoveryAuthorized(input))) {
    return "task_summary_recovery.not_authorized";
  }
  const parent = await readAgentTaskTerminalOutcome({
    db: input.db,
    taskKey: buildAgentTaskKey({
      v: 1,
      kind: "native_delivery",
      deliveryId: input.observer.deliveryId,
    }),
  });
  return parent?.outcome.status === "stopped"
    ? "task_summary_recovery.stopped"
    : null;
}
async function readSummaryReceiverRejection(
  input: Parameters<typeof readRemoteAgentWorkerAdmissionStop>[0],
  recoveryId?: string
): Promise<string | null> {
  const { request, worker } = input;
  if (request.turnEnvelope.trigger.source !== "task_continuation") {
    return "task_summary_recovery.receiver_unsupported";
  }
  // Probe the existing read-only receipt, without changing its identity or
  // creating admission. Old strict receivers reject this opt-in field.
  let support: Awaited<ReturnType<typeof readRemoteAgentWorkerAdmissionStop>>;
  try {
    support = await readRemoteAgentWorkerAdmissionStop({
      worker,
      request: {
        ...request,
        turnEnvelope: {
          ...request.turnEnvelope,
          trigger: { ...request.turnEnvelope.trigger, summaryOnly: true },
        },
      },
    });
  } catch {
    return "task_summary_recovery.receiver_unsupported";
  }
  if (
    !(support?.summaryOnlySupported && support.summaryRecoveryFenceSupported)
  ) {
    return "task_summary_recovery.receiver_unsupported";
  }
  if (
    support.status === "found" &&
    (!recoveryId || support.stopIntent.summaryRecoveryId !== recoveryId)
  ) {
    return "task_summary_recovery.stopped";
  }
  return null;
}
async function readExistingSummaryRecovery(
  input: Parameters<typeof continueTaskSummary>[0] & {
    observer: RemoteAgentNativeDeliveryRecord;
    recovery: AgentTaskCompletionSubscriptionRecord;
  }
): Promise<
  ReturnType<typeof centerAgentContinueTaskSummaryResponseSchema.parse>
> {
  const { recovery, observer } = input;
  const receipt = (
    status: "already_requested" | "unavailable",
    reasonCode: string | null
  ) => ({
    status,
    reasonCode,
    sourceSubscriptionId: input.sourceSubscriptionId,
    subscriptionId: recovery.subscriptionId,
  });
  if (
    recovery.organizationId !== input.organizationId ||
    recovery.continuation?.kind !== "resume_agent" ||
    recovery.continuation.summaryRecovery?.sourceSubscriptionId !==
      input.sourceSubscriptionId ||
    recovery.continuation.summaryRecovery.operatorUserId !==
      input.operatorUserId ||
    buildAgentTaskKey(recovery.observerTask) !==
      buildAgentTaskKey({
        v: 1,
        kind: "native_delivery",
        deliveryId: observer.deliveryId,
      })
  ) {
    return receipt("unavailable", "task_summary_recovery.identity_mismatch");
  }
  if (recovery.state === "cancelled") {
    return receipt("unavailable", "task_summary_recovery.cancelled");
  }
  if (recovery.state === "ready" || recovery.state === "continuation_claimed") {
    if (!input.inspectOnly) {
      await enqueueAgentTaskContinuationMessages({
        env: input.env,
        nowMs: input.nowMs,
        subscriptionIds: [recovery.subscriptionId],
      });
    }
    return receipt("already_requested", null);
  }
  if (
    recovery.state !== "settled" ||
    recovery.continuationTask?.kind !== "native_delivery"
  ) {
    return receipt(
      "unavailable",
      "task_summary_recovery.execution_unconfirmed"
    );
  }
  const delivery = await readRemoteAgentNativeDeliveryByDeliveryId({
    db: input.db,
    deliveryId: recovery.continuationTask.deliveryId,
  });
  if (
    !delivery ||
    delivery.organizationId !== input.organizationId ||
    delivery.profileId !== observer.profileId ||
    delivery.spaceId !== observer.spaceId ||
    delivery.idempotencyKey !== recovery.continuationIdempotencyKey
  ) {
    return receipt(
      "unavailable",
      "task_summary_recovery.execution_unconfirmed"
    );
  }
  if (["submitted", "accepted", "retry_observed"].includes(delivery.status)) {
    return receipt("already_requested", null);
  }
  if (delivery.status !== "completed") {
    return receipt("unavailable", "task_summary_recovery.failed");
  }
  const completed = receipt("unavailable", "task_summary_recovery.completed");
  if (!input.includePublishedResult) {
    return completed;
  }
  const publishedResult = await readVerifiedSummaryPublication({
    ...input,
    delivery,
  });
  return publishedResult
    ? { ...completed, publishedResult }
    : receipt("unavailable", "task_summary_recovery.result_unavailable");
}
async function readVerifiedSummaryPublication(input: {
  env: CoreBindings;
  observer: RemoteAgentNativeDeliveryRecord;
  delivery: RemoteAgentNativeDeliveryRecord;
  operatorUserId: string;
}) {
  const { delivery, observer } = input;
  if (!delivery.publishedSignalId) {
    return null;
  }
  const space = resolveSpaceStub(input.env.OPENMELD_SPACES, delivery.spaceId);
  if (!space) {
    return null;
  }
  const outcome = await space.rpcReadFinalReplyClaimOutcome({
    spaceId: delivery.spaceId,
    dispatchId: delivery.dispatchId,
    profileId: delivery.profileId,
  });
  if (
    outcome.outcome !== "success" ||
    outcome.signalId !== delivery.publishedSignalId
  ) {
    return null;
  }
  try {
    const details = getSpaceMessageDetailsResponseSchema.parse(
      await space.rpcGetMessageDetails({
        spaceId: delivery.spaceId,
        signalId: delivery.publishedSignalId,
        context: {
          actorContext: {
            requestId: `summary-publication:${delivery.deliveryId}`,
            openMeldProfileId: observer.onBehalfOfProfileId ?? "",
            ownerUserId: input.operatorUserId,
            profileKind: "human",
          },
        },
      })
    );
    return details.query.spaceId === delivery.spaceId &&
      details.message.signalId === delivery.publishedSignalId &&
      details.message.actor.profileId === delivery.profileId &&
      details.message.signalType === "signal.text"
      ? { spaceId: delivery.spaceId, signalId: delivery.publishedSignalId }
      : null;
  } catch (error) {
    if ([403, 404].includes(readCoreRpcHttpStatus(error) ?? 0)) {
      return null;
    }
    throw error;
  }
}
function resolveSummaryExecutionRejection(
  reconciled: ReturnType<
    typeof remoteAgentWorkerExecutionQueryResponseSchema.parse
  >,
  identity: RemoteAgentWorkerExecutionQuery
): string | null {
  if (
    reconciled.status !== "found" ||
    reconciled.execution.idempotencyKey !== identity.idempotencyKey ||
    reconciled.execution.organizationId !== identity.organizationId ||
    reconciled.execution.spaceId !== identity.spaceId ||
    reconciled.execution.submissionId !== identity.submissionId
  ) {
    return "task_summary_recovery.execution_unconfirmed";
  }
  if (["failed", "aborted"].includes(reconciled.execution.status)) {
    return null;
  }
  return reconciled.execution.status === "completed"
    ? "task_summary_recovery.retained_result_recovery_required"
    : "task_summary_recovery.execution_running";
}
type SummarySource = AgentTaskCompletionSubscriptionRecord & {
  continuation: Extract<
    AgentTaskContinuation,
    {
      kind: "resume_agent";
    }
  >;
  continuationIdempotencyKey: string;
  outcome: AgentTaskTerminalOutcome;
  observerTask: Extract<
    AgentTaskHandle,
    {
      kind: "native_delivery";
    }
  >;
};
function isSummarySource(
  source: AgentTaskCompletionSubscriptionRecord | null,
  organizationId: string,
  inspectOnly: boolean
): source is SummarySource {
  return Boolean(
    source &&
      source.organizationId === organizationId &&
      source.continuation?.kind === "resume_agent" &&
      !source.continuation.summaryRecovery &&
      source.observerTask.kind === "native_delivery" &&
      source.continuationIdempotencyKey &&
      source.outcome &&
      source.outcome.status !== "needs_attention" &&
      (["settled", "cancelled"].includes(source.state) ||
        (inspectOnly && source.state === "continuation_claimed"))
  );
}
export async function readVerifiedSummaryResults(input: {
  env: CoreBindings;
  operatorUserId: string;
  observer: RemoteAgentNativeDeliveryRecord;
  source: Pick<AgentTaskCompletionSubscriptionRecord, "subscriptionId">;
  delegation: NonNullable<Awaited<ReturnType<typeof readAgentDelegation>>>;
  publicationSpaceId?: string;
}): Promise<
  Array<{
    spaceId: string;
    signalId: string;
  }>
> {
  const { observer, source, delegation } = input;
  // Verify existing Space results at their owning reader, with current human
  // access, before offering a summary. Missing results are never guessed.
  const verifiedResults: Array<{
    spaceId: string;
    signalId: string;
  }> = [];
  for (const child of delegation.children) {
    const signalId = child.terminalOutcome?.publishedSignalId;
    if (
      !signalId ||
      child.task.kind !== "space_wake" ||
      (input.publicationSpaceId &&
        child.task.spaceId !== input.publicationSpaceId) ||
      child.terminalOutcome?.status !== "succeeded"
    ) {
      continue;
    }
    const space = resolveSpaceStub(
      input.env.OPENMELD_SPACES,
      child.task.spaceId
    );
    if (!space) {
      continue;
    }
    try {
      const context = {
        actorContext: {
          requestId: `summary-result:${source.subscriptionId}`,
          openMeldProfileId: observer.onBehalfOfProfileId ?? "",
          ownerUserId: input.operatorUserId,
          profileKind: "human" as const,
        },
      };
      const details = getSpaceMessageDetailsResponseSchema.parse(
        await space.rpcGetMessageDetails({
          spaceId: child.task.spaceId,
          signalId,
          context,
        })
      );
      if (
        (await isClaimedChildResult({
          space,
          context,
          task: child.task,
          signalId,
          profileId: child.agentProfileId,
        })) &&
        details.query.spaceId === child.task.spaceId &&
        details.message.signalId === signalId &&
        details.message.signalType === "signal.text" &&
        details.message.actor.profileId === child.agentProfileId
      ) {
        verifiedResults.push({ spaceId: child.task.spaceId, signalId });
        if (verifiedResults.length >= 10) {
          break;
        }
      }
    } catch (error) {
      // A missing or revoked result is unavailable, not permission to look at
      // another person's conversation. Other failures remain retryable.
      const status = readCoreRpcHttpStatus(error);
      if (status !== 403 && status !== 404) {
        throw error;
      }
    }
  }
  return verifiedResults;
}
/** Public failure links stay in the current Space and retain owner validation. */
export async function readInterruptedTaskResults(input: {
  db: PostgresDatabase;
  env: CoreBindings;
  delivery: Pick<
    RemoteAgentNativeDeliveryRecord,
    | "workerSubmitRequest"
    | "executionRecoverySubmitRequest"
    | "onBehalfOfUserId"
    | "organizationId"
    | "idempotencyKey"
    | "spaceId"
    | "profileId"
  >;
}): Promise<
  Array<{
    spaceId: string;
    signalId: string;
  }>
> {
  const { delivery } = input;
  const request =
    delivery.workerSubmitRequest ?? delivery.executionRecoverySubmitRequest;
  const trigger = request?.turnEnvelope.trigger;
  if (
    trigger?.source !== "task_continuation" ||
    !delivery.onBehalfOfUserId ||
    request?.organizationId !== delivery.organizationId ||
    request.spaceId !== delivery.spaceId ||
    request.agentProfileId !== delivery.profileId ||
    request.idempotencyKey !== delivery.idempotencyKey
  ) {
    return [];
  }
  const source = await readAgentTaskCompletionSubscription({
    db: input.db,
    subscriptionId: trigger.subscriptionId,
  });
  if (
    !source ||
    source.organizationId !== delivery.organizationId ||
    source.continuationIdempotencyKey !== delivery.idempotencyKey ||
    source.continuation?.kind !== "resume_agent" ||
    source.continuation.delegationId !== trigger.delegationId ||
    buildAgentTaskKey(source.watchedTask) !==
      buildAgentTaskKey(trigger.watchedTask) ||
    source.observerTask.kind !== "native_delivery"
  ) {
    return [];
  }
  const observer = await readRemoteAgentNativeDeliveryByDeliveryId({
    db: input.db,
    deliveryId: source.observerTask.deliveryId,
  });
  if (
    !observer ||
    observer.organizationId !== delivery.organizationId ||
    observer.spaceId !== delivery.spaceId ||
    observer.profileId !== delivery.profileId ||
    observer.onBehalfOfUserId !== delivery.onBehalfOfUserId ||
    !(await isTaskSummaryRecoveryAuthorized({
      ...input,
      observer,
      operatorUserId: delivery.onBehalfOfUserId,
    }))
  ) {
    return [];
  }
  const delegation = await readAgentDelegation({
    db: input.db,
    delegationId: trigger.delegationId,
  });
  if (
    !delegation ||
    delegation.organizationId !== delivery.organizationId ||
    buildAgentTaskKey(delegation.parentTask) !==
      buildAgentTaskKey(source.observerTask)
  ) {
    return [];
  }
  const results = await readVerifiedSummaryResults({
    ...input,
    source,
    observer,
    delegation,
    operatorUserId: delivery.onBehalfOfUserId,
    publicationSpaceId: delivery.spaceId,
  });
  return (await isTaskSummaryRecoveryAuthorized({
    ...input,
    observer,
    operatorUserId: delivery.onBehalfOfUserId,
  }))
    ? results
    : [];
}
async function isClaimedChildResult(input: {
  space: NonNullable<ReturnType<typeof resolveSpaceStub>>;
  context: Parameters<
    NonNullable<ReturnType<typeof resolveSpaceStub>>["rpcGetDispatchLookup"]
  >[0]["context"];
  task: Extract<
    AgentTaskHandle,
    {
      kind: "space_wake";
    }
  >;
  signalId: string;
  profileId: string;
}): Promise<boolean> {
  const { space, context, task, profileId, signalId } = input;
  const lookup = getSpaceDispatchLookupResponseSchema.parse(
    await space.rpcGetDispatchLookup({
      context,
      spaceId: task.spaceId,
      clientMessageId: task.sourceClientMessageId,
      targetProfileId: profileId,
    })
  );
  if (
    lookup.query.spaceId !== task.spaceId ||
    lookup.query.clientMessageId !== task.sourceClientMessageId ||
    lookup.query.targetProfileId !== profileId
  ) {
    return false;
  }
  const matches = lookup.matches.filter(
    (match) => match.targetProfileId === profileId
  );
  const match = matches.length === 1 ? matches[0] : null;
  if (!match) {
    return false;
  }
  const claim = await space.rpcReadFinalReplyClaimOutcome({
    spaceId: task.spaceId,
    dispatchId: match.dispatchId,
    profileId,
  });
  return claim.outcome === "success" && claim.signalId === signalId;
}
