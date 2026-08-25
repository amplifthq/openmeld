const OPENMELD_SPACE_ACTION_CONTEXT_PATH_ENV =
  "OPENMELD_SPACE_ACTION_CONTEXT_PATH";
const OPENMELD_USER_FACING_CLI_COMMAND_ENV = "OPENMELD_USER_FACING_CLI_COMMAND";
const OPENMELD_SPACE_ACTION_MCP_SERVER_ID =
  "openmeld_internal_dispatch_space_action";
const OPENMELD_SPACE_ACTION_MCP_TOOLS = [
  "reply",
  "status",
  "stay_silent",
] as const;
const OPENMELD_SPACE_ACTION_MCP_ENV_VARS = [
  "OPENMELD_SPACE_ACTION_CONTEXT_PATH",
  "OPENMELD_DISPATCH_RUNTIME_MODE",
  "OPENMELD_DISPATCH_RUNTIME_DISPATCH_ID",
  "OPENMELD_DISPATCH_RUNTIME_TARGET_PROFILE_ID",
  "OPENMELD_USER_FACING_CLI_COMMAND",
  "OPENMELD_ENV_PRESET",
] as const;
const OPENMELD_CLI_COMMANDS = new Set([
  "openmeld",
  "openmeld-dev",
  "openmeld-canary",
]);

export function buildCodexSpaceActionMcpGlobalArgs(
  env: Record<string, string | undefined>
): string[] {
  if (!normalizeOptionalText(env[OPENMELD_SPACE_ACTION_CONTEXT_PATH_ENV])) {
    return [];
  }

  const command = normalizeOptionalText(
    env[OPENMELD_USER_FACING_CLI_COMMAND_ENV]
  );
  if (!(command && OPENMELD_CLI_COMMANDS.has(command))) {
    throw new Error(
      "OpenMeld cannot start the dispatch Space Action tool because the active CLI command is invalid."
    );
  }

  const server = `mcp_servers.${OPENMELD_SPACE_ACTION_MCP_SERVER_ID}`;
  return [
    "-c",
    `${server}.command=${toTomlString(command)}`,
    "-c",
    `${server}.args=${toTomlStringArray(["space", "action", "tool-server"])}`,
    "-c",
    `${server}.env_vars=${toTomlStringArray(
      OPENMELD_SPACE_ACTION_MCP_ENV_VARS
    )}`,
    "-c",
    `${server}.enabled=true`,
    "-c",
    `${server}.required=true`,
    "-c",
    `${server}.enabled_tools=${toTomlStringArray(
      OPENMELD_SPACE_ACTION_MCP_TOOLS
    )}`,
    "-c",
    `${server}.disabled_tools=[]`,
    "-c",
    `${server}.default_tools_approval_mode="approve"`,
  ];
}

function toTomlString(value: string): string {
  return JSON.stringify(value);
}

function toTomlStringArray(values: readonly string[]): string {
  return `[${values.map(toTomlString).join(",")}]`;
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
