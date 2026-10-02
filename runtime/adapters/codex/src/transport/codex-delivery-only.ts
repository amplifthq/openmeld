import {
  type AdapterDispatchRequest,
  isDispatchSpaceActionDeliveryOnly,
  OPENMELD_SPACE_ACTION_MCP_SERVER_ID,
} from "@openmeld/adapter-core";

export function isCodexDeliveryOnly(
  input: Pick<AdapterDispatchRequest, "env" | "spaceActionTools">
): boolean {
  return Boolean(
    input.spaceActionTools?.deliveryOnly ||
      isDispatchSpaceActionDeliveryOnly(input.env)
  );
}

/** Per-invocation tool scope, not a replacement for the owner's permission mode. */
export function buildCodexDeliveryOnlyConfig(
  configuration: unknown
): Record<string, unknown> {
  const config = asRecord(asRecord(configuration)?.config);
  if (!(config && asRecord(config.mcp_servers))) {
    throw new Error("The native tool configuration could not be verified.");
  }
  const servers = asRecord(config.mcp_servers) ?? {};
  const apps = asRecord(config.apps) ?? {};
  return {
    "features.shell_tool": false,
    "features.unified_exec": false,
    "features.goals": false,
    "features.multi_agent": false,
    "features.multi_agent_v2": false,
    "agents.enabled": false,
    "features.hooks": false,
    "features.plugins": false,
    "features.remote_plugin": false,
    "features.skill_search": false,
    "features.skill_mcp_dependency_install": false,
    "features.tool_suggest": false,
    "features.image_generation": false,
    "features.memories": false,
    web_search: "disabled",
    apps: Object.fromEntries(
      ["_default", ...Object.keys(apps)].map((name) => [
        name,
        { enabled: false },
      ])
    ),
    mcp_servers: Object.fromEntries(
      Object.entries(servers).map(([name, value]) => [
        name,
        {
          ...Object.fromEntries(
            Object.entries(asRecord(value) ?? {}).filter(
              ([, setting]) => setting !== null
            )
          ),
          ...(name === OPENMELD_SPACE_ACTION_MCP_SERVER_ID
            ? {}
            : { enabled: false }),
        },
      ])
    ),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
