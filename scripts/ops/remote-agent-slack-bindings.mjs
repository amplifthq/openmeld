import { spawnSync } from "node:child_process";

const VALID_ENVIRONMENTS = new Set(["local", "prod"]);

const args = process.argv.slice(2);
const command = args[0];

if (command !== "bind") {
  printUsageAndExit();
}

const slackTeamId = readFlagValue(args, "--team");
const organizationId = readFlagValue(args, "--org");
const environment = readFlagValue(args, "--env") ?? "local";
const dryRun = args.includes("--dry-run");
const hasValidBindingInput =
  isNonEmpty(slackTeamId) &&
  isNonEmpty(organizationId) &&
  VALID_ENVIRONMENTS.has(environment);

if (!hasValidBindingInput) {
  printUsageAndExit();
}

const nowMs = Date.now();
const sql = [
  "INSERT INTO openMeldRemoteAgent_slack_workspace_bindings (",
  "slack_team_id, organization_id, created_at_ms, updated_at_ms",
  ") VALUES (",
  `${quoteSql(slackTeamId)}, ${quoteSql(organizationId)}, ${nowMs}, ${nowMs}`,
  ") ON CONFLICT(slack_team_id) DO UPDATE SET ",
  "organization_id = excluded.organization_id, ",
  "updated_at_ms = excluded.updated_at_ms;",
].join("");

if (dryRun) {
  console.log(sql);
  process.exit(0);
}

const wranglerArgs = [
  "-C",
  "services/core",
  "exec",
  "wrangler",
  "d1",
  "execute",
  "openmeld-db",
  "--config",
  "wrangler.jsonc",
  "--command",
  sql,
];

if (environment === "prod") {
  wranglerArgs.splice(7, 0, "--env", "prod", "--remote");
} else {
  wranglerArgs.splice(7, 0, "--local");
}

const result = spawnSync("pnpm", wranglerArgs, {
  env: process.env,
  stdio: "inherit",
});
process.exit(result.status ?? 1);

function readFlagValue(argv, flagName) {
  const flagIndex = argv.indexOf(flagName);
  return flagIndex >= 0 ? argv[flagIndex + 1] : null;
}

function isNonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function quoteSql(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function printUsageAndExit() {
  console.error(
    [
      "Usage:",
      "pnpm ops:remote-agent-slack bind --team <slack_team_id> --org <organization_id> [--env local|prod] [--dry-run]",
    ].join(" ")
  );
  process.exit(1);
}
