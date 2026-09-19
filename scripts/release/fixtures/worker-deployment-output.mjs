import { appendFileSync } from "node:fs";

// Payload fields follow Wrangler 4.130.0 deploy output and Cloudflare deployment
// responses. Only process/HTTP boundaries are replaced, never the receipt logic.
export const FIXTURE_VERSION = "23863082-db0f-4cfe-a91b-69c570ee1578";
export const FIXTURE_DEPLOYMENT = "00000000-0000-4000-8000-000000000123";
export const FIXTURE_PROJECTION = "fixture-exact-source-and-manifest";
const WORKERS = {
  web: "openmeld-web-prod",
  auth: "openmeld-auth-prod",
  gateway: "openmeld-gateway-prod",
  core: "openmeld-core-prod",
  cli: "openmeld-core-prod",
  "remote-agent": "openmeld-remote-agent-prod",
};

export function fixtureWorkerTarget({ group }) {
  return {
    workerName: WORKERS[group.scope],
    environment: "prod",
    args: group.workerArguments,
    outputEnvironment: group.scope === "remote-agent" ? null : "prod",
    ...(["cli", "core"].includes(group.scope)
      ? { projectionTag: FIXTURE_PROJECTION }
      : {}),
  };
}

export function writeDeploymentOutput(step, sourceSha, options = {}) {
  if (!step.workerDeploymentArgs || options.omitOutput) {
    return;
  }
  const context = JSON.parse(step.env.OPENMELD_RELEASE_RECEIPT_CONTEXT);
  const event = {
    type: step.releaseScope === "core" ? "openmeld-core-activation" : "deploy",
    version: 1,
    timestamp: new Date().toISOString(),
    worker_name: WORKERS[step.releaseScope],
    worker_tag: "fixture-worker-tag",
    version_id: FIXTURE_VERSION,
    wrangler_environment:
      step.releaseScope === "remote-agent" ? undefined : "prod",
    source_sha: sourceSha,
    projection_tag: FIXTURE_PROJECTION,
    operation_key: context.operationKey,
    ...options.event,
  };
  if (step.releaseScope === "core") {
    event.worker_tag = undefined;
    event.wrangler_environment = undefined;
  }
  appendFileSync(
    step.env.WRANGLER_OUTPUT_FILE_PATH,
    `${JSON.stringify(event)}\n`
  );
}

export function workerDeploymentResponse(options = {}) {
  return {
    status: 0,
    stdout: JSON.stringify(
      options.deployments ?? [
        {
          id: options.deploymentId ?? FIXTURE_DEPLOYMENT,
          created_on: options.createdOn ?? new Date().toISOString(),
          versions: [
            {
              version_id: options.versionId ?? FIXTURE_VERSION,
              percentage: options.percentage ?? 100,
            },
          ],
        },
      ]
    ),
  };
}

export function cliProjectionResult(sourceSha) {
  return {
    sourceSha,
    alignment: { action: "SKIP" },
    core: {
      criterion: "active-worker-version-tag",
      targetTag: FIXTURE_PROJECTION,
      versionId: FIXTURE_VERSION,
      deploymentId: FIXTURE_DEPLOYMENT,
    },
  };
}
