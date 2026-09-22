import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  productionCoreActivationSchema,
  productionWorkerDeploymentContextSchema,
  productionWorkerDeploymentIdentitySchema,
} from "../../packages/schemas/src/schemas/release/production-release-evidence.ts";

const LINES = /\r?\n/u;
const CONTEXT = "OPENMELD_RELEASE_RECEIPT_CONTEXT";
const MAX_PLATFORM_CLOCK_SKEW_MS = 5 * 60 * 1000;

export function assertCoreDeploymentContext(input) {
  const context = productionWorkerDeploymentContextSchema.parse(
    JSON.parse(input.env?.[CONTEXT] ?? "null")
  );
  if (
    context.sourceSha !== input.sourceSha ||
    context.projectionTag !== input.projectionTag ||
    context.workerName !== input.workerName ||
    !input.env?.WRANGLER_OUTPUT_FILE_PATH
  ) {
    throw new Error(
      "Core deployment requires its exact guarded receipt context."
    );
  }
  return context;
}

// The Core admission owner already returns the exact uploaded version, including
// its atomic-migration branch. Forward that fact at the DEPLOY boundary without
// changing admission, profiling, bundling or the projection selected by that owner.
export function recordCoreDeploymentOutput(input) {
  if (!input.env?.[CONTEXT]) {
    return;
  }
  const context = productionWorkerDeploymentContextSchema.parse(
    JSON.parse(input.env[CONTEXT])
  );
  if (
    context.sourceSha !== input.sourceSha ||
    context.projectionTag !== input.projectionTag ||
    context.workerName !== input.evidence.workerName ||
    input.evidence.releaseSha !== input.sourceSha
  ) {
    throw new Error(
      "Core deployment output conflicts with its guarded source or projection."
    );
  }
  appendFileSync(
    input.env.WRANGLER_OUTPUT_FILE_PATH,
    `${JSON.stringify(
      productionCoreActivationSchema.parse({
        type: "openmeld-core-activation",
        version: 1,
        timestamp: new Date().toISOString(),
        worker_name: input.evidence.workerName,
        version_id: input.evidence.versionId,
        source_sha: input.sourceSha,
        projection_tag: input.projectionTag,
        operation_key: context.operationKey,
      })
    )}\n`
  );
}

export function createWorkerDeploymentCapture(input) {
  const context = productionWorkerDeploymentContextSchema.parse({
    sourceSha: input.sourceSha,
    operationKey: input.operationKey,
    workerName: input.target.workerName,
    projectionTag: input.target.projectionTag,
  });
  const directory = mkdtempSync(
    path.join(tmpdir(), "openmeld-deploy-receipt-")
  );
  const file = path.join(directory, "wrangler.jsonl");
  const startedAt = Date.now();
  let deploymentBaseline;
  const env = {
    ...(input.env ?? process.env),
    WRANGLER_OUTPUT_FILE_PATH: file,
    [CONTEXT]: JSON.stringify(context),
  };
  // A per-invocation file is never reused. Ambient paths cannot substitute old output.
  env.WRANGLER_OUTPUT_FILE_DIRECTORY = undefined;
  return {
    env,
    recordDeploymentBaseline(result) {
      if (deploymentBaseline) {
        throw new Error(
          "Worker deployment baseline was recorded more than once."
        );
      }
      deploymentBaseline = parseWorkerDeployments(
        result,
        "Worker deployment baseline could not be read; no deployment is allowed."
      );
    },
    read(publication) {
      if (publication) {
        return readCliProjection(publication, input);
      }
      let events;
      try {
        events = readFileSync(file, "utf8")
          .split(LINES)
          .filter(Boolean)
          .map((line) => JSON.parse(line));
      } catch (error) {
        throw new Error(
          "Missing or malformed structured Worker deployment output; application remains unverified.",
          { cause: error }
        );
      }
      const matches = events.filter(
        (event) =>
          event.type ===
          (input.target.projectionTag ? "openmeld-core-activation" : "deploy")
      );
      if (matches.length !== 1) {
        throw new Error(
          "Expected exactly one correlated Worker deployment output event."
        );
      }
      const event = matches[0];
      if (event.type === "openmeld-core-activation") {
        productionCoreActivationSchema.parse(event);
      }
      const time = Date.parse(event.timestamp);
      if (
        event.version !== 1 ||
        event.worker_name !== input.target.workerName ||
        !event.version_id ||
        !Number.isFinite(time) ||
        time < startedAt ||
        time > Date.now() ||
        (event.type === "deploy" &&
          (event.wrangler_environment ?? null) !==
            input.target.outputEnvironment) ||
        (event.type === "openmeld-core-activation" &&
          (event.source_sha !== input.sourceSha ||
            event.operation_key !== input.operationKey ||
            event.projection_tag !== input.target.projectionTag))
      ) {
        throw new Error(
          "Worker output does not match this command's source, target, projection or execution window."
        );
      }
      if (!deploymentBaseline) {
        throw new Error(
          "Worker deployment output has no pre-deploy platform baseline."
        );
      }
      return {
        versionId: event.version_id,
        proof: "command-output",
        deploymentBaseline,
        deploymentWindow: { startedAt, completedAt: time },
      };
    },
    close() {
      rmSync(directory, { force: true, recursive: true });
    },
  };
}

export function readCliProjection(result, input) {
  if (
    result.sourceSha !== input.sourceSha ||
    result.alignment?.action !== "SKIP" ||
    result.core?.criterion !== "active-worker-version-tag" ||
    result.core.targetTag !== input.target.projectionTag ||
    !result.core.versionId ||
    !result.core.deploymentId
  ) {
    throw new Error(
      "CLI completion does not prove the exact source and Core projection."
    );
  }
  return {
    versionId: result.core.versionId,
    deploymentId: result.core.deploymentId,
    proof: "cli-projection",
  };
}

export async function resolveReceiptWorkerTarget(input) {
  const sourceArgs =
    input.group.steps[0].workerDeploymentArgs ?? input.group.workerArguments;
  const configFile = sourceArgs[sourceArgs.indexOf("--config") + 1];
  if (!configFile || sourceArgs.indexOf("--config") < 0) {
    throw new Error(
      "Worker receipt target requires its existing configuration."
    );
  }
  const { unstable_readConfig } = await import("wrangler");
  const config = unstable_readConfig({
    config: path.resolve(input.cwd ?? process.cwd(), configFile),
    env: "prod",
  });
  let projectionTag;
  if (input.group.scope === "cli" || input.group.scope === "core") {
    const currentProjection = input.group.steps[0].args?.includes(
      "scripts/release/deploy-core-current-cli-projection.mjs"
    );
    if (currentProjection) {
      const { readCurrentCliProjectionTarget } = await import(
        "./deploy-core-current-cli-projection.mjs"
      );
      projectionTag = (await readCurrentCliProjectionTarget({ cwd: input.cwd }))
        .expectedCoreTag;
    } else {
      const { resolveCoreProjectionTag } = await import(
        "./release-cli-resume.mjs"
      );
      projectionTag = resolveCoreProjectionTag({ cwd: input.cwd });
    }
  }
  return {
    workerName: config.name,
    environment: "prod",
    args: input.group.workerArguments,
    outputEnvironment: input.group.scope === "remote-agent" ? null : "prod",
    ...(projectionTag ? { projectionTag } : {}),
  };
}

export async function verifyWorkerDeployment(input) {
  const { target, expected } = input;
  const result = await input.runCommand({
    command: "pnpm",
    cwd: input.cwd,
    env: input.env ?? process.env,
    args: [
      "exec",
      "wrangler",
      "deployments",
      "list",
      ...target.args,
      "--name",
      target.workerName,
      "--json",
    ],
  });
  const deployments = parseWorkerDeployments(
    result,
    "Worker activation could not be read; no verified receipt is allowed."
  );
  const sorted = deployments.toSorted(
    (a, b) => Date.parse(b.created_on) - Date.parse(a.created_on)
  );
  const active = sorted[0];
  let correlatedDeploymentId = expected.deploymentId;
  if (!correlatedDeploymentId) {
    const baseline = expected.deploymentBaseline;
    if (!baseline) {
      throw new Error(
        "Worker deployment identity has neither an exact deployment ID nor a pre-deploy baseline."
      );
    }
    const previousIds = new Set(baseline.map((deployment) => deployment.id));
    const newlyObserved = sorted.filter(
      (deployment) => !previousIds.has(deployment.id)
    );
    const latestPreviousTime = baseline.reduce(
      (latest, deployment) =>
        Math.max(latest, Date.parse(deployment.created_on)),
      Number.NEGATIVE_INFINITY
    );
    const deploymentTime = Date.parse(newlyObserved[0]?.created_on);
    const window = expected.deploymentWindow;
    if (
      newlyObserved.length !== 1 ||
      newlyObserved[0].id !== active?.id ||
      deploymentTime <= latestPreviousTime ||
      !Number.isFinite(window?.startedAt) ||
      !Number.isFinite(window?.completedAt) ||
      deploymentTime < window.startedAt - MAX_PLATFORM_CLOCK_SKEW_MS ||
      deploymentTime > window.completedAt + MAX_PLATFORM_CLOCK_SKEW_MS
    ) {
      throw new Error(
        "Worker deployment cannot be uniquely correlated with this guarded command; reconcile instead of guessing a deployment ID."
      );
    }
    correlatedDeploymentId = newlyObserved[0].id;
  }
  if (
    !active?.id ||
    (sorted[1] &&
      sorted[1].created_on === active.created_on &&
      sorted[1].id !== active.id) ||
    active.id !== correlatedDeploymentId ||
    active.versions?.length !== 1 ||
    active.versions[0].version_id !== expected.versionId ||
    active.versions[0].percentage !== 100
  ) {
    throw new Error(
      "Active Worker deployment does not match the exact guarded deployment/version; reconcile instead of redeploying."
    );
  }
  return productionWorkerDeploymentIdentitySchema.parse({
    kind: "worker-deployment",
    workerName: target.workerName,
    environment: "prod",
    deploymentId: active.id,
    versionId: expected.versionId,
    sourceSha: input.sourceSha,
    ...(target.projectionTag ? { projectionTag: target.projectionTag } : {}),
    proof: expected.proof,
  });
}

function parseWorkerDeployments(result, failureMessage) {
  if (result?.status !== 0) {
    throw new Error(failureMessage);
  }
  let deployments;
  try {
    deployments = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(failureMessage, { cause: error });
  }
  const ids = new Set();
  if (
    !Array.isArray(deployments) ||
    deployments.some((deployment) => {
      if (
        typeof deployment?.id !== "string" ||
        !deployment.id ||
        !Number.isFinite(Date.parse(deployment.created_on)) ||
        ids.has(deployment.id)
      ) {
        return true;
      }
      ids.add(deployment.id);
      return false;
    })
  ) {
    throw new Error(failureMessage);
  }
  return deployments;
}
