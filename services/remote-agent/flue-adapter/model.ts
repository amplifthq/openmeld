import type {
  Model,
  OpenAICompletionsCompat,
  StreamOptions,
} from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all";
import { registerApiProvider, registerProvider } from "@flue/runtime";
import { getCloudflareContext } from "@flue/runtime/cloudflare";
import type { CenterAgentModelRoute } from "@openmeld/schemas/types";
import * as z from "zod/v4";
import { readRemoteAgentCallbackContext } from "../agent-core/callback-context";
import { REMOTE_AGENT_CONNECTOR_TOOL_NAMES } from "../agent-core/connector-tools";
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
import { recordRemoteAgentTurnObservabilityBestEffort } from "../agent-core/turn-observability";
import { REMOTE_AGENT_CAPABILITY_DISCOVERY_TOOL_NAMES } from "./capability-discovery";
import { emitCenterAgentPerformanceMilestone } from "./center-agent-performance-observability";
import { emitRemoteAgentExecutionStageEvidence } from "./cloudflare-runtime-evidence";
import { getRemoteAgentExecutionSubmissionId } from "./execution-context";
import {
  assertRemoteAgentProviderContextFits,
  measureRemoteAgentProviderContext,
  type RemoteAgentProviderContextCapacity,
  resolveRemoteAgentCompactionReserveTokens,
  resolveRemoteAgentProviderContextCapacity,
} from "./provider-context-capacity";
import { retryCompletedEmptyAssistantStreamOnce } from "./provider-stream-retry";
import { createRemoteAgentSqlStorage } from "./storage";

const OPENROUTER_MODEL_METADATA_BASE_URL = "https://openrouter.ai/api/v1/model";
const OPENAI_GPT_5_4_MINI_MODEL_ID = "openai/gpt-5.4-mini";
export const REMOTE_AGENT_MODEL_METADATA_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const REMOTE_AGENT_COMPACTION_KEEP_RECENT_TOKENS = 8000;
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
    keepRecentTokens: number;
    reserveTokens: number;
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
  registerRemoteAgentModelCapabilitiesApi();
  const openRouterModel = getBuiltinModels("openrouter").find(
    (model) => model.id === modelId && model.api === "openai-completions"
  ) as Model<"openai-completions"> | undefined;
  registeredRemoteAgentModelCapabilities.set(providerId, {
    compat: {
      supportsDeveloperRole:
        modelId.startsWith("anthropic/") || modelId.startsWith("openai/"),
      ...openRouterModel?.compat,
      thinkingFormat: "openrouter",
    },
    contextCapacity: resolveRemoteAgentProviderContextCapacity({
      contextWindow,
      reserveTokens: runtimeConfig.compaction.reserveTokens,
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
  registerProvider(providerId, {
    api: "openai-completions",
    // pi-ai requires an apiKey before the OpenAI client is created. The
    // registered headers clear SDK Authorization so this placeholder is never
    // sent to Cloudflare AI Gateway.
    apiKey: "unused",
    baseUrl: resolveRemoteAgentAiGatewayOpenRouterBaseUrl(input.env),
    contextWindow,
    headers: buildRemoteAgentAiGatewayHeaders({
      env: input.env,
      metadata,
    }) as Record<string, string>,
    maxTokens,
    models: {
      [modelId]: {
        contextWindow,
        maxTokens,
      },
    },
  });
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
  pricingOverrides?: readonly OpenRouterPricingOverride[] | null;
}): number {
  const baseReserve = resolveRemoteAgentCompactionReserveTokens(
    input.contextWindow
  );
  const baseThreshold = input.contextWindow - baseReserve;
  const priceTierBoundary = resolvePriceTierBoundary(input.pricingOverrides);
  if (priceTierBoundary === null) {
    return baseThreshold;
  }
  return Math.min(
    baseThreshold,
    Math.floor(priceTierBoundary * PRICE_TIER_COMPACTION_SAFETY_RATIO)
  );
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
      compaction: {
        keepRecentTokens: REMOTE_AGENT_COMPACTION_KEEP_RECENT_TOKENS,
        reserveTokens: resolveRemoteAgentCompactionReserveTokens(
          input.modelRoute.contextWindow
        ),
      },
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
      pricingOverrides: [{ min_prompt_tokens: 200_000 }],
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
        error: error instanceof Error ? error.message : String(error),
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
    compaction: {
      keepRecentTokens: REMOTE_AGENT_COMPACTION_KEEP_RECENT_TOKENS,
      // Flue interprets reserveTokens as the early-compaction band below the
      // context window. Price-aware bands may intentionally exceed the base
      // reserve cap so compaction starts before a higher prompt-price tier.
      reserveTokens:
        contextWindow -
        resolveCompactionThreshold({
          contextWindow,
          pricingOverrides: input.pricingOverrides,
        }),
    },
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

function registerRemoteAgentModelCapabilitiesApi(): void {
  const base = openAICompletionsApi();
  registerApiProvider({
    api: "openai-completions",
    stream: (model, context, options) => {
      const capabilities = registeredRemoteAgentModelCapabilities.get(
        model.provider
      );
      const resolvedModel = declareRemoteAgentModelCapabilities(model);
      const resolvedOptions =
        withRemoteAgentProviderObservabilityAndSessionAffinity(
          options,
          capabilities?.reportStage,
          capabilities?.contextCapacity
        );
      return retryCompletedEmptyAssistantStreamOnce({
        createAttempt: () =>
          base.stream(resolvedModel, context, resolvedOptions),
        onRetry: () => logCompletedEmptyProviderRetry(resolvedModel.id),
        signal: resolvedOptions?.signal,
      });
    },
    streamSimple: (model, context, options) => {
      const capabilities = registeredRemoteAgentModelCapabilities.get(
        model.provider
      );
      const resolvedModel = declareRemoteAgentModelCapabilities(model);
      const resolvedOptions =
        withRemoteAgentProviderObservabilityAndSessionAffinity(
          options,
          capabilities?.reportStage,
          capabilities?.contextCapacity
        );
      return retryCompletedEmptyAssistantStreamOnce({
        createAttempt: () =>
          base.streamSimple(resolvedModel, context, resolvedOptions),
        onRetry: () => logCompletedEmptyProviderRetry(resolvedModel.id),
        signal: resolvedOptions?.signal,
      });
    },
  });
}

function logCompletedEmptyProviderRetry(modelId: string): void {
  console.warn("[remote_agent.provider.completed_empty_retry]", {
    event: "remote_agent.provider.completed_empty_retry",
    modelId,
    submissionId: getRemoteAgentExecutionSubmissionId(),
  });
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
      const originalToolCount = Array.isArray(resolvedPayload.tools)
        ? resolvedPayload.tools.length
        : 0;
      const compactedTools = exposeRemoteAgentBootstrapTools(
        resolvedPayload.tools
      );
      const preparedPayload =
        compactedTools === resolvedPayload.tools
          ? resolvedPayload
          : { ...resolvedPayload, tools: compactedTools };
      const durationMs = Date.now() - startedAtMs;
      const messageCount = Array.isArray(preparedPayload.messages)
        ? preparedPayload.messages.length
        : 0;
      const toolCount = Array.isArray(preparedPayload.tools)
        ? preparedPayload.tools.length
        : 0;
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
      console.info("[remote_agent.provider.request_prepared]", {
        durationMs,
        inputBytes: measurement.inputBytes,
        messageCount,
        modelId: model?.id ?? null,
        originalToolCount,
        sessionAffinity: Boolean(sessionId),
        submissionId,
        toolCount,
      });
      await reportRemoteAgentProviderStage(reportStage, {
        availableToolCount: originalToolCount,
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

const REMOTE_AGENT_CODE_MODE_TOOL_NAME = "codemode";
const REMOTE_AGENT_SKILL_ACTIVATION_TOOL_NAME = "activate_skill";
const REMOTE_AGENT_FOUNDATIONAL_READ_TOOL_NAMES = [
  "openmeld_list_organization_members",
  "openmeld_list_center_agent_tasks",
  "openmeld_get_center_agent_task",
] as const;
const REMOTE_AGENT_ALWAYS_DIRECT_TOOL_NAME_SET = new Set<string>([
  ...REMOTE_AGENT_CAPABILITY_DISCOVERY_TOOL_NAMES,
  ...REMOTE_AGENT_CONNECTOR_TOOL_NAMES,
  ...REMOTE_AGENT_FOUNDATIONAL_READ_TOOL_NAMES,
  REMOTE_AGENT_SKILL_ACTIVATION_TOOL_NAME,
]);

function exposeRemoteAgentBootstrapTools(tools: unknown): unknown {
  if (!Array.isArray(tools)) {
    return tools;
  }
  const codeModeTools = tools.filter(isRemoteAgentCodeModeProviderTool);
  if (codeModeTools.length === 0) {
    return tools;
  }
  if (codeModeTools.length !== 1) {
    throw new Error(
      "A Remote Agent capability catalog requires exactly one Code Mode tool."
    );
  }
  const alwaysDirectTools = tools.filter(
    (tool) =>
      isRecord(tool) &&
      tool.type === "function" &&
      isRecord(tool.function) &&
      typeof tool.function.name === "string" &&
      REMOTE_AGENT_ALWAYS_DIRECT_TOOL_NAME_SET.has(tool.function.name)
  );
  return [...alwaysDirectTools, ...codeModeTools];
}

function isRemoteAgentCodeModeProviderTool(tool: unknown): boolean {
  return (
    isRecord(tool) &&
    tool.type === "function" &&
    isRecord(tool.function) &&
    tool.function.name === REMOTE_AGENT_CODE_MODE_TOOL_NAME
  );
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
