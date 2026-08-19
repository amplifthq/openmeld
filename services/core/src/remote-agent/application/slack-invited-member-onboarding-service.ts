import type { CoreBindings } from "../../lib/bindings";
import { resolveOrganizationDirectoryMembers } from "../../organizations/organization-directory";
import {
  claimSlackInvitedMemberWelcomeDelivery,
  completeSlackInvitedMemberWelcomeDelivery,
  readSlackInvitedMemberWelcomeDelivery,
  type SlackInvitedMemberWelcomeDelivery,
  type SlackInvitedMemberWelcomeDeliveryKey,
} from "../infrastructure/d1/slack-invited-member-welcome-delivery-repo";
import {
  attachSlackInvitedMemberResearchTask,
  claimJoinedSlackInvitedMembers,
  completeSlackInvitedMemberOnboarding,
  completeSlackTeammateInvitationDelivery,
  failSlackInvitedMemberOnboarding,
  listActiveSlackInvitedMemberOnboardings,
  listPendingSlackTeammateInvitationDeliveries,
  type SlackInvitedMemberOnboarding,
} from "../infrastructure/d1/slack-teammate-invitation-delivery-repo";
import { resolveSlackBotToken } from "./slack-bot-token";
import {
  findSlackTopLevelMessageByMetadata,
  openSlackDirectMessage,
  postSlackDirectMessage,
  SlackMessagePublicationError,
} from "./slack-client";
import { readFirstProfileObservation } from "./slack-installation-welcome-preparation-service";
import {
  buildSlackResearchUnavailableWelcomeMessage,
  isMemberResearchBusy,
  requireWebAppUrl,
} from "./slack-onboarding-copy";
import { resolveSlackOnboardingLanguageTag } from "./slack-onboarding-language";
import {
  buildLocalizedJoinedMemberWelcomeMessage,
  getSlackOnboardingActionLabels,
} from "./slack-onboarding-localization";
import {
  buildSlackTeammateInvitationDeliveryId,
  SLACK_TEAMMATE_INVITATION_METADATA,
} from "./slack-onboarding-publication-identity";

const STALE_TEAMMATE_INVITATION_CHECKPOINT_MS = 5 * 60_000;

export async function runSlackInvitedMemberOnboardingTick(input: {
  db: D1Database;
  env: CoreBindings;
  nowMs: number;
  startResearch: (
    onboarding: SlackInvitedMemberOnboarding
  ) => Promise<{ taskId: string }>;
}): Promise<void> {
  await reconcilePendingSlackTeammateInvitationDeliveries(input);
  const waiting = await input.db
    .prepare(
      `
        SELECT DISTINCT organization_id
        FROM slack_teammate_invitation_deliveries
        WHERE status = 'delivered'
          AND onboarding_status = 'waiting_for_join'
        LIMIT 10
      `
    )
    .all<{ organization_id: string }>();
  for (const row of waiting.results) {
    await claimJoinedMembersForOrganization({
      ...input,
      organizationId: row.organization_id,
    });
  }

  const active = await listActiveSlackInvitedMemberOnboardings({
    db: input.db,
  });
  for (const onboarding of active) {
    if (!onboarding.researchTaskId) {
      let research: { taskId: string };
      try {
        research = await input.startResearch(onboarding);
      } catch (error) {
        if (isMemberResearchBusy(error)) {
          continue;
        }
        await failOnboarding({
          ...input,
          failureCode: "member_research_start_failed",
          onboarding,
          error,
        });
        continue;
      }
      try {
        await attachSlackInvitedMemberResearchTask({
          db: input.db,
          interactionId: onboarding.interactionId,
          nowMs: input.nowMs,
          researchTaskId: research.taskId,
          targetSlackUserId: onboarding.targetSlackUserId,
        });
      } catch (error) {
        console.warn(
          "[core.slack_invited_member.research_checkpoint_pending]",
          {
            error: error instanceof Error ? error.message : String(error),
            interactionId: onboarding.interactionId,
            organizationId: onboarding.organizationId,
            researchTaskId: research.taskId,
            slackTeamId: onboarding.slackTeamId,
            targetSlackUserId: onboarding.targetSlackUserId,
          }
        );
      }
      continue;
    }
    try {
      await advanceResearchingOnboarding({ ...input, onboarding });
    } catch (error) {
      await failOnboarding({
        ...input,
        error,
        failureCode: "member_onboarding_advance_failed",
        onboarding,
      });
    }
  }
}

async function reconcilePendingSlackTeammateInvitationDeliveries(input: {
  db: D1Database;
  env: CoreBindings;
  nowMs: number;
}): Promise<void> {
  const pending = await listPendingSlackTeammateInvitationDeliveries({
    beforeOrAtMs: input.nowMs - STALE_TEAMMATE_INVITATION_CHECKPOINT_MS,
    db: input.db,
  });
  for (const delivery of pending) {
    try {
      const botToken = await resolveSlackBotToken({
        cryptoKey: input.env.SLACK_OPENMELD_TOKEN_CRYPTO_KEY,
        db: input.db,
        fallbackBotToken: input.env.SLACK_OPENMELD_BOT_TOKEN,
        slackTeamId: delivery.slackTeamId,
      });
      const dm = await openSlackDirectMessage({
        botToken,
        recipientUserId: delivery.targetSlackUserId,
      });
      const publication = await findSlackTopLevelMessageByMetadata({
        botToken,
        channelId: dm.channelId,
        eventPayloadKey: SLACK_TEAMMATE_INVITATION_METADATA.eventPayloadKey,
        eventPayloadValue: buildSlackTeammateInvitationDeliveryId(delivery),
        eventType: SLACK_TEAMMATE_INVITATION_METADATA.eventType,
      });
      await completeSlackTeammateInvitationDelivery({
        claim: delivery,
        db: input.db,
        failureCode: publication
          ? null
          : "slack_teammate_invitation.publication_outcome_unknown",
        messageTs: publication?.id ?? null,
        nowMs: input.nowMs,
        status: publication ? "delivered" : "outcome_unknown",
      });
    } catch (error) {
      console.warn("[core.slack_teammate_invitation.reconcile_failed]", {
        error: error instanceof Error ? error.message : String(error),
        interactionId: delivery.interactionId,
        slackTeamId: delivery.slackTeamId,
        targetSlackUserId: delivery.targetSlackUserId,
      });
    }
  }
}

async function claimJoinedMembersForOrganization(input: {
  db: D1Database;
  env: CoreBindings;
  nowMs: number;
  organizationId: string;
}): Promise<void> {
  const [invitations, members] = await Promise.all([
    input.db
      .prepare(
        `
          SELECT
            invitation.interaction_id,
            invitation.target_slack_user_id,
            identity_link.openmeld_user_id
          FROM slack_teammate_invitation_deliveries AS invitation
          INNER JOIN slack_user_identity_links AS identity_link
            ON identity_link.organization_id = invitation.organization_id
            AND identity_link.slack_team_id = invitation.slack_team_id
            AND identity_link.slack_user_id = invitation.target_slack_user_id
          WHERE invitation.organization_id = ?
            AND invitation.status = 'delivered'
            AND invitation.onboarding_status = 'waiting_for_join'
        `
      )
      .bind(input.organizationId)
      .all<{
        interaction_id: string;
        openmeld_user_id: string;
        target_slack_user_id: string;
      }>(),
    resolveOrganizationDirectoryMembers({
      authWorker: input.env.OPENMELD_AUTH_WORKER,
      organizationId: input.organizationId,
    }),
  ]);
  const memberByUserId = new Map(
    members.map((member) => [member.userId, member] as const)
  );
  const candidates = invitations.results.flatMap((invitation) => {
    const member = memberByUserId.get(invitation.openmeld_user_id);
    const profile = member?.humanProfile;
    return member && profile?.status === "active"
      ? [
          {
            interactionId: invitation.interaction_id,
            joinedProfileId: profile.profileId,
            joinedUserId: member.userId,
            targetSlackUserId: invitation.target_slack_user_id,
          },
        ]
      : [];
  });
  await claimJoinedSlackInvitedMembers({
    candidates,
    db: input.db,
    nowMs: input.nowMs,
  });
}

async function advanceResearchingOnboarding(input: {
  db: D1Database;
  env: CoreBindings;
  nowMs: number;
  onboarding: SlackInvitedMemberOnboarding;
}): Promise<void> {
  const taskId = input.onboarding.researchTaskId;
  if (!taskId) {
    return;
  }
  const task = await input.db
    .prepare(
      "SELECT status, failure_code, observed_language_tag FROM center_agent_member_research_tasks WHERE id = ? LIMIT 1"
    )
    .bind(taskId)
    .first<{
      failure_code: string | null;
      observed_language_tag: string | null;
      status: string;
    }>();
  if (!task) {
    await failOnboarding({
      ...input,
      failureCode: "member_research_task_missing",
      onboarding: input.onboarding,
    });
    return;
  }
  if (task.status === "failed") {
    await failOnboarding({
      ...input,
      failureCode: task.failure_code ?? "member_research_failed",
      onboarding: input.onboarding,
    });
    return;
  }
  if (task.status !== "completed") {
    return;
  }
  const report = await input.db
    .prepare(
      `
        SELECT
          documents.id AS document_id,
          COALESCE(documents.draft_content, documents.content) AS report_content
        FROM center_agent_member_research_computer_files AS files
        INNER JOIN organization_documents AS documents
          ON documents.id = files.document_id
         AND documents.last_member_research_task_id = files.task_id
        WHERE files.task_id = ?
          AND files.subject_user_id = ?
          AND documents.organization_id = ?
        LIMIT 1
      `
    )
    .bind(
      taskId,
      input.onboarding.joinedUserId,
      input.onboarding.organizationId
    )
    .first<{ document_id: string; report_content: string }>();
  if (!report) {
    await failOnboarding({
      ...input,
      failureCode: "profile_report_missing",
      onboarding: input.onboarding,
    });
    return;
  }
  const organization = await input.db
    .prepare("SELECT name, slug FROM organizations WHERE id = ? LIMIT 1")
    .bind(input.onboarding.organizationId)
    .first<{ name: string; slug: string }>();
  if (!organization) {
    throw new Error("Invited member Organization is unavailable.");
  }
  const languageTag = await resolveSlackOnboardingLanguageTag({
    db: input.db,
    organizationId: input.onboarding.organizationId,
    researchTaskId: taskId,
  });
  const observation = readFirstProfileObservation(report.report_content);
  const message = buildJoinedMemberWelcomeMessage({
    hasUsefulEvidence: !report.report_content.includes(
      "**Insufficient evidence**"
    ),
    languageTag,
    observation,
    organizationName: organization.name,
    targetDisplayName: input.onboarding.targetDisplayName,
  });
  const botToken = await resolveSlackBotToken({
    cryptoKey: input.env.SLACK_OPENMELD_TOKEN_CRYPTO_KEY,
    db: input.db,
    fallbackBotToken: input.env.SLACK_OPENMELD_BOT_TOKEN,
    slackTeamId: input.onboarding.slackTeamId,
  });
  const blocks = buildJoinedMemberWelcomeBlocks({
    documentId: report.document_id,
    languageTag,
    message,
    organizationSlug: organization.slug,
    webAppUrl: input.env.WEB_APP_URL,
  });
  const delivery = await deliverJoinedMemberWelcome({
    db: input.db,
    key: {
      interactionId: input.onboarding.interactionId,
      researchTaskId: taskId,
      targetSlackUserId: input.onboarding.targetSlackUserId,
    },
    nowMs: input.nowMs,
    publish: async () => {
      const publication = await postSlackDirectMessage({
        blocks,
        botToken,
        recipientUserId: input.onboarding.targetSlackUserId,
        text: message,
      });
      return publication.id;
    },
  });
  if (delivery.status === "delivered" && delivery.messageTs) {
    await completeSlackInvitedMemberOnboarding({
      db: input.db,
      interactionId: input.onboarding.interactionId,
      messageTs: delivery.messageTs,
      nowMs: Date.now(),
      researchTaskId: taskId,
      targetSlackUserId: input.onboarding.targetSlackUserId,
    });
  } else if (delivery.status === "outcome_unknown") {
    await failOnboarding({
      ...input,
      failureCode: "welcome_delivery_outcome_unknown",
      onboarding: input.onboarding,
    });
  }
}

async function deliverJoinedMemberWelcome(input: {
  db: D1Database;
  key: SlackInvitedMemberWelcomeDeliveryKey;
  nowMs: number;
  publish: () => Promise<string>;
}): Promise<SlackInvitedMemberWelcomeDelivery> {
  const claim = await claimSlackInvitedMemberWelcomeDelivery({
    claimId: crypto.randomUUID(),
    db: input.db,
    key: input.key,
    nowMs: input.nowMs,
  });
  if (!claim) {
    const existing = await readSlackInvitedMemberWelcomeDelivery({
      db: input.db,
      key: input.key,
    });
    if (!existing) {
      throw new Error("Slack invited-member welcome delivery is unavailable.");
    }
    return existing;
  }

  let messageTs: string;
  try {
    messageTs = await input.publish();
  } catch (error) {
    const outcomeUnknown =
      !(error instanceof SlackMessagePublicationError) ||
      error.publicationOutcome === "unknown";
    let failureCode = "slack_outcome_unknown";
    if (!outcomeUnknown && error instanceof SlackMessagePublicationError) {
      failureCode = error.errorCode ?? "slack_not_published";
    }
    await completeSlackInvitedMemberWelcomeDelivery({
      claim,
      db: input.db,
      failureCode,
      messageTs: null,
      nowMs: Date.now(),
      status: outcomeUnknown ? "outcome_unknown" : "failed",
    });
    return {
      failureCode,
      messageTs: null,
      status: outcomeUnknown ? "outcome_unknown" : "failed",
    };
  }

  await completeSlackInvitedMemberWelcomeDelivery({
    claim,
    db: input.db,
    failureCode: null,
    messageTs,
    nowMs: Date.now(),
    status: "delivered",
  });
  return { failureCode: null, messageTs, status: "delivered" };
}

export function buildJoinedMemberWelcomeMessage(input: {
  hasUsefulEvidence: boolean;
  languageTag?: string | null;
  observation: string | null;
  organizationName: string;
  targetDisplayName: string;
}): string {
  return buildLocalizedJoinedMemberWelcomeMessage(input);
}

export function buildJoinedMemberWelcomeBlocks(input: {
  documentId: string;
  languageTag?: string | null;
  message: string;
  organizationSlug: string;
  webAppUrl?: string | null;
}): readonly Record<string, unknown>[] {
  const baseUrl = requireWebAppUrl(input.webAppUrl);
  const url = new URL(
    `/o/${encodeURIComponent(input.organizationSlug)}/documents/${encodeURIComponent(input.documentId)}`,
    baseUrl
  ).toString();
  const labels = getSlackOnboardingActionLabels(input.languageTag);
  return [
    { text: { text: input.message, type: "mrkdwn" }, type: "section" },
    {
      elements: [
        {
          accessibility_label: labels.seeWhatILearned,
          action_id: "open_profile_report",
          style: "primary",
          text: { text: labels.seeWhatILearned, type: "plain_text" },
          type: "button",
          url,
        },
        {
          accessibility_label: labels.inviteTeammates,
          action_id: "invite_teammates",
          text: { text: labels.inviteTeammates, type: "plain_text" },
          type: "button",
        },
        {
          accessibility_label: labels.introduceInChannels,
          action_id: "start_channel_introduction",
          text: { text: labels.introduceInChannels, type: "plain_text" },
          type: "button",
        },
      ],
      type: "actions",
    },
  ];
}

async function failOnboarding(input: {
  db: D1Database;
  env: CoreBindings;
  error?: unknown;
  failureCode: string;
  nowMs: number;
  onboarding: SlackInvitedMemberOnboarding;
}): Promise<void> {
  try {
    await deliverResearchUnavailableWelcome(input);
  } catch (notificationError) {
    console.warn("[core.slack_invited_member.failure_notice_failed]", {
      error:
        notificationError instanceof Error
          ? notificationError.message
          : String(notificationError),
      interactionId: input.onboarding.interactionId,
      organizationId: input.onboarding.organizationId,
      slackTeamId: input.onboarding.slackTeamId,
      targetSlackUserId: input.onboarding.targetSlackUserId,
    });
  }
  await failSlackInvitedMemberOnboarding({
    db: input.db,
    failureCode: input.failureCode,
    interactionId: input.onboarding.interactionId,
    nowMs: input.nowMs,
    targetSlackUserId: input.onboarding.targetSlackUserId,
  });
  console.warn("[core.slack_invited_member.onboarding_failed]", {
    error: input.error instanceof Error ? input.error.message : undefined,
    failureCode: input.failureCode,
    organizationId: input.onboarding.organizationId,
    slackTeamId: input.onboarding.slackTeamId,
    targetSlackUserId: input.onboarding.targetSlackUserId,
  });
}

async function deliverResearchUnavailableWelcome(input: {
  db: D1Database;
  env: CoreBindings;
  nowMs: number;
  onboarding: SlackInvitedMemberOnboarding;
}): Promise<void> {
  const organization = await input.db
    .prepare(
      `
        SELECT
          organizations.name
        FROM organizations
        WHERE organizations.id = ?
        LIMIT 1
      `
    )
    .bind(input.onboarding.organizationId)
    .first<{ name: string }>();
  if (!organization) {
    throw new Error("Invited member Organization is unavailable.");
  }
  const languageTag = await resolveSlackOnboardingLanguageTag({
    db: input.db,
    organizationId: input.onboarding.organizationId,
    researchTaskId: input.onboarding.researchTaskId,
  });
  const message = buildSlackResearchUnavailableWelcomeMessage({
    displayName: input.onboarding.targetDisplayName,
    languageTag,
    organizationName: organization.name,
  });
  const botToken = await resolveSlackBotToken({
    cryptoKey: input.env.SLACK_OPENMELD_TOKEN_CRYPTO_KEY,
    db: input.db,
    fallbackBotToken: input.env.SLACK_OPENMELD_BOT_TOKEN,
    slackTeamId: input.onboarding.slackTeamId,
  });
  await deliverJoinedMemberWelcome({
    db: input.db,
    key: {
      interactionId: input.onboarding.interactionId,
      researchTaskId: input.onboarding.researchTaskId,
      targetSlackUserId: input.onboarding.targetSlackUserId,
    },
    nowMs: input.nowMs,
    publish: async () => {
      const publication = await postSlackDirectMessage({
        botToken,
        recipientUserId: input.onboarding.targetSlackUserId,
        text: message,
      });
      return publication.id;
    },
  });
}
