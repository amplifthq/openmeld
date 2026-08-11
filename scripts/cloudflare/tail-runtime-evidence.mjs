#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "../..");

export const WORKERS = new Map([
  ["auth", "services/auth"],
  ["core", "services/core"],
  ["gateway", "services/gateway"],
  ["web", "clients/web"],
]);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli(process.argv.slice(2));
}

export function parseTailRuntimeEvidenceArgs(rawArgs) {
  const parsed = {};
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument "${arg}".`);
    }
    const key = arg.slice(2);
    const value = rawArgs[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${arg}.`);
    }
    index += 1;
    const normalizedValue = value.trim();
    if (!normalizedValue) {
      throw new Error(`Missing value for ${arg}.`);
    }
    switch (key) {
      case "openmeld-service-runtime-id":
        parsed.openMeldServiceRuntimeId = normalizedValue;
        break;
      case "binding":
        parsed.binding = normalizedValue;
        break;
      case "agent-controller":
        parsed.agentControllerRef = normalizedValue;
        break;
      case "cf-ray":
        parsed.cfRay = normalizedValue;
        break;
      case "claim-lease":
        parsed.claimLease = normalizedValue;
        break;
      case "client-message":
        parsed.clientMessage = normalizedValue;
        break;
      case "dispatch":
        parsed.dispatch = normalizedValue;
        break;
      case "env":
        parsed.env = normalizedValue;
        break;
      case "format":
        parsed.format = normalizedValue;
        break;
      case "latest-attempt":
        parsed.latestAttempt = normalizedValue;
        break;
      case "published-signal":
        parsed.publishedSignal = normalizedValue;
        break;
      case "request":
        parsed.request = normalizedValue;
        break;
      case "result-ref":
        parsed.resultRef = normalizedValue;
        break;
      case "reply-signal":
        parsed.replySignal = normalizedValue;
        break;
      case "search":
        parsed.search = normalizedValue;
        break;
      case "source-signal":
        parsed.sourceSignal = normalizedValue;
        break;
      case "space":
        parsed.space = normalizedValue;
        break;
      case "status":
        parsed.status = normalizedValue;
        break;
      case "target-profile":
        parsed.targetProfile = normalizedValue;
        break;
      case "trace":
        parsed.trace = normalizedValue;
        break;
      case "worker":
        parsed.worker = normalizedValue;
        break;
      default:
        throw new Error(`Unknown option "${arg}".`);
    }
  }
  return parsed;
}

export function buildWranglerTailArgs(args) {
  const env = args.env ?? "prod";
  const format = args.format ?? "json";
  if (format !== "json" && format !== "pretty") {
    throw new Error('Invalid --format. Expected "json" or "pretty".');
  }

  const tailArgs = ["tail", "--env", env, "--format", format];
  const search = resolveTailSearch(args);
  if (search) {
    tailArgs.push("--search", search);
  }
  if (args.status) {
    tailArgs.push("--status", args.status);
  }
  return tailArgs;
}

export function buildTailRuntimeEvidenceInvocation(args) {
  const worker = args.worker ?? "gateway";
  const workerDir = WORKERS.get(worker);
  if (!workerDir) {
    throw new Error(
      `Unknown worker "${worker}". Expected one of: ${listWorkers()}.`
    );
  }
  return {
    args: buildWranglerTailArgs(args),
    command: "pnpm",
    worker,
    workerDir,
    workerPath: path.join(repoRoot, workerDir),
  };
}

export function resolveTailSearch(args) {
  return (
    args.search ??
    args.clientMessage ??
    args.sourceSignal ??
    args.dispatch ??
    args.claimLease ??
    args.latestAttempt ??
    args.resultRef ??
    args.publishedSignal ??
    args.replySignal ??
    args.binding ??
    args.openMeldServiceRuntimeId ??
    args.agentControllerRef ??
    args.request ??
    args.trace ??
    args.cfRay ??
    args.targetProfile ??
    args.space ??
    null
  );
}

export function listWorkers() {
  return Array.from(WORKERS.keys()).join(", ");
}

function printHelp() {
  console.log(`Usage:
  pnpm ops:cf:tail --worker gateway --client-message cm_123
  pnpm ops:cf:tail --worker core --dispatch dispatch_123
  pnpm ops:cf:tail --worker auth --search auth.openmeld.http_request
  pnpm ops:cf:tail --worker gateway --cf-ray <cf-ray-id>

Options:
  --worker <${listWorkers()}>       Worker to tail. Defaults to gateway.
  --env <name>                      Wrangler environment. Defaults to prod.
  --space <id>                      Search logs by spaceId.
  --client-message <id>             Search logs by clientMessageId.
  --source-signal <id>              Search logs by sourceSignalId.
  --target-profile <id>             Search logs by targetProfileId.
  --dispatch <id>                   Search logs by dispatchId.
  --latest-attempt <id>             Search logs by latestAttemptId.
  --claim-lease <id>                Search logs by claimLeaseId.
  --binding <id>                    Search logs by bindingId.
  --openmeld-service-runtime-id <id>     Search logs by openMeldServiceRuntimeId.
  --agent-controller <ref>            Search logs by agentControllerRef.
  --result-ref <ref>                Search logs by resultRef.
  --published-signal <id>           Search logs by publishedSignalId.
  --reply-signal <id>               Search logs by replySignalId.
  --request <id>                    Search logs by requestId.
  --trace <id>                      Search logs by traceId.
  --cf-ray <id>                     Search logs by cfRayId.
  --search <text>                   Raw wrangler tail search string.
  --status <ok|error|canceled>      Optional Wrangler status filter.
  --format <json|pretty>            Tail output format. Defaults to json.
`);
}

function runCli(rawArgs) {
  let args;
  let invocation;
  try {
    args = parseTailRuntimeEvidenceArgs(rawArgs);
    if (args.help) {
      printHelp();
      process.exit(0);
    }
    invocation = buildTailRuntimeEvidenceInvocation(args);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }

  const child = spawn(
    invocation.command,
    ["-C", invocation.workerPath, "exec", "wrangler", ...invocation.args],
    {
      stdio: "inherit",
    }
  );

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

function fail(message) {
  console.error(message);
  console.error("Run `pnpm ops:cf:tail --help` for usage.");
  process.exit(1);
}
