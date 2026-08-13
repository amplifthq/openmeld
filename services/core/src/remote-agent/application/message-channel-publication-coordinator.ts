import {
  buildOpenMeldNavigationAction,
  type NavigationAction,
  resolveCenterAgentCallbackFailureMessage,
} from "@openmeld/schemas";
import type {
  RemoteAgentCoreCallbackBody,
  SpaceMessageAttachment,
} from "@openmeld/schemas/types";
import type { CoreBindings } from "../../lib/bindings";
import { readOrganizationAccountIdentityProjection } from "../../organizations/organization-context";
import { insertRemoteAgentMessageChannelIdentityLinkToken } from "../infrastructure/d1/message-channel-identity-link-token-repo";
import {
  claimRemoteAgentMessageChannelFinalPublication,
  expireRemoteAgentMessageChannelFinalPublicationAmbiguity,
  fenceRemoteAgentMessageChannelStandaloneFinalPublicationBeforeProviderIo,
  freezeRemoteAgentMessageChannelFinalPublicationSequence,
  markRemoteAgentMessageChannelFinalPublicationOutcomeUnknown,
  markRemoteAgentMessageChannelFinalPublicationPublished,
  type RemoteAgentFinalPublicationPayload,
  type RemoteAgentNativeDeliveryRecord,
  readRemoteAgentNativeDeliveryBySubmissionId,
  recoverExpiredRemoteAgentMessageChannelFinalPublicationClaim,
  releaseRemoteAgentMessageChannelFinalPublicationClaim,
  scheduleRemoteAgentMessageChannelFinalPublicationRetry,
} from "../infrastructure/d1/native-delivery-ledger-repo";
import type { MessageChannelProviderRegistry } from "./message-channel-adapters";
import {
  advanceRemoteAgentMessageChannelCardRollover,
  type MessageChannelCardRolloverResult,
} from "./message-channel-card-rollover-service";
import { splitMessageChannelCardSegment } from "./message-channel-card-segmentation";
import {
  buildMessageChannelIdentityLinkUrl,
  createMessageChannelIdentityLinkToken,
  digestMessageChannelIdentityLinkToken,
  MESSAGE_CHANNEL_IDENTITY_LINK_TOKEN_TTL_MS,
} from "./message-channel-identity-link-token";
import {
  type MessageChannelPublicationTarget,
  resolveMessageChannelPublicationTarget,
} from "./message-channel-publication-target";
import { projectMessageChannelTerminalContent } from "./message-channel-terminal-content";
import {
  type MessageChannelTerminalPublicationResult,
  publishMessageChannelTerminalResult,
  requiresMessageChannelFinalCardMutation,
  resolveMessageChannelFinalCardSequence,
} from "./message-channel-terminal-publication";
import { buildMessageChannelProviderPublicationUuid } from "./provider-publication-uuid";

export const REMOTE_AGENT_MESSAGE_CHANNEL_FINAL_PUBLICATION_CLAIM_LEASE_MS =
  5 * 60_000;
export const REMOTE_AGENT_LARK_PLATFORM_REPLY_DEDUPLICATION_WINDOW_MS =
  60 * 60_000;
export const REMOTE_AGENT_MESSAGE_CHANNEL_AMBIGUOUS_PUBLICATION_RETRY_DELAY_MS = 1000;
const PROVIDER_DEDUPLICATED_PUBLICATION_AMBIGUITY_REASON =
  /^(feishu|lark)\.message_reply_(outcome_unknown|result_missing)$/;

export type RemoteAgentMessageChannelPublicationOutcome =
  | {
      delivery: RemoteAgentNativeDeliveryRecord;
      resultId: string;
      status: "published";
    }
  | {
      delivery: RemoteAgentNativeDeliveryRecord;
      resultId: string | null;
      status: "duplicate";
    }
  | {
      reasonCode: string;
      retryAfterMs?: number;
      status: "retryable";
    }
  | {
      status: "outcome_unknown";
    }
  | {
      status: "in_progress";
    };

export async function publishRemoteAgentMessageChannelCallback(input: {
  body: RemoteAgentCoreCallbackBody;
  clock?: () => number;
  db: D1Database;
  delivery: RemoteAgentNativeDeliveryRecord & {
    status: "accepted" | "retry_observed";
  };
  env?: CoreBindings;
  registry: MessageChannelProviderRegistry;
}): Promise<RemoteAgentMessageChannelPublicationOutcome> {
  assertMessageChannelCallbackAuthority(input);
  const targetResolution = await resolveMessageChannelPublicationTarget({
    db: input.db,
    delivery: input.delivery,
    registry: input.registry,
  });
  if (targetResolution.status === "retryable") {
    return targetResolution;
  }
  const { adapter, connection, locator, providerPublicationIdempotencyKey } =
    targetResolution.target;

  const clock = input.clock ?? Date.now;
  const candidatePayload = buildFinalPublicationPayload({
    body: input.body,
    resumeStatus: input.delivery.status,
  });
  const claimId = crypto.randomUUID();
  const claimStartedAtMs = clock();
  const claimLeaseExpiresAtMs =
    claimStartedAtMs +
    REMOTE_AGENT_MESSAGE_CHANNEL_FINAL_PUBLICATION_CLAIM_LEASE_MS;
  const claimExpiresAtMs =
    input.delivery.finalPublicationAmbiguityDeadlineAtMs === null
      ? claimLeaseExpiresAtMs
      : Math.min(
          claimLeaseExpiresAtMs,
          input.delivery.finalPublicationAmbiguityDeadlineAtMs
        );
  const claim = await claimRemoteAgentMessageChannelFinalPublication({
    claimExpiresAtMs,
    claimId,
    db: input.db,
    idempotencyKey: input.body.idempotencyKey,
    nowMs: claimStartedAtMs,
    payload: candidatePayload,
    providerPublicationIdempotencyKey,
    submissionId: input.body.submissionId,
  });
  if (!claim) {
    return await resolvePublicationConflictWithPostResultGuidance({
      body: input.body,
      clock,
      db: input.db,
      env: input.env,
      idempotencyKey: input.body.idempotencyKey,
      registry: input.registry,
      submissionId: input.body.submissionId,
    });
  }
  assertClaimPreservedMessageChannelAuthority({
    claim,
    delivery: input.delivery,
  });
  const terminalPayload = requireFinalPublicationPayload(claim);
  const preparedDelivery = await prepareTerminalCardDelivery({
    claimId,
    clock,
    db: input.db,
    delivery: claim,
    originalDelivery: input.delivery,
    providerPublicationIdempotencyKey,
    target: targetResolution.target,
    terminalText: terminalPayload.text,
  });
  if (preparedDelivery.status !== "ready") {
    return preparedDelivery;
  }
  const publicationDelivery = preparedDelivery.delivery;

  let publication: MessageChannelTerminalPublicationResult;
  try {
    publication = await publishMessageChannelTerminalResult({
      attachments: [],
      delivery: publicationDelivery,
      ...(terminalPayload.failureCode === null
        ? {}
        : { failureCode: terminalPayload.failureCode }),
      target: {
        adapter,
        connection,
        locator,
        providerPublicationIdempotencyKey,
      },
      text: terminalPayload.text,
    });
  } catch {
    console.warn(
      "[core.remote_agent.message_channel.final_publication_exception]",
      {
        dispatchId: input.delivery.dispatchId,
        provider: locator.provider,
        reasonCode: "remote_agent.message_channel.final_publication_exception",
        submissionId: input.body.submissionId,
      }
    );
    if (requiresMessageChannelFinalCardMutation(publicationDelivery)) {
      return await recordPermanentMessageChannelPublicationAmbiguity({
        claimId,
        db: input.db,
        delivery: publicationDelivery,
        nowMs: clock(),
        providerProgressSequence:
          publicationDelivery.finalPublicationProviderProgressSequence,
        providerPublicationIdempotencyKey,
      });
    }
    return await scheduleAmbiguousPublicationRetry({
      claimId,
      db: input.db,
      delivery: claim,
      nowMs: clock(),
      providerProgressSequence: null,
      providerPublicationIdempotencyKey,
      reasonCode: `${locator.provider}.final_publication_outcome_unknown`,
    });
  }

  if (publication.status === "outcome_unknown") {
    if (!isProviderDeduplicatedPublicationAmbiguity(publication.reasonCode)) {
      return await recordPermanentMessageChannelPublicationAmbiguity({
        claimId,
        db: input.db,
        delivery: publicationDelivery,
        nowMs: clock(),
        providerProgressSequence: publication.providerProgressSequence,
        providerPublicationIdempotencyKey,
      });
    }
    return await scheduleAmbiguousPublicationRetry({
      claimId,
      db: input.db,
      delivery: claim,
      nowMs: clock(),
      providerProgressSequence: publication.providerProgressSequence,
      providerPublicationIdempotencyKey,
      reasonCode: publication.reasonCode,
    });
  }
  if (publication.status === "failed") {
    return await releaseClaimForRetry({
      claimId,
      db: input.db,
      delivery: claim,
      nowMs: clock(),
      providerPublicationIdempotencyKey,
      reasonCode: publication.reasonCode,
      ...(publication.retryAfterMs === undefined
        ? {}
        : { retryAfterMs: publication.retryAfterMs }),
    });
  }

  const resultId = publication.resultId;
  const published =
    await markRemoteAgentMessageChannelFinalPublicationPublished({
      claimId,
      db: input.db,
      idempotencyKey: input.delivery.idempotencyKey,
      nowMs: clock(),
      providerProgressSequence: publication.providerProgressSequence,
      providerPublicationIdempotencyKey,
      providerPublicationResultId: resultId,
      submissionId: requireSubmissionId(input.delivery),
    });
  if (!isConfirmedMessageChannelPublication(published, resultId)) {
    if (requiresMessageChannelFinalCardMutation(publicationDelivery)) {
      return await recordPermanentMessageChannelPublicationAmbiguity({
        claimId,
        db: input.db,
        delivery: publicationDelivery,
        nowMs: clock(),
        providerProgressSequence: publication.providerProgressSequence,
        providerPublicationIdempotencyKey,
      });
    }
    return await scheduleAmbiguousPublicationRetry({
      claimId,
      db: input.db,
      delivery: claim,
      nowMs: clock(),
      providerProgressSequence: publication.providerProgressSequence,
      providerPublicationIdempotencyKey,
      reasonCode:
        "message_channel.final_publication_confirmation_outcome_unknown",
    });
  }
  const identityLinkPublication =
    await publishRemoteAgentMessageChannelIdentityGuidanceAfterResult({
      body: input.body,
      clock,
      db: input.db,
      delivery: published,
      env: input.env,
      registry: input.registry,
    });
  if (identityLinkPublication) {
    return identityLinkPublication;
  }
  const privateNavigationPublication =
    await publishRemoteAgentMessageChannelPrivateNavigationAfterResult({
      body: input.body,
      db: input.db,
      delivery: published,
      registry: input.registry,
    });
  if (privateNavigationPublication) {
    return privateNavigationPublication;
  }
  return { delivery: published, resultId, status: "published" };
}

async function resolvePublicationConflictWithPostResultGuidance(input: {
  body: RemoteAgentCoreCallbackBody;
  clock: () => number;
  db: D1Database;
  env: CoreBindings | undefined;
  idempotencyKey: string;
  registry: MessageChannelProviderRegistry;
  submissionId: string;
}): Promise<
  Exclude<RemoteAgentMessageChannelPublicationOutcome, { status: "published" }>
> {
  const conflict = await resolveRemoteAgentMessageChannelPublicationConflict({
    db: input.db,
    idempotencyKey: input.idempotencyKey,
    nowMs: input.clock(),
    submissionId: input.submissionId,
  });
  if (conflict.status !== "duplicate") {
    return conflict;
  }
  const identityLinkPublication =
    await publishRemoteAgentMessageChannelIdentityGuidanceAfterResult({
      body: input.body,
      clock: input.clock,
      db: input.db,
      delivery: conflict.delivery,
      env: input.env,
      registry: input.registry,
    });
  if (identityLinkPublication) {
    return identityLinkPublication;
  }
  const privateNavigationPublication =
    await publishRemoteAgentMessageChannelPrivateNavigationAfterResult({
      body: input.body,
      db: input.db,
      delivery: conflict.delivery,
      registry: input.registry,
    });
  return privateNavigationPublication ?? conflict;
}

export async function publishRemoteAgentMessageChannelPrivateNavigationAfterResult(input: {
  body: RemoteAgentCoreCallbackBody;
  db: D1Database;
  delivery: RemoteAgentNativeDeliveryRecord;
  registry: MessageChannelProviderRegistry;
}): Promise<Extract<
  RemoteAgentMessageChannelPublicationOutcome,
  { status: "retryable" }
> | null> {
  if (
    input.body.status === "failed" ||
    input.body.navigationTarget?.kind !== "computer_setup"
  ) {
    return null;
  }
  if (
    input.delivery.finalPublicationState !== "published" ||
    !input.delivery.providerPublicationResultId
  ) {
    return {
      reasonCode: "message_channel.private_navigation_result_not_confirmed",
      status: "retryable",
    };
  }
  const targetResolution = await resolveMessageChannelPublicationTarget({
    db: input.db,
    delivery: input.delivery,
    registry: input.registry,
  });
  if (targetResolution.status === "retryable") {
    return targetResolution;
  }
  const sender =
    input.delivery.executionRecoverySubmitRequest?.turnEnvelope.sender;
  const memberSender = sender?.kind === "member" ? sender : undefined;
  const organizationWebUrl =
    input.delivery.executionRecoverySubmitRequest?.turnEnvelope.organization
      .webUrl;
  const identity = memberSender?.messageChannelIdentity;
  if (
    !(
      memberSender?.verified &&
      identity &&
      organizationWebUrl &&
      identity.provider === targetResolution.target.locator.provider &&
      identity.connectionId === targetResolution.target.locator.connectionId
    )
  ) {
    return {
      reasonCode: "message_channel.private_navigation_recipient_unavailable",
      status: "retryable",
    };
  }
  const action = buildOpenMeldNavigationAction({
    organizationWebUrl,
    target: input.body.navigationTarget,
  });
  const publication =
    await targetResolution.target.adapter.publishPrivateNavigationGuidance({
      action,
      connection: targetResolution.target.connection,
      providerPublicationIdempotencyKey:
        await buildMessageChannelProviderPublicationUuid({
          deliveryId: input.delivery.deliveryId,
          provider: targetResolution.target.locator.provider,
          publicationKind: "private_navigation",
        }),
      providerUserId: identity.providerUserId,
      text: buildComputerSetupGuidanceText(action),
    });
  if (publication.status === "published") {
    return null;
  }
  return {
    reasonCode: publication.reasonCode,
    ...(publication.status === "failed" &&
    publication.retryAfterMs !== undefined
      ? { retryAfterMs: publication.retryAfterMs }
      : {}),
    status: "retryable",
  };
}

export function buildComputerSetupGuidanceText(
  action: NavigationAction
): string {
  if (action.target.kind !== "computer_setup") {
    throw new TypeError("Computer setup guidance requires a computer action.");
  }
  if (action.target.mode === "setup") {
    return "Connect this computer to OpenMeld to use Codex and other local agents.";
  }
  if (action.target.mode === "reconnect") {
    return "Reconnect this computer to OpenMeld to use Codex and other local agents.";
  }
  return "Update OpenMeld Service on this computer to use Codex and other local agents.";
}

export async function publishRemoteAgentMessageChannelIdentityGuidanceAfterResult(input: {
  body: RemoteAgentCoreCallbackBody;
  clock?: () => number;
  db: D1Database;
  delivery: RemoteAgentNativeDeliveryRecord;
  env?: CoreBindings;
  registry: MessageChannelProviderRegistry;
}): Promise<Extract<
  RemoteAgentMessageChannelPublicationOutcome,
  { status: "retryable" }
> | null> {
  if (
    input.delivery.finalPublicationState !== "published" ||
    !input.delivery.providerPublicationResultId
  ) {
    return {
      reasonCode: "message_channel.identity_link_result_not_confirmed",
      status: "retryable",
    };
  }
  const targetResolution = await resolveMessageChannelPublicationTarget({
    db: input.db,
    delivery: input.delivery,
    registry: input.registry,
  });
  if (targetResolution.status === "retryable") {
    return targetResolution;
  }
  return await publishMessageChannelIdentityLinkAfterResult({
    body: input.body,
    clock: input.clock ?? Date.now,
    db: input.db,
    delivery: input.delivery,
    env: input.env,
    target: targetResolution.target,
  });
}

async function publishMessageChannelIdentityLinkAfterResult(input: {
  body: RemoteAgentCoreCallbackBody;
  clock: () => number;
  db: D1Database;
  delivery: RemoteAgentNativeDeliveryRecord;
  env: CoreBindings | undefined;
  target: MessageChannelPublicationTarget;
}): Promise<Extract<
  RemoteAgentMessageChannelPublicationOutcome,
  { status: "retryable" }
> | null> {
  if (
    input.body.status === "failed" ||
    input.body.navigationTarget?.kind !== "message_channel_identity_link"
  ) {
    return null;
  }
  const purpose = input.body.navigationTarget.purpose;
  try {
    return await publishMessageChannelIdentityLink(input);
  } catch (error) {
    console.warn("[core.message_channel.identity_link_exception]", {
      error: error instanceof Error ? error.message : String(error),
      provider: input.target.locator.provider,
      purpose,
      submissionId: input.body.submissionId,
    });
    return purpose === "optional_setup"
      ? null
      : {
          reasonCode: "message_channel.identity_link_exception",
          status: "retryable",
        };
  }
}

async function publishMessageChannelIdentityLink(input: {
  body: RemoteAgentCoreCallbackBody;
  clock: () => number;
  db: D1Database;
  delivery: RemoteAgentNativeDeliveryRecord;
  env: CoreBindings | undefined;
  target: MessageChannelPublicationTarget;
}): Promise<Extract<
  RemoteAgentMessageChannelPublicationOutcome,
  { status: "retryable" }
> | null> {
  if (
    input.body.status === "failed" ||
    input.body.navigationTarget?.kind !== "message_channel_identity_link"
  ) {
    return null;
  }
  const purpose = input.body.navigationTarget.purpose;
  const connectToUserId = input.body.navigationTarget.connectToUserId;
  const speaker = input.delivery.anonymousMemberSpeaker;
  const identity = speaker?.messageChannelIdentity;
  const organizationName =
    input.delivery.executionRecoverySubmitRequest?.turnEnvelope.organization
      .name;
  const webAppUrl = input.env?.WEB_APP_URL?.trim();
  if (
    !(
      identity &&
      organizationName &&
      webAppUrl &&
      identity.provider === input.target.locator.provider &&
      identity.connectionId === input.target.locator.connectionId
    )
  ) {
    return handleMessageChannelIdentityLinkFailure({
      purpose,
      reasonCode: "message_channel.identity_link_context_unavailable",
    });
  }

  if (connectToUserId) {
    if (!input.env) {
      return handleMessageChannelIdentityLinkFailure({
        purpose,
        reasonCode: "message_channel.account_connection_target_unavailable",
      });
    }
    const projection = await readOrganizationAccountIdentityProjection({
      account: { kind: "user_id", userId: connectToUserId },
      authWorker: input.env.OPENMELD_AUTH_WORKER,
      organizationId: input.delivery.organizationId,
      requestId: input.body.submissionId,
    });
    if (!projection?.ok) {
      return handleMessageChannelIdentityLinkFailure({
        purpose,
        reasonCode: "message_channel.account_connection_target_unavailable",
      });
    }
    if (!projection.account?.membership) {
      return handleMessageChannelIdentityLinkFailure({
        purpose,
        reasonCode: "message_channel.account_connection_member_unavailable",
      });
    }
  }

  const issuedAtMs = input.clock();
  const token = createMessageChannelIdentityLinkToken();
  await insertRemoteAgentMessageChannelIdentityLinkToken({
    ...(connectToUserId ? { claimedByUserId: connectToUserId } : {}),
    connectionId: identity.connectionId,
    db: input.db,
    expiresAtMs: issuedAtMs + MESSAGE_CHANNEL_IDENTITY_LINK_TOKEN_TTL_MS,
    issuedAtMs,
    linkPurpose: purpose,
    organizationId: input.delivery.organizationId,
    provider: input.target.locator.provider,
    providerUserDisplayName: speaker.displayName,
    providerUserId: identity.providerUserId,
    sourceDeliveryId: input.delivery.deliveryId,
    tokenHash: await digestMessageChannelIdentityLinkToken(token),
  });
  const publication = await input.target.adapter.publishIdentityLinkGuidance({
    connection: input.target.connection,
    linkUrl: buildMessageChannelIdentityLinkUrl({ token, webAppUrl }),
    organizationName,
    providerPublicationIdempotencyKey:
      await buildMessageChannelProviderPublicationUuid({
        deliveryId: input.delivery.deliveryId,
        provider: input.target.locator.provider,
        publicationKind: "identity_link",
      }),
    providerUserId: identity.providerUserId,
    purpose,
    ...(input.body.navigationTarget.requestedAction
      ? { requestedAction: input.body.navigationTarget.requestedAction }
      : {}),
  });
  if (publication.status === "published") {
    return null;
  }
  return handleMessageChannelIdentityLinkFailure({
    purpose,
    reasonCode: publication.reasonCode,
    ...(publication.status === "failed" &&
    publication.retryAfterMs !== undefined
      ? { retryAfterMs: publication.retryAfterMs }
      : {}),
  });
}

function handleMessageChannelIdentityLinkFailure(input: {
  purpose: "continue_request" | "optional_setup";
  reasonCode: string;
  retryAfterMs?: number;
}): Extract<
  RemoteAgentMessageChannelPublicationOutcome,
  { status: "retryable" }
> | null {
  if (input.purpose === "optional_setup") {
    console.warn("[core.message_channel.optional_identity_link_unavailable]", {
      reasonCode: input.reasonCode,
    });
    return null;
  }
  return {
    reasonCode: input.reasonCode,
    ...(input.retryAfterMs === undefined
      ? {}
      : { retryAfterMs: input.retryAfterMs }),
    status: "retryable",
  };
}

function isProviderDeduplicatedPublicationAmbiguity(
  reasonCode: string
): boolean {
  return PROVIDER_DEDUPLICATED_PUBLICATION_AMBIGUITY_REASON.test(reasonCode);
}

async function prepareTerminalCardDelivery(input: {
  claimId: string;
  clock: () => number;
  db: D1Database;
  delivery: RemoteAgentNativeDeliveryRecord;
  originalDelivery: RemoteAgentNativeDeliveryRecord & {
    status: "accepted" | "retry_observed";
  };
  providerPublicationIdempotencyKey: string;
  target: MessageChannelPublicationTarget;
  terminalText: string;
}): Promise<
  | {
      delivery: RemoteAgentNativeDeliveryRecord;
      status: "ready";
    }
  | Exclude<
      RemoteAgentMessageChannelPublicationOutcome,
      { status: "published" }
    >
> {
  let publicationDelivery = input.delivery;
  const rolloverSequence =
    Math.max(
      input.delivery.providerProgressSequence ?? 0,
      input.delivery.providerProgressPendingSequence ?? 0
    ) + 1;
  while (
    requiresTerminalCardRollover(publicationDelivery, input.terminalText)
  ) {
    let rollover: MessageChannelCardRolloverResult;
    try {
      rollover = await advanceRemoteAgentMessageChannelCardRollover({
        db: input.db,
        delivery: publicationDelivery,
        finalPublicationClaimId: input.claimId,
        nowMs: input.clock(),
        sequence: rolloverSequence,
        target: input.target,
        textSnapshot: input.terminalText,
      });
    } catch (error) {
      console.warn(
        "[core.remote_agent.message_channel.card_rollover_exception]",
        {
          deliveryId: publicationDelivery.deliveryId,
          dispatchId: publicationDelivery.dispatchId,
          errorName: error instanceof Error ? error.name : typeof error,
          provider: input.target.locator.provider,
          reasonCode: "remote_agent.message_channel.card_rollover_exception",
        }
      );
      await markMessageChannelPublicationOutcomeUnknown({
        claimId: input.claimId,
        db: input.db,
        delivery: publicationDelivery,
        nowMs: input.clock(),
        providerProgressSequence:
          publicationDelivery.providerProgressPendingSequence,
        providerPublicationIdempotencyKey:
          input.providerPublicationIdempotencyKey,
      });
      return { status: "outcome_unknown" };
    }
    if (rollover.status === "rolled_over") {
      publicationDelivery = rollover.delivery;
      continue;
    }
    if (rollover.status === "outcome_unknown") {
      await markMessageChannelPublicationOutcomeUnknown({
        claimId: input.claimId,
        db: input.db,
        delivery: rollover.delivery,
        nowMs: input.clock(),
        providerProgressSequence:
          rollover.delivery.providerProgressPendingSequence,
        providerPublicationIdempotencyKey:
          input.providerPublicationIdempotencyKey,
      });
      return { status: "outcome_unknown" };
    }
    return await releaseClaimForRetry({
      claimId: input.claimId,
      db: input.db,
      delivery: input.originalDelivery,
      nowMs: input.clock(),
      providerPublicationIdempotencyKey:
        input.providerPublicationIdempotencyKey,
      reasonCode: rollover.reasonCode,
      ...(rollover.retryAfterMs === undefined
        ? {}
        : { retryAfterMs: rollover.retryAfterMs }),
    });
  }
  return await fenceTerminalPublicationBeforeProviderIo({
    claimId: input.claimId,
    clock: input.clock,
    db: input.db,
    delivery: publicationDelivery,
    providerPublicationIdempotencyKey: input.providerPublicationIdempotencyKey,
  });
}

async function fenceTerminalPublicationBeforeProviderIo(input: {
  claimId: string;
  clock: () => number;
  db: D1Database;
  delivery: RemoteAgentNativeDeliveryRecord;
  providerPublicationIdempotencyKey: string;
}): Promise<
  | {
      delivery: RemoteAgentNativeDeliveryRecord;
      status: "ready";
    }
  | Exclude<
      RemoteAgentMessageChannelPublicationOutcome,
      { status: "published" }
    >
> {
  if (!requiresMessageChannelFinalCardMutation(input.delivery)) {
    const nowMs = input.clock();
    const fenced =
      await fenceRemoteAgentMessageChannelStandaloneFinalPublicationBeforeProviderIo(
        {
          claimId: input.claimId,
          db: input.db,
          idempotencyKey: input.delivery.idempotencyKey,
          nowMs,
          providerPublicationIdempotencyKey:
            input.providerPublicationIdempotencyKey,
          submissionId: requireSubmissionId(input.delivery),
        }
      );
    if (fenced) {
      return { delivery: input.delivery, status: "ready" };
    }
    return await resolveRemoteAgentMessageChannelPublicationConflict({
      db: input.db,
      idempotencyKey: input.delivery.idempotencyKey,
      nowMs,
      submissionId: requireSubmissionId(input.delivery),
    });
  }
  const providerProgressSequence = resolveMessageChannelFinalCardSequence(
    input.delivery
  );
  const nowMs = input.clock();
  const frozenDelivery =
    await freezeRemoteAgentMessageChannelFinalPublicationSequence({
      claimId: input.claimId,
      db: input.db,
      idempotencyKey: input.delivery.idempotencyKey,
      nowMs,
      providerProgressSequence,
      providerPublicationIdempotencyKey:
        input.providerPublicationIdempotencyKey,
      submissionId: requireSubmissionId(input.delivery),
    });
  if (frozenDelivery) {
    return { delivery: frozenDelivery, status: "ready" };
  }
  return await recordPermanentMessageChannelPublicationAmbiguity({
    claimId: input.claimId,
    db: input.db,
    delivery: input.delivery,
    nowMs,
    providerProgressSequence,
    providerPublicationIdempotencyKey: input.providerPublicationIdempotencyKey,
  });
}

function requiresTerminalCardRollover(
  delivery: RemoteAgentNativeDeliveryRecord,
  text: string
): boolean {
  if (
    delivery.providerProgressState === "rollover_finalize_claimed" ||
    delivery.providerProgressState === "rollover_finalized" ||
    delivery.providerProgressState === "rollover_create_claimed" ||
    delivery.providerProgressState === "rollover_created" ||
    delivery.providerProgressState === "rollover_send_claimed" ||
    delivery.providerProgressState === "rollover_send_outcome_unknown"
  ) {
    return true;
  }
  if (delivery.providerProgressState !== "sent") {
    return false;
  }
  return (
    splitMessageChannelCardSegment({
      sourceOffset: delivery.providerProgressSourceOffset,
      text,
    }).tail.length > 0
  );
}

async function releaseClaimForRetry(input: {
  claimId: string;
  db: D1Database;
  delivery: RemoteAgentNativeDeliveryRecord;
  nowMs: number;
  providerPublicationIdempotencyKey: string;
  reasonCode: string;
  retryAfterMs?: number;
}): Promise<
  Extract<
    RemoteAgentMessageChannelPublicationOutcome,
    { status: "outcome_unknown" | "retryable" }
  >
> {
  const retryAfterMs = resolveConfirmedFailureRetryAfterMs({
    ambiguityDeadlineAtMs: input.delivery.finalPublicationAmbiguityDeadlineAtMs,
    nowMs: input.nowMs,
    retryAfterMs: input.retryAfterMs,
  });
  if (retryAfterMs === "expired") {
    await markMessageChannelPublicationOutcomeUnknown({
      claimId: input.claimId,
      db: input.db,
      delivery: input.delivery,
      nowMs: input.nowMs,
      providerProgressSequence:
        input.delivery.finalPublicationProviderProgressSequence,
      providerPublicationIdempotencyKey:
        input.providerPublicationIdempotencyKey,
    });
    return { status: "outcome_unknown" };
  }
  const released = await releaseRemoteAgentMessageChannelFinalPublicationClaim({
    claimId: input.claimId,
    db: input.db,
    failureCode: input.reasonCode,
    idempotencyKey: input.delivery.idempotencyKey,
    nowMs: input.nowMs,
    nextAttemptAtMs:
      retryAfterMs === undefined ? null : input.nowMs + retryAfterMs,
    providerPublicationIdempotencyKey: input.providerPublicationIdempotencyKey,
    submissionId: requireSubmissionId(input.delivery),
  });
  return released
    ? {
        reasonCode: input.reasonCode,
        ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
        status: "retryable",
      }
    : { status: "outcome_unknown" };
}

function resolveConfirmedFailureRetryAfterMs(input: {
  ambiguityDeadlineAtMs: number | null;
  nowMs: number;
  retryAfterMs: number | undefined;
}): number | "expired" | undefined {
  if (input.ambiguityDeadlineAtMs === null) {
    return input.retryAfterMs;
  }
  const remainingMs = input.ambiguityDeadlineAtMs - input.nowMs;
  if (remainingMs <= 0) {
    return "expired";
  }
  return input.retryAfterMs === undefined
    ? undefined
    : Math.min(input.retryAfterMs, remainingMs);
}

function assertMessageChannelCallbackAuthority(input: {
  body: RemoteAgentCoreCallbackBody;
  delivery: RemoteAgentNativeDeliveryRecord;
}): void {
  if (
    input.delivery.conversationKind !== "message_channel" ||
    input.delivery.organizationId !== input.body.organizationId ||
    input.delivery.profileId !== input.body.agentProfileId ||
    input.delivery.bindingId !== input.body.bindingId ||
    input.delivery.spaceId !== input.body.spaceId ||
    input.delivery.triggerMessageId !== input.body.triggerMessageId ||
    input.delivery.dispatchId !== input.body.dispatchId ||
    input.delivery.idempotencyKey !== input.body.idempotencyKey ||
    input.delivery.submissionId !== input.body.submissionId
  ) {
    throw new Error(
      "Message Channel callback does not match its Native Delivery authority"
    );
  }
}

function assertClaimPreservedMessageChannelAuthority(input: {
  claim: RemoteAgentNativeDeliveryRecord;
  delivery: RemoteAgentNativeDeliveryRecord;
}): void {
  if (
    input.claim.conversationKind !== "message_channel" ||
    input.claim.deliveryId !== input.delivery.deliveryId ||
    input.claim.messageChannelLocator === null ||
    input.claim.providerPublicationIdempotencyKey !==
      input.delivery.providerPublicationIdempotencyKey ||
    JSON.stringify(input.claim.messageChannelLocator) !==
      JSON.stringify(input.delivery.messageChannelLocator)
  ) {
    throw new Error(
      "Message Channel publication claim changed its frozen authority"
    );
  }
}

function requireSubmissionId(
  delivery: RemoteAgentNativeDeliveryRecord
): string {
  const value = delivery.submissionId?.trim();
  if (!value) {
    throw new Error("Message Channel Native Delivery has no submission id");
  }
  return value;
}

function requireFinalPublicationClaimId(
  delivery: RemoteAgentNativeDeliveryRecord
): string {
  const value = delivery.finalPublicationClaimId?.trim();
  if (!value) {
    throw new Error(
      "Message Channel Native Delivery has no final publication claim id"
    );
  }
  return value;
}

function normalizeAttachments(
  attachments: readonly SpaceMessageAttachment[] | undefined
): readonly SpaceMessageAttachment[] {
  return attachments ?? [];
}

function buildFinalPublicationPayload(input: {
  body: RemoteAgentCoreCallbackBody;
  resumeStatus: "accepted" | "retry_observed";
}): RemoteAgentFinalPublicationPayload {
  const content = projectMessageChannelTerminalContent({
    attachments:
      input.body.status === "failed"
        ? []
        : normalizeAttachments(input.body.attachments),
    text:
      input.body.status === "failed"
        ? resolveCenterAgentCallbackFailureMessage(input.body)
        : input.body.text,
  });
  if (content.attachments.length > 0) {
    throw new Error(
      "Message Channel final publication payload contains unsupported attachments"
    );
  }
  return {
    failureCode: input.body.status === "failed" ? input.body.failureCode : null,
    failureDetail:
      input.body.status === "failed"
        ? (input.body.failureDetail ?? null)
        : null,
    resumeStatus: input.resumeStatus,
    storageVersion: 1,
    text: content.text,
  };
}

function requireFinalPublicationPayload(
  delivery: RemoteAgentNativeDeliveryRecord
): RemoteAgentFinalPublicationPayload {
  if (delivery.finalPublicationPayload === null) {
    throw new Error(
      "Message Channel final publication claim has no frozen payload"
    );
  }
  return delivery.finalPublicationPayload;
}

async function scheduleAmbiguousPublicationRetry(input: {
  claimId: string;
  db: D1Database;
  delivery: RemoteAgentNativeDeliveryRecord;
  nowMs: number;
  providerProgressSequence: number | null;
  providerPublicationIdempotencyKey: string;
  reasonCode: string;
}): Promise<
  Extract<
    RemoteAgentMessageChannelPublicationOutcome,
    { status: "duplicate" | "in_progress" | "outcome_unknown" | "retryable" }
  >
> {
  const attemptStartedAtMs =
    input.delivery.finalPublicationClaimedAtMs ?? input.nowMs;
  const ambiguityDeadlineAtMs =
    input.delivery.finalPublicationAmbiguityDeadlineAtMs ??
    attemptStartedAtMs +
      REMOTE_AGENT_LARK_PLATFORM_REPLY_DEDUPLICATION_WINDOW_MS;
  if (ambiguityDeadlineAtMs <= input.nowMs) {
    await markMessageChannelPublicationOutcomeUnknown({
      claimId: input.claimId,
      db: input.db,
      delivery: input.delivery,
      nowMs: input.nowMs,
      providerProgressSequence: input.providerProgressSequence,
      providerPublicationIdempotencyKey:
        input.providerPublicationIdempotencyKey,
    });
    return await resolveRemoteAgentMessageChannelPublicationConflict({
      db: input.db,
      idempotencyKey: input.delivery.idempotencyKey,
      nowMs: input.nowMs,
      submissionId: requireSubmissionId(input.delivery),
    });
  }
  const nextAttemptAtMs = Math.min(
    input.nowMs +
      REMOTE_AGENT_MESSAGE_CHANNEL_AMBIGUOUS_PUBLICATION_RETRY_DELAY_MS,
    ambiguityDeadlineAtMs
  );
  const scheduled =
    await scheduleRemoteAgentMessageChannelFinalPublicationRetry({
      ambiguityDeadlineAtMs,
      claimId: input.claimId,
      db: input.db,
      failureCode: input.reasonCode,
      idempotencyKey: input.delivery.idempotencyKey,
      nextAttemptAtMs,
      nowMs: input.nowMs,
      providerProgressSequence: input.providerProgressSequence,
      providerPublicationIdempotencyKey:
        input.providerPublicationIdempotencyKey,
      submissionId: requireSubmissionId(input.delivery),
    });
  if (scheduled) {
    return {
      reasonCode: input.reasonCode,
      retryAfterMs: requireRetryAfterMs(scheduled, input.nowMs),
      status: "retryable",
    };
  }
  return await resolveRemoteAgentMessageChannelPublicationConflict({
    db: input.db,
    idempotencyKey: input.delivery.idempotencyKey,
    nowMs: input.nowMs,
    submissionId: requireSubmissionId(input.delivery),
  });
}

async function markMessageChannelPublicationOutcomeUnknown(input: {
  claimId: string;
  db: D1Database;
  delivery: RemoteAgentNativeDeliveryRecord;
  nowMs: number;
  providerProgressSequence: number | null;
  providerPublicationIdempotencyKey: string;
}): Promise<RemoteAgentNativeDeliveryRecord | null> {
  return await markRemoteAgentMessageChannelFinalPublicationOutcomeUnknown({
    claimId: input.claimId,
    db: input.db,
    idempotencyKey: input.delivery.idempotencyKey,
    nowMs: input.nowMs,
    providerProgressSequence: input.providerProgressSequence,
    providerPublicationIdempotencyKey: input.providerPublicationIdempotencyKey,
    submissionId: requireSubmissionId(input.delivery),
  });
}

async function recordPermanentMessageChannelPublicationAmbiguity(input: {
  claimId: string;
  db: D1Database;
  delivery: RemoteAgentNativeDeliveryRecord;
  nowMs: number;
  providerProgressSequence: number | null;
  providerPublicationIdempotencyKey: string;
}): Promise<
  Exclude<RemoteAgentMessageChannelPublicationOutcome, { status: "published" }>
> {
  await markMessageChannelPublicationOutcomeUnknown(input);
  return await resolveRemoteAgentMessageChannelPublicationConflict({
    db: input.db,
    idempotencyKey: input.delivery.idempotencyKey,
    nowMs: input.nowMs,
    submissionId: requireSubmissionId(input.delivery),
  });
}

export async function resolveRemoteAgentMessageChannelPublicationConflict(input: {
  db: D1Database;
  idempotencyKey: string;
  nowMs: number;
  submissionId: string;
}): Promise<
  Exclude<RemoteAgentMessageChannelPublicationOutcome, { status: "published" }>
> {
  let delivery = await readRemoteAgentNativeDeliveryBySubmissionId({
    db: input.db,
    submissionId: input.submissionId,
  });
  if (delivery?.finalPublicationState === "outcome_unknown") {
    return { status: "outcome_unknown" };
  }
  if (
    delivery?.finalPublicationState === "published" &&
    delivery.providerPublicationResultId
  ) {
    return {
      delivery,
      resultId: delivery.providerPublicationResultId,
      status: "duplicate",
    };
  }
  if (
    delivery?.finalPublicationState === "claimed" &&
    (delivery.finalPublicationClaimExpiresAtMs === null ||
      delivery.finalPublicationClaimExpiresAtMs <= input.nowMs)
  ) {
    const expiredClaimResolution =
      await resolveExpiredMessageChannelFinalPublicationClaim({
        db: input.db,
        delivery,
        idempotencyKey: input.idempotencyKey,
        nowMs: input.nowMs,
        submissionId: input.submissionId,
      });
    if (expiredClaimResolution) {
      return expiredClaimResolution;
    }
  }
  const expired =
    await expireRemoteAgentMessageChannelFinalPublicationAmbiguity({
      ambiguityWindowMs:
        REMOTE_AGENT_LARK_PLATFORM_REPLY_DEDUPLICATION_WINDOW_MS,
      db: input.db,
      idempotencyKey: input.idempotencyKey,
      nowMs: input.nowMs,
      submissionId: input.submissionId,
    });
  if (expired?.finalPublicationState === "outcome_unknown") {
    return { status: "outcome_unknown" };
  }
  delivery = await readRemoteAgentNativeDeliveryBySubmissionId({
    db: input.db,
    submissionId: input.submissionId,
  });
  if (delivery?.finalPublicationState === "outcome_unknown") {
    return { status: "outcome_unknown" };
  }
  if (
    delivery?.finalPublicationState === "published" &&
    delivery.providerPublicationResultId
  ) {
    return {
      delivery,
      resultId: delivery.providerPublicationResultId,
      status: "duplicate",
    };
  }
  if (
    delivery?.finalPublicationState === null &&
    delivery.finalPublicationNextAttemptAtMs !== null &&
    delivery.finalPublicationNextAttemptAtMs > input.nowMs
  ) {
    return {
      reasonCode:
        delivery.failureCode ??
        "message_channel.final_publication_outcome_unknown",
      retryAfterMs: requireRetryAfterMs(delivery, input.nowMs),
      status: "retryable",
    };
  }
  if (
    delivery?.finalPublicationState === "claimed" &&
    delivery.finalPublicationClaimExpiresAtMs !== null &&
    delivery.finalPublicationClaimExpiresAtMs > input.nowMs
  ) {
    return {
      reasonCode: "remote_agent.callback_publication_in_progress",
      retryAfterMs: delivery.finalPublicationClaimExpiresAtMs - input.nowMs,
      status: "retryable",
    };
  }
  return { status: "in_progress" };
}

async function resolveExpiredMessageChannelFinalPublicationClaim(input: {
  db: D1Database;
  delivery: RemoteAgentNativeDeliveryRecord;
  idempotencyKey: string;
  nowMs: number;
  submissionId: string;
}): Promise<Exclude<
  RemoteAgentMessageChannelPublicationOutcome,
  { status: "published" }
> | null> {
  if (
    input.delivery.finalPublicationProviderProgressSequence !== null &&
    input.delivery.providerPublicationIdempotencyKey
  ) {
    return await recordPermanentMessageChannelPublicationAmbiguity({
      claimId: requireFinalPublicationClaimId(input.delivery),
      db: input.db,
      delivery: input.delivery,
      nowMs: input.nowMs,
      providerProgressSequence:
        input.delivery.finalPublicationProviderProgressSequence,
      providerPublicationIdempotencyKey:
        input.delivery.providerPublicationIdempotencyKey,
    });
  }
  const recovered =
    await recoverExpiredRemoteAgentMessageChannelFinalPublicationClaim({
      ambiguityWindowMs:
        REMOTE_AGENT_LARK_PLATFORM_REPLY_DEDUPLICATION_WINDOW_MS,
      db: input.db,
      failureCode: "message_channel.final_publication_outcome_unknown",
      idempotencyKey: input.idempotencyKey,
      nextAttemptAtMs:
        input.nowMs +
        REMOTE_AGENT_MESSAGE_CHANNEL_AMBIGUOUS_PUBLICATION_RETRY_DELAY_MS,
      nowMs: input.nowMs,
      submissionId: input.submissionId,
    });
  return recovered
    ? {
        reasonCode:
          recovered.failureCode ??
          "message_channel.final_publication_outcome_unknown",
        retryAfterMs: requireRetryAfterMs(recovered, input.nowMs),
        status: "retryable",
      }
    : null;
}

function requireRetryAfterMs(
  delivery: RemoteAgentNativeDeliveryRecord,
  nowMs: number
): number {
  const nextAttemptAtMs = delivery.finalPublicationNextAttemptAtMs;
  if (nextAttemptAtMs === null || nextAttemptAtMs <= nowMs) {
    throw new Error(
      "Message Channel ambiguous publication recovery has no future retry"
    );
  }
  return nextAttemptAtMs - nowMs;
}

function isConfirmedMessageChannelPublication(
  delivery: RemoteAgentNativeDeliveryRecord | null,
  resultId: string
): delivery is RemoteAgentNativeDeliveryRecord {
  return Boolean(
    delivery &&
      (delivery.status === "completed" || delivery.status === "failed") &&
      delivery.finalPublicationState === "published" &&
      delivery.providerPublicationResultId === resultId &&
      delivery.publishedSignalId === null
  );
}
