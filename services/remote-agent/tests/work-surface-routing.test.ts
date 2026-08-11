import { describe, expect, it, vi } from "vitest";
import {
  classifyRemoteAgentWorkSurface,
  extractRemoteAgentCurrentUserRequest,
  shouldClassifyRemoteAgentWorkSurface,
} from "../agent-core/work-surface-routing";

describe("Remote Agent work-surface routing", () => {
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

  it("uses strict structured output and returns the classified surface", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"surface":"new_space"}' } }],
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

    expect(result).toBe("new_space");
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      max_tokens: 80,
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
          choices: [{ message: { content: '{"surface":"project"}' } }],
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
          choices: [{ message: { content: '{"surface":"new_task"}' } }],
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
