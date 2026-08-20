import type {
  AgentActivityEvent,
  AgentActivityProvider,
} from "@openmeld/schemas/types";
import { buildControllerTaskLifecycleEvent } from "./controller-task-lifecycle-hook";
import { enqueueControllerTaskLifecycleEventWhileLocked } from "./controller-task-lifecycle-store";
import { enqueueAgentActivityHookEvent } from "./hook-inbox";
import {
  buildAgentActivityEvent,
  type ObservedAgentSession,
  resolveObservedAgentActivityBinding,
} from "./observer-adapters";
import {
  listProjectBindings,
  runIfAgentActivityBindingGenerationIsCurrent,
} from "./project-bindings";
import {
  normalizeSharedSessionTitle,
  readCodexSessionTitles,
} from "./provider-session-titles";

export class AgentControllerTaskLifecycleDurabilityError extends Error {
  constructor(cause: unknown) {
    super("Agent Controller task lifecycle evidence could not be persisted.", {
      cause,
    });
    this.name = "AgentControllerTaskLifecycleDurabilityError";
  }
}

export async function ingestAgentActivityHook(input: {
  homeDir?: string;
  nowMs?: number;
  payload: unknown;
  provider: AgentActivityProvider;
  rootDir?: string;
}): Promise<"ignored" | "queued" | "reconciled" | "reused" | "unbound"> {
  if (!isRecord(input.payload)) {
    return "ignored";
  }
  const cwd = resolveHookCwd(input.payload);
  const providerSessionId =
    text(input.payload.session_id) ??
    text(input.payload.sessionId) ??
    text(input.payload.conversation_id) ??
    text(input.payload.conversationId);
  if (!(cwd && providerSessionId)) {
    return "ignored";
  }
  const nowMs = input.nowMs ?? Date.now();
  const hookEvent = text(input.payload.hook_event_name) ?? "unknown";
  const status = hookStatus(
    input.provider,
    hookEvent,
    input.payload.status ?? input.payload.reason
  );
  const bindings = await listProjectBindings({
    rootDir: input.rootDir,
  });
  const binding = await resolveObservedAgentActivityBinding(cwd, bindings);
  if (!binding) {
    return "unbound";
  }
  const lifecycleOutcome = await enqueueControllerTaskLifecycleForHook({
    bindingGeneration: binding.bindingGeneration,
    nowMs,
    organizationId: binding.organizationId,
    payload: input.payload,
    projectId: binding.projectId,
    provider: input.provider,
    rootDir: input.rootDir,
  });
  const commonMetadata = await resolveHookCommonMetadata({
    homeDir: input.homeDir,
    payload: input.payload,
    provider: input.provider,
    providerSessionId,
  });
  const observed: ObservedAgentSession = {
    clientKind: resolveHookClientKind(input.provider, input.payload),
    cwd,
    eventType: hookEventType(hookEvent, status),
    gitBranch: commonMetadata.gitBranch,
    gitCommit: null,
    model: commonMetadata.model,
    observedAtMs: nowMs,
    provider: input.provider,
    providerMetadata: resolveHookProviderMetadata(
      input.provider,
      input.payload
    ),
    providerSessionId,
    startedAtMs:
      hookEvent === "SessionStart" || hookEvent === "sessionStart"
        ? nowMs
        : null,
    status,
    title: commonMetadata.title,
  };
  const event = await buildAgentActivityEvent({
    bindings: [binding],
    observed,
  });
  if (!event) {
    return lifecycleOutcome ?? "ignored";
  }
  const activityOutcome = await runIfAgentActivityBindingGenerationIsCurrent(
    {
      bindingGeneration: binding.bindingGeneration,
      organizationId: binding.organizationId,
      projectId: binding.projectId,
      rootDir: input.rootDir,
    },
    async () =>
      await enqueueAgentActivityHookEvent({
        bindingGeneration: binding.bindingGeneration,
        event,
        rootDir: input.rootDir,
      })
  );
  if (lifecycleOutcome === "queued" || activityOutcome === "queued") {
    return "queued";
  }
  if (lifecycleOutcome === "reused" || activityOutcome === "reused") {
    return "reused";
  }
  return "unbound";
}

async function resolveHookCommonMetadata(input: {
  homeDir?: string;
  payload: Record<string, unknown>;
  provider: AgentActivityProvider;
  providerSessionId: string;
}) {
  if (input.provider === "cursor") {
    return {
      gitBranch: null,
      model: null,
      title: null,
    };
  }
  const title =
    normalizeSharedSessionTitle(
      input.payload.session_title ?? input.payload.sessionTitle
    ) ??
    (input.provider === "codex"
      ? ((await readCodexSessionTitles({ homeDir: input.homeDir })).get(
          input.providerSessionId
        ) ?? null)
      : null);
  return {
    gitBranch: nullableText(input.payload.gitBranch),
    model: nullableText(input.payload.model),
    title,
  };
}

async function enqueueControllerTaskLifecycleForHook(input: {
  bindingGeneration: string;
  nowMs: number;
  organizationId: string;
  payload: Record<string, unknown>;
  projectId: string;
  provider: AgentActivityProvider;
  rootDir?: string;
}) {
  if (input.provider !== "claude-code" && input.provider !== "codex") {
    return null;
  }
  const event = buildControllerTaskLifecycleEvent({
    nowMs: input.nowMs,
    organizationId: input.organizationId,
    payload: input.payload,
    provider: input.provider,
  });
  if (!event) {
    return null;
  }
  return await runIfAgentActivityBindingGenerationIsCurrent(
    {
      bindingGeneration: input.bindingGeneration,
      organizationId: input.organizationId,
      projectId: input.projectId,
      rootDir: input.rootDir,
    },
    async () => {
      try {
        return await enqueueControllerTaskLifecycleEventWhileLocked({
          event,
          nowMs: input.nowMs,
          rootDir: input.rootDir,
        });
      } catch (error) {
        throw new AgentControllerTaskLifecycleDurabilityError(error);
      }
    }
  );
}

function hookEventType(
  name: string,
  status: AgentActivityEvent["status"]
): AgentActivityEvent["eventType"] {
  if (
    name === "SessionStart" ||
    name === "sessionStart" ||
    name === "session.created"
  ) {
    return "session_started";
  }
  if (
    name === "UserPromptSubmit" ||
    name === "beforeSubmitPrompt" ||
    status === "active"
  ) {
    return "session_active";
  }
  if (status === "idle") {
    return "session_idle";
  }
  if (status === "ended") {
    return "session_ended";
  }
  if (status === "error") {
    return "session_error";
  }
  return "session_updated";
}

function resolveHookClientKind(
  provider: AgentActivityProvider,
  payload: Record<string, unknown>
) {
  if (provider === "claude-code") {
    return "claude-code-cli" as const;
  }
  if (provider === "codex") {
    return normalizeCodexClient(payload.originator);
  }
  if (provider === "cursor") {
    return "unknown" as const;
  }
  return "unknown" as const;
}

function resolveHookProviderMetadata(
  provider: AgentActivityProvider,
  payload: Record<string, unknown>
) {
  if (provider === "claude-code") {
    return compact({
      permissionMode: enumValue(
        payload.permission_mode ?? payload.permissionMode,
        [
          "default",
          "acceptEdits",
          "plan",
          "dontAsk",
          "bypassPermissions",
          "ask",
          "allow",
        ]
      ),
      source: "hook",
    });
  }
  if (provider === "codex") {
    return compact({
      approvalPolicy: enumValue(payload.approval_policy, [
        "untrusted",
        "on-failure",
        "on-request",
        "never",
      ]),
      originator: normalizeCodexOriginator(payload.originator),
      source: "hook",
    });
  }
  if (provider === "cursor") {
    return compact({
      composerMode: enumValue(payload.composer_mode ?? payload.composerMode, [
        "agent",
        "chat",
        "plan",
        "debug",
      ]),
      isBackgroundAgent:
        typeof (payload.is_background_agent ?? payload.isBackgroundAgent) ===
        "boolean"
          ? (payload.is_background_agent ?? payload.isBackgroundAgent)
          : undefined,
      source: "hook",
      version:
        nullableText(payload.cursor_version ?? payload.cursorVersion) ??
        undefined,
    });
  }
  return {};
}

export async function readAgentActivityHookStdin(input?: {
  stream?: NodeJS.ReadableStream;
}) {
  const stream = input?.stream ?? process.stdin;
  let raw = "";
  for await (const chunk of stream) {
    raw += String(chunk);
    if (Buffer.byteLength(raw) > 64 * 1024) {
      return null;
    }
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function hookStatus(
  provider: AgentActivityProvider,
  name: string,
  providerStatus: unknown
): AgentActivityEvent["status"] {
  if (provider === "claude-code") {
    return claudeCodeHookStatus(name, providerStatus);
  }
  if (name === "session.error") {
    return "error";
  }
  if (name === "session.deleted") {
    return "ended";
  }
  if (name === "sessionEnd") {
    return text(providerStatus) === "error" ? "error" : "ended";
  }
  if (name === "session.status") {
    const normalized = text(providerStatus);
    if (normalized === "idle") {
      return "idle";
    }
    if (normalized === "busy" || normalized === "retry") {
      return "active";
    }
    return "unknown";
  }
  if (name === "session.created" || name === "session.updated") {
    return "unknown";
  }
  if (name === "Stop" || name === "Notification" || name === "session.idle") {
    return "idle";
  }
  if (name === "stop") {
    return text(providerStatus) === "error" ? "error" : "idle";
  }
  return "active";
}

function claudeCodeHookStatus(
  name: string,
  providerStatus: unknown
): AgentActivityEvent["status"] {
  if (name === "SessionEnd") {
    return text(providerStatus) === "error" ? "error" : "ended";
  }
  if (name === "Stop") {
    return text(providerStatus) === "error" ? "error" : "idle";
  }
  if (
    name === "SessionStart" ||
    name === "UserPromptSubmit" ||
    name === "PreToolUse" ||
    name === "PostToolUse"
  ) {
    return "active";
  }
  return "unknown";
}

function resolveHookCwd(payload: Record<string, unknown>) {
  const cwd = text(payload.cwd);
  if (cwd) {
    return cwd;
  }
  if (!Array.isArray(payload.workspace_roots)) {
    return null;
  }
  const roots = payload.workspace_roots
    .map((value) => text(value))
    .filter((value): value is string => value !== null);
  return roots.length === 1 ? roots[0] : null;
}

function normalizeCodexClient(value: unknown) {
  return text(value) === "Codex Desktop" ? "codex-app" : "unknown";
}

function normalizeCodexOriginator(value: unknown) {
  if (text(value) === "Codex Desktop") {
    return "desktop" as const;
  }
  if (text(value)) {
    return "cli" as const;
  }
  return undefined;
}

function enumValue<const T extends readonly string[]>(
  value: unknown,
  allowed: T
): T[number] | undefined {
  const normalized = text(value);
  return normalized && allowed.includes(normalized)
    ? (normalized as T[number])
    : undefined;
}

function compact(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  );
}

function nullableText(value: unknown) {
  const normalized = text(value);
  return normalized && normalized.length <= 512 ? normalized : null;
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
