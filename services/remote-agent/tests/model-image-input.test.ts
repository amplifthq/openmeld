import { stream as streamOpenAICompletions } from "@earendil-works/pi-ai/api/openai-completions";
import { transformMessages } from "@earendil-works/pi-ai/api/transform-messages";
import { describe, expect, it, vi } from "vitest";
import { REMOTE_AGENT_GITHUB_TOOL_NAMES } from "../agent-core/github-tools";
import { REMOTE_AGENT_WORK_SURFACE_BINDING_MARKER } from "../agent-core/work-surface-routing";
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

  it("keeps connected App and GitHub actions direct alongside Code Mode for a large tool surface", async () => {
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

    expect(payload).toMatchObject({
      tools: [...connectedAppTools, ...githubTools, codemode],
    });
    expect(tools).toHaveLength(66 + githubTools.length);
    expect(reportStage).toHaveBeenCalledWith(
      expect.objectContaining({
        messageCount: 1,
        toolCount: 4 + githubTools.length,
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

  it("forces an explicitly requested Task before compacting the tool surface", async () => {
    const classifyWorkSurface = vi.fn().mockResolvedValue("new_task");
    const options = withRemoteAgentProviderObservabilityAndSessionAffinity(
      {},
      undefined,
      classifyWorkSurface
    );
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

    expect(classifyWorkSurface).toHaveBeenCalledWith(
      "Create a dedicated Task for this investigation."
    );
    expect(payload).toMatchObject({
      parallel_tool_calls: false,
      reasoning: { effort: "high" },
      tool_choice: {
        function: { name: "openmeld_create_task" },
        type: "function",
      },
      tools: [createTask],
    });
  });

  it("drops old conversation history for a preclassified lightweight binding", async () => {
    const options = withRemoteAgentProviderObservabilityAndSessionAffinity({});
    const createTask = {
      function: { name: "openmeld_create_task" },
      type: "function",
    };

    const payload = await options.onPayload?.(
      {
        messages: [
          {
            content: `${REMOTE_AGENT_WORK_SURFACE_BINDING_MARKER}\nSurface: new_task`,
            role: "system",
          },
          { content: "very large old conversation", role: "user" },
          { content: "old reply", role: "assistant" },
          {
            content: [
              "[OpenMeld conversation continuity]",
              "This is deliberately large prior context.",
              "[Current verified request]",
              "Create a dedicated Task to research competitor onboarding.",
              "",
              "[OpenMeld turn context]",
              "Authoritative UTC time for this turn: 2026-08-12T00:00:00.000Z",
            ].join("\n"),
            role: "user",
          },
        ],
        reasoning: { effort: "high" },
        tools: [
          createTask,
          {
            function: { name: "openmeld_create_space" },
            type: "function",
          },
        ],
      },
      TEXT_ONLY_MODEL
    );

    expect(JSON.stringify(payload)).not.toContain(
      "very large old conversation"
    );
    expect(payload).toMatchObject({
      max_tokens: 2048,
      messages: [
        {
          content: `${REMOTE_AGENT_WORK_SURFACE_BINDING_MARKER}\nSurface: new_task`,
          role: "system",
        },
        {
          content:
            "Create a dedicated Task to research competitor onboarding.\n\n[OpenMeld turn context]\nAuthoritative UTC time for this turn: 2026-08-12T00:00:00.000Z",
          role: "user",
        },
      ],
      reasoning: { effort: "high" },
      tool_choice: {
        function: { name: "openmeld_create_task" },
        type: "function",
      },
      tools: [createTask],
    });
    expect(JSON.stringify(payload)).not.toContain(
      "deliberately large prior context"
    );
  });

  it("disables every tool after the lightweight binding tool returns", async () => {
    const options = withRemoteAgentProviderObservabilityAndSessionAffinity({});
    const payload = await options.onPayload?.(
      {
        messages: [
          {
            content: `${REMOTE_AGENT_WORK_SURFACE_BINDING_MARKER}\nSurface: new_task`,
            role: "system",
          },
          { content: "old request", role: "user" },
          { content: "old response", role: "assistant" },
          {
            content:
              "Create a dedicated Task to research competitor onboarding.",
            role: "user",
          },
          {
            role: "assistant",
            tool_calls: [
              {
                function: {
                  arguments:
                    '{"goal":"Research competitor onboarding.","operationId":"op_1","title":"Competitor onboarding research"}',
                  name: "openmeld_create_task",
                },
                id: "call_1",
                type: "function",
              },
            ],
          },
          {
            content: '{"task":{"id":"task_1"}}',
            role: "tool",
            tool_call_id: "call_1",
          },
        ],
        reasoning: { effort: "high" },
        tools: [
          {
            function: { name: "openmeld_create_task" },
            type: "function",
          },
        ],
      },
      TEXT_ONLY_MODEL
    );

    expect(JSON.stringify(payload)).not.toContain("old request");
    expect(payload).toMatchObject({
      max_tokens: 160,
      parallel_tool_calls: false,
      reasoning: { effort: "high" },
      tools: [],
    });
    expect(payload).not.toHaveProperty("tool_choice");
  });

  it("forces an explicitly requested Space through the same provider boundary", async () => {
    const classifyWorkSurface = vi.fn().mockResolvedValue("new_space");
    const options = withRemoteAgentProviderObservabilityAndSessionAffinity(
      {},
      undefined,
      classifyWorkSurface
    );
    const createSpace = {
      function: { name: "openmeld_create_space" },
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
          createSpace,
        ],
      },
      TEXT_ONLY_MODEL
    );

    expect(payload).toMatchObject({
      reasoning: { effort: "high" },
      tool_choice: {
        function: { name: "openmeld_create_space" },
        type: "function",
      },
      tools: [createSpace],
    });
  });

  it("allows one requested Space message after the bound Space is created", async () => {
    const options = withRemoteAgentProviderObservabilityAndSessionAffinity({});
    const createSpace = {
      function: { name: "openmeld_create_space" },
      type: "function",
    };
    const postSpaceMessage = {
      function: { name: "openmeld_post_space_message" },
      type: "function",
    };

    const payload = await options.onPayload?.(
      {
        messages: [
          {
            content: `${REMOTE_AGENT_WORK_SURFACE_BINDING_MARKER}\nSurface: new_space`,
            role: "system",
          },
          {
            content:
              "Create a private Space named Launch Room and add a three-item launch checklist.",
            role: "user",
          },
          {
            role: "assistant",
            tool_calls: [
              {
                function: {
                  arguments: '{"name":"Launch Room"}',
                  name: "openmeld_create_space",
                },
                id: "call_create",
                type: "function",
              },
            ],
          },
          {
            content: '{"space":{"id":"space_1"}}',
            role: "tool",
            tool_call_id: "call_create",
          },
        ],
        reasoning: { effort: "high" },
        tools: [createSpace, postSpaceMessage],
      },
      TEXT_ONLY_MODEL
    );

    expect(payload).toMatchObject({
      max_tokens: 2048,
      parallel_tool_calls: false,
      reasoning: { effort: "high" },
      tools: [postSpaceMessage],
    });
    expect(payload).not.toHaveProperty("tool_choice");
  });

  it("closes the lightweight Space tool surface after the initial message", async () => {
    const options = withRemoteAgentProviderObservabilityAndSessionAffinity({});
    const payload = await options.onPayload?.(
      {
        messages: [
          {
            content: `${REMOTE_AGENT_WORK_SURFACE_BINDING_MARKER}\nSurface: new_space`,
            role: "system",
          },
          {
            content:
              "Create a private Space named Launch Room and add a three-item launch checklist.",
            role: "user",
          },
          {
            role: "assistant",
            tool_calls: [
              {
                function: {
                  arguments: '{"name":"Launch Room"}',
                  name: "openmeld_create_space",
                },
                id: "call_create",
                type: "function",
              },
            ],
          },
          {
            content: '{"space":{"id":"space_1"}}',
            role: "tool",
            tool_call_id: "call_create",
          },
          {
            role: "assistant",
            tool_calls: [
              {
                function: {
                  arguments:
                    '{"content":"- Confirm Web\n- Confirm CLI\n- Confirm Center Agent","referenceProfileIds":[],"spaceId":"space_1"}',
                  name: "openmeld_post_space_message",
                },
                id: "call_post",
                type: "function",
              },
            ],
          },
          {
            content: '{"message":{"id":"message_1"}}',
            role: "tool",
            tool_call_id: "call_post",
          },
        ],
        reasoning: { effort: "high" },
        tools: [
          {
            function: { name: "openmeld_create_space" },
            type: "function",
          },
          {
            function: { name: "openmeld_post_space_message" },
            type: "function",
          },
        ],
      },
      TEXT_ONLY_MODEL
    );

    expect(payload).toMatchObject({
      max_tokens: 160,
      parallel_tool_calls: false,
      reasoning: { effort: "high" },
      tools: [],
    });
    expect(payload).not.toHaveProperty("tool_choice");
  });

  it("routes an unlinked Slack member's Space request to account connection", async () => {
    const classifyWorkSurface = vi.fn().mockResolvedValue("new_space");
    const options = withRemoteAgentProviderObservabilityAndSessionAffinity(
      {},
      undefined,
      classifyWorkSurface
    );
    const requireIdentity = {
      function: { name: "openmeld_require_identity_for_action" },
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
          requireIdentity,
          {
            function: { name: "openmeld_get_navigation_action" },
            type: "function",
          },
          {
            function: { name: "openmeld_read_organization_directory" },
            type: "function",
          },
        ],
      },
      TEXT_ONLY_MODEL
    );

    expect(classifyWorkSurface).toHaveBeenCalledWith(
      "Create a Space for the production smoke test."
    );
    expect(payload).toMatchObject({
      parallel_tool_calls: false,
      reasoning: { effort: "high" },
      tool_choice: {
        function: { name: "openmeld_require_identity_for_action" },
        type: "function",
      },
      tools: [requireIdentity],
    });
    expect(JSON.stringify(payload)).not.toContain("tool catalog");
  });

  it("does not treat a Task mention in conversation continuity as current intent", async () => {
    const classifyWorkSurface = vi.fn().mockResolvedValue("new_task");
    const options = withRemoteAgentProviderObservabilityAndSessionAffinity(
      {},
      undefined,
      classifyWorkSurface
    );

    const payload = await options.onPayload?.(
      {
        messages: [
          {
            content: [
              "[Runtime conversation continuity]",
              '{"text":"Create a Task for the old request."}',
              "[End runtime conversation continuity]",
              "",
              "[Current verified request]",
              "What is the current status?",
            ].join("\n"),
            role: "user",
          },
        ],
        tools: [
          {
            function: { name: "openmeld_create_task" },
            type: "function",
          },
        ],
      },
      TEXT_ONLY_MODEL
    );

    expect(classifyWorkSurface).not.toHaveBeenCalled();
    expect(payload).not.toHaveProperty("tool_choice");
  });

  it("does not reclassify a tool continuation", async () => {
    const classifyWorkSurface = vi.fn().mockResolvedValue("new_space");
    const options = withRemoteAgentProviderObservabilityAndSessionAffinity(
      {},
      undefined,
      classifyWorkSurface
    );

    const payload = await options.onPayload?.(
      {
        messages: [
          { content: "Create a Space.", role: "user" },
          { content: "created", role: "tool", tool_call_id: "call_1" },
        ],
        reasoning: { effort: "high" },
        tools: [
          {
            function: { name: "openmeld_create_space" },
            type: "function",
          },
        ],
      },
      TEXT_ONLY_MODEL
    );

    expect(classifyWorkSurface).not.toHaveBeenCalled();
    expect(payload).not.toHaveProperty("tool_choice");
    expect(payload).toMatchObject({ reasoning: { effort: "high" } });
  });

  it("keeps the main Agent available when work-surface classification fails", async () => {
    const classifyWorkSurface = vi
      .fn()
      .mockRejectedValue(new Error("classifier unavailable"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const options = withRemoteAgentProviderObservabilityAndSessionAffinity(
      {},
      undefined,
      classifyWorkSurface
    );
    const tools = [
      {
        function: { name: "openmeld_create_task" },
        type: "function",
      },
    ];

    const payload = await options.onPayload?.(
      {
        messages: [{ content: "Create a new Task for this.", role: "user" }],
        tools,
      },
      TEXT_ONLY_MODEL
    );

    expect(payload).toMatchObject({ tools });
    expect(payload).not.toHaveProperty("tool_choice");
    expect(warn).toHaveBeenCalledWith(
      "[remote_agent.work_surface.classification_failed]",
      expect.objectContaining({
        error: "classifier unavailable",
        submissionId: null,
      })
    );
    warn.mockRestore();
  });
});
