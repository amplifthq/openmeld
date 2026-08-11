import {
  buildMessageChannelConversationId,
  remoteAgentWorkerSubmitTurnRequestSchema,
} from "@openmeld/schemas";
import type {
  MessageChannelConversationLocator,
  RemoteAgentTurnEnvelope,
  RemoteAgentWorkerInputAttachment,
  RemoteAgentWorkerSubmitTurnRequest,
} from "@openmeld/schemas/types";
import type { CenterAgentMemoryService } from "../../center-agent-memory/memory-service";
import type { CoreBindings } from "../../lib/bindings";
import { readEnabledOrganizationSkillReleaseSelection } from "../../organization-skills/organization-skill-service";
import { readOrganizationAccountIdentityProjection } from "../../organizations/organization-context";
import { readRemoteAgentLarkPlatformChannelConnection } from "../infrastructure/d1/lark-platform-channel-connection-repo";
import { advanceRemoteAgentMessageChannelIdentityContinuationAttempt } from "../infrastructure/d1/message-channel-identity-link-token-repo";
import {
  markRemoteAgentNativeDeliveryFailure,
  persistRemoteAgentWorkerSubmitRequest,
  type RemoteAgentNativeDeliveryRecord,
  readRemoteAgentNativeDeliveryByDeliveryId,
  readRemoteAgentNativeDeliveryByIdempotencyKey,
  upsertRemoteAgentNativeDeliveryRecord,
} from "../infrastructure/d1/native-delivery-ledger-repo";
import {
  discardFrozenContextScopeForNewTurn,
  parseCoreOwnedRemoteAgentTurnEnvelope,
} from "./center-agent-context-scope";
import type { MessageChannelProviderRegistry } from "./message-channel-adapters";
import { cleanupMessageChannelInputAttachments } from "./message-channel-input-attachments";
import type { MessageChannelTurnTarget } from "./message-channel-turn-resolution";
import {
  type MessageChannelWorkingCardPreparationResult,
  prepareRemoteAgentMessageChannelWorkingCard,
} from "./message-channel-working-card-service";
import { markRemoteAgentNativeDeliveryAckWithProbe } from "./native-delivery-accepted-probe";
import {
  buildRemoteAgentAdmissionWatchdogSubmissionId,
  enqueueRemoteAgentAdmissionWatchdog,
} from "./native-delivery-admission-watchdog";
import { buildMessageChannelProviderPublicationUuid } from "./provider-publication-uuid";
import { attachCenterAgentMemoryToTurnEnvelope } from "./remote-agent-memory-context";
import { resolveRemoteAgentRuntimeAvailability } from "./remote-agent-runtime-policy";
import { truncateRemoteAgentTriggerText } from "./remote-agent-trigger-text";
import {
  resolveRemoteAgentAdmissionPublicCopy,
  submitRemoteAgentWorkerAdmission,
} from "./remote-agent-worker-admission";

type LarkPlatformConversationLocator = Extract<
  MessageChannelConversationLocator,
  { provider: "feishu" | "lark" }
>;

export type RemoteAgentMessageChannelNativeDeliveryInput = {
  attachments?: readonly RemoteAgentWorkerInputAttachment[];
  inputFailure?: {
    failureCode: string;
    text: string;
  };
  locator: LarkPlatformConversationLocator;
  sourceText: string;
  target: MessageChannelTurnTarget;
  triggerMessageId: string;
  turnEnvelope: RemoteAgentTurnEnvelope;
};

type RemoteAgentMessageChannelDeliveryIdentity = {
  deliveryId: string;
  dispatchId: string;
  idempotencyKey: string;
  providerPublicationIdempotencyKey: string;
};

type RemoteAgentMessageChannelAuthor = {
  displayName: string;
  profileId: string | null;
  profileKind: "human" | null;
};

type RemoteAgentMessageChannelPreAdmissionResult = {
  author: RemoteAgentMessageChannelAuthor;
  delivery: RemoteAgentNativeDeliveryRecord;
  sourceText: string;
  workingCard: MessageChannelWorkingCardPreparationResult;
};
type RemoteAgentMessageChannelAdmissionResult = Omit<
  RemoteAgentMessageChannelPreAdmissionResult,
  "workingCard"
>;

export type RemoteAgentMessageChannelNativeDeliveryResult =
  RemoteAgentMessageChannelDeliveryIdentity &
    (
      | {
          shouldAck: true;
          status: "submitted";
        }
      | {
          failureCode: string;
          shouldAck: true;
          status: "failed";
          text: string;
        }
    );

export class RemoteAgentMessageChannelSubmissionOutcomeUnknownError extends Error {
  readonly reasonCode =
    "remote_agent.message_channel_worker_submit_outcome_unknown";

  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message);
    this.name = "RemoteAgentMessageChannelSubmissionOutcomeUnknownError";
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

export async function submitRemoteAgentMessageChannelNativeDelivery(input: {
  db: D1Database;
  env: CoreBindings;
  memoryService?: CenterAgentMemoryService | null;
  nowMs: number;
  registry: MessageChannelProviderRegistry;
  request: RemoteAgentMessageChannelNativeDeliveryInput;
}): Promise<RemoteAgentMessageChannelNativeDeliveryResult> {
  assertMessageChannelDeliveryAuthority(input.request);
  const { centerAgent, connection } = input.request.target;
  const identity = await buildRemoteAgentMessageChannelDeliveryIdentity(
    input.request
  );
  const cleanupPreparedInputAttachments = async (): Promise<void> => {
    await cleanupMessageChannelInputAttachments({
      attachments: input.request.attachments ?? [],
      bucket: input.env.OPENMELD_SPACE_ATTACHMENTS,
      conversationId: input.request.turnEnvelope.space.id,
      organizationId: connection.organizationId,
    });
  };
  const admittedDelivery =
    await admitRemoteAgentMessageChannelDeliveryPreservingReplayAttachments({
      cleanupPreparedInputAttachments,
      db: input.db,
      identity,
      nowMs: input.nowMs,
      request: input.request,
    });
  const existingResult = await resolveExistingMessageChannelDeliveryResult({
    delivery: admittedDelivery.delivery,
    identity,
  });
  if (existingResult) {
    await cleanupPreparedInputAttachments();
    return existingResult;
  }
  let preAdmission: RemoteAgentMessageChannelPreAdmissionResult;
  try {
    preAdmission = {
      ...admittedDelivery,
      workingCard: await prepareRemoteAgentMessageChannelWorkingCard({
        connection,
        db: input.db,
        delivery: admittedDelivery.delivery,
        nowMs: input.nowMs,
        registry: input.registry,
      }),
    };
  } catch (error) {
    await cleanupPreparedInputAttachments();
    throw error;
  }
  const { author, delivery, sourceText, workingCard } = preAdmission;
  if (workingCard.status === "in_progress") {
    await cleanupPreparedInputAttachments();
    throw new RemoteAgentMessageChannelSubmissionOutcomeUnknownError(
      workingCard.reasonCode
    );
  }
  if (workingCard.status === "unavailable") {
    console.warn("[core.message_channel.working_card_unavailable]", {
      connectionId: connection.connectionId,
      deliveryId: delivery.deliveryId,
      provider: connection.provider,
      reasonCode: workingCard.reasonCode,
    });
  }
  if (input.request.inputFailure) {
    return await failMessageChannelDelivery({
      db: input.db,
      failureCode: input.request.inputFailure.failureCode,
      identity,
      nowMs: input.nowMs,
      status: "failed",
      text: input.request.inputFailure.text,
    });
  }

  const availability = resolveRemoteAgentRuntimeAvailability({
    env: input.env,
    organizationId: connection.organizationId,
  });
  if (!availability.ok) {
    await cleanupPreparedInputAttachments();
    return await failMessageChannelDelivery({
      db: input.db,
      failureCode: availability.code,
      identity,
      nowMs: input.nowMs,
      status: "flag_rejected",
      text: availability.message,
    });
  }

  const worker = input.env.OPENMELD_REMOTE_AGENT_WORKER;
  if (!worker?.submitConversationTurn) {
    await cleanupPreparedInputAttachments();
    return await failMessageChannelDelivery({
      db: input.db,
      failureCode: "remote_agent.worker_unavailable",
      identity,
      nowMs: input.nowMs,
      status: "worker_unavailable",
      text: "Center Agent could not start this request. Please try again.",
    });
  }

  let durableWorkerRequest: RemoteAgentWorkerSubmitTurnRequest | null = null;
  try {
    const turnEnvelope = await attachCenterAgentMemoryToTurnEnvelope({
      env: input.env,
      memoryService: input.memoryService,
      organizationId: connection.organizationId,
      query: sourceText,
      turnEnvelope: input.request.turnEnvelope,
    });
    const candidateWorkerRequest =
      remoteAgentWorkerSubmitTurnRequestSchema.parse({
        agentProfileId: centerAgent.agentProfileId,
        agentProfileOwnerUserId: centerAgent.ownerUserId,
        author,
        bindingId: centerAgent.bindingId,
        dispatchId: identity.dispatchId,
        idempotencyKey: identity.idempotencyKey,
        messages: [
          {
            ...(input.request.attachments?.length
              ? { attachments: input.request.attachments }
              : {}),
            content: sourceText,
            role: "user",
          },
        ],
        onBehalfOf:
          input.request.target.participant.kind === "member" ? author : null,
        organizationId: connection.organizationId,
        organizationSkillReleases:
          await readEnabledOrganizationSkillReleaseSelection({
            db: input.db,
            organizationId: connection.organizationId,
          }),
        modelRoute: centerAgent.modelRoute,
        sourceClientMessageId: null,
        spaceId: input.request.turnEnvelope.space.id,
        triggerMessageId: input.request.triggerMessageId,
        turnEnvelope,
        v: 2,
      });
    const durableDelivery = await persistRemoteAgentWorkerSubmitRequest({
      db: input.db,
      idempotencyKey: identity.idempotencyKey,
      nowMs: input.nowMs,
      workerSubmitRequest: candidateWorkerRequest,
    });
    durableWorkerRequest = durableDelivery.workerSubmitRequest;
    if (!durableWorkerRequest) {
      throw new Error(
        "Message Channel native delivery lost its durable worker request"
      );
    }

    await enqueueRemoteAgentAdmissionWatchdog({
      ack: {
        submissionId: buildRemoteAgentAdmissionWatchdogSubmissionId(
          identity.idempotencyKey
        ),
      },
      env: input.env,
      nowMs: input.nowMs,
      target: {
        dispatchId: identity.dispatchId,
        idempotencyKey: identity.idempotencyKey,
        organizationId: connection.organizationId,
        profileId: centerAgent.agentProfileId,
        spaceId: input.request.turnEnvelope.space.id,
      },
    });
  } catch (error) {
    await cleanupPreparedInputAttachments();
    throw error;
  }
  if (!durableWorkerRequest) {
    throw new Error(
      "Message Channel native delivery lost its durable worker request"
    );
  }

  const admission = await submitRemoteAgentWorkerAdmission({
    db: input.db,
    env: input.env,
    nowMs: input.nowMs,
    organizationId: connection.organizationId,
    request: durableWorkerRequest,
    worker,
  });
  if (admission.status === "rejected") {
    await cleanupPreparedInputAttachments();
    return await failMessageChannelDelivery({
      db: input.db,
      failureCode: admission.response.reasonCode,
      failureDetail: admission.response.message,
      identity,
      nowMs: input.nowMs,
      status: "failed",
      text: resolveRemoteAgentAdmissionPublicCopy({
        conversationKind: "message_channel",
        reasonCode: admission.response.reasonCode,
      }),
    });
  }
  if (
    admission.status === "outcome_unknown" ||
    admission.status === "protocol_error"
  ) {
    throw new RemoteAgentMessageChannelSubmissionOutcomeUnknownError(
      toErrorMessage(admission.error),
      { cause: admission.error }
    );
  }
  if (admission.status !== "acknowledged") {
    await cleanupPreparedInputAttachments();
    return await failMessageChannelDelivery({
      db: input.db,
      failureCode: "remote_agent.worker_submit_failed",
      identity,
      nowMs: input.nowMs,
      status: "worker_unavailable",
      text: "Center Agent could not start this request. Please try again.",
    });
  }

  try {
    await markRemoteAgentNativeDeliveryAckWithProbe({
      accepted: admission.ack.accepted,
      db: input.db,
      env: input.env,
      idempotencyKey: identity.idempotencyKey,
      nowMs: input.nowMs,
      submissionId: admission.ack.submissionId,
      workerRequestId: admission.ack.requestId ?? null,
    });
  } catch (error) {
    throw new RemoteAgentMessageChannelSubmissionOutcomeUnknownError(
      toErrorMessage(error),
      { cause: error }
    );
  }
  return { ...identity, shouldAck: true, status: "submitted" };
}

export async function continueMessageChannelIdentityOnboardingRequest(input: {
  connectionId: string;
  continuationAttempt: number;
  db: D1Database;
  env: CoreBindings;
  nowMs: number;
  organizationId: string;
  provider: "feishu" | "lark";
  providerUserId: string;
  registry: MessageChannelProviderRegistry;
  sourceDeliveryId: string;
  tokenHash: string;
  openmeldUserId: string;
}): Promise<"retryable_failure" | "submitted"> {
  const sourceDelivery = await readRemoteAgentNativeDeliveryByDeliveryId({
    db: input.db,
    deliveryId: input.sourceDeliveryId,
  });
  const originalRequest = sourceDelivery?.executionRecoverySubmitRequest;
  const speaker = sourceDelivery?.anonymousMemberSpeaker;
  const locator = sourceDelivery?.messageChannelLocator;
  const sourceCanContinue =
    sourceDelivery?.status === "completed" ||
    (sourceDelivery?.finalPublicationState === "outcome_unknown" &&
      (sourceDelivery.status === "accepted" ||
        sourceDelivery.status === "retry_observed"));
  if (
    !(
      sourceDelivery &&
      sourceCanContinue &&
      (originalRequest?.v === 2 || originalRequest?.v === 3) &&
      sourceDelivery.conversationKind === "message_channel" &&
      locator &&
      (locator.provider === "lark" || locator.provider === "feishu") &&
      locator.provider === input.provider &&
      locator.connectionId === input.connectionId &&
      sourceDelivery.organizationId === input.organizationId &&
      sourceDelivery.triggerText &&
      speaker?.messageChannelIdentity.provider === input.provider &&
      speaker.messageChannelIdentity.connectionId === input.connectionId &&
      speaker.messageChannelIdentity.providerUserId === input.providerUserId
    )
  ) {
    throw new Error(
      "Message Channel identity onboarding continuation does not match its source delivery."
    );
  }
  const [identityProjection, connection] = await Promise.all([
    readOrganizationAccountIdentityProjection({
      account: { kind: "user_id", userId: input.openmeldUserId },
      authWorker: input.env.OPENMELD_AUTH_WORKER,
      organizationId: input.organizationId,
    }),
    readRemoteAgentLarkPlatformChannelConnection({
      connectionId: input.connectionId,
      db: input.db,
    }),
  ]);
  if (!identityProjection?.ok) {
    throw new Error(
      "Message Channel identity onboarding continuation cannot confirm Organization identity right now."
    );
  }
  const account = identityProjection.account;
  const membership = account?.membership;
  if (!(account && membership)) {
    throw new Error(
      "Message Channel identity onboarding continuation requires the enrolled member."
    );
  }
  if (
    !(
      connection?.status === "connected" &&
      connection.organizationId === input.organizationId &&
      connection.provider === input.provider
    )
  ) {
    throw new Error(
      "Message Channel identity onboarding continuation requires the connected provider."
    );
  }
  const continuationTriggerMessageId =
    await buildMessageChannelIdentityContinuationTriggerId({
      attempt: input.continuationAttempt,
      sourceDeliveryId: sourceDelivery.deliveryId,
      openmeldUserId: input.openmeldUserId,
    });
  const turnEnvelope = parseCoreOwnedRemoteAgentTurnEnvelope({
    ...discardFrozenContextScopeForNewTurn(originalRequest.turnEnvelope),
    interactionEnvironment:
      originalRequest.turnEnvelope.interactionEnvironment ??
      originalRequest.turnEnvelope.contextScopePlan?.interactionEnvironment,
    channelContext: originalRequest.turnEnvelope.channelContext
      ? {
          ...originalRequest.turnEnvelope.channelContext,
          currentMessageId: continuationTriggerMessageId,
        }
      : undefined,
    organization: {
      ...originalRequest.turnEnvelope.organization,
      memberCount: identityProjection.organization.memberCount,
    },
    sender: {
      displayName: account.displayName,
      id: membership.memberId,
      kind: "member",
      messageChannelIdentity: {
        connectionId: input.connectionId,
        provider: input.provider,
        providerUserId: input.providerUserId,
      },
      ownerUserId: input.openmeldUserId,
      ...(account.defaultHumanProfile
        ? { profileId: account.defaultHumanProfile.profileId }
        : {}),
      role: membership.role,
      verified: true,
    },
  });
  const submission = await submitRemoteAgentMessageChannelNativeDelivery({
    db: input.db,
    env: input.env,
    nowMs: input.nowMs,
    registry: input.registry,
    request: {
      locator,
      sourceText: [
        "Setup is complete. Continue my original request now without asking me to repeat it:",
        "",
        sourceDelivery.triggerText,
      ].join("\n"),
      target: {
        centerAgent: {
          agentProfileId: sourceDelivery.profileId,
          bindingId: sourceDelivery.bindingId,
          modelRoute: originalRequest.modelRoute,
          ownerUserId: originalRequest.agentProfileOwnerUserId,
          profileHandle: originalRequest.turnEnvelope.centerAgent.profileHandle,
          profileName: originalRequest.turnEnvelope.centerAgent.profileName,
        },
        connection,
        participant: {
          kind: "member",
          member: {
            humanProfileId: account.defaultHumanProfile?.profileId ?? null,
            memberCount: identityProjection.organization.memberCount,
            memberId: membership.memberId,
            organizationId: identityProjection.organization.id,
            organizationName: identityProjection.organization.name,
            organizationPersonal: identityProjection.organization.personal,
            organizationSlug: identityProjection.organization.slug,
            role: membership.role,
            userDisplayName: account.displayName,
            userEmail: account.email,
            userId: account.userId,
          },
        },
      },
      triggerMessageId: continuationTriggerMessageId,
      turnEnvelope,
    },
  });
  if (submission.status === "submitted") {
    return "submitted";
  }
  await advanceRemoteAgentMessageChannelIdentityContinuationAttempt({
    currentAttempt: input.continuationAttempt,
    db: input.db,
    tokenHash: input.tokenHash,
    openmeldUserId: input.openmeldUserId,
  });
  return "retryable_failure";
}

async function buildMessageChannelIdentityContinuationTriggerId(input: {
  attempt: number;
  sourceDeliveryId: string;
  openmeldUserId: string;
}): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(
        `${input.sourceDeliveryId}\u001f${input.openmeldUserId}`
      )
    )
  );
  const identity = Array.from(digest, (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  const base = `message-channel-identity-continuation:${identity}`;
  return input.attempt === 0 ? base : `${base}:retry:${input.attempt}`;
}

async function admitRemoteAgentMessageChannelDeliveryPreservingReplayAttachments(input: {
  cleanupPreparedInputAttachments: () => Promise<void>;
  db: D1Database;
  identity: RemoteAgentMessageChannelDeliveryIdentity;
  nowMs: number;
  request: RemoteAgentMessageChannelNativeDeliveryInput;
}): Promise<RemoteAgentMessageChannelAdmissionResult> {
  const existingBeforeAdmission =
    await readRemoteAgentNativeDeliveryByIdempotencyKey({
      db: input.db,
      idempotencyKey: input.identity.idempotencyKey,
    });
  try {
    return await admitRemoteAgentMessageChannelDelivery(input);
  } catch (error) {
    if (!existingBeforeAdmission) {
      await input.cleanupPreparedInputAttachments();
    }
    throw error;
  }
}

async function admitRemoteAgentMessageChannelDelivery(input: {
  db: D1Database;
  identity: RemoteAgentMessageChannelDeliveryIdentity;
  nowMs: number;
  request: RemoteAgentMessageChannelNativeDeliveryInput;
}): Promise<RemoteAgentMessageChannelAdmissionResult> {
  const { centerAgent, connection, participant } = input.request.target;
  const member = participant.kind === "member" ? participant.member : null;
  const author: RemoteAgentMessageChannelAuthor = {
    displayName:
      participant.kind === "member"
        ? participant.member.userDisplayName
        : participant.providerUserDisplayName,
    profileId: member?.humanProfileId ?? null,
    profileKind: member?.humanProfileId ? "human" : null,
  };
  const sourceText = normalizeRequiredText(
    input.request.sourceText,
    "Message Channel source text is required"
  );
  const delivery = await upsertRemoteAgentNativeDeliveryRecord({
    bindingId: centerAgent.bindingId,
    conversationKind: "message_channel",
    db: input.db,
    deliveryId: input.identity.deliveryId,
    dispatchId: input.identity.dispatchId,
    idempotencyKey: input.identity.idempotencyKey,
    messageChannelLocator: input.request.locator,
    nowMs: input.nowMs,
    onBehalfOfDisplayName: author.displayName,
    onBehalfOfProfileId: author.profileId,
    onBehalfOfUserId: member?.userId ?? null,
    organizationId: connection.organizationId,
    profileId: centerAgent.agentProfileId,
    providerPublicationIdempotencyKey:
      input.identity.providerPublicationIdempotencyKey,
    spaceId: input.request.turnEnvelope.space.id,
    status: "submitted",
    triggerMessageId: input.request.triggerMessageId,
    triggerText: truncateRemoteAgentTriggerText(sourceText),
    attemptId: null,
  });
  return {
    author,
    delivery,
    sourceText,
  };
}

function resolveExistingMessageChannelDeliveryResult(input: {
  delivery: RemoteAgentNativeDeliveryRecord;
  identity: RemoteAgentMessageChannelDeliveryIdentity;
}): RemoteAgentMessageChannelNativeDeliveryResult | null {
  const existingDelivery = input.delivery;
  if (existingDelivery.deliveryId !== input.identity.deliveryId) {
    throw new Error(
      "Message Channel delivery identity changed for one idempotency key"
    );
  }
  if (
    existingDelivery.status === "accepted" ||
    existingDelivery.status === "retry_observed" ||
    existingDelivery.status === "completed"
  ) {
    return { ...input.identity, shouldAck: true, status: "submitted" };
  }
  if (existingDelivery.status === "submitted") {
    return null;
  }
  return {
    ...input.identity,
    failureCode:
      existingDelivery.failureCode ??
      "remote_agent.message_channel_submission_failed",
    shouldAck: true,
    status: "failed",
    text: "Center Agent could not start this request. Please try again.",
  };
}

function assertMessageChannelDeliveryAuthority(
  request: RemoteAgentMessageChannelNativeDeliveryInput
): void {
  if (request.inputFailure && request.attachments?.length) {
    throw new Error(
      "Message Channel failed input must not carry worker attachments"
    );
  }
  const conversationId = buildMessageChannelConversationId(request.locator);
  const trigger = request.turnEnvelope.trigger;
  const channelContext = request.turnEnvelope.channelContext;
  if (
    request.turnEnvelope.space.id !== conversationId ||
    trigger.source !== "message_channel" ||
    trigger.provider !== request.locator.provider ||
    trigger.connectionId !== request.locator.connectionId ||
    trigger.conversationId !== conversationId ||
    !channelContext ||
    channelContext.provider !== request.locator.provider ||
    channelContext.conversationId !== conversationId ||
    channelContext.currentMessageId !== request.triggerMessageId
  ) {
    throw new Error("Message Channel locator does not match its turn envelope");
  }

  const { centerAgent, connection, participant } = request.target;
  const organization =
    participant.kind === "member"
      ? participant.member
      : participant.organization;
  const sender = request.turnEnvelope.sender;
  if (
    connection.status !== "connected" ||
    connection.connectionId !== request.locator.connectionId ||
    connection.provider !== request.locator.provider ||
    connection.appId !== request.locator.appId ||
    connection.tenantKey !== request.locator.tenantKey ||
    connection.organizationId !== organization.organizationId ||
    request.turnEnvelope.organization.id !== organization.organizationId ||
    request.turnEnvelope.organization.name !== organization.organizationName ||
    request.turnEnvelope.organization.personal !==
      organization.organizationPersonal ||
    request.turnEnvelope.organization.memberCount !==
      organization.memberCount ||
    request.turnEnvelope.centerAgent.profileHandle !==
      centerAgent.profileHandle ||
    request.turnEnvelope.centerAgent.profileName !== centerAgent.profileName ||
    sender.kind !== "member"
  ) {
    throw new Error("Message Channel target does not match its turn envelope");
  }
  if (
    participant.kind === "member"
      ? !sender.verified ||
        sender.id !== participant.member.memberId ||
        sender.ownerUserId !== participant.member.userId ||
        sender.displayName !== participant.member.userDisplayName ||
        (sender.profileId ?? null) !== participant.member.humanProfileId ||
        (sender.role ?? null) !== participant.member.role
      : sender.verified ||
        sender.id !==
          `${connection.provider}:${connection.connectionId}:${participant.providerUserId}` ||
        sender.ownerUserId !== undefined ||
        sender.profileId !== undefined ||
        sender.role !== undefined ||
        sender.displayName !== participant.providerUserDisplayName
  ) {
    throw new Error("Message Channel target does not match its turn envelope");
  }
}

async function buildRemoteAgentMessageChannelDeliveryIdentity(
  request: RemoteAgentMessageChannelNativeDeliveryInput
): Promise<RemoteAgentMessageChannelDeliveryIdentity> {
  const parts = [
    request.locator.provider,
    request.locator.connectionId,
    request.triggerMessageId,
    request.target.centerAgent.agentProfileId,
  ];
  const deliveryId = buildNamespacedIdentity(
    "remote-agent-message-channel-delivery:v1",
    parts
  );
  return {
    deliveryId,
    dispatchId: buildNamespacedIdentity(
      "remote-agent-message-channel-dispatch:v1",
      parts
    ),
    idempotencyKey: deliveryId,
    providerPublicationIdempotencyKey:
      await buildMessageChannelProviderPublicationUuid({
        deliveryId,
        provider: request.locator.provider,
        publicationKind: "final",
      }),
  };
}

async function failMessageChannelDelivery(input: {
  db: D1Database;
  failureCode: string;
  failureDetail?: string;
  identity: RemoteAgentMessageChannelDeliveryIdentity;
  nowMs: number;
  status: "failed" | "flag_rejected" | "worker_unavailable";
  text: string;
}): Promise<RemoteAgentMessageChannelNativeDeliveryResult> {
  await markRemoteAgentNativeDeliveryFailure({
    db: input.db,
    failureCode: input.failureCode,
    failureDetail: input.failureDetail,
    idempotencyKey: input.identity.idempotencyKey,
    nowMs: input.nowMs,
    status: input.status,
  });
  return {
    ...input.identity,
    failureCode: input.failureCode,
    shouldAck: true,
    status: "failed",
    text: input.text,
  };
}

function buildNamespacedIdentity(namespace: string, parts: string[]): string {
  return `${namespace}|${parts
    .map((part) => `${part.length}:${part}`)
    .join("|")}`;
}

function normalizeRequiredText(value: string, errorMessage: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(errorMessage);
  }
  return normalized;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
