import { describe, expect, it, vi } from "vitest";
import { verifyGitHubAppWebhook } from "../src/space/application/github-app-webhook-service";

const SECRET = "It's a Secret to Everybody";
const GATEWAY_REQUEST_ID = "11111111-1111-4111-8111-111111111111";

const closedBody = JSON.stringify({
  action: "closed",
  issue: {
    html_url: "https://github.com/amplifthq/openmeld/issues/1143",
    number: 1143,
    state: "closed",
    updated_at: "2026-09-20T12:00:00Z",
  },
  repository: {
    name: "openmeld",
    owner: { login: "amplifthq" },
  },
});

async function sign(rawBody: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SECRET),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(rawBody)
  );
  return `sha256=${[...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

describe("GitHub App webhook verification", () => {
  it("accepts ping, enqueues closed issues, and ignores uninteresting signed events", async () => {
    const send = vi.fn<(...args: Parameters<Queue["send"]>) => Promise<void>>(
      async () => undefined
    );
    const env = {
      GITHUB_OPENMELD_WEBHOOK_SECRET: SECRET,
      OPENMELD_DAEMON_DISPATCH_QUEUE: {
        metrics: async () => ({ backlogBytes: 0, backlogCount: 0 }),
        send: async (...args: Parameters<Queue["send"]>) => {
          await send(...args);
          return {
            metadata: { metrics: { backlogBytes: 0, backlogCount: 0 } },
          };
        },
        sendBatch: async () => ({
          metadata: { metrics: { backlogBytes: 0, backlogCount: 0 } },
        }),
      },
    };

    await expect(
      verifyGitHubAppWebhook({
        env,
        input: {
          gatewayRequestId: GATEWAY_REQUEST_ID,
          headers: {
            deliveryId: "delivery-ping",
            event: "ping",
            signature256: await sign("{}"),
          },
          rawBody: "{}",
          receivedAtMs: 1,
        },
      })
    ).resolves.toEqual({ reasonCode: null, status: "accepted" });
    expect(send).not.toHaveBeenCalled();

    const closed = await verifyGitHubAppWebhook({
      env,
      input: {
        gatewayRequestId: GATEWAY_REQUEST_ID,
        headers: {
          deliveryId: "delivery-closed",
          event: "issues",
          signature256: await sign(closedBody),
        },
        rawBody: closedBody,
        receivedAtMs: 2,
      },
    });
    expect(closed).toEqual({ reasonCode: null, status: "accepted" });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryId: "delivery-closed",
        event: "issues",
        issue: expect.objectContaining({
          number: 1143,
          state: "closed",
        }),
        kind: "github_app_webhook",
        v: 1,
      })
    );

    send.mockClear();
    const openedBody = closedBody.replaceAll('"closed"', '"opened"');
    await expect(
      verifyGitHubAppWebhook({
        env,
        input: {
          gatewayRequestId: GATEWAY_REQUEST_ID,
          headers: {
            deliveryId: "delivery-opened",
            event: "issues",
            signature256: await sign(openedBody),
          },
          rawBody: openedBody,
          receivedAtMs: 3,
        },
      })
    ).resolves.toEqual({ reasonCode: null, status: "ignored" });
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects a missing signature and a missing queue for interesting events", async () => {
    await expect(
      verifyGitHubAppWebhook({
        env: { GITHUB_OPENMELD_WEBHOOK_SECRET: SECRET },
        input: {
          gatewayRequestId: GATEWAY_REQUEST_ID,
          headers: {
            deliveryId: "delivery-closed",
            event: "issues",
            signature256: "sha256=deadbeef",
          },
          rawBody: closedBody,
          receivedAtMs: 1,
        },
      })
    ).resolves.toEqual({
      reasonCode: "github.webhook_signature_invalid",
      status: "rejected",
    });

    await expect(
      verifyGitHubAppWebhook({
        env: { GITHUB_OPENMELD_WEBHOOK_SECRET: SECRET },
        input: {
          gatewayRequestId: GATEWAY_REQUEST_ID,
          headers: {
            deliveryId: "delivery-closed",
            event: "issues",
            signature256: await sign(closedBody),
          },
          rawBody: closedBody,
          receivedAtMs: 1,
        },
      })
    ).resolves.toEqual({
      reasonCode: "github.webhook_queue_unavailable",
      status: "rejected",
    });
  });
});
