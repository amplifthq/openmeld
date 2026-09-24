import { randomUUID } from "node:crypto";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import {
  type AdapterDispatchSpaceTools,
  buildCliLaunchInvocation,
  describeDispatchSpaceTools,
  isDispatchSpaceActionDeliveryOnly,
  OPENMELD_SPACE_ACTION_MCP_TOOL_NAMES,
  type RuntimeAgentControllerLaunchContract,
  resolveDispatchSpaceActionMcpServer,
} from "@openmeld/adapter-core";
import { execPlatformFile } from "@openmeld/adapter-core/process-launch";
import { buildOpenClawSpaceActionPluginSource } from "./openclaw-space-action-plugin-source.js";

const OPENCLAW_CONFIG_PATH_ENV = "OPENCLAW_CONFIG_PATH";
const OPENCLAW_STATE_DIR_ENV = "OPENCLAW_STATE_DIR";
const OPENCLAW_PLUGIN_ID = "openmeld-space-action";

export const OPENCLAW_SPACE_ACTION_TOOL_NAMES =
  OPENMELD_SPACE_ACTION_MCP_TOOL_NAMES.map((name) => `openmeld_space_${name}`);

export async function withOpenClawDispatchSpaceActionPlugin<T>(input: {
  env: Record<string, string | undefined> | undefined;
  spaceActionTools?: AdapterDispatchSpaceTools;
  launchContract?: RuntimeAgentControllerLaunchContract;
  run: (input: {
    active: boolean;
    env: Record<string, string | undefined>;
    pluginPath: string;
  }) => Promise<T>;
}): Promise<T> {
  const env = { ...(input.env ?? {}) };
  const actionServer = resolveDispatchSpaceActionMcpServer(env);
  const deliveryOnly = isDispatchSpaceActionDeliveryOnly(env);
  if (!actionServer && deliveryOnly) {
    throw scopeError(
      "The correction invocation has no active delivery capability."
    );
  }
  if (!actionServer) {
    return await input.run({ active: false, env, pluginPath: "" });
  }
  const definitions = resolveToolDefinitions({
    capability: input.spaceActionTools,
    sessionId: env.OPENMELD_OPENCLAW_TOOL_SESSION_ID,
    deliveryOnly,
    expectedNames: actionServer.toolNames,
  });
  const baseConfigPath = resolveOpenClawConfigPath(env);
  const configDir = dirname(baseConfigPath);
  await mkdir(configDir, { recursive: true });
  const temporaryStem = `.openmeld-space-action-${randomUUID()}`;
  const pluginDir = join(configDir, temporaryStem);
  const pluginPath = join(pluginDir, "index.mjs");
  const temporaryConfigPath = join(configDir, `${temporaryStem}.json`);
  const baseConfigExists = Boolean(
    await stat(baseConfigPath).catch(() => null)
  );
  const inspectionPath = join(configDir, `${temporaryStem}.inspect.json`);
  let priorPlugins: Record<string, unknown> = {};
  let priorTools: Record<string, unknown> = {};
  if (baseConfigExists && input.launchContract) {
    // Config commands execute enabled plugins. Disable them before inspection.
    await writeFile(
      inspectionPath,
      JSON.stringify({
        $include: `./${basename(baseConfigPath)}`,
        plugins: { enabled: false },
        hooks: { internal: { enabled: false } },
        tools: {},
      }),
      { mode: 0o600 }
    );
    try {
      const observationEnv = {
        ...env,
        [OPENCLAW_CONFIG_PATH_ENV]: inspectionPath,
      };
      priorTools = await readNativePlugins(
        input.launchContract,
        observationEnv,
        ["config", "get", "tools", "--json"]
      );
      priorPlugins = await readNativePlugins(
        input.launchContract,
        observationEnv
      );
    } finally {
      await rm(inspectionPath, { force: true });
    }
  }
  const disabledEntries = resolveDisabledPluginEntries(
    priorPlugins,
    deliveryOnly
  );
  const temporaryConfig = {
    ...(baseConfigExists ? { $include: `./${basename(baseConfigPath)}` } : {}),
    ...(deliveryOnly ? { hooks: { internal: { enabled: false } } } : {}),
    tools: {
      // Native $include concatenates arrays. Negative groups therefore narrow
      // even an existing allowlist; plugin hooks are a second execution fence.
      ...(deliveryOnly
        ? { deny: ["group:openclaw", "group:fs", "group:runtime"] }
        : {}),
      ...(Array.isArray(priorTools.allow) && priorTools.allow.length > 0
        ? {}
        : {
            alsoAllow: definitions.map((tool) => `openmeld_space_${tool.name}`),
          }),
    },
    plugins: {
      allow: [OPENCLAW_PLUGIN_ID],
      load: { paths: [pluginDir] },
      entries: {
        ...disabledEntries,
        [OPENCLAW_PLUGIN_ID]: {
          enabled: true,
          hooks: { allowPromptInjection: false },
        },
      },
    },
  };
  try {
    await mkdir(pluginDir, { recursive: true, mode: 0o700 });
    await writeFile(
      join(pluginDir, "openclaw.plugin.json"),
      `${JSON.stringify(
        {
          id: OPENCLAW_PLUGIN_ID,
          name: "OpenMeld Space Action",
          description: "Dispatch-scoped OpenMeld collaboration actions.",
          configSchema: {
            type: "object",
            additionalProperties: false,
            properties: {},
          },
        },
        null,
        2
      )}\n`,
      { encoding: "utf8", mode: 0o600 }
    );
    await writeFile(
      join(pluginDir, "package.json"),
      `${JSON.stringify(
        {
          name: "@openmeld/openclaw-space-action",
          version: "1.0.0",
          private: true,
          type: "module",
          openclaw: { extensions: ["./index.mjs"] },
        },
        null,
        2
      )}\n`,
      { encoding: "utf8", mode: 0o600 }
    );
    await writeFile(
      pluginPath,
      buildOpenClawSpaceActionPluginSource(definitions, deliveryOnly),
      { encoding: "utf8", mode: 0o600 }
    );
    await writeFile(
      temporaryConfigPath,
      `${JSON.stringify(temporaryConfig, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 }
    );
    if (deliveryOnly) {
      const effective = await readNativePlugins(
        input.launchContract,
        { ...env, [OPENCLAW_CONFIG_PATH_ENV]: temporaryConfigPath },
        ["plugins", "info", OPENCLAW_PLUGIN_ID, "--json"]
      );
      const expectedNames = definitions
        .map((tool) => `openmeld_space_${tool.name}`)
        .sort();
      if (
        effective.status !== "loaded" ||
        !Array.isArray(effective.toolNames) ||
        JSON.stringify([...effective.toolNames].sort()) !==
          JSON.stringify(expectedNames)
      ) {
        throw scopeError(
          "OpenClaw did not load the restricted delivery plugin. Disabled plugins and native policy are not bypassed."
        );
      }
    }
    return await input.run({
      active: true,
      env: { ...env, [OPENCLAW_CONFIG_PATH_ENV]: temporaryConfigPath },
      pluginPath,
    });
  } finally {
    await Promise.all([
      rm(temporaryConfigPath, { force: true }),
      rm(pluginDir, { force: true, recursive: true }),
    ]);
  }
}

function resolveOpenClawConfigPath(
  env: Record<string, string | undefined>
): string {
  const explicit = env[OPENCLAW_CONFIG_PATH_ENV]?.trim();
  if (explicit) {
    return explicit;
  }
  const stateDir =
    env[OPENCLAW_STATE_DIR_ENV]?.trim() ??
    join(env.HOME?.trim() || homedir(), ".openclaw");
  return join(stateDir, "openclaw.json");
}

function resolveDisabledPluginEntries(
  plugins: Record<string, unknown>,
  deliveryOnly: boolean
): Record<string, { enabled: false }> {
  const entries = record(plugins.entries) ?? {};
  const allow = Array.isArray(plugins.allow) ? plugins.allow : [];
  if (
    Object.hasOwn(entries, OPENCLAW_PLUGIN_ID) ||
    allow.includes(OPENCLAW_PLUGIN_ID)
  ) {
    throw scopeError(
      "The native configuration already uses the reserved dispatch plugin identity. Its existing policy was not overwritten."
    );
  }
  if (!deliveryOnly) {
    return {};
  }
  return Object.fromEntries(
    [...new Set([...Object.keys(entries), ...allow])]
      .filter((id): id is string => typeof id === "string")
      .map((id) => [id, { enabled: false as const }])
  );
}

function resolveToolDefinitions(input: {
  capability: AdapterDispatchSpaceTools | undefined;
  sessionId: string | undefined;
  deliveryOnly: boolean;
  expectedNames: readonly string[];
}) {
  const capability = input.capability;
  if (!(capability && input.sessionId)) {
    throw scopeError(
      "The current native tool definitions and session identity are required."
    );
  }
  if (
    input.deliveryOnly !== capability.deliveryOnly ||
    JSON.stringify(capability.tools.map((tool) => tool.name).sort()) !==
      JSON.stringify([...input.expectedNames].sort())
  ) {
    throw scopeError(
      "The current native tool catalog does not match the Wake's scope."
    );
  }
  return describeDispatchSpaceTools(capability);
}

function scopeError(message: string): Error {
  return Object.assign(new Error(message), {
    code: "space.action.delivery_only_unverified",
    errorType: "config",
  });
}

async function readNativePlugins(
  launchContract: RuntimeAgentControllerLaunchContract | undefined,
  env: Record<string, string | undefined>,
  args: string[] = ["config", "get", "plugins", "--json"]
): Promise<Record<string, unknown>> {
  if (!launchContract) {
    throw scopeError(
      "The selected OpenClaw executable is required to verify correction."
    );
  }
  const invocation = buildCliLaunchInvocation({ launchContract, args });
  try {
    const { stdout } = await promisify(execPlatformFile)(
      invocation.bin,
      invocation.args,
      {
        env: { ...process.env, ...env },
        encoding: "utf8",
        timeout: 15_000,
        cwd: dirname(env[OPENCLAW_CONFIG_PATH_ENV] ?? process.cwd()),
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      }
    );
    const value = record(JSON.parse(stdout));
    if (value) {
      return value;
    }
  } catch {
    // Native errors can contain private configuration; retain no raw secrets.
  }
  throw scopeError(
    "OpenClaw's effective plugin scope could not be verified. No correction turn was started."
  );
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
