import assert from "node:assert/strict";
import test from "node:test";

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
