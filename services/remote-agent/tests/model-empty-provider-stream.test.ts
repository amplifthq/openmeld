import {
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  createAssistantMessageEventStream,
} from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import {
  projectProviderCompletion,
  providerCompletionOperation,
} from "../flue-adapter/provider-completion";
import { retryCompletedEmptyAssistantStreamOnce } from "../flue-adapter/provider-stream-retry";

const EMPTY_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
};

function assistantMessage(
  content: AssistantMessage["content"],
  stopReason: AssistantMessage["stopReason"] = "stop",
  usage: AssistantMessage["usage"] = EMPTY_USAGE
): AssistantMessage {
  return {
    api: "openai-completions",
    content,
    model: "z-ai/glm-5.3-flash",
    provider: "openrouter",
    role: "assistant",
    stopReason,
    timestamp: 1,
    usage,
  };
}

function completedStream(input: {
  content: AssistantMessage["content"];
  intermediate?: AssistantMessageEvent[];
  stopReason?: "length" | "stop" | "toolUse";
  usage?: AssistantMessage["usage"];
}): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  const partial = assistantMessage([]);
  stream.push({ partial, type: "start" });
  for (const event of input.intermediate ?? []) {
    stream.push(event);
  }
  const message = assistantMessage(
    input.content,
    input.stopReason ?? "stop",
    input.usage
  );
  stream.push({
    message,
    reason: input.stopReason ?? "stop",
    type: "done",
  });
  return stream;
}

async function collectEvents(
  stream: AssistantMessageEventStream
): Promise<AssistantMessageEvent[]> {
  const events: AssistantMessageEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

describe("Remote Agent completed-empty provider retry", () => {
  it("observes both source completions before empty suppression and usage merging", async () => {
    const observations: ReturnType<typeof projectProviderCompletion>[] = [];
    let attempt = 0;
    const stream = retryCompletedEmptyAssistantStreamOnce({
      createAttempt: () =>
        completedStream({
          content:
            ++attempt === 1 ? [] : [{ type: "text", text: "private answer" }],
          usage: { ...EMPTY_USAGE, input: 10, output: 3, totalTokens: 13 },
        }),
      onCompletion: (completion) =>
        observations.push(
          projectProviderCompletion({
            ...completion,
            callId: "11111111-1111-4111-8111-111111111111",
            submissionId: "submission",
          })
        ),
    });
    await collectEvents(stream);
    expect(
      observations.map((value) => [
        value.attemptNo,
        value.inputTokens,
        value.textChars,
      ])
    ).toEqual([
      [1, 10, 0],
      [2, 10, 14],
    ]);
    expect(observations.map(providerCompletionOperation)).toEqual([
      "completed_empty_stop",
      "completed_text_stop",
    ]);
    expect(JSON.stringify(observations)).not.toContain("private answer");
    expect((await stream.result()).usage.input).toBe(20);
  });

  it("does not let reporting errors interrupt a successful answer", async () => {
    const stream = retryCompletedEmptyAssistantStreamOnce({
      createAttempt: () =>
        completedStream({ content: [{ type: "text", text: "answer" }] }),
      onCompletion: () => {
        throw new Error("reporting unavailable");
      },
    });
    await collectEvents(stream);
    expect((await stream.result()).content).toEqual([
      { type: "text", text: "answer" },
    ]);
  });

  it("keeps abort, provider response id, usage, and content-filter evidence without raw error text", () => {
    const message = {
      ...assistantMessage([], "aborted"),
      responseId: "gen-123",
      rawStopReason: "content_filter",
      errorMessage: "private provider payload",
    };
    const observation = projectProviderCompletion({
      attemptNo: 1,
      durationMs: 25,
      event: { type: "error", reason: "aborted", error: message },
      callId: "11111111-1111-4111-8111-111111111111",
      submissionId: "submission",
    });
    expect(observation).toMatchObject({
      terminalEvent: "error",
      stopReason: "aborted",
      responseId: "gen-123",
      rawStopReason: "content_filter",
    });
    expect(JSON.stringify(observation)).not.toContain(
      "private provider payload"
    );
  });
  it("retries one provider stream that completed without any content", async () => {
    let attempts = 0;
    const output = retryCompletedEmptyAssistantStreamOnce({
      createAttempt: () => {
        attempts += 1;
        return attempts === 1
          ? completedStream({ content: [] })
          : completedStream({
              content: [{ text: "Available skills: none.", type: "text" }],
              intermediate: [
                {
                  contentIndex: 0,
                  delta: "Available skills: none.",
                  partial: assistantMessage([
                    { text: "Available skills: none.", type: "text" },
                  ]),
                  type: "text_delta",
                },
              ],
            });
      },
    });

    const events = await collectEvents(output);

    expect(attempts).toBe(2);
    expect(events.map((event) => event.type)).toEqual([
      "start",
      "text_delta",
      "done",
    ]);
    await expect(output.result()).resolves.toMatchObject({
      content: [{ text: "Available skills: none.", type: "text" }],
      stopReason: "stop",
    });
  });

  it("recovers reasoning-only output without exposing the discarded attempt", async () => {
    let attempts = 0;
    const partial = assistantMessage([
      { thinking: "Checking", type: "thinking" },
    ]);
    const output = retryCompletedEmptyAssistantStreamOnce({
      createAttempt: () => {
        attempts += 1;
        return completedStream({
          content: [],
          intermediate: [
            {
              contentIndex: 0,
              delta: "Checking",
              partial,
              type: "thinking_delta",
            },
          ],
        });
      },
    });

    expect((await collectEvents(output)).map((event) => event.type)).toEqual([
      "start",
      "thinking_delta",
      "done",
    ]);
    expect(attempts).toBe(2);
  });

  it("retries when the final message contains only provider reasoning", async () => {
    let attempts = 0;
    const output = retryCompletedEmptyAssistantStreamOnce({
      createAttempt: () => {
        attempts += 1;
        return completedStream({
          content: [{ thinking: "Checking", type: "thinking" }],
        });
      },
    });

    await collectEvents(output);

    expect(attempts).toBe(2);
  });

  it.each([
    "text_delta",
    "toolcall_start",
  ] as const)("never replays an inference after %s becomes observable", async (type) => {
    let attempts = 0;
    const partial = assistantMessage(
      type === "text_delta"
        ? [{ type: "text", text: "Sent" }]
        : [{ type: "toolCall", id: "call-1", name: "send", arguments: {} }]
    );
    const output = retryCompletedEmptyAssistantStreamOnce({
      createAttempt: () => {
        attempts += 1;
        return completedStream({
          content: [],
          intermediate: [
            type === "text_delta"
              ? { type, contentIndex: 0, delta: "Sent", partial }
              : { type, contentIndex: 0, partial },
          ],
        });
      },
    });
    await collectEvents(output);
    expect(attempts).toBe(1);
  });

  it("does not retry length or tool-use completions", async () => {
    for (const stopReason of ["length", "toolUse"] as const) {
      let attempts = 0;
      const output = retryCompletedEmptyAssistantStreamOnce({
        createAttempt: () => {
          attempts += 1;
          return completedStream({ content: [], stopReason });
        },
      });

      await collectEvents(output);
      expect(attempts).toBe(1);
    }
  });

  it("retries at most once when the second provider stream is also empty", async () => {
    let attempts = 0;
    const output = retryCompletedEmptyAssistantStreamOnce({
      createAttempt: () => {
        attempts += 1;
        return completedStream({ content: [] });
      },
    });

    expect((await collectEvents(output)).map((event) => event.type)).toEqual([
      "start",
      "done",
    ]);
    expect(attempts).toBe(2);
    await expect(output.result()).resolves.toMatchObject({
      content: [],
      stopReason: "stop",
    });
  });

  it("includes the discarded attempt in final token and cost usage", async () => {
    let attempts = 0;
    const usage = (value: number): AssistantMessage["usage"] => ({
      cacheRead: value,
      cacheWrite: value,
      cacheWrite1h: value,
      cost: {
        cacheRead: value,
        cacheWrite: value,
        input: value,
        output: value,
        total: value,
      },
      input: value,
      output: value,
      reasoning: value,
      totalTokens: value,
    });
    const output = retryCompletedEmptyAssistantStreamOnce({
      createAttempt: () => {
        attempts += 1;
        return completedStream({
          content: attempts === 1 ? [] : [{ text: "Recovered", type: "text" }],
          usage: usage(attempts),
        });
      },
    });

    await collectEvents(output);

    await expect(output.result()).resolves.toMatchObject({ usage: usage(3) });
  });

  it("does not retry an empty completion after the caller aborts", async () => {
    let attempts = 0;
    const controller = new AbortController();
    const output = retryCompletedEmptyAssistantStreamOnce({
      createAttempt: () => {
        attempts += 1;
        controller.abort();
        return completedStream({ content: [] });
      },
      signal: controller.signal,
    });

    expect((await collectEvents(output)).map((event) => event.type)).toEqual([
      "start",
      "done",
    ]);
    expect(attempts).toBe(1);
  });
});
