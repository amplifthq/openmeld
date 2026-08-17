import type { CenterAgentModelRoute } from "@openmeld/schemas/types";

export const REMOTE_AGENT_OPENROUTER_MODEL_ID = "x-ai/grok-4.5";
export const REMOTE_AGENT_MODEL_DISPLAY_NAME = "xAI's Grok 4.5";
export const REMOTE_AGENT_MAX_OUTPUT_TOKENS = 8192;
export type RemoteAgentModelEnv = {
  OPENMELD_REMOTE_AGENT_AI_GATEWAY_ACCOUNT_ID?: string;
  OPENMELD_REMOTE_AGENT_AI_GATEWAY_ID?: string;
  CLOUDFLARE_OPENMELD_AI_GATEWAY_TOKEN?: string;
  OPENMELD_REMOTE_AGENT_OPENROUTER_BYOK_ALIAS?: string;
  OPENMELD_REMOTE_AGENT_OPENROUTER_MODEL_ID?: string;
  OPENMELD_REMOTE_AGENT_WORK_SURFACE_MODEL_ID?: string;
};

export function resolveRemoteAgentAiGatewayAccountId(
  env: Pick<RemoteAgentModelEnv, "OPENMELD_REMOTE_AGENT_AI_GATEWAY_ACCOUNT_ID">
): string {
  const configured = env.OPENMELD_REMOTE_AGENT_AI_GATEWAY_ACCOUNT_ID?.trim();
  if (configured) {
    return configured;
  }
  throw new Error(
    "OPENMELD_REMOTE_AGENT_AI_GATEWAY_ACCOUNT_ID must be configured for the current Remote Agent environment."
  );
}

export function resolveRemoteAgentAiGatewayId(
  env: Pick<RemoteAgentModelEnv, "OPENMELD_REMOTE_AGENT_AI_GATEWAY_ID">
): string {
  const configured = env.OPENMELD_REMOTE_AGENT_AI_GATEWAY_ID?.trim();
  if (configured) {
    return configured;
  }
  throw new Error(
    "OPENMELD_REMOTE_AGENT_AI_GATEWAY_ID must be configured for the current Remote Agent environment."
  );
}

export function resolveRemoteAgentAiGatewayToken(
  env: Pick<RemoteAgentModelEnv, "CLOUDFLARE_OPENMELD_AI_GATEWAY_TOKEN">
): string {
  const configured = env.CLOUDFLARE_OPENMELD_AI_GATEWAY_TOKEN?.trim();
  if (configured) {
    return configured;
  }
  throw new Error(
    "CLOUDFLARE_OPENMELD_AI_GATEWAY_TOKEN must be configured with a Cloudflare AI Gateway Run token before the Remote Agent can call OpenRouter."
  );
}

export function resolveRemoteAgentOpenRouterByokAlias(
  env: Pick<RemoteAgentModelEnv, "OPENMELD_REMOTE_AGENT_OPENROUTER_BYOK_ALIAS">
): string {
  const configured = env.OPENMELD_REMOTE_AGENT_OPENROUTER_BYOK_ALIAS?.trim();
  if (configured) {
    return configured;
  }
  throw new Error(
    "OPENMELD_REMOTE_AGENT_OPENROUTER_BYOK_ALIAS must be configured for the current Remote Agent environment."
  );
}

export function resolveRemoteAgentOpenRouterModelId(
  env: Pick<RemoteAgentModelEnv, "OPENMELD_REMOTE_AGENT_OPENROUTER_MODEL_ID">,
  modelRoute?: CenterAgentModelRoute | null
): string {
  if (modelRoute) {
    return modelRoute.modelId;
  }
  const configured = env.OPENMELD_REMOTE_AGENT_OPENROUTER_MODEL_ID?.trim();
  const modelId =
    configured && configured.length > 0
      ? configured
      : REMOTE_AGENT_OPENROUTER_MODEL_ID;
  if (!modelId.includes("/")) {
    throw new Error(
      "OPENMELD_REMOTE_AGENT_OPENROUTER_MODEL_ID must be an OpenRouter model id like x-ai/grok-4.5."
    );
  }
  return modelId;
}

export function resolveRemoteAgentAiGatewayOpenRouterBaseUrl(
  env: Pick<
    RemoteAgentModelEnv,
    | "OPENMELD_REMOTE_AGENT_AI_GATEWAY_ACCOUNT_ID"
    | "OPENMELD_REMOTE_AGENT_AI_GATEWAY_ID"
  >
): string {
  return `https://gateway.ai.cloudflare.com/v1/${encodeURIComponent(
    resolveRemoteAgentAiGatewayAccountId(env)
  )}/${encodeURIComponent(resolveRemoteAgentAiGatewayId(env))}/openrouter`;
}

/**
 * Human-readable disclosure string for "what model are you" questions. Falls
 * back to the raw OpenRouter model id when an operator has overridden the
 * model away from the curated default, so this can never claim to be a model
 * that isn't actually running.
 */
export function resolveRemoteAgentModelDisplayName(
  env: Pick<RemoteAgentModelEnv, "OPENMELD_REMOTE_AGENT_OPENROUTER_MODEL_ID">,
  modelRoute?: CenterAgentModelRoute | null
): string {
  if (modelRoute) {
    return modelRoute.displayName;
  }
  const modelId = resolveRemoteAgentOpenRouterModelId(env);
  return modelId === REMOTE_AGENT_OPENROUTER_MODEL_ID
    ? REMOTE_AGENT_MODEL_DISPLAY_NAME
    : modelId;
}

export function resolveRemoteAgentFlueModelSpecifier(
  env: Pick<RemoteAgentModelEnv, "OPENMELD_REMOTE_AGENT_OPENROUTER_MODEL_ID">,
  modelRoute?: CenterAgentModelRoute | null
): string {
  return `openrouter/${resolveRemoteAgentOpenRouterModelId(env, modelRoute)}`;
}

/**
 * Per-request AI Gateway metadata for spend attribution. AI Gateway accepts at
 * most five flat scalar metadata entries; `organizationId` is the attribution
 * key Core reads back from the logs API to meter per-org usage. Keeping the set
 * small and flat is required by the AI Gateway metadata contract.
 * See https://developers.cloudflare.com/ai-gateway/observability/custom-metadata/
 */
export function buildRemoteAgentGatewayMetadata(input?: {
  modelId?: string | null;
  organizationId?: string | null;
}): Record<string, string> {
  const metadata: Record<string, string> = {
    model: input?.modelId?.trim() || REMOTE_AGENT_OPENROUTER_MODEL_ID,
    provider: "openrouter",
    worker: "openmeld-remote-agent",
  };
  const organizationId = input?.organizationId?.trim();
  if (organizationId) {
    metadata.organizationId = organizationId;
  }
  return metadata;
}

export function buildRemoteAgentAiGatewayHeaders(input: {
  env: Pick<
    RemoteAgentModelEnv,
    | "CLOUDFLARE_OPENMELD_AI_GATEWAY_TOKEN"
    | "OPENMELD_REMOTE_AGENT_OPENROUTER_BYOK_ALIAS"
  >;
  metadata?: Record<string, string>;
}): Record<string, string | null> {
  const metadata = input.metadata ?? buildRemoteAgentGatewayMetadata();
  return {
    // The OpenAI SDK injects provider Authorization from its apiKey. Cloudflare
    // BYOK requires that provider Authorization be absent so the stored key is used.
    Authorization: null,
    "cf-aig-authorization": `Bearer ${resolveRemoteAgentAiGatewayToken(
      input.env
    )}`,
    "cf-aig-byok-alias": resolveRemoteAgentOpenRouterByokAlias(input.env),
    "cf-aig-collect-log": "true",
    "cf-aig-metadata": JSON.stringify(metadata),
  };
}

export function buildRemoteAgentZeroRetentionAiGatewayHeaders(input: {
  env: Pick<
    RemoteAgentModelEnv,
    | "CLOUDFLARE_OPENMELD_AI_GATEWAY_TOKEN"
    | "OPENMELD_REMOTE_AGENT_OPENROUTER_BYOK_ALIAS"
  >;
}): Record<string, string | null> {
  return {
    ...buildRemoteAgentAiGatewayHeaders({ env: input.env }),
    "cf-aig-collect-log": "false",
    "cf-aig-collect-log-payload": "false",
    "cf-aig-metadata": null,
    "cf-aig-skip-cache": "true",
  };
}

export function prepareRemoteAgentZeroRetentionOpenRouterPayload(
  payload: unknown
): Record<string, unknown> {
  if (!(typeof payload === "object" && payload !== null)) {
    throw new Error("Transient Slack model payload must be an object.");
  }
  const record = payload as Record<string, unknown>;
  const currentProvider =
    typeof record.provider === "object" && record.provider !== null
      ? (record.provider as Record<string, unknown>)
      : {};
  return {
    ...record,
    provider: {
      ...currentProvider,
      data_collection: "deny",
      zdr: true,
    },
    store: false,
  };
}
