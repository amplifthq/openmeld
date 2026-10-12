import { execFileSync, spawnSync } from "node:child_process";
import { productionWorkerDeploymentContextSchema } from "../../../packages/schemas/src/schemas/release/production-release-evidence.ts";

const args = process.argv.slice(2).filter((arg) => arg !== "--");
if (
  args.length > 1 ||
  (args.length === 1 && args[0] !== "--containers-rollout=none")
) {
  throw new Error(
    "Remote Agent deployment only accepts --containers-rollout=none."
  );
}
if (args.length) {
  const context = productionWorkerDeploymentContextSchema.parse(
    JSON.parse(process.env.OPENMELD_RELEASE_RECEIPT_CONTEXT ?? "null")
  );
  const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  if (
    context.workerName !== "openmeld-remote-agent-prod" ||
    context.sourceSha !== sourceSha ||
    !process.env.WRANGLER_OUTPUT_FILE_PATH
  ) {
    throw new Error(
      "Retaining Containers requires the exact protected production release receipt context."
    );
  }
}

function run(commandArgs) {
  const result = spawnSync("pnpm", commandArgs, { stdio: "inherit" });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

// This is the package build/deploy implementation. The production release
// owner supplies admission, leases and receipts before invoking it.
run([
  "exec",
  "dotenv",
  "-e",
  "../../.env",
  "-o",
  "--",
  "sh",
  "-c",
  'pnpm run build && pnpm run build:prod-config && wrangler deploy --config dist/openmeld_remote_agent/wrangler.prod.json "$@"',
  "remote-agent-deploy",
  ...args,
]);
