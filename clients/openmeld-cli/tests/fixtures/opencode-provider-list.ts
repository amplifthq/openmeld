import type { ProviderListResponse } from "@opencode-ai/sdk/v2";

// Representative provider-list payload constrained by OpenCode's generated
// SDK contract. Keep controller-probe tests on this vendor-owned shape.
export const OPENCODE_CONNECTED_PROVIDER_LIST_RESPONSE = {
  all: [
    {
      env: [],
      id: "openai",
      models: {
        "gpt-5.4": {
          api: {
            id: "gpt-5.4",
            npm: "@ai-sdk/openai",
            url: "https://api.openai.com/v1",
          },
          capabilities: {
            attachment: true,
            input: {
              audio: false,
              image: true,
              pdf: true,
              text: true,
              video: false,
            },
            interleaved: false,
            output: {
              audio: false,
              image: false,
              pdf: false,
              text: true,
              video: false,
            },
            reasoning: true,
            temperature: true,
            toolcall: true,
          },
          cost: {
            cache: {
              read: 0,
              write: 0,
            },
            input: 0,
            output: 0,
          },
          headers: {},
          id: "gpt-5.4",
          limit: {
            context: 1_000_000,
            output: 128_000,
          },
          name: "GPT-5.4",
          options: {},
          providerID: "openai",
          release_date: "2026-07-01",
          status: "active",
        },
      },
      name: "OpenAI",
      options: {},
      source: "config",
    },
  ],
  connected: ["openai"],
  default: {},
} satisfies ProviderListResponse;

// Captured from OpenCode 1.19.0 GET /provider on 2026-10-21.
// Retains one model; credentials and provider options are omitted.
export const OPENCODE_OPENROUTER_PROVIDER_LIST_RESPONSE = {
  all: [
    {
      id: "openrouter",
      name: "OpenRouter",
      env: [],
      source: "config",
      options: {},
      models: {
        "minimax/minimax-m3.1-flash:free": {
          id: "minimax/minimax-m3.1-flash:free",
          providerID: "openrouter",
          api: {
            id: "minimax/minimax-m3.1-flash:free",
            url: "https://openrouter.ai/api/v1",
            npm: "@openrouter/ai-sdk-provider",
          },
          name: "MiniMax M3.1 Flash (free)",
          family: "minimax",
          capabilities: {
            temperature: true,
            reasoning: true,
            attachment: true,
            toolcall: true,
            input: {
              text: true,
              audio: false,
              image: true,
              video: true,
              pdf: false,
            },
            output: {
              text: true,
              audio: false,
              image: false,
              video: false,
              pdf: false,
            },
            interleaved: false,
          },
          cost: {
            input: 0,
            output: 0,
            cache: {
              read: 0,
              write: 0,
            },
          },
          limit: {
            context: 1_000_000,
            output: 524_288,
          },
          status: "active",
          options: {},
          headers: {},
          release_date: "2026-10-19",
          variants: {
            low: {
              reasoning: {
                effort: "low",
              },
            },
            medium: {
              reasoning: {
                effort: "medium",
              },
            },
            high: {
              reasoning: {
                effort: "high",
              },
            },
            xhigh: {
              reasoning: {
                effort: "xhigh",
              },
            },
            max: {
              reasoning: {
                effort: "max",
              },
            },
          },
        },
      },
    },
  ],
  connected: ["openrouter"],
  default: {},
} satisfies ProviderListResponse;
