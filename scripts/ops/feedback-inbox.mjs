#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const LOCAL_D1_PERSIST_PATH = "../../.wrangler-dev-state";
const MAX_ORGANIZATION_ID_LENGTH = 256;
const MAX_LABEL_LENGTH = 200;

class FeedbackInboxUsageError extends Error {}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    runFeedbackInboxCli(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error("Run `pnpm ops:feedback-inbox -- --help` for usage.");
    process.exit(1);
  }
}

export function parseFeedbackInboxArgs(rawArgs) {
  const args = [...rawArgs];
  if (args[0] === "--") {
    args.shift();
  }
  if (args.includes("--help") || args.includes("-h")) {
    return { help: true };
  }
  if (args.shift() !== "ensure") {
    throw new FeedbackInboxUsageError(
      "Feedback Inbox command must be `ensure`."
    );
  }

  const parsed = {
    action: "ensure",
    confirmProduction: false,
    dryRun: false,
    environment: "local",
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--confirm-production") {
      parsed.confirmProduction = true;
      continue;
    }
    if (arg === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new FeedbackInboxUsageError(`Missing value for ${arg}.`);
    }
    switch (arg) {
      case "--env":
        parsed.environment = value;
        break;
      case "--label":
        parsed.label = value.trim();
        break;
      case "--organization":
        parsed.organizationId = value.trim();
        break;
      default:
        throw new FeedbackInboxUsageError(`Unknown option "${arg}".`);
    }
    index += 1;
  }

  validateFeedbackInboxArgs(parsed);
  return parsed;
}

export function generateFeedbackInboxIdentity() {
  return {
    inboxId: `feedback_inbox_${randomUUID()}`,
    inboxKey: `feedback_key_${randomBytes(32).toString("base64url")}`,
  };
}

export function buildFeedbackInboxEnsureSql(input) {
  const organizationId = quoteSql(input.organizationId);
  return [
    "INSERT INTO openMeldFeedback_inboxes (",
    "  inbox_id, organization_id, label, inbox_key, delivery_mode, status, created_at_ms, updated_at_ms",
    ")",
    "SELECT",
    `  ${quoteSql(input.inboxId)},`,
    `  ${organizationId},`,
    `  ${quoteSql(input.label)},`,
    `  ${quoteSql(input.inboxKey)},`,
    "  'inbox_only',",
    "  'active',",
    `  ${input.createdAtMs},`,
    `  ${input.createdAtMs}`,
    "FROM organizations",
    `WHERE id = ${organizationId}`,
    "  AND NOT EXISTS (",
    "    SELECT 1",
    "    FROM openMeldFeedback_inboxes",
    `    WHERE organization_id = ${organizationId}`,
    "  );",
    "SELECT",
    "  organizations.id AS organizationId,",
    "  openMeldFeedback_inboxes.inbox_id AS inboxId,",
    "  openMeldFeedback_inboxes.inbox_key AS inboxKey",
    "FROM organizations",
    "JOIN openMeldFeedback_inboxes",
    "  ON openMeldFeedback_inboxes.organization_id = organizations.id",
    `WHERE organizations.id = ${organizationId}`,
    "ORDER BY openMeldFeedback_inboxes.created_at_ms ASC, openMeldFeedback_inboxes.inbox_id ASC",
    "LIMIT 1;",
  ].join("\n");
}

export function buildFeedbackInboxWranglerInvocation(input) {
  const args = [
    "-C",
    "services/core",
    "exec",
    "wrangler",
    "d1",
    "execute",
    "openmeld-db",
    "--config",
    "wrangler.jsonc",
  ];
  if (input.environment === "prod") {
    args.push("--env", "prod", "--remote");
  } else {
    args.push("--local", "--persist-to", LOCAL_D1_PERSIST_PATH);
  }
  args.push("--json", "--command", input.sql);
  return { args, command: "pnpm" };
}

export function extractFeedbackInboxResult(stdout) {
  let payload;
  try {
    payload = JSON.parse(stdout);
  } catch {
    throw new Error(
      "Wrangler returned invalid JSON for Feedback Inbox ensure."
    );
  }
  if (!Array.isArray(payload)) {
    throw new Error("Wrangler returned an invalid Feedback Inbox result.");
  }

  for (const statement of payload) {
    if (!(statement?.success && Array.isArray(statement.results))) {
      continue;
    }
    for (const row of statement.results) {
      if (
        typeof row?.inboxId === "string" &&
        row.inboxId.length > 0 &&
        typeof row.inboxKey === "string" &&
        row.inboxKey.length > 0
      ) {
        return { inboxId: row.inboxId, inboxKey: row.inboxKey };
      }
    }
  }

  throw new Error(
    "Feedback Inbox was not created because the organization was not found."
  );
}

function runFeedbackInboxCli(rawArgs) {
  const parsed = parseFeedbackInboxArgs(rawArgs);
  if (parsed.help) {
    printFeedbackInboxUsage();
    return;
  }

  const identity = generateFeedbackInboxIdentity();
  const sql = buildFeedbackInboxEnsureSql({
    ...identity,
    createdAtMs: Date.now(),
    label: parsed.label,
    organizationId: parsed.organizationId,
  });
  const invocation = buildFeedbackInboxWranglerInvocation({
    environment: parsed.environment,
    sql,
  });
  if (parsed.dryRun) {
    console.log(
      JSON.stringify(
        {
          dryRun: true,
          environment: parsed.environment,
          organizationId: parsed.organizationId,
          ...identity,
          invocation,
        },
        null,
        2
      )
    );
    return;
  }

  const result = spawnSync(invocation.command, invocation.args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: process.env,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim();
    throw new Error(
      `Feedback Inbox ensure failed${detail ? `: ${detail}` : "."}`
    );
  }

  console.log(
    JSON.stringify(extractFeedbackInboxResult(result.stdout), null, 2)
  );
}

function validateFeedbackInboxArgs(parsed) {
  if (parsed.environment !== "local" && parsed.environment !== "prod") {
    throw new FeedbackInboxUsageError("--env must be local or prod.");
  }
  if (
    typeof parsed.organizationId !== "string" ||
    parsed.organizationId.length === 0 ||
    parsed.organizationId.length > MAX_ORGANIZATION_ID_LENGTH
  ) {
    throw new FeedbackInboxUsageError(
      `--organization must be 1..${MAX_ORGANIZATION_ID_LENGTH} characters.`
    );
  }
  if (
    typeof parsed.label !== "string" ||
    parsed.label.length === 0 ||
    parsed.label.length > MAX_LABEL_LENGTH
  ) {
    throw new FeedbackInboxUsageError(
      `--label must be 1..${MAX_LABEL_LENGTH} characters.`
    );
  }
  if (parsed.environment === "prod" && !parsed.confirmProduction) {
    throw new FeedbackInboxUsageError(
      "Production Feedback Inbox changes require --confirm-production."
    );
  }
}

function quoteSql(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function printFeedbackInboxUsage() {
  console.log(
    [
      "Usage:",
      "  pnpm ops:feedback-inbox -- ensure --organization <organizationId> --label <label> [--env local|prod] [--confirm-production] [--dry-run]",
      "",
      "The default environment is local and uses .wrangler-dev-state.",
      "Production requires --env prod --confirm-production.",
    ].join("\n")
  );
}
