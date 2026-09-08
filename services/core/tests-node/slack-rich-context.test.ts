import type { ConversationsHistoryResponse } from "@slack/web-api/dist/types/response/ConversationsHistoryResponse";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveSlackMentionRichContext } from "../src/remote-agent/application/slack-rich-context";

const ts = "1710000000.000100";
// Fixtures use the installed Slack SDK response type. Attachment text/fallback
// are also shown in https://docs.slack.dev/reference/methods/conversations.history/.
// These are synthetic contract fixtures, not a captured forwarded-message smoke.
function respond(messages: ConversationsHistoryResponse["messages"]) {
  return Promise.resolve(
    Response.json({
      ok: true,
      messages,
    } satisfies ConversationsHistoryResponse)
  );
}
function resolve(text: string, threadTs?: string) {
  return resolveSlackMentionRichContext({
    botToken: "test-token",
    event: {
      type: "app_mention",
      channel: "C123",
      user: "U123",
      ts,
      text,
      ...(threadTs ? { thread_ts: threadTs } : {}),
    },
    eventId: "event-test",
    reproEnabled: false,
    slackTeamId: "T123",
  });
}
afterEach(() => vi.unstubAllGlobals());

describe("Slack mention rich context", () => {
  it("bounds the exact timestamp even when newer channel messages exist", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((request) => {
        const url = new URL(String(request));
        expect(url.pathname).toBe("/api/conversations.history");
        expect(url.searchParams.get("oldest")).toBe(ts);
        expect(url.searchParams.get("latest")).toBe(ts);
        expect(url.searchParams.get("inclusive")).toBe("true");
        return respond([{ ts, text: "Recovered" }]);
      })
    );
    expect((await resolve("Trigger")).currentMessage?.text).toBe("Recovered");
  });
  it("reads an exact thread reply with its root timestamp", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((request) => {
        const url = new URL(String(request));
        expect(url.pathname).toBe("/api/conversations.replies");
        expect(url.searchParams.get("ts")).toBe("1709999999.000050");
        expect(url.searchParams.get("oldest")).toBe(ts);
        expect(url.searchParams.get("latest")).toBe(ts);
        return respond([
          { ts, text: "Reply", files: [{ id: "F123", name: "image.png" }] },
        ]);
      })
    );
    const result = await resolve("", "1709999999.000050");
    expect(result.currentMessage?.files[0]?.fileId).toBe("F123");
    expect(result.degradationStatus).toBeNull();
  });
  it("never reads a cross-channel permalink using the bot credential", async () => {
    const text =
      "Read https://acme.slack.com/archives/C_PRIVATE/p1709999999000200";
    const fetchMock = vi.fn(async () => respond([{ ts, text }]));
    vi.stubGlobal("fetch", fetchMock);
    const result = await resolve(text);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.quotedContext).toEqual([]);
    expect(result.degradationStatus).toBe("forbidden");
  });
  it("keeps attachment text as untrusted context without claiming full recovery", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        respond([
          {
            ts,
            text: "Please review",
            attachments: [
              {
                text: "Quoted content",
                image_url: "https://example.test/image.png",
              },
            ],
          },
        ])
      )
    );
    const result = await resolve("Please review");
    expect(result.currentMessage?.text).toBe("Please review");
    expect(result.quotedContext.join("\n")).toContain("Quoted content");
    expect(result.quotedContext.join("\n")).toContain("untrusted data");
    expect(result.degradationStatus).toBe("truncated");
  });
  it("marks even a plain sparse trigger incomplete when hydration fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ ok: false, error: "missing_scope" }))
    );
    expect((await resolve("Please review")).degradationStatus).toBe(
      "forbidden"
    );
  });
  it("marks long same-channel quotes truncated and honors thread permalinks", async () => {
    const text =
      "https://acme.slack.com/archives/C123/p1709999999000200?thread_ts=1709999998.000100";
    vi.stubGlobal(
      "fetch",
      vi.fn((request) => {
        const url = new URL(String(request));
        if (url.pathname.endsWith("history")) {
          return respond([{ ts, text }]);
        }
        expect(url.searchParams.get("ts")).toBe("1709999998.000100");
        return respond([{ ts: "1709999999.000200", text: "x".repeat(20_000) }]);
      })
    );
    const result = await resolve(text);
    expect(result.degradationStatus).toBe("truncated");
    expect(result.quotedContext[0]).toContain("[Quoted message truncated]");
  });
});
