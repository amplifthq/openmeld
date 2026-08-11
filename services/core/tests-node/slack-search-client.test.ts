import { describe, expect, it, vi } from "vitest";
import {
  postSlackEphemeralMessage,
  searchSlackPublicMessages,
} from "../src/remote-agent/application/slack-client";

describe("Slack Real-time Search client", () => {
  it("searches one page of public messages with the invoking action token", async () => {
    const fetchImpl = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({
        action_token: "action-token-from-event",
        channel_types: ["public_channel"],
        content_types: ["messages"],
        include_bots: false,
        include_context_messages: false,
        limit: 10,
        query: "project gizmo status",
      });
      return Promise.resolve(
        new Response(
          JSON.stringify({
            ok: true,
            results: {
              messages: [
                {
                  author_name: "Jennifer Hynes",
                  author_user_id: "U0123456",
                  channel_id: "C0123456",
                  channel_name: "proj-gizmo",
                  content:
                    "We will be kicking off our mobile UX revamp for the Gizmo App.",
                  is_author_bot: false,
                  message_ts: "123456.7890",
                  permalink:
                    "https://example.slack.com/archives/C0123456/p1234567890",
                  team_id: "T0123456",
                },
                {
                  author_name: "Untrusted result",
                  author_user_id: "U9999999",
                  channel_id: "C9999999",
                  channel_name: "unsafe",
                  content: "This result has an unsafe source link.",
                  is_author_bot: false,
                  message_ts: "123456.9999",
                  permalink: "javascript:alert('unsafe')",
                  team_id: "T0123456",
                },
              ],
            },
            response_metadata: {
              next_cursor: "Q1VSUkVOVF9QQUdFOjI=",
            },
          }),
          {
            headers: { "content-type": "application/json" },
            status: 200,
          }
        )
      );
    });

    await expect(
      searchSlackPublicMessages({
        actionToken: "action-token-from-event",
        botToken: "xoxb-test",
        fetchImpl,
        includeBots: false,
        limit: 10,
        query: "project gizmo status",
      })
    ).resolves.toEqual({
      messages: [
        {
          authorName: "Jennifer Hynes",
          authorUserId: "U0123456",
          channelId: "C0123456",
          channelName: "proj-gizmo",
          content:
            "We will be kicking off our mobile UX revamp for the Gizmo App.",
          isAuthorBot: false,
          messageTs: "123456.7890",
          permalink: "https://example.slack.com/archives/C0123456/p1234567890",
        },
      ],
      moreResultsAvailable: true,
    });
  });

  it("retries an invalid ephemeral Block Kit presentation as plain text", async () => {
    let attempt = 0;
    const presentationDeadline = new AbortController().signal;
    const fetchImpl = vi.fn<typeof fetch>((_request, init) => {
      attempt += 1;
      expect(init?.signal).toBe(presentationDeadline);
      const body = JSON.parse(String(init?.body)) as {
        blocks?: unknown;
      };
      if (attempt === 1) {
        expect(body.blocks).toBeDefined();
        return Promise.resolve(
          Response.json({
            error: "invalid_blocks",
            ok: false,
          })
        );
      }
      if (attempt === 2) {
        expect(body.blocks).toBeUndefined();
        return Promise.resolve(
          Response.json({
            message_ts: "123456.7890",
            ok: true,
          })
        );
      }
      throw new Error(`Unexpected Slack presentation attempt: ${attempt}`);
    });

    await expect(
      postSlackEphemeralMessage({
        blocks: [
          {
            text: {
              text: "Slack search results",
              type: "plain_text",
            },
            type: "header",
          },
        ],
        botToken: "xoxb-test",
        channelId: "C0123456",
        fetchImpl,
        signal: presentationDeadline,
        text: "Slack search results in plain text.",
        threadTs: "123456.7000",
        userId: "U0123456",
      })
    ).resolves.toEqual({ id: "123456.7890" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(
      fetchImpl.mock.calls.map(([, init]) => JSON.parse(String(init?.body)))
    ).toEqual([
      {
        blocks: [
          {
            text: {
              text: "Slack search results",
              type: "plain_text",
            },
            type: "header",
          },
        ],
        channel: "C0123456",
        text: "Slack search results in plain text.",
        thread_ts: "123456.7000",
        user: "U0123456",
      },
      {
        channel: "C0123456",
        text: "Slack search results in plain text.",
        thread_ts: "123456.7000",
        user: "U0123456",
      },
    ]);
  });
});
