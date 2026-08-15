import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
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

  it("opens the teammate picker for the trust-first welcome action", async () => {
    const handleSlackWelcomeInteraction = vi.fn(async () => ({
      handled: true,
    }));
    const body = buildInteractiveBody({ actionId: "invite_teammates" });
    const response = await app.fetch(
      buildSlackInteractiveRequest(body),
      buildEnv(handleSlackWelcomeInteraction),
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    expect(handleSlackWelcomeInteraction).toHaveBeenCalledWith({
      action: "open_teammate_invite_modal",
      slackTeamId: "T123",
      slackUserId: "U_INSTALLER",
      triggerId: "trigger-1",
    });
  });

  it("acks a teammate selection and hands it to Core once", async () => {
    const handleSlackWelcomeInteraction = vi.fn(async () => ({
      handled: true,
    }));
    const body = new URLSearchParams({
      payload: JSON.stringify({
        team: { id: "T123" },
        type: "view_submission",
        user: { id: "U_INSTALLER" },
        view: {
          callback_id: "openmeld_invite_teammates",
          id: "V123",
          state: {
            values: {
              teammates: {
                selected_teammates: {
                  selected_users: ["U_MAYA", "U_ALEX"],
                },
              },
            },
          },
        },
      }),
    }).toString();
    const response = await app.fetch(
      buildSlackInteractiveRequest(body),
      buildEnv(handleSlackWelcomeInteraction),
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    expect(handleSlackWelcomeInteraction).toHaveBeenCalledWith({
      action: "submit_teammate_invites",
      interactionId: "V123",
      slackTeamId: "T123",
      slackUserId: "U_INSTALLER",
      targetSlackUserIds: ["U_MAYA", "U_ALEX"],
    });
  });

  it("keeps an acknowledged teammate submission failure observable", async () => {
    const waitUntilPromises: Promise<unknown>[] = [];
    const executionContext = {
      ...TEST_EXECUTION_CONTEXT,
      waitUntil: (promise: Promise<unknown>) => {
        waitUntilPromises.push(promise);
      },
    } as unknown as ExecutionContext;
    const handleSlackWelcomeInteraction = vi.fn(() =>
      Promise.reject(new Error("Core unavailable"))
    );
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const body = new URLSearchParams({
      payload: JSON.stringify({
        team: { id: "T123" },
        type: "view_submission",
        user: { id: "U_INSTALLER" },
        view: {
          callback_id: "openmeld_invite_teammates",
          id: "V123",
          state: {
            values: {
              teammates: {
                selected_teammates: { selected_users: ["U_MAYA"] },
              },
            },
          },
        },
      }),
    }).toString();

    const response = await app.fetch(
      buildSlackInteractiveRequest(body),
      buildEnv(handleSlackWelcomeInteraction),
      executionContext
    );
    await Promise.all(waitUntilPromises);

    expect(response.status).toBe(200);
    expect(errorSpy).toHaveBeenCalledWith(
      "[gateway.slack_interaction.core_failed]",
      expect.objectContaining({
        action: "submit_teammate_invites",
        error: "Core unavailable",
        slackTeamId: "T123",
        slackUserId: "U_INSTALLER",
      })
    );
  });

  it("opens the channel picker for the trust-first welcome action", async () => {
    const handleSlackWelcomeInteraction = vi.fn(async () => ({
      handled: true,
    }));
    const body = buildInteractiveBody({
      actionId: "start_channel_introduction",
    });
    const response = await app.fetch(
      buildSlackInteractiveRequest(body),
      buildEnv(handleSlackWelcomeInteraction),
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    expect(handleSlackWelcomeInteraction).toHaveBeenCalledWith({
      action: "open_channel_introduction_modal",
      slackTeamId: "T123",
      slackUserId: "U_INSTALLER",
      triggerId: "trigger-1",
    });
  });

  it("acks selected channels and starts one contextual introduction run", async () => {
    const handleSlackWelcomeInteraction = vi.fn(async () => ({
      handled: true,
    }));
    const body = new URLSearchParams({
      payload: JSON.stringify({
        team: { id: "T123" },
        type: "view_submission",
        user: { id: "U_INSTALLER" },
        view: {
          callback_id: "openmeld_introduce_in_channels",
          id: "V_CHANNELS",
          state: {
            values: {
              channels: {
                selected_channels: {
                  selected_channels: ["C_PRODUCT", "C_DESIGN"],
                },
              },
            },
          },
        },
      }),
    }).toString();
    const response = await app.fetch(
      buildSlackInteractiveRequest(body),
      buildEnv(handleSlackWelcomeInteraction),
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(200);
    expect(handleSlackWelcomeInteraction).toHaveBeenCalledWith({
      action: "submit_channel_introductions",
      interactionId: "V_CHANNELS",
      slackTeamId: "T123",
      slackUserId: "U_INSTALLER",
      targetSlackChannelIds: ["C_PRODUCT", "C_DESIGN"],
    });
  });
});

function buildEnv(
  handleSlackWelcomeInteraction = vi.fn(async () => ({ handled: true }))
): CloudflareBindings {
  return {
    OPENMELD_CORE_WORKER: { handleSlackWelcomeInteraction },
    SLACK_OPENMELD_SIGNING_SECRET: SIGNING_SECRET,
  } as unknown as CloudflareBindings;
}

function buildInteractiveBody(input: { actionId?: string } = {}): string {
  return new URLSearchParams({
    payload: JSON.stringify({
      actions: [
        {
          action_id: input.actionId ?? "link_openmeld_account",
          type: "button",
          url: "https://openmeld.ai/link-slack?token=slacklink_test",
        },
      ],
      team: { id: "T123" },
      trigger_id: "trigger-1",
      type: "block_actions",
      user: { id: "U_INSTALLER" },
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
