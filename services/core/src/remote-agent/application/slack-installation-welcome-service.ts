import {
  claimSlackInstallationWelcomeDelivery,
  completeSlackInstallationWelcomeDelivery,
  SLACK_INSTALLATION_WELCOME_VERSION,
  type SlackInstallationWelcomeMessageKind,
} from "../infrastructure/d1/slack-installation-welcome-repo";
import {
  postSlackDirectMessage,
  type SlackBlockKitBlock,
  SlackMessagePublicationError,
} from "./slack-client";

export async function deliverSlackInstallationWelcome(input: {
  allowCreate: boolean;
  allowRetry: boolean;
  botToken: string;
  buildBlocks: (
    message: string
  ) => Promise<readonly SlackBlockKitBlock[] | undefined>;
  connectionCreatedAtMs: number;
  db: D1Database;
  messages: Record<SlackInstallationWelcomeMessageKind, string>;
  messageKind: SlackInstallationWelcomeMessageKind;
  nowMs: number;
  organizationId: string;
  recipientSlackUserId: string;
  slackTeamId: string;
}): Promise<"delivered" | "skipped"> {
  const claim = await claimSlackInstallationWelcomeDelivery({
    allowCreate: input.allowCreate,
    allowRetry: input.allowRetry,
    claimId: crypto.randomUUID(),
    db: input.db,
    key: {
      connectionCreatedAtMs: input.connectionCreatedAtMs,
      organizationId: input.organizationId,
      recipientSlackUserId: input.recipientSlackUserId,
      slackTeamId: input.slackTeamId,
      welcomeVersion: SLACK_INSTALLATION_WELCOME_VERSION,
    },
    messageKind: input.messageKind,
    nowMs: input.nowMs,
  });
  if (!claim) {
    return "skipped";
  }

  try {
    const message = input.messages[claim.messageKind];
    const blocks = await input.buildBlocks(message);
    const publication = await postSlackDirectMessage({
      ...(blocks ? { blocks } : {}),
      botToken: input.botToken,
      recipientUserId: input.recipientSlackUserId,
      text: message,
    });
    await completeSlackInstallationWelcomeDelivery({
      claim,
      db: input.db,
      failureCode: null,
      messageTs: publication.id,
      nowMs: Date.now(),
      status: "delivered",
    });
    return "delivered";
  } catch (error) {
    const completion = classifySlackInstallationWelcomeFailure(error);
    try {
      await completeSlackInstallationWelcomeDelivery({
        claim,
        db: input.db,
        failureCode: completion.failureCode,
        messageTs: null,
        nowMs: Date.now(),
        status: completion.status,
      });
    } catch (completionError) {
      console.warn("[core.slack_installation_welcome.outcome_record_failed]", {
        attemptCount: claim.attemptCount,
        completionError: serializeError(completionError),
        organizationId: claim.key.organizationId,
        slackTeamId: claim.key.slackTeamId,
      });
    }
    throw error;
  }
}

function classifySlackInstallationWelcomeFailure(error: unknown): {
  failureCode: string;
  status: "failed" | "outcome_unknown";
} {
  if (error instanceof SlackMessagePublicationError) {
    if (error.publicationOutcome === "unknown") {
      return {
        failureCode: "slack_outcome_unknown",
        status: "outcome_unknown",
      };
    }
    return {
      failureCode: error.errorCode ?? "slack_not_published",
      status: "failed",
    };
  }
  return {
    failureCode: "welcome_preparation_failed",
    status: "failed",
  };
}

function serializeError(error: unknown): { message: string; name: string } {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
    };
  }
  return {
    message: String(error),
    name: "UnknownError",
  };
}
