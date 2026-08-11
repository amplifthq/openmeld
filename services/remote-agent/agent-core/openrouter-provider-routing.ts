/**
 * OpenRouter may reroute an exact model request across providers that serve the
 * same model. Model substitution stays disabled by sending one frozen `model`
 * id and no model-fallback list.
 */
export const REMOTE_AGENT_OPENROUTER_PROVIDER_ROUTING = {
  allow_fallbacks: true,
} as const;
