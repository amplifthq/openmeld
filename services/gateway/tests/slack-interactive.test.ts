import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import app from "../src/index";

const SIGNING_SECRET = "slack-signing-secret";
const TEST_EXECUTION_CONTEXT = {
  exports: {},
  passThroughOnException: () => undefined,
  props: {},
  waitUntil: () => undefined,
} as unknown as ExecutionContext;

describe("Slack interactivity route", () => {
  it("rejects invalid Slack signatures", async () => {
    const body = buildInteractiveBody();
    const response = await app.fetch(
      buildSlackInteractiveRequest(body, { signature: "v0=wrong" }),
      buildEnv(),
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(401);
  });

  it("acknowledges a signed form-encoded interaction without processing it", async () => {
    const body = buildInteractiveBody();
    const response = await app.fetch(
      buildSlackInteractiveRequest(body),
      buildEnv(),
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("");
  });
});

function buildEnv(): CloudflareBindings {
  return {
    SLACK_OPENMELD_SIGNING_SECRET: SIGNING_SECRET,
  } as unknown as CloudflareBindings;
}

function buildInteractiveBody(): string {
  return new URLSearchParams({
    payload: JSON.stringify({
      actions: [
        {
          action_id: "link_openmeld_account",
          type: "button",
          url: "https://openmeld.ai/link-slack?token=slacklink_test",
        },
      ],
      type: "block_actions",
    }),
  }).toString();
}

function buildSlackInteractiveRequest(
  body: string,
  input: { signature?: string; timestamp?: number } = {}
): Request {
  const timestamp = input.timestamp ?? Math.floor(Date.now() / 1000);
  const signature =
    input.signature ??
    signSlackBody({ body, secret: SIGNING_SECRET, timestamp });
  return new Request("http://local/slack/interactive", {
    body,
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-slack-request-timestamp": String(timestamp),
      "x-slack-signature": signature,
    },
    method: "POST",
  });
}

function signSlackBody(input: {
  body: string;
  secret: string;
  timestamp: number;
}): string {
  const baseString = `v0:${input.timestamp}:${input.body}`;
  return `v0=${createHmac("sha256", input.secret)
    .update(baseString)
    .digest("hex")}`;
}
