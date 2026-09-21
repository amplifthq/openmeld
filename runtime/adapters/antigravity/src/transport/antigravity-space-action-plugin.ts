import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveDispatchSpaceActionMcpServer } from "@openmeld/adapter-core";

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
  const actionCommandPath = join(pluginDir, "openmeld-space-action");

  try {
    await mkdir(join(pluginDir, "rules"), { recursive: true, mode: 0o700 });
    await Promise.all([
      writeJson(join(pluginDir, "plugin.json"), {
        name: "OpenMeld Space Action",
      }),
      writeJson(join(pluginDir, "hooks.json"), {
        "openmeld-space-action": {
          PreInvocation: [
            {
              command: "node ./inject-space-action.mjs",
              timeout: 5,
              type: "command",
            },
          ],
          PreToolUse: [
            {
              hooks: [
                {
                  command: "node ./allow-space-action.mjs",
                  timeout: 5,
                  type: "command",
                },
              ],
              matcher: "run_command",
            },
          ],
        },
      }),
      writeFile(
        join(pluginDir, "allow-space-action.mjs"),
        buildPermissionHookSource(actionCommandPath),
        { encoding: "utf8", mode: 0o600 }
      ),
      writeFile(
        join(pluginDir, "inject-space-action.mjs"),
        buildInstructionHookSource(actionCommandPath),
        { encoding: "utf8", mode: 0o600 }
      ),
      writeFile(
        actionCommandPath,
        buildActionCommandSource({
          args: actionServer.args,
          commandPath: actionServer.commandPath,
          env: actionServer.env,
        }),
        { encoding: "utf8", mode: 0o700 }
      ),
      writeFile(
        join(pluginDir, "rules", "AGENTS.md"),
        [
          "# OpenMeld Space Action",
          "",
          "This OpenMeld Wake provides a dispatch-scoped Space Action command in an ephemeral message.",
          "Call that exact command once to record the final reply, status, or intentional silence.",
          "Do not inspect environment variables or search for another OpenMeld command.",
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

function buildPermissionHookSource(actionCommandPath: string): string {
  return `const ACTION_COMMAND = ${JSON.stringify(actionCommandPath)};

let text = "";
for await (const chunk of process.stdin) text += chunk;

let payload;
try {
  payload = JSON.parse(text);
} catch {
  process.stdout.write(JSON.stringify({ decision: "deny", reason: "OpenMeld could not validate this Space Action command." }));
  process.exit(0);
}

const commandLine = String(payload?.toolCall?.args?.CommandLine ?? payload?.toolCall?.args?.command ?? "").trim();
const tokens = parseShellWords(commandLine);
const allowed = tokens !== null && tokens[0] === ACTION_COMMAND && ["reply", "status", "silent"].includes(tokens[1]);

process.stdout.write(JSON.stringify(allowed
  ? { decision: "allow", reason: "This command can only record an action for the current OpenMeld Wake." }
  : { decision: "ask", reason: "Use the Agent Profile's normal Antigravity permission policy." }
));

function parseShellWords(value) {
  const tokens = [];
  let token = "";
  let quote = "";
  let escaped = false;
  let started = false;
  for (const character of value) {
    if (escaped) {
      token += character;
      escaped = false;
      started = true;
      continue;
    }
    if (character === "\\\\" && quote !== "'") {
      escaped = true;
      started = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = "";
      else token += character;
      started = true;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      started = true;
      continue;
    }
    if (/\\s/u.test(character)) {
      if (started) {
        tokens.push(token);
        token = "";
        started = false;
      }
      continue;
    }
    if (";&|<>()\u0060$".includes(character)) return null;
    token += character;
    started = true;
  }
  if (escaped || quote) return null;
  if (started) tokens.push(token);
  return tokens;
}
`;
}

function buildInstructionHookSource(actionCommandPath: string): string {
  const instruction = [
    "OpenMeld provides one dispatch-scoped Space Action command for this Wake.",
    `For a reply, run exactly: '${actionCommandPath}' reply 'public message'`,
    `For a final status, run exactly: '${actionCommandPath}' status done 'short update'`,
    `To stay silent, run exactly: '${actionCommandPath}' silent 'reason'`,
    "Use shell quoting inside the message when needed. Do not inspect environment variables or search for another command. This command is approved only for the current dispatch; all other tools keep the normal Antigravity permission policy.",
  ].join(" ");
  return `process.stdout.write(JSON.stringify({ injectSteps: [{ ephemeralMessage: ${JSON.stringify(instruction)} }] }));\n`;
}

function buildActionCommandSource(input: {
  args: readonly string[];
  commandPath: string;
  env: Record<string, string>;
}): string {
  return `#!/usr/bin/env node
import { spawn } from "node:child_process";

const COMMAND_PATH = ${JSON.stringify(input.commandPath)};
const COMMAND_ARGS = ${JSON.stringify(input.args)};
const ACTION_ENV = ${JSON.stringify(input.env)};
const FINAL_STATUSES = new Set(["done", "blocked", "needs_input", "handoff"]);
const args = process.argv.slice(2);
const action = args.shift();
let commandArgs;
let inputText = "";

if (action === "reply") {
  const message = required(args.shift(), "Reply message");
  commandArgs = [...COMMAND_ARGS.slice(0, -1), "reply", "--message-file", "-"];
  inputText = message;
  while (args.length > 0) {
    const option = args.shift();
    if (!["--wake", "--reference", "--mention"].includes(option)) fail("Unsupported reply option.");
    commandArgs.push(option, required(args.shift(), option));
  }
} else if (action === "status") {
  const status = required(args.shift(), "Status");
  if (!FINAL_STATUSES.has(status)) fail("Unsupported final status.");
  commandArgs = [...COMMAND_ARGS.slice(0, -1), "status", status, required(args.shift(), "Status text")];
  if (args.length > 0) fail("Unexpected status arguments.");
} else if (action === "silent") {
  commandArgs = [...COMMAND_ARGS.slice(0, -1), "silent", "--reason", required(args.shift(), "Silent reason")];
  if (args.length > 0) fail("Unexpected silent arguments.");
} else {
  fail("Use reply, status, or silent.");
}

const child = spawn(COMMAND_PATH, commandArgs, {
  env: { ...process.env, ...ACTION_ENV },
  stdio: ["pipe", "inherit", "inherit"],
});
child.once("error", (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
child.once("close", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});
child.stdin.end(inputText);

function required(value, label) {
  const normalized = String(value ?? "").trim();
  if (!normalized) fail(label + " is required.");
  return normalized;
}

function fail(message) {
  console.error(message);
  process.exit(2);
}
`;
}
