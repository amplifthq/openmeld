import { basename, isAbsolute } from "node:path";
import {
  DISPATCH_SPACE_ACTION_DELIVERY_ONLY_ENV,
  isDispatchSpaceActionDeliveryOnly,
} from "./dispatch-space-tools.js";

const SPACE_ACTION_CONTEXT_PATH_ENV = "OPENMELD_SPACE_ACTION_CONTEXT_PATH";
const USER_FACING_CLI_COMMAND_ENV = "OPENMELD_USER_FACING_CLI_COMMAND";
const SPACE_ACTION_TOOL_COMMAND_PATH_ENV =
  "OPENMELD_SPACE_ACTION_TOOL_COMMAND_PATH";

export const OPENMELD_SPACE_ACTION_MCP_SERVER_ID =
  "openmeld_internal_dispatch_space_action";
export const OPENMELD_SPACE_ACTION_MCP_TOOL_NAMES = [
  "working_copy",
  "read_file",
  "read_history",
  "read_result",
  "list_tasks",
  "create_task",
  "start_task",
  "submit_task_result",
  "review_task",
  "cancel_task",
  "reply",
  "stay_silent",
  "read_receipt",
] as const;

const FORWARDED_ENV_NAMES = [
  DISPATCH_SPACE_ACTION_DELIVERY_ONLY_ENV,
  SPACE_ACTION_CONTEXT_PATH_ENV,
  SPACE_ACTION_TOOL_COMMAND_PATH_ENV,
  "OPENMELD_DISPATCH_RUNTIME_MODE",
  "OPENMELD_DISPATCH_RUNTIME_DISPATCH_ID",
  "OPENMELD_DISPATCH_RUNTIME_TARGET_PROFILE_ID",
  USER_FACING_CLI_COMMAND_ENV,
  "OPENMELD_ENV_PRESET",
  // The tool process must use the carrier's lane, not its host's default home.
  // This is an installation selector, not a credential or additional authority.
  "OPENMELD_HOME",
  "OPENMELD_AUTH_URL",
  "OPENMELD_GATEWAY_URL",
] as const;

const OPENMELD_CLI_COMMANDS = new Set([
  "openmeld",
  "openmeld-dev",
  "openmeld-canary",
]);

export type DispatchSpaceActionMcpServer = {
  args: ["space", "action", "tool-server"];
  command: "openmeld" | "openmeld-dev" | "openmeld-canary";
  commandPath: string;
  env: Record<string, string>;
  id: typeof OPENMELD_SPACE_ACTION_MCP_SERVER_ID;
  toolNames: readonly (typeof OPENMELD_SPACE_ACTION_MCP_TOOL_NAMES)[number][];
};

export type AcpDispatchSpaceActionMcpServer = {
  args: string[];
  command: string;
  env: Array<{ name: string; value: string }>;
  name: string;
};

export function resolveDispatchSpaceActionMcpServer(
  env: Record<string, string | undefined> | undefined
): DispatchSpaceActionMcpServer | null {
  if (!normalizeOptionalText(env?.[SPACE_ACTION_CONTEXT_PATH_ENV])) {
    return null;
  }

  const command = normalizeOptionalText(env?.[USER_FACING_CLI_COMMAND_ENV]);
  if (!(command && OPENMELD_CLI_COMMANDS.has(command))) {
    throw new Error(
      "OpenMeld cannot start the dispatch Space Action tool because the active CLI command is invalid."
    );
  }
  const commandPath = normalizeOptionalText(
    env?.[SPACE_ACTION_TOOL_COMMAND_PATH_ENV]
  );
  if (
    !(
      commandPath &&
      isAbsolute(commandPath) &&
      (basename(commandPath) === command ||
        basename(commandPath) === `${command}.exe`)
    )
  ) {
    throw new Error(
      "OpenMeld cannot start the dispatch Space Action tool because its dispatch-owned CLI path is invalid."
    );
  }

  return {
    args: ["space", "action", "tool-server"],
    command: command as DispatchSpaceActionMcpServer["command"],
    commandPath,
    env: Object.fromEntries(
      FORWARDED_ENV_NAMES.flatMap((name) => {
        const value = normalizeOptionalText(env?.[name]);
        return value ? [[name, value]] : [];
      })
    ),
    id: OPENMELD_SPACE_ACTION_MCP_SERVER_ID,
    toolNames: isDispatchSpaceActionDeliveryOnly(env)
      ? ["reply", "stay_silent", "read_receipt"]
      : OPENMELD_SPACE_ACTION_MCP_TOOL_NAMES,
  };
}

export function buildDispatchSpaceActionMcpToolIds(
  separator: "__" | "_",
  env?: Record<string, string | undefined>
): string[] {
  const names = isDispatchSpaceActionDeliveryOnly(env)
    ? ["reply", "stay_silent", "read_receipt"]
    : OPENMELD_SPACE_ACTION_MCP_TOOL_NAMES;
  return names.map(
    (toolName) =>
      `${OPENMELD_SPACE_ACTION_MCP_SERVER_ID}${separator}${toolName}`
  );
}

export function buildAcpDispatchSpaceActionMcpServers(
  env: Record<string, string | undefined> | undefined
): AcpDispatchSpaceActionMcpServer[] {
  const config = resolveDispatchSpaceActionMcpServer(env);
  if (!config) {
    return [];
  }
  return [
    {
      args: [...config.args],
      command: config.commandPath,
      env: Object.entries(config.env).map(([name, value]) => ({ name, value })),
      name: config.id,
    },
  ];
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
