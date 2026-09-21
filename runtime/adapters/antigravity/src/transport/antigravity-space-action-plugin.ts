import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  OPENMELD_SPACE_ACTION_MCP_TOOL_NAMES,
  resolveDispatchSpaceActionMcpServer,
} from "@openmeld/adapter-core";

const PLUGIN_DIRECTORY_PREFIX = "openmeld_dispatch_";

export async function withAntigravityDispatchSpaceActionPlugin<T>(input: {
  env: Record<string, string | undefined> | undefined;
  run: (input: { addDir: string | null }) => Promise<T>;
}): Promise<T> {
  const actionServer = resolveDispatchSpaceActionMcpServer(input.env);
  if (!actionServer) {
    return await input.run({ addDir: null });
  }

  const pluginId = `${PLUGIN_DIRECTORY_PREFIX}${randomUUID().replaceAll("-", "")}`;
  const root = join(tmpdir(), pluginId);
  const pluginDir = join(root, ".agents", "plugins", pluginId);

  try {
    await mkdir(join(pluginDir, "rules"), { recursive: true, mode: 0o700 });
    await Promise.all([
      writeJson(join(pluginDir, "plugin.json"), {
        name: "OpenMeld Space Action",
      }),
      writeJson(join(pluginDir, "mcp_config.json"), {
        mcpServers: {
          [actionServer.id]: {
            args: [...actionServer.args],
            command: actionServer.commandPath,
            env: actionServer.env,
          },
        },
      }),
      writeJson(join(pluginDir, "hooks.json"), {
        "openmeld-space-action": {
          PreToolUse: [
            {
              hooks: [
                {
                  command: "node ./allow-space-action.mjs",
                  timeout: 5,
                  type: "command",
                },
              ],
              matcher: ".*mcp.*|.*openmeld.*",
            },
          ],
        },
      }),
      writeFile(
        join(pluginDir, "allow-space-action.mjs"),
        buildPermissionHookSource({
          effectiveServerId: `${pluginId}_${actionServer.id}`,
          serverId: actionServer.id,
          toolNames: actionServer.toolNames,
        }),
        { encoding: "utf8", mode: 0o600 }
      ),
      writeFile(
        join(pluginDir, "rules", "AGENTS.md"),
        [
          "# OpenMeld Space Action",
          "",
          "This OpenMeld Wake provides dispatch-scoped Space Action MCP tools.",
          "Use one of those tools to record the final reply, status, or intentional silence.",
          "Do not inspect environment variables or run the CLI fallback while the MCP tools are available.",
          "",
        ].join("\n"),
        { encoding: "utf8", mode: 0o600 }
      ),
    ]);

    return await input.run({ addDir: root });
  } finally {
    await rm(root, { force: true, recursive: true }).catch(() => undefined);
  }
}

function writeJson(path: string, value: unknown): Promise<void> {
  return writeFile(path, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

function buildPermissionHookSource(input: {
  effectiveServerId: string;
  serverId: string;
  toolNames: readonly string[];
}): string {
  return `const SERVER_IDS = new Set(${JSON.stringify([
    input.serverId,
    input.effectiveServerId,
  ])});
const TOOL_NAMES = new Set(${JSON.stringify(input.toolNames)});

let text = "";
for await (const chunk of process.stdin) text += chunk;

let payload;
try {
  payload = JSON.parse(text);
} catch {
  process.stdout.write(JSON.stringify({ decision: "deny", reason: "OpenMeld could not validate this Space Action tool call." }));
  process.exit(0);
}

const toolCall = payload?.toolCall;
const name = normalize(toolCall?.name);
const args = isRecord(toolCall?.args) ? toolCall.args : {};
const serverId = firstText(args, ["server", "serverId", "serverName", "mcpServer", "mcpServerId", "mcpServerName"]);
const toolName = firstText(args, ["name", "tool", "toolId", "toolName"]);
const directCall = [...SERVER_IDS].some((server) => name.includes(server.toLowerCase())) &&
  [...TOOL_NAMES].some((tool) => name.endsWith(tool.toLowerCase()));
const routedCall = SERVER_IDS.has(serverId) && TOOL_NAMES.has(toolName);

if (directCall || routedCall) {
  process.stdout.write(JSON.stringify({ decision: "allow", reason: "This tool can only record an action for the current OpenMeld Wake." }));
} else {
  process.stdout.write(JSON.stringify({ decision: "ask", reason: "Use the Agent Profile's normal Antigravity permission policy." }));
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

function firstText(record, keys) {
  for (const key of keys) {
    const value = String(record[key] ?? "").trim();
    if (value) return value;
  }
  return "";
}
`;
}

export const ANTIGRAVITY_SPACE_ACTION_TOOL_NAMES =
  OPENMELD_SPACE_ACTION_MCP_TOOL_NAMES;
