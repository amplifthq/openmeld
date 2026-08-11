#!/usr/bin/env node
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OPENMELD_DEV_WRAPPER_PATH = join(
  repoRoot,
  "scripts",
  "dev",
  "openmeld-dev.mjs"
);

const CLI_COMMANDS = new Set(["openmeld", "openmeld-dev", "openmeld-canary"]);
const TRACE_VIEWS = new Set(["human", "agent"]);
const INLINE_OPTION_RE = /=(.*)/u;
const VALUE_OPTIONS = new Map([
  ["cli", "cli"],
  ["client-message", "clientMessage"],
  ["diagnostic-report", "diagnosticReport"],
  ["dispatch", "dispatch"],
  ["gateway-url", "gatewayUrl"],
  ["password", "password"],
  ["profile", "profile"],
  ["source-signal", "sourceSignal"],
  ["space", "space"],
  ["target-profile", "targetProfile"],
  ["view", "view"],
]);
const SHELL_SAFE_ARG_RE = /^[A-Za-z0-9_./:=@-]+$/u;

async function main() {
  const parsed = parseOpsTraceArgs(process.argv.slice(2));
  if (parsed.help) {
    printHelp();
    return;
  }

  const result = await runOpsTrace({
    parsed,
  });

  if (result.signal) {
    process.kill(process.pid, result.signal);
    return;
  }

  if (result.code === 0 && parsed.cloudflareHints) {
    printCloudflareHints(parsed);
  }

  process.exitCode = result.code ?? 1;
}

export function runOpsTrace(input) {
  const parsed = input.parsed;
  const spawnFn = input.spawnFn ?? spawn;
  const invocation = buildTraceInvocation(parsed);
  const child = spawnFn(invocation.command, invocation.args, {
    cwd: input.cwd ?? repoRoot,
    stdio: "inherit",
  });

  return new Promise((resolvePromise, rejectPromise) => {
    child.on("error", rejectPromise);
    child.on("exit", (code, signal) => {
      resolvePromise({ code, signal });
    });
  });
}

export function parseOpsTraceArgs(rawArgs) {
  const parsed = {
    cli: "openmeld-dev",
    cloudflareHints: null,
    view: "human",
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--help" || arg === "-h") {
      return { help: true };
    }
    if (arg === "--cf-hints") {
      parsed.cloudflareHints = true;
      continue;
    }
    if (arg === "--no-cf-hints") {
      parsed.cloudflareHints = false;
      continue;
    }
    if (!arg.startsWith("--")) {
      throw new UsageError(`Unexpected argument "${arg}".`);
    }

    const option = readOptionValue(rawArgs, index);
    index = option.nextIndex;
    const outputKey = VALUE_OPTIONS.get(option.key);
    if (!outputKey) {
      throw new UsageError(`Unknown option "--${option.key}".`);
    }
    parsed[outputKey] = option.value;
  }

  validateParsedArgs(parsed);

  return {
    cli: parsed.cli,
    cloudflareHints:
      parsed.cloudflareHints ??
      (parsed.view === "human" && !isNonEmpty(parsed.diagnosticReport)),
    gatewayUrl: parsed.gatewayUrl ?? null,
    password: parsed.password ?? null,
    profile: parsed.profile ?? null,
    selector: resolveSelector(parsed),
    space: parsed.space,
    targetProfile: parsed.targetProfile ?? null,
    view: parsed.view,
  };
}

export function buildOpenMeldTraceArgs(parsed) {
  if (parsed.selector.kind === "diagnostic_report") {
    throw new Error(
      "Diagnostic Report lookup does not use OpenMeld trace args."
    );
  }
  const args = ["service", "trace", "--space", parsed.space];

  switch (parsed.selector.kind) {
    case "client_message":
      args.push("--client-message", parsed.selector.clientMessageId);
      break;
    case "dispatch":
      args.push("--dispatch", parsed.selector.dispatchId);
      break;
    case "source_signal":
      args.push("--source-signal", parsed.selector.sourceSignalId);
      break;
    default:
      throw new Error(`Unknown trace selector kind "${parsed.selector.kind}".`);
  }

  if (parsed.targetProfile) {
    args.push("--target-profile", parsed.targetProfile);
  }
  if (parsed.password) {
    args.push("--password", parsed.password);
  }
  if (parsed.profile) {
    args.push("--profile", parsed.profile);
  }
  if (parsed.gatewayUrl) {
    args.push("--gateway-url", parsed.gatewayUrl);
  }

  args.push("--view", parsed.view);

  return args;
}

export function buildTraceInvocation(parsed) {
  if (parsed.selector.kind === "diagnostic_report") {
    const args = [
      "ops:diagnostic-report",
      "--diagnostic-report",
      parsed.selector.diagnosticReportId,
      "--cli",
      parsed.cli,
    ];
    if (parsed.password) {
      args.push("--password", parsed.password);
    }
    if (parsed.profile) {
      args.push("--profile", parsed.profile);
    }
    if (parsed.gatewayUrl) {
      args.push("--gateway-url", parsed.gatewayUrl);
    }
    return {
      args,
      command: "pnpm",
    };
  }

  const traceArgs = buildOpenMeldTraceArgs(parsed);
  if (parsed.cli === "openmeld-dev") {
    return {
      args: [OPENMELD_DEV_WRAPPER_PATH, ...traceArgs],
      command: process.execPath,
    };
  }

  return {
    args: traceArgs,
    command: parsed.cli,
  };
}

export function buildCloudflareHintCommands(parsed) {
  switch (parsed.selector.kind) {
    case "client_message":
      return [
        [
          "pnpm",
          "ops:cf:query",
          "--space",
          parsed.space,
          "--client-message",
          parsed.selector.clientMessageId,
          "--target-profile",
          parsed.targetProfile,
        ],
      ];
    case "dispatch":
      return [
        [
          "pnpm",
          "ops:cf:query",
          "--space",
          parsed.space,
          "--dispatch",
          parsed.selector.dispatchId,
        ],
      ];
    case "source_signal":
      return [
        [
          "pnpm",
          "ops:cf:query",
          "--space",
          parsed.space,
          "--source-signal",
          parsed.selector.sourceSignalId,
          "--target-profile",
          parsed.targetProfile,
        ],
      ];
    case "diagnostic_report":
      return [];
    default:
      return [];
  }
}

function readOptionValue(rawArgs, index) {
  const arg = rawArgs[index];
  const [rawKey, inlineValue] = arg.slice(2).split(INLINE_OPTION_RE, 2);
  if (inlineValue !== undefined) {
    return {
      key: rawKey,
      nextIndex: index,
      value: inlineValue,
    };
  }

  const value = rawArgs[index + 1];
  if (!value || value.startsWith("--")) {
    throw new UsageError(`Missing value for ${arg}.`);
  }

  return {
    key: rawKey,
    nextIndex: index + 1,
    value,
  };
}

function validateParsedArgs(parsed) {
  assertAllowedValue(parsed.cli, CLI_COMMANDS, "--cli");
  assertAllowedValue(parsed.view, TRACE_VIEWS, "--view");

  const selectorCount =
    Number(isNonEmpty(parsed.diagnosticReport)) +
    Number(isNonEmpty(parsed.dispatch)) +
    Number(isNonEmpty(parsed.sourceSignal)) +
    Number(isNonEmpty(parsed.clientMessage));
  if (selectorCount !== 1) {
    throw new UsageError(
      "Exactly one of --diagnostic-report, --dispatch, --source-signal, or --client-message is required."
    );
  }

  if (isNonEmpty(parsed.diagnosticReport)) {
    return;
  }

  assertNonEmpty(parsed.space, "--space is required.");

  if (
    (isNonEmpty(parsed.clientMessage) || isNonEmpty(parsed.sourceSignal)) &&
    !isNonEmpty(parsed.targetProfile)
  ) {
    throw new UsageError(
      "--target-profile is required with --client-message or --source-signal."
    );
  }
}

function resolveSelector(parsed) {
  if (isNonEmpty(parsed.diagnosticReport)) {
    return {
      kind: "diagnostic_report",
      diagnosticReportId: parsed.diagnosticReport,
    };
  }
  if (isNonEmpty(parsed.clientMessage)) {
    return {
      kind: "client_message",
      clientMessageId: parsed.clientMessage,
    };
  }
  if (isNonEmpty(parsed.dispatch)) {
    return {
      kind: "dispatch",
      dispatchId: parsed.dispatch,
    };
  }
  if (isNonEmpty(parsed.sourceSignal)) {
    return {
      kind: "source_signal",
      sourceSignalId: parsed.sourceSignal,
    };
  }
  throw new UsageError(
    "Exactly one of --diagnostic-report, --dispatch, --source-signal, or --client-message is required."
  );
}

function printCloudflareHints(parsed) {
  const commands = buildCloudflareHintCommands(parsed);
  if (commands.length === 0) {
    return;
  }

  console.log("\nHistorical Cloudflare runtime evidence:");
  for (const command of commands) {
    console.log(`  ${formatShellCommand(command)}`);
  }
}

function printHelp() {
  console.log(`Usage:
  pnpm ops:trace --space sp_123 --client-message cm_123 --target-profile ap_123
  pnpm ops:trace --space sp_123 --source-signal sig_123 --target-profile ap_123
  pnpm ops:trace --space sp_123 --dispatch dispatch_123
  pnpm ops:trace --diagnostic-report diag_123

Options:
  --space <id>                   Space ID.
  --diagnostic-report <id>       Diagnostic Report ID.
  --client-message <id>          Client message ID from the sender.
  --source-signal <id>           Source signal ID.
  --dispatch <id>                Dispatch ID.
  --target-profile <id>          Target OpenMeld profile ID. Required for client-message and source-signal selectors.
  --profile <id>                 OpenMeld profile ID used for auth context.
  --password <value>             Space password for protected access.
  --gateway-url <url>            OpenMeld gateway URL.
  --cli <openmeld|openmeld-dev|openmeld-canary> OpenMeld CLI command to invoke. Defaults to openmeld-dev.
  --view <human|agent>           Trace output view. Defaults to human.
  --no-cf-hints                  Do not print Cloudflare follow-up commands.
`);
}

function assertAllowedValue(value, allowedValues, optionName) {
  if (!allowedValues.has(value)) {
    throw new UsageError(
      `Invalid ${optionName} "${value}". Expected one of: ${Array.from(
        allowedValues
      ).join(", ")}.`
    );
  }
}

function assertNonEmpty(value, message) {
  if (!isNonEmpty(value)) {
    throw new UsageError(message);
  }
}

function isNonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function formatShellCommand(args) {
  return args.map(formatShellArg).join(" ");
}

function formatShellArg(value) {
  if (SHELL_SAFE_ARG_RE.test(value)) {
    return value;
  }
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

class UsageError extends Error {}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof UsageError ? error.message : error);
    console.error("Run `pnpm ops:trace --help` for usage.");
    process.exit(1);
  });
}
