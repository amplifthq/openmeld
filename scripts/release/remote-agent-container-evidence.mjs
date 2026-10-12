import { createHash } from "node:crypto";
import { retainedRemoteContainerSchema } from "../../packages/schemas/src/schemas/release/production-release-evidence.ts";

function canonical(value) {
  if (Array.isArray(value)) {
    return value.map(canonical);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])])
    );
  }
  return value;
}

async function read(input, args) {
  const result = await input.runCommand({
    command: "pnpm",
    args: ["exec", "wrangler", "containers", ...args],
    cwd: input.cwd,
    env: input.env,
  });
  if (result.status !== 0) {
    throw new Error("Remote Agent Container evidence is unavailable.");
  }
  return JSON.parse(result.stdout);
}

export function describeRetainedContainer(container, page) {
  const health = container?.health;
  if (
    container?.active_rollout_id != null ||
    !Array.isArray(health?.errors) ||
    health.errors.length ||
    !Array.isArray(page?.instances) ||
    page.result_info?.next_page_token !== null ||
    page.result_info?.page_token !== null
  ) {
    throw new Error(
      "Retaining Containers requires complete live evidence without an active rollout or errors."
    );
  }
  const active = page.instances.filter(
    (instance) => instance.state !== "inactive"
  );
  if (
    active.some(
      (instance) =>
        !["running", "healthy"].includes(instance.state) ||
        instance.version !== container.version
    )
  ) {
    throw new Error("A Container instance is changing or unavailable.");
  }
  return retainedRemoteContainerSchema.parse({
    id: container.id,
    name: container.name,
    version: container.version,
    image: container.configuration?.image,
    configurationHash: createHash("sha256")
      .update(
        JSON.stringify(
          canonical({
            configuration: container.configuration,
            constraints: container.constraints,
            durable_objects: container.durable_objects,
            scheduling_policy: container.scheduling_policy,
            max_instances: container.max_instances,
            network: container.network,
            rollout_active_grace_period: container.rollout_active_grace_period,
          })
        )
      )
      .digest("hex"),
    instances: active
      .map(({ id, version }) => ({ id, version }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  });
}

export async function readRetainedRemoteContainer(input, expected) {
  let id = expected?.id;
  if (!id) {
    const matches = (await read(input, ["list", "--json"])).filter(
      (item) => item.name === "openmeld-agent-computer"
    );
    if (matches.length !== 1) {
      throw new Error(
        "The production Computer application is not uniquely identified."
      );
    }
    id = matches[0].id;
  }
  const container = await read(input, ["info", id]);
  const page = await read(input, [
    "instances",
    id,
    "--per-page",
    "100",
    "--json",
  ]);
  const observed = describeRetainedContainer(container, page);
  if (expected) {
    const { instances, ...configuration } = observed;
    const { instances: retained, ...baseline } = expected;
    if (
      JSON.stringify(configuration) !== JSON.stringify(baseline) ||
      retained.some(
        (instance) =>
          !instances.some(
            (current) =>
              current.id === instance.id && current.version === instance.version
          )
      )
    ) {
      throw new Error(
        "The retained Computer configuration or running instances changed. Stop before native rollout."
      );
    }
  }
  return observed;
}

export async function verifyRemoteAgentNativeCompletion(
  input,
  retained,
  identity
) {
  const { waitForRemoteAgentContainer } = await import(
    "./remote-agent-partial-recovery.mjs"
  );
  return waitForRemoteAgentContainer(
    input.cwd ?? process.cwd(),
    {
      containerId: retained.id,
      containerVersion: retained.version,
      containerImage: retained.image,
    },
    identity.versionId
  );
}
