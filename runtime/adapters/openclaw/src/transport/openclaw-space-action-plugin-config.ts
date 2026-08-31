import { randomUUID } from "node:crypto";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { resolveDispatchSpaceActionMcpServer } from "@openmeld/adapter-core";

const OPENCLAW_CONFIG_PATH_ENV = "OPENCLAW_CONFIG_PATH";
const OPENCLAW_STATE_DIR_ENV = "OPENCLAW_STATE_DIR";
const OPENCLAW_PLUGIN_ID = "openmeld-space-action";

export const OPENCLAW_SPACE_ACTION_TOOL_NAMES = [
  "openmeld_space_reply",
  "openmeld_space_status",
  "openmeld_space_stay_silent",
] as const;

export async function withOpenClawDispatchSpaceActionPlugin<T>(input: {
  env: Record<string, string | undefined> | undefined;
  run: (input: {
    active: boolean;
    env: Record<string, string | undefined>;
    pluginPath: string;
  }) => Promise<T>;
}): Promise<T> {
  const env = { ...(input.env ?? {}) };
  const actionServer = resolveDispatchSpaceActionMcpServer(env);
  if (!actionServer) {
    return await input.run({ active: false, env, pluginPath: "" });
  }

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
  const temporaryConfig = {
    ...(baseConfigExists ? { $include: `./${basename(baseConfigPath)}` } : {}),
    plugins: {
      enabled: true,
      allow: [OPENCLAW_PLUGIN_ID],
      load: { paths: [pluginDir] },
      entries: {
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
    await writeFile(pluginPath, buildOpenClawSpaceActionPluginSource(), {
      encoding: "utf8",
      mode: 0o600,
    });
    await writeFile(
      temporaryConfigPath,
      `${JSON.stringify(temporaryConfig, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 }
    );

    return await input.run({
      active: true,
      env: {
        ...env,
        [OPENCLAW_CONFIG_PATH_ENV]: temporaryConfigPath,
      },
      pluginPath,
    });
  } finally {
    await Promise.all([
      rm(temporaryConfigPath, { force: true }),
      rm(pluginDir, { force: true, recursive: true }),
    ]).catch(() => undefined);
  }
}

function resolveOpenClawConfigPath(
  env: Record<string, string | undefined>
): string {
  const explicit = normalizeOptionalText(env[OPENCLAW_CONFIG_PATH_ENV]);
  if (explicit) {
    return explicit;
  }
  const stateDir =
    normalizeOptionalText(env[OPENCLAW_STATE_DIR_ENV]) ??
    join(normalizeOptionalText(env.HOME) ?? homedir(), ".openclaw");
  return join(stateDir, "openclaw.json");
}

function buildOpenClawSpaceActionPluginSource(): string {
  return `import { spawn } from "node:child_process";
import { basename, isAbsolute } from "node:path";

const TOOL_NAMES = ${JSON.stringify(OPENCLAW_SPACE_ACTION_TOOL_NAMES)};
const FINAL_STATUSES = new Set(["done", "blocked", "needs_input", "handoff"]);

function requiredText(value, label) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(label + " is required.");
  return normalized;
}

function optionalStringArray(value, label) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(label + " must be an array.");
  return value.map((entry) => requiredText(entry, label));
}

function addRequiredTools(policy) {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) return;
  const key = Array.isArray(policy.allow) && policy.allow.length > 0 ? "allow" : "alsoAllow";
  const current = Array.isArray(policy[key]) ? policy[key] : [];
  policy[key] = [...new Set([...current, ...TOOL_NAMES])];
  if (Array.isArray(policy.deny)) {
    const required = new Set(TOOL_NAMES.map((name) => name.toLowerCase()));
    policy.deny = policy.deny.filter((name) => !required.has(String(name).toLowerCase()));
  }
}

function addProviderPolicies(tools) {
  addRequiredTools(tools);
  if (tools?.byProvider && typeof tools.byProvider === "object") {
    for (const policy of Object.values(tools.byProvider)) addRequiredTools(policy);
  }
  addRequiredTools(tools?.sandbox?.tools);
  addRequiredTools(tools?.subagents?.tools);
}

function makeToolsAvailable(config) {
  if (!config || typeof config !== "object") return;
  config.tools ??= {};
  addProviderPolicies(config.tools);
  const agentId = String(process.env.OPENMELD_DAEMON_RUNTIME_OPENCLAW_AGENT_ID ?? "").trim();
  const agents = Array.isArray(config.agents?.list) ? config.agents.list : [];
  for (const agent of agents) {
    if (!agent || typeof agent !== "object") continue;
    if (agentId && String(agent.id ?? "").trim() !== agentId) continue;
    agent.tools ??= {};
    addProviderPolicies(agent.tools);
  }
}

function resolveCommandPath() {
  const command = requiredText(
    process.env.OPENMELD_SPACE_ACTION_TOOL_COMMAND_PATH,
    "OpenMeld dispatch action command"
  );
  const expectedName = requiredText(
    process.env.OPENMELD_USER_FACING_CLI_COMMAND,
    "OpenMeld CLI command"
  );
  if (!isAbsolute(command) || basename(command) !== expectedName) {
    throw new Error("OpenMeld dispatch action command is invalid.");
  }
  return command;
}

function runAction(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveCommandPath(), args, {
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout = (stdout + chunk).slice(-8192); });
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-8192); });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve({
          content: [{ type: "text", text: "Action recorded for the current OpenMeld Wake." }],
          details: { recorded: true },
        });
        return;
      }
      reject(new Error((stderr || stdout || "OpenMeld could not record the Space action.").trim()));
    });
    child.stdin.end(input ?? "");
  });
}

const stringSchema = { type: "string", minLength: 1 };
const stringArraySchema = { type: "array", items: stringSchema };

const plugin = {
  id: "openmeld-space-action",
  name: "OpenMeld Space Action",
  description: "Dispatch-scoped OpenMeld collaboration actions.",
  register(api) {
    makeToolsAvailable(api.config);
    api.registerTool({
      name: "openmeld_space_reply",
      label: "Reply in the current OpenMeld Space",
      description: "Record the exact final public reply for this OpenMeld Wake. Use real newline characters for paragraph breaks.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          message: stringSchema,
          mentionTargets: stringArraySchema,
          referenceTargets: stringArraySchema,
          wakeTargets: stringArraySchema,
        },
        required: ["message"],
      },
      async execute(_toolCallId, params) {
        const message = requiredText(params?.message, "Reply message");
        const wakeTargets = optionalStringArray(params?.wakeTargets, "wakeTargets");
        const referenceTargets = optionalStringArray(params?.referenceTargets, "referenceTargets");
        const mentionTargets = optionalStringArray(params?.mentionTargets, "mentionTargets");
        const args = ["space", "action", "reply", "--message-file", "-"];
        for (const target of wakeTargets) args.push("--wake", target);
        for (const target of referenceTargets) args.push("--reference", target);
        for (const target of mentionTargets) args.push("--mention", target);
        return await runAction(args, message);
      },
    });
    api.registerTool({
      name: "openmeld_space_status",
      label: "Set the final OpenMeld Space status",
      description: "Record one final visible status for this OpenMeld Wake. Do not use it for interim progress.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          status: { type: "string", enum: [...FINAL_STATUSES] },
          text: stringSchema,
        },
        required: ["status", "text"],
      },
      async execute(_toolCallId, params) {
        const status = requiredText(params?.status, "Final status");
        if (!FINAL_STATUSES.has(status)) throw new Error("Final status is invalid.");
        const text = requiredText(params?.text, "Status text");
        return await runAction(["space", "action", "status", status, text]);
      },
    });
    api.registerTool({
      name: "openmeld_space_stay_silent",
      label: "Stay silent in the current OpenMeld Space",
      description: "Record that this OpenMeld Wake intentionally needs no public reply.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { reason: stringSchema },
        required: ["reason"],
      },
      async execute(_toolCallId, params) {
        const reason = requiredText(params?.reason, "Silent reason");
        return await runAction(["space", "action", "silent", "--reason", reason]);
      },
    });
  },
};

export default plugin;
`;
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
