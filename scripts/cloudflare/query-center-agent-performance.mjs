#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { readCenterAgentPerformanceContract } from "./center-agent-performance-contract.mjs";
import { buildAnalyticsEngineRequest } from "./query-runtime-evidence.mjs";

const DEFAULT_DATASET = "openmeld_center_agent_performance";
const DEFAULT_SINCE = "24h";
const DEFAULT_LIMIT = 100;
const SINCE_INTERVAL_RE = /^([1-9][0-9]*)(m|h|d)$/u;
const TABLE_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/u;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(
      "Run `pnpm ops:cf:center-agent-performance --help` for usage."
    );
    process.exit(1);
  });
}

export function parseCenterAgentPerformanceArgs(rawArgs) {
  const parsed = {
    dataset: DEFAULT_DATASET,
    format: "json",
    limit: DEFAULT_LIMIT,
    since: DEFAULT_SINCE,
  };
  const values = new Map([
    ["account-id", "accountId"],
    ["api-token", "apiToken"],
    ["dataset", "dataset"],
    ["format", "format"],
    ["limit", "limit"],
    ["milestone", "milestone"],
    ["model", "modelId"],
    ["organization", "organizationId"],
    ["since", "since"],
    ["space", "spaceId"],
    ["status", "status"],
    ["trigger-source", "triggerSource"],
  ]);

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--help" || arg === "-h") {
      return { help: true };
    }
    if (arg === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument "${arg}".`);
    }
    const option = readOptionValue(rawArgs, index);
    index = option.nextIndex;
    const outputKey = values.get(option.key);
    if (!outputKey) {
      throw new Error(`Unknown option "${arg}".`);
    }
    parsed[outputKey] = option.value;
  }

  parsed.limit = parseLimit(parsed.limit);
  parsed.sinceInterval = parseSinceInterval(parsed.since);
  if (!TABLE_NAME_RE.test(parsed.dataset)) {
    throw new Error("--dataset must be a simple Analytics Engine table name.");
  }
  if (parsed.format !== "json" && parsed.format !== "sql") {
    throw new Error('Invalid --format. Expected "json" or "sql".');
  }
  return parsed;
}

export function buildCenterAgentPerformanceSql(input) {
  const contract = input.contract ?? readCenterAgentPerformanceContract();
  const elapsed = requireColumn(
    contract.doubleColumns,
    "elapsedFromAdmissionMs"
  );
  const milestone = requireColumn(contract.blobColumns, "milestone");
  const modelId = requireColumn(contract.blobColumns, "modelId");
  const triggerSource = requireColumn(contract.blobColumns, "triggerSource");
  const filters = [
    `timestamp >= NOW() - INTERVAL '${String(
      input.parsed.sinceInterval.amount
    )}' ${input.parsed.sinceInterval.unit}`,
  ];
  for (const field of [
    "milestone",
    "modelId",
    "organizationId",
    "spaceId",
    "status",
    "triggerSource",
  ]) {
    const value = input.parsed[field];
    if (value) {
      filters.push(
        `${requireColumn(contract.blobColumns, field)} = ${quoteSql(value)}`
      );
    }
  }

  return [
    "SELECT",
    `  ${milestone} AS milestone,`,
    `  ${triggerSource} AS triggerSource,`,
    `  ${modelId} AS modelId,`,
    "  sum(_sample_interval) AS estimatedTurnCount,",
    `  sum(${elapsed} * _sample_interval) / sum(_sample_interval) AS avgElapsedMs,`,
    `  quantileExactWeighted(0.50)(${elapsed}, _sample_interval) AS p50ElapsedMs,`,
    `  quantileExactWeighted(0.95)(${elapsed}, _sample_interval) AS p95ElapsedMs,`,
    `  quantileExactWeighted(0.99)(${elapsed}, _sample_interval) AS p99ElapsedMs`,
    `FROM ${input.parsed.dataset}`,
    `WHERE ${filters.join("\n  AND ")}`,
    "GROUP BY milestone, triggerSource, modelId",
    "ORDER BY p95ElapsedMs DESC",
    `LIMIT ${String(input.parsed.limit)}`,
    "FORMAT JSONEachRow",
  ].join("\n");
}

async function runCli(rawArgs) {
  const parsed = parseCenterAgentPerformanceArgs(rawArgs);
  if (parsed.help) {
    printHelp();
    return;
  }
  const sql = buildCenterAgentPerformanceSql({ parsed });
  if (parsed.dryRun || parsed.format === "sql") {
    console.log(sql);
    return;
  }
  const request = buildAnalyticsEngineRequest({
    accountId: parsed.accountId ?? process.env.CLOUDFLARE_ACCOUNT_ID,
    apiToken: parsed.apiToken ?? process.env.CLOUDFLARE_API_TOKEN,
    sql,
  });
  const response = await fetch(request.url, request);
  const body = await response.text();
  if (!response.ok) {
    throw new Error(
      `Cloudflare Analytics Engine query failed (${String(response.status)}): ${body}`
    );
  }
  process.stdout.write(body.endsWith("\n") ? body : `${body}\n`);
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
    throw new Error(`Missing value for ${arg}.`);
  }
  return { key: arg.slice(2), nextIndex: index + 1, value };
}

function parseLimit(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 500) {
    throw new Error("--limit must be an integer between 1 and 500.");
  }
  return parsed;
}

function parseSinceInterval(value) {
  const match = String(value).trim().match(SINCE_INTERVAL_RE);
  if (!match) {
    throw new Error('--since must use a duration like "30m", "24h", or "7d".');
  }
  return {
    amount: Number(match[1]),
    unit: { d: "DAY", h: "HOUR", m: "MINUTE" }[match[2]],
  };
}

function requireColumn(columns, field) {
  const column = columns.get(field);
  if (!column) {
    throw new Error(`${field} is missing from Center Agent performance data.`);
  }
  return column;
}

function quoteSql(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function printHelp() {
  console.log(`Usage:
  pnpm ops:cf:center-agent-performance --since 24h
  pnpm ops:cf:center-agent-performance --trigger-source slack --model openai/gpt-5.4

Options:
  --account-id <id>              Defaults to CLOUDFLARE_ACCOUNT_ID.
  --api-token <token>            Defaults to CLOUDFLARE_API_TOKEN.
  --dataset <name>               Defaults to openmeld_center_agent_performance.
  --since <30m|24h|7d>           Defaults to 24h.
  --limit <1-500>                Defaults to 100.
  --format <json|sql>
  --dry-run
  --milestone <name>
  --trigger-source <source>
  --model <model-id>
  --organization <id>
  --space <id>
  --status <succeeded|failed>
`);
}
