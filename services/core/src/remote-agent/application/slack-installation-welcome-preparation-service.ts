import type { CenterAgentMemberResearchReport } from "@openmeld/schemas";
import type { CoreBindings } from "../../lib/bindings";
import {
  attachSlackInstallationWelcomeResearchTask,
  claimQueuedSlackInstallationWelcomePreparations,
  completeSlackInstallationWelcomePreparation,
  failSlackInstallationWelcomePreparation,
  listActiveSlackInstallationWelcomePreparations,
  markSlackInstallationWelcomePreparationReady,
  releaseSlackInstallationWelcomePreparation,
  type SlackInstallationWelcomePreparation,
} from "../infrastructure/d1/slack-installation-welcome-preparation-repo";
import { readSlackInstallationWelcomeDeliveryStatus } from "../infrastructure/d1/slack-installation-welcome-repo";
import { resolveSlackBotToken } from "./slack-bot-token";
import type { SlackBlockKitBlock } from "./slack-client";
import { deliverSlackInstallationWelcome } from "./slack-installation-welcome-service";
import {
  buildSlackResearchUnavailableWelcomeMessage,
  isMemberResearchBusy,
  requireWebAppUrl,
} from "./slack-onboarding-copy";
import { resolveSlackOnboardingLanguageTag } from "./slack-onboarding-language";
import {
  buildLocalizedTrustFirstSlackWelcomeMessage,
  getSlackOnboardingActionLabels,
} from "./slack-onboarding-localization";

const PROFILE_CURRENT_FOCUS_SECTION_PATTERN =
  /### Current focus\s+([\s\S]*?)(?:\n### |\n## |$)/u;
const PROFILE_OBSERVATION_ITEM_PATTERN =
  /^- \d{4}-\d{2}-\d{2} — (.+?) Source: /mu;

type PreparedProfileReport = {
  activeConnectedAppCount: number;
  documentId: string;
  firstObservation: string | null;
  hasUsefulEvidence: boolean;
  installerDisplayName: string;
  organizationName: string;
  organizationSlug: string;
  languageTag: string | null;
  path: string;
};

export async function runSlackInstallationWelcomePreparationTick(input: {
  db: D1Database;
  env: CoreBindings;
  nowMs: number;
  startResearch: (
    preparation: SlackInstallationWelcomePreparation
  ) => Promise<{ taskId: string }>;
}): Promise<void> {
  const claimed = await claimQueuedSlackInstallationWelcomePreparations({
    db: input.db,
    nowMs: input.nowMs,
  });
  for (const preparation of claimed) {
    let research: { taskId: string };
    try {
      research = await input.startResearch(preparation);
    } catch (error) {
      if (isMemberResearchBusy(error)) {
        await releaseSlackInstallationWelcomePreparation({
          claimId: preparation.claimId,
          db: input.db,
          key: preparation.key,
          nowMs: input.nowMs,
        });
        continue;
      }
      await failPreparationSafely({
        db: input.db,
        env: input.env,
        error,
        failureCode: "member_research_start_failed",
        nowMs: input.nowMs,
        preparation,
      });
      continue;
    }
    try {
      await attachSlackInstallationWelcomeResearchTask({
        claimId: preparation.claimId,
        db: input.db,
        key: preparation.key,
        nowMs: input.nowMs,
        researchTaskId: research.taskId,
      });
    } catch (error) {
      console.warn(
        "[core.slack_installation_welcome.research_checkpoint_pending]",
        {
          error: error instanceof Error ? error.message : String(error),
          organizationId: preparation.key.organizationId,
          researchTaskId: research.taskId,
          slackTeamId: preparation.key.slackTeamId,
        }
      );
    }
  }

  const active = await listActiveSlackInstallationWelcomePreparations({
    db: input.db,
  });
  for (const preparation of active) {
    if (!preparation.researchTaskId) {
      continue;
    }
    try {
      await advancePreparation({ ...input, preparation });
    } catch (error) {
      await failPreparationSafely({
        db: input.db,
        env: input.env,
        error,
        failureCode: "welcome_preparation_failed",
        nowMs: input.nowMs,
        preparation,
      });
    }
  }
}

async function advancePreparation(input: {
  db: D1Database;
  env: CoreBindings;
  nowMs: number;
  preparation: SlackInstallationWelcomePreparation;
}): Promise<void> {
  const { preparation } = input;
  const researchTaskId = preparation.researchTaskId;
  if (!researchTaskId) {
    return;
  }
  const research = await input.db
    .prepare(
      `
        SELECT status, failure_code, observed_language_tag, report_result
        FROM center_agent_member_research_tasks
        WHERE id = ?
        LIMIT 1
      `
    )
    .bind(researchTaskId)
    .first<{
      failure_code: string | null;
      observed_language_tag: string | null;
      report_result: CenterAgentMemberResearchReport["result"] | null;
      status: string;
    }>();
  if (!research) {
    await failPreparationSafely({
      db: input.db,
      env: input.env,
      failureCode: "member_research_task_missing",
      nowMs: input.nowMs,
      preparation,
    });
    return;
  }
  if (research.status === "failed") {
    await failPreparationSafely({
      db: input.db,
      env: input.env,
      failureCode:
        research.failure_code ?? "member_research_completed_without_report",
      nowMs: input.nowMs,
      preparation,
    });
    return;
  }
  if (research.status !== "completed") {
    return;
  }
  if (!research.report_result) {
    await failPreparationSafely({
      db: input.db,
      env: input.env,
      failureCode: "member_research_report_result_missing",
      nowMs: input.nowMs,
      preparation,
    });
    return;
  }
  const report = await readPreparedProfileReport({
    db: input.db,
    preparation,
  });
  if (!report) {
    await failPreparationSafely({
      db: input.db,
      env: input.env,
      failureCode: "profile_report_missing",
      nowMs: input.nowMs,
      preparation,
    });
    return;
  }
  if (preparation.status === "researching") {
    await markSlackInstallationWelcomePreparationReady({
      claimId: preparation.claimId,
      db: input.db,
      key: preparation.key,
      nowMs: input.nowMs,
      researchTaskId,
    });
  }
  const message = buildTrustFirstSlackWelcomeMessage({
    firstObservation: report.firstObservation,
    hasUsefulEvidence: report.hasUsefulEvidence,
    installerDisplayName: report.installerDisplayName,
    languageTag: report.languageTag,
    messageKind: preparation.messageKind,
    organizationName: report.organizationName,
  });
  const blocks = buildTrustFirstSlackWelcomeBlocks({
    activeConnectedAppCount: report.activeConnectedAppCount,
    documentId: report.documentId,
    languageTag: report.languageTag,
    message,
    organizationSlug: report.organizationSlug,
    webAppUrl: input.env.WEB_APP_URL,
  });
  const botToken = await resolveSlackBotToken({
    cryptoKey: input.env.SLACK_OPENMELD_TOKEN_CRYPTO_KEY,
    db: input.db,
    fallbackBotToken: input.env.SLACK_OPENMELD_BOT_TOKEN,
    slackTeamId: preparation.key.slackTeamId,
  });
  let result: "delivered" | "skipped";
  try {
    result = await deliverSlackInstallationWelcome({
      allowCreate: true,
      allowRetry: preparation.failureCode === "slack_delivery_retry_authorized",
      botToken,
      buildBlocks: async () => blocks,
      connectionCreatedAtMs: preparation.key.connectionCreatedAtMs,
      db: input.db,
      messageKind: preparation.messageKind,
      messages: { connected: message, moved: message },
      nowMs: input.nowMs,
      organizationId: preparation.key.organizationId,
      recipientSlackUserId: preparation.key.recipientSlackUserId,
      slackTeamId: preparation.key.slackTeamId,
    });
  } catch (error) {
    const deliveryStatus = await readSlackInstallationWelcomeDeliveryStatus({
      db: input.db,
      key: preparation.key,
    });
    await failPreparationSafely({
      db: input.db,
      env: input.env,
      error,
      failureCode:
        deliveryStatus === "outcome_unknown"
          ? "slack_delivery_outcome_unknown"
          : "slack_delivery_failed",
      nowMs: Date.now(),
      preparation,
      sendResearchFailureWelcome: false,
    });
    return;
  }
  const deliveryStatus =
    result === "delivered"
      ? "delivered"
      : await readSlackInstallationWelcomeDeliveryStatus({
          db: input.db,
          key: preparation.key,
        });
  if (deliveryStatus === "delivered") {
    await completeSlackInstallationWelcomePreparation({
      claimId: preparation.claimId,
      db: input.db,
      key: preparation.key,
      nowMs: Date.now(),
      researchTaskId,
    });
  } else if (deliveryStatus === "outcome_unknown") {
    await failPreparationSafely({
      db: input.db,
      env: input.env,
      failureCode: "slack_delivery_outcome_unknown",
      nowMs: Date.now(),
      preparation,
      sendResearchFailureWelcome: false,
    });
  }
}

export async function readPreparedProfileReport(input: {
  db: D1Database;
  preparation: SlackInstallationWelcomePreparation;
}): Promise<PreparedProfileReport | null> {
  const row = await input.db
    .prepare(
      `
        SELECT
          documents.id AS document_id,
          COALESCE(documents.draft_content, documents.content) AS report_content,
          files.path AS path,
          tasks.report_result AS report_result,
          users.name AS installer_display_name,
          organizations.name AS organization_name,
          organizations.slug AS organization_slug,
          (
            SELECT COUNT(*)
            FROM connector_connections
            WHERE organization_id = organizations.id
              AND status = 'active'
          ) AS active_connected_app_count
        FROM center_agent_member_research_computer_files AS files
        INNER JOIN organization_documents AS documents
          ON documents.id = files.document_id
         AND documents.last_member_research_task_id = files.task_id
        INNER JOIN organizations
          ON organizations.id = documents.organization_id
        INNER JOIN users
          ON users.id = ?
        INNER JOIN center_agent_member_research_tasks AS tasks
          ON tasks.id = files.task_id
        WHERE files.task_id = ?
          AND files.subject_user_id = ?
          AND documents.organization_id = ?
        LIMIT 1
      `
    )
    .bind(
      input.preparation.installedByUserId,
      input.preparation.researchTaskId,
      input.preparation.installedByUserId,
      input.preparation.key.organizationId
    )
    .first<{
      active_connected_app_count: number;
      document_id: string;
      report_content: string;
      installer_display_name: string;
      organization_name: string;
      organization_slug: string;
      path: string;
      report_result: CenterAgentMemberResearchReport["result"] | null;
    }>();
  if (!row) {
    return null;
  }
  const languageTag = await resolveSlackOnboardingLanguageTag({
    db: input.db,
    organizationId: input.preparation.key.organizationId,
    researchTaskId: input.preparation.researchTaskId,
  });
  return {
    activeConnectedAppCount: Number(row.active_connected_app_count),
    documentId: row.document_id,
    firstObservation: readFirstProfileObservation(row.report_content),
    hasUsefulEvidence: row.report_result === "evidence_backed",
    installerDisplayName: row.installer_display_name,
    organizationName: row.organization_name,
    organizationSlug: row.organization_slug,
    languageTag,
    path: row.path,
  };
}

export function buildTrustFirstSlackWelcomeMessage(input: {
  firstObservation: string | null;
  hasUsefulEvidence: boolean;
  installerDisplayName: string;
  languageTag?: string | null;
  messageKind: "connected" | "moved";
  organizationName: string;
}): string {
  return buildLocalizedTrustFirstSlackWelcomeMessage(input);
}

export function buildTrustFirstSlackWelcomeBlocks(input: {
  activeConnectedAppCount: number;
  documentId: string;
  languageTag?: string | null;
  message: string;
  organizationSlug: string;
  webAppUrl?: string | null;
}): readonly SlackBlockKitBlock[] | undefined {
  const baseUrl = requireWebAppUrl(input.webAppUrl);
  const organizationRoot = new URL(
    `/o/${encodeURIComponent(input.organizationSlug)}/`,
    baseUrl
  );
  const labels = getSlackOnboardingActionLabels(input.languageTag);
  const actions: Record<string, unknown>[] = [
    slackLinkButton({
      actionId: "open_profile_report",
      label: labels.seeWhatILearned,
      style: "primary",
      url: new URL(
        `documents/${encodeURIComponent(input.documentId)}`,
        organizationRoot
      ).toString(),
    }),
    slackActionButton({
      actionId: "invite_teammates",
      label: labels.inviteTeammates,
    }),
    slackActionButton({
      actionId: "start_channel_introduction",
      label: labels.introduceInChannels,
    }),
  ];
  if (input.activeConnectedAppCount === 0) {
    actions.push(
      slackLinkButton({
        actionId: "connect_more_context",
        label: labels.connectMoreContext,
        url: new URL("center-agent/plugins", organizationRoot).toString(),
      })
    );
  }
  return [
    { type: "section", text: { type: "mrkdwn", text: input.message } },
    { type: "actions", elements: actions },
  ];
}

export function readFirstProfileObservation(content: string): string | null {
  const section = content.match(PROFILE_CURRENT_FOCUS_SECTION_PATTERN)?.[1];
  if (!section) {
    return null;
  }
  const firstItem = section.match(PROFILE_OBSERVATION_ITEM_PATTERN)?.[1];
  return firstItem?.trim() || null;
}

function slackLinkButton(input: {
  actionId: string;
  label: string;
  style?: "primary";
  url: string;
}): Record<string, unknown> {
  return {
    accessibility_label: input.label,
    action_id: input.actionId,
    ...(input.style ? { style: input.style } : {}),
    text: { text: input.label, type: "plain_text" },
    type: "button",
    url: input.url,
  };
}

function slackActionButton(input: {
  actionId: string;
  label: string;
}): Record<string, unknown> {
  return {
    accessibility_label: input.label,
    action_id: input.actionId,
    text: { text: input.label, type: "plain_text" },
    type: "button",
  };
}

async function failPreparationSafely(input: {
  db: D1Database;
  env: CoreBindings;
  error?: unknown;
  failureCode: string;
  nowMs: number;
  preparation: SlackInstallationWelcomePreparation;
  sendResearchFailureWelcome?: boolean;
}): Promise<void> {
  if (input.sendResearchFailureWelcome !== false) {
    try {
      await deliverResearchUnavailableWelcome({
        db: input.db,
        env: input.env,
        nowMs: input.nowMs,
        preparation: input.preparation,
      });
    } catch (notificationError) {
      console.warn("[core.slack_installation_welcome.failure_notice_failed]", {
        error: toOptionalErrorMessage(notificationError),
        organizationId: input.preparation.key.organizationId,
        slackTeamId: input.preparation.key.slackTeamId,
      });
    }
  }
  await failSlackInstallationWelcomePreparation({
    claimId: input.preparation.claimId,
    db: input.db,
    failureCode: input.failureCode,
    key: input.preparation.key,
    nowMs: input.nowMs,
  });
  console.warn("[core.slack_installation_welcome.preparation_failed]", {
    error: toOptionalErrorMessage(input.error),
    failureCode: input.failureCode,
    organizationId: input.preparation.key.organizationId,
    slackTeamId: input.preparation.key.slackTeamId,
  });
}

async function deliverResearchUnavailableWelcome(input: {
  db: D1Database;
  env: CoreBindings;
  nowMs: number;
  preparation: SlackInstallationWelcomePreparation;
}): Promise<void> {
  const context = await input.db
    .prepare(
      `
        SELECT
          organizations.name AS organization_name,
          users.name AS display_name
        FROM organizations
        INNER JOIN users ON users.id = ?
        WHERE organizations.id = ?
        LIMIT 1
      `
    )
    .bind(
      input.preparation.installedByUserId,
      input.preparation.key.organizationId
    )
    .first<{
      display_name: string;
      organization_name: string;
    }>();
  if (!context) {
    throw new Error("Slack welcome failure notice context is unavailable.");
  }
  const languageTag = await resolveSlackOnboardingLanguageTag({
    db: input.db,
    organizationId: input.preparation.key.organizationId,
    researchTaskId: input.preparation.researchTaskId,
  });
  const message = buildSlackResearchUnavailableWelcomeMessage({
    displayName: context.display_name,
    languageTag,
    organizationName: context.organization_name,
    workspaceMoved: input.preparation.messageKind === "moved",
  });
  const botToken = await resolveSlackBotToken({
    cryptoKey: input.env.SLACK_OPENMELD_TOKEN_CRYPTO_KEY,
    db: input.db,
    fallbackBotToken: input.env.SLACK_OPENMELD_BOT_TOKEN,
    slackTeamId: input.preparation.key.slackTeamId,
  });
  await deliverSlackInstallationWelcome({
    allowCreate: true,
    allowRetry: false,
    botToken,
    buildBlocks: async () => undefined,
    connectionCreatedAtMs: input.preparation.key.connectionCreatedAtMs,
    db: input.db,
    messageKind: input.preparation.messageKind,
    messages: { connected: message, moved: message },
    nowMs: input.nowMs,
    organizationId: input.preparation.key.organizationId,
    recipientSlackUserId: input.preparation.key.recipientSlackUserId,
    slackTeamId: input.preparation.key.slackTeamId,
  });
}

function toOptionalErrorMessage(error: unknown): string | null {
  if (error === undefined) {
    return null;
  }
  return error instanceof Error ? error.message : String(error);
}
