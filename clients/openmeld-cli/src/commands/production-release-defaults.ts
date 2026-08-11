import process from "node:process";
import { resolveOpenMeldCliEntryNameFromArgv } from "../config/paths";

const PRODUCTION_WEB_RELEASE_ENTRY_NAME = "openmeld";
const PRODUCTION_RELEASE_DEFAULT_ENV_KEYS = [
  "OPENMELD_GATEWAY_URL",
  "OPENMELD_AUTH_URL",
  "OPENMELD_AUTH_CLIENT_ID",
  "OPENMELD_ENV_PRESET",
  "OPENMELD_DEV_MODE",
  "OPENMELD_USER_FACING_CLI_COMMAND",
] as const;

type ProductionReleaseDefaultsInput = {
  argv?: string[];
  env?: NodeJS.ProcessEnv;
};

export function applyProductionReleaseDefaultsToProcessEnv(input?: {
  argv?: string[];
}): void {
  applyProductionReleaseDefaultsToEnvironment({
    argv: input?.argv,
    env: process.env,
  });
}

export function applyProductionReleaseDefaultsToEnvironment(
  input: ProductionReleaseDefaultsInput = {}
): void {
  if (!shouldUseProductionReleaseDefaults(input)) {
    return;
  }

  const env = input.env ?? process.env;
  for (const key of PRODUCTION_RELEASE_DEFAULT_ENV_KEYS) {
    Reflect.deleteProperty(env, key);
  }
}

export function shouldUseProductionReleaseDefaults(
  input: Pick<ProductionReleaseDefaultsInput, "argv"> = {}
): boolean {
  const argv = input.argv ?? process.argv;
  return (
    resolveOpenMeldCliEntryNameFromArgv(argv) ===
    PRODUCTION_WEB_RELEASE_ENTRY_NAME
  );
}
