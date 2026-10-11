#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  closeMigrationClient,
  connect,
  connectionOptions,
} from "../../tooling/postgresql/database.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const SQL_STATE_PATTERN = /^[0-9A-Z]{5}$/u;
class DiagnosticReportOpsError extends Error {}
const SHELL_SAFE_ARG_RE = /^[A-Za-z0-9_./:=@-]+$/u;
const CLI_COMMANDS = new Set(["openmeld", "openmeld-dev", "openmeld-canary"]);

const VALUE_OPTIONS = new Map([
  ["cli", "cli"],
  ["diagnostic-report", "diagnosticReportId"],
  ["env", "env"],
  ["gateway-url", "gatewayUrl"],
  ["password", "password"],
  ["profile", "profile"],
]);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli(process.argv.slice(2)).catch((error) => {
    console.error(
      error instanceof DiagnosticReportOpsError
        ? error.message
        : "Diagnostic Report lookup failed; no query or server payload was logged."
    );
    console.error("Run `pnpm ops:diagnostic-report --help` for usage.");
    process.exit(1);
  });
}

export function parseDiagnosticReportOpsArgs(rawArgs) {
  const parsed = {
    cli: "openmeld-dev",
    env: "prod",
    remote: true,
  };
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--help" || arg === "-h") {
      return { help: true };
    }
    if (arg === "--local") {
      parsed.remote = false;
      continue;
    }
    if (!arg.startsWith("--")) {
      throw new DiagnosticReportOpsError(`Unexpected argument "${arg}".`);
    }
    const option = readOptionValue(rawArgs, index);
    index = option.nextIndex;
    const outputKey = VALUE_OPTIONS.get(option.key);
    if (!outputKey) {
      throw new DiagnosticReportOpsError(`Unknown option "${arg}".`);
    }
    parsed[outputKey] = option.value;
  }
  if (!parsed.diagnosticReportId?.trim()) {
    throw new DiagnosticReportOpsError("--diagnostic-report is required.");
  }
  if (!CLI_COMMANDS.has(parsed.cli)) {
    throw new DiagnosticReportOpsError(`Invalid --cli "${parsed.cli}".`);
  }
  if (!["prod", "stg"].includes(parsed.env)) {
    throw new DiagnosticReportOpsError("--env must be prod or stg.");
  }
  return parsed;
}

export function buildDiagnosticReportLookupQuery(diagnosticReportId) {
  return {
    values: [diagnosticReportId],
    text: `
SELECT
  r.diagnostic_report_id AS "diagnosticReportId",
  r.space_id AS "spaceId",
  r.reported_signal_id AS "reportedSignalId",
  r.reply_to_signal_id AS "replyToSignalId",
  r.thread_id AS "threadId",
  r.problem_type AS "problemType",
  r.wake_pointer_derivation_status AS "wakePointerDerivationStatus",
  r.reason_codes_json AS "reasonCodesJson",
  r.created_at_ms AS "createdAtMs",
  p.client_message_id AS "clientMessageId",
  p.source_signal_id AS "sourceSignalId",
  p.target_profile_id AS "targetProfileId"
FROM openmeld."openMeldDaemon_space_diagnostic_reports" r
LEFT JOIN openmeld."openMeldDaemon_space_diagnostic_report_wake_pointers" p
  ON p.diagnostic_report_id = r.diagnostic_report_id
WHERE r.diagnostic_report_id = $1
ORDER BY p.created_at_ms ASC;
`.trim(),
  };
}

export async function lookupDiagnosticReportRows({
  client,
  diagnosticReportId,
}) {
  await client.query("BEGIN READ ONLY");
  try {
    await client.query("SET LOCAL statement_timeout = '10s'");
    const result = await client.query(
      buildDiagnosticReportLookupQuery(diagnosticReportId)
    );
    await client.query("COMMIT");
    return result.rows;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export function verifyDiagnosticReportDatabaseTarget(
  parsed,
  value,
  inventory,
  env = process.env
) {
  connectionOptions(value, !parsed.remote);
  if (!parsed.remote) {
    if (env.OPENMELD_PG_ISOLATED !== "1") {
      throw new DiagnosticReportOpsError(
        "--local requires an isolated PostgreSQL lane (OPENMELD_PG_ISOLATED=1)."
      );
    }
    return;
  }
  const entry =
    inventory.environments[parsed.env === "prod" ? "production" : "staging"];
  const url = new URL(value);
  if (
    !entry ||
    url.hostname !== entry.host ||
    url.pathname !== "/postgres" ||
    decodeURIComponent(url.username) !==
      `${entry.runtimeRole}.${entry.branchId}`
  ) {
    throw new DiagnosticReportOpsError(
      "PostgreSQL runtime credential does not match the registered --env target."
    );
  }
}

async function readLookupConnectionString(parsed) {
  let value = process.env.POSTGRESQL_OPENMELD_RUNTIME_URL;
  if (!value && parsed.remote) {
    const credential = await runCommandCapture({
      command: "doppler",
      args: [
        "secrets",
        "get",
        "POSTGRESQL_OPENMELD_RUNTIME_URL",
        "--plain",
        "--project",
        "openmeld-release",
        "--config",
        parsed.env === "prod" ? "prd" : "stg",
        "--silent",
      ],
    });
    if (credential.code !== 0) {
      throw new DiagnosticReportOpsError(
        "Scoped PostgreSQL runtime credential is unavailable in Doppler."
      );
    }
    value = credential.stdout.trim();
  }
  if (!value) {
    throw new DiagnosticReportOpsError(
      "Missing POSTGRESQL_OPENMELD_RUNTIME_URL from the isolated PostgreSQL lane."
    );
  }
  const inventory = JSON.parse(
    await readFile(
      new URL("../../tooling/postgresql/resources.json", import.meta.url),
      "utf8"
    )
  );
  verifyDiagnosticReportDatabaseTarget(parsed, value, inventory);
  return value;
}

export function buildDiagnosticReportTraceCommands(input) {
  const pointers = new Map();
  for (const row of input.rows) {
    if (!(row.spaceId && row.clientMessageId && row.targetProfileId)) {
      continue;
    }
    const key = `${row.spaceId}\0${row.clientMessageId}\0${row.targetProfileId}`;
    if (!pointers.has(key)) {
      pointers.set(key, {
        clientMessageId: row.clientMessageId,
        spaceId: row.spaceId,
        targetProfileId: row.targetProfileId,
      });
    }
  }

  return Array.from(pointers.values(), (pointer) => {
    const command = [
      "pnpm",
      "ops:trace",
      "--cli",
      input.parsed.cli,
      "--space",
      pointer.spaceId,
      "--client-message",
      pointer.clientMessageId,
      "--target-profile",
      pointer.targetProfileId,
      "--no-cf-hints",
      "--view",
      "agent",
    ];
    appendOptional(command, "--profile", input.parsed.profile);
    appendOptional(
      command,
      "--password",
      input.parsed.password ? "<space-password>" : undefined
    );
    appendOptional(command, "--gateway-url", input.parsed.gatewayUrl);
    return command;
  });
}

export function buildDiagnosticReportCloudflareCommands(input) {
  const commands = new Map();
  for (const row of input.rows) {
    if (row.spaceId && row.clientMessageId && row.targetProfileId) {
      const key = `client\0${row.spaceId}\0${row.clientMessageId}\0${row.targetProfileId}`;
      if (!commands.has(key)) {
        commands.set(key, [
          "pnpm",
          "ops:cf:query",
          "--space",
          row.spaceId,
          "--client-message",
          row.clientMessageId,
          "--target-profile",
          row.targetProfileId,
        ]);
      }
      continue;
    }
    if (row.spaceId && row.sourceSignalId && row.targetProfileId) {
      const key = `source\0${row.spaceId}\0${row.sourceSignalId}\0${row.targetProfileId}`;
      if (!commands.has(key)) {
        commands.set(key, [
          "pnpm",
          "ops:cf:query",
          "--space",
          row.spaceId,
          "--source-signal",
          row.sourceSignalId,
          "--target-profile",
          row.targetProfileId,
        ]);
      }
    }
  }
  return Array.from(commands.values());
}

async function runCli(rawArgs) {
  const parsed = parseDiagnosticReportOpsArgs(rawArgs);
  if (parsed.help) {
    printHelp();
    return;
  }
  let client;
  let rows;
  try {
    const value = await readLookupConnectionString(parsed);
    client = await connect(value, !parsed.remote);
    rows = await lookupDiagnosticReportRows({
      client,
      diagnosticReportId: parsed.diagnosticReportId,
    });
  } catch (error) {
    if (error instanceof DiagnosticReportOpsError) {
      throw error;
    }
    const state =
      typeof error?.code === "string" && SQL_STATE_PATTERN.test(error.code)
        ? ` (SQLSTATE ${error.code})`
        : "";
    throw new DiagnosticReportOpsError(
      `PostgreSQL Diagnostic Report lookup failed${state}; no query or server payload was logged.`
    );
  } finally {
    if (client) {
      await closeMigrationClient(client);
    }
  }
  if (rows.length === 0) {
    throw new DiagnosticReportOpsError(
      `Diagnostic Report not found: ${parsed.diagnosticReportId}`
    );
  }
  printDiagnosticReportSummary({
    cloudflareCommands: buildDiagnosticReportCloudflareCommands({ rows }),
    rows,
    traceCommands: buildDiagnosticReportTraceCommands({ parsed, rows }),
  });
}

function printDiagnosticReportSummary(input) {
  const first = input.rows[0];
  console.log(`Diagnostic Report: ${first.diagnosticReportId}`);
  console.log(`Space: ${first.spaceId}`);
  console.log(`Problem: ${first.problemType}`);
  console.log(`Pointer derivation: ${first.wakePointerDerivationStatus}`);
  console.log("\nOpenMeld trace commands:");
  if (input.traceCommands.length === 0) {
    console.log("  No Wake pointer was derived for this report.");
  } else {
    for (const command of input.traceCommands) {
      console.log(`  ${formatShellCommand(command)}`);
    }
  }
  console.log("\nHistorical Cloudflare runtime evidence:");
  if (input.cloudflareCommands.length === 0) {
    console.log("  No Wake pointer was derived for this report.");
  } else {
    for (const command of input.cloudflareCommands) {
      console.log(`  ${formatShellCommand(command)}`);
    }
  }
}

function runCommandCapture(invocation) {
  return new Promise((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`Diagnostic Report lookup interrupted: ${signal}`));
        return;
      }
      resolve({ code: code ?? 1, stderr, stdout });
    });
  });
}

function appendOptional(command, flag, value) {
  if (typeof value === "string" && value.trim()) {
    command.push(flag, value.trim());
  }
}

function readOptionValue(rawArgs, index) {
  const arg = rawArgs[index];
  const equalIndex = arg.indexOf("=");
  if (equalIndex > 0) {
    return {
      key: arg.slice(2, equalIndex),
      nextIndex: index,
      value: arg.slice(equalIndex + 1),
    };
  }
  const value = rawArgs[index + 1];
  if (!value || value.startsWith("--")) {
    throw new DiagnosticReportOpsError(`Missing value for ${arg}.`);
  }
  return {
    key: arg.slice(2),
    nextIndex: index + 1,
    value,
  };
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

function printHelp() {
  console.log(`Usage:
  pnpm ops:diagnostic-report --diagnostic-report diag_123
  pnpm ops:trace --diagnostic-report diag_123

Options:
  --diagnostic-report <id>          Diagnostic Report ID.
  --env <prod|stg>                  Registered PostgreSQL target. Defaults to prod.
  --local                           Use POSTGRESQL_OPENMELD_RUNTIME_URL from an isolated local lane.
  --cli <openmeld|openmeld-dev|openmeld-canary>    OpenMeld CLI command for generated trace commands. Defaults to openmeld-dev.
  --profile <id>                    OpenMeld profile ID used for generated trace commands.
  --password <value>                Add a password placeholder to trace commands; never print the password.
  --gateway-url <url>               Gateway URL for generated trace commands.

Remote lookups read only the scoped runtime URL from Doppler openmeld-release
prd/stg when it is not already injected. Queries are parameterized and read-only.
Generated trace commands use --view agent. Inspect customer content with an
explicit human/detail trace only after obtaining the user's consent.
`);
}
