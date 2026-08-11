import {
  remoteAgentSlackEventQueueMessageSchema,
  remoteAgentSlackEventsApiPayloadSchema,
} from "@openmeld/schemas";
import type { Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import { verifySlackRequestSignature } from "../lib/slack-request-signature";

const NONNEGATIVE_INTEGER_PATTERN = /^\d+$/u;

export function registerSlackEventsRoute(app: Hono<HonoBindings>): void {
  app.post("/slack/events", async (c) => {
    const receivedAtMs = Date.now();
    const gatewayRequestId = crypto.randomUUID();
    const body = await c.req.text();
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

    let payloadJson: unknown;
    try {
      payloadJson = JSON.parse(body) as unknown;
    } catch {
      return c.text("Invalid Slack payload", 400);
    }

    const payload =
      remoteAgentSlackEventsApiPayloadSchema.safeParse(payloadJson);
    if (!payload.success) {
      return c.text("Invalid Slack payload", 400);
    }

    if (payload.data.type === "url_verification") {
      return c.text(payload.data.challenge);
    }
    const eventPayload = payload.data;

    const queue = c.env.OPENMELD_REMOTE_AGENT_SLACK_EVENTS_QUEUE;
    if (!queue) {
      console.warn("[gateway.slack.events.queue_unavailable]", {
        eventId: eventPayload.event_id ?? null,
        gatewayRequestId,
        teamId: eventPayload.team_id,
      });
      return c.text("Slack event queue unavailable", 503);
    }

    const slackRetryNum = parseSlackRetryNumber(
      c.req.header("x-slack-retry-num")
    );
    const slackRetryReason = normalizeOptionalText(
      c.req.header("x-slack-retry-reason")
    );
    const queueMessage = remoteAgentSlackEventQueueMessageSchema.parse({
      gatewayRequestId,
      kind: "remote_agent_slack_event",
      payload: eventPayload,
      receivedAtMs,
      slackRetryNum,
      slackRetryReason,
      v: 1,
    });
    try {
      await queue.send(queueMessage);
    } catch (error) {
      console.warn("[gateway.slack.events.enqueue_failed]", {
        ackLatencyMs: Date.now() - receivedAtMs,
        error: toErrorMessage(error),
        eventId: eventPayload.event_id ?? null,
        gatewayRequestId,
        slackRetryNum,
        slackRetryReason,
        teamId: eventPayload.team_id,
      });
      return c.text("Slack event enqueue failed", 503);
    }
    console.info("[gateway.slack.events.enqueued]", {
      ackLatencyMs: Date.now() - receivedAtMs,
      eventId: eventPayload.event_id ?? null,
      gatewayRequestId,
      slackRetryNum,
      slackRetryReason,
      teamId: eventPayload.team_id,
    });
    return c.text("OK");
  });
}

function parseSlackRetryNumber(value: string | undefined): number | null {
  if (!(value && NONNEGATIVE_INTEGER_PATTERN.test(value))) {
    return null;
  }
  const retryNumber = Number(value);
  return Number.isSafeInteger(retryNumber) ? retryNumber : null;
}

function normalizeOptionalText(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
