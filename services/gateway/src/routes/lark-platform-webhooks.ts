import {
  LARK_PLATFORM_WEBHOOK_RAW_BODY_MAX_BYTES,
  larkPlatformWebhookVerificationResponseSchema,
} from "@openmeld/schemas";
import type { LarkPlatformWebhookVerificationResponse } from "@openmeld/schemas/types";
import type { Context, Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import { readJsonRequestBody } from "./rpc-http.parsers";

const LARK_PLATFORM_PROVIDERS = ["lark", "feishu"] as const;
const LARK_PLATFORM_WEBHOOK_SURFACES = ["events", "callbacks"] as const;

type LarkPlatformProvider = (typeof LARK_PLATFORM_PROVIDERS)[number];
type LarkPlatformWebhookSurface =
  (typeof LARK_PLATFORM_WEBHOOK_SURFACES)[number];
type LarkPlatformWebhookContext = Context<HonoBindings>;

export function registerLarkPlatformWebhookRoutes(
  app: Hono<HonoBindings>
): void {
  for (const provider of LARK_PLATFORM_PROVIDERS) {
    for (const surface of LARK_PLATFORM_WEBHOOK_SURFACES) {
      app.post(`/message-channels/${provider}/:connectionId/${surface}`, (c) =>
        handleLarkPlatformWebhook({ c, provider, surface })
      );
    }
  }
}

async function handleLarkPlatformWebhook(input: {
  c: LarkPlatformWebhookContext;
  provider: LarkPlatformProvider;
  surface: LarkPlatformWebhookSurface;
}): Promise<Response> {
  const receivedAtMs = Date.now();
  const gatewayRequestId = crypto.randomUUID();
  const body = await readJsonRequestBody(input.c.req.raw, {
    maxBytes: LARK_PLATFORM_WEBHOOK_RAW_BODY_MAX_BYTES,
  });
  if (!body.ok) {
    return body.message === "Payload too large"
      ? input.c.text("Provider payload too large", 413)
      : input.c.text("Invalid provider payload", 400);
  }

  const verification = await requestLarkPlatformWebhookVerification({
    ...input,
    gatewayRequestId,
    rawBody: body.rawBody,
    receivedAtMs,
  });
  if (!verification) {
    return input.c.text("Provider verification unavailable", 503);
  }
  return respondToLarkPlatformWebhookVerification({
    ...input,
    gatewayRequestId,
    receivedAtMs,
    verification,
  });
}

async function requestLarkPlatformWebhookVerification(input: {
  c: LarkPlatformWebhookContext;
  gatewayRequestId: string;
  provider: LarkPlatformProvider;
  rawBody: string;
  receivedAtMs: number;
  surface: LarkPlatformWebhookSurface;
}): Promise<LarkPlatformWebhookVerificationResponse | null> {
  const connectionId = input.c.req.param("connectionId");
  try {
    const verification =
      await input.c.env.OPENMELD_CORE_WORKER.verifyLarkPlatformWebhook({
        connectionId,
        gatewayRequestId: input.gatewayRequestId,
        headers: {
          nonce:
            normalizeOptionalText(input.c.req.header("x-lark-request-nonce")) ??
            null,
          signature:
            normalizeOptionalText(input.c.req.header("x-lark-signature")) ??
            null,
          timestamp:
            normalizeOptionalText(
              input.c.req.header("x-lark-request-timestamp")
            ) ?? null,
        },
        provider: input.provider,
        rawBody: input.rawBody,
        receivedAtMs: input.receivedAtMs,
        surface: input.surface,
      });
    const parsed =
      larkPlatformWebhookVerificationResponseSchema.safeParse(verification);
    if (parsed.success) {
      return parsed.data;
    }
    console.error("[gateway.message_channel.webhook.verify_response_invalid]", {
      connectionId,
      gatewayRequestId: input.gatewayRequestId,
      provider: input.provider,
      surface: input.surface,
    });
  } catch (error) {
    console.warn("[gateway.message_channel.webhook.verify_failed]", {
      connectionId,
      error: toErrorMessage(error),
      gatewayRequestId: input.gatewayRequestId,
      provider: input.provider,
      surface: input.surface,
    });
  }
  return null;
}

function respondToLarkPlatformWebhookVerification(input: {
  c: LarkPlatformWebhookContext;
  gatewayRequestId: string;
  provider: LarkPlatformProvider;
  receivedAtMs: number;
  surface: LarkPlatformWebhookSurface;
  verification: LarkPlatformWebhookVerificationResponse;
}): Promise<Response> | Response {
  if (input.verification.status === "challenge") {
    return input.c.json({ challenge: input.verification.challenge });
  }
  if (input.verification.status === "rejected") {
    logWebhookDisposition("rejected", input, input.verification.reasonCode);
    return input.c.text("Provider request rejected", 401);
  }
  if (input.verification.status === "ignored") {
    logWebhookDisposition("ignored", input, input.verification.reasonCode);
    return input.c.json({ ok: true });
  }
  return enqueueVerifiedLarkPlatformEvent({
    ...input,
    envelope: input.verification.envelope,
  });
}

async function enqueueVerifiedLarkPlatformEvent(input: {
  c: LarkPlatformWebhookContext;
  envelope: Extract<
    LarkPlatformWebhookVerificationResponse,
    { status: "enqueue" }
  >["envelope"];
  gatewayRequestId: string;
  provider: LarkPlatformProvider;
  receivedAtMs: number;
  surface: LarkPlatformWebhookSurface;
}): Promise<Response> {
  const queue = input.c.env.OPENMELD_REMOTE_AGENT_MESSAGE_CHANNEL_EVENTS_QUEUE;
  if (!queue) {
    console.warn("[gateway.message_channel.webhook.queue_unavailable]", {
      connectionId: input.c.req.param("connectionId"),
      gatewayRequestId: input.gatewayRequestId,
      provider: input.provider,
      providerEventId: input.envelope.providerEventId,
      surface: input.surface,
    });
    return input.c.text("Message Channel event queue unavailable", 503);
  }
  try {
    await queue.send(input.envelope);
  } catch (error) {
    console.warn("[gateway.message_channel.webhook.enqueue_failed]", {
      connectionId: input.c.req.param("connectionId"),
      error: toErrorMessage(error),
      gatewayRequestId: input.gatewayRequestId,
      provider: input.provider,
      providerEventId: input.envelope.providerEventId,
      surface: input.surface,
    });
    return input.c.text("Message Channel event enqueue failed", 503);
  }
  console.info("[gateway.message_channel.webhook.enqueued]", {
    ackLatencyMs: Date.now() - input.receivedAtMs,
    connectionId: input.c.req.param("connectionId"),
    gatewayRequestId: input.gatewayRequestId,
    provider: input.provider,
    providerEventId: input.envelope.providerEventId,
    surface: input.surface,
  });
  return input.c.json({ ok: true });
}

function logWebhookDisposition(
  disposition: "ignored" | "rejected",
  input: {
    c: LarkPlatformWebhookContext;
    gatewayRequestId: string;
    provider: LarkPlatformProvider;
    surface: LarkPlatformWebhookSurface;
  },
  reasonCode: string
): void {
  const details = {
    connectionId: input.c.req.param("connectionId"),
    gatewayRequestId: input.gatewayRequestId,
    provider: input.provider,
    reasonCode,
    surface: input.surface,
  };
  if (disposition === "rejected") {
    console.warn("[gateway.message_channel.webhook.rejected]", details);
  } else {
    console.info("[gateway.message_channel.webhook.ignored]", details);
  }
}

function normalizeOptionalText(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
