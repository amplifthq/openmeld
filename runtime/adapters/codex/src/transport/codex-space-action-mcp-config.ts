import {
  OPENMELD_SPACE_ACTION_MCP_SERVER_ID,
  resolveDispatchSpaceActionMcpServer,
} from "@openmeld/adapter-core";

export function buildCodexSpaceActionMcpGlobalArgs(
  env: Record<string, string | undefined>
): string[] {
  const config = resolveDispatchSpaceActionMcpServer(env);
  if (!config) {
    return [];
  }

  const server = `mcp_servers.${OPENMELD_SPACE_ACTION_MCP_SERVER_ID}`;
  return [
    "-c",
    `${server}.command=${toTomlString(config.commandPath)}`,
    "-c",
    `${server}.args=${toTomlStringArray(config.args)}`,
    "-c",
    `${server}.env_vars=${toTomlStringArray(Object.keys(config.env))}`,
    "-c",
    `${server}.required=true`,
  ];
}

function toTomlString(value: string): string {
  return JSON.stringify(value);
}

function toTomlStringArray(values: readonly string[]): string {
  return `[${values.map(toTomlString).join(",")}]`;
}
