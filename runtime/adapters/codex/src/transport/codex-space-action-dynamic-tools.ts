import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import type {
  AdapterDispatchSpaceTools,
  AgentControllerPermissionMode,
} from "@openmeld/adapter-core";
import { OPENMELD_SPACE_ACTION_MCP_SERVER_ID } from "@openmeld/adapter-core";
import { supportsAgentControllerVersion } from "@openmeld/agent-runtime";
import { toJSONSchema } from "zod/v4";

const NATIVE_THREAD_SUFFIX = "/openmeld-space-tools-v1";
const NATIVE_TOOL_PREFIX = "openmeld_space_";

// Only transport fields are safe to carry across without interpreting policy.
// A new/unknown native policy stays on MCP rather than silently losing it.
const TRANSPORT_FIELDS = new Set([
  "command",
  "args",
  "env",
  "env_vars",
  "cwd",
  "url",
  "http_headers",
  "env_http_headers",
  "bearer_token_env_var",
  "environment_id",
  "required",
  "startup_timeout_sec",
  "startup_timeout_ms",
  "tool_timeout_sec",
]);

export function supportsCodexSpaceDynamicTools(
  version: string | null
): boolean {
  // 0.150.1 is the executable/protocol baseline verified by this adapter.
  return supportsAgentControllerVersion(version, ">=0.150.1");
}

export function hasCodexSpaceDynamicTools(source: string | null): boolean {
  return source?.endsWith(NATIVE_THREAD_SUFFIX) ?? false;
}

export async function readCodexSpaceDynamicToolCarrier(input: {
  thread: unknown;
  codexHome: unknown;
}): Promise<boolean> {
  const thread = asRecord(input.thread);
  if (
    typeof thread?.threadSource === "string" &&
    hasCodexSpaceDynamicTools(thread.threadSource)
  ) {
    return true;
  }
  if (thread?.path == null) {
    return false;
  }
  // Native 0.150.1 returns threadSource=null from thread/read even though the
  // rollout retains both thread_source and dynamic_tools. Parse only its bounded
  // metadata header, never conversation text or a separate authorization file.
  if (typeof thread.path !== "string" || typeof input.codexHome !== "string") {
    throw new Error("Native tool metadata is unavailable.");
  }
  const home = await realpath(input.codexHome);
  const path = await realpath(thread.path);
  const withinHome = relative(home, path);
  if (
    isAbsolute(withinHome) ||
    withinHome.startsWith(`..${sep}`) ||
    !["sessions", "archived_sessions"].includes(withinHome.split(sep)[0] ?? "")
  ) {
    throw new Error(
      "Native tool metadata is outside the controller's session store."
    );
  }
  const file = await open(
    path,
    // biome-ignore lint/suspicious/noBitwiseOperators: Native open flags are a bitmask; never follow links or block on pipes.
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
  );
  try {
    if (!(await file.stat()).isFile()) {
      throw new Error("Native tool metadata is not a regular file.");
    }
    const buffer = Buffer.alloc(1024 * 1024);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    const end = buffer.subarray(0, bytesRead).indexOf(10);
    if (end < 0) {
      throw new Error("Native tool metadata exceeds the bounded header read.");
    }
    const header = asRecord(
      JSON.parse(buffer.subarray(0, end).toString("utf8"))
    );
    const metadata = asRecord(header?.payload);
    if (
      header?.type !== "session_meta" ||
      !metadata ||
      typeof thread.id !== "string" ||
      metadata.id !== thread.id
    ) {
      throw new Error("Native tool metadata does not identify this thread.");
    }
    const tools = metadata.dynamic_tools;
    if (tools == null) {
      return false;
    }
    if (!Array.isArray(tools)) {
      throw new Error("Native tool metadata is malformed.");
    }
    return tools.some(
      (tool) => codexSpaceDynamicToolName(asRecord(tool)?.name) !== null
    );
  } finally {
    await file.close();
  }
}

export function codexSpaceDynamicThreadSource(source: string): string {
  return hasCodexSpaceDynamicTools(source)
    ? source
    : `${source}${NATIVE_THREAD_SUFFIX}`;
}

export function codexSpaceInstructionThreadSource(
  source: string | null
): string | null {
  return hasCodexSpaceDynamicTools(source)
    ? (source?.slice(0, -NATIVE_THREAD_SUFFIX.length) ?? null)
    : source;
}

export function canUseCodexSpaceDynamicTools(input: {
  configuration: unknown;
  permissionMode?: AgentControllerPermissionMode;
}): boolean {
  if (input.permissionMode === "codex:customConfig") {
    return false;
  }
  const config = asRecord(asRecord(input.configuration)?.config);
  const servers = asRecord(config?.mcp_servers);
  const server = asRecord(servers?.[OPENMELD_SPACE_ACTION_MCP_SERVER_ID]);
  if (!server) {
    return false;
  }
  return Object.entries(server).every(([name, value]) => {
    if (TRANSPORT_FIELDS.has(name)) {
      return true;
    }
    if (name === "enabled") {
      return value === true;
    }
    if (name === "disabled_tools") {
      return value === null || (Array.isArray(value) && value.length === 0);
    }
    if (name === "default_tools_approval_mode") {
      return value === null || value === "approve";
    }
    // An explicit allowlist, per-tool policy, or future policy belongs to the
    // native MCP authorizer. Dynamic tools must not bypass it.
    return value === null && (name === "enabled_tools" || name === "tools");
  });
}

export function buildCodexSpaceDynamicTools(
  capability: AdapterDispatchSpaceTools
) {
  return capability.tools.map((tool) => ({
    type: "function" as const,
    name: `${NATIVE_TOOL_PREFIX}${tool.name}`,
    description: tool.description,
    inputSchema: toJSONSchema(tool.inputSchema, {
      target: "draft-07",
      io: "input",
    }),
    deferLoading: false,
  }));
}

export function codexSpaceDynamicToolName(value: unknown): string | null {
  return typeof value === "string" && value.startsWith(NATIVE_TOOL_PREFIX)
    ? value.slice(NATIVE_TOOL_PREFIX.length)
    : null;
}

/** One live App Server invocation, never a persisted thread authorization. */
export class CodexSpaceDynamicToolInvocation {
  enabled = false;
  private readonly capability: AdapterDispatchSpaceTools | undefined;
  private readonly cancellationSignal?: AbortSignal;
  #turn: {
    threadId: string;
    turnId: string | null;
    active: boolean;
    ready: Promise<void>;
    release: () => void;
  } | null = null;

  constructor(
    capability: AdapterDispatchSpaceTools | undefined,
    cancellationSignal?: AbortSignal
  ) {
    this.capability = capability;
    this.cancellationSignal = cancellationSignal;
  }

  begin(threadId: string): void {
    this.fence();
    const { promise, resolve } = Promise.withResolvers<void>();
    this.#turn = {
      threadId,
      turnId: null,
      active: true,
      ready: promise,
      release: resolve,
    };
  }

  accept(turnId: string): void {
    if (this.#turn) {
      this.#turn.turnId = turnId;
      this.#turn.release();
    }
  }

  fence(): void {
    if (this.#turn) {
      this.#turn.active = false;
      this.#turn.release();
    }
  }

  async call(params: unknown) {
    const turn = this.#turn;
    if (turn) {
      await turn.ready;
    }
    const request = asRecord(params);
    const name = codexSpaceDynamicToolName(request?.tool);
    if (
      !(this.enabled && this.capability && turn?.active) ||
      this.cancellationSignal?.aborted ||
      request?.threadId !== turn.threadId ||
      request?.turnId !== turn.turnId ||
      typeof request?.callId !== "string" ||
      !request.callId ||
      (request.namespace !== null && request.namespace !== undefined) ||
      !name ||
      !this.capability.tools.some((tool) => tool.name === name)
    ) {
      return dynamicToolFailure(
        "This call was not executed: it is not an available tool in the active Wake turn."
      );
    }
    try {
      const result = await this.capability.call(name, request.arguments);
      return {
        success: result.isError !== true,
        contentItems: result.content.map((item) => ({
          type: "inputText" as const,
          text: item.text,
        })),
      };
    } catch {
      // The shared recorder owns the outcome. A carrier failure is not proof
      // that a write was rejected and must never trigger a transport replay.
      return dynamicToolFailure(
        "The tool result could not be confirmed. Reconcile the saved receipt before submitting another final action."
      );
    }
  }
}

function dynamicToolFailure(text: string) {
  return {
    success: false,
    contentItems: [{ type: "inputText" as const, text }],
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
