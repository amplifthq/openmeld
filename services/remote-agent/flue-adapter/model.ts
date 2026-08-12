import type {
  Model,
  OpenAICompletionsCompat,
  StreamOptions,
} from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all";
import { registerApiProvider, registerProvider } from "@flue/runtime";
import type { CenterAgentModelRoute } from "@openmeld/schemas/types";
import { z } from "zod/v4";
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
import {
  classifyRemoteAgentWorkSurface,
  compactRemoteAgentWorkSurfaceCurrentUserMessage,
  DEFAULT_REMOTE_AGENT_WORK_SURFACE_MODEL_ID,
  extractRemoteAgentCurrentUserRequest,
  REMOTE_AGENT_WORK_SURFACE_BINDING_MARKER,
  type RemoteAgentWorkSurface,
  resolveRemoteAgentWorkSurfaceModelId,
  shouldClassifyRemoteAgentWorkSurface,
} from "../agent-core/work-surface-routing";
import { emitRemoteAgentExecutionStageEvidence } from "./cloudflare-runtime-evidence";
import { getRemoteAgentExecutionSubmissionId } from "./execution-context";

const OPENROUTER_MODEL_METADATA_BASE_URL = "https://openrouter.ai/api/v1/model";
export const REMOTE_AGENT_MODEL_METADATA_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const REMOTE_AGENT_COMPACTION_KEEP_RECENT_TOKENS = 8000;
const MODEL_METADATA_FETCH_TIMEOUT_MS = 3000;
const MIN_COMPACTION_RESERVE_TOKENS = 8000;
const MAX_COMPACTION_RESERVE_TOKENS = 64_000;
const COMPACTION_RESERVE_CONTEXT_RATIO = 0.1;
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
  OPENMELD_OBSERVABILITY?: AnalyticsEngineDataset;
  OPENMELD_REMOTE_AGENT_AI_GATEWAY_ACCOUNT_ID?: string;
  OPENMELD_REMOTE_AGENT_AI_GATEWAY_ID?: string;
  OPENMELD_REMOTE_AGENT_AI_GATEWAY_ID_OVERRIDE?: string;
  CLOUDFLARE_OPENMELD_AI_GATEWAY_TOKEN?: string;
  OPENMELD_REMOTE_AGENT_OPENROUTER_BYOK_ALIAS?: string;
  OPENMELD_REMOTE_AGENT_OPENROUTER_MODEL_ID?: string;
  OPENMELD_REMOTE_AGENT_WORK_SURFACE_MODEL_ID?: string;
  OPENMELD_WORKER_ENVIRONMENT?: string;
};

export type RemoteAgentProviderStageObservation = {
  durationMs: number;
  inputBytes?: number;
  messageCount?: number;
  modelId: string | null;
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
  classifyWorkSurface: (request: string) => Promise<RemoteAgentWorkSurface>;
  compat: OpenAICompletionsCompat;
  cost?: Model<"openai-completions">["cost"];
  inputModalities: readonly ("image" | "text")[];
  modelId: string;
  reasoningLevel: CenterAgentModelRoute["reasoningLevel"];
  reportStage?: (observation: RemoteAgentProviderStageObservation) => void;
};
const registeredRemoteAgentModelCapabilities = new Map<
  string,
  RegisteredRemoteAgentModelCapabilities
>();

export async function registerRemoteAgentCloudflareProvider(input: {
  env: RemoteAgentModelEnv;
  executionProfile?: "work_surface_binding";
  modelRoute?: CenterAgentModelRoute | null;
  organizationId?: string | null;
}): Promise<RemoteAgentModelRuntimeConfig> {
  const modelEnv =
    input.executionProfile === "work_surface_binding"
      ? {
          ...input.env,
          OPENMELD_REMOTE_AGENT_OPENROUTER_MODEL_ID:
            resolveRemoteAgentWorkSurfaceModelId(input.env),
        }
      : input.env;
  const modelRoute =
    input.executionProfile === "work_surface_binding" ? null : input.modelRoute;
  const runtimeConfig =
    await resolveRemoteAgentModelRuntimeConfigForRegistration({
      env: modelEnv,
      modelRoute,
    });
  const { contextWindow, maxTokens, modelId } = runtimeConfig;
  const providerId = await buildRemoteAgentScopedProviderId({
    executionProfile: input.executionProfile,
    modelId,
    modelRoute,
    organizationId: input.organizationId,
  });
  registerRemoteAgentModelCapabilitiesApi();
  const openRouterModel = getBuiltinModels("openrouter").find(
    (model) => model.id === modelId && model.api === "openai-completions"
  ) as Model<"openai-completions"> | undefined;
  registeredRemoteAgentModelCapabilities.set(providerId, {
    classifyWorkSurface: (request) =>
      classifyRemoteAgentWorkSurface({
        env: input.env,
        organizationId: input.organizationId,
        request,
      }),
    compat: {
      supportsDeveloperRole:
        modelId.startsWith("anthropic/") || modelId.startsWith("openai/"),
      ...openRouterModel?.compat,
      thinkingFormat: "openrouter",
    },
    cost: openRouterModel?.cost,
    inputModalities:
      input.executionProfile === "work_surface_binding"
        ? ["text"]
        : (input.modelRoute?.inputModalities ?? ["text", "image"]),
    modelId,
    reasoningLevel:
      input.executionProfile === "work_surface_binding"
        ? "low"
        : (input.modelRoute?.reasoningLevel ?? "high"),
    reportStage: (observation) => {
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
  executionProfile?: "work_surface_binding";
  modelId: string;
  modelRoute?: CenterAgentModelRoute | null;
  organizationId?: string | null;
}): Promise<string> {
  let routeIdentity = "legacy-v1";
  if (input.executionProfile) {
    routeIdentity = `execution-profile:${input.executionProfile}`;
  } else if (input.modelRoute) {
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

function resolveBaseCompactionReserveTokens(contextWindow: number): number {
  const proportionalReserve = Math.ceil(
    contextWindow * COMPACTION_RESERVE_CONTEXT_RATIO
  );
  const maximumSafeReserve = Math.max(1, Math.floor(contextWindow / 4));
  return Math.min(
    Math.max(proportionalReserve, MIN_COMPACTION_RESERVE_TOKENS),
    MAX_COMPACTION_RESERVE_TOKENS,
    maximumSafeReserve
  );
}

function resolveCompactionThreshold(input: {
  contextWindow: number;
  pricingOverrides?: readonly OpenRouterPricingOverride[] | null;
}): number {
  const baseReserve = resolveBaseCompactionReserveTokens(input.contextWindow);
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
        reserveTokens: resolveBaseCompactionReserveTokens(
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
  if (input.modelId === DEFAULT_REMOTE_AGENT_WORK_SURFACE_MODEL_ID) {
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
  if (
    modelId !== REMOTE_AGENT_OPENROUTER_MODEL_ID ||
    model.provider !== "openrouter" ||
    model.id !== modelId
  ) {
    return model;
  }
  return {
    ...model,
    reasoning: true,
    thinkingLevelMap: GROK_45_THINKING_LEVEL_MAP,
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
    stream: (model, context, options) =>
      base.stream(
        declareRemoteAgentModelCapabilities(model),
        context,
        withRemoteAgentProviderObservabilityAndSessionAffinity(
          options,
          registeredRemoteAgentModelCapabilities.get(model.provider)
            ?.reportStage,
          registeredRemoteAgentModelCapabilities.get(model.provider)
            ?.classifyWorkSurface
        )
      ),
    streamSimple: (model, context, options) =>
      base.streamSimple(
        declareRemoteAgentModelCapabilities(model),
        context,
        withRemoteAgentProviderObservabilityAndSessionAffinity(
          options,
          registeredRemoteAgentModelCapabilities.get(model.provider)
            ?.reportStage,
          registeredRemoteAgentModelCapabilities.get(model.provider)
            ?.classifyWorkSurface
        )
      ),
  });
}

export function withRemoteAgentProviderObservabilityAndSessionAffinity(
  options: StreamOptions | undefined,
  reportStage?: (observation: RemoteAgentProviderStageObservation) => void,
  classifyWorkSurface?: (request: string) => Promise<RemoteAgentWorkSurface>
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
      const routedPayload =
        enforcePreclassifiedRemoteAgentWorkSurface(resolvedPayload) ??
        (await enforceRemoteAgentWorkSurface({
          classifyWorkSurface,
          payload: resolvedPayload,
          submissionId,
        }));
      const originalToolCount = Array.isArray(routedPayload.tools)
        ? routedPayload.tools.length
        : 0;
      const compactedTools = compactRemoteAgentProviderTools(
        routedPayload.tools
      );
      const preparedPayload =
        compactedTools === routedPayload.tools
          ? routedPayload
          : { ...routedPayload, tools: compactedTools };
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
      const inputBytes = new TextEncoder().encode(
        JSON.stringify(providerPayload)
      ).byteLength;
      console.info("[remote_agent.provider.request_prepared]", {
        durationMs,
        inputBytes,
        messageCount,
        modelId: model?.id ?? null,
        originalToolCount,
        sessionAffinity: Boolean(sessionId),
        submissionId,
        toolCount,
      });
      reportRemoteAgentProviderStage(reportStage, {
        durationMs,
        inputBytes,
        messageCount,
        modelId: model?.id ?? null,
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
        reportRemoteAgentProviderStage(reportStage, {
          durationMs,
          modelId: model?.id ?? null,
          stage: "response_headers",
          status: "succeeded",
          statusCode: response.status,
          submissionId,
        });
      }
    },
  };
}

const REMOTE_AGENT_DIRECT_TOOL_SCHEMA_LIMIT = 64;
const REMOTE_AGENT_CODE_MODE_TOOL_NAME = "codemode";
const REMOTE_AGENT_CREATE_TASK_TOOL_NAME = "openmeld_create_task";
const REMOTE_AGENT_CREATE_SPACE_TOOL_NAME = "openmeld_create_space";

function enforcePreclassifiedRemoteAgentWorkSurface(
  payload: Record<string, unknown>
): Record<string, unknown> | null {
  if (!Array.isArray(payload.messages)) {
    return null;
  }
  const bindingSystemMessage = payload.messages.find(
    (message) =>
      isRecord(message) &&
      message.role === "system" &&
      typeof message.content === "string" &&
      message.content.startsWith(
        `${REMOTE_AGENT_WORK_SURFACE_BINDING_MARKER}\nSurface: `
      )
  );
  if (!(bindingSystemMessage && isRecord(bindingSystemMessage))) {
    return null;
  }
  const systemContent = bindingSystemMessage.content;
  let surface: "new_space" | "new_task" | null = null;
  if (
    typeof systemContent === "string" &&
    systemContent.startsWith(
      `${REMOTE_AGENT_WORK_SURFACE_BINDING_MARKER}\nSurface: new_task`
    )
  ) {
    surface = "new_task";
  } else if (
    typeof systemContent === "string" &&
    systemContent.startsWith(
      `${REMOTE_AGENT_WORK_SURFACE_BINDING_MARKER}\nSurface: new_space`
    )
  ) {
    surface = "new_space";
  }
  if (!surface) {
    throw new Error("Remote Agent work-surface binding marker is invalid.");
  }
  const currentUserIndex = payload.messages.findLastIndex(
    (message) => isRecord(message) && message.role === "user"
  );
  if (currentUserIndex < 0) {
    throw new Error(
      "Remote Agent work-surface binding requires a current user message."
    );
  }
  const currentTurnMessages = payload.messages.slice(currentUserIndex);
  const currentUserMessage = currentTurnMessages[0];
  if (
    !isRecord(currentUserMessage) ||
    currentUserMessage.role !== "user" ||
    typeof currentUserMessage.content !== "string"
  ) {
    throw new Error(
      "Remote Agent work-surface binding requires a text-only current user message."
    );
  }
  const compactCurrentTurnMessages = [
    {
      ...currentUserMessage,
      content: compactRemoteAgentWorkSurfaceCurrentUserMessage(
        currentUserMessage.content
      ),
    },
    ...currentTurnMessages.slice(1),
  ];
  const toolAlreadyRan = compactCurrentTurnMessages.some(
    (message) => isRecord(message) && message.role === "tool"
  );
  const toolName =
    surface === "new_task"
      ? REMOTE_AGENT_CREATE_TASK_TOOL_NAME
      : REMOTE_AGENT_CREATE_SPACE_TOOL_NAME;
  const tool = Array.isArray(payload.tools)
    ? payload.tools.find((candidate) =>
        isRemoteAgentProviderToolNamed(candidate, toolName)
      )
    : undefined;
  if (!(tool || toolAlreadyRan)) {
    throw new Error(`Remote Agent work-surface binding requires ${toolName}.`);
  }
  const {
    parallel_tool_calls: _parallelToolCalls,
    tool_choice: _toolChoice,
    ...basePayload
  } = payload;
  return {
    ...basePayload,
    max_tokens: toolAlreadyRan ? 160 : 2048,
    messages: [bindingSystemMessage, ...compactCurrentTurnMessages],
    parallel_tool_calls: false,
    reasoning: { enabled: false },
    ...(toolAlreadyRan
      ? { tools: [] }
      : {
          tool_choice: { function: { name: toolName }, type: "function" },
          tools: [tool],
        }),
  };
}

async function enforceRemoteAgentWorkSurface(input: {
  classifyWorkSurface?: (request: string) => Promise<RemoteAgentWorkSurface>;
  payload: Record<string, unknown>;
  submissionId: string | null;
}): Promise<Record<string, unknown>> {
  if (!input.classifyWorkSurface) {
    return input.payload;
  }
  const currentUserContent = readCurrentUserContent(input.payload.messages);
  if (
    !(
      currentUserContent &&
      shouldClassifyRemoteAgentWorkSurface(currentUserContent)
    )
  ) {
    return input.payload;
  }
  const request = extractRemoteAgentCurrentUserRequest(currentUserContent);
  let surface: RemoteAgentWorkSurface;
  try {
    surface = await input.classifyWorkSurface(request);
  } catch (error) {
    console.warn("[remote_agent.work_surface.classification_failed]", {
      error: error instanceof Error ? error.message : String(error),
      submissionId: input.submissionId,
    });
    return input.payload;
  }
  console.info("[remote_agent.work_surface.classified]", {
    submissionId: input.submissionId,
    surface,
  });
  let toolName: string | null = null;
  if (surface === "new_task") {
    toolName = REMOTE_AGENT_CREATE_TASK_TOOL_NAME;
  } else if (surface === "new_space") {
    toolName = REMOTE_AGENT_CREATE_SPACE_TOOL_NAME;
  }
  if (!toolName) {
    return input.payload;
  }
  const tool = Array.isArray(input.payload.tools)
    ? input.payload.tools.find((candidate) =>
        isRemoteAgentProviderToolNamed(candidate, toolName)
      )
    : undefined;
  if (!tool) {
    console.warn("[remote_agent.work_surface.required_tool_unavailable]", {
      submissionId: input.submissionId,
      surface,
      toolName,
    });
    return input.payload;
  }
  console.info("[remote_agent.work_surface.enforced]", {
    submissionId: input.submissionId,
    surface,
    toolName,
  });
  return {
    ...input.payload,
    parallel_tool_calls: false,
    // The classifier has already resolved the only remaining decision and the
    // provider must call exactly one tool. Long-form reasoning here adds tail
    // latency without improving routing; the created Task or Space keeps the
    // Organization's normal reasoning level for its actual work.
    reasoning: { enabled: false },
    tool_choice: { function: { name: toolName }, type: "function" },
    tools: [tool],
  };
}

function readCurrentUserContent(messages: unknown): string | null {
  if (!Array.isArray(messages) || messages.length === 0) {
    return null;
  }
  const message = messages.at(-1);
  if (!isRecord(message) || message.role !== "user") {
    return null;
  }
  if (typeof message.content === "string") {
    return message.content;
  }
  if (!Array.isArray(message.content)) {
    return null;
  }
  const text = message.content
    .filter(
      (part): part is Record<string, unknown> =>
        isRecord(part) && part.type === "text" && typeof part.text === "string"
    )
    .map((part) => part.text)
    .join("\n");
  return text || null;
}

function isRemoteAgentProviderToolNamed(tool: unknown, name: string): boolean {
  return (
    isRecord(tool) &&
    tool.type === "function" &&
    isRecord(tool.function) &&
    tool.function.name === name
  );
}

function compactRemoteAgentProviderTools(tools: unknown): unknown {
  if (!Array.isArray(tools)) {
    return tools;
  }
  const codeModeTools = tools.filter(isRemoteAgentCodeModeProviderTool);
  const directToolCount = tools.length - codeModeTools.length;
  if (directToolCount <= REMOTE_AGENT_DIRECT_TOOL_SCHEMA_LIMIT) {
    return tools;
  }
  if (codeModeTools.length !== 1) {
    throw new Error(
      "A large Remote Agent tool surface requires exactly one Code Mode tool."
    );
  }
  return codeModeTools;
}

function isRemoteAgentCodeModeProviderTool(tool: unknown): boolean {
  return (
    isRecord(tool) &&
    tool.type === "function" &&
    isRecord(tool.function) &&
    tool.function.name === REMOTE_AGENT_CODE_MODE_TOOL_NAME
  );
}

function reportRemoteAgentProviderStage(
  reportStage:
    | ((observation: RemoteAgentProviderStageObservation) => void)
    | undefined,
  observation: RemoteAgentProviderStageObservation
): void {
  try {
    reportStage?.(observation);
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
