#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { readRuntimeEvidenceAnalyticsContract } from "./runtime-evidence-contract.mjs";

const DEFAULT_DATASET = "openmeld_runtime_evidence";
const DEFAULT_SINCE = "24h";
const DEFAULT_LIMIT = 50;
const AGGREGATE_MODES = new Set(["timing"]);
const OUTPUT_FORMATS = new Set(["json", "sql"]);
const SINCE_INTERVAL_RE = /^([1-9][0-9]*)(m|h|d)$/u;
const TABLE_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/u;

const VALUE_OPTIONS = new Map([
  ["account-id", "accountId"],
  ["aggregate", "aggregate"],
  ["api-token", "apiToken"],
  ["openmeld-service-runtime-id", "openMeldServiceRuntimeId"],
  ["binding", "binding"],
  ["agent-controller", "agentControllerRef"],
  ["claim-lease", "claimLeaseId"],
  ["client-message", "clientMessageId"],
  ["dataset", "dataset"],
  ["dispatch", "dispatchId"],
  ["event", "event"],
  ["format", "format"],
  ["latest-attempt", "latestAttemptId"],
  ["limit", "limit"],
  ["published-signal", "publishedSignalId"],
  ["reason-code", "reasonCode"],
  ["reply-signal", "replySignalId"],
  ["request", "requestId"],
  ["result-ref", "resultRef"],
  ["runtime-coordinator", "runtimeCoordinatorExecutionId"],
  ["search", "search"],
  ["since", "since"],
  ["source-signal", "sourceSignalId"],
  ["space", "spaceId"],
  ["status", "status"],
  ["target-profile", "targetProfileId"],
  ["worker", "workerName"],
]);

const FILTER_FIELD_BY_OPTION = new Map([
  ["binding", "bindingId"],
  ["agentControllerRef", "agentControllerRef"],
  ["claimLeaseId", "claimLeaseId"],
  ["clientMessageId", "clientMessageId"],
  ["dispatchId", "dispatchId"],
  ["event", "event"],
  ["latestAttemptId", "latestAttemptId"],
  ["publishedSignalId", "publishedSignalId"],
  ["reasonCode", "reasonCode"],
  ["replySignalId", "replySignalId"],
  ["requestId", "requestId"],
  ["resultRef", "resultRef"],
  ["openMeldServiceRuntimeId", "openMeldServiceRuntimeId"],
  ["runtimeCoordinatorExecutionId", "runtimeCoordinatorExecutionId"],
  ["sourceSignalId", "sourceSignalId"],
  ["spaceId", "spaceId"],
  ["status", "status"],
  ["targetProfileId", "targetProfileId"],
  ["workerName", "workerName"],
]);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    console.error("Run `pnpm ops:cf:query --help` for usage.");
    process.exit(1);
  });
}

export function parseQueryRuntimeEvidenceArgs(rawArgs) {
  const parsed = {
    dataset: DEFAULT_DATASET,
    format: "json",
    limit: DEFAULT_LIMIT,
    since: DEFAULT_SINCE,
  };

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
    const outputKey = VALUE_OPTIONS.get(option.key);
    if (!outputKey) {
      throw new Error(`Unknown option "${arg}".`);
    }
    parsed[outputKey] = option.value;
  }

  parsed.limit = parseLimit(parsed.limit);
  validateAggregateMode(parsed.aggregate);
  validateFormat(parsed.format);
  validateDataset(parsed.dataset);
  parsed.sinceInterval = parseSinceInterval(parsed.since);
  return parsed;
}

export function buildAnalyticsEngineSql(input) {
  const contract =
    input.contract ?? readRuntimeEvidenceAnalyticsContract(input);
  const filters = buildRuntimeEvidenceFilters({
    contract,
    parsed: input.parsed,
  });
  const where = [
    `timestamp >= NOW() - INTERVAL '${String(
      input.parsed.sinceInterval.amount
    )}' ${input.parsed.sinceInterval.unit}`,
    ...filters.map((filter) => `${filter.column} = ${quoteSql(filter.value)}`),
  ];
  if (input.parsed.search) {
    where.push(buildSearchPredicate(contract, input.parsed.search));
  }

  if (input.parsed.aggregate === "timing") {
    return buildTimingAggregateSql({
      dataset: input.parsed.dataset,
      durationColumn: requireDoubleColumn(contract, "durationMs"),
      limit: input.parsed.limit,
      reasonCodeColumn: requireBlobColumn(contract, "reasonCode"),
      where,
    });
  }

  return [
    "SELECT",
    `  ${buildSelectedColumns(contract).join(",\n  ")}`,
    `FROM ${input.parsed.dataset}`,
    `WHERE ${where.join("\n  AND ")}`,
    "ORDER BY timestamp DESC",
    `LIMIT ${String(input.parsed.limit)}`,
    "FORMAT JSONEachRow",
  ].join("\n");
}

function buildTimingAggregateSql(input) {
  return [
    "SELECT",
    `  ${input.reasonCodeColumn} AS reasonCode,`,
    "  count() AS rowCount,",
    "  sum(_sample_interval) AS estimatedRowCount,",
    "  min(_sample_interval) AS minSampleInterval,",
    "  max(_sample_interval) AS maxSampleInterval,",
    `  min(${input.durationColumn}) AS minDurationMs,`,
    `  sum(${input.durationColumn} * _sample_interval) / sum(_sample_interval) AS avgDurationMs,`,
    `  quantileExactWeighted(0.50)(${input.durationColumn}, _sample_interval) AS p50DurationMs,`,
    `  quantileExactWeighted(0.95)(${input.durationColumn}, _sample_interval) AS p95DurationMs,`,
    `  quantileExactWeighted(0.99)(${input.durationColumn}, _sample_interval) AS p99DurationMs,`,
    `  max(${input.durationColumn}) AS maxDurationMs`,
    `FROM ${input.dataset}`,
    `WHERE ${input.where.join("\n  AND ")}`,
    "GROUP BY reasonCode",
    "ORDER BY avgDurationMs DESC",
    `LIMIT ${String(input.limit)}`,
    "FORMAT JSONEachRow",
  ].join("\n");
}

export function buildAnalyticsEngineRequest(input) {
  const accountId = input.accountId?.trim();
  const apiToken = input.apiToken?.trim();
  if (!accountId) {
    throw new Error(
      "Missing Cloudflare account id. Pass --account-id or set CLOUDFLARE_ACCOUNT_ID."
    );
  }
  if (!apiToken) {
    throw new Error(
      "Missing Cloudflare API token. Pass --api-token or set CLOUDFLARE_API_TOKEN."
    );
  }
  return {
    body: input.sql,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "text/plain",
    },
    method: "POST",
    url: `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(
      accountId
    )}/analytics_engine/sql`,
  };
}

export function buildRuntimeEvidenceFilters(input) {
  const filters = [];
  for (const [optionKey, field] of FILTER_FIELD_BY_OPTION) {
    const value = input.parsed[optionKey];
    if (!value) {
      continue;
    }
    const column = input.contract.blobColumns.get(field);
    if (!column) {
      throw new Error(
        `${field} is not projected into the Analytics Engine runtime evidence table.`
      );
    }
    filters.push({ column, field, value });
  }

  return filters;
}

function requireBlobColumn(contract, field) {
  const column = contract.blobColumns.get(field);
  if (!column) {
    throw new Error(
      `${field} is not projected into the Analytics Engine runtime evidence table.`
    );
  }
  return column;
}

function requireDoubleColumn(contract, field) {
  const column = contract.doubleColumns.get(field);
  if (!column) {
    throw new Error(
      `${field} is not projected into the Analytics Engine runtime evidence table.`
    );
  }
  return column;
}

function buildSelectedColumns(contract) {
  return [
    "timestamp",
    "index1 AS analyticsIndex",
    "_sample_interval AS sampleInterval",
    ...contract.blobs.map(
      (field, index) => `blob${String(index + 1)} AS ${field}`
    ),
    ...contract.doubles.map(
      (field, index) => `double${String(index + 1)} AS ${field}`
    ),
  ];
}

function buildSearchPredicate(contract, value) {
  const quoted = quoteSql(`%${value}%`);
  const columns = [
    ...contract.blobs.map((_field, index) => `blob${String(index + 1)}`),
    "index1",
  ];
  return `(${columns.map((column) => `${column} LIKE ${quoted}`).join(" OR ")})`;
}

async function runCli(rawArgs) {
  const parsed = parseQueryRuntimeEvidenceArgs(rawArgs);
  if (parsed.help) {
    printHelp();
    return;
  }
  const sql = buildAnalyticsEngineSql({ parsed });
  if (parsed.dryRun || parsed.format === "sql") {
    console.log(sql);
    return;
  }

  const request = buildAnalyticsEngineRequest({
    accountId: parsed.accountId ?? process.env.CLOUDFLARE_ACCOUNT_ID,
    apiToken: parsed.apiToken ?? process.env.CLOUDFLARE_API_TOKEN,
    sql,
  });
  const response = await fetch(request.url, {
    body: request.body,
    headers: request.headers,
    method: request.method,
  });
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
  return {
    key: arg.slice(2),
    nextIndex: index + 1,
    value,
  };
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
  const unit = {
    d: "DAY",
    h: "HOUR",
    m: "MINUTE",
  }[match[2]];
  return {
    amount: Number(match[1]),
    unit,
  };
}

function validateDataset(value) {
  if (!TABLE_NAME_RE.test(value)) {
    throw new Error("--dataset must be a simple Analytics Engine table name.");
  }
}

function validateAggregateMode(value) {
  if (value === undefined) {
    return;
  }
  if (!AGGREGATE_MODES.has(value)) {
    throw new Error('Invalid --aggregate. Expected "timing".');
  }
}

function validateFormat(value) {
  if (!OUTPUT_FORMATS.has(value)) {
    throw new Error('Invalid --format. Expected "json" or "sql".');
  }
}

function quoteSql(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function printHelp() {
  console.log(`Usage:
  pnpm ops:cf:query --client-message cm_123
  pnpm ops:cf:query --dispatch dispatch_123 --since 6h
  pnpm ops:cf:query --runtime-coordinator rce_123 --format sql

Options:
  --account-id <id>                Cloudflare account id. Defaults to CLOUDFLARE_ACCOUNT_ID.
  --api-token <token>              Cloudflare API token. Defaults to CLOUDFLARE_API_TOKEN.
  --dataset <name>                 Analytics Engine dataset. Defaults to openmeld_runtime_evidence.
  --since <30m|24h|7d>             Query time window. Defaults to 24h.
  --limit <1-500>                  Maximum rows. Defaults to 50.
  --format <json|sql>              Output JSONEachRow response or SQL. Defaults to json.
  --dry-run                        Print SQL and do not call Cloudflare.
  --aggregate <timing>             Aggregate timing rows by reasonCode instead of listing raw evidence.
  --worker <openmeld-web|openmeld-gateway|openmeld-core|openmeld-auth|openmeld-remote-agent>
  --event <name>
  --status <started|succeeded|failed>
  --reason-code <code>
  --space <id>
  --client-message <id>
  --source-signal <id>
  --target-profile <id>
  --dispatch <id>
  --runtime-coordinator <id>
  --latest-attempt <id>
  --claim-lease <id>
  --binding <id>
  --openmeld-service-runtime-id <id>
  --agent-controller <ref>
  --result-ref <ref>
  --published-signal <id>
  --reply-signal <id>
  --request <id>
  --search <text>                  Bounded text search across Analytics Engine blobs.
`);
}
