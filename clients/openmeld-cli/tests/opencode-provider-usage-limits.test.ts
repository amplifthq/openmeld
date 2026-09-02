import type { ProviderListResponse } from "@opencode-ai/sdk/v2";
import { describe, expect, it, vi } from "vitest";
import { readOpenCodeProviderUsageLimits } from "../src/local-service/inventory/opencode-readiness-probe";

const OBSERVED_AT = "2026-09-02T08:00:00.000Z";

describe("OpenCode provider usage limits", () => {
  it("uses the local OpenCode Go credential only for the official usage request", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          usage: {
            monthly: {
              percent: 60,
              resetsAt: "2026-10-01T00:00:00.000Z",
              status: "ok",
            },
            rolling: {
              percent: 25,
              resetsAt: "2026-09-02T10:00:00.000Z",
              status: "ok",
            },
            weekly: {
              percent: 40,
              resetsAt: "2026-09-07T00:00:00.000Z",
              status: "ok",
            },
          },
        }),
        { status: 200 }
      )
    );

    const limits = await readOpenCodeProviderUsageLimits({
      authContent: JSON.stringify({
        "opencode-go": { key: "secret-local-key", type: "api" },
      }),
      fetchFn,
      observedAt: OBSERVED_AT,
      providerList: createProviderList(["opencode-go"]),
    });

    expect(fetchFn).toHaveBeenCalledWith(
      "https://opencode.ai/zen/go/v1/usage",
      expect.objectContaining({
        headers: { authorization: "Bearer secret-local-key" },
      })
    );
    expect(limits).toHaveLength(3);
    expect(limits.every((limit) => limit.provider?.id === "opencode-go")).toBe(
      true
    );
    expect(JSON.stringify(limits)).not.toContain("secret-local-key");
  });

  it("reports other connected providers as unsupported without making a quota request", async () => {
    const fetchFn = vi.fn();

    expect(
      await readOpenCodeProviderUsageLimits({
        authContent: "{}",
        fetchFn,
        observedAt: OBSERVED_AT,
        providerList: createProviderList(["openai"]),
      })
    ).toEqual([
      {
        key: "openai:provider",
        label: "Usage limits",
        observedAt: OBSERVED_AT,
        provider: { displayName: "OpenAI", id: "openai" },
        resetsAt: null,
        status: "unsupported",
        usedPercent: null,
      },
    ]);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

function createProviderList(connected: string[]): ProviderListResponse {
  return {
    all: connected.map((id) => ({
      env: [],
      id,
      models: {},
      name: id === "opencode-go" ? "OpenCode Go" : "OpenAI",
      options: {},
      source: "config",
    })),
    connected,
    default: {},
  } as ProviderListResponse;
}
