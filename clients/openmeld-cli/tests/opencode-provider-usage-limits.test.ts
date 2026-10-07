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
      environment: { OPENCODE_API_KEY: "different-env-key" },
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

  it("reads the captured OpenRouter free-model counter even when the monetary budget is unbounded", async () => {
    // Redacted /api/v1/key response observed on 2026-10-01 with the locally
    // configured OpenCode key. No model request was made.
    const fetchFn = vi.fn().mockResolvedValue(
      Response.json({
        data: {
          is_free_tier: false,
          limit: null,
          limit_remaining: null,
          free_model_daily_requests: {
            limit: 1000,
            used: 0,
            remaining: 1000,
          },
        },
      })
    );
    const limits = await readOpenCodeProviderUsageLimits({
      authContent: JSON.stringify({
        openrouter: { type: "api", key: "local-router-key" },
      }),
      environment: {},
      observedAt: OBSERVED_AT,
      providerList: createProviderList(["openrouter"]),
      fetchFn,
    });
    expect(limits).toEqual([
      {
        key: "openrouter:free-model-daily",
        label: "Free models daily requests",
        provider: { id: "openrouter", displayName: "OpenRouter" },
        observedAt: OBSERVED_AT,
        resetsAt: null,
        usedPercent: 0,
        status: "available",
      },
    ]);
    expect(fetchFn).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/key",
      expect.objectContaining({
        redirect: "error",
        headers: { authorization: "Bearer local-router-key" },
      })
    );
    expect(JSON.stringify(limits)).not.toContain("local-router-key");
  });

  it("uses the Go environment key only without stored auth and distinguishes no entitlement from a failed refresh", async () => {
    for (const status of [403, 500]) {
      const fetchFn = vi.fn().mockResolvedValue(new Response(null, { status }));
      const limits = await readOpenCodeProviderUsageLimits({
        authContent: "{}",
        environment: { OPENCODE_API_KEY: "go-env-key" },
        observedAt: OBSERVED_AT,
        providerList: createProviderList(["opencode-go"]),
        fetchFn,
      });
      expect(limits[0]?.reason).toBe(
        status === 403 ? "not_applicable" : "refresh_failed"
      );
      expect(fetchFn).toHaveBeenCalledWith(
        "https://opencode.ai/zen/go/v1/usage",
        expect.objectContaining({
          headers: { authorization: "Bearer go-env-key" },
        })
      );
    }
  });

  it("does not send a custom provider's credential to the default account endpoint", async () => {
    const providerList = createProviderList(["openrouter"]);
    for (const provider of providerList.all) {
      provider.options.baseURL = "https://proxy.example.com/v1";
    }
    const fetchFn = vi.fn();
    const limits = await readOpenCodeProviderUsageLimits({
      authContent: JSON.stringify({
        openrouter: { type: "api", key: "proxy-key" },
      }),
      observedAt: OBSERVED_AT,
      providerList,
      fetchFn,
    });
    expect(limits[0]?.reason).toBe("not_applicable");
    expect(fetchFn).not.toHaveBeenCalled();
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
      name:
        (
          {
            "opencode-go": "OpenCode Go",
            openai: "OpenAI",
            openrouter: "OpenRouter",
          } as Record<string, string>
        )[id] ?? id,
      options: {},
      source: "config",
    })),
    connected,
    default: {},
  } as ProviderListResponse;
}
