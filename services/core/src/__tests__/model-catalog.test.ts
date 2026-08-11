import { describe, expect, it } from "vitest";
import { createHttpApp } from "../app";
import { readModelCatalog } from "../config/model-catalog";

describe("model catalog config", () => {
  it("reads the repo-owned release catalog without touching runtime state", () => {
    const catalog = readModelCatalog();

    expect(catalog.agentControllers.codex?.defaultModelId).toBe("gpt-5.5");
    expect(catalog.agentControllers["claude-code"]?.defaultModelId).toBe(
      "claude-opus-4-8"
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

    expect(catalog).toEqual(readModelCatalog());
    expect(catalog).toMatchObject({
      schemaVersion: 1,
      agentControllers: {
        codex: {
          defaultModelId: "gpt-5.5",
        },
        cursor: {
          defaultModelId: "default[]",
        },
      },
    });
    expect(
      catalog.agentControllers.codex?.models.map((model) => model.id)
    ).toEqual(
      expect.arrayContaining(["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"])
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
