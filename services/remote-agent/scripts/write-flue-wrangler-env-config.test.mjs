import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parseJsoncObject } from "../../../packages/db/src/tooling/parse-jsonc.ts";
import { buildEnvironmentConfig } from "./write-flue-wrangler-env-config.mjs";

test("keeps Flue's normalized image path while selecting the staging container", () => {
  const output = buildEnvironmentConfig({
    environmentConfig: {
      containers: [
        {
          class_name: "AgentComputer",
          image: "./Dockerfile",
          name: "openmeld-agent-computer-stg",
        },
      ],
      name: "openmeld-remote-agent-stg",
      vars: { OPENMELD_WORKER_ENVIRONMENT: "stg" },
    },
    generatedConfig: {
      containers: [
        {
          class_name: "AgentComputer",
          image: "/repo/services/remote-agent/Dockerfile",
          name: "openmeld-agent-computer",
        },
      ],
      name: "openmeld-remote-agent",
      vars: { OPENMELD_WORKER_ENVIRONMENT: "local" },
    },
  });

  assert.deepEqual(output.containers, [
    {
      class_name: "AgentComputer",
      image: "/repo/services/remote-agent/Dockerfile",
      name: "openmeld-agent-computer-stg",
    },
  ]);
  assert.equal(output.name, "openmeld-remote-agent-stg");
  assert.equal(output.vars.OPENMELD_WORKER_ENVIRONMENT, "stg");
});

test("keeps the existing production container app while isolating staging", async () => {
  const sourceConfig = parseJsoncObject(
    await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8")
  );
  const generatedConfig = {
    containers: [
      {
        class_name: "AgentComputer",
        image: "/repo/services/remote-agent/Dockerfile",
        name: "openmeld-agent-computer",
      },
    ],
    name: "openmeld-remote-agent",
  };

  const production = buildEnvironmentConfig({
    environmentConfig: sourceConfig.env.prod,
    environmentName: "prod",
    generatedConfig,
  });
  const staging = buildEnvironmentConfig({
    environmentConfig: sourceConfig.env.stg,
    environmentName: "stg",
    generatedConfig,
  });

  assert.equal(production.containers[0].name, "openmeld-agent-computer");
  assert.equal(staging.containers[0].name, "openmeld-agent-computer-stg");
});
