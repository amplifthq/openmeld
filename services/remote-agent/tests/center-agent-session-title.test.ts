import { describe, expect, it, vi } from "vitest";
import { generateCenterAgentSessionTitle } from "../agent-core/center-agent-session-title";
import { TEST_REMOTE_AGENT_AI_GATEWAY_ENV } from "./fixtures";
// Captured through AI Gateway/OpenRouter on 2026-09-22 using a synthetic
// bilingual PR-review request. Request IDs, usage and reasoning signature omitted.
import completion from "./fixtures/session-title-openrouter.json";

const request = {
  organizationId: "org-title-test",
  spaceId: "space-title-test",
  sourceSignalId: "message-title-test",
  text: "你帮我 review 一下 1048 和 1047。https://github.com/example/project/pull/1048",
  attachmentNames: [],
};

describe("independent Center Agent session title generation", () => {
  it("uses the fixed small model and accepts the captured structured response", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json(completion)
    );
    await expect(
      generateCenterAgentSessionTitle({
        env: TEST_REMOTE_AGENT_AI_GATEWAY_ENV,
        request,
        fetch,
      })
    ).resolves.toEqual({ title: "审查 PR #1048 和 #1047" });
    const options = fetch.mock.calls[0]?.[1];
    const body = JSON.parse(String(options?.body));
    expect(body).toMatchObject({
      model: "openai/gpt-6-luna",
      max_tokens: 512,
      stream: false,
      reasoning: { effort: "low", exclude: true },
      provider: { require_parameters: true },
    });
    expect(body.tools).toBeUndefined();
    expect(body.temperature).toBeUndefined();
    expect(body.messages).toHaveLength(2);
    expect(JSON.parse(body.messages[1].content)).toEqual({
      message: request.text,
      attachmentNames: [],
    });
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    "x".repeat(65),
    "First line\nSecond line",
    "Review https://example.com/pr/1",
    "   ",
  ])("rejects invalid titles instead of truncating them: %j", async (title) => {
    const value = structuredClone(completion);
    value.choices = value.choices.map((choice) => ({
      ...choice,
      message: { ...choice.message, content: JSON.stringify({ title }) },
    }));
    await expect(
      generateCenterAgentSessionTitle({
        env: TEST_REMOTE_AGENT_AI_GATEWAY_ENV,
        request,
        fetch: async () => Response.json(value),
      })
    ).rejects.toThrow("invalid title");
  });

  it("defers a greeting without inventing a topic", async () => {
    const value = structuredClone(completion);
    value.choices = value.choices.map((choice) => ({
      ...choice,
      message: { ...choice.message, content: '{"title":null}' },
    }));
    await expect(
      generateCenterAgentSessionTitle({
        env: TEST_REMOTE_AGENT_AI_GATEWAY_ENV,
        request: { ...request, text: "hi" },
        fetch: async () => Response.json(value),
      })
    ).resolves.toEqual({ title: null });
  });

  it.each([
    {
      response: () => new Response("Private model output, not JSON"),
      message: "Session title model returned invalid JSON.",
    },
    {
      response: () => Response.json(completion, { status: 429 }),
      message: "HTTP 429",
    },
    {
      response: () =>
        Response.json({
          ...completion,
          choices: [{ ...completion.choices[0], finish_reason: "length" }],
        }),
      message: "incomplete response",
    },
    {
      response: () => new Response("x".repeat(16 * 1024 + 1)),
      message: "exceeded 16 KiB",
    },
  ])("rejects provider failures: $message", async ({ response, message }) => {
    await expect(
      generateCenterAgentSessionTitle({
        env: TEST_REMOTE_AGENT_AI_GATEWAY_ENV,
        request,
        fetch: async () => response(),
      })
    ).rejects.toThrow(message);
  });

  it("aborts a stalled title request without retrying", async () => {
    vi.useFakeTimers();
    try {
      const timeout = new AbortController();
      vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
        setTimeout(
          () => timeout.abort(new DOMException("Timed out", "TimeoutError")),
          ms
        );
        return timeout.signal;
      });
      const fetch = vi.fn<typeof globalThis.fetch>(
        (_url, options) =>
          new Promise((_resolve, reject) => {
            options?.signal?.addEventListener("abort", () =>
              reject(options.signal?.reason)
            );
          })
      );
      const pending = expect(
        generateCenterAgentSessionTitle({
          env: TEST_REMOTE_AGENT_AI_GATEWAY_ENV,
          request,
          fetch,
        })
      ).rejects.toThrow("Timed out");
      await vi.advanceTimersByTimeAsync(15_000);
      await pending;
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally {
      vi.restoreAllMocks();
      vi.useRealTimers();
    }
  });
});
