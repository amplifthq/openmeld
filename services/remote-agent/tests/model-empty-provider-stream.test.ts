import {
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  createAssistantMessageEventStream,
} from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
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

  it("does not retry after any intermediate provider event", async () => {
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
    expect(attempts).toBe(1);
  });

  it("does not retry when the final message contains provider reasoning", async () => {
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
