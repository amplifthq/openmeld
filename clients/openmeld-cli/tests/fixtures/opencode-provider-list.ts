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
