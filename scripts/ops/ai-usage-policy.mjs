#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { readCurrentIsolatedDevLane } from "../dev/dev-isolated-lane.mjs";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const moneyPattern = /^(0|[1-9]\d*)(\.\d{1,9})?$/u;
const organizationPattern = /^[A-Za-z0-9_-]{1,256}$/u;

export function dailyUsdToNanoUsd(value) {
  if (value === "unlimited") {
    return null;
  }
  if (!moneyPattern.test(value)) {
    throw new Error(
      "--daily-usd must be a nonnegative USD amount (up to nine decimal places) or unlimited."
    );
  }
  const [dollars, fraction = ""] = value.split(".");
  const nanoUsd =
    BigInt(dollars) * 1_000_000_000n + BigInt(fraction.padEnd(9, "0"));
  if (nanoUsd > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("The daily allowance exceeds the supported range.");
  }
  return Number(nanoUsd);
}

function main() {
  const args = process.argv.slice(2).filter((value) => value !== "--");
  const { values } = parseArgs({
    args,
    options: {
      org: { type: "string" },
      env: { type: "string", default: "local" },
      "daily-usd": { type: "string" },
      apply: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help) {
    console.log(
      "node scripts/ops/ai-usage-policy.mjs --org <id> [--env local|stg|prod] [--daily-usd 1|unlimited] [--apply]\nWithout --daily-usd, reads the current policy. Changes are previewed unless --apply is supplied. Local targets this worktree's running isolated lane."
    );
    return;
  }
  if (
    !(
      organizationPattern.test(values.org ?? "") &&
      ["local", "stg", "prod"].includes(values.env)
    )
  ) {
    throw new Error("Choose an organization ID and --env local, stg, or prod.");
  }
  const org = values.org;
  const readSql = `SELECT id AS organization_id, (SELECT daily_limit_nano_usd FROM organization_ai_usage_policies WHERE organization_id = organizations.id) AS daily_limit_nano_usd FROM organizations WHERE id = '${org}';`;
  let sql = readSql;
  if (values["daily-usd"] !== undefined) {
    const limit = dailyUsdToNanoUsd(values["daily-usd"]);
    sql = `INSERT INTO organization_ai_usage_policies (organization_id, daily_limit_nano_usd, updated_at_ms) VALUES ('${org}', ${limit === null ? "NULL" : limit}, ${Date.now()}) ON CONFLICT (organization_id) DO UPDATE SET daily_limit_nano_usd = excluded.daily_limit_nano_usd, updated_at_ms = excluded.updated_at_ms; ${readSql}`;
    console.log(
      JSON.stringify({
        environment: values.env,
        organizationId: org,
        dailyLimitNanoUsd: limit,
        apply: values.apply,
      })
    );
    if (!values.apply) {
      return;
    }
  }
  const wranglerArgs = ["exec", "wrangler", "d1", "execute", "OPENMELD_DB"];
  if (values.env === "local") {
    const lane = readCurrentIsolatedDevLane(repoRoot);
    wranglerArgs.push(
      "--config",
      "services/core/.wrangler-isolated.json",
      "--local",
      "--persist-to",
      lane.wranglerStateDirectory
    );
    console.log(`Local policy store: ${lane.wranglerStateDirectory}`);
  } else {
    wranglerArgs.push(
      "--config",
      "services/core/wrangler.jsonc",
      "--remote",
      "--env",
      values.env
    );
  }
  const result = spawnSync(
    "pnpm",
    [...wranglerArgs, "--command", sql, "--json"],
    { cwd: repoRoot, stdio: "inherit" }
  );
  if (result.error) {
    throw result.error;
  }
  process.exitCode = result.status ?? 1;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
