import { readFile, writeFile } from "node:fs/promises";
import { parseJsoncObject } from "../../../packages/db/src/tooling/parse-jsonc.ts";

const environmentName = process.argv[2];

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

const sourceConfig = parseJsoncObject(await readFile(sourceConfigUrl, "utf8"));
const generatedConfig = JSON.parse(await readFile(generatedConfigUrl, "utf8"));

const environmentConfig = sourceConfig.env?.[environmentName];
if (!environmentConfig || typeof environmentConfig !== "object") {
  throw new Error(
    `Missing env.${environmentName} in services/remote-agent/wrangler.jsonc.`
  );
}

const outputConfig = {
  ...generatedConfig,
  analytics_engine_datasets:
    environmentConfig.analytics_engine_datasets ??
    generatedConfig.analytics_engine_datasets,
  ai: environmentConfig.ai ?? generatedConfig.ai,
  browser: environmentConfig.browser ?? generatedConfig.browser,
  // Flue resolves local Dockerfile paths to absolute paths in the generated
  // config. Preserve that normalized value for deploy/dev configs.
  containers: generatedConfig.containers,
  durable_objects: mergeDurableObjectBindings(
    generatedConfig.durable_objects,
    environmentConfig.durable_objects
  ),
  name:
    typeof environmentConfig.name === "string"
      ? environmentConfig.name
      : `${generatedConfig.name}-${environmentName}`,
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

await writeFile(
  outputConfigUrl,
  `${JSON.stringify(outputConfig, null, 2)}\n`,
  "utf8"
);

console.log(`Wrote ${outputConfigUrl.pathname}`);

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
