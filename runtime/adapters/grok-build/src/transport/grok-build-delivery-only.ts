import { randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import {
  type AdapterDispatchSpaceTools,
  type AgentControllerPermissionMode,
  buildCliLaunchInvocation,
  describeDispatchSpaceTools,
  OPENMELD_SPACE_ACTION_MCP_SERVER_ID,
  type RuntimeAgentControllerLaunchContract,
  resolveDispatchSpaceActionMcpServer,
} from "@openmeld/adapter-core";
import { execPlatformFile } from "@openmeld/adapter-core/process-launch";
import { parse, stringify } from "smol-toml";

const FINAL_TOOLS = ["read_receipt", "reply", "stay_silent"];
const NATIVE_VERSION = /^1\.0\.(\d+)$/u;

export type GrokBuildDeliveryScope = {
  env: Record<string, string | undefined>;
  profilePath: string;
  profileName: string;
  close: () => Promise<void>;
};

export async function prepareGrokBuildDeliveryScope(input: {
  agentControllerPermissionMode?: AgentControllerPermissionMode;
  env?: Record<string, string | undefined>;
  spaceActionTools?: AdapterDispatchSpaceTools;
  launchContract: RuntimeAgentControllerLaunchContract;
  workdir: string;
}): Promise<GrokBuildDeliveryScope> {
  const capability = input.spaceActionTools;
  if (
    !(
      capability?.deliveryOnly && resolveDispatchSpaceActionMcpServer(input.env)
    ) ||
    JSON.stringify(capability.tools.map((tool) => tool.name).sort()) !==
      JSON.stringify(FINAL_TOOLS)
  ) {
    throw scopeError("The active Wake's delivery-only tools are required.");
  }
  const env: Record<string, string | undefined> = {
    ...input.env,
    GROK_DISABLE_AUTOUPDATER: "1",
  };
  if (env.GROK_AGENT ?? process.env.GROK_AGENT) {
    throw scopeError(
      "An existing custom agent definition requires its own verified correction scope."
    );
  }
  const invocation = buildCliLaunchInvocation({
    launchContract: input.launchContract,
    args: ["--no-auto-update", "inspect", "--json"],
  });
  const inspect = async (
    environment: Record<string, string | undefined>
  ): Promise<unknown> => {
    try {
      const { stdout } = await promisify(execPlatformFile)(
        invocation.bin,
        invocation.args,
        {
          cwd: input.workdir,
          env: { ...process.env, ...environment },
          encoding: "utf8",
          timeout: 15_000,
          maxBuffer: 1024 * 1024,
          windowsHide: true,
        }
      );
      return JSON.parse(stdout);
    } catch {
      throw scopeError(
        "Grok's native configuration inspection did not complete."
      );
    }
  };
  const inspection = await inspect(env);
  assertGrokBuildDeliveryInspection(inspection);

  const directory = await mkdtemp(join(tmpdir(), "openmeld-grok-delivery-"));
  const profilePath = join(directory, "agent.md");
  const profileName = `openmeld-delivery-${randomUUID()}`;
  const scopedHome = join(directory, "native-home");
  try {
    const originalHome = await createGrokBuildDeliveryHome({
      env,
      home: scopedHome,
    });
    const scopedInspection = await inspect({ ...env, GROK_HOME: scopedHome });
    assertGrokBuildDeliveryInspection(scopedInspection);
    const previous = record(record(inspection)?.permissions)?.sources;
    const current = record(record(scopedInspection)?.permissions)?.sources;
    if (
      !(Array.isArray(previous) && Array.isArray(current)) ||
      previous.some(
        (source) =>
          typeof source !== "string" ||
          !current.includes(source.replace(originalHome, scopedHome))
      )
    ) {
      throw scopeError(
        "The correction config did not retain every original native policy source."
      );
    }
    await writeFile(
      profilePath,
      [
        "---",
        `name: ${profileName}`,
        "description: Complete this Wake's final delivery only.",
        `permissionMode: ${nativePermissionMode(input.agentControllerPermissionMode)}`,
        "tools: search_tool, use_tool",
        "injectDefaultTools: false",
        "discoverSkills: false",
        "inheritSkills: false",
        "mcpInheritance: all",
        "---",
        "Only correct the final Space action. Never repeat the user's business work.",
        "Use use_tool with inline tool_name and tool_input; file forms are unavailable.",
        `Qualify each name as ${OPENMELD_SPACE_ACTION_MCP_SERVER_ID}__NAME.`,
        "Exact current tool definitions:",
        JSON.stringify(describeDispatchSpaceTools(capability)),
      ].join("\n"),
      { mode: 0o600 }
    );
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  return {
    // HOME and cwd still load the original project and compatibility policies.
    // Only this native config snapshot adds denials; no final-tool grant is added.
    env: {
      ...env,
      GROK_HOME: scopedHome,
      GROK_AGENT: profilePath,
      GROK_TOOL_SEARCH: "1",
      GROK_SUBAGENTS: "0",
      GROK_MEMORY: "0",
      GROK_LSP_TOOLS: "0",
      GROK_WEB_FETCH: "0",
    },
    profileName,
    profilePath,
    close: () => rm(directory, { recursive: true, force: true }),
  };
}

async function createGrokBuildDeliveryHome(input: {
  env: Record<string, string | undefined>;
  home: string;
}): Promise<string> {
  const original = resolve(
    input.env.GROK_HOME ??
      process.env.GROK_HOME ??
      join(input.env.HOME ?? homedir(), ".grok")
  );
  await mkdir(input.home, { mode: 0o700 });
  const entries = await readdir(original, { withFileTypes: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        return [];
      }
      throw error;
    }
  );
  for (const entry of entries) {
    if (
      entry.name === "config.toml" ||
      entry.name === "sessions" ||
      entry.name === "logs"
    ) {
      continue;
    }
    // Preserve native credential, requirement and remembered-grant sources,
    // including signed policy bytes; do not translate their semantics here.
    await symlink(
      join(original, entry.name),
      join(input.home, entry.name),
      entry.isDirectory() ? "junction" : "file"
    );
  }
  const source = await readFile(join(original, "config.toml"), "utf8").catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        return "";
      }
      throw error;
    }
  );
  const config = parse(source);
  const permission = record(config.permission) ?? {};
  const denied = permission.deny ?? [];
  if (
    !(Array.isArray(denied) && denied.every((rule) => typeof rule === "string"))
  ) {
    throw scopeError("The native deny rules cannot be preserved.");
  }
  config.permission = {
    ...permission,
    deny: [...denied, "Read", "Bash", "Edit", "Grep", "WebFetch", "WebSearch"],
  };
  await writeFile(join(input.home, "config.toml"), stringify(config), {
    mode: 0o600,
  });
  return original;
}

function nativePermissionMode(
  value: AgentControllerPermissionMode | undefined
): string {
  if (value === undefined) {
    return "default";
  }
  const mode = value.startsWith("grok-build:")
    ? value.slice("grok-build:".length)
    : "";
  if (
    ![
      "default",
      "plan",
      "acceptEdits",
      "auto",
      "dontAsk",
      "bypassPermissions",
    ].includes(mode)
  ) {
    throw scopeError("The selected Grok permission mode is unsupported.");
  }
  return mode;
}

/** Native `grok inspect --json`, captured from Grok 1.0.40. */
export function assertGrokBuildDeliveryInspection(value: unknown): void {
  const report = record(value);
  const version =
    typeof report?.grokVersion === "string"
      ? report.grokVersion.match(NATIVE_VERSION)
      : null;
  if (!version || Number(version[1]) < 40 || report?.projectTrusted !== true) {
    throw scopeError(
      "This Grok installation has not verified the required native scope."
    );
  }
  for (const key of ["hooks", "plugins", "mcpServers", "lspServers"]) {
    if (!Array.isArray(report[key]) || report[key].length !== 0) {
      throw scopeError(
        "Ambient hooks, plugins or external servers prevent isolated correction."
      );
    }
  }
  for (const key of ["loadErrors", "warnings"]) {
    if (
      report[key] !== undefined &&
      (!Array.isArray(report[key]) || report[key].length !== 0)
    ) {
      throw scopeError("The native configuration has unresolved diagnostics.");
    }
  }
  const policy = record(report.permissions);
  if (
    !policy ||
    policy.managedSettingsActive !== false ||
    !Array.isArray(policy.skipped) ||
    policy.skipped.length !== 0
  ) {
    throw scopeError("The effective native policy could not be preserved.");
  }
}

export async function verifyGrokBuildDeliveryScope(input: {
  scope: GrokBuildDeliveryScope;
  sessionId: string;
  request: (method: string, params: unknown) => Promise<unknown>;
}): Promise<void> {
  const params = { sessionId: input.sessionId };
  const hooks = unwrap(await input.request("_x.ai/hooks/list", params));
  if (
    !Array.isArray(hooks?.hooks) ||
    hooks.hooks.length !== 0 ||
    hooks.loadErrors != null
  ) {
    throw scopeError(
      "The correction session did not confirm an empty native hook scope."
    );
  }
  await waitForGrokBuildDeliveryTools(input);
  const info = unwrap(await input.request("_x.ai/session/info", params));
  if (
    info?.sessionId !== input.sessionId ||
    info.agentName !== input.scope.profileName ||
    record(info.context)?.toolDefinitionsCount !== 2
  ) {
    throw scopeError(
      "Grok did not apply the restricted native agent definition."
    );
  }
}

async function waitForGrokBuildDeliveryTools(input: {
  sessionId: string;
  request: (method: string, params: unknown) => Promise<unknown>;
}): Promise<void> {
  const params = { sessionId: input.sessionId };
  const deadline = Date.now() + 15_000;
  // Native session/new returns before asynchronous MCP startup has completed.
  while (true) {
    const mcp = unwrap(await input.request("_x.ai/mcp/list", params));
    if (!Array.isArray(mcp?.servers) || mcp.servers.length !== 1) {
      throw scopeError(
        "The correction session has an unexpected MCP inventory."
      );
    }
    const server = record(mcp.servers[0]);
    const session = record(server?.session);
    if (
      server?.name !== OPENMELD_SPACE_ACTION_MCP_SERVER_ID ||
      session?.enabled !== true
    ) {
      throw scopeError("The current dispatch MCP server is unavailable.");
    }
    if (mcp.sessionMcpResolved === true) {
      const tools = Array.isArray(session.tools) ? session.tools : [];
      if (
        session.status !== "ready" ||
        JSON.stringify(tools.map((tool) => record(tool)?.name).sort()) !==
          JSON.stringify(FINAL_TOOLS)
      ) {
        throw scopeError(
          "Native tool startup did not confirm the delivery catalog."
        );
      }
      break;
    }
    if (session.status !== "initializing" || Date.now() >= deadline) {
      throw scopeError(
        "The dispatch tools did not become ready for correction."
      );
    }
    await delay(50);
  }
}

function unwrap(value: unknown): Record<string, unknown> | null {
  return record(record(value)?.result);
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function scopeError(message: string): Error {
  return Object.assign(new Error(message), {
    code: "space.action.delivery_only_unverified",
    errorType: "config",
  });
}
