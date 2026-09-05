#!/usr/bin/env bun

import process from "node:process";
import { createCliApiClientFoundation } from "../../clients/openmeld-cli/src/space/api-client-foundation.ts";
import { createCurrentDeviceApi } from "../../packages/api-client/src/index.ts";

const STAGING_AUTH_URL = "https://auth.staging.openmeld.ai";
const STAGING_GATEWAY_URL = "https://gateway.staging.openmeld.ai";
const COMMANDS = new Set([
  "current-readiness",
  "enable-automatic-updates",
  "forget-current-computer",
  "request-update",
]);

main().catch((error) => {
  process.stderr.write(
    `[staging-computer-smoke-api] ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});

async function main() {
  const command = process.argv[2];
  if (!COMMANDS.has(command) || process.argv.length !== 3) {
    throw new Error("Unsupported Staging Computer smoke API command.");
  }
  assertStagingCanaryEnvironment();
  const api = createCurrentDeviceApi(
    createCliApiClientFoundation(STAGING_GATEWAY_URL)
  );
  let result;
  if (command === "current-readiness") {
    result = await api.getCurrentLocalRuntimeReplyReadiness();
  } else if (command === "enable-automatic-updates") {
    result = await api.setCurrentOpenMeldToolsMaintenance({
      automaticUpdatesEnabled: true,
    });
  } else if (command === "forget-current-computer") {
    result = await api.forgetCurrentComputer();
  } else {
    result = await api.requestCurrentOpenMeldToolsUpdate();
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

function assertStagingCanaryEnvironment() {
  const home = String(process.env.OPENMELD_HOME ?? "").trim();
  if (
    process.env.OPENMELD_ENV_PRESET !== "canary" ||
    process.env.OPENMELD_AUTH_URL !== STAGING_AUTH_URL ||
    process.env.OPENMELD_GATEWAY_URL !== STAGING_GATEWAY_URL ||
    !home.endsWith("/.openmeld-canary")
  ) {
    throw new Error(
      "Staging Computer smoke API is available only in the isolated Canary lane."
    );
  }
}
