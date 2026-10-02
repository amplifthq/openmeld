import type {
  createOpencodeClient,
  PermissionRuleset,
} from "@opencode-ai/sdk/v2";
import {
  buildDispatchSpaceActionMcpToolIds,
  OPENMELD_SPACE_ACTION_MCP_SERVER_ID,
} from "@openmeld/adapter-core";

const SAFE_TOOL_ID = /^[A-Za-z0-9_.:-]+$/u;
const VERSION = /^(\d+)\.(\d+)\.(\d+)$/u;

/** Narrow only the disposable correction session; never grant a final tool. */
export async function prepareOpenCodeDeliveryOnlyTurn(input: {
  client: ReturnType<typeof createOpencodeClient>;
  directory: string;
  sessionId: string;
  sourceSessionId?: string | null;
  env?: Record<string, string | undefined>;
}): Promise<void> {
  if (input.sourceSessionId === input.sessionId) {
    throw scopeError(
      "The correction session is not isolated from the original conversation."
    );
  }
  const options = {
    responseStyle: "data" as const,
    throwOnError: true as const,
  };
  const [health, configResponse, toolIds, sourceResponse] = await Promise.all([
    input.client.global.health(options),
    input.client.config.get({ directory: input.directory }, options),
    input.client.tool.ids({ directory: input.directory }, options),
    input.client.session.get(
      {
        directory: input.directory,
        sessionID: input.sourceSessionId ?? input.sessionId,
      },
      options
    ),
  ]);
  requireOpenCodeDeliveryOnlyVersion(health);
  const config = record(configResponse);
  const source = record(sourceResponse);
  const mcp = config?.mcp === undefined ? {} : record(config.mcp);
  if (
    !(config && source && mcp) ||
    source.id !== (input.sourceSessionId ?? input.sessionId) ||
    !Array.isArray(toolIds) ||
    toolIds.length > 4096 ||
    !toolIds.every(
      (name) => typeof name === "string" && SAFE_TOOL_ID.test(name)
    )
  ) {
    throw scopeError(
      "The native tool inventory or original permission rules could not be verified."
    );
  }
  const original = source.permission ?? [];
  if (!(Array.isArray(original) && original.every(isPermissionRule))) {
    throw scopeError(
      "The original conversation's permission rules are invalid."
    );
  }
  const allowed = new Set(buildDispatchSpaceActionMcpToolIds("_", input.env));
  const denied = new Set(toolIds.filter((name: string) => !allowed.has(name)));
  for (const name of Object.keys(mcp)) {
    if (!SAFE_TOOL_ID.test(name)) {
      throw scopeError("A native MCP identifier cannot be safely restricted.");
    }
    if (name !== OPENMELD_SPACE_ACTION_MCP_SERVER_ID) {
      denied.add(`${name}_*`);
    }
  }
  // Append negative rules only. A pre-existing denial or approval requirement
  // for reply remains intact; do not use prompt.tools=true, which grants access.
  const permission: PermissionRuleset = [
    ...original,
    ...[...denied].map((name) => ({
      permission: name,
      pattern: "*",
      action: "deny" as const,
    })),
  ];
  await input.client.session.update(
    { directory: input.directory, sessionID: input.sessionId, permission },
    options
  );
  const verified = record(
    await input.client.session.get(
      { directory: input.directory, sessionID: input.sessionId },
      options
    )
  );
  if (
    verified?.id !== input.sessionId ||
    JSON.stringify(verified.permission) !== JSON.stringify(permission)
  ) {
    throw scopeError(
      "OpenCode did not confirm the correction session's restricted tool permissions."
    );
  }
}

function requireOpenCodeDeliveryOnlyVersion(health: unknown): void {
  const version = record(health)?.version;
  const match = typeof version === "string" ? VERSION.exec(version) : null;
  // --pure and session permission readback were jointly verified on 1.18.31.
  if (
    match &&
    (Number(match[1]) > 1 ||
      (Number(match[1]) === 1 &&
        (Number(match[2]) > 18 ||
          (Number(match[2]) === 18 && Number(match[3]) >= 31))))
  ) {
    return;
  }
  throw scopeError(
    "This OpenCode installation cannot verify delivery-only execution."
  );
}

function isPermissionRule(value: unknown): value is PermissionRuleset[number] {
  const rule = record(value);
  return Boolean(
    rule &&
      typeof rule.permission === "string" &&
      typeof rule.pattern === "string" &&
      ["allow", "ask", "deny"].includes(String(rule.action))
  );
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function scopeError(message: string): Error {
  return Object.assign(new Error(`${message} No correction prompt was sent.`), {
    code: "space.action.delivery_only_unverified",
    errorType: "config",
  });
}
