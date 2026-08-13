import {
  buildOpenMeldOrganizationWebUrl,
  HOSTED_CENTER_AGENT_CONTROLLER_REF,
  remoteAgentSlackAppMentionEventSchema,
  remoteAgentSlackEventsApiPayloadSchema,
} from "@openmeld/schemas";
import type {
  AuthRpcResolveOrganizationAccountIdentityResult,
  CenterAgentModelRoute,
  ChannelContext,
  RemoteAgentSlackAppMentionEvent,
  RemoteAgentTurnEnvelope,
} from "@openmeld/schemas/types";
import { readPrimaryAgentProfileBindingRecord } from "../../agent-profile-binding/infrastructure/d1/agent-profile-binding-repo";
import {
  CenterAgentModelResolutionError,
  resolveCenterAgentModelRouteForBinding,
} from "../../center-agent/application/center-agent-model-service";
import { readCenterAgentDesignationRecord } from "../../center-agent/center-agent-repository";
import { readModelCatalog } from "../../config/model-catalog";
import type { CoreBindings } from "../../lib/bindings";
import { identityDb, localStateDb } from "../../lib/bindings";
import { readOrganizationAccountIdentityProjection } from "../../organizations/organization-context";
import { CORE_LOG_EVENTS } from "../../shared/observability/log-events";
import {
  claimRemoteAgentSlackEventIngress,
  completeRemoteAgentSlackEventIngress,
  failRemoteAgentSlackEventIngress,
  releaseRemoteAgentSlackEventIngressForRetry,
} from "../infrastructure/d1/slack-event-ingress-repo";
import {
  deleteSlackUserIdentityLinkIfMatches,
  insertSlackUserIdentityLinkIfAbsent,
  readSlackUserIdentityLink,
  upsertSlackUserIdentityLinkForSameUser,
} from "../infrastructure/d1/slack-user-identity-link-repo";
import { readRemoteAgentSlackWorkspaceBinding } from "../infrastructure/d1/slack-workspace-binding-repo";
import {
  CENTER_AGENT_CHANNEL_MODEL_UNAVAILABLE_TEXT,
  CENTER_AGENT_CHANNEL_UNAVAILABLE_TEXT,
} from "./center-agent-channel-failure-copy";
import { parseCoreOwnedRemoteAgentTurnEnvelope } from "./center-agent-context-scope";
import {
  admitRemoteAgentSlackNativeDelivery,
  attachCenterAgentMemoryToTurnEnvelope,
  publishRemoteAgentSlackAdmissionFailure,
  RemoteAgentSlackSubmissionOutcomeUnknownError,
  submitRemoteAgentSlackNativeDelivery,
} from "./native-delivery-service";
import { resolveSlackBotToken } from "./slack-bot-token";
import {
  isSlackFullWorkspaceMember,
  postSlackThreadMessage,
  readSlackConversationInfo,
  readSlackUserIdentity,
  SlackMessagePublicationError,
  setSlackThreadStatus,
} from "./slack-client";
import { buildRemoteAgentSlackConversationId } from "./slack-conversation-id";
import { encryptSlackSearchAuthorization } from "./slack-search-authorization";
import {
  commitSlackThreadContextCursor,
  resolveSlackThreadContext,
} from "./slack-thread-context";

const REMOTE_AGENT_SLACK_WORKSPACE_NOT_CONNECTED_TEXT =
  "This Slack workspace is not connected to an OpenMeld organization yet.";
const REMOTE_AGENT_SLACK_EVENT_PROCESSING_FAILURE_CODE =
  "remote_agent.slack_event_processing_failed";
const REMOTE_AGENT_SLACK_EVENT_PROCESSING_FAILURE_TEXT =
  "I couldn't complete that request. Please try again. If it keeps happening, open OpenMeld diagnostics.";
const REMOTE_AGENT_SLACK_WORKING_STATUS = "is working on your request…";
const SLACK_CONVERSATION_INFO_LOOKUP_TIMEOUT_MS = 500;
const SLACK_THREAD_STATUS_TIMEOUT_MS = 500;
const REMOTE_AGENT_SLACK_EVENT_CLAIM_LEASE_MS = 5 * 60_000;
export const REMOTE_AGENT_SLACK_EVENT_MAX_QUEUE_ATTEMPTS = 4;

type SlackMemberIdentity = {
  humanProfileId: string | null;
  memberCount: number;
  memberId: string;
  organizationId: string;
  organizationName: string;
  organizationPersonal: boolean;
  organizationSlug: string;
  role: string | null;
  userDisplayName: string;
  userEmail: string;
  userId: string;
};

type SlackOrganizationIdentity = Pick<
  SlackMemberIdentity,
  | "memberCount"
  | "organizationId"
  | "organizationName"
  | "organizationPersonal"
  | "organizationSlug"
>;

type SlackTurnParticipant =
  | {
      kind: "anonymous_member";
      organization: SlackOrganizationIdentity;
      slackDisplayName: string;
      slackEmail: string | null;
      slackUserId: string;
    }
  | {
      kind: "external";
      organization: SlackOrganizationIdentity;
      slackDisplayName: string;
      slackUserId: string;
    }
  | {
      kind: "member";
      member: SlackMemberIdentity;
    };

type SlackCenterAgentTarget = {
  agentProfileId: string;
  bindingId: string;
  modelRoute: CenterAgentModelRoute;
  ownerUserId: string;
  profileHandle: string;
  profileName: string;
};

type SlackMemberResolution = {
  belongsToSlackWorkspace: boolean;
  member: SlackMemberIdentity | null;
  slackDisplayName: string;
  slackEmail: string | null;
};

type OrganizationAccountIdentityProjection = Extract<
  AuthRpcResolveOrganizationAccountIdentityResult,
  { ok: true }
>;

type SlackCenterAgentProfileOwnerRow = {
  owner_user_id: string;
  profile_handle: string;
  profile_name: string;
};

type SlackEventFailureContext = {
  botToken: string | null;
  channelId: string;
  db: D1Database | null;
  env: CoreBindings;
  eventId: string | null;
  idempotencyKey: string;
  ledgerStarted: boolean;
  slackTeamId: string;
  threadTs: string;
};

export async function processRemoteAgentSlackEvent(
  env: CoreBindings,
  input: unknown,
  context: {
    finalAttempt?: boolean;
    gatewayRequestId?: string;
    nowMs?: number;
    queueAttempts?: number | null;
    queueMessageId?: string | null;
    receivedAtMs?: number;
    slackRetryNum?: number | null;
    slackRetryReason?: string | null;
  } = {}
): Promise<{
  status:
    | "duplicate"
    | "failed"
    | "ignored"
    | "processed"
    | "recovery_pending"
    | "replied";
}> {
  const prepared = parseRemoteAgentSlackAppMention(input);
  if (!prepared) {
    return { status: "ignored" };
  }

  const { event, eventId, slackTeamId, threadTs } = prepared;
  const idempotencyKey = buildSlackIdempotencyKey({
    channelId: event.channel,
    eventId,
    teamId: slackTeamId,
    ts: event.ts,
  });
  const failureContext: SlackEventFailureContext = {
    botToken: null,
    channelId: event.channel,
    db: null,
    env,
    eventId,
    idempotencyKey,
    ledgerStarted: false,
    slackTeamId,
    threadTs,
  };

  const ingressDb = localStateDb(env) ?? null;
  const nowMs = context.nowMs ?? Date.now();
  const claimId = crypto.randomUUID();
  const duplicate = await claimSlackEventIngress({
    claimId,
    context,
    db: ingressDb,
    eventId,
    eventKey: idempotencyKey,
    nowMs,
    slackTeamId,
  });
  if (duplicate) {
    return { status: "duplicate" };
  }

  try {
    const outcome = await processRemoteAgentSlackAppMention({
      env,
      event,
      eventId,
      failureContext,
      idempotencyKey,
      slackTeamId,
      threadTs,
    });
    if (ingressDb) {
      await completeRemoteAgentSlackEventIngress({
        claimId,
        db: ingressDb,
        eventKey: idempotencyKey,
        nowMs: Date.now(),
        outcomeStatus: outcome.status,
      });
    }
    return outcome;
  } catch (error) {
    const settlement = await settleFailedSlackEventIngress({
      claimId,
      context,
      db: ingressDb,
      error,
      eventKey: idempotencyKey,
      failureContext,
    });
    if (settlement === "settled") {
      return { status: "failed" };
    }
    if (settlement === "recovery_pending") {
      return { status: "recovery_pending" };
    }
    throw error;
  }
}

function parseRemoteAgentSlackAppMention(input: unknown): {
  event: RemoteAgentSlackAppMentionEvent;
  eventId: string | null;
  slackTeamId: string;
  threadTs: string;
} | null {
  const parsed = remoteAgentSlackEventsApiPayloadSchema.safeParse(input);
  if (
    !parsed.success ||
    parsed.data.type !== "event_callback" ||
    parsed.data.event.type !== "app_mention"
  ) {
    return null;
  }
  const event = remoteAgentSlackAppMentionEventSchema.safeParse(
    parsed.data.event
  );
  if (!event.success) {
    return null;
  }
  return {
    event: event.data,
    eventId: parsed.data.event_id ?? null,
    slackTeamId: parsed.data.team_id,
    threadTs: event.data.thread_ts ?? event.data.ts,
  };
}

async function claimSlackEventIngress(input: {
  claimId: string;
  context: {
    gatewayRequestId?: string;
    queueAttempts?: number | null;
    queueMessageId?: string | null;
    receivedAtMs?: number;
    slackRetryNum?: number | null;
    slackRetryReason?: string | null;
  };
  db: D1Database | null;
  eventId: string | null;
  eventKey: string;
  nowMs: number;
  slackTeamId: string;
}): Promise<boolean> {
  if (!input.db) {
    return false;
  }
  const claim = await claimRemoteAgentSlackEventIngress({
    claimExpiresAtMs: input.nowMs + REMOTE_AGENT_SLACK_EVENT_CLAIM_LEASE_MS,
    claimId: input.claimId,
    db: input.db,
    eventId: input.eventId,
    eventKey: input.eventKey,
    gatewayRequestId: input.context.gatewayRequestId ?? "direct",
    nowMs: input.nowMs,
    queueAttempts: input.context.queueAttempts ?? null,
    queueMessageId: input.context.queueMessageId ?? null,
    receivedAtMs: input.context.receivedAtMs ?? input.nowMs,
    slackRetryNum: input.context.slackRetryNum ?? null,
    slackRetryReason: input.context.slackRetryReason ?? null,
    slackTeamId: input.slackTeamId,
  });
  if (claim.status !== "duplicate") {
    return false;
  }
  console.info("[core.remote_agent.slack_event.duplicate]", {
    deliveryAttemptCount: claim.record.deliveryAttemptCount,
    eventId: input.eventId,
    eventState: claim.record.state,
    gatewayRequestId: input.context.gatewayRequestId ?? null,
    slackRetryNum: input.context.slackRetryNum ?? null,
    slackRetryReason: input.context.slackRetryReason ?? null,
    slackTeamId: input.slackTeamId,
  });
  return true;
}

async function settleFailedSlackEventIngress(input: {
  claimId: string;
  context: { finalAttempt?: boolean };
  db: D1Database | null;
  error: unknown;
  eventKey: string;
  failureContext: SlackEventFailureContext;
}): Promise<"recovery_pending" | "retry" | "settled"> {
  if (!input.context.finalAttempt) {
    if (input.db) {
      const released = await releaseRemoteAgentSlackEventIngressForRetry({
        claimId: input.claimId,
        db: input.db,
        eventKey: input.eventKey,
        failureCode: resolveSlackEventProcessingFailureCode(input.error),
        nowMs: Date.now(),
      });
      if (!released) {
        throw new Error("Slack event ingress retry release lost its claim.");
      }
    }
    return "retry";
  }
  return await settleFinalFailedSlackEventIngress(input);
}

async function settleFinalFailedSlackEventIngress(input: {
  claimId: string;
  db: D1Database | null;
  error: unknown;
  eventKey: string;
  failureContext: SlackEventFailureContext;
}): Promise<"recovery_pending" | "retry" | "settled"> {
  const failureOutcome = await handleRemoteAgentSlackEventFailure({
    context: input.failureContext,
    error: input.error,
  });
  if (!input.db) {
    return failureOutcome === "durable_retry" ? "retry" : "settled";
  }

  const nowMs = Date.now();
  if (failureOutcome === "durable_retry") {
    const failed = await failRemoteAgentSlackEventIngress({
      claimId: input.claimId,
      db: input.db,
      eventKey: input.eventKey,
      failureCode: resolveSlackEventProcessingFailureCode(input.error),
      nowMs,
    });
    if (!failed) {
      throw new Error("Slack event failure settlement lost its ingress claim.");
    }
    return "recovery_pending";
  }

  const completed = await completeRemoteAgentSlackEventIngress({
    claimId: input.claimId,
    db: input.db,
    eventKey: input.eventKey,
    nowMs,
    outcomeStatus:
      failureOutcome === "outcome_unknown"
        ? "failure_publication_outcome_unknown"
        : "failure_published",
  });
  if (!completed) {
    throw new Error("Slack event failure settlement lost its ingress claim.");
  }
  return "settled";
}

function resolveSlackEventProcessingFailureCode(error: unknown): string {
  return error instanceof RemoteAgentSlackSubmissionOutcomeUnknownError
    ? error.reasonCode
    : REMOTE_AGENT_SLACK_EVENT_PROCESSING_FAILURE_CODE;
}

async function processRemoteAgentSlackAppMention(input: {
  env: CoreBindings;
  event: RemoteAgentSlackAppMentionEvent;
  eventId?: string | null;
  failureContext: SlackEventFailureContext;
  idempotencyKey: string;
  slackTeamId: string;
  threadTs: string;
}): Promise<{ status: "processed" | "replied" }> {
  const { env, event, failureContext, idempotencyKey, slackTeamId, threadTs } =
    input;

  const stateDb = localStateDb(env);
  const memberDb = identityDb(env);
  if (!(stateDb && memberDb)) {
    failureContext.botToken = normalizeOptionalText(
      env.SLACK_OPENMELD_BOT_TOKEN
    );
    throw new Error("Core D1 is unavailable for Slack event handling");
  }
  failureContext.db = stateDb;
  const botToken = await resolveSlackBotToken({
    cryptoKey: env.SLACK_OPENMELD_TOKEN_CRYPTO_KEY,
    db: stateDb,
    fallbackBotToken: env.SLACK_OPENMELD_BOT_TOKEN,
    slackTeamId,
  });
  failureContext.botToken = botToken;

  const conversationId = buildRemoteAgentSlackConversationId({
    channelId: event.channel,
    teamId: slackTeamId,
    threadTs,
  });

  const workspaceBinding = await readRemoteAgentSlackWorkspaceBinding({
    db: stateDb,
    slackTeamId,
  });
  if (!workspaceBinding) {
    await postSlackThreadMessage({
      botToken,
      channelId: event.channel,
      text: REMOTE_AGENT_SLACK_WORKSPACE_NOT_CONNECTED_TEXT,
      threadTs,
    });
    return { status: "replied" };
  }

  let centerAgent: SlackCenterAgentTarget | null;
  try {
    centerAgent = await readSlackCenterAgentTarget({
      db: memberDb,
      organizationId: workspaceBinding.organizationId,
    });
  } catch (error) {
    if (!(error instanceof CenterAgentModelResolutionError)) {
      throw error;
    }
    console.warn("[core.remote_agent.slack_event.model_unavailable]", {
      code: error.code,
      event: CORE_LOG_EVENTS.coreInternalError,
      eventId: input.eventId ?? null,
      organizationId: workspaceBinding.organizationId,
      slackTeamId,
    });
    await postSlackThreadMessage({
      botToken,
      channelId: event.channel,
      text: CENTER_AGENT_CHANNEL_MODEL_UNAVAILABLE_TEXT,
      threadTs,
    });
    return { status: "replied" };
  }
  if (!centerAgent) {
    await postSlackThreadMessage({
      botToken,
      channelId: event.channel,
      text: CENTER_AGENT_CHANNEL_UNAVAILABLE_TEXT,
      threadTs,
    });
    return { status: "replied" };
  }

  const dispatchId = buildSlackDispatchId({
    channelId: event.channel,
    eventId: input.eventId,
    teamId: slackTeamId,
    ts: event.ts,
  });

  const memberResolution = await resolveSlackMemberIdentity({
    authWorker: env.OPENMELD_AUTH_WORKER,
    botToken,
    db: memberDb,
    organizationId: workspaceBinding.organizationId,
    slackTeamId,
    slackUserId: event.user,
  });
  const organization = await readSlackOrganizationIdentity({
    authWorker: env.OPENMELD_AUTH_WORKER,
    organizationId: workspaceBinding.organizationId,
  });
  if (!organization) {
    throw new Error(
      `Slack workspace ${slackTeamId} points to an unavailable OpenMeld organization`
    );
  }
  let participant: SlackTurnParticipant;
  if (memberResolution.member) {
    participant = { kind: "member", member: memberResolution.member };
  } else if (memberResolution.belongsToSlackWorkspace) {
    participant = {
      kind: "anonymous_member",
      organization,
      slackDisplayName: memberResolution.slackDisplayName,
      slackEmail: memberResolution.slackEmail,
      slackUserId: event.user,
    };
  } else {
    participant = {
      kind: "external",
      organization,
      slackDisplayName: memberResolution.slackDisplayName,
      slackUserId: event.user,
    };
  }
  const conversationInfo = await resolveSlackConversationInfo({
    botToken,
    channelId: event.channel,
    slackTeamId,
  });
  const sourceText = normalizeSlackMentionText(event.text);
  const searchAuthorization =
    participant.kind === "member"
      ? await resolveSlackSearchAuthorization({
          actionToken: event.action_token,
          cryptoKey: env.SLACK_OPENMELD_TOKEN_CRYPTO_KEY,
          memberId: participant.member.memberId,
          organizationId: participant.member.organizationId,
          slackTeamId,
          slackUserId: event.user,
          sourceChannelId: event.channel,
          sourceThreadTs: threadTs,
          openMeldUserId: participant.member.userId,
        })
      : null;
  const threadContext = await resolveSlackThreadContext({
    botToken,
    connectionCreatedAtMs: workspaceBinding.createdAtMs,
    conversationId,
    currentMessageTs: event.ts,
    db: stateDb,
    includeRecentChannelMessages: !event.thread_ts,
    organizationId: organization.organizationId,
    slackChannelId: event.channel,
    slackTeamId,
    slackThreadTs: threadTs,
  });
  const turnEnvelope = await attachCenterAgentMemoryToTurnEnvelope({
    env,
    organizationId: organization.organizationId,
    query: sourceText,
    turnEnvelope: buildSlackTurnEnvelope({
      centerAgent,
      channelContext: threadContext.channelContext,
      channelId: event.channel,
      channelName: conversationInfo.channelName,
      conversationId,
      interactionEnvironment: conversationInfo.interactionEnvironment,
      participant,
      slackTeamId,
      slackUserId: event.user,
      searchAuthorization,
      threadTs,
      webAppUrl: env.WEB_APP_URL,
    }),
  });
  const deliveryRequest = {
    agentProfileId: centerAgent.agentProfileId,
    agentProfileOwnerUserId: centerAgent.ownerUserId,
    author:
      participant.kind === "member"
        ? {
            displayName: participant.member.userDisplayName,
            profileId: participant.member.humanProfileId,
            profileKind: "human" as const,
          }
        : {
            displayName: participant.slackDisplayName,
            profileId: null,
            profileKind: null,
          },
    bindingId: centerAgent.bindingId,
    conversationId,
    dispatchId,
    idempotencyKey,
    modelRoute: centerAgent.modelRoute,
    organizationId: organization.organizationId,
    speakerMember:
      participant.kind === "member"
        ? {
            memberId: participant.member.memberId,
            userId: participant.member.userId,
          }
        : null,
    slackChannelId: event.channel,
    slackTeamId,
    slackThreadTs: threadTs,
    sourceText,
    triggerMessageId: event.ts,
    turnEnvelope,
  };
  await admitRemoteAgentSlackNativeDelivery({
    db: stateDb,
    env,
    nowMs: Date.now(),
    request: deliveryRequest,
  });
  failureContext.ledgerStarted = true;
  await showRemoteAgentSlackThreadWorkingStatus({
    botToken,
    channelId: event.channel,
    eventId: input.eventId ?? null,
    slackTeamId,
    threadTs,
  });
  const submission = await submitRemoteAgentSlackNativeDelivery({
    db: stateDb,
    env,
    nowMs: Date.now(),
    request: deliveryRequest,
  });
  if (submission.status === "submitted") {
    try {
      await commitSlackThreadContextCursor({
        db: stateDb,
        nowMs: Date.now(),
        resolution: threadContext,
      });
    } catch (error) {
      console.warn("[core.remote_agent.slack_thread_context.cursor_failed]", {
        channelId: event.channel,
        error: toErrorMessage(error),
        event: CORE_LOG_EVENTS.coreInternalError,
        eventId: input.eventId ?? null,
        slackTeamId,
        threadTs,
      });
    }
  }
  return { status: "processed" };
}

async function showRemoteAgentSlackThreadWorkingStatus(input: {
  botToken: string;
  channelId: string;
  eventId: string | null;
  slackTeamId: string;
  threadTs: string;
}): Promise<void> {
  try {
    await setSlackThreadStatus({
      botToken: input.botToken,
      channelId: input.channelId,
      signal: AbortSignal.timeout(SLACK_THREAD_STATUS_TIMEOUT_MS),
      status: REMOTE_AGENT_SLACK_WORKING_STATUS,
      threadTs: input.threadTs,
    });
  } catch (error) {
    console.warn("[core.remote_agent.slack_thread_status.unavailable]", {
      channelId: input.channelId,
      error: toErrorMessage(error),
      event: CORE_LOG_EVENTS.coreInternalError,
      eventId: input.eventId,
      slackTeamId: input.slackTeamId,
      threadTs: input.threadTs,
    });
  }
}

async function handleRemoteAgentSlackEventFailure(input: {
  context: SlackEventFailureContext;
  error: unknown;
}): Promise<"durable_retry" | "outcome_unknown" | "published"> {
  const { context, error } = input;
  const errorMessage = toErrorMessage(error);
  let ledgerPublicationOutcome:
    | "durable_retry"
    | "outcome_unknown"
    | "published" = "durable_retry";
  if (context.db && context.ledgerStarted) {
    try {
      const publication = await publishRemoteAgentSlackAdmissionFailure({
        db: context.db,
        env: context.env,
        failureCode: REMOTE_AGENT_SLACK_EVENT_PROCESSING_FAILURE_CODE,
        idempotencyKey: context.idempotencyKey,
        nowMs: Date.now(),
        status: "failed",
        text: REMOTE_AGENT_SLACK_EVENT_PROCESSING_FAILURE_TEXT,
      });
      if (publication.status === "outcome_unknown") {
        ledgerPublicationOutcome = "outcome_unknown";
      } else if (publication.status === "published") {
        ledgerPublicationOutcome = "published";
      }
    } catch (ledgerError) {
      console.warn("[core.remote_agent.slack_event.failure_ledger_failed]", {
        channelId: context.channelId,
        error: toErrorMessage(ledgerError),
        event: CORE_LOG_EVENTS.coreInternalError,
        eventId: context.eventId,
        slackTeamId: context.slackTeamId,
      });
    }
  }

  console.warn("[core.remote_agent.slack_event.processing_failed]", {
    channelId: context.channelId,
    error: errorMessage,
    event: CORE_LOG_EVENTS.coreInternalError,
    eventId: context.eventId,
    ledgerStarted: context.ledgerStarted,
    slackTeamId: context.slackTeamId,
  });

  if (context.ledgerStarted) {
    return ledgerPublicationOutcome;
  }
  if (
    error instanceof SlackMessagePublicationError &&
    error.publicationOutcome === "unknown"
  ) {
    return "outcome_unknown";
  }
  if (!context.botToken) {
    return "durable_retry";
  }
  try {
    await postSlackThreadMessage({
      botToken: context.botToken,
      channelId: context.channelId,
      text: REMOTE_AGENT_SLACK_EVENT_PROCESSING_FAILURE_TEXT,
      threadTs: context.threadTs,
    });
    return "published";
  } catch (publicationError) {
    console.warn("[core.remote_agent.slack_event.failure_publish_failed]", {
      channelId: context.channelId,
      error: toErrorMessage(publicationError),
      event: CORE_LOG_EVENTS.coreInternalError,
      eventId: context.eventId,
      slackTeamId: context.slackTeamId,
    });
    return publicationError instanceof SlackMessagePublicationError &&
      publicationError.publicationOutcome === "unknown"
      ? "outcome_unknown"
      : "durable_retry";
  }
}

async function resolveSlackMemberIdentity(input: {
  authWorker: CoreBindings["OPENMELD_AUTH_WORKER"];
  botToken: string;
  db: D1Database;
  organizationId: string;
  slackTeamId: string;
  slackUserId: string;
}): Promise<SlackMemberResolution> {
  const slackIdentity = await readSlackUserIdentity({
    botToken: input.botToken,
    userId: input.slackUserId,
  });
  const belongsToSlackWorkspace = isSlackFullWorkspaceMember({
    identity: slackIdentity,
    slackTeamId: input.slackTeamId,
  });
  const slackDisplayName = slackIdentity.displayName ?? input.slackUserId;
  if (!belongsToSlackWorkspace) {
    return {
      belongsToSlackWorkspace: false,
      member: null,
      slackDisplayName,
      slackEmail: slackIdentity.email,
    };
  }

  const linkedIdentity = await readSlackUserIdentityLink({
    db: input.db,
    slackTeamId: input.slackTeamId,
    slackUserId: input.slackUserId,
  });
  if (linkedIdentity) {
    const linkedMember = await readSlackMemberByUserId({
      authWorker: input.authWorker,
      organizationId: input.organizationId,
      userId: linkedIdentity.openmeldUserId,
    });
    if (
      linkedIdentity.organizationId === input.organizationId &&
      linkedMember === null
    ) {
      await deleteSlackUserIdentityLinkIfMatches({
        db: input.db,
        organizationId: linkedIdentity.organizationId,
        slackTeamId: input.slackTeamId,
        slackUserId: input.slackUserId,
        openmeldUserId: linkedIdentity.openmeldUserId,
      });
    }
    if (linkedIdentity.organizationId !== input.organizationId) {
      if (linkedMember) {
        await upsertSlackUserIdentityLinkForSameUser({
          db: input.db,
          nowMs: Date.now(),
          organizationId: input.organizationId,
          slackTeamId: input.slackTeamId,
          slackUserId: input.slackUserId,
          source: linkedIdentity.source,
          openmeldUserId: linkedIdentity.openmeldUserId,
        });
      } else {
        await deleteSlackUserIdentityLinkIfMatches({
          db: input.db,
          organizationId: linkedIdentity.organizationId,
          slackTeamId: input.slackTeamId,
          slackUserId: input.slackUserId,
          openmeldUserId: linkedIdentity.openmeldUserId,
        });
      }
    }
    if (linkedMember) {
      return {
        belongsToSlackWorkspace: true,
        member: linkedMember,
        slackDisplayName,
        slackEmail: slackIdentity.email,
      };
    }
  }

  const member = slackIdentity.email
    ? await readSlackMemberByEmail({
        authWorker: input.authWorker,
        email: slackIdentity.email,
        organizationId: input.organizationId,
      })
    : null;
  if (member) {
    await insertSlackUserIdentityLinkIfAbsent({
      db: input.db,
      nowMs: Date.now(),
      organizationId: input.organizationId,
      slackTeamId: input.slackTeamId,
      slackUserId: input.slackUserId,
      source: "email_auto",
      openmeldUserId: member.userId,
    });
  }

  return {
    belongsToSlackWorkspace: true,
    member,
    slackDisplayName,
    slackEmail: slackIdentity.email,
  };
}

async function readSlackMemberByEmail(input: {
  authWorker: CoreBindings["OPENMELD_AUTH_WORKER"];
  email: string;
  organizationId: string;
}): Promise<SlackMemberIdentity | null> {
  const projection = await readOrganizationAccountIdentityProjection({
    account: { email: input.email, kind: "email" },
    authWorker: input.authWorker,
    organizationId: input.organizationId,
  });
  return projection?.ok ? mapSlackMemberIdentityProjection(projection) : null;
}

async function readSlackOrganizationIdentity(input: {
  authWorker: CoreBindings["OPENMELD_AUTH_WORKER"];
  organizationId: string;
}): Promise<SlackOrganizationIdentity | null> {
  const projection = await readOrganizationAccountIdentityProjection({
    authWorker: input.authWorker,
    organizationId: input.organizationId,
  });
  return projection?.ok
    ? {
        memberCount: projection.organization.memberCount,
        organizationId: projection.organization.id,
        organizationName: projection.organization.name,
        organizationPersonal: projection.organization.personal,
        organizationSlug: projection.organization.slug,
      }
    : null;
}

async function readSlackMemberByUserId(input: {
  authWorker: CoreBindings["OPENMELD_AUTH_WORKER"];
  organizationId: string;
  userId: string;
}): Promise<SlackMemberIdentity | null> {
  const projection = await readOrganizationAccountIdentityProjection({
    account: { kind: "user_id", userId: input.userId },
    authWorker: input.authWorker,
    organizationId: input.organizationId,
  });
  return projection?.ok ? mapSlackMemberIdentityProjection(projection) : null;
}

function mapSlackMemberIdentityProjection(
  projection: OrganizationAccountIdentityProjection
): SlackMemberIdentity | null {
  const account = projection.account;
  const membership = account?.membership;
  if (!(account && membership)) {
    return null;
  }
  return {
    humanProfileId: account.defaultHumanProfile?.profileId ?? null,
    memberCount: projection.organization.memberCount,
    memberId: membership.memberId,
    organizationId: projection.organization.id,
    organizationName: projection.organization.name,
    organizationPersonal: projection.organization.personal,
    organizationSlug: projection.organization.slug,
    role: membership.role,
    userDisplayName: account.displayName,
    userEmail: account.email,
    userId: account.userId,
  };
}

async function readSlackCenterAgentTarget(input: {
  db: D1Database;
  organizationId: string;
}): Promise<SlackCenterAgentTarget | null> {
  const designation = await readCenterAgentDesignationRecord({
    db: input.db,
    organizationId: input.organizationId,
  });
  if (!designation) {
    return null;
  }

  const owner = await input.db
    .prepare(
      `
        SELECT owner_user_id, profile_name, profile_handle
        FROM openmeld_profiles
        WHERE profile_id = ?
          AND profile_kind = 'agent'
          AND status = 'active'
        LIMIT 1
      `
    )
    .bind(designation.agentProfileId)
    .first<SlackCenterAgentProfileOwnerRow>();
  if (!owner) {
    return null;
  }

  const binding = await readPrimaryAgentProfileBindingRecord({
    agentProfileId: designation.agentProfileId,
    db: input.db,
    owner: { id: owner.owner_user_id, kind: "owner_account" },
  });
  if (
    binding?.runtimeKind !== "hosted_center_agent" ||
    binding.agentControllerRef !== HOSTED_CENTER_AGENT_CONTROLLER_REF
  ) {
    return null;
  }

  return {
    agentProfileId: designation.agentProfileId,
    bindingId: binding.bindingId,
    modelRoute: resolveCenterAgentModelRouteForBinding({
      binding,
      catalog: readModelCatalog(),
    }),
    ownerUserId: owner.owner_user_id,
    profileHandle: owner.profile_handle,
    profileName: owner.profile_name,
  };
}

function buildSlackTurnEnvelope(input: {
  centerAgent: SlackCenterAgentTarget;
  channelContext: ChannelContext;
  channelId: string;
  channelName: string | null;
  conversationId: string;
  interactionEnvironment: NonNullable<
    RemoteAgentTurnEnvelope["interactionEnvironment"]
  >;
  participant: SlackTurnParticipant;
  slackTeamId: string;
  slackUserId: string;
  searchAuthorization: {
    encryptedAuthorization: string;
  } | null;
  threadTs: string;
  webAppUrl?: string;
}): RemoteAgentTurnEnvelope {
  const webAppUrl = normalizeOptionalText(input.webAppUrl);
  const organization =
    input.participant.kind === "member"
      ? input.participant.member
      : input.participant.organization;
  return parseCoreOwnedRemoteAgentTurnEnvelope({
    interactionEnvironment: input.interactionEnvironment,
    sender:
      input.participant.kind === "member"
        ? {
            kind: "member",
            id: input.participant.member.memberId,
            displayName: input.participant.member.userDisplayName,
            messageChannelIdentity: {
              connectionId: input.slackTeamId,
              provider: "slack",
              providerUserId: input.slackUserId,
            },
            ownerUserId: input.participant.member.userId,
            ...(input.participant.member.humanProfileId
              ? { profileId: input.participant.member.humanProfileId }
              : {}),
            ...(input.participant.member.role
              ? { role: input.participant.member.role }
              : {}),
            verified: true,
          }
        : {
            kind: "member",
            id: `slack:${input.slackTeamId}:${input.participant.slackUserId}`,
            displayName: input.participant.slackDisplayName,
            ...(input.participant.kind === "anonymous_member"
              ? {
                  messageChannelIdentity: {
                    connectionId: input.slackTeamId,
                    provider: "slack",
                    ...(input.participant.kind === "anonymous_member" &&
                    input.participant.slackEmail
                      ? { providerUserEmail: input.participant.slackEmail }
                      : {}),
                    providerUserId: input.participant.slackUserId,
                  },
                }
              : {}),
            verified: false,
          },
    space: {
      id: input.conversationId,
      name: input.channelName ? `#${input.channelName}` : "Slack channel",
      kind: "space",
      isCenterAgentDm: false,
    },
    organization: {
      id: organization.organizationId,
      name: organization.organizationName,
      personal: organization.organizationPersonal,
      memberCount: organization.memberCount,
      ...(webAppUrl
        ? {
            webUrl: buildOpenMeldOrganizationWebUrl({
              organizationSlug: organization.organizationSlug,
              webAppUrl,
            }),
          }
        : {}),
    },
    centerAgent: {
      profileHandle: input.centerAgent.profileHandle,
      profileName: input.centerAgent.profileName,
    },
    trigger: {
      source: "slack",
      teamId: input.slackTeamId,
      channelId: input.channelId,
      threadTs: input.threadTs,
      conversationId: input.conversationId,
      ...(input.searchAuthorization
        ? { searchAuthorization: input.searchAuthorization }
        : {}),
      ...(input.channelName ? { channelName: input.channelName } : {}),
    },
    channelContext: input.channelContext,
  });
}

async function resolveSlackSearchAuthorization(input: {
  actionToken?: string;
  cryptoKey?: string;
  memberId: string;
  organizationId: string;
  slackTeamId: string;
  slackUserId: string;
  sourceChannelId: string;
  sourceThreadTs: string;
  openMeldUserId: string;
}): Promise<{
  encryptedAuthorization: string;
} | null> {
  const actionToken = normalizeOptionalText(input.actionToken);
  if (!actionToken) {
    return null;
  }
  const cryptoKey = normalizeOptionalText(input.cryptoKey);
  if (!cryptoKey) {
    console.warn("[core.remote_agent.slack_search.authorization_unavailable]", {
      error: "SLACK_OPENMELD_TOKEN_CRYPTO_KEY is not configured",
      event: CORE_LOG_EVENTS.coreInternalError,
      slackTeamId: input.slackTeamId,
      slackUserId: input.slackUserId,
    });
    return null;
  }
  try {
    return {
      encryptedAuthorization: await encryptSlackSearchAuthorization({
        actionToken,
        cryptoKey,
        memberId: input.memberId,
        organizationId: input.organizationId,
        slackTeamId: input.slackTeamId,
        slackUserId: input.slackUserId,
        sourceChannelId: input.sourceChannelId,
        sourceThreadTs: input.sourceThreadTs,
        openMeldUserId: input.openMeldUserId,
      }),
    };
  } catch (error) {
    console.warn("[core.remote_agent.slack_search.authorization_unavailable]", {
      error: toErrorMessage(error),
      event: CORE_LOG_EVENTS.coreInternalError,
      slackTeamId: input.slackTeamId,
      slackUserId: input.slackUserId,
    });
    return null;
  }
}

async function resolveSlackConversationInfo(input: {
  botToken: string;
  channelId: string;
  slackTeamId: string;
}): Promise<Awaited<ReturnType<typeof readSlackConversationInfo>>> {
  const abortController = new AbortController();
  const timeoutId = setTimeout(
    () => abortController.abort(),
    SLACK_CONVERSATION_INFO_LOOKUP_TIMEOUT_MS
  );
  try {
    return await readSlackConversationInfo({
      botToken: input.botToken,
      channelId: input.channelId,
      signal: abortController.signal,
    });
  } catch (error) {
    console.warn("[core.remote_agent.slack_conversation_info.unavailable]", {
      channelId: input.channelId,
      error: toErrorMessage(error),
      event: CORE_LOG_EVENTS.coreInternalError,
      slackTeamId: input.slackTeamId,
    });
    return {
      channelName: null,
      interactionEnvironment: "externally_shared",
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildSlackDispatchId(input: {
  channelId: string;
  eventId?: string | null;
  teamId: string;
  ts: string;
}): string {
  return `remote-agent-slack:${input.eventId ?? `${input.teamId}:${input.channelId}:${input.ts}`}`;
}

function buildSlackIdempotencyKey(input: {
  channelId: string;
  eventId?: string | null;
  teamId: string;
  ts: string;
}): string {
  return `remote-agent-slack:${input.teamId}:${input.eventId ?? `${input.channelId}:${input.ts}`}`;
}

function normalizeSlackMentionText(value: string): string {
  const normalized = normalizeOptionalText(value);
  return normalized ?? "Help me with this Slack thread.";
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
