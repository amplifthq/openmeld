const CODEX_THREAD_ID_ENV = "CODEX_THREAD_ID";
const CLAUDE_CODE_SESSION_ID_ENV = "CLAUDE_CODE_SESSION_ID";

export type DetectedLocalAgentEnvironment =
  | {
      kind: "agent";
      agentControllerConversationId: string;
      agentControllerRef: "builtin:claude-code" | "builtin:codex";
      conversationKind: "session" | "thread";
      label: "Claude Code" | "Codex";
    }
  | {
      kind: "codex_missing_thread";
    }
  | {
      kind: "human";
    };

export function detectLocalAgentEnvironment(
  env: NodeJS.ProcessEnv
): DetectedLocalAgentEnvironment {
  const claudeSessionId = normalizeOptionalString(
    env[CLAUDE_CODE_SESSION_ID_ENV]
  );
  if (claudeSessionId) {
    return {
      kind: "agent",
      agentControllerConversationId: claudeSessionId,
      agentControllerRef: "builtin:claude-code",
      conversationKind: "session",
      label: "Claude Code",
    };
  }

  const codexThreadId = normalizeOptionalString(env[CODEX_THREAD_ID_ENV]);
  if (codexThreadId) {
    return {
      kind: "agent",
      agentControllerConversationId: codexThreadId,
      agentControllerRef: "builtin:codex",
      conversationKind: "thread",
      label: "Codex",
    };
  }

  if (isCodexLikeEnvironment(env)) {
    return { kind: "codex_missing_thread" };
  }

  return { kind: "human" };
}

function isCodexLikeEnvironment(env: NodeJS.ProcessEnv): boolean {
  return Boolean(
    normalizeOptionalString(env.CODEX_SHELL) ||
      normalizeOptionalString(env.CODEX_CI) ||
      normalizeOptionalString(env.CODEX_SESSION_ID) ||
      normalizeOptionalString(env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE)
  );
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
