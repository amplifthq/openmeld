import { DEFAULT_AUTH_BASE_URL, DEV_LOCAL_AUTH_BASE_URL } from "./auth-url";
import {
  DEFAULT_GATEWAY_BASE_URL,
  DEV_LOCAL_GATEWAY_BASE_URL,
} from "./base-url";

const LOCAL_GATEWAY_URL = DEV_LOCAL_GATEWAY_BASE_URL;
const LOCAL_AUTH_URL = DEV_LOCAL_AUTH_BASE_URL;
export const LOCAL_AUTH_CLIENT_ID = "openmeld-cli-dev";
export const PRODUCTION_AUTH_CLIENT_ID = "openmeld-cli";
const LOCAL_DEV_ENV_PRESET = "dev-local";
const LOCAL_DEV_ENTRY_COMMAND = "openmeld-dev";

export function applyOpenMeldDevEnvironment(
  env: NodeJS.ProcessEnv = process.env
): void {
  if (
    !String(env.OPENMELD_GATEWAY_URL ?? "").trim() ||
    env.OPENMELD_GATEWAY_URL === DEFAULT_GATEWAY_BASE_URL
  ) {
    env.OPENMELD_GATEWAY_URL = LOCAL_GATEWAY_URL;
  }
  if (
    !String(env.OPENMELD_AUTH_URL ?? "").trim() ||
    env.OPENMELD_AUTH_URL === DEFAULT_AUTH_BASE_URL
  ) {
    env.OPENMELD_AUTH_URL = LOCAL_AUTH_URL;
  }
  if (
    !String(env.OPENMELD_AUTH_CLIENT_ID ?? "").trim() ||
    env.OPENMELD_AUTH_CLIENT_ID === PRODUCTION_AUTH_CLIENT_ID
  ) {
    env.OPENMELD_AUTH_CLIENT_ID = LOCAL_AUTH_CLIENT_ID;
  }

  // The executable name is the lane selector. Inherited production values
  // must never make openmeld-dev manage the production OS service identity.
  env.OPENMELD_ENV_PRESET = LOCAL_DEV_ENV_PRESET;
  env.OPENMELD_ENV = "dev";
  env.OPENMELD_USER_FACING_CLI_COMMAND = LOCAL_DEV_ENTRY_COMMAND;
  env.OPENMELD_DEV_MODE = "1";
}
