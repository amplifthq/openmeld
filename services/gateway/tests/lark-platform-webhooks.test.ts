import {
  LARK_PLATFORM_WEBHOOK_RAW_BODY_MAX_BYTES,
  messageChannelIngressEnvelopeSchema,
} from "@openmeld/schemas";
import { describe, expect, it, vi } from "vitest";
import app from "../src/index";

type CoreRpcMock = {
  verifyLarkPlatformWebhook: ReturnType<typeof vi.fn>;
};

type MessageChannelEventQueueMock = {
  send: ReturnType<typeof vi.fn>;
};

describe("Lark-platform Webhook routes", () => {
  it("returns a verified provider challenge without enqueueing it", async () => {
    const { coreRpc, env, queue } = buildEnv({
      verification: { challenge: "provider-challenge", status: "challenge" },
    });

    const response = await app.fetch(
      buildRequest({
        body: JSON.stringify({
          challenge: "provider-challenge",
          token: "verification-token",
          type: "url_verification",
        }),
        path: "/message-channels/lark/connection_lark/events",
      }),
      env,
      createExecutionContext()
    );

    await expect(response.json()).resolves.toEqual({
      challenge: "provider-challenge",
    });
    expect(response.status).toBe(200);
    expect(coreRpc.verifyLarkPlatformWebhook).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: "connection_lark",
        headers: {
          nonce: "nonce-1",
          signature: "signature-1",
          timestamp: "1710000000",
        },
        provider: "lark",
        surface: "events",
      })
    );
    expect(queue.send).not.toHaveBeenCalled();
  });

  it("acks a verified Feishu event only after its normalized envelope is durably queued", async () => {
    const envelope = messageChannelIngressEnvelopeSchema.parse({
      connectionId: "connection_feishu",
      event: {
        kind: "message",
        locator: {
          appId: "cli_feishu",
          chatId: "oc_chat",
          connectionId: "connection_feishu",
          provider: "feishu",
          rootMessageId: "om_root",
          tenantKey: "tenant_feishu",
          threadId: null,
        },
        mention: "direct_message",
        messageId: "om_message",
        resources: [],
        senderId: "ou_sender",
        sentAtMs: 1_710_000_000_000,
        text: "Summarize the launch plan.",
      },
      gatewayRequestId: "gateway_request_core",
      kind: "remote_agent_message_channel_event",
      provider: "feishu",
      providerEventId: "evt_feishu",
      receivedAtMs: 1_710_000_000_100,
      v: 1,
    });
    const enqueue = createDeferred<void>();
    const { env, queue } = buildEnv({
      queueSend: vi.fn(() => enqueue.promise),
      verification: { envelope, status: "enqueue" },
    });
    const responsePromise = Promise.resolve(
      app.fetch(
        buildRequest({
          body: JSON.stringify({ encrypt: "encrypted-provider-payload" }),
          path: "/message-channels/feishu/connection_feishu/events",
        }),
        env,
        createExecutionContext()
      )
    );

    await vi.waitFor(() => {
      expect(queue.send).toHaveBeenCalledWith(envelope);
    });
    expect(
      await Promise.race([
        responsePromise.then(() => "resolved"),
        Promise.resolve("pending"),
      ])
    ).toBe("pending");

    enqueue.resolve(undefined);
    const response = await responsePromise;
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(response.status).toBe(200);
  });

  it("fails closed when Core rejects the provider request", async () => {
    const { env, queue } = buildEnv({
      verification: {
        reasonCode: "message_channel.webhook_signature_invalid",
        status: "rejected",
      },
    });

    const response = await app.fetch(
      buildRequest({
        body: JSON.stringify({ encrypt: "invalid-provider-payload" }),
        path: "/message-channels/lark/connection_lark/events",
      }),
      env,
      createExecutionContext()
    );

    expect(response.status).toBe(401);
    expect(queue.send).not.toHaveBeenCalled();
  });

  it("acks a card callback only after its normalized action is durably queued", async () => {
    const envelope = messageChannelIngressEnvelopeSchema.parse({
      connectionId: "connection_lark",
      event: {
        actionId: "card_action_1",
        actionName: "openmeld.center_agent.submit",
        actionValue: "Continue with the launch plan.",
        kind: "card_action",
        locator: {
          appId: "cli_lark",
          chatId: "oc_chat",
          connectionId: "connection_lark",
          provider: "lark",
          rootMessageId: "om_card",
          tenantKey: "tenant_lark",
          threadId: null,
        },
        occurredAtMs: 1_710_000_004_000,
        senderId: "ou_sender",
      },
      gatewayRequestId: "gateway_card_action",
      kind: "remote_agent_message_channel_event",
      provider: "lark",
      providerEventId: "evt_card_action",
      receivedAtMs: 1_710_000_004_100,
      v: 1,
    });
    const enqueue = createDeferred<void>();
    const { env, queue } = buildEnv({
      queueSend: vi.fn(() => enqueue.promise),
      verification: { envelope, status: "enqueue" },
    });
    const responsePromise = Promise.resolve(
      app.fetch(
        buildRequest({
          body: JSON.stringify({ event: "verified-card-action" }),
          path: "/message-channels/lark/connection_lark/callbacks",
        }),
        env,
        createExecutionContext()
      )
    );

    await vi.waitFor(() => {
      expect(queue.send).toHaveBeenCalledWith(envelope);
    });
    expect(
      await Promise.race([
        responsePromise.then(() => "resolved"),
        Promise.resolve("pending"),
      ])
    ).toBe("pending");

    enqueue.resolve(undefined);
    const response = await responsePromise;
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(response.status).toBe(200);
  });

  it("rejects an oversized provider body before calling Core", async () => {
    const { coreRpc, env } = buildEnv();
    const response = await app.fetch(
      buildRequest({
        body: JSON.stringify({
          value: "x".repeat(LARK_PLATFORM_WEBHOOK_RAW_BODY_MAX_BYTES),
        }),
        path: "/message-channels/lark/connection_lark/events",
      }),
      env,
      createExecutionContext()
    );

    expect(response.status).toBe(413);
    expect(coreRpc.verifyLarkPlatformWebhook).not.toHaveBeenCalled();
  });
});

function buildEnv(
  input: {
    queueSend?: MessageChannelEventQueueMock["send"];
    verification?: unknown;
  } = {}
): {
  coreRpc: CoreRpcMock;
  env: CloudflareBindings;
  queue: MessageChannelEventQueueMock;
} {
  const coreRpc: CoreRpcMock = {
    verifyLarkPlatformWebhook: vi.fn(() =>
      Promise.resolve(
        input.verification ?? {
          reasonCode: "message_channel.webhook_event_unsupported",
          status: "ignored",
        }
      )
    ),
  };
  const queue = {
    send: input.queueSend ?? vi.fn(async () => undefined),
  };
  return {
    coreRpc,
    env: {
      OPENMELD_CORE_WORKER: coreRpc,
      OPENMELD_REMOTE_AGENT_MESSAGE_CHANNEL_EVENTS_QUEUE: queue,
    } as unknown as CloudflareBindings,
    queue,
  };
}

function buildRequest(input: { body: string; path: string }): Request {
  return new Request(`http://local${input.path}`, {
    body: input.body,
    headers: {
      "content-type": "application/json",
      "x-lark-request-nonce": "nonce-1",
      "x-lark-request-timestamp": "1710000000",
      "x-lark-signature": "signature-1",
    },
    method: "POST",
  });
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

function createExecutionContext(): ExecutionContext {
  return {
    exports: {},
    passThroughOnException: () => undefined,
    props: {},
    waitUntil: () => undefined,
  } as unknown as ExecutionContext;
}
