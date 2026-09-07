import {
  type FlueEventContext,
  instrument,
  type ModelRequest,
} from "@flue/runtime";
import { createCloudflareTracing } from "@flue/runtime/cloudflare";
import { expect, it, vi } from "vitest";

const spans = vi.hoisted(
  () =>
    [] as {
      name: string;
      attributes: Record<string, unknown>;
      ended: boolean;
    }[]
);
vi.mock("cloudflare:workers", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  waitUntil: vi.fn(),
  // Match the installed Workers Tracing/Span interfaces; sample every span.
  tracing: {
    startActiveSpan<T>(name: string, callback: (span: Span) => T): T {
      const captured = {
        name,
        attributes: {} as Record<string, unknown>,
        ended: false,
      };
      spans.push(captured);
      return callback({
        isTraced: true,
        setAttribute(key, value) {
          captured.attributes[key] = value;
        },
        end() {
          captured.ended = true;
        },
      });
    },
  },
}));
vi.mock("@flue/runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@flue/runtime")>();
  return { ...actual, instrument: vi.fn(actual.instrument) };
});

async function emitSensitiveWork(
  tracer: ReturnType<typeof createCloudflareTracing>
) {
  const identity = {
    agentName: "center-agent-v2",
    conversationId: "conversation-1",
    submissionId: "submission-1",
  };
  const envelope = {
    ...identity,
    v: 3 as const,
    eventIndex: 1,
    timestamp: "2026-09-07T00:00:00.000Z",
  };
  const context: FlueEventContext = {
    id: "instance-1",
    agentName: identity.agentName,
    env: {},
    req: undefined,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
  const request: ModelRequest = {
    providerId: "openrouter",
    providerName: "openai",
    requestedModel: "test-model",
    api: "openai-completions",
    input: {
      systemPrompt: "PRIVATE_SYSTEM_MARKER",
      messages: [{ role: "user", content: "PRIVATE_MESSAGE_MARKER" }],
      tools: [
        {
          name: "example_tool",
          description: "PRIVATE_TOOL_DEFINITION_MARKER",
          parameters: { type: "object", properties: {} },
        },
      ],
    },
  };
  await tracer.observe(
    {
      ...envelope,
      type: "turn_request",
      turnId: "turn-1",
      purpose: "agent",
      request,
    },
    context
  );
  await tracer.interceptor(
    { type: "model", turnId: "turn-1" },
    identity,
    async () => undefined
  );
  await tracer.observe(
    {
      ...envelope,
      type: "turn",
      turnId: "turn-1",
      purpose: "agent",
      request,
      durationMs: 20,
      isError: false,
      response: {
        responseModel: "test-model",
        finishReason: "stop",
        output: {
          role: "assistant",
          content: [{ type: "text", text: "PRIVATE_RESPONSE_MARKER" }],
        },
        usage: {
          input: 4,
          output: 2,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 6,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      },
    },
    context
  );
  await tracer.observe(
    {
      ...envelope,
      type: "tool_start",
      toolCallId: "tool-1",
      toolName: "example_tool",
      args: { value: "PRIVATE_ARGUMENT_MARKER" },
    },
    context
  );
  await tracer.interceptor(
    { type: "tool", toolCallId: "tool-1", toolName: "example_tool" },
    identity,
    async () => undefined
  );
  await tracer.observe(
    {
      ...envelope,
      type: "tool",
      toolCallId: "tool-1",
      toolName: "example_tool",
      durationMs: 10,
      isError: false,
      result: "PRIVATE_RESULT_MARKER",
    },
    context
  );
}

it("installs content-free tracing from the real app entry while retaining operational spans", async () => {
  // Positive control: the real installed adapter would export our markers
  // with its defaults. This prevents a no-op tracer from passing the test.
  const defaults = createCloudflareTracing();
  await emitSensitiveWork(defaults);
  for (const marker of [
    "SYSTEM",
    "MESSAGE",
    "TOOL_DEFINITION",
    "RESPONSE",
    "ARGUMENT",
    "RESULT",
  ]) {
    expect(JSON.stringify(spans)).toContain(`PRIVATE_${marker}_MARKER`);
  }
  await defaults.dispose();
  spans.length = 0;

  await import("../.flue/app");
  const installed = vi
    .mocked(instrument)
    .mock.calls.find(([value]) => value.key === defaults.key)?.[0];
  expect(installed).toBeDefined();
  if (!installed) {
    throw new Error("App did not install Cloudflare tracing");
  }
  await emitSensitiveWork(installed);
  expect(spans).toHaveLength(2);
  expect(JSON.stringify(spans)).not.toContain("PRIVATE_");
  expect(spans[0]?.attributes).toMatchObject({
    "gen_ai.request.model": "test-model",
    "gen_ai.conversation.id": "conversation-1",
    "gen_ai.usage.input_tokens": 4,
    "gen_ai.usage.output_tokens": 2,
  });
  expect(spans[1]?.attributes).toMatchObject({
    "gen_ai.tool.name": "example_tool",
    "gen_ai.tool.call.id": "tool-1",
  });
  expect(spans.every((span) => span.ended)).toBe(true);
  for (const result of vi.mocked(instrument).mock.results) {
    if (result.type === "return") {
      await result.value();
    }
  }
});
