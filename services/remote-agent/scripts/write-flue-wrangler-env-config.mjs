import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseJsoncObject } from "../../../packages/db/src/tooling/parse-jsonc.ts";

const scriptPath = fileURLToPath(import.meta.url);

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  await writeEnvironmentConfig(process.argv[2]);
}

export function buildEnvironmentConfig(input) {
  const { environmentConfig, generatedConfig } = input;
  const outputConfig = {
    ...generatedConfig,
    analytics_engine_datasets:
      environmentConfig.analytics_engine_datasets ??
      generatedConfig.analytics_engine_datasets,
    ai: environmentConfig.ai ?? generatedConfig.ai,
    browser: environmentConfig.browser ?? generatedConfig.browser,
    containers: mergeContainerConfiguration(
      generatedConfig.containers,
      environmentConfig.containers
    ),
    durable_objects: mergeDurableObjectBindings(
      generatedConfig.durable_objects,
      environmentConfig.durable_objects
    ),
    name:
      typeof environmentConfig.name === "string"
        ? environmentConfig.name
        : `${generatedConfig.name}-${input.environmentName ?? "environment"}`,
    observability:
      environmentConfig.observability ?? generatedConfig.observability,
    r2_buckets: environmentConfig.r2_buckets ?? generatedConfig.r2_buckets,
    secrets: environmentConfig.secrets ?? generatedConfig.secrets,
    services: environmentConfig.services ?? generatedConfig.services,
    worker_loaders:
      environmentConfig.worker_loaders ?? generatedConfig.worker_loaders,
    vars: {
      ...(generatedConfig.vars ?? {}),
      ...(environmentConfig.vars ?? {}),
    },
  };

  outputConfig.definedEnvironments = undefined;
  outputConfig.env = undefined;
  return outputConfig;
}

async function writeEnvironmentConfig(environmentName) {
  if (!environmentName) {
    throw new Error(
      "Usage: node scripts/write-flue-wrangler-env-config.mjs <env>"
    );
  }

  const sourceConfigUrl = new URL("../wrangler.jsonc", import.meta.url);
  const generatedConfigUrl = new URL(
    "../dist/openmeld_remote_agent/wrangler.json",
    import.meta.url
  );
  const outputConfigUrl = new URL(
    `../dist/openmeld_remote_agent/wrangler.${environmentName}.json`,
    import.meta.url
  );

  const sourceConfig = parseJsoncObject(
    await readFile(sourceConfigUrl, "utf8")
  );
  const generatedConfig = JSON.parse(
    await readFile(generatedConfigUrl, "utf8")
  );
  const environmentConfig = sourceConfig.env?.[environmentName];
  if (!environmentConfig || typeof environmentConfig !== "object") {
    throw new Error(
      `Missing env.${environmentName} in services/remote-agent/wrangler.jsonc.`
    );
  }

  const outputConfig = buildEnvironmentConfig({
    environmentConfig,
    environmentName,
    generatedConfig,
  });
  await writeFile(
    outputConfigUrl,
    `${JSON.stringify(outputConfig, null, 2)}\n`,
    "utf8"
  );
  console.log(`Wrote ${outputConfigUrl.pathname}`);
}

function mergeContainerConfiguration(generated = [], environment = []) {
  if (environment.length === 0) {
    return generated;
  }
  return environment.map((container) => {
    const generatedContainer = generated.find(
      (candidate) => candidate.class_name === container.class_name
    );
    return {
      ...container,
      // Flue resolves local Dockerfile paths to absolute paths. Keep that
      // normalized path while selecting the environment-specific container.
      image: generatedContainer?.image ?? container.image,
    };
  });
}

function mergeDurableObjectBindings(generated, environment) {
  const bindings = new Map();
  for (const binding of [
    ...(generated?.bindings ?? []),
    ...(environment?.bindings ?? []),
  ]) {
    bindings.set(binding.name, binding);
  }
  return bindings.size > 0 ? { bindings: [...bindings.values()] } : undefined;
}
