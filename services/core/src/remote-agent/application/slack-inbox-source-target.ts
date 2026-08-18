import { slackInboxSourceTargetSchema } from "@openmeld/schemas";
import type { InboxSourceTarget } from "@openmeld/schemas/types";
import type { RemoteAgentNativeDeliveryRecord } from "../infrastructure/d1/native-delivery-ledger-repo";
import { getSlackMessagePermalink } from "./slack-client";

export type SlackInboxSourceTarget = Extract<
  InboxSourceTarget,
  { kind: "message_channel"; provider: "slack" }
>;

export async function resolveSlackInboxSourceTarget(input: {
  botToken: string;
  delivery: Pick<
    RemoteAgentNativeDeliveryRecord,
    "publishedSignalId" | "slackChannelId" | "slackTeamId" | "slackThreadTs"
  >;
  fetchImpl?: typeof fetch;
}): Promise<SlackInboxSourceTarget> {
  const teamId = requireSlackSourceIdentifier(
    input.delivery.slackTeamId,
    "team id"
  );
  const channelId = requireSlackSourceIdentifier(
    input.delivery.slackChannelId,
    "channel id"
  );
  const threadRootMessageId = requireSlackSourceIdentifier(
    input.delivery.slackThreadTs,
    "thread root message id"
  );
  const messageId =
    normalizeOptionalText(input.delivery.publishedSignalId) ??
    threadRootMessageId;
  const permalink = await getSlackMessagePermalink({
    botToken: input.botToken,
    channelId,
    fetchImpl: input.fetchImpl,
    messageTs: messageId,
  });
  return slackInboxSourceTargetSchema.parse({
    channelId,
    kind: "message_channel",
    messageId,
    permalink,
    provider: "slack",
    teamId,
    threadRootMessageId,
  });
}

function requireSlackSourceIdentifier(
  value: string | null,
  label: string
): string {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    throw new Error(`Slack Inbox source ${label} is missing`);
  }
  return normalized;
}

function normalizeOptionalText(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized || null;
}
