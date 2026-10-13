import type {
  Model,
  OpenAICompletionsCompat,
  StreamOptions,
} from "@earendil-works/pi-ai";
import { createProvider } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all";
import { setProvider } from "@flue/runtime";
import { getCloudflareContext } from "@flue/runtime/cloudflare";
import type { CenterAgentModelRoute } from "@openmeld/schemas/types";
import * as z from "zod/v4";
import { readRemoteAgentCallbackContext } from "../agent-core/callback-context";
import {
  allowsRemoteAgentContentDiagnostics,
  remoteAgentDiagnosticErrorFields,
} from "../agent-core/diagnostics-content-policy";
import {
  buildRemoteAgentAiGatewayHeaders,
  buildRemoteAgentGatewayMetadata,
  REMOTE_AGENT_MAX_OUTPUT_TOKENS,
  REMOTE_AGENT_OPENROUTER_MODEL_ID,
  resolveRemoteAgentAiGatewayOpenRouterBaseUrl,
  resolveRemoteAgentFlueModelSpecifier,
  resolveRemoteAgentOpenRouterModelId,
} from "../agent-core/model";
import { REMOTE_AGENT_OPENROUTER_PROVIDER_ROUTING } from "../agent-core/openrouter-provider-routing";
import { withRemoteAgentProviderTimeContext } from "../agent-core/prompt";
import { recordRemoteAgentTurnObservabilityBestEffort } from "../agent-core/turn-observability";
import { createFlueMeteredFetch } from "./ai-usage";
import { emitCenterAgentPerformanceMilestone } from "./center-agent-performance-observability";
import { emitRemoteAgentExecutionStageEvidence } from "./cloudflare-runtime-evidence";
import {
  getRemoteAgentDeferredToolCount,
  getRemoteAgentExecutionSubmissionId,
  updateRemoteAgentMessageReadBudget,
} from "./execution-context";
import { resolveReviewedPromptPriceTierBoundary } from "./model-context-policy";
import {
  projectProviderCompletion,
  providerCompletionOperation,
  providerCompletionSucceeded,
} from "./provider-completion";
import {
  assertRemoteAgentProviderContextFits,
  measureRemoteAgentProviderContext,
  type RemoteAgentProviderContextCapacity,
  resolveRemoteAgentCompactionReserveTokens,
  resolveRemoteAgentProviderContextCapacity,
} from "./provider-context-capacity";
import { guardRemoteAgentProviderStream } from "./provider-failure";
import { retryCompletedEmptyAssistantStreamOnce } from "./provider-stream-retry";
import { createRemoteAgentSqlStorage } from "./storage";

const OPENROUTER_MODEL_METADATA_BASE_URL = "https://openrouter.ai/api/v1/model";
const OPENAI_GPT_5_4_MINI_MODEL_ID = "openai/gpt-5.4-mini";
// OpenRouter's documented Alibaba routes and current Model Studio cache support.
// https://openrouter.ai/docs/guides/best-practices/prompt-caching
// https://www.alibabacloud.com/help/en/model-studio/context-cache
// Snapshot and open-weight Qwen endpoints do not inherit this capability.
const OPENROUTER_MESSAGE_ONLY_PROMPT_CACHE_MODEL_IDS = new Set([
  "deepseek/deepseek-v3.2",
  "qwen/qwen-plus",
  "qwen/qwen3-max",
  "qwen/qwen3.6-plus",
  "qwen/qwen3-coder-plus",
  "qwen/qwen3-coder-flash",
  "qwen/qwen3.6-flash",
  "qwen/qwen3.7-max",
  "qwen/qwen3.7-plus",
  "qwen/qwen3.7-flash",
  "qwen/qwen3.8-max-0902",
  "qwen/qwen3.8-flash",
]);
export const REMOTE_AGENT_MODEL_METADATA_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const REMOTE_AGENT_COMPACTION_KEEP_RECENT_TOKENS = 8000;
export const REMOTE_AGENT_WORKING_CONTEXT_TOKENS = 48_000;
export const REMOTE_AGENT_MAX_SUMMARY_TOKENS = 4096;
export const REMOTE_AGENT_SUMMARY_TARGET_TOKENS = 2048;
const WORKING_CONTEXT_DEFERRAL_TOKENS = 8000;
const MODEL_METADATA_FETCH_TIMEOUT_MS = 3000;
// Flue estimates context tokens, so compact before reaching a provider tier.
const PRICE_TIER_COMPACTION_SAFETY_RATIO = 0.8;

const positiveIntegerSchema = z.number().int().positive();
const openRouterPricingOverrideSchema = z
  .object({
    min_prompt_tokens: z.unknown().nullish(),
  })
  .passthrough()
  .nullish()
  .catch(null);
type OpenRouterPricingOverride = z.output<
  typeof openRouterPricingOverrideSchema
>;
const openRouterPricingSchema = z
  .object({
    overrides: z.array(openRouterPricingOverrideSchema).nullish().catch(null),
  })
  .passthrough()
  .nullish()
  .catch(null);
const openRouterModelMetadataResponseSchema = z.object({
  data: z.object({
    context_length: positiveIntegerSchema,
    id: z.string().trim().min(1),
    pricing: openRouterPricingSchema,
    top_provider: z
      .object({
        context_length: positiveIntegerSchema.nullable().optional(),
        max_completion_tokens: positiveIntegerSchema.nullable().optional(),
      })
      .nullish(),
  }),
});

type RemoteAgentModelEnv = {
  OPENMELD_CORE_WORKER?: unknown;
  OPENMELD_CENTER_AGENT_PERFORMANCE?: AnalyticsEngineDataset;
  OPENMELD_OBSERVABILITY?: AnalyticsEngineDataset;
  OPENMELD_REMOTE_AGENT_AI_GATEWAY_ACCOUNT_ID?: string;
  OPENMELD_REMOTE_AGENT_AI_GATEWAY_ID?: string;
  CLOUDFLARE_OPENMELD_AI_GATEWAY_TOKEN?: string;
  OPENMELD_REMOTE_AGENT_OPENROUTER_BYOK_ALIAS?: string;
  OPENMELD_REMOTE_AGENT_OPENROUTER_MODEL_ID?: string;
  OPENMELD_WORKER_ENVIRONMENT?: string;
};

export type RemoteAgentProviderStageObservation = {
  availableToolCount?: number;
  durationMs: number;
  inputBytes?: number;
  messageCount?: number;
  modelId: string | null;
  observedAtMs: number;
  stage: "request_prepared" | "response_headers";
  status: "succeeded";
  statusCode?: number;
  submissionId: string | null;
  toolCount?: number;
};

export type RemoteAgentModelRuntimeConfig = {
  compaction: {
    workingContextHeadroomTokens: number;
    keepRecentTokens: number;
    reserveTokens: number;
    workingContextTokens: number;
    maxWorkingContextTokens: number;
    preserveActiveInput: true;
    thinkingLevel: "low";
    maxSummaryTokens: number;
    summaryTargetTokens: number;
  };
  contextWindow: number;
  maxTokens: number;
  modelId: string;
  modelSpecifier: string;
};

type CachedModelRuntimeConfig = {
  expiresAtMs: number;
  refresh: Promise<void> | null;
  value: RemoteAgentModelRuntimeConfig;
};

type FetchModelMetadata = (
  url: string,
  init?: RequestInit
) => Promise<Response>;

const modelRuntimeConfigCache = new Map<string, CachedModelRuntimeConfig>();
type RegisteredRemoteAgentModelCapabilities = {
  allowContentDiagnostics: boolean;
  meterFetch: (fetch?: typeof globalThis.fetch) => typeof globalThis.fetch;
  reportCompletion: (
    completion: ReturnType<typeof projectProviderCompletion>
  ) => void;
  compat: OpenAICompletionsCompat;
  contextCapacity: RemoteAgentProviderContextCapacity;
  cost?: Model<"openai-completions">["cost"];
  inputModalities: readonly ("image" | "text")[];
  modelId: string;
  reasoningLevel: CenterAgentModelRoute["reasoningLevel"];
  reportStage?: (
    observation: RemoteAgentProviderStageObservation
  ) => Promise<void> | void;
};
const registeredRemoteAgentModelCapabilities = new Map<
  string,
  RegisteredRemoteAgentModelCapabilities
>();

export async function registerRemoteAgentCloudflareProvider(input: {
  env: RemoteAgentModelEnv;
  modelRoute?: CenterAgentModelRoute | null;
  organizationId?: string | null;
}): Promise<RemoteAgentModelRuntimeConfig> {
  const runtimeConfig =
    await resolveRemoteAgentModelRuntimeConfigForRegistration({
      env: input.env,
      modelRoute: input.modelRoute,
    });
  const { contextWindow, maxTokens, modelId } = runtimeConfig;
  const providerId = await buildRemoteAgentScopedProviderId({
    modelId,
    modelRoute: input.modelRoute,
    organizationId: input.organizationId,
  });
  const openRouterModel = getBuiltinModels("openrouter").find(
    (model) => model.id === modelId && model.api === "openai-completions"
  ) as Model<"openai-completions"> | undefined;
  registeredRemoteAgentModelCapabilities.set(providerId, {
    allowContentDiagnostics: allowsRemoteAgentContentDiagnostics(input),
    meterFetch: (fetch) =>
      createFlueMeteredFetch({
        env: input.env,
        coreWorker: input.env.OPENMELD_CORE_WORKER,
        model: modelId,
        fetch,
      }),
    reportCompletion: (completion) => {
      const succeeded = providerCompletionSucceeded(completion);
      if (succeeded) {
        console.info(completion);
      } else {
        console.warn(completion);
      }
      emitRemoteAgentExecutionStageEvidence(input.env, {
        category: "provider",
        durationMs: completion.durationMs,
        operation: providerCompletionOperation(completion),
        requestId: completion.submissionId,
        status: succeeded ? "succeeded" : "failed",
        toolCount: completion.toolCallCount,
      });
    },
    compat: {
      supportsDeveloperRole:
        modelId.startsWith("anthropic/") || modelId.startsWith("openai/"),
      ...openRouterModel?.compat,
      // Scoped provider IDs bypass pi-ai's OpenRouter cache detection.
      cacheControlFormat:
        modelId.startsWith("anthropic/") ||
        OPENROUTER_MESSAGE_ONLY_PROMPT_CACHE_MODEL_IDS.has(modelId)
          ? "anthropic"
          : openRouterModel?.compat?.cacheControlFormat,
      ...(OPENROUTER_MESSAGE_ONLY_PROMPT_CACHE_MODEL_IDS.has(modelId)
        ? { supportsLongCacheRetention: false }
        : {}),
      thinkingFormat: "openrouter",
    },
    contextCapacity: resolveRemoteAgentProviderContextCapacity({
      contextWindow,
      // Economic compaction is a soft trigger. The summarizer must still be
      // able to read the history that crossed it; provider admission enforces
      // the physical window, not the cheaper prompt-price band.
      reserveTokens: resolveRemoteAgentCompactionReserveTokens(contextWindow),
    }),
    cost: openRouterModel?.cost,
    inputModalities: input.modelRoute?.inputModalities ?? ["text", "image"],
    modelId,
    reasoningLevel: input.modelRoute?.reasoningLevel ?? "high",
    reportStage: async (observation) => {
      if (!observation.submissionId) {
        return;
      }
      emitRemoteAgentExecutionStageEvidence(input.env, {
        category: "provider",
        durationMs: observation.durationMs,
        inputBytes: observation.inputBytes,
        messageCount: observation.messageCount,
        operation: observation.stage,
        requestId: observation.submissionId,
        status: observation.status,
        statusCode: observation.statusCode,
        toolCount: observation.toolCount,
      });
      const cloudflare = getCloudflareContext();
      const storage = createRemoteAgentSqlStorage(cloudflare.storage.sql);
      await recordRemoteAgentTurnObservabilityBestEffort({
        event:
          observation.stage === "request_prepared"
            ? {
                availableToolCount: observation.availableToolCount ?? 0,
                exposedToolCount: observation.toolCount ?? 0,
                modelId: observation.modelId,
                observedAtMs: observation.observedAtMs,
                type: "provider_request_prepared",
              }
            : {
                modelId: observation.modelId,
                observedAtMs: observation.observedAtMs,
                type: "provider_response_headers",
              },
        storage,
        submissionId: observation.submissionId,
      });
      const context = await readRemoteAgentCallbackContext(
        storage,
        observation.submissionId
      );
      if (context) {
        emitCenterAgentPerformanceMilestone(input.env, {
          availableToolCount: observation.availableToolCount,
          context,
          exposedToolCount: observation.toolCount,
          milestone:
            observation.stage === "request_prepared"
              ? "provider_request_prepared"
              : "provider_response_headers",
          modelId: observation.modelId,
          observedAtMs: observation.observedAtMs,
          stageDurationMs: observation.durationMs,
          statusCode: observation.statusCode,
        });
      }
    },
  });
  const metadata = buildRemoteAgentGatewayMetadata({
    modelId,
    organizationId: input.organizationId,
  });
  setProvider(
    createProvider({
      id: providerId,
      auth: {
        apiKey: {
          name: "OpenMeld AI Gateway",
          resolve: async () => ({ auth: { apiKey: "unused" } }),
        },
      },
      api: createRemoteAgentModelCapabilitiesApi(),
      models: [
        declareRemoteAgentModelCapabilities({
          id: modelId,
          name: input.modelRoute?.displayName ?? modelId,
          api: "openai-completions",
          provider: providerId,
          baseUrl: resolveRemoteAgentAiGatewayOpenRouterBaseUrl(input.env),
          headers: buildRemoteAgentAiGatewayHeaders({
            env: input.env,
            organizationId: input.organizationId,
            metadata,
          }) as Record<string, string>,
          reasoning: input.modelRoute?.reasoningLevel !== "off",
          input: input.modelRoute?.inputModalities ?? ["text", "image"],
          cost: openRouterModel?.cost ?? {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
          },
          contextWindow,
          maxTokens,
        }),
      ],
    })
  );
  return {
    ...runtimeConfig,
    modelSpecifier: `${providerId}/${modelId}`,
  };
}

async function buildRemoteAgentScopedProviderId(input: {
  modelId: string;
  modelRoute?: CenterAgentModelRoute | null;
  organizationId?: string | null;
}): Promise<string> {
  let routeIdentity = "legacy-v1";
  if (input.modelRoute) {
    routeIdentity = [
      input.modelRoute.catalogUpdatedAt,
      input.modelRoute.contextWindow,
      input.modelRoute.maxOutputTokens,
      input.modelRoute.reasoningLevel,
      input.modelRoute.inputModalities.join(","),
    ].join(":");
  }
  const identity = [
    input.organizationId?.trim() || "unattributed",
    input.modelId,
    routeIdentity,
  ].join("\n");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(identity)
  );
  const suffix = Array.from(new Uint8Array(digest).slice(0, 12), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return `openrouter-${suffix}`;
}

export async function resolveRemoteAgentModelRuntimeConfig(input: {
  env: RemoteAgentModelEnv;
  fetchModelMetadata?: FetchModelMetadata;
}): Promise<RemoteAgentModelRuntimeConfig> {
  const modelId = resolveRemoteAgentOpenRouterModelId(input.env);
  const response = await fetchRemoteAgentModelMetadata({
    fetchModelMetadata:
      input.fetchModelMetadata ?? ((url, init) => globalThis.fetch(url, init)),
    modelId,
  });
  if (!response.ok) {
    throw new Error(
      `OpenRouter model metadata lookup failed for ${modelId} with HTTP ${response.status}.`
    );
  }
  const payload = await response.json().catch(() => null);
  const parsed = openRouterModelMetadataResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error(`OpenRouter model metadata is invalid for ${modelId}.`);
  }
  if (parsed.data.data.id !== modelId) {
    throw new Error(
      `OpenRouter model metadata returned ${parsed.data.data.id} for ${modelId}.`
    );
  }
  return buildRemoteAgentModelRuntimeConfig({
    contextLength: parsed.data.data.context_length,
    env: input.env,
    modelId,
    pricingOverrides: parsed.data.data.pricing?.overrides,
    providerContextLength:
      parsed.data.data.top_provider?.context_length ?? null,
    providerMaxCompletionTokens:
      parsed.data.data.top_provider?.max_completion_tokens ?? null,
  });
}

export function resolveRemoteAgentOpenRouterModelMetadataUrl(
  modelId: string
): string {
  const separatorIndex = modelId.indexOf("/");
  if (separatorIndex <= 0 || separatorIndex === modelId.length - 1) {
    throw new Error(
      "OpenRouter model metadata requires an id like x-ai/grok-4.5."
    );
  }
  const author = modelId.slice(0, separatorIndex);
  const slug = modelId.slice(separatorIndex + 1);
  return `${OPENROUTER_MODEL_METADATA_BASE_URL}/${encodeURIComponent(
    author
  )}/${encodeURIComponent(slug)}`;
}

function resolveCompactionThreshold(input: {
  contextWindow: number;
  priceTierBoundary: number | null;
}): number {
  const baseReserve = resolveRemoteAgentCompactionReserveTokens(
    input.contextWindow
  );
  const baseThreshold = input.contextWindow - baseReserve;
  const priceTierBoundary = input.priceTierBoundary;
  if (priceTierBoundary === null) {
    return baseThreshold;
  }
  return Math.min(
    baseThreshold,
    Math.floor(priceTierBoundary * PRICE_TIER_COMPACTION_SAFETY_RATIO)
  );
}

function buildRemoteAgentCompactionConfig(input: {
  contextWindow: number;
  priceTierBoundary: number | null;
}): RemoteAgentModelRuntimeConfig["compaction"] {
  // The working target and bounded deferral stay below route and price limits.
  const ceiling = resolveCompactionThreshold(input);
  const workingContextTokens = Math.min(
    REMOTE_AGENT_WORKING_CONTEXT_TOKENS,
    ceiling
  );
  return {
    workingContextTokens,
    maxWorkingContextTokens: Math.min(
      workingContextTokens + WORKING_CONTEXT_DEFERRAL_TOKENS,
      ceiling
    ),
    workingContextHeadroomTokens: Math.min(
      8000,
      Math.floor(input.contextWindow / 8),
      Math.floor(workingContextTokens / 2)
    ),
    preserveActiveInput: true,
    thinkingLevel: "low",
    maxSummaryTokens: REMOTE_AGENT_MAX_SUMMARY_TOKENS,
    summaryTargetTokens: REMOTE_AGENT_SUMMARY_TARGET_TOKENS,
    keepRecentTokens: REMOTE_AGENT_COMPACTION_KEEP_RECENT_TOKENS,
    reserveTokens: input.contextWindow - ceiling,
  };
}

function resolvePriceTierBoundary(
  pricingOverrides?: readonly OpenRouterPricingOverride[] | null
): number | null {
  let minimumBoundary: number | null = null;
  for (const pricingOverride of pricingOverrides ?? []) {
    const boundary = pricingOverride?.min_prompt_tokens;
    if (
      typeof boundary !== "number" ||
      !Number.isSafeInteger(boundary) ||
      boundary <= 0
    ) {
      continue;
    }
    minimumBoundary =
      minimumBoundary === null ? boundary : Math.min(minimumBoundary, boundary);
  }
  return minimumBoundary;
}

export async function resolveRemoteAgentModelRuntimeConfigForRegistration(input: {
  env: RemoteAgentModelEnv;
  fetchModelMetadata?: FetchModelMetadata;
  modelRoute?: CenterAgentModelRoute | null;
  nowMs?: number;
}): Promise<RemoteAgentModelRuntimeConfig> {
  if (input.modelRoute) {
    return {
      compaction: buildRemoteAgentCompactionConfig({
        contextWindow: input.modelRoute.contextWindow,
        priceTierBoundary: resolveReviewedPromptPriceTierBoundary(
          input.modelRoute.modelId
        ),
      }),
      contextWindow: input.modelRoute.contextWindow,
      maxTokens: input.modelRoute.maxOutputTokens,
      modelId: input.modelRoute.modelId,
      modelSpecifier: resolveRemoteAgentFlueModelSpecifier(
        input.env,
        input.modelRoute
      ),
    };
  }
  const modelId = resolveRemoteAgentOpenRouterModelId(input.env);
  const nowMs = input.nowMs ?? Date.now();
  const cached = modelRuntimeConfigCache.get(modelId);
  if (cached && cached.expiresAtMs > nowMs) {
    return cached.value;
  }

  const staticValue = resolveStaticRemoteAgentModelRuntimeConfig({
    env: input.env,
    modelId,
  });
  if (!staticValue) {
    const value = await resolveRemoteAgentModelRuntimeConfig({
      env: input.env,
      fetchModelMetadata: input.fetchModelMetadata,
    });
    modelRuntimeConfigCache.set(modelId, {
      expiresAtMs: nowMs + REMOTE_AGENT_MODEL_METADATA_CACHE_TTL_MS,
      refresh: null,
      value,
    });
    return value;
  }

  const entry: CachedModelRuntimeConfig = cached ?? {
    expiresAtMs: nowMs + REMOTE_AGENT_MODEL_METADATA_CACHE_TTL_MS,
    refresh: null,
    value: staticValue,
  };
  entry.expiresAtMs = nowMs + REMOTE_AGENT_MODEL_METADATA_CACHE_TTL_MS;
  modelRuntimeConfigCache.set(modelId, entry);
  refreshRemoteAgentModelRuntimeConfig({
    entry,
    env: input.env,
    fetchModelMetadata: input.fetchModelMetadata,
    modelId,
  });
  return entry.value;
}

function resolveStaticRemoteAgentModelRuntimeConfig(input: {
  env: RemoteAgentModelEnv;
  modelId: string;
}): RemoteAgentModelRuntimeConfig | null {
  if (input.modelId === OPENAI_GPT_5_4_MINI_MODEL_ID) {
    // Captured in tests/fixtures/openrouter-model-openai-gpt-5.4-mini.json.
    return buildRemoteAgentModelRuntimeConfig({
      contextLength: 400_000,
      env: input.env,
      modelId: input.modelId,
      providerContextLength: 400_000,
      providerMaxCompletionTokens: 128_000,
    });
  }
  if (input.modelId === REMOTE_AGENT_OPENROUTER_MODEL_ID) {
    // Captured in tests/fixtures/openrouter-model-x-ai-grok-4.5.json.
    return buildRemoteAgentModelRuntimeConfig({
      contextLength: 500_000,
      env: input.env,
      modelId: input.modelId,
      pricingOverrides: [
        {
          min_prompt_tokens: resolveReviewedPromptPriceTierBoundary(
            input.modelId
          ),
        },
      ],
      providerContextLength: 500_000,
      providerMaxCompletionTokens: null,
    });
  }
  return null;
}

function refreshRemoteAgentModelRuntimeConfig(input: {
  entry: CachedModelRuntimeConfig;
  env: RemoteAgentModelEnv;
  fetchModelMetadata?: FetchModelMetadata;
  modelId: string;
}): void {
  if (input.entry.refresh) {
    return;
  }
  const refresh = resolveRemoteAgentModelRuntimeConfig({
    env: input.env,
    fetchModelMetadata: input.fetchModelMetadata,
  })
    .then((value) => {
      if (modelRuntimeConfigCache.get(input.modelId) !== input.entry) {
        return;
      }
      input.entry.expiresAtMs =
        Date.now() + REMOTE_AGENT_MODEL_METADATA_CACHE_TTL_MS;
      input.entry.value = value;
    })
    .catch((error: unknown) => {
      console.warn("[remote_agent.model.metadata_refresh_failed]", {
        ...remoteAgentDiagnosticErrorFields(error, { env: input.env }),
        modelId: input.modelId,
      });
    })
    .finally(() => {
      if (input.entry.refresh === refresh) {
        input.entry.refresh = null;
      }
    });
  input.entry.refresh = refresh;
}

function buildRemoteAgentModelRuntimeConfig(input: {
  contextLength: number;
  env: RemoteAgentModelEnv;
  modelId: string;
  pricingOverrides?: readonly OpenRouterPricingOverride[] | null;
  providerContextLength: number | null;
  providerMaxCompletionTokens: number | null;
}): RemoteAgentModelRuntimeConfig {
  const contextWindow = input.providerContextLength
    ? Math.min(input.contextLength, input.providerContextLength)
    : input.contextLength;
  const maxTokens = Math.min(
    REMOTE_AGENT_MAX_OUTPUT_TOKENS,
    input.providerMaxCompletionTokens ?? REMOTE_AGENT_MAX_OUTPUT_TOKENS,
    contextWindow - 1
  );
  return {
    compaction: buildRemoteAgentCompactionConfig({
      contextWindow,
      priceTierBoundary: resolvePriceTierBoundary(input.pricingOverrides),
    }),
    contextWindow,
    maxTokens,
    modelId: input.modelId,
    modelSpecifier: resolveRemoteAgentFlueModelSpecifier(input.env),
  };
}

async function fetchRemoteAgentModelMetadata(input: {
  fetchModelMetadata: FetchModelMetadata;
  modelId: string;
}): Promise<Response> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      reject(
        new Error(
          `OpenRouter model metadata lookup timed out for ${input.modelId} after ${MODEL_METADATA_FETCH_TIMEOUT_MS}ms.`
        )
      );
      controller.abort();
    }, MODEL_METADATA_FETCH_TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      input.fetchModelMetadata(
        resolveRemoteAgentOpenRouterModelMetadataUrl(input.modelId),
        { signal: controller.signal }
      ),
      timeout,
    ]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

type ImageInputModel = {
  id: string;
  input: ("image" | "text")[];
  provider: string;
};

type ReasoningModel = {
  id: string;
  provider: string;
  reasoning: boolean;
  thinkingLevelMap?: Partial<
    Record<
      "off" | "minimal" | "low" | "medium" | "high" | "xhigh",
      string | null
    >
  >;
};

const GROK_45_THINKING_LEVEL_MAP = {
  off: null,
  minimal: null,
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: null,
} as const;

const GROK_46_THINKING_LEVEL_MAP = {
  off: null,
  minimal: null,
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
} as const;

export function declareRemoteAgentModelImageInput<T extends ImageInputModel>(
  model: T,
  modelId: string
): T {
  if (
    model.provider !== "openrouter" ||
    model.id !== modelId ||
    model.input.includes("image")
  ) {
    return model;
  }
  return { ...model, input: ["text", "image"] };
}

export function declareRemoteAgentModelReasoning<T extends ReasoningModel>(
  model: T,
  modelId: string
): T {
  if (model.provider !== "openrouter" || model.id !== modelId) {
    return model;
  }
  let thinkingLevelMap:
    | typeof GROK_45_THINKING_LEVEL_MAP
    | typeof GROK_46_THINKING_LEVEL_MAP
    | null = null;
  if (modelId === "x-ai/grok-4.6") {
    thinkingLevelMap = GROK_46_THINKING_LEVEL_MAP;
  } else if (modelId === "x-ai/grok-4.5") {
    thinkingLevelMap = GROK_45_THINKING_LEVEL_MAP;
  }
  if (!thinkingLevelMap) {
    return model;
  }
  return {
    ...model,
    reasoning: true,
    thinkingLevelMap,
  };
}

function declareRemoteAgentModelCapabilities<
  T extends ImageInputModel & ReasoningModel,
>(model: T): T {
  const capabilities = registeredRemoteAgentModelCapabilities.get(
    model.provider
  );
  if (!(capabilities && model.id === capabilities.modelId)) {
    return model;
  }
  const imageModel = capabilities.inputModalities.includes("image")
    ? {
        ...model,
        input: Array.from(new Set([...model.input, "image" as const])),
      }
    : model;
  return {
    ...imageModel,
    compat: capabilities.compat,
    ...(capabilities.cost ? { cost: capabilities.cost } : {}),
    reasoning: capabilities.reasoningLevel !== "off",
    thinkingLevelMap: {
      off: null,
      [capabilities.reasoningLevel]:
        capabilities.reasoningLevel === "off"
          ? null
          : capabilities.reasoningLevel,
    },
  };
}

function createRemoteAgentModelCapabilitiesApi(): ReturnType<
  typeof openAICompletionsApi
> {
  const base = openAICompletionsApi();
  return {
    ...base,
    stream: (model, context, options) => {
      const capabilities = registeredRemoteAgentModelCapabilities.get(
        model.provider
      );
      const resolvedModel = declareRemoteAgentModelCapabilities(model);
      const callId = crypto.randomUUID();
      const submissionId = getRemoteAgentExecutionSubmissionId();
      const resolvedOptions =
        withRemoteAgentProviderObservabilityAndSessionAffinity(
          options,
          capabilities?.reportStage,
          capabilities?.contextCapacity
        );
      return retryCompletedEmptyAssistantStreamOnce({
        onCompletion: (completion) =>
          capabilities?.reportCompletion(
            projectProviderCompletion({ ...completion, callId, submissionId })
          ),
        createAttempt: () => {
          const fetch =
            capabilities?.meterFetch(options?.fetch) ??
            options?.fetch ??
            globalThis.fetch;
          const createAttempt = (requestFetch: typeof globalThis.fetch) =>
            base.stream(resolvedModel, context, {
              ...resolvedOptions,
              fetch: requestFetch,
            });
          return capabilities?.allowContentDiagnostics
            ? createAttempt(fetch)
            : guardRemoteAgentProviderStream({
                createAttempt,
                fetch,
                model: resolvedModel,
              });
        },
        onRetry: () => logCompletedEmptyProviderRetry(resolvedModel.id),
        signal: resolvedOptions?.signal,
      });
    },
    streamSimple: (model, context, options) => {
      const capabilities = registeredRemoteAgentModelCapabilities.get(
        model.provider
      );
      const resolvedModel = declareRemoteAgentModelCapabilities(model);
      const callId = crypto.randomUUID();
      const submissionId = getRemoteAgentExecutionSubmissionId();
      const resolvedOptions =
        withRemoteAgentProviderObservabilityAndSessionAffinity(
          options,
          capabilities?.reportStage,
          capabilities?.contextCapacity
        );
      return retryCompletedEmptyAssistantStreamOnce({
        onCompletion: (completion) =>
          capabilities?.reportCompletion(
            projectProviderCompletion({ ...completion, callId, submissionId })
          ),
        createAttempt: () => {
          const fetch =
            capabilities?.meterFetch(options?.fetch) ??
            options?.fetch ??
            globalThis.fetch;
          const createAttempt = (requestFetch: typeof globalThis.fetch) =>
            base.streamSimple(resolvedModel, context, {
              ...resolvedOptions,
              fetch: requestFetch,
            });
          return capabilities?.allowContentDiagnostics
            ? createAttempt(fetch)
            : guardRemoteAgentProviderStream({
                createAttempt,
                fetch,
                model: resolvedModel,
              });
        },
        onRetry: () => logCompletedEmptyProviderRetry(resolvedModel.id),
        signal: resolvedOptions?.signal,
      });
    },
  };
}

function logCompletedEmptyProviderRetry(modelId: string): void {
  console.warn("[remote_agent.provider.completed_empty_retry]", {
    event: "remote_agent.provider.completed_empty_retry",
    modelId,
    submissionId: getRemoteAgentExecutionSubmissionId(),
  });
}

function normalizeRemoteAgentPromptCacheToolDefinitions(
  payload: Record<string, unknown>,
  modelId: string | undefined
): Record<string, unknown> {
  if (
    !(
      modelId &&
      OPENROUTER_MESSAGE_ONLY_PROMPT_CACHE_MODEL_IDS.has(modelId) &&
      Array.isArray(payload.tools)
    )
  ) {
    return payload;
  }
  // Alibaba caches tool definitions through the message prefix; tool-level
  // cache markers are a Claude contract, not an Alibaba cache breakpoint.
  return {
    ...payload,
    tools: payload.tools.map((tool: unknown) =>
      isRecord(tool)
        ? Object.fromEntries(
            Object.entries(tool).filter(([key]) => key !== "cache_control")
          )
        : tool
    ),
  };
}

export function withRemoteAgentProviderObservabilityAndSessionAffinity(
  options: StreamOptions | undefined,
  reportStage?: (
    observation: RemoteAgentProviderStageObservation
  ) => Promise<void> | void,
  contextCapacity?: RemoteAgentProviderContextCapacity
): StreamOptions {
  const sessionId = options?.sessionId;
  if (sessionId && sessionId.length > 256) {
    throw new Error(
      "Remote Agent provider session affinity exceeds OpenRouter's 256-character limit."
    );
  }
  const originalOnPayload = options?.onPayload;
  const originalOnResponse = options?.onResponse;
  const startedAtMs = Date.now();
  const submissionId = getRemoteAgentExecutionSubmissionId();

  return {
    ...options,
    onPayload: async (payload, model) => {
      const overriddenPayload = await originalOnPayload?.(payload, model);
      const resolvedPayload = overriddenPayload ?? payload;
      if (!isRecord(resolvedPayload)) {
        throw new Error(
          "Remote Agent OpenRouter request payload must be an object."
        );
      }
      const preparedPayload = normalizeRemoteAgentPromptCacheToolDefinitions(
        withRemoteAgentProviderTimeContext(resolvedPayload, Date.now()),
        model?.id
      );
      const durationMs = Date.now() - startedAtMs;
      const messageCount = Array.isArray(preparedPayload.messages)
        ? preparedPayload.messages.length
        : 0;
      const toolCount = Array.isArray(preparedPayload.tools)
        ? preparedPayload.tools.length
        : 0;
      // Compaction and other tool-free model calls share the execution scope
      // but cannot invoke the deferred catalog without its Code Mode entry.
      const hasCodeMode =
        Array.isArray(preparedPayload.tools) &&
        preparedPayload.tools.some(
          (tool: unknown) =>
            isRecord(tool) &&
            isRecord(tool.function) &&
            tool.function.name === "codemode"
        );
      const availableToolCount =
        toolCount + (hasCodeMode ? getRemoteAgentDeferredToolCount() : 0);
      const currentProvider = isRecord(preparedPayload.provider)
        ? preparedPayload.provider
        : {};
      const providerPayload = {
        ...preparedPayload,
        provider: {
          ...currentProvider,
          ...REMOTE_AGENT_OPENROUTER_PROVIDER_ROUTING,
        },
        ...(sessionId ? { session_id: sessionId } : {}),
      };
      const measurement = measureRemoteAgentProviderContext(providerPayload);
      enforceRemoteAgentProviderContextCapacity({
        capacity: contextCapacity,
        measurement,
        modelId: model?.id ?? null,
        submissionId,
      });
      if (contextCapacity) {
        updateRemoteAgentMessageReadBudget({
          ...contextCapacity,
          estimatedInputTokens: measurement.estimatedInputTokens,
        });
      }
      console.info("[remote_agent.provider.request_prepared]", {
        durationMs,
        inputBytes: measurement.inputBytes,
        messageCount,
        modelId: model?.id ?? null,
        availableToolCount,
        sessionAffinity: Boolean(sessionId),
        submissionId,
        toolCount,
      });
      await reportRemoteAgentProviderStage(reportStage, {
        availableToolCount,
        durationMs,
        inputBytes: measurement.inputBytes,
        messageCount,
        modelId: model?.id ?? null,
        observedAtMs: Date.now(),
        stage: "request_prepared",
        status: "succeeded",
        submissionId,
        toolCount,
      });
      return providerPayload;
    },
    onResponse: async (response, model) => {
      try {
        await originalOnResponse?.(response, model);
      } finally {
        const durationMs = Date.now() - startedAtMs;
        console.info("[remote_agent.provider.response_headers]", {
          durationMs,
          modelId: model?.id ?? null,
          status: response.status,
          submissionId,
        });
        await reportRemoteAgentProviderStage(reportStage, {
          durationMs,
          modelId: model?.id ?? null,
          observedAtMs: Date.now(),
          stage: "response_headers",
          status: "succeeded",
          statusCode: response.status,
          submissionId,
        });
      }
    },
  };
}

function enforceRemoteAgentProviderContextCapacity(input: {
  capacity?: RemoteAgentProviderContextCapacity;
  measurement: ReturnType<typeof measureRemoteAgentProviderContext>;
  modelId: string | null;
  submissionId: string | null;
}): void {
  if (!input.capacity) {
    return;
  }
  if (
    input.measurement.estimatedInputTokens > input.capacity.inputTokenBudget
  ) {
    console.warn("[remote_agent.provider.context_capacity_exceeded]", {
      estimatedInputTokens: input.measurement.estimatedInputTokens,
      inputBytes: input.measurement.inputBytes,
      inputTokenBudget: input.capacity.inputTokenBudget,
      modelId: input.modelId,
      submissionId: input.submissionId,
    });
  }
  assertRemoteAgentProviderContextFits({
    capacity: input.capacity,
    measurement: input.measurement,
  });
}

async function reportRemoteAgentProviderStage(
  reportStage:
    | ((
        observation: RemoteAgentProviderStageObservation
      ) => Promise<void> | void)
    | undefined,
  observation: RemoteAgentProviderStageObservation
): Promise<void> {
  try {
    await reportStage?.(observation);
  } catch (error) {
    console.error("[remote_agent.provider.stage_reporting_failed]", {
      errorName: error instanceof Error ? error.name : "UnknownError",
      stage: observation.stage,
      submissionId: observation.submissionId,
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
