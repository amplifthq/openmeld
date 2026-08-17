import { describe, expect, it, vi } from "vitest";
import { summarizeAgentActivityDigest } from "../agent-core/agent-activity-digest";
import { TEST_REMOTE_AGENT_AI_GATEWAY_ENV } from "./fixtures";

describe("Remote Agent Activity digest summarization", () => {
  it("uses a configured no-tool structured-output model request", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                citations: [{ eventId: "event-1", observedAtMs: 1000 }],
                summary: "Mira's Codex session event-1 was active at 1000 UTC.",
              }),
            },
          },
        ],
      })
    );
    const response = await summarizeAgentActivityDigest({
      env: {
        ...TEST_REMOTE_AGENT_AI_GATEWAY_ENV,
        OPENMELD_AGENT_ACTIVITY_DIGEST_MODEL_ID: "openai/gpt-5-nano",
      },
      fetch,
      request: {
        eventCount: 150,
        evidence: [
          {
            eventId: "event-1",
            eventType: "session_active",
            memberName: "Mira",
            observedAtMs: 1000,
            provider: "codex",
            status: "active",
            title: "Agent Activity",
          },
        ],
        organizationId: "org-1",
        projectId: "project-1",
        windowEndedAtMs: 1000,
        windowStartedAtMs: 1000,
      },
    });

    expect(
      response.summary.startsWith(
        "Based on 1 sampled events out of 150 total events in this window:"
      )
    ).toBe(true);
    const request = fetch.mock.calls[0]?.[1];
    const body = JSON.parse(String(request?.body));
    expect(body).toMatchObject({
      model: "openai/gpt-5-nano",
      provider: { allow_fallbacks: true },
      response_format: {
        json_schema: { name: "agent_activity_digest", strict: true },
        type: "json_schema",
      },
      stream: false,
      tools: [],
    });
    expect(body.messages[0].content).toContain("untrusted data");
    expect(body.messages[1].content).toContain('"eventCount":150');
    expect(body.messages[1].content).toContain('"sampledEvidenceCount":1');
  });

  it("rejects an oversized model response before parsing it", async () => {
    await expect(
      summarizeAgentActivityDigest({
        env: {
          ...TEST_REMOTE_AGENT_AI_GATEWAY_ENV,
          OPENMELD_AGENT_ACTIVITY_DIGEST_MODEL_ID: "openai/gpt-5-nano",
        },
        fetch: async () =>
          Response.json({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    citations: [{ eventId: "event-1", observedAtMs: 1000 }],
                    summary: "x".repeat(70_000),
                  }),
                },
              },
            ],
          }),
        request: {
          eventCount: 1,
          evidence: [
            {
              eventId: "event-1",
              eventType: "session_active",
              memberName: "Mira",
              observedAtMs: 1000,
              provider: "codex",
              status: "active",
              title: "Agent Activity",
            },
          ],
          organizationId: "org-1",
          projectId: "project-1",
          windowEndedAtMs: 1000,
          windowStartedAtMs: 1000,
        },
      })
    ).rejects.toThrow("response exceeded");
  });
});
