#!/usr/bin/env node
// Remote Agent operator policy and usage diagnostics. The historical budget
// breaker and break-glass D1 mutation surface is retired; this script only
// manages the runtime kill switch / organization blocklist and reads usage via
// the Remote Agent worker's service-binding RPC.
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const DEFAULT_CORE_WRANGLER_CONFIG = path.join(
  repoRoot,
  "services",
  "core",
  "wrangler.jsonc"
);
const RUNTIME_ENABLED_VAR = "OPENMELD_REMOTE_AGENT_RUNTIME_ENABLED";
const BLOCKED_ORGS_VAR = "OPENMELD_REMOTE_AGENT_BLOCKED_ORGANIZATION_IDS";
const REMOTE_AGENT_WORKER_BINDING = "OPENMELD_REMOTE_AGENT_WORKER";
const ORG_ID_RE = /^[A-Za-z0-9_-]+$/u;
const SPACE_ID_RE = /^[A-Za-z0-9_-]+$/u;
const INLINE_OPTION_RE = /=(.*)/su;
const USAGE_DEV_TIMEOUT_MS = 20_000;

class UsageError extends Error {}

const VALUE_OPTIONS = new Map([
  ["config", "configPath"],
  ["env", "env"],
  ["org", "organizationId"],
  ["runtime-conversation", "runtimeConversationId"],
  ["service", "serviceName"],
  ["space", "spaceId"],
  ["timeout-ms", "timeoutMs"],
]);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    console.error("Run `pnpm ops:remote-agent --help` for usage.");
    process.exit(1);
  });
}

export function parseRemoteAgentOpsArgs(rawArgs) {
  const args = [...rawArgs];
  if (args[0] === "--") {
    args.shift();
  }
  const parsed = {
    action: "policy",
    configPath: DEFAULT_CORE_WRANGLER_CONFIG,
    dryRun: false,
    env: "prod",
    json: false,
    remote: true,
  };

  if (args[0] === "policy" || args[0] === "usage") {
    parsed.action = args.shift();
  }

  for (let index = 0; index < args.length; index += 1) {
    const nextIndex = readKnownRemoteAgentOpsFlag(args, index, parsed);
    if (nextIndex === "help") {
      return { help: true };
    }
    if (nextIndex !== null) {
      index = nextIndex;
      continue;
    }
    index = readValueOption(args, index, parsed);
  }

  validateRemoteAgentOpsArgs(parsed);
  return parsed;
}

function readKnownRemoteAgentOpsFlag(rawArgs, index, parsed) {
  const arg = rawArgs[index];
  switch (arg) {
    case "--help":
    case "-h":
      return "help";
    case "--json":
      parsed.json = true;
      return index;
    case "--dry-run":
      parsed.dryRun = true;
      return index;
    case "--local":
      parsed.remote = false;
      return index;
    case "--remote":
      parsed.remote = true;
      return index;
    case "--enable-runtime":
      assertRuntimeEnabledUnset(parsed, false);
      parsed.runtimeEnabled = true;
      return index;
    case "--disable-runtime":
      assertRuntimeEnabledUnset(parsed, true);
      parsed.runtimeEnabled = false;
      return index;
    case "--block-org": {
      const { nextIndex, value } = readOptionValue(rawArgs, index, "block-org");
      parsed.blockOrganizationId = value;
      return nextIndex;
    }
    case "--unblock-org": {
      const { nextIndex, value } = readOptionValue(
        rawArgs,
        index,
        "unblock-org"
      );
      parsed.unblockOrganizationId = value;
      return nextIndex;
    }
    default:
      return null;
  }
}

function assertRuntimeEnabledUnset(parsed, conflictingValue) {
  if (parsed.runtimeEnabled === conflictingValue) {
    throw new UsageError("Runtime cannot be both enabled and disabled.");
  }
}

function readValueOption(rawArgs, index, parsed) {
  const arg = rawArgs[index];
  if (!arg.startsWith("--")) {
    throw new UsageError(`Unexpected argument "${arg}".`);
  }
  const [rawKey, inlineValue] = arg.slice(2).split(INLINE_OPTION_RE, 2);
  const outputKey = VALUE_OPTIONS.get(rawKey);
  if (!outputKey) {
    throw new UsageError(`Unknown option "--${rawKey}".`);
  }
  if (inlineValue !== undefined) {
    parsed[outputKey] = inlineValue;
    return index;
  }
  const value = rawArgs[index + 1];
  if (!value || value.startsWith("--")) {
    throw new UsageError(`Missing value for --${rawKey}.`);
  }
  parsed[outputKey] = value;
  return index + 1;
}

function readOptionValue(rawArgs, index, key) {
  const value = rawArgs[index + 1];
  if (!value || value.startsWith("--")) {
    throw new UsageError(`Missing value for --${key}.`);
  }
  return { nextIndex: index + 1, value };
}

function validateRemoteAgentOpsArgs(parsed) {
  if (parsed.env !== "local" && !ORG_ID_RE.test(parsed.env)) {
    throw new UsageError("--env must match [A-Za-z0-9_-]+ or be local.");
  }
  for (const [field, value] of [
    ["--block-org", parsed.blockOrganizationId],
    ["--unblock-org", parsed.unblockOrganizationId],
    ["--org", parsed.organizationId],
  ]) {
    if (value !== undefined && !ORG_ID_RE.test(value)) {
      throw new UsageError(`${field} must match [A-Za-z0-9_-]+.`);
    }
  }
  if (parsed.action === "usage") {
    if (!(parsed.spaceId && SPACE_ID_RE.test(parsed.spaceId))) {
      throw new UsageError("usage requires --space matching [A-Za-z0-9_-]+.");
    }
    if (
      typeof parsed.runtimeConversationId !== "string" ||
      parsed.runtimeConversationId.trim().length === 0 ||
      parsed.runtimeConversationId.length > 2048
    ) {
      throw new UsageError(
        "usage requires --runtime-conversation with the exact persisted runtime conversation id."
      );
    }
    if (
      parsed.timeoutMs !== undefined &&
      (!Number.isInteger(Number(parsed.timeoutMs)) ||
        Number(parsed.timeoutMs) <= 0)
    ) {
      throw new UsageError("--timeout-ms must be a positive integer.");
    }
    return;
  }
  if (parsed.action !== "policy") {
    throw new UsageError(`Unknown command "${parsed.action}".`);
  }
}

export async function readRemoteAgentPolicy(input = {}) {
  const configPath = input.configPath ?? DEFAULT_CORE_WRANGLER_CONFIG;
  const configText = await readFile(configPath, "utf8");
  const config = parseJsonc(configText);
  const env = input.env ?? "prod";
  const vars = resolveWranglerVars(config, env);
  return {
    blockedOrganizationIds: parseOrganizationList(vars[BLOCKED_ORGS_VAR]),
    configPath,
    env,
    runtimeEnabled: String(vars[RUNTIME_ENABLED_VAR] ?? "") === "true",
  };
}

export async function applyRemoteAgentPolicyChanges(parsed) {
  const configPath = parsed.configPath ?? DEFAULT_CORE_WRANGLER_CONFIG;
  const configText = await readFile(configPath, "utf8");
  const config = parseJsonc(configText);
  const vars = resolveWranglerVars(config, parsed.env);
  const nextVars = {
    [RUNTIME_ENABLED_VAR]: String(vars[RUNTIME_ENABLED_VAR] ?? "false"),
    [BLOCKED_ORGS_VAR]: String(vars[BLOCKED_ORGS_VAR] ?? ""),
  };
  const blocked = parseOrganizationList(nextVars[BLOCKED_ORGS_VAR]);
  if (parsed.runtimeEnabled !== undefined) {
    nextVars[RUNTIME_ENABLED_VAR] = parsed.runtimeEnabled ? "true" : "false";
  }
  if (parsed.blockOrganizationId) {
    blocked.add(parsed.blockOrganizationId);
  }
  if (parsed.unblockOrganizationId) {
    blocked.delete(parsed.unblockOrganizationId);
  }
  nextVars[BLOCKED_ORGS_VAR] = [...blocked].sort().join(",");

  const changed =
    nextVars[RUNTIME_ENABLED_VAR] !== String(vars[RUNTIME_ENABLED_VAR] ?? "") ||
    nextVars[BLOCKED_ORGS_VAR] !== String(vars[BLOCKED_ORGS_VAR] ?? "");
  const policy = {
    blockedOrganizationIds: parseOrganizationList(nextVars[BLOCKED_ORGS_VAR]),
    configPath,
    env: parsed.env,
    runtimeEnabled: nextVars[RUNTIME_ENABLED_VAR] === "true",
  };

  if (parsed.dryRun || !changed) {
    return { changed, dryRun: parsed.dryRun, policy };
  }

  const nextText = updateWranglerPolicyVars(configText, parsed.env, nextVars);
  await writeFile(configPath, nextText, "utf8");
  return { changed: true, dryRun: false, policy };
}

export function updateWranglerPolicyVars(configText, env, vars) {
  let nextText = configText;
  for (const [key, value] of Object.entries(vars)) {
    nextText = replaceStringPropertyInVarsBlock(nextText, env, key, value);
  }
  return nextText;
}

export function resolveRemoteAgentServiceName(config, env) {
  const services =
    env === "local" ? config.services : config.env?.[env]?.services;
  const binding = (services ?? []).find(
    (item) => item?.binding === REMOTE_AGENT_WORKER_BINDING
  );
  if (!binding?.service) {
    throw new UsageError(
      `No ${REMOTE_AGENT_WORKER_BINDING} service binding found for env ${env}.`
    );
  }
  return String(binding.service);
}

export function buildUsageDiagnosticsWorkerSource() {
  return `
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/usage") {
      return new Response("not found", { status: 404 });
    }
    const spaceId = url.searchParams.get("spaceId");
    const runtimeConversationId = url.searchParams.get("runtimeConversationId");
    const organizationId = url.searchParams.get("organizationId") || undefined;
    if (!spaceId || !runtimeConversationId) {
      return Response.json(
        { error: "spaceId and runtimeConversationId are required" },
        { status: 400 }
      );
    }
    const worker = env.${REMOTE_AGENT_WORKER_BINDING};
    if (typeof worker?.readUsageDiagnostics !== "function") {
      return Response.json(
        { error: "Remote Agent worker does not expose readUsageDiagnostics" },
        { status: 502 }
      );
    }
    const result = await worker.readUsageDiagnostics({
      organizationId,
      runtimeConversationId,
      spaceId,
    });
    return Response.json(result);
  },
};
`.trimStart();
}

export function buildUsageDiagnosticsWranglerConfig(serviceName) {
  return JSON.stringify(
    {
      name: "openmeld-remote-agent-usage-diagnostics",
      main: "worker.mjs",
      compatibility_date: "2026-07-06",
      services: [
        {
          binding: REMOTE_AGENT_WORKER_BINDING,
          service: serviceName,
        },
      ],
    },
    null,
    2
  );
}

export function buildUsageDiagnosticsUrl(input) {
  const url = new URL(`http://127.0.0.1:${input.port}/usage`);
  url.searchParams.set("spaceId", input.spaceId);
  url.searchParams.set("runtimeConversationId", input.runtimeConversationId);
  if (input.organizationId) {
    url.searchParams.set("organizationId", input.organizationId);
  }
  return url.toString();
}

export function buildUsageDiagnosticsDevInvocation(input) {
  const args = [
    "exec",
    "wrangler",
    "dev",
    "--config",
    input.wranglerConfigPath,
    "--port",
    String(input.port),
    "--log-level",
    "error",
    "--show-interactive-dev-session=false",
  ];
  if (input.remote) {
    args.push("--remote");
  } else {
    args.push("--local");
  }
  return { args, command: "pnpm" };
}

export async function readRemoteAgentUsageDiagnostics(parsed) {
  const configText = await readFile(parsed.configPath, "utf8");
  const config = parseJsonc(configText);
  const serviceName =
    parsed.serviceName ?? resolveRemoteAgentServiceName(config, parsed.env);
  const port = await allocatePort();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "openmeld-ra-usage-"));
  const workerPath = path.join(tempDir, "worker.mjs");
  const wranglerConfigPath = path.join(tempDir, "wrangler.json");
  const url = buildUsageDiagnosticsUrl({
    organizationId: parsed.organizationId,
    port,
    runtimeConversationId: parsed.runtimeConversationId,
    spaceId: parsed.spaceId,
  });
  const invocation = buildUsageDiagnosticsDevInvocation({
    port,
    remote: parsed.remote,
    wranglerConfigPath,
  });

  if (parsed.dryRun) {
    return {
      dryRun: true,
      invocation,
      serviceName,
      url,
    };
  }

  await writeFile(workerPath, buildUsageDiagnosticsWorkerSource(), "utf8");
  await writeFile(
    wranglerConfigPath,
    buildUsageDiagnosticsWranglerConfig(serviceName),
    "utf8"
  );

  const child = spawn(invocation.command, invocation.args, {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const result = await pollJsonEndpoint(url, {
      child,
      timeoutMs: Number(parsed.timeoutMs ?? USAGE_DEV_TIMEOUT_MS),
    });
    return { dryRun: false, result, serviceName, url };
  } finally {
    child.kill("SIGTERM");
    await rm(tempDir, { force: true, recursive: true });
  }
}

export function formatPolicy(policy) {
  const blocked =
    policy.blockedOrganizationIds.size === 0
      ? "none"
      : [...policy.blockedOrganizationIds].join(", ");
  return [
    `Remote Agent policy (${policy.env})`,
    `  runtime: ${policy.runtimeEnabled ? "enabled" : "disabled"}`,
    `  blocked organizations: ${blocked}`,
  ].join("\n");
}

export function formatUsageDiagnostics(diagnostics) {
  if (diagnostics.dryRun) {
    return [
      "Remote Agent usage diagnostics dry run",
      `  service: ${diagnostics.serviceName}`,
      `  command: ${diagnostics.invocation.command} ${diagnostics.invocation.args.join(" ")}`,
      `  url: ${diagnostics.url}`,
    ].join("\n");
  }
  const result = diagnostics.result;
  const records = Array.isArray(result?.records) ? result.records : [];
  const latest = records[0] ?? null;
  const lines = [
    "Remote Agent usage diagnostics",
    `  service: ${diagnostics.serviceName}`,
    `  records: ${records.length}`,
  ];
  if (latest) {
    lines.push(
      `  latest submission: ${latest.submissionId ?? "unknown"}`,
      `  latest total tokens: ${latest.usage?.totalTokens ?? "unknown"}`
    );
  }
  return lines.join("\n");
}

async function runCli(rawArgs) {
  const parsed = parseRemoteAgentOpsArgs(rawArgs);
  if (parsed.help) {
    printHelp();
    return;
  }
  if (parsed.action === "usage") {
    const diagnostics = await readRemoteAgentUsageDiagnostics(parsed);
    console.log(
      parsed.json
        ? JSON.stringify(diagnostics, null, 2)
        : formatUsageDiagnostics(diagnostics)
    );
    return;
  }

  const hasPolicyWrite =
    parsed.runtimeEnabled !== undefined ||
    parsed.blockOrganizationId !== undefined ||
    parsed.unblockOrganizationId !== undefined;
  if (!hasPolicyWrite) {
    const policy = await readRemoteAgentPolicy(parsed);
    console.log(parsed.json ? stringifyPolicy(policy) : formatPolicy(policy));
    return;
  }

  const result = await applyRemoteAgentPolicyChanges(parsed);
  if (parsed.json) {
    console.log(JSON.stringify(serializePolicyWriteResult(result), null, 2));
    return;
  }
  if (result.dryRun) {
    console.log("Remote Agent policy dry run");
  } else if (result.changed) {
    console.log(`Updated Remote Agent policy in ${result.policy.configPath}.`);
    console.log("Deploy Core to apply: pnpm -C services/core run sync:prod");
  } else {
    console.log("Remote Agent policy already matched the requested state.");
  }
  console.log(formatPolicy(result.policy));
}

function stringifyPolicy(policy) {
  return JSON.stringify(
    {
      blockedOrganizationIds: [...policy.blockedOrganizationIds],
      configPath: policy.configPath,
      env: policy.env,
      runtimeEnabled: policy.runtimeEnabled,
    },
    null,
    2
  );
}

function serializePolicyWriteResult(result) {
  return {
    changed: result.changed,
    dryRun: result.dryRun,
    policy: {
      blockedOrganizationIds: [...result.policy.blockedOrganizationIds],
      configPath: result.policy.configPath,
      env: result.policy.env,
      runtimeEnabled: result.policy.runtimeEnabled,
    },
  };
}

function parseOrganizationList(value) {
  return new Set(
    String(value ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

function resolveWranglerVars(config, env) {
  const vars = env === "local" ? config.vars : config.env?.[env]?.vars;
  if (!vars || typeof vars !== "object") {
    throw new UsageError(`No vars block found for env ${env}.`);
  }
  return vars;
}

function replaceStringPropertyInVarsBlock(text, env, key, value) {
  const varsRange = findVarsObjectRange(text, env);
  const segment = text.slice(varsRange.open + 1, varsRange.close);
  const propertyRe = new RegExp(
    `("${escapeRegExp(key)}"\\s*:\\s*)"(?:\\\\.|[^"\\\\])*"`,
    "u"
  );
  if (!propertyRe.test(segment)) {
    throw new UsageError(`${key} is missing from env ${env} vars.`);
  }
  const nextSegment = segment.replace(propertyRe, `$1${JSON.stringify(value)}`);
  return (
    text.slice(0, varsRange.open + 1) +
    nextSegment +
    text.slice(varsRange.close)
  );
}

function findVarsObjectRange(text, env) {
  if (env === "local") {
    return findObjectAfterProperty(text, "vars", 0);
  }
  const envRange = findObjectAfterProperty(text, "env", 0);
  const prodRange = findObjectAfterProperty(text, env, envRange.open);
  return findObjectAfterProperty(text, "vars", prodRange.open);
}

function findObjectAfterProperty(text, propertyName, fromIndex) {
  const propertyIndex = text.indexOf(`"${propertyName}"`, fromIndex);
  if (propertyIndex < 0) {
    throw new UsageError(
      `Could not find "${propertyName}" in wrangler config.`
    );
  }
  const colonIndex = text.indexOf(":", propertyIndex);
  const open = text.indexOf("{", colonIndex);
  if (colonIndex < 0 || open < 0) {
    throw new UsageError(`"${propertyName}" is not an object.`);
  }
  return { close: findMatchingBrace(text, open), open };
}

function findMatchingBrace(text, openIndex) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = openIndex; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      ({ escaped, inString } = advanceJsonStringState({ char, escaped }));
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  throw new UsageError("Unbalanced object braces in wrangler config.");
}

function advanceJsonStringState(input) {
  if (input.escaped) {
    return { escaped: false, inString: true };
  }
  if (input.char === "\\") {
    return { escaped: true, inString: true };
  }
  return {
    escaped: false,
    inString: input.char !== '"',
  };
}

function parseJsonc(text) {
  return JSON.parse(removeTrailingCommas(stripJsonComments(text)));
}

function stripJsonComments(text) {
  let output = "";
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (inString) {
      output += char;
      ({ escaped, inString } = advanceJsonStringState({ char, escaped }));
      continue;
    }
    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }
    const comment = readJsonComment(text, index, char, next);
    if (comment) {
      output += comment.replacement;
      index = comment.nextIndex;
      continue;
    }
    output += char;
  }
  return output;
}

function readJsonComment(text, index, char, next) {
  if (char === "/" && next === "/") {
    let nextIndex = index;
    while (nextIndex < text.length && text[nextIndex] !== "\n") {
      nextIndex += 1;
    }
    return { nextIndex, replacement: "\n" };
  }
  if (char !== "/" || next !== "*") {
    return null;
  }
  let nextIndex = index + 2;
  while (
    nextIndex < text.length &&
    !(text[nextIndex] === "*" && text[nextIndex + 1] === "/")
  ) {
    nextIndex += 1;
  }
  return { nextIndex: nextIndex + 1, replacement: "" };
}

function removeTrailingCommas(text) {
  return text.replace(/,\s*([}\]])/gu, "$1");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

async function allocatePort() {
  return await new Promise((resolvePromise, rejectPromise) => {
    const server = net.createServer();
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (typeof address === "object" && address?.port) {
          resolvePromise(address.port);
        } else {
          rejectPromise(new Error("Could not allocate a local port."));
        }
      });
    });
  });
}

async function pollJsonEndpoint(url, input) {
  const startedAt = Date.now();
  const stderr = [];
  input.child.stderr.on("data", (chunk) => {
    stderr.push(String(chunk));
  });
  while (Date.now() - startedAt < input.timeoutMs) {
    if (input.child.exitCode !== null) {
      throw new Error(
        `wrangler dev exited before usage diagnostics responded: ${stderr.join("")}`
      );
    }
    try {
      const response = await fetch(url);
      if (response.ok) {
        return await response.json();
      }
      if (response.status >= 500) {
        throw new Error(await response.text());
      }
    } catch {
      await sleep(250);
      continue;
    }
    await sleep(250);
  }
  throw new Error(
    `Timed out waiting for usage diagnostics from temporary Worker. ${stderr.join("")}`
  );
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function printHelp() {
  console.log(`Usage:
  pnpm ops:remote-agent policy [--env prod|local] [--config <path>] [--json]
  pnpm ops:remote-agent policy --enable-runtime|--disable-runtime [--dry-run]
  pnpm ops:remote-agent policy --block-org <id>|--unblock-org <id> [--dry-run]
  pnpm ops:remote-agent usage --space <id> --runtime-conversation <id> [--org <id>] [--env prod|local] [--service <worker>] [--local] [--dry-run]

Policy options:
  --enable-runtime       Set OPENMELD_REMOTE_AGENT_RUNTIME_ENABLED=true.
  --disable-runtime      Set OPENMELD_REMOTE_AGENT_RUNTIME_ENABLED=false.
  --block-org <id>       Add an organization id to the blocklist.
  --unblock-org <id>     Remove an organization id from the blocklist.
  --env <env>            Wrangler environment. Default prod. Use local for root vars.
  --config <path>        Core wrangler config path. Default services/core/wrangler.jsonc.

Usage options:
  --space <id>           Required logical Space filter for returned usage records.
  --runtime-conversation <id>
                         Required exact runtime conversation id from the frozen dispatch request.
  --org <id>             Optional organization filter passed to readUsageDiagnostics.
  --service <worker>     Override the Remote Agent Worker service binding target.
  --local                Run the temporary diagnostics Worker locally instead of --remote.
  --timeout-ms <ms>      Temporary Worker startup/read timeout. Default ${USAGE_DEV_TIMEOUT_MS}.

Notes:
  - Policy writes update wrangler.jsonc; deploy Core to apply them.
  - Usage diagnostics call readUsageDiagnostics through a temporary service-binding Worker.
  - Runtime generations are never inferred from a Space id; use the exact frozen dispatch identity.
  - This script does not read or mutate retired Core breaker tables.`);
}
