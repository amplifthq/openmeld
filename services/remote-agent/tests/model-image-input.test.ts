import { stream as streamOpenAICompletions } from "@earendil-works/pi-ai/api/openai-completions";
import { transformMessages } from "@earendil-works/pi-ai/api/transform-messages";
import { describe, expect, it, vi } from "vitest";
import { REMOTE_AGENT_GITHUB_TOOL_NAMES } from "../agent-core/github-tools";
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
  it("sends explicit high reasoning through pi-ai OpenRouter request construction", async () => {
    let capturedPayload: unknown;
    const model = declareRemoteAgentModelReasoning(
      { ...TEXT_ONLY_MODEL, reasoning: false },
      "x-ai/grok-4.6"
    );

    const stream = streamOpenAICompletions(
      model,
      { messages: [] },
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
      messages: [],
      provider: { allow_fallbacks: true },
      session_id: "flue-conversation-affinity",
    });
    expect(reportStage).toHaveBeenCalledWith(
      expect.objectContaining({
        durationMs: expect.any(Number),
        inputBytes: expect.any(Number),
        messageCount: 0,
        stage: "request_prepared",
        status: "succeeded",
        toolCount: 0,
      })
    );
  });

  it("measures provider preparation without session affinity", async () => {
    const reportStage = vi.fn();
    const options = withRemoteAgentProviderObservabilityAndSessionAffinity(
      {},
      reportStage
    );

    const payload = await options.onPayload?.(
      {
        messages: [{ content: "hello", role: "user" }],
        tools: [{ function: { name: "search" }, type: "function" }],
      },
      TEXT_ONLY_MODEL
    );

    expect(payload).toEqual({
      messages: [{ content: "hello", role: "user" }],
      provider: { allow_fallbacks: true },
      tools: [{ function: { name: "search" }, type: "function" }],
    });
    expect(reportStage).toHaveBeenCalledWith(
      expect.objectContaining({
        inputBytes: expect.any(Number),
        messageCount: 1,
        stage: "request_prepared",
        toolCount: 1,
      })
    );
  });

  it("keeps large GitHub capability available through Code Mode without duplicating every action in the provider payload", async () => {
    const reportStage = vi.fn();
    const options = withRemoteAgentProviderObservabilityAndSessionAffinity(
      {},
      reportStage
    );
    const connectedAppTools = [
      "openmeld_list_connected_apps",
      "openmeld_list_app_actions",
      "openmeld_execute_app_action",
    ].map((name) => ({ function: { name }, type: "function" }));
    const githubTools = REMOTE_AGENT_GITHUB_TOOL_NAMES.map((name) => ({
      function: { name },
      type: "function",
    }));
    expect(connectedAppTools.length + githubTools.length).toBeLessThanOrEqual(
      64
    );
    const directTools = [
      ...Array.from({ length: 62 }, (_, index) => ({
        function: { name: `tool_${String(index)}` },
        type: "function",
      })),
      ...connectedAppTools,
      ...githubTools,
    ];
    const codemode = {
      function: {
        description: "All 65 tools remain available through typed JavaScript.",
        name: "codemode",
      },
      type: "function",
    };
    const tools = [...directTools, codemode];

    const payload = await options.onPayload?.(
      { messages: [{ content: "hello", role: "user" }], tools },
      TEXT_ONLY_MODEL
    );

    expect(payload).toMatchObject({ tools: [...connectedAppTools, codemode] });
    expect(payload).not.toMatchObject({
      tools: expect.arrayContaining(githubTools),
    });
    expect(tools).toHaveLength(66 + githubTools.length);
    expect(reportStage).toHaveBeenCalledWith(
      expect.objectContaining({
        messageCount: 1,
        toolCount: 4,
      })
    );
  });

  it("keeps only Code Mode direct when a large tool surface has no required direct tools", async () => {
    const reportStage = vi.fn();
    const options = withRemoteAgentProviderObservabilityAndSessionAffinity(
      {},
      reportStage
    );
    const directTools = Array.from({ length: 65 }, (_, index) => ({
      function: { name: `tool_${String(index)}` },
      type: "function",
    }));
    const codemode = {
      function: {
        description: "All 65 tools remain available through typed JavaScript.",
        name: "codemode",
      },
      type: "function",
    };
    const tools = [...directTools, codemode];

    const payload = await options.onPayload?.(
      { messages: [{ content: "do the work", role: "user" }], tools },
      TEXT_ONLY_MODEL
    );

    expect(payload).toMatchObject({ tools: [codemode] });
    expect(tools).toHaveLength(66);
    expect(reportStage).toHaveBeenCalledWith(
      expect.objectContaining({
        messageCount: 1,
        toolCount: 1,
      })
    );
  });

  it("fails fast when a large tool surface has no Code Mode capability catalog", async () => {
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
    ).rejects.toThrow(
      "A large Remote Agent tool surface requires exactly one Code Mode tool."
    );
  });

  it("keeps an explicitly requested Task with the primary Agent while compacting the tool surface", async () => {
    const options = withRemoteAgentProviderObservabilityAndSessionAffinity({});
    const createTask = {
      function: { name: "openmeld_create_task" },
      type: "function",
    };
    const createSpace = {
      function: { name: "openmeld_create_space" },
      type: "function",
    };
    const codemode = {
      function: { name: "codemode" },
      type: "function",
    };
    const tools = [
      createTask,
      createSpace,
      ...Array.from({ length: 65 }, (_, index) => ({
        function: { name: `tool_${String(index)}` },
        type: "function",
      })),
      codemode,
    ];

    const payload = await options.onPayload?.(
      {
        messages: [
          {
            content:
              "[Current verified request]\nCreate a dedicated Task for this investigation.\n\n[OpenMeld turn context]\nAuthoritative UTC time for this turn: 2026-08-12T00:00:00.000Z",
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
      tools: [codemode],
    });
    expect(payload).not.toHaveProperty("tool_choice");
  });

  it("preserves a successful legacy Space result for the primary Agent without forcing another write", async () => {
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
    const tools = [
      {
        function: { name: "openmeld_create_space" },
        type: "function",
      },
      ...Array.from({ length: 65 }, (_, index) => ({
        function: { name: `tool_${String(index)}` },
        type: "function",
      })),
      codemode,
    ];

    const payload = await options.onPayload?.(
      { messages, reasoning: { effort: "high" }, tools },
      TEXT_ONLY_MODEL
    );

    expect(payload).toMatchObject({
      messages,
      reasoning: { effort: "high" },
      tools: [codemode],
    });
    expect(JSON.stringify(payload)).toContain("space_existing");
    expect(payload).not.toHaveProperty("tool_choice");
  });

  it("keeps an explicitly requested Space with the primary Agent", async () => {
    const options = withRemoteAgentProviderObservabilityAndSessionAffinity({});
    const codemode = {
      function: { name: "codemode" },
      type: "function",
    };

    const payload = await options.onPayload?.(
      {
        messages: [
          {
            content:
              "[Current verified request]\n请新开一个 Space 专门调研这个问题。",
            role: "user",
          },
        ],
        reasoning: { effort: "high" },
        tools: [
          {
            function: { name: "openmeld_create_task" },
            type: "function",
          },
          {
            function: { name: "openmeld_create_space" },
            type: "function",
          },
          ...Array.from({ length: 65 }, (_, index) => ({
            function: { name: `tool_${String(index)}` },
            type: "function",
          })),
          codemode,
        ],
      },
      TEXT_ONLY_MODEL
    );

    expect(payload).toMatchObject({
      reasoning: { effort: "high" },
      tools: [codemode],
    });
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

  it("keeps an unlinked Slack member's Space request with the primary Agent", async () => {
    const options = withRemoteAgentProviderObservabilityAndSessionAffinity({});
    const codemode = {
      function: { name: "codemode" },
      type: "function",
    };

    const payload = await options.onPayload?.(
      {
        messages: [
          {
            content: [
              "[Connected Message Channel member boundary]",
              "This person belongs to the connected Slack workspace but has not linked an OpenMeld account.",
              "",
              "[Current connected Message Channel member request]",
              "Create a Space for the production smoke test.",
            ].join("\n"),
            role: "user",
          },
        ],
        reasoning: { effort: "high" },
        tools: [
          {
            function: { name: "openmeld_require_identity_for_action" },
            type: "function",
          },
          {
            function: { name: "openmeld_get_navigation_action" },
            type: "function",
          },
          ...Array.from({ length: 65 }, (_, index) => ({
            function: { name: `tool_${String(index)}` },
            type: "function",
          })),
          codemode,
        ],
      },
      TEXT_ONLY_MODEL
    );

    expect(payload).toMatchObject({
      reasoning: { effort: "high" },
      tools: [codemode],
    });
    expect(payload).not.toHaveProperty("tool_choice");
    expect(JSON.stringify(payload)).not.toContain("tool catalog");
  });
});
