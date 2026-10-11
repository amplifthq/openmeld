import { normalizeContext } from "@earendil-works/pi-ai";
import { stream as streamOpenAICompletions } from "@earendil-works/pi-ai/api/openai-completions";
import { transformMessages } from "@earendil-works/pi-ai/api/transform-messages";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  REMOTE_AGENT_EXECUTION_INSTRUMENTATION,
  registerRemoteAgentExecutionPreparation,
} from "../flue-adapter/execution-context";
import {
  declareRemoteAgentModelImageInput,
  declareRemoteAgentModelReasoning,
  withRemoteAgentProviderObservabilityAndSessionAffinity,
} from "../flue-adapter/model";

const TEXT_ONLY_MODEL = {
  id: "x-ai/grok-4.6",
  name: "SpaceXAI: Grok 4.6",
  api: "openai-completions" as const,
  provider: "openrouter",
  baseUrl: "https://openrouter.ai/api/v1",
  reasoning: true,
  input: ["text" as const],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 500_000,
  maxTokens: 65_536,
};

describe("Remote Agent model image input", () => {
  it("keeps an attached image in the OpenAI request context for the configured model", () => {
    const messages = [
      {
        role: "user" as const,
        content: [
          { type: "text" as const, text: "Describe this image." },
          {
            type: "image" as const,
            data: "cG5n",
            mimeType: "image/png",
          },
        ],
        timestamp: 1,
      },
    ];

    const textOnlyProjection = transformMessages(messages, TEXT_ONLY_MODEL);
    expect(JSON.stringify(textOnlyProjection)).toContain(
      "image omitted: model does not support images"
    );

    const imageProjection = transformMessages(
      messages,
      declareRemoteAgentModelImageInput(TEXT_ONLY_MODEL, "x-ai/grok-4.6")
    );
    expect(JSON.stringify(imageProjection)).toContain('"type":"image"');
    expect(JSON.stringify(imageProjection)).not.toContain(
      "image omitted: model does not support images"
    );
  });

  it("does not change a different provider model", () => {
    const otherModel = { ...TEXT_ONLY_MODEL, provider: "other" };

    expect(declareRemoteAgentModelImageInput(otherModel, "x-ai/grok-4.6")).toBe(
      otherModel
    );
  });
});

describe("Remote Agent model reasoning", () => {
  const runtimeClock = {
    content:
      "[OpenMeld runtime clock]\nAuthoritative current UTC time: 1970-01-01T00:01:40.000Z",
    role: "user",
  };
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(100_000);
  });
  afterEach(() => vi.restoreAllMocks());

  it("sends explicit high reasoning through pi-ai OpenRouter request construction", async () => {
    let capturedPayload: unknown;
    const model = declareRemoteAgentModelReasoning(
      { ...TEXT_ONLY_MODEL, reasoning: false },
      "x-ai/grok-4.6"
    );

    const stream = streamOpenAICompletions(
      model,
      normalizeContext({ messages: [] }),
      {
        apiKey: "unused",
        onPayload: (payload) => {
          capturedPayload = payload;
          throw new Error("Request payload captured before network dispatch.");
        },
        reasoningEffort: "high",
      }
    );

    await stream.result();

    expect(capturedPayload).toMatchObject({
      reasoning: { effort: "high" },
    });
  });

  it("exposes the official xhigh reasoning effort for Grok 4.6", () => {
    expect(
      declareRemoteAgentModelReasoning(
        { ...TEXT_ONLY_MODEL, reasoning: false },
        "x-ai/grok-4.6"
      )
    ).toMatchObject({
      reasoning: true,
      thinkingLevelMap: {
        high: "high",
        low: "low",
        medium: "medium",
        xhigh: "xhigh",
      },
    });
  });

  it("keeps the exact model while allowing same-model provider failover", async () => {
    const reportStage = vi.fn();
    const options = withRemoteAgentProviderObservabilityAndSessionAffinity(
      {
        onPayload: (payload) => ({
          ...(payload as Record<string, unknown>),
          provider: { allow_fallbacks: false },
        }),
        sessionId: "flue-conversation-affinity",
      },
      reportStage
    );

    const payload = await options.onPayload?.(
      { messages: [] },
      TEXT_ONLY_MODEL
    );

    expect(payload).toEqual({
      messages: [runtimeClock],
      provider: { allow_fallbacks: true },
      session_id: "flue-conversation-affinity",
    });
    expect(reportStage).toHaveBeenCalledWith(
      expect.objectContaining({
        durationMs: expect.any(Number),
        inputBytes: expect.any(Number),
        messageCount: 1,
        stage: "request_prepared",
        status: "succeeded",
        toolCount: 0,
      })
    );
  });

  it.each([
    {
      label: "native only",
      names: ["search", "codemode"],
      deferredToolCount: 0,
      expectedTotal: 2,
    },
    {
      label: "native and indirect",
      names: ["search", "codemode"],
      deferredToolCount: 148,
      expectedTotal: 150,
    },
    {
      label: "tool-free compaction",
      names: [],
      deferredToolCount: 148,
      expectedTotal: 0,
    },
  ])("counts capabilities for $label without session affinity", async ({
    names,
    deferredToolCount,
    expectedTotal,
  }) => {
    const tools = names.map((name) => ({
      function: { name },
      type: "function",
    }));
    const dispose = registerRemoteAgentExecutionPreparation(async () => ({
      deferredToolCount,
    }));
    try {
      await REMOTE_AGENT_EXECUTION_INSTRUMENTATION.interceptor(
        {
          type: "agent",
          operationId: "catalog-count",
          operationKind: "prompt",
        },
        { submissionId: "catalog-count" },
        async () => {
          const reportStage = vi.fn();
          const options =
            withRemoteAgentProviderObservabilityAndSessionAffinity(
              {},
              reportStage
            );

          const payload = await options.onPayload?.(
            {
              messages: [{ content: "hello", role: "user" }],
              tools,
            },
            TEXT_ONLY_MODEL
          );

          expect(payload).toEqual({
            messages: [{ content: "hello", role: "user" }, runtimeClock],
            provider: { allow_fallbacks: true },
            tools,
          });
          expect(reportStage).toHaveBeenCalledWith(
            expect.objectContaining({
              inputBytes: expect.any(Number),
              messageCount: 2,
              stage: "request_prepared",
              toolCount: names.length,
              availableToolCount: expectedTotal,
            })
          );
        }
      );
    } finally {
      dispose();
    }
  });

  it("rejects a complete provider payload that exceeds the frozen model input budget", async () => {
    const options = withRemoteAgentProviderObservabilityAndSessionAffinity(
      {},
      undefined,
      { inputTokenBudget: 160 }
    );

    await expect(
      options.onPayload?.(
        {
          messages: [
            {
              content: "x".repeat(500),
              role: "user",
            },
          ],
        },
        TEXT_ONLY_MODEL
      )
    ).rejects.toThrow(
      "context_length_exceeded: estimated provider input is 173 tokens, above this model route's 160-token input budget"
    );
  });

  it("adapts provider preflight to the active model route instead of a global limit", async () => {
    const payload = {
      messages: [{ content: "x".repeat(500), role: "user" }],
    };
    const smallerRoute = withRemoteAgentProviderObservabilityAndSessionAffinity(
      {},
      undefined,
      {
        inputTokenBudget: 100,
      }
    );
    const largerRoute = withRemoteAgentProviderObservabilityAndSessionAffinity(
      {},
      undefined,
      {
        inputTokenBudget: 200,
      }
    );

    await expect(
      smallerRoute.onPayload?.(payload, TEXT_ONLY_MODEL)
    ).rejects.toThrow("context_length_exceeded");
    await expect(
      largerRoute.onPayload?.(payload, TEXT_ONLY_MODEL)
    ).resolves.toMatchObject({
      messages: [...payload.messages, runtimeClock],
    });
  });

  it.each([
    "z-ai/glm-5.3-flash",
    "x-ai/grok-4.6",
  ])("preserves the registered tool interface for %s without a second policy", async (modelId) => {
    const options = withRemoteAgentProviderObservabilityAndSessionAffinity({});
    const tools = [
      "codemode",
      "activate_skill",
      "read_skill_resource",
      "openmeld_search_capabilities",
      "openmeld_describe_capabilities",
      "read",
    ].map((name) => ({ type: "function", function: { name } }));
    const messages = [
      { role: "user", content: "Please use the available capabilities." },
    ];
    const payload = await options.onPayload?.(
      { tools, messages },
      { ...TEXT_ONLY_MODEL, id: modelId }
    );
    expect(payload).toMatchObject({
      tools,
      messages: [...messages, runtimeClock],
    });
    expect(payload).not.toHaveProperty("tool_choice");
  });

  it("does not impose a fixed schema-count limit on a generic provider payload", async () => {
    const options = withRemoteAgentProviderObservabilityAndSessionAffinity({});
    const directTools = Array.from({ length: 65 }, (_, index) => ({
      function: { name: `tool_${String(index)}` },
      type: "function",
    }));

    await expect(
      options.onPayload?.(
        { messages: [{ content: "hello", role: "user" }], tools: directTools },
        TEXT_ONLY_MODEL
      )
    ).resolves.toMatchObject({ tools: directTools });
  });

  it("preserves a successful legacy Space result without re-exposing its write tool", async () => {
    const options = withRemoteAgentProviderObservabilityAndSessionAffinity({});
    const codemode = {
      function: { name: "codemode" },
      type: "function",
    };
    const messages = [
      {
        content: ["[OpenMeld work-surface binding]", "Surface: new_space"].join(
          "\n"
        ),
        role: "system",
      },
      {
        content: "请建一个 Space，专门做 OK8 的产品规划。",
        role: "user",
      },
      {
        content: null,
        role: "assistant",
        tool_calls: [
          {
            function: {
              arguments: '{"name":"OK8 Product Planning"}',
              name: "openmeld_create_space",
            },
            id: "legacy-create-space-call",
            type: "function",
          },
        ],
      },
      {
        content: JSON.stringify({
          name: "OK8 Product Planning",
          spaceId: "space_existing",
        }),
        role: "tool",
        tool_call_id: "legacy-create-space-call",
      },
    ];
    const tools = [codemode];

    const payload = await options.onPayload?.(
      { messages, reasoning: { effort: "high" }, tools },
      TEXT_ONLY_MODEL
    );

    expect(payload).toMatchObject({
      messages: [...messages, runtimeClock],
      reasoning: { effort: "high" },
      tools: [codemode],
    });
    expect(JSON.stringify(payload)).toContain("space_existing");
    expect(payload).not.toHaveProperty("tool_choice");
  });

  it("keeps a Space-context request with other work on the full execution path", async () => {
    const options = withRemoteAgentProviderObservabilityAndSessionAffinity({});
    const tools = [
      {
        function: { name: "openmeld_create_space" },
        type: "function",
      },
      {
        function: { name: "openmeld_github_read_repository" },
        type: "function",
      },
    ];

    const payload = await options.onPayload?.(
      {
        messages: [
          {
            content: [
              "[Current verified request]",
              "Space production smoke after deploy. Use the Organization GitHub App to read amplifthq/openmeld. Reply exactly SPACE_FINAL_SMOKE_OK main.",
            ].join("\n"),
            role: "user",
          },
        ],
        reasoning: { effort: "high" },
        tools,
      },
      TEXT_ONLY_MODEL
    );

    expect(payload).toMatchObject({
      reasoning: { effort: "high" },
      tools,
    });
    expect(payload).not.toHaveProperty("tool_choice");
  });
});
