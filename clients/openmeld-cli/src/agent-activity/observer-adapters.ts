import { createHash } from "node:crypto";
import {
  AGENT_ACTIVITY_PRESENCE_TTL_MAX_MS,
  agentActivityEventSchema,
} from "@openmeld/schemas";
import type { AgentActivityEvent } from "@openmeld/schemas/types";
import { resolveLocalProjectConnectionForPath } from "./project-binding-resolution";
import type { ProjectBinding } from "./project-bindings";
import { normalizeSharedSessionTitle } from "./provider-session-titles";

const ACTIVE_WINDOW_MS = 2 * 60_000;

export type ObservedAgentSession = {
  clientKind: AgentActivityEvent["clientKind"];
  cwd: string;
  eventType: AgentActivityEvent["eventType"];
  gitBranch: string | null;
  gitCommit: string | null;
  model: string | null;
  observedAtMs: number;
  provider: AgentActivityEvent["provider"];
  providerMetadata: Record<string, unknown>;
  providerSessionId: string;
  startedAtMs: number | null;
  status: AgentActivityEvent["status"];
  title: string | null;
};

export function parseCodexRolloutSnapshot(input: {
  lines: readonly unknown[];
  nowMs: number;
  titles?: ReadonlyMap<string, string>;
}): ObservedAgentSession | null {
  const meta = input.lines.find(
    (line) =>
      isRecord(line) && line.type === "session_meta" && isRecord(line.payload)
  );
  if (!(isRecord(meta) && isRecord(meta.payload))) {
    return null;
  }
  const sessionId = text(meta.payload.id);
  const cwd = text(meta.payload.cwd);
  if (!(sessionId && cwd)) {
    return null;
  }
  const safeEvidence = input.lines
    .filter((line): line is Record<string, unknown> => isRecord(line))
    .map((line) => ({
      line,
      observedAtMs: timestamp(line.timestamp),
    }))
    .filter((entry) => entry.observedAtMs !== null)
    .sort(
      (left, right) => Number(left.observedAtMs) - Number(right.observedAtMs)
    );
  const latest = safeEvidence.at(-1);
  const latestTurn = [...safeEvidence]
    .reverse()
    .find((entry) => entry.line.type === "turn_context");
  const observedAtMs = latest?.observedAtMs ?? timestamp(meta.timestamp);
  if (observedAtMs === null) {
    return null;
  }
  const turnPayload = isRecord(latestTurn?.line.payload)
    ? latestTurn.line.payload
    : {};
  const originator = normalizeCodexOriginator(meta.payload);
  const explicitCompletion = safeEvidence.slice(-4).some((entry) => {
    const payload = isRecord(entry.line.payload) ? entry.line.payload : null;
    return (
      entry.line.type === "event_msg" &&
      (payload?.type === "task_complete" || payload?.type === "turn_aborted")
    );
  });
  const status = resolveObservedStatus({
    explicitIdle: explicitCompletion,
    nowMs: input.nowMs,
    observedAtMs,
  });
  const git = isRecord(meta.payload.git) ? meta.payload.git : {};
  return {
    clientKind: resolveCodexClientKind(originator),
    cwd,
    eventType: status === "active" ? "heartbeat" : statusEventType(status),
    gitBranch: nullableText(git.branch),
    gitCommit: nullableText(git.commit_hash),
    model: nullableText(turnPayload.model),
    observedAtMs,
    provider: "codex",
    providerMetadata: compact({
      approvalPolicy: enumValue(turnPayload.approval_policy, [
        "untrusted",
        "on-failure",
        "on-request",
        "never",
      ]),
      cliVersion: nullableText(meta.payload.cli_version),
      contextWindow: positiveInteger(
        isRecord(turnPayload.summary)
          ? turnPayload.summary.model_context_window
          : undefined
      ),
      modelProvider: nullableText(meta.payload.model_provider),
      originator,
      reasoningEffort: enumValue(turnPayload.effort, [
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
        "ultra",
      ]),
      sandboxMode: enumValue(
        isRecord(turnPayload.sandbox_policy)
          ? turnPayload.sandbox_policy.type
          : turnPayload.sandbox_policy,
        ["read-only", "workspace-write", "danger-full-access"]
      ),
      source: "rollout",
    }),
    providerSessionId: sessionId,
    startedAtMs: timestamp(meta.payload.timestamp ?? meta.timestamp),
    status,
    title: normalizeSharedSessionTitle(input.titles?.get(sessionId)),
  };
}

function resolveCodexClientKind(
  originator: "cli" | "desktop" | "subagent" | undefined
) {
  if (originator === "desktop") {
    return "codex-app" as const;
  }
  return originator === "cli" ? ("codex-cli" as const) : ("unknown" as const);
}

export function parseClaudeTranscriptSnapshot(input: {
  lines: readonly unknown[];
  nowMs: number;
}): ObservedAgentSession | null {
  const records = input.lines.filter((line): line is Record<string, unknown> =>
    isRecord(line)
  );
  const identity = records.find(
    (line) => text(line.sessionId) && text(line.cwd)
  );
  if (!identity) {
    return null;
  }
  const providerSessionId = text(identity.sessionId);
  const cwd = text(identity.cwd);
  if (!(providerSessionId && cwd)) {
    return null;
  }
  const timed = records
    .map((line) => ({ line, observedAtMs: timestamp(line.timestamp) }))
    .filter(
      (
        entry
      ): entry is { line: Record<string, unknown>; observedAtMs: number } =>
        entry.observedAtMs !== null
    )
    .sort((left, right) => left.observedAtMs - right.observedAtMs);
  const latest = timed.at(-1);
  if (!latest) {
    return null;
  }
  const latestWithModel = [...timed]
    .reverse()
    .find(
      (entry) => isRecord(entry.line.message) && text(entry.line.message.model)
    );
  const customTitle = [...records]
    .reverse()
    .find((line) => line.type === "custom-title");
  const status = resolveObservedStatus({
    explicitIdle: false,
    nowMs: input.nowMs,
    observedAtMs: latest.observedAtMs,
  });
  return {
    clientKind: "claude-code-cli",
    cwd,
    eventType: status === "active" ? "heartbeat" : statusEventType(status),
    gitBranch: nullableText(latest.line.gitBranch ?? identity.gitBranch),
    gitCommit: null,
    model: isRecord(latestWithModel?.line.message)
      ? nullableText(latestWithModel.line.message.model)
      : null,
    observedAtMs: latest.observedAtMs,
    provider: "claude-code",
    providerMetadata: compact({
      entrypoint: normalizeClaudeEntrypoint(
        latest.line.entrypoint ?? identity.entrypoint
      ),
      isSidechain:
        typeof latest.line.isSidechain === "boolean"
          ? latest.line.isSidechain
          : undefined,
      parentSessionId: nullableText(latest.line.parentSessionId),
      permissionMode: enumValue(
        latest.line.permissionMode ?? latest.line.permission_mode,
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
      source: "jsonl",
      version: nullableText(latest.line.version ?? identity.version),
    }),
    providerSessionId,
    startedAtMs: timestamp(identity.timestamp),
    status,
    title: boundedTitle(
      customTitle?.customTitle ??
        customTitle?.title ??
        customTitle?.custom_title
    ),
  };
}

export function parseOpenCodeSessionRow(input: {
  nowMs: number;
  row: Record<string, unknown>;
}): ObservedAgentSession | null {
  const providerSessionId = text(input.row.id);
  const cwd = text(input.row.directory);
  const observedAtMs = timestamp(input.row.time_updated);
  if (!(providerSessionId && cwd && observedAtMs !== null)) {
    return null;
  }
  const model = parseJsonRecord(input.row.model);
  const archived = timestamp(input.row.time_archived);
  const status =
    archived === null
      ? resolveObservedStatus({
          explicitIdle: false,
          nowMs: input.nowMs,
          observedAtMs,
        })
      : ("ended" as const);
  return {
    clientKind: "unknown",
    cwd,
    eventType: status === "active" ? "heartbeat" : statusEventType(status),
    gitBranch: null,
    gitCommit: null,
    model: nullableText(model?.id),
    observedAtMs,
    provider: "opencode",
    providerMetadata: compact({
      agent: nullableText(input.row.agent),
      cost: finiteNonnegative(input.row.cost),
      modelProvider: nullableText(model?.providerID),
      modelVariant: nullableText(model?.variant),
      parentSessionId: nullableText(input.row.parent_id),
      tokensCacheRead: nonnegativeInteger(input.row.tokens_cache_read),
      tokensCacheWrite: nonnegativeInteger(input.row.tokens_cache_write),
      tokensInput: nonnegativeInteger(input.row.tokens_input),
      tokensOutput: nonnegativeInteger(input.row.tokens_output),
      tokensReasoning: nonnegativeInteger(input.row.tokens_reasoning),
      version: nullableText(input.row.version),
    }),
    providerSessionId,
    startedAtMs: timestamp(input.row.time_created),
    status,
    title: normalizeSharedSessionTitle(input.row.title),
  };
}

export async function buildAgentActivityEvent(input: {
  bindings: readonly ProjectBinding[];
  observed: ObservedAgentSession;
}): Promise<AgentActivityEvent | null> {
  const binding = await resolveObservedAgentActivityBinding(
    input.observed.cwd,
    input.bindings
  );
  if (!binding) {
    return null;
  }
  const active = input.observed.status === "active";
  const event = {
    clientKind: input.observed.clientKind,
    eventId: buildEventId(input.observed, binding),
    eventType: input.observed.eventType,
    expiresAtMs: active
      ? input.observed.observedAtMs + AGENT_ACTIVITY_PRESENCE_TTL_MAX_MS
      : input.observed.observedAtMs,
    gitBranch: input.observed.gitBranch,
    gitCommit: input.observed.gitCommit,
    model: input.observed.model,
    observedAtMs: input.observed.observedAtMs,
    organizationId: binding.organizationId,
    projectId: binding.projectId,
    provider: input.observed.provider,
    providerMetadata: input.observed.providerMetadata,
    providerSessionId: input.observed.providerSessionId,
    repositoryFingerprint: binding.repositoryFingerprint,
    source: "observed" as const,
    startedAtMs: input.observed.startedAtMs,
    status: input.observed.status,
    title: input.observed.title,
  };
  const parsed = agentActivityEventSchema.safeParse(event);
  return parsed.success ? parsed.data : null;
}

export async function resolveObservedAgentActivityBinding(
  cwd: string,
  bindings: readonly ProjectBinding[]
) {
  return await resolveLocalProjectConnectionForPath({
    connections: bindings,
    path: cwd,
  });
}

function buildEventId(observed: ObservedAgentSession, binding: ProjectBinding) {
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        clientKind: observed.clientKind,
        eventType: observed.eventType,
        gitBranch: observed.gitBranch,
        gitCommit: observed.gitCommit,
        model: observed.model,
        observedAtMs: observed.observedAtMs,
        organizationId: binding.organizationId,
        projectId: binding.projectId,
        provider: observed.provider,
        providerMetadata: observed.providerMetadata,
        providerSessionId: observed.providerSessionId,
        repositoryFingerprint: binding.repositoryFingerprint,
        startedAtMs: observed.startedAtMs,
        status: observed.status,
        title: observed.title,
      })
    )
    .digest("hex");
  return `activity_event_${digest}`;
}

function statusEventType(status: AgentActivityEvent["status"]) {
  if (status === "idle") {
    return "session_idle" as const;
  }
  if (status === "ended") {
    return "session_ended" as const;
  }
  if (status === "error") {
    return "session_error" as const;
  }
  return "session_updated" as const;
}

function resolveObservedStatus(input: {
  explicitIdle: boolean;
  nowMs: number;
  observedAtMs: number;
}): "active" | "idle" {
  return !input.explicitIdle &&
    input.nowMs - input.observedAtMs <= ACTIVE_WINDOW_MS
    ? "active"
    : "idle";
}

function normalizeCodexOriginator(meta: Record<string, unknown>) {
  if (text(meta.originator) === "Codex Desktop") {
    return "desktop" as const;
  }
  if (isRecord(meta.source) && "subagent" in meta.source) {
    return "subagent" as const;
  }
  const originator = text(meta.originator)?.toLowerCase();
  return originator === "codex cli" || originator === "codex_cli"
    ? ("cli" as const)
    : undefined;
}

function normalizeClaudeEntrypoint(value: unknown) {
  const normalized = text(value);
  if (normalized === "claude-desktop") {
    return "desktop" as const;
  }
  return normalized === "cli" ? ("cli" as const) : undefined;
}

function boundedTitle(value: unknown) {
  const normalized = nullableText(value);
  return normalized && normalized.length <= 240 ? normalized : null;
}

function compact(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  );
}

function enumValue<const T extends readonly string[]>(
  value: unknown,
  allowed: T
): T[number] | undefined {
  const normalized = text(value);
  return normalized && allowed.includes(normalized) ? normalized : undefined;
}

function positiveInteger(value: unknown) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

function nonnegativeInteger(value: unknown) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : undefined;
}

function finiteNonnegative(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function timestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.trunc(value);
  }
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function nullableText(value: unknown) {
  const normalized = text(value);
  return normalized && normalized.length <= 512 ? normalized : null;
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseJsonRecord(value: unknown) {
  if (isRecord(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
