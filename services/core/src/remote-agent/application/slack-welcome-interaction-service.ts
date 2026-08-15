import {
  ensureOrganizationJoinLinkOnBehalfOfRpcResponseSchema,
  slackWelcomeInteractionRpcInputSchema,
  slackWelcomeInteractionRpcResponseSchema,
} from "@openmeld/schemas";
import type {
  SlackWelcomeInteractionRpcInput,
  SlackWelcomeInteractionRpcResponse,
} from "@openmeld/schemas/types";
import type { CoreBindings } from "../../lib/bindings";
import { localStateDb } from "../../lib/bindings";
import { readOrganizationAccountIdentityProjection } from "../../organizations/organization-context";
import {
  buildOrganizationJoinLinkUrl,
  readActiveOrganizationJoinLink,
} from "../../organizations/organization-join-link-read-service";
import { createCoreRpcHttpError } from "../../rpc/errors";
import { callRequiredAuthWorkerRpc } from "../../rpc/required-auth-worker-rpc";
import {
  claimSlackTeammateInvitationDelivery,
  completeSlackTeammateInvitationDelivery,
} from "../infrastructure/d1/slack-teammate-invitation-delivery-repo";
import { readSlackUserIdentityLink } from "../infrastructure/d1/slack-user-identity-link-repo";
import { readRemoteAgentSlackWorkspaceBinding } from "../infrastructure/d1/slack-workspace-binding-repo";
import { resolveSlackBotToken } from "./slack-bot-token";
import {
  listSlackWorkspaceMembers,
  openSlackModal,
  postSlackDirectMessage,
  SlackMessagePublicationError,
  type SlackWorkspaceMember,
} from "./slack-client";
import { submitRemoteAgentSlackChannelIntroduction } from "./slack-signal-service";

const INVITE_MODAL_CALLBACK_ID = "openmeld_invite_teammates";
const CHANNEL_INTRODUCTION_MODAL_CALLBACK_ID = "openmeld_introduce_in_channels";
const WHITESPACE_PATTERN = /\s+/u;

export async function handleSlackWelcomeInteraction(
  env: CoreBindings,
  rawInput: SlackWelcomeInteractionRpcInput
): Promise<SlackWelcomeInteractionRpcResponse> {
  const input = slackWelcomeInteractionRpcInputSchema.parse(rawInput);
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
  return slackWelcomeInteractionRpcResponseSchema.parse({ handled: true });
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
  const members = await listAllSlackWorkspaceMembers({
    botToken: input.botToken,
  });
  const memberById = new Map(
    members.map((member) => [member.slackUserId, member] as const)
  );
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

  const delivered: string[] = [];
  const failed: string[] = [];
  const uncertain: string[] = [];
  let claimedCount = 0;
  for (const target of targets) {
    const claim = await claimSlackTeammateInvitationDelivery({
      actorSlackUserId: input.input.slackUserId,
      actorUserId: input.actorUserId,
      db: input.db,
      interactionId: input.input.interactionId,
      nowMs: Date.now(),
      organizationId: input.organizationId,
      slackTeamId: input.input.slackTeamId,
      targetDisplayName: target.displayName,
      targetEmail: target.email,
      targetSlackUserId: target.slackUserId,
    });
    if (!claim) {
      continue;
    }
    claimedCount += 1;
    try {
      const message = buildPrivateTeammateInvitationMessage({
        inviterName,
        organizationName: invitation.organizationName,
        targetDisplayName: target.displayName,
      });
      const publication = await postSlackDirectMessage({
        blocks: buildPrivateTeammateInvitationBlocks({
          inviteUrl: invitation.url,
          message,
        }),
        botToken: input.botToken,
        recipientUserId: target.slackUserId,
        text: message,
      });
      await completeSlackTeammateInvitationDelivery({
        claim,
        db: input.db,
        failureCode: null,
        messageTs: publication.id,
        nowMs: Date.now(),
        status: "delivered",
      });
      delivered.push(target.displayName);
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
      (outcomeUnknown ? uncertain : failed).push(target.displayName);
    }
  }
  if (claimedCount === 0) {
    return;
  }
  await postSlackDirectMessage({
    botToken: input.botToken,
    recipientUserId: input.input.slackUserId,
    text: buildInvitationSummary({ delivered, failed, uncertain }),
  });
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

async function listAllSlackWorkspaceMembers(input: {
  botToken: string;
}): Promise<SlackWorkspaceMember[]> {
  const members: SlackWorkspaceMember[] = [];
  let cursor: string | undefined;
  do {
    const page = await listSlackWorkspaceMembers({
      botToken: input.botToken,
      ...(cursor ? { cursor } : {}),
    });
    members.push(...page.members);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return members;
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
  delivered: readonly string[];
  failed: readonly string[];
  uncertain: readonly string[];
}): string {
  if (
    input.delivered.length > 0 &&
    input.failed.length === 0 &&
    input.uncertain.length === 0
  ) {
    return `Done — I sent private invites to ${formatNameList(input.delivered)}. I’ll be here when they join.`;
  }
  if (input.uncertain.length > 0) {
    const deliveredNote = input.delivered.length
      ? `I sent private invites to ${formatNameList(input.delivered)}. `
      : "";
    const failedNote = input.failed.length
      ? `I couldn’t reach ${formatNameList(input.failed)}. `
      : "";
    return `${deliveredNote}${failedNote}Slack didn’t confirm whether ${formatNameList(input.uncertain)} received the message, so I won’t guess or send a duplicate.`;
  }
  if (input.delivered.length === 0) {
    return "I couldn’t send those invites. No one received a duplicate. Try again, or tell me who you want to invite here.";
  }
  return `I sent private invites to ${formatNameList(input.delivered)}. I couldn’t reach ${formatNameList(input.failed)}, so I didn’t claim they were invited.`;
}

function formatNameList(names: readonly string[]): string {
  return new Intl.ListFormat("en", {
    style: "long",
    type: "conjunction",
  }).format([...names]);
}
