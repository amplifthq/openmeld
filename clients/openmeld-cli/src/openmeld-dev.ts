import { DEV_LOCAL_GATEWAY_BASE_URL } from "./config/base-url";

const LOCAL_GATEWAY_URL = DEV_LOCAL_GATEWAY_BASE_URL;
const LOCAL_AUTH_URL = "http://localhost:8788";
const LOCAL_AUTH_CLIENT_ID = "openmeld-cli-dev";
const LOCAL_DEV_ENV_PRESET = "dev-local";
const LOCAL_DEV_ENTRY_COMMAND = "openmeld-dev";

if (!String(process.env.OPENMELD_GATEWAY_URL ?? "").trim()) {
  process.env.OPENMELD_GATEWAY_URL = LOCAL_GATEWAY_URL;
}

if (!String(process.env.OPENMELD_AUTH_URL ?? "").trim()) {
  process.env.OPENMELD_AUTH_URL = LOCAL_AUTH_URL;
}

if (!String(process.env.OPENMELD_AUTH_CLIENT_ID ?? "").trim()) {
  process.env.OPENMELD_AUTH_CLIENT_ID = LOCAL_AUTH_CLIENT_ID;
}

if (!String(process.env.OPENMELD_ENV_PRESET ?? "").trim()) {
  process.env.OPENMELD_ENV_PRESET = LOCAL_DEV_ENV_PRESET;
}

if (!String(process.env.OPENMELD_USER_FACING_CLI_COMMAND ?? "").trim()) {
  process.env.OPENMELD_USER_FACING_CLI_COMMAND = LOCAL_DEV_ENTRY_COMMAND;
}

if (!String(process.env.OPENMELD_DEV_MODE ?? "").trim()) {
  process.env.OPENMELD_DEV_MODE = "1";
}

import("./openmeld").catch((error: unknown) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
