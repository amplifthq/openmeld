import type { PostgresDatabase } from "@openmeld/db/postgresql";
import {
  remoteAgentSlackChannelMessageEventSchema,
  remoteAgentSlackEventCallbackPayloadSchema,
} from "@openmeld/schemas";
import type { RemoteAgentSlackEventCallbackPayload } from "@openmeld/schemas/types";
import { readRemoteAgentSlackWorkspaceBinding } from "../infrastructure/postgresql/slack-workspace-binding-repo";
import { readSlackWorkspaceToken } from "../infrastructure/postgresql/slack-workspace-token-repo";
import {
  recordAndScheduleUnaddressedChannelMessage,
  type UnaddressedChannelBatchRequest,
  type UnaddressedChannelBatchSubmission,
  type UnaddressedChannelObservationDependencies,
  type UnaddressedChannelObservationResult,
} from "./message-channel-unaddressed-intake-service";

type UnaddressedSlackObservationDependencies =
  UnaddressedChannelObservationDependencies & {
    readWorkspace(input: {
      db: PostgresDatabase;
      slackTeamId: string;
    }): Promise<{
      botUserId: string;
      organizationId: string;
    } | null>;
  };

/**
 * Reads the Organization and the app's own Slack user for a workspace. Both
 * must be known: the Organization owns the archive, and the app's user id is
 * how a message that mentions the app is told apart from an unaddressed one.
 */
export async function readUnaddressedSlackWorkspace(input: {
  db: PostgresDatabase;
  slackTeamId: string;
}): Promise<{ botUserId: string; organizationId: string } | null> {
  const [binding, token] = await Promise.all([
    readRemoteAgentSlackWorkspaceBinding(input),
    readSlackWorkspaceToken(input),
  ]);
  if (!(binding && token) || token.organizationId !== binding.organizationId) {
    return null;
  }
  return {
    botUserId: token.botUserId,
    organizationId: binding.organizationId,
  };
}

/**
 * Archives one ordinary Slack channel message and schedules the flush that
 * routes its batch. Returns null when the payload is not such a message, so
 * the caller continues with the addressed Slack path. Nothing is posted to
 * Slack here.
 */
export async function observeUnaddressedSlackChannelMessage(
  input: {
    /** Opened only for an ordinary channel message, never for other events. */
    getDb(): PostgresDatabase;
    nowMs: number;
    payload: unknown;
    queue: Parameters<
      typeof recordAndScheduleUnaddressedChannelMessage
    >[0]["queue"];
  },
  dependencies: UnaddressedSlackObservationDependencies
): Promise<UnaddressedChannelObservationResult | null> {
  const payload = remoteAgentSlackEventCallbackPayloadSchema.safeParse(
    input.payload
  );
  if (!payload.success || payload.data.event.type !== "message") {
    return null;
  }
  const channelType = payload.data.event.channel_type;
  if (channelType !== "channel" && channelType !== "group") {
    return null;
  }
  const event = remoteAgentSlackChannelMessageEventSchema.safeParse(
    payload.data.event
  );
  if (!event.success) {
    // App posts, edits, deletions, joins, and other subtypes are not input.
    return {
      reasonCode: "slack.unaddressed_message_not_ordinary",
      status: "ignored",
    };
  }
  const slackTeamId = payload.data.team_id;
  const db = input.getDb();
  const workspace = await dependencies.readWorkspace({ db, slackTeamId });
  if (!workspace) {
    return {
      reasonCode: "slack.unaddressed_workspace_unavailable",
      status: "ignored",
    };
  }
  const text = event.data.text?.trim() ?? "";
  if (
    event.data.user === workspace.botUserId ||
    text.includes(`<@${workspace.botUserId}>`)
  ) {
    // Slack also sends an app_mention event for this message. That event
    // owns the turn, so archiving it here would start a second one.
    return {
      reasonCode: "slack.unaddressed_message_addressed",
      status: "ignored",
    };
  }
  const sentAtMs = parseSlackTimestampMs(event.data.ts);
  if (sentAtMs === null) {
    return {
      reasonCode: "slack.unaddressed_message_timestamp_invalid",
      status: "ignored",
    };
  }
  return await recordAndScheduleUnaddressedChannelMessage(
    {
      db,
      message: {
        connectionGeneration: null,
        connectionId: slackTeamId,
        conversationKey: event.data.channel,
        messageId: event.data.ts,
        organizationId: workspace.organizationId,
        provider: "slack",
        resources: [],
        rootMessageId: event.data.thread_ts ?? event.data.ts,
        senderId: event.data.user,
        senderTenantKey: slackTeamId,
        sentAtMs,
        slackFiles: event.data.files ?? [],
        text,
        threadId: null,
      },
      nowMs: input.nowMs,
      queue: input.queue,
    },
    dependencies
  );
}

/**
 * Starts the turn for a routed Slack batch through the ordinary app-mention
 * path. The request keeps the trigger message's own Slack identifiers, so
 * the reply lands in that message's thread.
 */
export async function submitUnaddressedSlackRequest(
  request: UnaddressedChannelBatchRequest,
  dependencies: {
    processSlackEvent(
      payload: RemoteAgentSlackEventCallbackPayload,
      context: { addressed: false }
    ): Promise<{ status: string }>;
  }
): Promise<UnaddressedChannelBatchSubmission> {
  const { trigger } = request;
  const outcome = await dependencies.processSlackEvent(
    {
      type: "event_callback",
      team_id: trigger.connectionId,
      event_id: request.requestEventId,
      event: {
        type: "app_mention",
        user: trigger.senderId,
        text: request.text,
        ts: trigger.messageId,
        channel: trigger.conversationKey,
        ...(trigger.rootMessageId === trigger.messageId
          ? {}
          : { thread_ts: trigger.rootMessageId }),
        ...(trigger.slackFiles.length > 0 ? { files: trigger.slackFiles } : {}),
      },
    },
    { addressed: false }
  );
  if (outcome.status === "processed" || outcome.status === "duplicate") {
    return { deliveryId: null, status: "submitted" };
  }
  return {
    reasonCode: `slack.unaddressed_request_${outcome.status}`,
    status: "not_submitted",
  };
}

function parseSlackTimestampMs(ts: string): number | null {
  const seconds = Number(ts);
  return Number.isFinite(seconds) && seconds >= 0
    ? Math.floor(seconds * 1000)
    : null;
}
