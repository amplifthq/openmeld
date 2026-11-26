import type {
  ClassifyUnaddressedChannelBatchInput,
  NormalizedMessageChannelEvent,
  UnaddressedChannelBatchQueueMessage,
  UnaddressedChannelBatchRoute,
} from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import { submitUnaddressedLarkPlatformRequest } from "../src/remote-agent/application/lark-platform-unaddressed-request-service";
import {
  flushUnaddressedChannelBatch,
  isUnaddressedChannelIntakeEnabledForConversation,
  observeUnaddressedLarkPlatformMessage,
  settleUnaddressedChannelMessagesAnsweredByMention,
  UNADDRESSED_CHANNEL_MAX_PENDING_AGE_MS,
  UNADDRESSED_CHANNEL_MAX_WAIT_MS,
  UNADDRESSED_CHANNEL_QUIET_WINDOW_MS,
  type UnaddressedChannelBatchRequest,
  type UnaddressedChannelIntakeDependencies,
} from "../src/remote-agent/application/message-channel-unaddressed-intake-service";
import {
  observeUnaddressedSlackChannelMessage,
  settleUnaddressedSlackMessagesForMention,
  submitUnaddressedSlackRequest,
} from "../src/remote-agent/application/slack-unaddressed-message-service";
import type { RemoteAgentLarkPlatformChannelConnectionRecord } from "../src/remote-agent/infrastructure/postgresql/lark-platform-channel-connection-repo";
import {
  claimDueUnaddressedChannelBatch,
  expireStaleUnaddressedChannelMessages,
  listUnaddressedChannelMessages,
  recordUnaddressedChannelMessage,
  releaseUnaddressedChannelBatch,
  settleUnaddressedChannelBatch,
} from "../src/remote-agent/infrastructure/postgresql/message-channel-unaddressed-message-repo";
import { handleUnaddressedChannelBatchQueueMessage } from "../src/remote-agent/transport/queue/message-channel-unaddressed-batch-queue-consumer";
import { createPostgresHarness } from "./helpers/postgresql-harness.test-support";

type MessageEvent = Extract<NormalizedMessageChannelEvent, { kind: "message" }>;
type Harness = Awaited<ReturnType<typeof createPostgresHarness>>;

const CHAT_ID = "oc_chat_1";
const ROOT_ID = "om_root_1";
const START_MS = 1_000_000;
const SLACK_TEAM_ID = "T123";
const SLACK_CHANNEL_ID = "C123";
const SLACK_BOT_USER_ID = "U0BOT";
const SLACK_CONNECTION_GENERATION = START_MS - 1000;
const ARI_THREAD_BATCH = `thread:${ROOT_ID}:sender:ou_ari`;
const BO_THREAD_BATCH = `thread:${ROOT_ID}:sender:ou_bo`;

describe("unaddressed Channel message intake", () => {
  it("keeps each sender's replies in a thread as their own batch, so a bystander's reply never becomes the request", async () => {
    const fixture = await createFixture({ route: "new_request" });
    fixture.classifyBatch.mockImplementation((request) =>
      Promise.resolve(
        request.messages.every((message) => message.text === "Same for me")
          ? "chatter"
          : "new_request"
      )
    );
    try {
      await fixture.observe({
        id: "om_1",
        sender: "ou_ari",
        text: "Login is broken",
        atMs: START_MS,
      });
      await fixture.observe({
        id: "om_2",
        sender: "ou_bo",
        text: "Same for me",
        atMs: START_MS + 2000,
      });
      await fixture.observe({
        id: "om_3",
        sender: "ou_ari",
        text: "It fails after the SSO redirect",
        atMs: START_MS + 4000,
      });

      // Ari's first flush arrives while Ari is still typing.
      await expect(
        fixture.flush({
          scheduledBy: START_MS,
          atMs: START_MS + UNADDRESSED_CHANNEL_QUIET_WINDOW_MS,
        })
      ).resolves.toEqual({ status: "superseded" });

      const ariLastObservedAtMs = START_MS + 4000;
      await expect(
        fixture.flush({
          scheduledBy: ariLastObservedAtMs,
          atMs: ariLastObservedAtMs + UNADDRESSED_CHANNEL_QUIET_WINDOW_MS,
        })
      ).resolves.toMatchObject({
        deliveryId: "delivery_1",
        route: "new_request",
        status: "routed",
      });
      expect(
        fixture.classifyBatch.mock.calls[0]?.[0].messages.map(
          (message) => message.messageId
        )
      ).toEqual(["om_1", "om_3"]);
      expect(fixture.submitRequest).toHaveBeenCalledOnce();
      expect(fixture.submitRequest.mock.calls[0]?.[0]).toMatchObject({
        requestEventId: "unaddressed-batch:om_3",
        text: "Login is broken\nIt fails after the SSO redirect",
        trigger: {
          batchKey: ARI_THREAD_BATCH,
          conversationKey: CHAT_ID,
          messageId: "om_3",
          rootMessageId: ROOT_ID,
          senderId: "ou_ari",
        },
      });

      // Bo's reply is its own batch: it is classified alone and, as chatter,
      // starts nothing under Bo's identity.
      await expect(
        fixture.flush({
          batchKey: BO_THREAD_BATCH,
          scheduledBy: START_MS + 2000,
          atMs: START_MS + 2000 + UNADDRESSED_CHANNEL_QUIET_WINDOW_MS,
        })
      ).resolves.toMatchObject({ route: "chatter", status: "archived" });
      expect(
        fixture.classifyBatch.mock.calls[1]?.[0].messages.map(
          (message) => message.messageId
        )
      ).toEqual(["om_2"]);
      expect(fixture.submitRequest).toHaveBeenCalledOnce();
      await expect(fixture.states()).resolves.toEqual([
        { id: "om_1", route: "new_request", state: "routed" },
        { id: "om_2", route: "chatter", state: "archived" },
        { id: "om_3", route: "new_request", state: "routed" },
      ]);

      // A flush that arrives after the batch was routed finds nothing to do.
      await expect(
        fixture.flush({ scheduledBy: START_MS, atMs: START_MS + 60_000 })
      ).resolves.toEqual({ status: "empty" });
      expect(fixture.submitRequest).toHaveBeenCalledOnce();
    } finally {
      await fixture.close();
    }
  });

  it("lets a mention in a thread settle that thread's waiting messages so they start no second turn", async () => {
    const fixture = await createFixture({ route: "new_request" });
    try {
      await fixture.observe({
        id: "om_1",
        sender: "ou_ari",
        text: "Staging deploy returns 502",
        atMs: START_MS,
      });
      await fixture.observe({
        id: "om_2",
        sender: "ou_bo",
        text: "Seeing it too",
        atMs: START_MS + 1000,
      });

      await expect(
        settleUnaddressedChannelMessagesAnsweredByMention({
          connectionId: "connection_feishu_1",
          conversationKey: CHAT_ID,
          db: fixture.db,
          messageId: "om_mention",
          nowMs: START_MS + 3000,
          provider: "feishu",
          rootMessageId: ROOT_ID,
          senderId: "ou_ari",
          sentAtMs: START_MS + 3000,
        })
      ).resolves.toBe(2);
      // A message sent after the mention is new input and keeps waiting.
      await fixture.observe({
        id: "om_4",
        sender: "ou_ari",
        text: "Thanks!",
        atMs: START_MS + 5000,
      });

      await expect(fixture.states()).resolves.toEqual([
        { id: "om_1", route: "addressed", state: "archived" },
        { id: "om_2", route: "addressed", state: "archived" },
        { id: "om_4", route: null, state: "pending" },
      ]);
      await expect(
        fixture.flush({
          scheduledBy: START_MS + 5000,
          atMs: START_MS + 5000 + UNADDRESSED_CHANNEL_QUIET_WINDOW_MS,
        })
      ).resolves.toMatchObject({ status: "routed" });
      expect(
        fixture.classifyBatch.mock.calls[0]?.[0].messages.map(
          (message) => message.messageId
        )
      ).toEqual(["om_4"]);
    } finally {
      await fixture.close();
    }
  });

  it("lets a top-level mention settle only the same sender's waiting top-level messages", async () => {
    const fixture = await createFixture({ route: "new_request" });
    try {
      await fixture.observe({
        id: "om_ari_top",
        rootMessageId: "om_ari_top",
        sender: "ou_ari",
        text: "Staging deploy returns 502",
        atMs: START_MS,
      });
      await fixture.observe({
        id: "om_bo_top",
        rootMessageId: "om_bo_top",
        sender: "ou_bo",
        text: "Who has the release notes?",
        atMs: START_MS + 500,
      });

      await expect(
        settleUnaddressedChannelMessagesAnsweredByMention({
          connectionId: "connection_feishu_1",
          conversationKey: CHAT_ID,
          db: fixture.db,
          messageId: "om_ari_mention",
          nowMs: START_MS + 2000,
          provider: "feishu",
          rootMessageId: "om_ari_mention",
          senderId: "ou_ari",
          sentAtMs: START_MS + 2000,
        })
      ).resolves.toBe(1);
      await expect(fixture.states()).resolves.toEqual([
        { id: "om_ari_top", route: "addressed", state: "archived" },
        { id: "om_bo_top", route: null, state: "pending" },
      ]);
      await expect(
        fixture.flush({
          batchKey: "sender:ou_ari",
          scheduledBy: START_MS,
          atMs: START_MS + UNADDRESSED_CHANNEL_QUIET_WINDOW_MS,
        })
      ).resolves.toEqual({ status: "empty" });
      expect(fixture.submitRequest).not.toHaveBeenCalled();
    } finally {
      await fixture.close();
    }
  });

  it("expires messages left waiting past the pending age limit instead of routing them", async () => {
    const fixture = await createFixture({ route: "new_request" });
    try {
      // Intake was turned off before this message's flush ran, so it was
      // never routed.
      await fixture.observe({
        id: "om_old",
        sender: "ou_ari",
        text: "Delete the old preview deploys",
        atMs: START_MS,
      });
      const laterMs =
        START_MS + UNADDRESSED_CHANNEL_MAX_PENDING_AGE_MS + 60_000;
      await fixture.observe({
        id: "om_new",
        sender: "ou_ari",
        text: "Can someone check the staging logs?",
        atMs: laterMs,
      });

      await expect(
        fixture.flush({
          scheduledBy: laterMs,
          atMs: laterMs + UNADDRESSED_CHANNEL_QUIET_WINDOW_MS,
        })
      ).resolves.toMatchObject({ status: "routed" });
      expect(
        fixture.classifyBatch.mock.calls[0]?.[0].messages.map(
          (message) => message.messageId
        )
      ).toEqual(["om_new"]);
      expect(fixture.submitRequest.mock.calls[0]?.[0].text).toBe(
        "Can someone check the staging logs?"
      );
      await expect(fixture.states()).resolves.toEqual([
        { id: "om_old", route: "expired", state: "archived" },
        { id: "om_new", route: "new_request", state: "routed" },
      ]);
    } finally {
      await fixture.close();
    }
  });

  it("archives chatter without starting a turn", async () => {
    const fixture = await createFixture({ route: "chatter" });
    try {
      await fixture.observe({
        id: "om_1",
        sender: "ou_ari",
        text: "Lunch?",
        atMs: START_MS,
      });
      await expect(
        fixture.flush({
          scheduledBy: START_MS,
          atMs: START_MS + UNADDRESSED_CHANNEL_QUIET_WINDOW_MS,
        })
      ).resolves.toMatchObject({ route: "chatter", status: "archived" });
      expect(fixture.submitRequest).not.toHaveBeenCalled();
      await expect(fixture.states()).resolves.toEqual([
        { id: "om_1", route: "chatter", state: "archived" },
      ]);
    } finally {
      await fixture.close();
    }
  });

  it("archives a redelivered message once", async () => {
    const fixture = await createFixture({ route: "chatter" });
    try {
      const message = {
        id: "om_1",
        sender: "ou_ari",
        text: "Lunch?",
        atMs: START_MS,
      };
      await fixture.observe(message);
      await fixture.observe({ ...message, atMs: START_MS + 500 });
      await fixture.flush({
        scheduledBy: START_MS,
        atMs: START_MS + UNADDRESSED_CHANNEL_QUIET_WINDOW_MS,
      });
      expect(fixture.classifyBatch.mock.calls[0]?.[0].messages).toHaveLength(1);
    } finally {
      await fixture.close();
    }
  });

  it("routes a steady stream once its oldest message has waited the maximum time", async () => {
    const fixture = await createFixture({ route: "new_request" });
    try {
      const stepMs = UNADDRESSED_CHANNEL_QUIET_WINDOW_MS - 1000;
      const count = Math.ceil(UNADDRESSED_CHANNEL_MAX_WAIT_MS / stepMs) + 1;
      for (let index = 0; index < count; index += 1) {
        await fixture.observe({
          id: `om_${index}`,
          sender: "ou_ari",
          text: `Detail ${index}`,
          atMs: START_MS + index * stepMs,
        });
      }
      // The newest message is still inside its quiet window.
      const nowMs = START_MS + (count - 1) * stepMs + 1000;
      await expect(
        fixture.flush({ scheduledBy: START_MS, atMs: nowMs })
      ).resolves.toMatchObject({ status: "routed" });
    } finally {
      await fixture.close();
    }
  });

  it("treats a follow-up as a new request when the Center Agent has not worked in the thread", async () => {
    const fixture = await createFixture({ route: "follow_up" });
    try {
      await fixture.observe({
        id: "om_1",
        sender: "ou_ari",
        text: "Also check Safari",
        atMs: START_MS,
      });
      await expect(
        fixture.flush({
          scheduledBy: START_MS,
          atMs: START_MS + UNADDRESSED_CHANNEL_QUIET_WINDOW_MS,
        })
      ).resolves.toMatchObject({ route: "new_request", status: "routed" });
    } finally {
      await fixture.close();
    }
  });

  it("keeps a batch waiting when routing fails, then archives it unrouted on the last attempt", async () => {
    const fixture = await createFixture({ route: "new_request" });
    try {
      fixture.classifyBatch.mockRejectedValue(new Error("model unavailable"));
      await fixture.observe({
        id: "om_1",
        sender: "ou_ari",
        text: "Login is broken",
        atMs: START_MS,
      });
      const dueAtMs = START_MS + UNADDRESSED_CHANNEL_QUIET_WINDOW_MS;

      await expect(
        fixture.flush({
          scheduledBy: START_MS,
          atMs: dueAtMs,
          queueAttempts: 1,
        })
      ).rejects.toThrow("model unavailable");
      await expect(fixture.states()).resolves.toEqual([
        { id: "om_1", route: null, state: "pending" },
      ]);

      await expect(
        fixture.flush({
          scheduledBy: START_MS,
          atMs: dueAtMs + 5000,
          queueAttempts: 4,
        })
      ).resolves.toMatchObject({ route: "unrouted", status: "archived" });
      expect(fixture.submitRequest).not.toHaveBeenCalled();
      await expect(fixture.states()).resolves.toEqual([
        { id: "om_1", route: "unrouted", state: "archived" },
      ]);
    } finally {
      await fixture.close();
    }
  });

  it("does not archive messages for a connection that is not connected", async () => {
    const fixture = await createFixture({
      route: "chatter",
      status: "disconnected",
    });
    try {
      await expect(
        fixture.observe({
          id: "om_1",
          sender: "ou_ari",
          text: "Lunch?",
          atMs: START_MS,
        })
      ).resolves.toEqual({
        reasonCode: "message_channel.unaddressed_connection_unavailable",
        status: "ignored",
      });
      await expect(fixture.states()).resolves.toEqual([]);
      expect(fixture.queue.send).not.toHaveBeenCalled();
    } finally {
      await fixture.close();
    }
  });

  it.each([
    ["disconnect", null],
    ["reconnect", { connectionGeneration: 4, organizationId: "org_1" }],
    ["rebind", { connectionGeneration: 3, organizationId: "org_2" }],
  ] as const)("does not classify Feishu content after a %s", async (_, live) => {
    const fixture = await createFixture({ route: "new_request" });
    try {
      await fixture.observe({
        id: "om_1",
        sender: "ou_ari",
        text: "Queued before the connection changed",
        atMs: START_MS,
      });
      fixture.readCurrentConnection.mockResolvedValue(live);
      await expect(
        fixture.flush({
          scheduledBy: START_MS,
          atMs: START_MS + UNADDRESSED_CHANNEL_QUIET_WINDOW_MS,
        })
      ).resolves.toMatchObject({ route: "unrouted", status: "archived" });
      expect(fixture.classifyBatch).not.toHaveBeenCalled();
      expect(fixture.submitRequest).not.toHaveBeenCalled();
    } finally {
      await fixture.close();
    }
  });

  it("does not classify a mixed Slack batch after reinstalling the app", async () => {
    const fixture = await createFixture({ route: "new_request" });
    try {
      await fixture.observeSlack({
        text: "Before reinstall",
        ts: "1710000000.000100",
      });
      const reinstalled = {
        botUserId: SLACK_BOT_USER_ID,
        connectionGeneration: SLACK_CONNECTION_GENERATION + 1,
        organizationId: "org_1",
      };
      fixture.readCurrentConnection.mockResolvedValue(reinstalled);
      await fixture.observeSlack(
        { text: "After reinstall", ts: "1710000000.000200" },
        reinstalled
      );
      await expect(
        fixture.flush({
          atMs: START_MS + UNADDRESSED_CHANNEL_QUIET_WINDOW_MS,
          batchKey: "sender:U123",
          connectionId: SLACK_TEAM_ID,
          conversationKey: SLACK_CHANNEL_ID,
          provider: "slack",
          scheduledBy: START_MS,
        })
      ).resolves.toMatchObject({ route: "unrouted", status: "archived" });
      expect(fixture.classifyBatch).not.toHaveBeenCalled();
      expect(fixture.submitRequest).not.toHaveBeenCalled();
    } finally {
      await fixture.close();
    }
  });

  it("archives an ordinary Slack channel message and starts its request as that message's own thread", async () => {
    const fixture = await createFixture({ route: "new_request" });
    try {
      const processSlackEvent = vi.fn(() =>
        Promise.resolve({ status: "processed" })
      );
      fixture.submitRequest.mockImplementation((request) =>
        submitUnaddressedSlackRequest(request, { processSlackEvent })
      );
      await expect(
        fixture.observeSlack({
          files: [{ id: "F123", name: "trace.png" }],
          subtype: "file_share",
          text: "Checkout fails with a 500 on staging",
          ts: "1710000000.000100",
        })
      ).resolves.toEqual({ status: "observed" });
      expect(fixture.queue.send).toHaveBeenCalledWith(
        expect.objectContaining({
          batchKey: "sender:U123",
          connectionId: SLACK_TEAM_ID,
          conversationKey: SLACK_CHANNEL_ID,
          provider: "slack",
        }),
        { delaySeconds: 8 }
      );

      await expect(
        fixture.flush({
          atMs: START_MS + UNADDRESSED_CHANNEL_QUIET_WINDOW_MS,
          batchKey: "sender:U123",
          connectionId: SLACK_TEAM_ID,
          conversationKey: SLACK_CHANNEL_ID,
          provider: "slack",
          scheduledBy: START_MS,
        })
      ).resolves.toMatchObject({ route: "new_request", status: "routed" });
      // The request is the app-mention shape the addressed Slack path already
      // accepts, with the original message's own identifiers.
      expect(processSlackEvent).toHaveBeenCalledWith(
        {
          type: "event_callback",
          team_id: SLACK_TEAM_ID,
          event_id: "unaddressed-batch:1710000000.000100",
          event: {
            type: "app_mention",
            user: "U123",
            text: "Checkout fails with a 500 on staging",
            ts: "1710000000.000100",
            channel: SLACK_CHANNEL_ID,
            files: [{ id: "F123", name: "trace.png" }],
          },
        },
        { addressed: false }
      );
    } finally {
      await fixture.close();
    }
  });

  it.each([
    {
      name: "a message that mentions the app, which its app_mention event owns",
      event: { text: `<@${SLACK_BOT_USER_ID}> ship it` },
      reasonCode: "slack.unaddressed_message_addressed",
    },
    {
      name: "a post by an app",
      event: { bot_id: "B123" },
      reasonCode: "slack.unaddressed_message_not_ordinary",
    },
    {
      name: "an edit",
      event: { subtype: "message_changed" },
      reasonCode: "slack.unaddressed_message_not_ordinary",
    },
    {
      name: "a message in a workspace without a connected Organization",
      event: {},
      reasonCode: "slack.unaddressed_workspace_unavailable",
      workspace: null,
    },
  ])("does not archive $name", async ({ event, reasonCode, workspace }) => {
    const fixture = await createFixture({ route: "chatter" });
    try {
      await expect(
        fixture.observeSlack(
          { text: "Checkout fails", ts: "1710000000.000100", ...event },
          workspace
        )
      ).resolves.toEqual({ reasonCode, status: "ignored" });
      await expect(fixture.slackStates()).resolves.toEqual([]);
      expect(fixture.queue.send).not.toHaveBeenCalled();
    } finally {
      await fixture.close();
    }
  });

  it("leaves a Slack channel that is not listed on the mention-only path, archiving nothing", async () => {
    const fixture = await createFixture({ route: "new_request" });
    try {
      fixture.slackUnlistedChannels.add(SLACK_CHANNEL_ID);
      await expect(
        fixture.observeSlack({
          text: "the export job is failing again",
          ts: "1710000000.000100",
        })
      ).resolves.toBeNull();
      expect(await fixture.slackStates()).toEqual([]);
      expect(fixture.queue.send).not.toHaveBeenCalled();
    } finally {
      await fixture.close();
    }
  });

  it("leaves direct messages and app mentions to the addressed Slack path", async () => {
    const fixture = await createFixture({ route: "chatter" });
    try {
      await expect(
        fixture.observeSlack({
          channel_type: "im",
          text: "What do you know about my work?",
          ts: "1710000000.000100",
        })
      ).resolves.toBeNull();
      await expect(
        fixture.observeSlack({
          type: "app_mention",
          text: `<@${SLACK_BOT_USER_ID}> ship it`,
          ts: "1710000000.000100",
        })
      ).resolves.toBeNull();
    } finally {
      await fixture.close();
    }
  });

  it("lets a Slack app mention settle the same person's waiting channel messages", async () => {
    const fixture = await createFixture({ route: "new_request" });
    try {
      await expect(
        fixture.observeSlack({
          text: "Staging deploy returns 502",
          ts: "1710000000.000100",
        })
      ).resolves.toEqual({ status: "observed" });
      await expect(
        settleUnaddressedSlackMessagesForMention(
          {
            getDb: () => fixture.db,
            nowMs: START_MS + 2000,
            payload: createSlackChannelMessagePayload({
              type: "app_mention",
              text: `<@${SLACK_BOT_USER_ID}> can you check?`,
              ts: "1710000003.000100",
            }),
          },
          { settle: settleUnaddressedChannelMessagesAnsweredByMention }
        )
      ).resolves.toBe(1);
      await expect(fixture.slackStates()).resolves.toEqual([
        { id: "1710000000.000100", route: "addressed", state: "archived" },
      ]);
      // An ordinary channel message is not a mention and settles nothing.
      await expect(
        settleUnaddressedSlackMessagesForMention(
          {
            getDb: () => fixture.db,
            nowMs: START_MS + 3000,
            payload: createSlackChannelMessagePayload({
              text: "Thanks",
              ts: "1710000004.000100",
            }),
          },
          { settle: settleUnaddressedChannelMessagesAnsweredByMention }
        )
      ).resolves.toBeNull();
    } finally {
      await fixture.close();
    }
  });
});

describe("routed Lark-platform unaddressed request", () => {
  it("starts the turn as the trigger message in its own thread, marked as not addressed", async () => {
    const submitAdmittedEvent = vi.fn(() =>
      Promise.resolve({
        deliveryId: "delivery_1",
        status: "submitted" as const,
      })
    );
    await expect(
      submitUnaddressedLarkPlatformRequest(createLarkRequest(), {
        readConnection: () => Promise.resolve(createConnection("connected")),
        submitAdmittedEvent,
      })
    ).resolves.toEqual({ deliveryId: "delivery_1", status: "submitted" });
    expect(submitAdmittedEvent).toHaveBeenCalledWith({
      event: {
        kind: "message",
        locator: {
          appId: "cli_feishu_1",
          chatId: CHAT_ID,
          connectionId: "connection_feishu_1",
          provider: "feishu",
          rootMessageId: ROOT_ID,
          tenantKey: "tenant_feishu_1",
          threadId: null,
        },
        mention: "group_message",
        messageId: "om_3",
        resources: [],
        senderId: "ou_ari",
        senderTenantKey: "tenant_feishu_1",
        sentAtMs: START_MS,
        text: "Login is broken",
      },
      source: {
        addressed: false,
        connectionGeneration: 3,
        connectionId: "connection_feishu_1",
        provider: "feishu",
        providerEventId: "unaddressed-batch:om_3",
      },
    });
  });

  it("does not start a turn after the connection was disconnected", async () => {
    const submitAdmittedEvent = vi.fn();
    await expect(
      submitUnaddressedLarkPlatformRequest(createLarkRequest(), {
        readConnection: () => Promise.resolve(createConnection("disconnected")),
        submitAdmittedEvent,
      })
    ).resolves.toEqual({
      reasonCode: "message_channel.unaddressed_connection_unavailable",
      status: "not_submitted",
    });
    expect(submitAdmittedEvent).not.toHaveBeenCalled();
  });
});

describe("unaddressed Channel intake conversation list", () => {
  const listed = (conversations: string | undefined, enabled = "true") =>
    isUnaddressedChannelIntakeEnabledForConversation({
      conversationKey: CHAT_ID,
      env: {
        OPENMELD_MESSAGE_CHANNEL_UNADDRESSED_INTAKE_CONVERSATIONS:
          conversations,
        OPENMELD_MESSAGE_CHANNEL_UNADDRESSED_INTAKE_ENABLED: enabled,
      },
      provider: "feishu",
    });

  it("admits no conversation when the flag is on but the list is empty", () => {
    expect(listed(undefined)).toBe(false);
    expect(listed("")).toBe(false);
    expect(listed(" , ")).toBe(false);
  });

  it("admits only a conversation listed under its own provider", () => {
    expect(listed(`feishu:${CHAT_ID}`)).toBe(true);
    expect(listed(`slack:C123, feishu:${CHAT_ID} `)).toBe(true);
    expect(listed("feishu:oc_other_chat")).toBe(false);
    // The same id under another provider is a different conversation.
    expect(listed(`slack:${CHAT_ID}`)).toBe(false);
    expect(listed(CHAT_ID)).toBe(false);
  });

  it("admits every conversation for the wildcard, and none while the flag is off", () => {
    expect(listed("*")).toBe(true);
    expect(listed("*", "false")).toBe(false);
    expect(listed(`feishu:${CHAT_ID}`, "false")).toBe(false);
  });
});

describe("unaddressed Channel batch queue consumer", () => {
  it("consumes a batch flush without routing it once its conversation is no longer listed", async () => {
    const message = createQueueMessage({
      batchKey: `thread:${ROOT_ID}`,
      connectionId: "connection_feishu_1",
      conversationKey: CHAT_ID,
      kind: "remote_agent_message_channel_unaddressed_batch",
      provider: "feishu",
      scheduledByObservedAtMs: START_MS,
      v: 1,
    });
    // The env has no database, so reaching the flush would throw and retry.
    await expect(
      handleUnaddressedChannelBatchQueueMessage({
        env: {
          OPENMELD_MESSAGE_CHANNEL_UNADDRESSED_INTAKE_CONVERSATIONS:
            "feishu:oc_other_chat",
          OPENMELD_MESSAGE_CHANNEL_UNADDRESSED_INTAKE_ENABLED: "true",
        } as CoreBindings,
        message,
      })
    ).resolves.toBe(true);
    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
  });

  it("consumes a batch flush without routing it while unaddressed intake is off", async () => {
    const message = createQueueMessage({
      batchKey: `thread:${ROOT_ID}`,
      connectionId: "connection_feishu_1",
      conversationKey: CHAT_ID,
      kind: "remote_agent_message_channel_unaddressed_batch",
      provider: "feishu",
      scheduledByObservedAtMs: START_MS,
      v: 1,
    });
    await expect(
      handleUnaddressedChannelBatchQueueMessage({
        env: {} as CoreBindings,
        message,
      })
    ).resolves.toBe(true);
    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
  });

  it("leaves every other queue message to its own consumer", async () => {
    const message = createQueueMessage({
      kind: "remote_agent_message_channel_event",
    });
    await expect(
      handleUnaddressedChannelBatchQueueMessage({
        env: {
          OPENMELD_MESSAGE_CHANNEL_UNADDRESSED_INTAKE_CONVERSATIONS: "*",
          OPENMELD_MESSAGE_CHANNEL_UNADDRESSED_INTAKE_ENABLED: "true",
        } as CoreBindings,
        message,
      })
    ).resolves.toBe(false);
    expect(message.ack).not.toHaveBeenCalled();
  });
});

async function createFixture(input: {
  route: UnaddressedChannelBatchRoute;
  status?: RemoteAgentLarkPlatformChannelConnectionRecord["status"];
}) {
  const harness: Harness = await createPostgresHarness();
  await harness.query({
    text: "INSERT INTO \"openmeld\".\"organizations\" (id, name, slug, created_at) VALUES ('org_1', 'One', 'one', 1000)",
  });
  const connection = createConnection(input.status ?? "connected");
  const slackUnlistedChannels = new Set<string>();
  const queue = {
    send: vi.fn<
      (
        message: UnaddressedChannelBatchQueueMessage,
        options?: { delaySeconds?: number }
      ) => Promise<void>
    >(() => Promise.resolve()),
  };
  const classifyBatch = vi.fn<
    (
      request: ClassifyUnaddressedChannelBatchInput
    ) => Promise<UnaddressedChannelBatchRoute>
  >(() => Promise.resolve(input.route));
  const submitRequest = vi.fn<
    UnaddressedChannelIntakeDependencies["submitRequest"]
  >(() => Promise.resolve({ deliveryId: "delivery_1", status: "submitted" }));
  const readCurrentConnection = vi.fn<
    UnaddressedChannelIntakeDependencies["readCurrentConnection"]
  >(({ provider }) => {
    if (provider === "slack") {
      return Promise.resolve({
        connectionGeneration: SLACK_CONNECTION_GENERATION,
        organizationId: "org_1",
      });
    }
    return Promise.resolve(
      connection.status === "connected" ? connection : null
    );
  });
  const dependencies: UnaddressedChannelIntakeDependencies = {
    claimBatch: claimDueUnaddressedChannelBatch,
    classifyBatch,
    expireStaleMessages: expireStaleUnaddressedChannelMessages,
    hasPriorAgentTurn: () => Promise.resolve(false),
    readCurrentConnection,
    releaseBatch: releaseUnaddressedChannelBatch,
    settleBatch: settleUnaddressedChannelBatch,
    submitRequest,
  };
  const listStates = async (scope: {
    connectionId: string;
    conversationKey: string;
    provider: UnaddressedChannelBatchQueueMessage["provider"];
  }) => {
    const messages = await listUnaddressedChannelMessages({
      ...scope,
      db: harness.db,
      limit: 100,
    });
    return messages.map((message) => ({
      id: message.messageId,
      route: message.route,
      state: message.state,
    }));
  };
  return {
    classifyBatch,
    close: () => harness.close(),
    flush(flushInput: {
      atMs: number;
      batchKey?: string;
      connectionId?: string;
      conversationKey?: string;
      provider?: UnaddressedChannelBatchQueueMessage["provider"];
      queueAttempts?: number;
      scheduledBy: number;
    }) {
      return flushUnaddressedChannelBatch(
        {
          db: harness.db,
          message: {
            batchKey: flushInput.batchKey ?? ARI_THREAD_BATCH,
            connectionId: flushInput.connectionId ?? connection.connectionId,
            conversationKey: flushInput.conversationKey ?? CHAT_ID,
            kind: "remote_agent_message_channel_unaddressed_batch",
            provider: flushInput.provider ?? "feishu",
            scheduledByObservedAtMs: flushInput.scheduledBy,
            v: 1,
          },
          nowMs: flushInput.atMs,
          queue,
          queueAttempts: flushInput.queueAttempts ?? 1,
        },
        dependencies
      );
    },
    db: harness.db,
    observe(message: {
      atMs: number;
      id: string;
      rootMessageId?: string;
      sender: string;
      text: string;
    }) {
      return observeUnaddressedLarkPlatformMessage(
        {
          connectionGeneration: connection.connectionGeneration,
          connectionId: connection.connectionId,
          db: harness.db,
          event: createThreadReply(message),
          nowMs: message.atMs,
          provider: "feishu",
          queue,
        },
        {
          readConnection: () => Promise.resolve(connection),
          recordMessage: recordUnaddressedChannelMessage,
        }
      );
    },
    observeSlack(
      event: Record<string, unknown>,
      workspace: {
        botUserId: string;
        connectionGeneration: number;
        organizationId: string;
      } | null = {
        botUserId: SLACK_BOT_USER_ID,
        connectionGeneration: SLACK_CONNECTION_GENERATION,
        organizationId: "org_1",
      }
    ) {
      return observeUnaddressedSlackChannelMessage(
        {
          getDb: () => harness.db,
          isConversationAllowed: (channel) =>
            !slackUnlistedChannels.has(channel),
          nowMs: START_MS,
          payload: createSlackChannelMessagePayload(event),
          queue,
        },
        {
          readWorkspace: () => Promise.resolve(workspace),
          recordMessage: recordUnaddressedChannelMessage,
        }
      );
    },
    queue,
    readCurrentConnection,
    slackUnlistedChannels,
    slackStates: () =>
      listStates({
        connectionId: SLACK_TEAM_ID,
        conversationKey: SLACK_CHANNEL_ID,
        provider: "slack",
      }),
    states: () =>
      listStates({
        connectionId: connection.connectionId,
        conversationKey: CHAT_ID,
        provider: "feishu",
      }),
    submitRequest,
  };
}

// Field names and values follow Slack's documented `message.channels` event
// (https://docs.slack.dev/reference/events/message.channels). No payload has
// been captured from a real workspace yet.
function createSlackChannelMessagePayload(event: Record<string, unknown>) {
  return {
    type: "event_callback",
    team_id: SLACK_TEAM_ID,
    event_id: "Ev123",
    event_time: 1_710_000_000,
    event: {
      type: "message",
      channel: SLACK_CHANNEL_ID,
      user: "U123",
      event_ts: event.ts,
      channel_type: "channel",
      ...event,
    },
  };
}

function createThreadReply(input: {
  atMs: number;
  id: string;
  rootMessageId?: string;
  sender: string;
  text: string;
}): MessageEvent {
  return {
    kind: "message",
    locator: {
      appId: "cli_feishu_1",
      chatId: CHAT_ID,
      connectionId: "connection_feishu_1",
      provider: "feishu",
      rootMessageId: input.rootMessageId ?? ROOT_ID,
      tenantKey: "tenant_feishu_1",
      threadId: null,
    },
    mention: "group_message",
    messageId: input.id,
    resources: [],
    senderId: input.sender,
    senderTenantKey: "tenant_feishu_1",
    sentAtMs: input.atMs,
    text: input.text,
  };
}

function createLarkRequest(): UnaddressedChannelBatchRequest {
  return {
    db: {} as UnaddressedChannelBatchRequest["db"],
    requestEventId: "unaddressed-batch:om_3",
    text: "Login is broken",
    trigger: {
      batchId: "batch_1",
      batchKey: ARI_THREAD_BATCH,
      connectionGeneration: 3,
      connectionId: "connection_feishu_1",
      conversationKey: CHAT_ID,
      messageId: "om_3",
      nativeDeliveryId: null,
      observedAtMs: START_MS,
      organizationId: "org_1",
      provider: "feishu",
      resources: [],
      rootMessageId: ROOT_ID,
      route: null,
      senderId: "ou_ari",
      senderTenantKey: "tenant_feishu_1",
      sentAtMs: START_MS,
      slackFiles: [],
      source: "push",
      state: "routing",
      text: "Login is broken",
      threadId: null,
    },
  };
}

function createQueueMessage(body: unknown) {
  return {
    ack: vi.fn(),
    attempts: 1,
    body,
    id: "queue_message_1",
    retry: vi.fn(),
    timestamp: new Date(START_MS),
  } satisfies Message<unknown>;
}

function createConnection(
  status: RemoteAgentLarkPlatformChannelConnectionRecord["status"]
): RemoteAgentLarkPlatformChannelConnectionRecord {
  return {
    appId: "cli_feishu_1",
    botName: "Center Agent",
    botOpenId: "ou_bot_1",
    callbacksWebhookVerifiedAtMs: 2000,
    connectionGeneration: 3,
    connectionId: "connection_feishu_1",
    createdAtMs: 1000,
    eventsWebhookVerifiedAtMs: 2000,
    failureReasonCode: null,
    grantedCapabilityGroups: ["channel.base"],
    installedByUserId: "user_owner",
    lastVerifiedAtMs: 2000,
    organizationId: "org_1",
    permissionBundleVersion: "channel-only-2026-07-18+feishu-history",
    provider: "feishu",
    status,
    tenantKey: "tenant_feishu_1",
    transport: "websocket",
    updatedAtMs: 2000,
  };
}
