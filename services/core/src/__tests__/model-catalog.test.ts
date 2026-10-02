import { describe, expect, it } from "vitest";
import { createHttpApp } from "../app";
import {
  projectModelCatalog,
  readAuthoredModelCatalog,
  readModelCatalog,
} from "../config/model-catalog";

describe("model catalog config", () => {
  it("requires opt-in for retirement metadata without changing legacy availability", () => {
    const authored = readAuthoredModelCatalog();
    const model = authored.agentControllers.codex?.models.find(
      (entry) => entry.id === "gpt-5.4"
    );
    if (!model) {
      throw new Error("Test catalog is missing GPT-5.4");
    }
    model.retirement = {
      status: "withdrawn",
      date: { value: "2000-01-01", kind: "on" },
      scope: { controllerRef: "builtin:codex", authType: "chatgpt" },
      sourceUrl: "https://example.com/official-notice",
      verifiedAt: "2026-09-23T00:00:00Z",
    };
    const legacy = projectModelCatalog(authored);
    const modern = projectModelCatalog(authored, { retirement: true });
    const findModel = (catalog: typeof authored) =>
      catalog.agentControllers.codex?.models.find(
        (entry) => entry.id === model.id
      );
    expect(findModel(legacy)).not.toHaveProperty("retirement");
    expect(findModel(legacy)?.unavailable).toBe(false);
    expect(
      legacy.agentControllers["center-agent"]?.hostedRuntimePolicy
    ).not.toHaveProperty("personalRemoteAgentDefaultModelId");
    expect(findModel(modern)?.retirement).toEqual(model.retirement);
    expect(
      modern.agentControllers["center-agent"]?.hostedRuntimePolicy
    ).not.toHaveProperty("personalRemoteAgentDefaultModelId");
    expect(modern.agentControllers.codex).not.toHaveProperty(
      "creationDefaults"
    );
    expect(model.retirement.status).toBe("withdrawn");
  });

  it("reads the repo-owned release catalog without touching runtime state", () => {
    const catalog = readModelCatalog();
    expect(catalog.agentControllers.codex).not.toHaveProperty(
      "creationDefaults"
    );

    expect(catalog.agentControllers.codex?.defaultModelId).toBe("gpt-6.1-sol");
    expect(catalog.agentControllers["claude-code"]?.defaultModelId).toBe(
      "claude-opus-5"
    );
    expect(catalog.agentControllers["center-agent"]?.defaultModelId).toBe(
      "anthropic/claude-opus-5.5"
    );
    expect(
      catalog.agentControllers["center-agent"]?.hostedRuntimePolicy
        ?.personalRemoteAgentDefaultModelId
    ).toBe("openai/gpt-6-sol");
    expect(catalog.agentControllers.opencode?.defaultModelId).toBe(
      "opencode/mimo-v2.6-flash-free"
    );
  });

  it("serves the model catalog as a public config route", async () => {
    const app = createHttpApp();
    const response = await app.fetch(
      new Request("http://local/v1/config/model-catalog"),
      {} as CloudflareBindings,
      {
        waitUntil: () => undefined,
        passThroughOnException: () => undefined,
        props: {},
        exports: {},
      } as unknown as ExecutionContext
    );

    expect(response.status).toBe(200);
    const catalog = (await response.json()) as ReturnType<
      typeof readModelCatalog
    >;

    expect(catalog).toEqual(
      readModelCatalog({ retirement: false, personalRemoteAgentDefault: false })
    );
    expect(catalog).toMatchObject({
      schemaVersion: 1,
      agentControllers: {
        codex: {
          defaultModelId: "gpt-6.1-sol",
        },
        cursor: {
          defaultModelId: "default[]",
        },
        opencode: {
          defaultModelId: "opencode/mimo-v2.6-flash-free",
        },
        "center-agent": {
          defaultModelId: "anthropic/claude-opus-5.5",
          hostedRuntimePolicy: {
            automaticModelFallback: false,
          },
        },
      },
    });
    expect(
      catalog.agentControllers["center-agent"]?.hostedRuntimePolicy
    ).not.toHaveProperty("personalRemoteAgentDefaultModelId");
    const optedInResponse = await app.fetch(
      new Request(
        "http://local/v1/config/model-catalog?personalRemoteAgentDefault=1"
      ),
      {} as CloudflareBindings,
      {
        waitUntil: () => undefined,
        passThroughOnException: () => undefined,
        props: {},
        exports: {},
      } as unknown as ExecutionContext
    );
    expect(optedInResponse.status).toBe(200);
    const optedInCatalog = (await optedInResponse.json()) as ReturnType<
      typeof readModelCatalog
    >;
    expect(
      optedInCatalog.agentControllers["center-agent"]?.hostedRuntimePolicy
        ?.personalRemoteAgentDefaultModelId
    ).toBe("openai/gpt-6-sol");
    expect(
      catalog.agentControllers.codex?.models.map((model) => model.id)
    ).toEqual(
      expect.arrayContaining([
        "gpt-5.6-sol",
        "gpt-5.6-terra",
        "gpt-5.6-luna",
        "gpt-5.5",
      ])
    );
    expect(
      catalog.agentControllers["claude-code"]?.models.map((model) => model.id)
    ).toEqual(
      expect.arrayContaining([
        "claude-fable-5",
        "claude-opus-5",
        "claude-sonnet-5",
      ])
    );
    expect(
      catalog.agentControllers.cursor?.models.map((model) => model.id)
    ).toEqual(
      expect.arrayContaining([
        "default[]",
        "gpt-5.6-sol[context=272k,reasoning=medium,fast=false]",
      ])
    );
  });
});
