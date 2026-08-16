import { slackWelcomeInteractionRpcInputSchema } from "@openmeld/schemas";
import type { Context, Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import { verifySlackRequestSignature } from "../lib/slack-request-signature";

export function registerSlackInteractiveRoute(app: Hono<HonoBindings>): void {
  app.post("/slack/interactive", async (c) => {
    const body = new TextDecoder().decode(await c.req.arrayBuffer());
    const verified = await verifySlackRequestSignature({
      body,
      nowSeconds: Math.floor(Date.now() / 1000),
      signature: c.req.header("x-slack-signature"),
      signingSecret: c.env.SLACK_OPENMELD_SIGNING_SECRET,
      timestamp: c.req.header("x-slack-request-timestamp"),
    });
    if (!verified) {
      return c.text("Invalid Slack signature", 401);
    }

    const payload = parseInteractivePayload(body);
    if (!payload) {
      return c.text("Invalid Slack interaction", 400);
    }
    return await handleVerifiedSlackInteraction(c, payload);
  });
}

type SlackInteractivePayload = {
  actions?: Array<{ action_id?: string }>;
  team?: { id?: string };
  trigger_id?: string;
  type?: string;
  user?: { id?: string };
  view?: {
    callback_id?: string;
    id?: string;
    state?: {
      values?: {
        teammates?: {
          selected_teammates?: { selected_users?: string[] };
        };
        channels?: {
          selected_channels?: { selected_channels?: string[] };
        };
      };
    };
  };
};

function parseInteractivePayload(body: string): SlackInteractivePayload | null {
  const rawPayload = new URLSearchParams(body).get("payload");
  if (!rawPayload) {
    return null;
  }
  try {
    const parsed = JSON.parse(rawPayload) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as SlackInteractivePayload)
      : null;
  } catch {
    return null;
  }
}

async function handleVerifiedSlackInteraction(
  c: Context<HonoBindings>,
  payload: SlackInteractivePayload
): Promise<Response> {
  if (payload.type === "block_actions") {
    await handleSlackBlockAction(c, payload);
    return c.body(null, 200);
  }
  if (isTeammateInviteSubmission(payload)) {
    return handleTeammateInviteSubmission(c, payload);
  }
  if (isChannelIntroductionSubmission(payload)) {
    return handleChannelIntroductionSubmission(c, payload);
  }
  return c.body(null, 200);
}

function handleTeammateInviteSubmission(
  c: Context<HonoBindings>,
  payload: SlackInteractivePayload & {
    team: { id: string };
    user: { id: string };
    view: SlackInteractivePayload["view"] & { id: string };
  }
): Response {
  const selectedUsers =
    payload.view.state?.values?.teammates?.selected_teammates?.selected_users ??
    [];
  const input = slackWelcomeInteractionRpcInputSchema.safeParse({
    action: "submit_teammate_invites",
    interactionId: payload.view.id,
    slackTeamId: payload.team.id,
    slackUserId: payload.user.id,
    targetSlackUserIds: selectedUsers,
  });
  if (!input.success) {
    return c.json({
      response_action: "errors",
      errors: { teammates: "Choose at least one teammate." },
    });
  }
  c.executionCtx.waitUntil(
    observeSlackWelcomeInteraction(
      c.env.OPENMELD_CORE_WORKER.handleSlackWelcomeInteraction(input.data),
      input.data
    )
  );
  return c.body(null, 200);
}

function handleChannelIntroductionSubmission(
  c: Context<HonoBindings>,
  payload: SlackInteractivePayload & {
    team: { id: string };
    user: { id: string };
    view: SlackInteractivePayload["view"] & { id: string };
  }
): Response {
  const selectedChannels =
    payload.view.state?.values?.channels?.selected_channels
      ?.selected_channels ?? [];
  const input = slackWelcomeInteractionRpcInputSchema.safeParse({
    action: "submit_channel_introductions",
    interactionId: payload.view.id,
    slackTeamId: payload.team.id,
    slackUserId: payload.user.id,
    targetSlackChannelIds: selectedChannels,
  });
  if (!input.success) {
    return c.json({
      response_action: "errors",
      errors: { channels: "Choose at least one channel." },
    });
  }
  c.executionCtx.waitUntil(
    observeSlackWelcomeInteraction(
      c.env.OPENMELD_CORE_WORKER.handleSlackWelcomeInteraction(input.data),
      input.data
    )
  );
  return c.body(null, 200);
}

async function observeSlackWelcomeInteraction(
  promise: Promise<unknown>,
  input: { action: string; slackTeamId: string; slackUserId: string }
): Promise<void> {
  try {
    await promise;
  } catch (error) {
    console.error("[gateway.slack_interaction.core_failed]", {
      action: input.action,
      error: error instanceof Error ? error.message : String(error),
      slackTeamId: input.slackTeamId,
      slackUserId: input.slackUserId,
    });
  }
}

async function handleSlackBlockAction(
  c: Context<HonoBindings>,
  payload: SlackInteractivePayload
): Promise<void> {
  const actionId = payload.actions?.[0]?.action_id;
  const slackTeamId = payload.team?.id;
  const slackUserId = payload.user?.id;
  if (!(slackTeamId && slackUserId)) {
    return;
  }
  if (actionId === "invite_teammates" && payload.trigger_id) {
    const input = slackWelcomeInteractionRpcInputSchema.parse({
      action: "open_teammate_invite_modal",
      slackTeamId,
      slackUserId,
      triggerId: payload.trigger_id,
    });
    await c.env.OPENMELD_CORE_WORKER.handleSlackWelcomeInteraction(input);
    return;
  }
  if (actionId === "start_channel_introduction" && payload.trigger_id) {
    const input = slackWelcomeInteractionRpcInputSchema.parse({
      action: "open_channel_introduction_modal",
      slackTeamId,
      slackUserId,
      triggerId: payload.trigger_id,
    });
    await c.env.OPENMELD_CORE_WORKER.handleSlackWelcomeInteraction(input);
  }
}

function isChannelIntroductionSubmission(
  payload: SlackInteractivePayload
): payload is SlackInteractivePayload & {
  team: { id: string };
  user: { id: string };
  view: SlackInteractivePayload["view"] & { id: string };
} {
  return Boolean(
    payload.type === "view_submission" &&
      payload.view?.callback_id === "openmeld_introduce_in_channels" &&
      payload.view.id &&
      payload.team?.id &&
      payload.user?.id
  );
}

function isTeammateInviteSubmission(
  payload: SlackInteractivePayload
): payload is SlackInteractivePayload & {
  team: { id: string };
  user: { id: string };
  view: SlackInteractivePayload["view"] & { id: string };
} {
  return Boolean(
    payload.type === "view_submission" &&
      payload.view?.callback_id === "openmeld_invite_teammates" &&
      payload.view.id &&
      payload.team?.id &&
      payload.user?.id
  );
}
