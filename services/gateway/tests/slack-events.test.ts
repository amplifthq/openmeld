import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import app from "../src/index";

const SIGNING_SECRET = "slack-signing-secret";

type CoreRpcMock = {
  handleRemoteAgentSlackEvent: ReturnType<typeof vi.fn>;
};

type SlackEventQueueMock = {
  send: ReturnType<typeof vi.fn>;
};

describe("Slack events route", () => {
  it("echoes url_verification challenge after Slack signature verification", async () => {
    const body = JSON.stringify({
      token: "verification-token",
      challenge: "challenge-plain-text",
      type: "url_verification",
    });

    const response = await app.fetch(
      buildSlackRequest(body),
      buildEnv().env,
      createExecutionContext()
    );

    await expect(response.text()).resolves.toBe("challenge-plain-text");
    expect(response.status).toBe(200);
  });

  it("rejects invalid Slack signatures", async () => {
    const body = JSON.stringify(createAppMentionPayload());
    const request = buildSlackRequest(body, {
      signature: "v0=wrong",
    });

    const response = await app.fetch(
      request,
      buildEnv().env,
      createExecutionContext()
    );

    expect(response.status).toBe(401);
  });

  it("rejects expired Slack timestamps to prevent replay", async () => {
    const body = JSON.stringify(createAppMentionPayload());
    const response = await app.fetch(
      buildSlackRequest(body, { timestamp: 1 }),
      buildEnv().env,
      createExecutionContext()
    );

    expect(response.status).toBe(401);
  });

  it("acks app_mention events only after durable enqueue and preserves Slack retry evidence", async () => {
    const payload = createAppMentionPayload();
    const body = JSON.stringify(payload);
    const enqueue = createDeferred<void>();
    const { coreRpc, env, slackEventQueue } = buildEnv({
      queueSend: vi.fn(() => enqueue.promise),
    });
    const executionContext = createExecutionContext();

    const responsePromise = Promise.resolve(
      app.fetch(buildSlackRequest(body), env, executionContext)
    );

    await vi.waitFor(() => {
      expect(slackEventQueue.send).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "remote_agent_slack_event",
          payload: expect.objectContaining({ event_id: "Ev123" }),
          slackRetryNum: 1,
          slackRetryReason: "http_timeout",
          v: 1,
        })
      );
    });
    expect(
      await Promise.race([
        responsePromise.then(() => "resolved"),
        Promise.resolve("pending"),
      ])
    ).toBe("pending");

    enqueue.resolve(undefined);
    const response = await responsePromise;

    await expect(response.text()).resolves.toBe("OK");
    expect(response.status).toBe(200);
    expect(coreRpc.handleRemoteAgentSlackEvent).not.toHaveBeenCalled();
  });
});

function buildEnv(input: { queueSend?: SlackEventQueueMock["send"] } = {}): {
  coreRpc: CoreRpcMock;
  env: CloudflareBindings;
  slackEventQueue: SlackEventQueueMock;
} {
  const coreRpc: CoreRpcMock = {
    handleRemoteAgentSlackEvent: vi.fn(async () => ({ status: "processed" })),
  };
  const slackEventQueue: SlackEventQueueMock = {
    send: input.queueSend ?? vi.fn(async () => undefined),
  };
  return {
    coreRpc,
    slackEventQueue,
    env: {
      OPENMELD_CORE_WORKER: coreRpc,
      OPENMELD_REMOTE_AGENT_SLACK_EVENTS_QUEUE: slackEventQueue,
      SLACK_OPENMELD_SIGNING_SECRET: SIGNING_SECRET,
    } as unknown as CloudflareBindings,
  };
}

function buildSlackRequest(
  body: string,
  input: { signature?: string; timestamp?: number } = {}
): Request {
  const timestamp = input.timestamp ?? Math.floor(Date.now() / 1000);
  const signature =
    input.signature ??
    signSlackBody({ body, secret: SIGNING_SECRET, timestamp });
  return new Request("http://local/slack/events", {
    body,
    headers: {
      "content-type": "application/json",
      "x-slack-request-timestamp": String(timestamp),
      "x-slack-signature": signature,
      "x-slack-retry-num": "1",
      "x-slack-retry-reason": "http_timeout",
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

function createAppMentionPayload() {
  return {
    token: "verification-token",
    type: "event_callback",
    team_id: "T123",
    api_app_id: "A123",
    event_id: "Ev123",
    event_time: 1_710_000_000,
    event: {
      type: "app_mention",
      user: "U123",
      text: "<@B123> create a Codex agent",
      ts: "1710000000.000100",
      channel: "C123",
      event_ts: "1710000000.000100",
    },
  };
}

function createExecutionContext(): ExecutionContext & {
  flushWaitUntil: () => Promise<void>;
} {
  const waitUntilPromises: Promise<unknown>[] = [];
  return {
    exports: {},
    flushWaitUntil: () => Promise.all(waitUntilPromises).then(() => undefined),
    passThroughOnException: () => undefined,
    props: {},
    waitUntil: (promise) => {
      waitUntilPromises.push(promise);
    },
  } as ExecutionContext & { flushWaitUntil: () => Promise<void> };
}
