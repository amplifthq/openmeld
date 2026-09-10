import {
  buildMessageChannelConversationId,
  channelContextSchema,
  messageChannelIngressEnvelopeSchema,
} from "@openmeld/schemas";
import type {
  ChannelContext,
  MessageChannelIngressEnvelope,
} from "@openmeld/schemas/types";
import type { CoreBindings } from "../../lib/bindings";
import type { RemoteAgentLarkPlatformChannelConnectionRecord } from "../infrastructure/d1/lark-platform-channel-connection-repo";
import { upsertRemoteAgentLarkPlatformContextCursor } from "../infrastructure/d1/lark-platform-context-cursor-repo";
import {
  claimRemoteAgentMessageChannelEventIngress,
  completeRemoteAgentMessageChannelEventIngress,
  failRemoteAgentMessageChannelEventIngress,
  releaseRemoteAgentMessageChannelEventIngressForRetry,
} from "../infrastructure/d1/message-channel-event-ingress-repo";
import {
  claimRemoteAgentMessageChannelAdmissionFailurePublication,
  readRemoteAgentNativeDeliveryByIdempotencyKey,
} from "../infrastructure/d1/native-delivery-ledger-repo";
import {
  CENTER_AGENT_CHANNEL_MODEL_UNAVAILABLE_TEXT,
  CENTER_AGENT_CHANNEL_UNAVAILABLE_TEXT,
} from "./center-agent-channel-failure-copy";
import type { MessageChannelProviderRegistry } from "./message-channel-adapters";
import { publishRemoteAgentMessageChannelAdmissionFailure } from "./message-channel-admission-watchdog-publication";
import {
  type MessageChannelInputAttachmentPreparationResult,
  prepareMessageChannelInputAttachments,
} from "./message-channel-input-attachments";
import {
  type RemoteAgentMessageChannelNativeDeliveryInput,
  type RemoteAgentMessageChannelNativeDeliveryResult,
  submitRemoteAgentMessageChannelNativeDelivery,
} from "./message-channel-native-delivery-service";
import {
  buildMessageChannelTurnEnvelope,
  type MessageChannelTurnTargetResolution,
  resolveMessageChannelTurnTarget,
} from "./message-channel-turn-resolution";
import { buildMessageChannelProviderPublicationUuid } from "./provider-publication-uuid";

const MESSAGE_CHANNEL_EVENT_CLAIM_LEASE_MS = 30_000;
const MESSAGE_CHANNEL_FAILURE_PUBLICATION_CLAIM_LEASE_MS = 30_000;
export const REMOTE_AGENT_MESSAGE_CHANNEL_EVENT_MAX_QUEUE_ATTEMPTS = 4;

type LarkPlatformEnvelope = MessageChannelIngressEnvelope & {
  provider: "feishu" | "lark";
};

type FailedMessageChannelDeliveryResult = Extract<
  RemoteAgentMessageChannelNativeDeliveryResult,
  { status: "failed" }
>;
type AdmittedMessageChannelEvent = Extract<
  MessageChannelIngressEnvelope["event"],
  { kind: "card_action" | "message" }
>;

export type RemoteAgentMessageChannelEventProcessingResult =
  | { deliveryId: string; status: "submitted" }
  | { deliveryId: string; status: "failed" | "outcome_unknown" }
  | { status: "duplicate" }
  | { reasonCode: string; status: "ignored" | "rejected" };

type AdmissionFailureSettlement =
  | { resultId: string; status: "published" }
  | { status: "outcome_unknown" }
  | { reasonCode: string; status: "retryable" };

type IngressClaimResult =
  | {
      record: { eventKey: string; state: "processing" };
      status: "claimed";
    }
  | {
      record: {
        eventKey: string;
        state: "completed" | "failed" | "processing" | "queued";
      };
      status: "duplicate";
    };

export type RemoteAgentMessageChannelEventServiceDependencies = {
  claimIngress(input: {
    claimExpiresAtMs: number;
    claimId: string;
    connectionId: string;
    db: D1Database;
    gatewayRequestId: string;
    nowMs: number;
    provider: "feishu" | "lark";
    providerEventId: string;
    providerRetrySequence: number | null;
    queueAttempts: number | null;
    queueMessageId: string | null;
    receivedAtMs: number;
    retryReasonCode: string | null;
  }): Promise<IngressClaimResult>;
  completeIngress(
    input: Parameters<typeof completeRemoteAgentMessageChannelEventIngress>[0]
  ): Promise<boolean>;
  failIngress(
    input: Parameters<typeof failRemoteAgentMessageChannelEventIngress>[0]
  ): Promise<boolean>;
  prepareInputAttachments(input: {
    adapter: ReturnType<MessageChannelProviderRegistry["require"]>;
    bucket?: Pick<R2Bucket, "delete" | "put">;
    connection: RemoteAgentLarkPlatformChannelConnectionRecord;
    conversationId: string;
    event: Extract<MessageChannelIngressEnvelope["event"], { kind: "message" }>;
  }): Promise<MessageChannelInputAttachmentPreparationResult>;
  releaseIngress(
    input: Parameters<
      typeof releaseRemoteAgentMessageChannelEventIngressForRetry
    >[0]
  ): Promise<boolean>;
  resolveTurnTarget(input: {
    authWorker: CoreBindings["OPENMELD_AUTH_WORKER"];
    connectionId: string;
    identityDb: D1Database;
    provider: "feishu" | "lark";
    providerUserDisplayName?: string | null;
    providerUserId: string;
    providerUserTenantKey?: string | null;
    stateDb: D1Database;
  }): Promise<MessageChannelTurnTargetResolution>;
  settleAdmissionFailure(input: {
    db: D1Database;
    delivery: FailedMessageChannelDeliveryResult;
    nowMs: number;
    registry: MessageChannelProviderRegistry;
  }): Promise<AdmissionFailureSettlement>;
  submitNativeDelivery(
    input: Parameters<typeof submitRemoteAgentMessageChannelNativeDelivery>[0]
  ): Promise<RemoteAgentMessageChannelNativeDeliveryResult>;
  upsertContextCursor(
    input: Parameters<typeof upsertRemoteAgentLarkPlatformContextCursor>[0]
  ): Promise<unknown>;
};

const DEFAULT_DEPENDENCIES: RemoteAgentMessageChannelEventServiceDependencies =
  {
    async claimIngress(input) {
      const claimed = await claimRemoteAgentMessageChannelEventIngress(input);
      if (claimed.status === "claimed") {
        if (claimed.record.state !== "processing") {
          throw new Error(
            "Message Channel ingress claim did not enter processing state"
          );
        }
        return {
          record: {
            eventKey: claimed.record.eventKey,
            state: claimed.record.state,
          },
          status: "claimed",
        };
      }
      return {
        record: {
          eventKey: claimed.record.eventKey,
          state: claimed.record.state,
        },
        status: "duplicate",
      };
    },
    completeIngress: completeRemoteAgentMessageChannelEventIngress,
    failIngress: failRemoteAgentMessageChannelEventIngress,
    releaseIngress: releaseRemoteAgentMessageChannelEventIngressForRetry,
    prepareInputAttachments: prepareMessageChannelInputAttachments,
    resolveTurnTarget: resolveMessageChannelTurnTarget,
    settleAdmissionFailure: settleRemoteAgentMessageChannelAdmissionFailure,
    submitNativeDelivery: submitRemoteAgentMessageChannelNativeDelivery,
    upsertContextCursor: upsertRemoteAgentLarkPlatformContextCursor,
  };

export class RemoteAgentMessageChannelEventRetryableError extends Error {
  readonly reasonCode: string;
  readonly retryAfterMs: number | undefined;

  constructor(
    reasonCode: string,
    options: { cause?: unknown; retryAfterMs?: number } = {}
  ) {
    super(reasonCode);
    this.name = "RemoteAgentMessageChannelEventRetryableError";
    this.reasonCode = reasonCode;
    this.retryAfterMs = options.retryAfterMs;
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

export class RemoteAgentMessageChannelEventTerminalError extends Error {
  readonly reasonCode: string;

  constructor(reasonCode: string, options: { cause?: unknown } = {}) {
    super(reasonCode);
    this.name = "RemoteAgentMessageChannelEventTerminalError";
    this.reasonCode = reasonCode;
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

export async function processRemoteAgentMessageChannelEvent(
  input: {
    db: D1Database;
    env: CoreBindings;
    envelope: MessageChannelIngressEnvelope;
    identityDb: D1Database;
    queueAttempts: number | null;
    queueMessageId: string | null;
    registry: MessageChannelProviderRegistry;
  },
  dependencies: RemoteAgentMessageChannelEventServiceDependencies = DEFAULT_DEPENDENCIES
): Promise<RemoteAgentMessageChannelEventProcessingResult> {
  const envelope = requireLarkPlatformEnvelope(input.envelope);
  const claimId = crypto.randomUUID();
  const claimStartedAtMs = Date.now();
  const claim = await dependencies.claimIngress({
    claimExpiresAtMs: claimStartedAtMs + MESSAGE_CHANNEL_EVENT_CLAIM_LEASE_MS,
    claimId,
    connectionId: envelope.connectionId,
    db: input.db,
    gatewayRequestId: envelope.gatewayRequestId,
    nowMs: claimStartedAtMs,
    provider: envelope.provider,
    providerEventId: envelope.providerEventId,
    providerRetrySequence: null,
    queueAttempts: input.queueAttempts,
    queueMessageId: input.queueMessageId,
    receivedAtMs: envelope.receivedAtMs,
    retryReasonCode: null,
  });
  if (claim.status === "duplicate") {
    if (isTerminalIngressState(claim.record.state)) {
      return { status: "duplicate" };
    }
    throw new RemoteAgentMessageChannelEventRetryableError(
      "message_channel.ingress_claim_in_progress"
    );
  }

  let ingressSettled = false;
  try {
    const result = await processClaimedMessageChannelEvent({
      ...input,
      dependencies,
      envelope,
    });
    const completion = await dependencies.completeIngress({
      claimId,
      db: input.db,
      eventKey: claim.record.eventKey,
      nativeDeliveryId: "deliveryId" in result ? result.deliveryId : null,
      nowMs: Date.now(),
      outcomeStatus: "reasonCode" in result ? result.reasonCode : result.status,
    });
    if (!completion) {
      throw new RemoteAgentMessageChannelEventRetryableError(
        "message_channel.ingress_completion_fence_lost"
      );
    }
    ingressSettled = true;
    return result;
  } catch (error) {
    return await settleMessageChannelIngressFailure({
      claimId,
      db: input.db,
      dependencies,
      error,
      eventKey: claim.record.eventKey,
      ingressSettled,
      queueAttempts: input.queueAttempts,
    });
  }
}

async function settleMessageChannelIngressFailure(input: {
  claimId: string;
  db: D1Database;
  dependencies: RemoteAgentMessageChannelEventServiceDependencies;
  error: unknown;
  eventKey: string;
  ingressSettled: boolean;
  queueAttempts: number | null;
}): Promise<never> {
  const retryableError = toMessageChannelEventRetryableError(input.error);
  if (input.ingressSettled) {
    throw retryableError;
  }
  const exhausted =
    input.queueAttempts !== null &&
    input.queueAttempts >=
      REMOTE_AGENT_MESSAGE_CHANNEL_EVENT_MAX_QUEUE_ATTEMPTS;
  const settled = await (exhausted
    ? input.dependencies.failIngress
    : input.dependencies.releaseIngress)({
    claimId: input.claimId,
    db: input.db,
    eventKey: input.eventKey,
    failureReasonCode: retryableError.reasonCode,
    nowMs: Date.now(),
  });
  if (!settled) {
    throw new RemoteAgentMessageChannelEventRetryableError(
      exhausted
        ? "message_channel.ingress_terminal_fence_lost"
        : "message_channel.ingress_release_fence_lost",
      { cause: input.error }
    );
  }
  if (exhausted) {
    throw new RemoteAgentMessageChannelEventTerminalError(
      retryableError.reasonCode,
      { cause: input.error }
    );
  }
  throw retryableError;
}

function isTerminalIngressState(
  state: IngressClaimResult["record"]["state"]
): boolean {
  return state === "completed" || state === "failed";
}

function toMessageChannelEventRetryableError(
  error: unknown
): RemoteAgentMessageChannelEventRetryableError {
  return error instanceof RemoteAgentMessageChannelEventRetryableError
    ? error
    : new RemoteAgentMessageChannelEventRetryableError(
        "message_channel.event_processing_failed",
        { cause: error }
      );
}

async function processClaimedMessageChannelEvent(input: {
  db: D1Database;
  dependencies: RemoteAgentMessageChannelEventServiceDependencies;
  env: CoreBindings;
  envelope: LarkPlatformEnvelope;
  identityDb: D1Database;
  registry: MessageChannelProviderRegistry;
}): Promise<RemoteAgentMessageChannelEventProcessingResult> {
  const event = input.envelope.event;
  const admission = resolveEventAdmission(event);
  if (admission.status === "ignored") {
    return admission;
  }

  const targetResolution = await input.dependencies.resolveTurnTarget({
    authWorker: input.env.OPENMELD_AUTH_WORKER,
    connectionId: input.envelope.connectionId,
    identityDb: input.identityDb,
    provider: input.envelope.provider,
    providerUserDisplayName:
      admission.event.kind === "message"
        ? admission.event.senderDisplayName
        : null,
    providerUserId: admission.event.senderId,
    providerUserTenantKey:
      admission.event.kind === "message"
        ? admission.event.senderTenantKey
        : undefined,
    stateDb: input.db,
  });
  if (targetResolution.status === "rejected") {
    if ("connection" in targetResolution) {
      await publishTargetResolutionFailure({
        connection: targetResolution.connection,
        event: admission.event,
        providerEventId: input.envelope.providerEventId,
        reasonCode: targetResolution.reasonCode,
        registry: input.registry,
      });
    }
    return {
      reasonCode: targetResolution.reasonCode,
      status: "rejected",
    };
  }
  const { centerAgent, connection, participant } = targetResolution.target;
  if (
    input.envelope.connectionGeneration !== undefined &&
    input.envelope.connectionGeneration !== connection.connectionGeneration
  ) {
    return {
      status: "rejected",
      reasonCode: "message_channel.connection_generation_changed",
    };
  }
  const admittedEvent = admission.event;
  if (
    admittedEvent.locator.provider !== "lark" &&
    admittedEvent.locator.provider !== "feishu"
  ) {
    throw new Error("Lark-platform event has a non-Lark conversation locator");
  }
  const locator = admittedEvent.locator;
  const conversationId = buildMessageChannelConversationId(locator);
  const adapter = input.registry.require(input.envelope.provider);
  const channelContext =
    admittedEvent.kind === "message"
      ? await readBoundedChannelContext({
          adapter,
          connection,
          conversationId,
          event: admittedEvent,
        })
      : buildCardActionChannelContext({
          actionId: admittedEvent.actionId,
          conversationId,
          provider: connection.provider,
        });
  const turnEnvelope = buildMessageChannelTurnEnvelope({
    centerAgent,
    channelContext,
    connectionId: connection.connectionId,
    conversationId,
    conversationName: null,
    isDirectMessage:
      admittedEvent.kind === "message" &&
      admittedEvent.mention === "direct_message",
    participant,
    provider: connection.provider,
    providerUserId: admittedEvent.senderId,
    webAppUrl: input.env.WEB_APP_URL,
  });
  const preparedInput = await prepareAdmittedEventInput({
    adapter,
    connection,
    conversationId,
    dependencies: input.dependencies,
    env: input.env,
    event: admittedEvent,
  });
  const delivery = await input.dependencies.submitNativeDelivery({
    db: input.db,
    env: input.env,
    nowMs: Date.now(),
    registry: input.registry,
    request: {
      ...preparedInput,
      locator,
      sourceText:
        admittedEvent.kind === "message"
          ? admittedEvent.text
          : (admittedEvent.actionValue ?? ""),
      target: targetResolution.target,
      triggerMessageId:
        admittedEvent.kind === "message"
          ? admittedEvent.messageId
          : admittedEvent.actionId,
      turnEnvelope,
    },
  });
  if (delivery.status === "submitted") {
    if (admittedEvent.kind === "message") {
      await input.dependencies.upsertContextCursor({
        chatId: locator.chatId,
        connectionGeneration: connection.connectionGeneration,
        connectionId: connection.connectionId,
        db: input.db,
        nowMs: Date.now(),
        organizationId: connection.organizationId,
        provider: connection.provider,
        rootMessageId: locator.rootMessageId,
        syncedThroughAtMs: admittedEvent.sentAtMs,
        syncedThroughMessageId: admittedEvent.messageId,
      });
    }
    return { deliveryId: delivery.deliveryId, status: "submitted" };
  }

  const settlement = await input.dependencies.settleAdmissionFailure({
    db: input.db,
    delivery,
    nowMs: Date.now(),
    registry: input.registry,
  });
  if (settlement.status === "retryable") {
    throw new RemoteAgentMessageChannelEventRetryableError(
      settlement.reasonCode
    );
  }
  return {
    deliveryId: delivery.deliveryId,
    status: settlement.status === "published" ? "failed" : "outcome_unknown",
  };
}

async function publishTargetResolutionFailure(input: {
  connection: RemoteAgentLarkPlatformChannelConnectionRecord;
  event: AdmittedMessageChannelEvent;
  providerEventId: string;
  reasonCode:
    | "message_channel.center_agent_model_unavailable"
    | "message_channel.center_agent_unavailable";
  registry: MessageChannelProviderRegistry;
}): Promise<void> {
  const adapter = input.registry.require(input.connection.provider);
  const providerPublicationIdempotencyKey =
    await buildMessageChannelProviderPublicationUuid({
      deliveryId: `message-channel-ingress-rejection-v1:${input.connection.connectionId}:${input.providerEventId}`,
      provider: input.connection.provider,
      publicationKind: "final",
    });
  const publication = await adapter.publishFailure({
    connection: input.connection,
    failureCode: input.reasonCode,
    locator: input.event.locator,
    providerPublicationIdempotencyKey,
    text:
      input.reasonCode === "message_channel.center_agent_model_unavailable"
        ? CENTER_AGENT_CHANNEL_MODEL_UNAVAILABLE_TEXT
        : CENTER_AGENT_CHANNEL_UNAVAILABLE_TEXT,
  });
  if (publication.status === "failed") {
    throw new RemoteAgentMessageChannelEventRetryableError(
      publication.reasonCode,
      { retryAfterMs: publication.retryAfterMs }
    );
  }
}

async function prepareAdmittedEventInput(input: {
  adapter: ReturnType<MessageChannelProviderRegistry["require"]>;
  connection: RemoteAgentLarkPlatformChannelConnectionRecord;
  conversationId: string;
  dependencies: RemoteAgentMessageChannelEventServiceDependencies;
  env: CoreBindings;
  event: AdmittedMessageChannelEvent;
}): Promise<
  Pick<
    RemoteAgentMessageChannelNativeDeliveryInput,
    "attachments" | "inputFailure"
  >
> {
  if (input.event.kind !== "message") {
    return {};
  }
  const prepared = await input.dependencies.prepareInputAttachments({
    adapter: input.adapter,
    bucket: input.env.OPENMELD_SPACE_ATTACHMENTS,
    connection: input.connection,
    conversationId: input.conversationId,
    event: input.event,
  });
  if (prepared.status === "retryable") {
    throw new RemoteAgentMessageChannelEventRetryableError(prepared.reasonCode);
  }
  if (prepared.status === "failed") {
    return {
      inputFailure: {
        failureCode: prepared.failureCode,
        text: prepared.text,
      },
    };
  }
  return prepared.attachments.length > 0
    ? { attachments: prepared.attachments }
    : {};
}

function resolveEventAdmission(
  event: MessageChannelIngressEnvelope["event"]
):
  | { event: AdmittedMessageChannelEvent; status: "admitted" }
  | { reasonCode: string; status: "ignored" } {
  if (event.kind === "message") {
    if (
      event.mention !== "direct_message" &&
      event.mention !== "group_mention"
    ) {
      return {
        reasonCode: "message_channel.group_message_not_addressed",
        status: "ignored",
      };
    }
    return { event, status: "admitted" };
  }
  if (
    event.kind === "card_action" &&
    event.actionName === "openmeld.center_agent.submit" &&
    event.actionValue
  ) {
    return { event, status: "admitted" };
  }
  return {
    reasonCode: "message_channel.event_kind_not_admitted",
    status: "ignored",
  };
}

function buildCardActionChannelContext(input: {
  actionId: string;
  conversationId: string;
  provider: "feishu" | "lark";
}): ChannelContext {
  return channelContextSchema.parse({
    conversationId: input.conversationId,
    currentMessageId: input.actionId,
    messages: [],
    provider: input.provider,
    sync: { mode: "snapshot", status: "unavailable" },
  });
}

async function readBoundedChannelContext(input: {
  adapter: ReturnType<MessageChannelProviderRegistry["require"]>;
  connection: Extract<
    MessageChannelTurnTargetResolution,
    { status: "resolved" }
  >["target"]["connection"];
  conversationId: string;
  event: Extract<MessageChannelIngressEnvelope["event"], { kind: "message" }>;
}): Promise<ChannelContext> {
  try {
    const context = await input.adapter.readChannelContext({
      connection: input.connection,
      conversationId: input.conversationId,
      event: input.event,
    });
    const parsed = channelContextSchema.safeParse(context);
    if (parsed.success) {
      return parsed.data;
    }
  } catch (error) {
    console.warn("[core.message_channel.context_unavailable]", {
      connectionId: input.connection.connectionId,
      error: toErrorMessage(error),
      provider: input.connection.provider,
    });
  }
  return channelContextSchema.parse({
    provider: input.connection.provider,
    conversationId: input.conversationId,
    currentMessageId: input.event.messageId,
    messages: [],
    sync: { mode: "snapshot", status: "unavailable" },
  });
}

async function settleRemoteAgentMessageChannelAdmissionFailure(input: {
  db: D1Database;
  delivery: FailedMessageChannelDeliveryResult;
  nowMs: number;
  registry: MessageChannelProviderRegistry;
}): Promise<AdmissionFailureSettlement> {
  const claimId = crypto.randomUUID();
  const claimed =
    await claimRemoteAgentMessageChannelAdmissionFailurePublication({
      claimExpiresAtMs:
        input.nowMs + MESSAGE_CHANNEL_FAILURE_PUBLICATION_CLAIM_LEASE_MS,
      claimId,
      db: input.db,
      failureCode: input.delivery.failureCode,
      failureDetail: input.delivery.text,
      idempotencyKey: input.delivery.idempotencyKey,
      nowMs: input.nowMs,
      status: "failed",
    });
  if (!claimed) {
    const current = await readRemoteAgentNativeDeliveryByIdempotencyKey({
      db: input.db,
      idempotencyKey: input.delivery.idempotencyKey,
    });
    if (
      current?.finalPublicationState === "published" &&
      current.providerPublicationResultId
    ) {
      return {
        resultId: current.providerPublicationResultId,
        status: "published",
      };
    }
    if (current?.finalPublicationState === "outcome_unknown") {
      return { status: "outcome_unknown" };
    }
    return {
      reasonCode: "message_channel.admission_failure_claim_unavailable",
      status: "retryable",
    };
  }
  return await publishRemoteAgentMessageChannelAdmissionFailure({
    claimId,
    db: input.db,
    delivery: claimed as typeof claimed & { status: "failed" },
    failureCode: input.delivery.failureCode,
    failureMessage: input.delivery.text,
    releaseMode: "restore_admission",
    registry: input.registry,
  });
}

function requireLarkPlatformEnvelope(
  value: MessageChannelIngressEnvelope
): LarkPlatformEnvelope {
  const parsed = messageChannelIngressEnvelopeSchema.parse(value);
  if (parsed.provider !== "lark" && parsed.provider !== "feishu") {
    throw new Error("Message Channel event provider is not Lark-platform");
  }
  return parsed as LarkPlatformEnvelope;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
