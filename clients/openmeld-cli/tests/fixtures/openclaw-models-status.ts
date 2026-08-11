// Captured from `openclaw models status --check --json` with OpenClaw
// 2026.3.13 in a fresh isolated state. Local paths are normalized for the
// fixture; the response shape and missing-auth evidence are unchanged.
export const OPENCLAW_MODELS_STATUS_MISSING_AUTH_RESPONSE = {
  agentDir: "/tmp/openclaw/agents/main/agent",
  aliases: {},
  allowed: [],
  auth: {
    missingProvidersInUse: ["anthropic"],
    oauth: {
      profiles: [],
      providers: [
        {
          profiles: [],
          provider: "anthropic",
          status: "missing",
        },
      ],
      warnAfterMs: 86_400_000,
    },
    providers: [],
    providersWithOAuth: [],
    shellEnvFallback: {
      appliedKeys: [],
      enabled: false,
    },
    storePath: "/tmp/openclaw/agents/main/agent/auth-profiles.json",
    unusableProfiles: [],
  },
  configPath: "/tmp/openclaw/openclaw.json",
  defaultModel: "anthropic/claude-opus-4-6",
  fallbacks: [],
  imageFallbacks: [],
  imageModel: null,
  resolvedDefault: "anthropic/claude-opus-4-6",
} as const;
