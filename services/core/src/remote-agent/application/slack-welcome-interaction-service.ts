import {
  centerAgentInviteSlackTeammatesRpcInputSchema,
  centerAgentInviteSlackTeammatesRpcResponseSchema,
  ensureOrganizationJoinLinkOnBehalfOfRpcResponseSchema,
  slackWelcomeInteractionRpcInputSchema,
  slackWelcomeInteractionRpcResponseSchema,
} from "@openmeld/schemas";
import type {
  CenterAgentInviteSlackTeammatesRpcInput,
  CenterAgentInviteSlackTeammatesRpcResponse,
  SlackWelcomeInteractionRpcInput,
  SlackWelcomeInteractionRpcResponse,
} from "@openmeld/schemas/types";
import { prepareCenterAgentRepresentedMemberRequest } from "../../center-agent/application/represented-member-request";
import type { CoreBindings } from "../../lib/bindings";
import { localStateDb, wakeEvidenceDb } from "../../lib/bindings";
import { readOrganizationAccountIdentityProjection } from "../../organizations/organization-context";
import { resolveOrganizationDirectoryMembers } from "../../organizations/organization-directory";
import {
  buildOrganizationJoinLinkUrl,
  readActiveOrganizationJoinLink,
} from "../../organizations/organization-join-link-read-service";
import { createCoreRpcHttpError } from "../../rpc/errors";
import { callRequiredAuthWorkerRpc } from "../../rpc/required-auth-worker-rpc";
import { readRemoteAgentNativeDeliveryByDeliveryId } from "../infrastructure/d1/native-delivery-ledger-repo";
import {
  claimSlackTeammateInvitationDelivery,
  completeSlackTeammateInvitationDelivery,
} from "../infrastructure/d1/slack-teammate-invitation-delivery-repo";
import { readSlackUserIdentityLink } from "../infrastructure/d1/slack-user-identity-link-repo";
import { readRemoteAgentSlackWorkspaceBinding } from "../infrastructure/d1/slack-workspace-binding-repo";
import { persistConfirmedPublicationCheckpoint } from "./confirmed-publication-checkpoint";
import { resolveSlackBotToken } from "./slack-bot-token";
import {
  listSlackWorkspaceMembers,
  openSlackModal,
  postSlackDirectMessage,
  SlackMessagePublicationError,
  type SlackWorkspaceMember,
} from "./slack-client";
import {
  buildSlackTeammateInvitationDeliveryId,
  SLACK_TEAMMATE_INVITATION_METADATA,
} from "./slack-onboarding-publication-identity";
import { submitRemoteAgentSlackChannelIntroduction } from "./slack-signal-service";

const INVITE_MODAL_CALLBACK_ID = "openmeld_invite_teammates";
const CHANNEL_INTRODUCTION_MODAL_CALLBACK_ID = "openmeld_introduce_in_channels";
const WHITESPACE_PATTERN = /\s+/u;
const RPC_ERROR_CODE_PATTERN = /"code"\s*:\s*"([^"]+)"/u;

export async function handleCenterAgentSlackTeammateInvitations(
  env: CoreBindings,
  rawInput: CenterAgentInviteSlackTeammatesRpcInput
): Promise<CenterAgentInviteSlackTeammatesRpcResponse> {
  const input = centerAgentInviteSlackTeammatesRpcInputSchema.parse(rawInput);
  const represented = await prepareCenterAgentRepresentedMemberRequest(
    env,
    input.context,
    input.speakerMember,
    {
      code: "center_agent.slack_invitation_member_required",
      reason:
        "Inviting Slack teammates requires a verified active human Organization member.",
    }
  );
  const sourceNativeDeliveryId = represented.sourceNativeDeliveryId;
  const deliveryDb = wakeEvidenceDb(env);
  const delivery =
    sourceNativeDeliveryId && deliveryDb
      ? await readRemoteAgentNativeDeliveryByDeliveryId({
          db: deliveryDb,
          deliveryId: sourceNativeDeliveryId,
        })
      : null;
  requireRemoteAgentSlackTeammateInvitationDeliveryEvidence({
    delivery,
    representedHuman: represented.representedHuman,
    slackTeamId: input.slackTeamId,
    slackUserId: input.slackUserId,
    sourceNativeDeliveryId,
  });

  const interaction = slackWelcomeInteractionRpcInputSchema.parse({
    action: "submit_teammate_invites",
    interactionId: input.interactionId,
    slackTeamId: input.slackTeamId,
    slackUserId: input.slackUserId,
    targetSlackUserIds: input.targetSlackUserIds,
  });
  if (interaction.action !== "submit_teammate_invites") {
    throw new Error("Unexpected Slack teammate invitation action");
  }
  const context = await resolveVerifiedSlackActor({ env, input: interaction });
  if (context.actorUserId !== represented.representedHuman.userId) {
    throw createCoreRpcHttpError({
      code: "center_agent.slack_invitation_actor_mismatch",
      reason:
        "The active private Slack requester no longer matches this invitation request.",
      status: 403,
    });
  }
  await sendSelectedTeammateInvitations({
    ...context,
    env,
    input: interaction,
  });
  return centerAgentInviteSlackTeammatesRpcResponseSchema.parse({
    handled: true,
  });
}

type SlackTeammateInvitationDeliveryEvidence = {
  conversationKind: string;
  deliveryId: string;
  slackChannelId: string | null;
  slackTeamId: string | null;
  workerSubmitRequest: {
    turnEnvelope: {
      contextScopePlan?: { interactionEnvironment?: string } | null;
      interactionEnvironment?: string;
      sender: {
        kind: string;
        messageChannelIdentity?: {
          connectionId: string;
          provider: string;
          providerUserId: string;
        };
        ownerUserId?: string;
        profileId?: string;
        verified?: boolean;
      };
      trigger: { source: string; teamId?: string };
    };
  } | null;
};

export function requireRemoteAgentSlackTeammateInvitationDeliveryEvidence(input: {
  delivery: SlackTeammateInvitationDeliveryEvidence | null;
  representedHuman: { profileId: string; userId: string };
  slackTeamId: string;
  slackUserId: string;
  sourceNativeDeliveryId: string | null;
}): void {
  const delivery = input.delivery;
  const envelope = delivery?.workerSubmitRequest?.turnEnvelope;
  const sender = envelope?.sender;
  const messageChannelIdentity = sender?.messageChannelIdentity;
  const interactionEnvironment =
    envelope?.interactionEnvironment ??
    envelope?.contextScopePlan?.interactionEnvironment;
  if (
    !(
      input.sourceNativeDeliveryId &&
      delivery?.deliveryId === input.sourceNativeDeliveryId &&
      delivery.conversationKind === "slack" &&
      delivery.slackTeamId === input.slackTeamId &&
      delivery.slackChannelId?.startsWith("D") &&
      envelope?.trigger.source === "slack" &&
      envelope.trigger.teamId === input.slackTeamId &&
      interactionEnvironment === "requester_private" &&
      sender?.kind === "member" &&
      sender.verified === true &&
      sender.ownerUserId === input.representedHuman.userId &&
      sender.profileId === input.representedHuman.profileId &&
      messageChannelIdentity?.provider === "slack" &&
      messageChannelIdentity.connectionId === input.slackTeamId &&
      messageChannelIdentity.providerUserId === input.slackUserId
    )
  ) {
    throw createCoreRpcHttpError({
      code: "center_agent.slack_invitation_private_delivery_required",
      reason:
        "Slack teammate invitations require the active private Slack delivery for this verified requester.",
      status: 403,
    });
  }
}

export async function handleSlackWelcomeInteraction(
  env: CoreBindings,
  rawInput: SlackWelcomeInteractionRpcInput
): Promise<SlackWelcomeInteractionRpcResponse> {
  const input = slackWelcomeInteractionRpcInputSchema.parse(rawInput);
  try {
    await handleVerifiedSlackWelcomeInteraction(env, input);
  } catch (error) {
    await notifySlackWelcomeInteractionFailure({ env, error, input });
  }
  return slackWelcomeInteractionRpcResponseSchema.parse({ handled: true });
}

async function handleVerifiedSlackWelcomeInteraction(
  env: CoreBindings,
  input: SlackWelcomeInteractionRpcInput
): Promise<void> {
  const context = await resolveVerifiedSlackActor({ env, input });
  if (input.action === "open_teammate_invite_modal") {
    await openSlackModal({
      botToken: context.botToken,
      triggerId: input.triggerId,
      view: buildTeammateInviteModal(),
    });
  } else if (input.action === "open_channel_introduction_modal") {
    await openSlackModal({
      botToken: context.botToken,
      triggerId: input.triggerId,
      view: buildChannelIntroductionModal(),
    });
  } else if (input.action === "submit_channel_introductions") {
    const organizationInviteUrl = await resolveOptionalOrganizationInviteUrl({
      actorUserId: context.actorUserId,
      db: context.db,
      env,
      organizationId: context.organizationId,
    });
    await submitRemoteAgentSlackChannelIntroduction({
      env,
      interactionId: input.interactionId,
      organizationInviteUrl,
      slackTeamId: input.slackTeamId,
      slackUserId: input.slackUserId,
      targetSlackChannelIds: input.targetSlackChannelIds,
    });
  } else {
    await sendSelectedTeammateInvitations({
      ...context,
      env,
      input,
    });
  }
}

async function notifySlackWelcomeInteractionFailure(input: {
  env: CoreBindings;
  error: unknown;
  input: SlackWelcomeInteractionRpcInput;
}): Promise<void> {
  try {
    const db = localStateDb(input.env);
    if (!db) {
      throw new Error("Slack connection state is unavailable.");
    }
    const botToken = await resolveSlackBotToken({
      cryptoKey: input.env.SLACK_OPENMELD_TOKEN_CRYPTO_KEY,
      db,
      fallbackBotToken: input.env.SLACK_OPENMELD_BOT_TOKEN,
      slackTeamId: input.input.slackTeamId,
    });
    await postSlackDirectMessage({
      botToken,
      recipientUserId: input.input.slackUserId,
      text: buildSlackWelcomeInteractionFailureMessage(input.error),
    });
    console.warn("[core.slack_welcome_interaction.failed_with_notice]", {
      action: input.input.action,
      error:
        input.error instanceof Error
          ? input.error.message
          : String(input.error),
      slackTeamId: input.input.slackTeamId,
      slackUserId: input.input.slackUserId,
    });
  } catch (notificationError) {
    console.warn("[core.slack_welcome_interaction.failure_notice_failed]", {
      action: input.input.action,
      error:
        input.error instanceof Error
          ? input.error.message
          : String(input.error),
      notificationError:
        notificationError instanceof Error
          ? notificationError.message
          : String(notificationError),
      slackTeamId: input.input.slackTeamId,
      slackUserId: input.input.slackUserId,
    });
    throw input.error;
  }
}

function buildSlackWelcomeInteractionFailureMessage(error: unknown): string {
  if (
    readSlackWelcomeInteractionErrorCode(error) ===
    "organization.membership_required"
  ) {
    return "Center Agent couldn’t finish that action because you’re no longer a member of this OpenMeld Organization. Ask an Organization owner or admin to add you again, then come back here.";
  }
  if (
    readSlackWelcomeInteractionErrorCode(error) ===
    "organization.directory_unavailable"
  ) {
    return "Center Agent couldn’t check who is already in this Organization, so no invitations were sent. In a moment, open Invite teammates and choose them again.";
  }
  return "Center Agent couldn’t finish that action. Try once more. If it still doesn’t work, reconnect Slack in OpenMeld, then come back here.";
}

function readSlackWelcomeInteractionErrorCode(error: unknown): string | null {
  const visited = new Set<unknown>();
  let current = error;
  for (let depth = 0; depth < 4 && current !== null; depth += 1) {
    if (visited.has(current)) {
      return null;
    }
    visited.add(current);
    if (typeof current !== "object") {
      return readSlackWelcomeInteractionErrorCodeFromMessage(current);
    }
    const record = current as Record<string, unknown>;
    if (typeof record.code === "string" && record.code.trim()) {
      return record.code.trim();
    }
    const messageCode = readSlackWelcomeInteractionErrorCodeFromMessage(
      record.message
    );
    if (messageCode) {
      return messageCode;
    }
    current = record.cause ?? null;
  }
  return null;
}

function readSlackWelcomeInteractionErrorCodeFromMessage(
  value: unknown
): string | null {
  if (typeof value !== "string") {
    return null;
  }
  return RPC_ERROR_CODE_PATTERN.exec(value)?.[1] ?? null;
}

function buildChannelIntroductionModal(): Record<string, unknown> {
  return {
    callback_id: CHANNEL_INTRODUCTION_MODAL_CALLBACK_ID,
    close: { text: "Not now", type: "plain_text" },
    blocks: [
      {
        block_id: "channels",
        element: {
          action_id: "selected_channels",
          max_selected_items: 5,
          placeholder: { text: "Choose channels", type: "plain_text" },
          type: "multi_channels_select",
        },
        label: { text: "Where should I introduce myself?", type: "plain_text" },
        type: "input",
      },
      {
        text: {
          text: "I’ll join each public channel, learn how the team works there, and write an introduction with specific ways I can help. If you can invite members, I’ll include your OpenMeld invite link too.",
          type: "mrkdwn",
        },
        type: "section",
      },
    ],
    submit: { text: "Start", type: "plain_text" },
    title: { text: "Meet the team", type: "plain_text" },
    type: "modal",
  };
}

async function resolveOptionalOrganizationInviteUrl(input: {
  actorUserId: string;
  db: D1Database;
  env: CoreBindings;
  organizationId: string;
}): Promise<string | null> {
  const invitation = await resolveOrganizationInvitation(input);
  return invitation?.url ?? null;
}

async function resolveOrganizationInvitation(input: {
  actorUserId: string;
  db: D1Database;
  env: CoreBindings;
  organizationId: string;
}): Promise<{ organizationName: string; url: string } | null> {
  const activeLink = await readActiveOrganizationJoinLink({
    db: input.db,
    organizationId: input.organizationId,
  });
  if (activeLink) {
    const webAppUrl = input.env.WEB_APP_URL?.trim();
    if (!webAppUrl) {
      throw new Error(
        "Core WEB_APP_URL is required to build an Organization invite link."
      );
    }
    return {
      organizationName: activeLink.organizationName,
      url: buildOrganizationJoinLinkUrl({
        token: activeLink.token,
        webAppUrl,
      }),
    };
  }
  const result = ensureOrganizationJoinLinkOnBehalfOfRpcResponseSchema.parse(
    await callRequiredAuthWorkerRpc({
      authWorker: input.env.OPENMELD_AUTH_WORKER,
      call: async (authWorker) =>
        await authWorker.ensureOrganizationJoinLinkOnBehalfOf({
          actorUserId: input.actorUserId,
          organizationId: input.organizationId,
        }),
      unavailable: {
        code: "organization.join_link.ensure_unavailable",
        reason: "Organization invitation is unavailable.",
      },
    })
  );
  if (result.ok) {
    return {
      organizationName: result.organizationName,
      url: result.joinLink.url,
    };
  }
  if (result.code === "organization.join_link.forbidden") {
    return null;
  }
  throw new Error(result.message);
}

async function resolveVerifiedSlackActor(input: {
  env: CoreBindings;
  input: SlackWelcomeInteractionRpcInput;
}): Promise<{
  actorUserId: string;
  botToken: string;
  db: D1Database;
  organizationId: string;
}> {
  const db = localStateDb(input.env);
  if (!db) {
    throw new Error("Slack connection state is unavailable.");
  }
  const binding = await readRemoteAgentSlackWorkspaceBinding({
    db,
    slackTeamId: input.input.slackTeamId,
  });
  if (!binding) {
    throw new Error("This Slack workspace is not connected to OpenMeld.");
  }
  const identity = await readSlackUserIdentityLink({
    db,
    slackTeamId: input.input.slackTeamId,
    slackUserId: input.input.slackUserId,
  });
  if (!identity || identity.organizationId !== binding.organizationId) {
    throw new Error(
      "Link your Slack account to OpenMeld before inviting teammates."
    );
  }
  const membership = await readOrganizationAccountIdentityProjection({
    account: { kind: "user_id", userId: identity.openmeldUserId },
    authWorker: input.env.OPENMELD_AUTH_WORKER,
    organizationId: binding.organizationId,
  });
  if (!membership?.ok) {
    throw createCoreRpcHttpError({
      code: "organization.membership_verification_unavailable",
      reason:
        "OpenMeld couldn’t verify your Organization membership. Try again. If it still doesn’t work, reconnect Slack in OpenMeld.",
      status: 503,
    });
  }
  if (!membership.account?.membership) {
    throw createCoreRpcHttpError({
      code: "organization.membership_required",
      reason:
        "You are no longer a member of this OpenMeld Organization, so this invitation action is no longer available. Ask an Organization owner or admin to add you again.",
      status: 403,
    });
  }
  return {
    actorUserId: identity.openmeldUserId,
    botToken: await resolveSlackBotToken({
      cryptoKey: input.env.SLACK_OPENMELD_TOKEN_CRYPTO_KEY,
      db,
      fallbackBotToken: input.env.SLACK_OPENMELD_BOT_TOKEN,
      slackTeamId: input.input.slackTeamId,
    }),
    db,
    organizationId: binding.organizationId,
  };
}

async function sendSelectedTeammateInvitations(input: {
  actorUserId: string;
  botToken: string;
  db: D1Database;
  env: CoreBindings;
  input: Extract<
    SlackWelcomeInteractionRpcInput,
    { action: "submit_teammate_invites" }
  >;
  organizationId: string;
}): Promise<void> {
  const invitation = await resolveOrganizationInvitation({
    actorUserId: input.actorUserId,
    db: input.db,
    env: input.env,
    organizationId: input.organizationId,
  });
  if (!invitation) {
    await postSlackDirectMessage({
      botToken: input.botToken,
      recipientUserId: input.input.slackUserId,
      text: "This Organization doesn’t have an invite link yet. Ask an owner or admin to create one in OpenMeld, then open Invite teammates here again.",
    });
    return;
  }
  const memberById = await listSlackWorkspaceMembersUntilTargetsResolved({
    botToken: input.botToken,
    targetSlackUserIds: new Set([
      ...input.input.targetSlackUserIds,
      input.input.slackUserId,
    ]),
  });
  const inviterName =
    memberById.get(input.input.slackUserId)?.displayName ?? "A teammate";
  const targets = input.input.targetSlackUserIds.flatMap((slackUserId) => {
    const member = memberById.get(slackUserId);
    return member && slackUserId !== input.input.slackUserId ? [member] : [];
  });
  if (targets.length === 0) {
    await postSlackDirectMessage({
      botToken: input.botToken,
      recipientUserId: input.input.slackUserId,
      text: "I couldn’t find an active teammate in that selection. Try opening Invite teammates again.",
    });
    return;
  }
  const organizationMembers = await resolveOrganizationDirectoryMembers({
    authWorker: input.env.OPENMELD_AUTH_WORKER,
    organizationId: input.organizationId,
    requestId: `slack-teammate-invite:${input.input.interactionId}`,
  });
  const organizationMemberEmails = new Set(
    organizationMembers.map((member) => normalizeEmail(member.user.email))
  );

  const alreadyMembers: string[] = [];
  const delivered: string[] = [];
  const failed: string[] = [];
  const needsManualInvite: string[] = [];
  const uncertain: string[] = [];
  let claimedCount = 0;
  for (const target of targets) {
    if (!target.email?.trim()) {
      needsManualInvite.push(target.displayName);
      continue;
    }
    if (organizationMemberEmails.has(normalizeEmail(target.email))) {
      alreadyMembers.push(target.displayName);
      continue;
    }
    const outcome = await deliverPrivateTeammateInvitation({
      actorSlackUserId: input.input.slackUserId,
      actorUserId: input.actorUserId,
      botToken: input.botToken,
      db: input.db,
      interactionId: input.input.interactionId,
      invitation,
      inviterName,
      organizationId: input.organizationId,
      slackTeamId: input.input.slackTeamId,
      targetEmail: target.email,
      target,
    });
    if (outcome === "already_claimed") {
      continue;
    }
    claimedCount += 1;
    if (outcome === "delivered") {
      delivered.push(target.displayName);
    } else if (outcome === "outcome_unknown") {
      uncertain.push(target.displayName);
    } else {
      failed.push(target.displayName);
    }
  }
  if (
    claimedCount === 0 &&
    needsManualInvite.length === 0 &&
    alreadyMembers.length === 0
  ) {
    return;
  }
  await postSlackDirectMessage({
    botToken: input.botToken,
    recipientUserId: input.input.slackUserId,
    text: buildInvitationSummary({
      alreadyMembers,
      delivered,
      failed,
      inviteUrl: invitation.url,
      needsManualInvite,
      organizationName: invitation.organizationName,
      uncertain,
    }),
  });
}

async function deliverPrivateTeammateInvitation(input: {
  actorSlackUserId: string;
  actorUserId: string;
  botToken: string;
  db: D1Database;
  interactionId: string;
  invitation: { organizationName: string; url: string };
  inviterName: string;
  organizationId: string;
  slackTeamId: string;
  target: SlackWorkspaceMember;
  targetEmail: string;
}): Promise<"already_claimed" | "delivered" | "failed" | "outcome_unknown"> {
  const claim = await claimSlackTeammateInvitationDelivery({
    actorSlackUserId: input.actorSlackUserId,
    actorUserId: input.actorUserId,
    db: input.db,
    interactionId: input.interactionId,
    nowMs: Date.now(),
    organizationId: input.organizationId,
    slackTeamId: input.slackTeamId,
    targetDisplayName: input.target.displayName,
    targetEmail: input.targetEmail,
    targetSlackUserId: input.target.slackUserId,
  });
  if (!claim) {
    return "already_claimed";
  }
  let publication: { id: string };
  try {
    const message = buildPrivateTeammateInvitationMessage({
      inviterName: input.inviterName,
      organizationName: input.invitation.organizationName,
      targetDisplayName: input.target.displayName,
    });
    const deliveryId = buildSlackTeammateInvitationDeliveryId({
      interactionId: input.interactionId,
      targetSlackUserId: input.target.slackUserId,
    });
    publication = await postSlackDirectMessage({
      blocks: buildPrivateTeammateInvitationBlocks({
        inviteUrl: input.invitation.url,
        message,
      }),
      botToken: input.botToken,
      metadata: {
        eventPayload: {
          [SLACK_TEAMMATE_INVITATION_METADATA.eventPayloadKey]: deliveryId,
        },
        eventType: SLACK_TEAMMATE_INVITATION_METADATA.eventType,
      },
      recipientUserId: input.target.slackUserId,
      text: message,
    });
  } catch (error) {
    const outcomeUnknown =
      error instanceof SlackMessagePublicationError &&
      error.publicationOutcome === "unknown";
    await completeSlackTeammateInvitationDelivery({
      claim,
      db: input.db,
      failureCode:
        error instanceof SlackMessagePublicationError
          ? (error.errorCode ?? "slack_not_published")
          : "invitation_failed",
      messageTs: null,
      nowMs: Date.now(),
      status: outcomeUnknown ? "outcome_unknown" : "failed",
    });
    return outcomeUnknown ? "outcome_unknown" : "failed";
  }
  const checkpoint = await persistConfirmedPublicationCheckpoint(async () => {
    await completeSlackTeammateInvitationDelivery({
      claim,
      db: input.db,
      failureCode: null,
      messageTs: publication.id,
      nowMs: Date.now(),
      status: "delivered",
    });
  });
  if (!checkpoint.persisted) {
    console.warn("[core.slack_teammate_invitation.checkpoint_pending]", {
      error:
        checkpoint.error instanceof Error
          ? checkpoint.error.message
          : String(checkpoint.error),
      interactionId: input.interactionId,
      slackTeamId: input.slackTeamId,
      targetSlackUserId: input.target.slackUserId,
    });
  }
  return "delivered";
}

function buildTeammateInviteModal(): Record<string, unknown> {
  return {
    callback_id: INVITE_MODAL_CALLBACK_ID,
    close: { text: "Cancel", type: "plain_text" },
    blocks: [
      {
        block_id: "teammates",
        element: {
          action_id: "selected_teammates",
          max_selected_items: 10,
          placeholder: { text: "Choose teammates", type: "plain_text" },
          type: "multi_users_select",
        },
        label: { text: "Who should I invite?", type: "plain_text" },
        type: "input",
      },
      {
        text: {
          text: "I’ll send each person a private note with your Organization’s invite link. Nothing will be posted in a channel.",
          type: "mrkdwn",
        },
        type: "section",
      },
    ],
    submit: { text: "Send invites", type: "plain_text" },
    title: { text: "Invite teammates", type: "plain_text" },
    type: "modal",
  };
}

async function listSlackWorkspaceMembersUntilTargetsResolved(input: {
  botToken: string;
  targetSlackUserIds: ReadonlySet<string>;
}): Promise<Map<string, SlackWorkspaceMember>> {
  const memberById = new Map<string, SlackWorkspaceMember>();
  const unresolvedTargetSlackUserIds = new Set(input.targetSlackUserIds);
  if (unresolvedTargetSlackUserIds.size === 0) {
    return memberById;
  }
  let cursor: string | undefined;
  do {
    const page = await listSlackWorkspaceMembers({
      botToken: input.botToken,
      ...(cursor ? { cursor } : {}),
    });
    for (const member of page.members) {
      memberById.set(member.slackUserId, member);
      unresolvedTargetSlackUserIds.delete(member.slackUserId);
    }
    if (unresolvedTargetSlackUserIds.size === 0) {
      return memberById;
    }
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return memberById;
}

export function buildPrivateTeammateInvitationMessage(input: {
  inviterName: string;
  organizationName: string;
  targetDisplayName: string;
}): string {
  const firstName =
    input.targetDisplayName.trim().split(WHITESPACE_PATTERN)[0] ?? "there";
  return `Hi ${firstName} — I’m the Center Agent for *${input.organizationName}* in OpenMeld. ${input.inviterName} asked me to invite you.

OpenMeld is a place where people and agents work as one team. I help keep useful context together and move work to the right person or agent.

Once you join, I’ll start getting to know your role and current work from the context your team has connected. I’ll make a first Profile Report and show you what I found. You can talk to me right here anytime.`;
}

function buildPrivateTeammateInvitationBlocks(input: {
  inviteUrl: string;
  message: string;
}): readonly Record<string, unknown>[] {
  return [
    { text: { text: input.message, type: "mrkdwn" }, type: "section" },
    {
      elements: [
        {
          accessibility_label: "Join this OpenMeld Organization",
          action_id: "join_openmeld_organization",
          style: "primary",
          text: { text: "Join the team", type: "plain_text" },
          type: "button",
          url: input.inviteUrl,
        },
      ],
      type: "actions",
    },
  ];
}

function buildInvitationSummary(input: {
  alreadyMembers: readonly string[];
  delivered: readonly string[];
  failed: readonly string[];
  inviteUrl: string;
  needsManualInvite: readonly string[];
  organizationName: string;
  uncertain: readonly string[];
}): string {
  const alreadyMemberNote = buildAlreadyMemberInvitationNote(input);
  const manualInviteNote = buildManualInvitationNote(input);
  if (isFullyDeliveredInvitationSummary(input)) {
    return `Done — I sent private invites to ${formatNameList(input.delivered)}. I’ll be here when they join.`;
  }
  if (input.uncertain.length > 0) {
    const deliveredNote = input.delivered.length
      ? `I sent private invites to ${formatNameList(input.delivered)}. `
      : "";
    const failedNote = input.failed.length
      ? `I couldn’t reach ${formatNameList(input.failed)}. `
      : "";
    return `${deliveredNote}${failedNote}Slack didn’t confirm whether ${formatNameList(input.uncertain)} received the message, so I won’t guess or send a duplicate.${alreadyMemberNote ? ` ${alreadyMemberNote}` : ""}${manualInviteNote ? ` ${manualInviteNote}` : ""}`;
  }
  if (
    input.delivered.length === 0 &&
    input.failed.length === 0 &&
    (alreadyMemberNote || manualInviteNote)
  ) {
    return [alreadyMemberNote, manualInviteNote].filter(Boolean).join(" ");
  }
  if (
    input.delivered.length === 0 &&
    !(alreadyMemberNote || manualInviteNote)
  ) {
    return "I couldn’t send those invites. No one received a duplicate. Try again, or tell me who you want to invite here.";
  }
  const deliveredNote = input.delivered.length
    ? `I sent private invites to ${formatNameList(input.delivered)}. `
    : "";
  const failedNote = input.failed.length
    ? `I couldn’t reach ${formatNameList(input.failed)}, so I didn’t claim they were invited.`
    : "";
  return [
    `${deliveredNote}${failedNote}`.trim(),
    alreadyMemberNote,
    manualInviteNote,
  ]
    .filter(Boolean)
    .join(" ");
}

function buildAlreadyMemberInvitationNote(input: {
  alreadyMembers: readonly string[];
  organizationName: string;
}): string {
  if (input.alreadyMembers.length === 0) {
    return "";
  }
  const verb = input.alreadyMembers.length === 1 ? "is" : "are";
  return `${formatNameList(input.alreadyMembers)} ${verb} already in ${input.organizationName}, so I didn’t send another invite.`;
}

function buildManualInvitationNote(input: {
  inviteUrl: string;
  needsManualInvite: readonly string[];
}): string {
  if (input.needsManualInvite.length === 0) {
    return "";
  }
  return `Slack didn’t share an email for ${formatNameList(input.needsManualInvite)}, so I didn’t send a private invite that could connect to the wrong OpenMeld account. Send them this invite link instead: ${input.inviteUrl}. After they join, they can message Center Agent here.`;
}

function isFullyDeliveredInvitationSummary(input: {
  alreadyMembers: readonly string[];
  delivered: readonly string[];
  failed: readonly string[];
  needsManualInvite: readonly string[];
  uncertain: readonly string[];
}): boolean {
  return (
    input.delivered.length > 0 &&
    input.failed.length === 0 &&
    input.uncertain.length === 0 &&
    input.needsManualInvite.length === 0 &&
    input.alreadyMembers.length === 0
  );
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function formatNameList(names: readonly string[]): string {
  return new Intl.ListFormat("en", {
    style: "long",
    type: "conjunction",
  }).format([...names]);
}
