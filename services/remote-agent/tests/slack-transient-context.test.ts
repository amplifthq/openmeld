import {
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import type { RemoteAgentTransientSlackContextRequest } from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import {
  buildTransientSlackModel,
  runTransientSlackContextReasoning,
} from "../agent-core/slack-transient-context";
import { TEST_CENTER_AGENT_MODEL_ROUTE } from "./fixtures";

const baseInput = {
  organizationId: "org_1",
  requester: { displayName: "Felix Lu", slackUserId: "U1" },
  requestText: "What have you learned about how I work?",
  v: 1 as const,
};

describe("transient Slack context reasoning", () => {
  it("uses a configured catalog model that is newer than pi-ai's built-in catalog", () => {
    const modelRoute = {
      ...TEST_CENTER_AGENT_MODEL_ROUTE,
      contextWindow: 500_000,
      displayName: "Grok 4.6",
      inputModalities: ["text" as const, "image" as const],
      maxOutputTokens: 65_536,
      modelId: "x-ai/grok-4.6",
      preference: {
        kind: "selected_model" as const,
        modelId: "x-ai/grok-4.6",
      },
    };
    const request = {
      modelRoute,
      organizationId: "org_1",
      requestContext: {
        activeOrganizationId: "org_1",
        actorContext: {
          openMeldProfileId: "11111111-1111-4111-8111-111111111111",
          profileKind: "human" as const,
          requestId: "request_1",
        },
      },
      requester: {
        displayName: "Felix Lu",
        memberId: "member_1",
        slackUserId: "U1",
        userId: "user_1",
      },
      requestText: baseInput.requestText,
      searchAuthorization: { encryptedAuthorization: "encrypted_1" },
      v: 1 as const,
    } satisfies RemoteAgentTransientSlackContextRequest;

    expect(
      buildTransientSlackModel({
        env: {},
        headers: {},
        request,
      })
    ).toMatchObject({
      api: "openai-completions",
      contextWindow: 500_000,
      id: "x-ai/grok-4.6",
      input: ["text", "image"],
      maxTokens: 4096,
      name: "Grok 4.6",
      provider: "openrouter",
    });
  });

  it("rejects an ungrounded first answer instead of silently passing it through", async () => {
    const search = vi.fn();
    const complete = vi.fn(async () =>
      fauxAssistantMessage(fauxText("I can answer without searching."))
    );

    await expect(
      runTransientSlackContextReasoning({ complete, input: baseInput, search })
    ).rejects.toThrow("must choose a transient Slack tool");
    expect(search).not.toHaveBeenCalled();
  });

  it("preserves the provider failure instead of misreporting a missing tool call", async () => {
    const search = vi.fn();
    const complete = vi.fn(async () =>
      fauxAssistantMessage([], {
        errorMessage:
          '400 [{"code":2001,"message":"Please configure AI Gateway"}]',
        stopReason: "error",
      })
    );

    await expect(
      runTransientSlackContextReasoning({ complete, input: baseInput, search })
    ).rejects.toThrow("Please configure AI Gateway");
    expect(search).not.toHaveBeenCalled();
  });

  it("passes ordinary conversation through without reading Slack", async () => {
    const search = vi.fn();
    const complete = vi.fn((context) => {
      expect(context.systemPrompt).toContain("from:<@U1>");
      expect(context.systemPrompt).toContain(
        "If the request asks to save, remember, update a Profile Report"
      );
      expect(context.systemPrompt).toContain(
        "do not conclude from one dominant channel"
      );
      expect(context.tools?.map((tool: { name: string }) => tool.name)).toEqual(
        ["choose_transient_slack_action"]
      );
      return Promise.resolve(
        fauxAssistantMessage(
          fauxToolCall("choose_transient_slack_action", {
            action: "continue_normal_conversation",
          })
        )
      );
    });

    await expect(
      runTransientSlackContextReasoning({ complete, input: baseInput, search })
    ).resolves.toEqual({ outcome: "pass_through", v: 1 });
    expect(search).not.toHaveBeenCalled();
  });

  it("lets the model iteratively search bounded evidence and answer in first person", async () => {
    const search = vi
      .fn()
      .mockResolvedValueOnce({
        messages: [
          {
            authorName: "Felix Lu",
            authorUserId: "U1",
            channelId: "C1",
            channelName: "product",
            content: "I am prioritizing the onboarding experience this week.",
            contextMessages: [],
            isAuthorBot: false,
            messageTs: "1.1",
            permalink: "https://example.slack.com/archives/C1/p11",
          },
        ],
        moreResultsAvailable: false,
        status: "found",
        v: 1,
      })
      .mockResolvedValueOnce({
        messages: [],
        moreResultsAvailable: false,
        status: "found",
        v: 1,
      });
    const complete = vi
      .fn()
      .mockResolvedValueOnce(
        fauxAssistantMessage(
          fauxToolCall("choose_transient_slack_action", {
            action: "search_slack_messages",
            includeBots: false,
            query: 'from:<@U1> "onboarding"',
          })
        )
      )
      .mockResolvedValueOnce(
        fauxAssistantMessage(
          fauxToolCall("search_slack_messages", {
            includeBots: false,
            query: 'from:<@U1> "customer"',
          })
        )
      )
      .mockResolvedValueOnce(
        fauxAssistantMessage(
          fauxText(
            "我查了你在公开 Slack 频道里的相关发言。我看到你这周把 onboarding 体验放在第一优先级。<https://example.slack.com/archives/C1/p11|查看原消息>"
          )
        )
      );

    const result = await runTransientSlackContextReasoning({
      complete,
      input: baseInput,
      search,
    });

    expect(result).toEqual({
      outcome: "answered",
      text: expect.stringContaining("我查了"),
      v: 1,
    });
    expect(search).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(result)).not.toContain("prioritizing");
  });

  it("closes Slack search and answers before a fourth call", async () => {
    const search = vi.fn(async () => ({
      messages: [],
      moreResultsAvailable: true,
      status: "found" as const,
      v: 1 as const,
    }));
    const complete = vi
      .fn()
      .mockResolvedValueOnce(
        fauxAssistantMessage(
          fauxToolCall("choose_transient_slack_action", {
            action: "search_slack_messages",
            query: "first query",
          })
        )
      )
      .mockImplementation((context) => {
        if (context.tools?.length === 0) {
          expect(context.systemPrompt).toContain("Slack search is now closed");
          return Promise.resolve(
            fauxAssistantMessage(fauxText("我已经查完，并会基于现有证据回答。"))
          );
        }
        return Promise.resolve(
          fauxAssistantMessage(
            fauxToolCall("search_slack_messages", { query: "another query" })
          )
        );
      });

    await expect(
      runTransientSlackContextReasoning({ complete, input: baseInput, search })
    ).resolves.toEqual({
      outcome: "answered",
      text: "我已经查完，并会基于现有证据回答。",
      v: 1,
    });
    expect(search).toHaveBeenCalledTimes(3);
  });
});
