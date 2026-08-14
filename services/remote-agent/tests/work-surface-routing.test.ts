import { describe, expect, it, vi } from "vitest";
import {
  buildRemoteAgentWorkSurfaceBindingSystemPrompt,
  classifyRemoteAgentWorkSurface,
  compactRemoteAgentWorkSurfaceCurrentUserMessage,
  extractRemoteAgentCurrentUserRequest,
  resolveRemoteAgentWorkSurfaceModelId,
  shouldClassifyRemoteAgentWorkSurface,
} from "../agent-core/work-surface-routing";

describe("Remote Agent lightweight work-surface binding", () => {
  it("keeps only the current request and authoritative turn time", () => {
    expect(
      compactRemoteAgentWorkSurfaceCurrentUserMessage(
        "[OpenMeld conversation continuity]\nold context\n[Current verified request]\nCreate a Task for the launch.\n\n[OpenMeld turn context]\nAuthoritative UTC time for this turn: 2026-08-12T00:00:00.000Z"
      )
    ).toBe(
      "Create a Task for the launch.\n\n[OpenMeld turn context]\nAuthoritative UTC time for this turn: 2026-08-12T00:00:00.000Z"
    );
  });

  it("pins the Task operation id to the durable submission", () => {
    expect(
      buildRemoteAgentWorkSurfaceBindingSystemPrompt(
        { surface: "new_task", v: 1 },
        { operationId: "remote-agent-submission:submission_1" }
      )
    ).toContain('Use operationId "remote-agent-submission:submission_1".');
  });

  it("keeps one explicitly requested initial Space message out of the guide", () => {
    const prompt = buildRemoteAgentWorkSurfaceBindingSystemPrompt(
      { surface: "new_space", v: 1 },
      { operationId: "remote-agent-submission:submission_1" }
    );

    expect(prompt).toContain(
      "Never put a one-time checklist, task, update, note, or message in the Space guide."
    );
    expect(prompt).toContain(
      "call openmeld_post_space_message once with the returned Space ID"
    );
    expect(prompt).toContain("Do not perform any other follow-up work");
  });
});

const WORK_SURFACE_ENV = {
  CLOUDFLARE_OPENMELD_AI_GATEWAY_TOKEN: "test-token",
};

describe("Remote Agent work-surface routing", () => {
  it("uses one validated auxiliary model policy for classification and binding", () => {
    expect(resolveRemoteAgentWorkSurfaceModelId({})).toBe(
      "openai/gpt-5.4-mini"
    );
    expect(
      resolveRemoteAgentWorkSurfaceModelId({
        OPENMELD_REMOTE_AGENT_WORK_SURFACE_MODEL_ID: " openai/gpt-5.4-mini ",
      })
    ).toBe("openai/gpt-5.4-mini");
    expect(() =>
      resolveRemoteAgentWorkSurfaceModelId({
        OPENMELD_REMOTE_AGENT_WORK_SURFACE_MODEL_ID: "invalid-model",
      })
    ).toThrow("must be an OpenRouter model id");
  });

  it("marks a self-contained explicit Task request as safe for lightweight binding", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    context: "self_contained",
                    surface: "new_task",
                  }),
                },
              },
            ],
          }),
          { status: 200 }
        )
    );

    await expect(
      classifyRemoteAgentWorkSurface({
        env: WORK_SURFACE_ENV,
        fetchImpl: fetchImpl as typeof fetch,
        organizationId: "org_123",
        request: "Create a dedicated Task to research competitor onboarding.",
      })
    ).resolves.toEqual({
      context: "self_contained",
      surface: "new_task",
    });
  });

  it("extracts only the current request from continuity and time context", () => {
    const content = [
      "[Runtime conversation continuity]",
      '{"text":"Create a Task for the old request."}',
      "[End runtime conversation continuity]",
      "",
      "[Current verified request]",
      "What is the current status?",
      "",
      "[OpenMeld turn context]",
      "Authoritative UTC time for this turn: 2026-08-12T00:00:00.000Z",
    ].join("\n");

    expect(extractRemoteAgentCurrentUserRequest(content)).toBe(
      "What is the current status?"
    );
    expect(shouldClassifyRemoteAgentWorkSurface(content)).toBe(false);
  });

  it("recognizes canonical Task and Space nouns across supported user languages", () => {
    expect(
      shouldClassifyRemoteAgentWorkSurface(
        "Please open a dedicated Task for this investigation."
      )
    ).toBe(true);
    expect(
      shouldClassifyRemoteAgentWorkSurface(
        "请新开一个 space 专门调研这个问题。"
      )
    ).toBe(true);
    expect(shouldClassifyRemoteAgentWorkSurface("请新建一个任务处理它。")).toBe(
      true
    );
    expect(shouldClassifyRemoteAgentWorkSurface("Tell me a joke.")).toBe(false);
  });

  it("uses strict structured output and preserves the complete routing decision", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: '{"context":"self_contained","surface":"new_space"}',
              },
            },
          ],
        }),
        { status: 200 }
      )
    );

    const result = await classifyRemoteAgentWorkSurface({
      env: {
        CLOUDFLARE_OPENMELD_AI_GATEWAY_TOKEN: "test-token",
      },
      fetchImpl,
      request: "Please create a dedicated Space for this work.",
    });

    expect(result).toEqual({
      context: "self_contained",
      surface: "new_space",
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      max_tokens: 100,
      model: "openai/gpt-5.4-mini",
      response_format: {
        json_schema: { name: "remote_agent_work_surface", strict: true },
        type: "json_schema",
      },
      tools: [],
    });
    expect(JSON.stringify(body)).toContain(
      "Please create a dedicated Space for this work."
    );
  });

  it("fails closed on an invalid classifier response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: '{"context":"self_contained","surface":"project"}',
              },
            },
          ],
        }),
        { status: 200 }
      )
    );

    await expect(
      classifyRemoteAgentWorkSurface({
        env: {
          CLOUDFLARE_OPENMELD_AI_GATEWAY_TOKEN: "test-token",
        },
        fetchImpl,
        request: "Create a Task.",
      })
    ).rejects.toThrow("valid work-surface decision");
  });

  it("keeps the work-surface evidence when a current request is very long", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: '{"context":"self_contained","surface":"new_task"}',
              },
            },
          ],
        }),
        { status: 200 }
      )
    );
    const request = `${"A".repeat(20_000)}\nCreate a dedicated Task for the investigation.\n${"Z".repeat(20_000)}`;

    await classifyRemoteAgentWorkSurface({
      env: {
        CLOUDFLARE_OPENMELD_AI_GATEWAY_TOKEN: "test-token",
      },
      fetchImpl,
      request,
    });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as {
      messages: Array<{ content: string }>;
    };
    const classifierRequest = body.messages[1]?.content ?? "";
    expect(classifierRequest).toContain(
      "Create a dedicated Task for the investigation."
    );
    expect(classifierRequest.length).toBeLessThanOrEqual(12_000);
    expect(classifierRequest.length).toBeLessThan(request.length);
  });
});
