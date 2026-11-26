import type { PostgresDatabase } from "@openmeld/db/postgresql";
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
import type { RemoteAgentLarkPlatformChannelConnectionRecord } from "../infrastructure/postgresql/lark-platform-channel-connection-repo";
import { readRemoteAgentLarkPlatformChannelConnection } from "../infrastructure/postgresql/lark-platform-channel-connection-repo";
import {
  readRemoteAgentLarkPlatformContextCursor,
  upsertRemoteAgentLarkPlatformContextCursor,
} from "../infrastructure/postgresql/lark-platform-context-cursor-repo";
import {
  claimRemoteAgentMessageChannelEventIngress,
  completeRemoteAgentMessageChannelEventIngress,
  failRemoteAgentMessageChannelEventIngress,
  releaseRemoteAgentMessageChannelEventIngressForRetry,
} from "../infrastructure/postgresql/message-channel-event-ingress-repo";
import { recordUnaddressedChannelMessage } from "../infrastructure/postgresql/message-channel-unaddressed-message-repo";
import {
  claimRemoteAgentMessageChannelAdmissionFailurePublication,
  readRemoteAgentNativeDeliveryByIdempotencyKey,
} from "../infrastructure/postgresql/native-delivery-ledger-repo";
import {
  CENTER_AGENT_CHANNEL_MODEL_UNAVAILABLE_TEXT,
  CENTER_AGENT_CHANNEL_UNAVAILABLE_TEXT,
} from "./center-agent-channel-failure-copy";
import type {
  MessageChannelContextHistoryOptions,
  MessageChannelProviderRegistry,
} from "./message-channel-adapters";
import { publishRemoteAgentMessageChannelAdmissionFailure } from "./message-channel-admission-watchdog-publication";
import { processMessageChannelCardControl } from "./message-channel-card-control-service";
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
import {
  isUnaddressedChannelIntakeEnabled,
  isUnaddressedChannelIntakeEnabledForConversation,
  observeUnaddressedLarkPlatformMessage,
  settleUnaddressedChannelMessagesAnsweredByMention,
  type UnaddressedChannelObservationResult,
} from "./message-channel-unaddressed-intake-service";
import { buildPluginChannelSourceProof } from "./plugin-channel-source-proof";
import { buildMessageChannelProviderPublicationUuid } from "./provider-publication-uuid";

const MESSAGE_CHANNEL_EVENT_CLAIM_LEASE_MS = 30_000;
const MESSAGE_CHANNEL_FAILURE_PUBLICATION_CLAIM_LEASE_MS = 30_000;
export const REMOTE_AGENT_MESSAGE_CHANNEL_EVENT_MAX_QUEUE_ATTEMPTS = 4;
type LarkPlatformEnvelope = MessageChannelIngressEnvelope & {
  provider: "feishu" | "lark";
};
type FailedMessageChannelDeliveryResult = Extract<
  RemoteAgentMessageChannelNativeDeliveryResult,
  {
    status: "failed";
  }
>;
type AdmittedMessageChannelEvent = Extract<
  MessageChannelIngressEnvelope["event"],
  {
    kind: "card_action" | "message";
  }
>;
type MessageChannelMessageEvent = Extract<
  MessageChannelIngressEnvelope["event"],
  {
    kind: "message";
  }
>;
/** The ingress facts an admitted event needs, whatever produced it. */
export type AdmittedMessageChannelEventSource = {
  /**
   * False for a routed batch of unaddressed group messages. Nobody addressed
   * the Center Agent there, so a request that cannot start is not answered.
   */
  addressed: boolean;
  connectionGeneration?: number;
  connectionId: string;
  provider: "feishu" | "lark";
  providerEventId: string;
};
export type RemoteAgentMessageChannelEventProcessingResult =
  | {
      deliveryId: string;
      status: "submitted";
    }
  | {
      deliveryId: string;
      status: "failed" | "outcome_unknown";
    }
  | {
      status: "duplicate";
    }
  | {
      // Archived as an unaddressed group message; no turn was started.
      status: "observed";
    }
  | {
      reasonCode: string;
      status: "ignored" | "rejected";
    };
type AdmissionFailureSettlement =
  | {
      resultId: string;
      status: "published";
    }
  | {
      status: "outcome_unknown";
    }
  | {
      reasonCode: string;
      status: "retryable";
    };
type IngressClaimResult =
  | {
      record: {
        eventKey: string;
        state: "processing";
      };
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
    db: PostgresDatabase;
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
  observeUnaddressedMessage(input: {
    connectionGeneration: number | undefined;
    connectionId: string;
    db: PostgresDatabase;
    env: CoreBindings;
    event: MessageChannelMessageEvent;
    nowMs: number;
    provider: "feishu" | "lark";
  }): Promise<UnaddressedChannelObservationResult>;
  prepareInputAttachments(input: {
    adapter: ReturnType<MessageChannelProviderRegistry["require"]>;
    bucket?: Pick<R2Bucket, "delete" | "put">;
    connection: RemoteAgentLarkPlatformChannelConnectionRecord;
    conversationId: string;
    event: Extract<
      MessageChannelIngressEnvelope["event"],
      {
        kind: "message";
      }
    >;
  }): Promise<MessageChannelInputAttachmentPreparationResult>;
  releaseIngress(
    input: Parameters<
      typeof releaseRemoteAgentMessageChannelEventIngressForRetry
    >[0]
  ): Promise<boolean>;
  resolveTurnTarget(input: {
    authWorker: CoreBindings["OPENMELD_AUTH_WORKER"];
    connectionId: string;
    identityDb: PostgresDatabase;
    provider: "feishu" | "lark";
    providerUserDisplayName?: string | null;
    providerUserId: string;
    providerUserTenantKey?: string | null;
    stateDb: PostgresDatabase;
  }): Promise<MessageChannelTurnTargetResolution>;
  settleAdmissionFailure(input: {
    db: PostgresDatabase;
    delivery: FailedMessageChannelDeliveryResult;
    nowMs: number;
    registry: MessageChannelProviderRegistry;
  }): Promise<AdmissionFailureSettlement>;
  submitNativeDelivery(
    input: Parameters<typeof submitRemoteAgentMessageChannelNativeDelivery>[0]
  ): Promise<RemoteAgentMessageChannelNativeDeliveryResult>;
  settleUnaddressedMessagesForMention(
    input: Parameters<
      typeof settleUnaddressedChannelMessagesAnsweredByMention
    >[0]
  ): Promise<number>;
  readContextCursor(
    input: Parameters<typeof readRemoteAgentLarkPlatformContextCursor>[0]
  ): Promise<{
    syncedThroughAtMs: number;
    syncedThroughMessageId: string;
  } | null>;
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
    async observeUnaddressedMessage({ env, ...observation }) {
      return await observeUnaddressedLarkPlatformMessage(
        {
          ...observation,
          queue: env.OPENMELD_REMOTE_AGENT_MESSAGE_CHANNEL_EVENTS_QUEUE,
        },
        {
          readConnection: readRemoteAgentLarkPlatformChannelConnection,
          recordMessage: recordUnaddressedChannelMessage,
        }
      );
    },
    readContextCursor: readRemoteAgentLarkPlatformContextCursor,
    settleUnaddressedMessagesForMention:
      settleUnaddressedChannelMessagesAnsweredByMention,
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
    options: {
      cause?: unknown;
      retryAfterMs?: number;
    } = {}
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
  constructor(
    reasonCode: string,
    options: {
      cause?: unknown;
    } = {}
  ) {
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
    db: PostgresDatabase;
    env: CoreBindings;
    envelope: MessageChannelIngressEnvelope;
    identityDb: PostgresDatabase;
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
  db: PostgresDatabase;
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
async function resolveAdmittedMessageChannelTarget(
  input: Omit<
    Parameters<typeof submitAdmittedMessageChannelEvent>[0],
    "dependencies"
  > & {
    dependencies: RemoteAgentMessageChannelEventServiceDependencies;
  },
  event: AdmittedMessageChannelEvent
) {
  return await input.dependencies.resolveTurnTarget({
    authWorker: input.env.OPENMELD_AUTH_WORKER,
    connectionId: input.source.connectionId,
    identityDb: input.identityDb,
    provider: input.source.provider,
    providerUserDisplayName:
      event.kind === "message" ? event.senderDisplayName : null,
    providerUserId: event.senderId,
    providerUserTenantKey:
      event.kind === "message" ? event.senderTenantKey : undefined,
    stateDb: input.db,
  });
}
async function resolveAdmittedCardControl(
  input: Omit<
    Parameters<typeof processMessageChannelCardControl>[0],
    "event"
  > & {
    event: AdmittedMessageChannelEvent;
  }
) {
  if (
    input.event.kind === "card_action" &&
    input.event.actionName === "openmeld.center_agent.control"
  ) {
    return await processMessageChannelCardControl({
      ...input,
      event: input.event,
    });
  }
  return { status: "continue" as const, event: input.event };
}
async function processClaimedMessageChannelEvent(input: {
  db: PostgresDatabase;
  dependencies: RemoteAgentMessageChannelEventServiceDependencies;
  env: CoreBindings;
  envelope: LarkPlatformEnvelope;
  identityDb: PostgresDatabase;
  registry: MessageChannelProviderRegistry;
}): Promise<RemoteAgentMessageChannelEventProcessingResult> {
  const event = input.envelope.event;
  const admission = resolveEventAdmission(event, {
    unaddressedIntakeEnabled:
      event.kind === "message" &&
      isUnaddressedChannelIntakeEnabledForConversation({
        conversationKey:
          event.locator.provider === "slack"
            ? event.locator.channelId
            : event.locator.chatId,
        env: input.env,
        provider: event.locator.provider,
      }),
  });
  if (admission.status === "ignored") {
    return admission;
  }
  if (
    admission.event.kind === "message" &&
    admission.event.mention === "group_mention" &&
    admission.event.locator.provider === input.envelope.provider &&
    isUnaddressedChannelIntakeEnabled(input.env)
  ) {
    await input.dependencies.settleUnaddressedMessagesForMention({
      connectionId: input.envelope.connectionId,
      conversationKey: admission.event.locator.chatId,
      db: input.db,
      messageId: admission.event.messageId,
      nowMs: Date.now(),
      provider: input.envelope.provider,
      rootMessageId: admission.event.locator.rootMessageId,
      senderId: admission.event.senderId,
      sentAtMs: admission.event.sentAtMs,
    });
  }
  if (admission.status === "unaddressed") {
    return await input.dependencies.observeUnaddressedMessage({
      connectionGeneration: input.envelope.connectionGeneration,
      connectionId: input.envelope.connectionId,
      db: input.db,
      env: input.env,
      event: admission.event,
      nowMs: Date.now(),
      provider: input.envelope.provider,
    });
  }
  return await submitAdmittedMessageChannelEvent({
    db: input.db,
    dependencies: input.dependencies,
    env: input.env,
    event: admission.event,
    identityDb: input.identityDb,
    registry: input.registry,
    source: {
      addressed: true,
      connectionGeneration: input.envelope.connectionGeneration,
      connectionId: input.envelope.connectionId,
      provider: input.envelope.provider,
      providerEventId: input.envelope.providerEventId,
    },
  });
}
/**
 * Runs one admitted event through target resolution and Native Delivery.
 * Addressed events and routed unaddressed batches share this path, so both
 * get the same sender authority, quota, and failure handling.
 */
export async function submitAdmittedMessageChannelEvent(input: {
  db: PostgresDatabase;
  dependencies?: RemoteAgentMessageChannelEventServiceDependencies;
  env: CoreBindings;
  event: AdmittedMessageChannelEvent;
  identityDb: PostgresDatabase;
  registry: MessageChannelProviderRegistry;
  source: AdmittedMessageChannelEventSource;
}): Promise<RemoteAgentMessageChannelEventProcessingResult> {
  const dependencies = input.dependencies ?? DEFAULT_DEPENDENCIES;
  const targetResolution = await resolveAdmittedMessageChannelTarget(
    { ...input, dependencies },
    input.event
  );
  if (targetResolution.status === "rejected") {
    if ("connection" in targetResolution) {
      await publishTargetResolutionFailure({
        addressed: input.source.addressed,
        connection: targetResolution.connection,
        event: input.event,
        providerEventId: input.source.providerEventId,
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
    input.source.connectionGeneration !== undefined &&
    input.source.connectionGeneration !== connection.connectionGeneration
  ) {
    return {
      status: "rejected",
      reasonCode: "message_channel.connection_generation_changed",
    };
  }
  const control = await resolveAdmittedCardControl({
    db: input.db,
    env: input.env,
    event: input.event,
    organizationId: connection.organizationId,
    participant,
    nowMs: Date.now(),
  });
  if (control.status !== "continue") {
    return control;
  }
  const admittedEvent = control.event;
  if (
    admittedEvent.locator.provider !== "lark" &&
    admittedEvent.locator.provider !== "feishu"
  ) {
    throw new Error("Lark-platform event has a non-Lark conversation locator");
  }
  const locator = admittedEvent.locator;
  const conversationId = buildMessageChannelConversationId(locator);
  const adapter = input.registry.require(input.source.provider);
  const channelContext = buildPendingChannelContext({
    messageId:
      admittedEvent.kind === "message"
        ? admittedEvent.messageId
        : admittedEvent.actionId,
    conversationId,
    provider: connection.provider,
  });
  const turnEnvelope = buildMessageChannelTurnEnvelope({
    routineLocator: admittedEvent.locator,
    resources: readAdmittedResources(admittedEvent),
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
  const delivery = await dependencies.submitNativeDelivery({
    db: input.db,
    env: input.env,
    nowMs: Date.now(),
    registry: input.registry,
    prepareInput: async () => {
      const startedAt = Date.now();
      const context =
        admittedEvent.kind === "message"
          ? await readBoundedChannelContext({
              adapter,
              connection,
              conversationId,
              event: admittedEvent,
              history: await resolveChannelContextHistory({
                connection,
                db: input.db,
                dependencies,
                env: input.env,
                event: admittedEvent,
              }),
            })
          : channelContext;
      const contextFinishedAt = Date.now();
      const prepared = await prepareAdmittedEventInput({
        adapter,
        connection,
        conversationId,
        dependencies,
        env: input.env,
        event: admittedEvent,
      });
      console.info("[core.message_channel.input_prepared]", {
        connectionId: connection.connectionId,
        providerEventId: input.source.providerEventId,
        contextMs: contextFinishedAt - startedAt,
        attachmentsMs: Date.now() - contextFinishedAt,
      });
      return {
        ...prepared,
        turnEnvelope: { ...turnEnvelope, channelContext: context },
      };
    },
    request: {
      locator,
      ...(admittedEvent.kind === "message"
        ? {
            pluginSourceProof: await buildPluginChannelSourceProof({
              provider: locator.provider,
              messageId: admittedEvent.messageId,
              providerUserId: admittedEvent.senderId,
              text: admittedEvent.text,
              resourceIds: admittedEvent.resources.map(
                (resource) => resource.fileKey
              ),
            }),
          }
        : {}),
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
      await dependencies.upsertContextCursor({
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
  const settlement = await dependencies.settleAdmissionFailure({
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
  addressed: boolean;
  connection: RemoteAgentLarkPlatformChannelConnectionRecord;
  event: AdmittedMessageChannelEvent;
  providerEventId: string;
  reasonCode:
    | "message_channel.center_agent_model_unavailable"
    | "message_channel.center_agent_unavailable";
  registry: MessageChannelProviderRegistry;
}): Promise<void> {
  if (!input.addressed) {
    // Nobody asked the Center Agent anything, so there is no one to tell.
    return;
  }
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
function readAdmittedResources(event: AdmittedMessageChannelEvent) {
  return event.kind === "message" ? event.resources : undefined;
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
  event: MessageChannelIngressEnvelope["event"],
  policy: { unaddressedIntakeEnabled: boolean }
):
  | {
      event: AdmittedMessageChannelEvent;
      status: "admitted";
    }
  | {
      event: MessageChannelMessageEvent;
      status: "unaddressed";
    }
  | {
      reasonCode: string;
      status: "ignored";
    } {
  if (event.kind === "message") {
    if (
      event.mention === "direct_message" ||
      event.mention === "group_mention"
    ) {
      return { event, status: "admitted" };
    }
    if (event.mention === "group_message" && policy.unaddressedIntakeEnabled) {
      return { event, status: "unaddressed" };
    }
    return {
      reasonCode: "message_channel.group_message_not_addressed",
      status: "ignored",
    };
  }
  if (
    event.kind === "card_action" &&
    (event.actionName === "openmeld.center_agent.submit" ||
      event.actionName === "openmeld.center_agent.control") &&
    event.actionValue
  ) {
    return { event, status: "admitted" };
  }
  return {
    reasonCode: "message_channel.event_kind_not_admitted",
    status: "ignored",
  };
}
function buildPendingChannelContext(input: {
  messageId: string;
  conversationId: string;
  provider: "feishu" | "lark";
}): ChannelContext {
  return channelContextSchema.parse({
    conversationId: input.conversationId,
    currentMessageId: input.messageId,
    messages: [],
    provider: input.provider,
    sync: { mode: "snapshot", status: "unavailable" },
  });
}
/**
 * With unaddressed intake on, a thread collects many messages between turns.
 * Later turns then read only what is new since the last admitted message and
 * see which messages carried files, the same contract Slack threads use.
 * With intake off, every turn reads the full bounded snapshot as before.
 */
async function resolveChannelContextHistory(input: {
  connection: RemoteAgentLarkPlatformChannelConnectionRecord;
  db: PostgresDatabase;
  dependencies: RemoteAgentMessageChannelEventServiceDependencies;
  env: CoreBindings;
  event: MessageChannelMessageEvent;
}): Promise<MessageChannelContextHistoryOptions | undefined> {
  const locator = input.event.locator;
  if (locator.provider !== "lark" && locator.provider !== "feishu") {
    return;
  }
  if (
    !isUnaddressedChannelIntakeEnabledForConversation({
      conversationKey: locator.chatId,
      env: input.env,
      provider: locator.provider,
    })
  ) {
    return;
  }
  const cursor = await input.dependencies.readContextCursor({
    chatId: locator.chatId,
    connectionGeneration: input.connection.connectionGeneration,
    connectionId: input.connection.connectionId,
    db: input.db,
    organizationId: input.connection.organizationId,
    rootMessageId: locator.rootMessageId,
  });
  return {
    includeAttachments: true,
    syncedThrough: cursor
      ? {
          atMs: cursor.syncedThroughAtMs,
          messageId: cursor.syncedThroughMessageId,
        }
      : null,
  };
}
async function readBoundedChannelContext(input: {
  adapter: ReturnType<MessageChannelProviderRegistry["require"]>;
  connection: Extract<
    MessageChannelTurnTargetResolution,
    {
      status: "resolved";
    }
  >["target"]["connection"];
  conversationId: string;
  event: Extract<
    MessageChannelIngressEnvelope["event"],
    {
      kind: "message";
    }
  >;
  history: MessageChannelContextHistoryOptions | undefined;
}): Promise<ChannelContext> {
  try {
    const context = await input.adapter.readChannelContext({
      connection: input.connection,
      conversationId: input.conversationId,
      event: input.event,
      ...(input.history ? { history: input.history } : {}),
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
    sync: {
      mode: input.history?.syncedThrough ? "delta" : "snapshot",
      status: "unavailable",
    },
  });
}
async function settleRemoteAgentMessageChannelAdmissionFailure(input: {
  db: PostgresDatabase;
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
    delivery: claimed as typeof claimed & {
      status: "failed";
    },
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
