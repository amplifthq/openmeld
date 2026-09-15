import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  OPENMELD_SPACE_ACTION_MCP_SERVER_ID,
  OPENMELD_SPACE_ACTION_MCP_TOOL_NAMES,
  type RuntimeAgentControllerLaunchContract,
} from "@openmeld/adapter-core";
import { buildCodexAppServerLaunch } from "./codex-app-server-launch.js";

const execFileAsync = promisify(execFile);
const MCP_INVENTORY_TIMEOUT_MS = 15_000;
const MCP_INVENTORY_MAX_BYTES = 1024 * 1024;
const MCP_AUTH_STATUSES = new Set([
  "unknown",
  "unsupported",
  "notLoggedIn",
  "bearerToken",
  "oAuth",
]);
const DISPATCH_TOOL_NAMES: ReadonlySet<string> = new Set(
  OPENMELD_SPACE_ACTION_MCP_TOOL_NAMES
);

export async function buildCodexScopedMcpDisableArgs(input: {
  env: Record<string, string | undefined>;
  launchContract: RuntimeAgentControllerLaunchContract;
  workingDirectory: string;
}): Promise<string[]> {
  const launch = buildCodexAppServerLaunch({
    args: ["mcp", "list", "--json"],
    env: input.env,
    launchContract: input.launchContract,
  });
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(launch.bin, launch.args, {
      cwd: input.workingDirectory,
      encoding: "utf8",
      env: launch.env,
      killSignal: "SIGKILL",
      maxBuffer: MCP_INVENTORY_MAX_BYTES,
      shell: launch.shell,
      timeout: MCP_INVENTORY_TIMEOUT_MS,
      windowsHide: true,
    }));
  } catch {
    // Native output and child-process errors may include private server config.
    throw isolationError("the native MCP configuration inventory failed");
  }

  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch {
    throw isolationError("the native MCP configuration inventory is not JSON");
  }
  if (!Array.isArray(value)) {
    throw isolationError("the native MCP configuration inventory is malformed");
  }
  const servers = new Map<string, "stdio" | "streamable_http">();
  for (const row of value) {
    if (
      !isRecord(row) ||
      typeof row.name !== "string" ||
      row.name.length === 0 ||
      typeof row.enabled !== "boolean" ||
      servers.has(row.name)
    ) {
      throw isolationError(
        "the native MCP configuration inventory is malformed"
      );
    }
    if (row.name === OPENMELD_SPACE_ACTION_MCP_SERVER_ID) {
      // Per-field overrides would retain ambient env/cwd/transport settings
      // when this reserved server is enabled for the active dispatch.
      throw new Error(
        "execution_context.mcp_server_namespace_conflict: the native MCP configuration uses the reserved dispatch server name"
      );
    }
    if (
      !isRecord(row.transport) ||
      (row.transport.type !== "stdio" &&
        row.transport.type !== "streamable_http")
    ) {
      throw isolationError(
        "the native MCP configuration has an unknown transport"
      );
    }
    servers.set(row.name, row.transport.type);
  }
  if (servers.size === 0) {
    return [];
  }

  // Native -c dotted paths split literally, including quote characters. One
  // inline table preserves arbitrary TOML keys. App-server starts outside the
  // task directory, so task-local entries also need a complete inert transport
  // when that host cwd cannot load their original config. Preserve transport
  // kind to avoid conflicts when native thread/start merges the task config.
  // No private transport settings are copied. Separate table overrides replace
  // each other.
  const disabledServers = [...servers].map(([name, type]) => {
    const transport =
      type === "stdio"
        ? `command=${JSON.stringify(launch.bin)},args=["--version"]`
        : 'url="http://127.0.0.1:9"';
    return `${JSON.stringify(name)}={${transport},enabled=false}`;
  });
  return ["-c", `mcp_servers={${disabledServers.join(",")}}`];
}

/** Checks effective tool exposure; dispatch ownership and permissions are separate checks. */
export function assertCodexScopedMcpInventory(
  value: unknown,
  options: { expectDispatchServer?: boolean } = {}
): void {
  if (
    !(isRecord(value) && Array.isArray(value.data)) ||
    (value.nextCursor !== undefined && value.nextCursor !== null)
  ) {
    throw isolationError(
      "the effective MCP inventory is malformed or incomplete"
    );
  }

  const names = new Set<string>();
  let hasDispatchServer = false;
  for (const item of value.data) {
    const row = parseMcpServerInventory(item);
    if (names.has(row.name)) {
      throw isolationError(
        "the effective MCP inventory contains duplicate servers"
      );
    }
    names.add(row.name);
    // Native status includes disabled configuration rows in the full inventory.
    if (
      row.runtimeStatus === "disabled" &&
      Object.keys(row.tools).length === 0
    ) {
      continue;
    }
    if (
      !(options.expectDispatchServer ?? true) ||
      row.name !== OPENMELD_SPACE_ACTION_MCP_SERVER_ID ||
      (row.pluginId !== undefined && row.pluginId !== null) ||
      (row.runtimeStatus !== undefined && row.runtimeStatus !== "connected")
    ) {
      throw isolationError(
        "the effective MCP inventory contains an unapproved server"
      );
    }
    assertDispatchTools(row.tools);
    hasDispatchServer = true;
  }
  if ((options.expectDispatchServer ?? true) && !hasDispatchServer) {
    throw isolationError(
      "the dispatch MCP server is missing from the effective inventory"
    );
  }
}

function assertDispatchTools(tools: Record<string, unknown>): void {
  const toolEntries = Object.entries(tools);
  if (toolEntries.length !== DISPATCH_TOOL_NAMES.size) {
    throw isolationError(
      "the effective MCP inventory has an unexpected tool catalog"
    );
  }
  for (const [name, tool] of toolEntries) {
    if (
      !(DISPATCH_TOOL_NAMES.has(name) && isRecord(tool)) ||
      tool.name !== name ||
      !Object.hasOwn(tool, "inputSchema")
    ) {
      throw isolationError(
        "the effective MCP inventory contains an unapproved tool"
      );
    }
  }
}

function parseMcpServerInventory(row: unknown) {
  if (
    !isRecord(row) ||
    typeof row.name !== "string" ||
    row.name.length === 0 ||
    typeof row.authStatus !== "string" ||
    !MCP_AUTH_STATUSES.has(row.authStatus) ||
    !isRecord(row.tools) ||
    !Array.isArray(row.resources) ||
    row.resources.length !== 0 ||
    !Array.isArray(row.resourceTemplates) ||
    row.resourceTemplates.length !== 0 ||
    (row.toolsError !== undefined && row.toolsError !== null)
  ) {
    throw isolationError(
      "the effective MCP inventory contains unverified data"
    );
  }
  return {
    name: row.name,
    pluginId: row.pluginId,
    runtimeStatus: row.runtimeStatus,
    tools: row.tools,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isolationError(reason: string): Error {
  return new Error(`context.mcp_isolation_unverified: ${reason}`);
}
