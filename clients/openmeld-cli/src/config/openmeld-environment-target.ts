import process from "node:process";
import { resolveUserFacingCliEntryCommand } from "../runtime/cli-entry-command";
import { resolveAuthBaseUrl } from "./auth-url";
import {
  normalizeGatewayBaseUrl,
  resolveBaseUrl,
  resolveDefaultGatewayBaseUrl,
} from "./base-url";
import type { OpenMeldEnvPreset } from "./paths";
import { resolveOpenMeldEnvPreset } from "./paths";

const OPENMELD_USER_FACING_CLI_COMMAND_ENV = "OPENMELD_USER_FACING_CLI_COMMAND";

export type OpenMeldEnvironmentTarget = {
  preset: OpenMeldEnvPreset;
  gatewayUrl: string;
  authBaseUrl: string;
  userFacingCommand: string;
};

type OpenMeldEnvironmentTargetInput = {
  gatewayUrl?: string;
  authUrl?: string;
  env?: NodeJS.ProcessEnv;
};

export async function resolveOpenMeldEnvironmentTarget(
  input: OpenMeldEnvironmentTargetInput = {}
): Promise<OpenMeldEnvironmentTarget> {
  const env = input.env ?? process.env;
  const preset = resolveOpenMeldEnvPreset({ env });
  return {
    preset,
    gatewayUrl: await resolveBaseUrl(input.gatewayUrl, { env }),
    authBaseUrl: resolveAuthBaseUrl(input.authUrl, { env }),
    userFacingCommand: resolveUserFacingCommandForPreset({ env, preset }),
  };
}

export function resolveOpenMeldEnvironmentTargetFromEnv(
  input: OpenMeldEnvironmentTargetInput = {}
): OpenMeldEnvironmentTarget {
  const env = input.env ?? process.env;
  const preset = resolveOpenMeldEnvPreset({ env });
  return {
    preset,
    gatewayUrl: resolveGatewayUrlFromEnvOnly({
      env,
      gatewayUrl: input.gatewayUrl,
    }),
    authBaseUrl: resolveAuthBaseUrl(input.authUrl, { env }),
    userFacingCommand: resolveUserFacingCommandForPreset({ env, preset }),
  };
}

function resolveUserFacingCommandForPreset(input: {
  env: NodeJS.ProcessEnv;
  preset: OpenMeldEnvPreset;
}): string {
  const explicitCommand = normalizeOptionalText(
    input.env[OPENMELD_USER_FACING_CLI_COMMAND_ENV]
  );
  if (explicitCommand) {
    return explicitCommand;
  }
  if (input.preset === "dev-local") {
    return "openmeld-dev";
  }
  if (input.preset === "canary") {
    return "openmeld-canary";
  }
  return resolveUserFacingCliEntryCommand({ env: input.env });
}

function resolveGatewayUrlFromEnvOnly(input: {
  env: NodeJS.ProcessEnv;
  gatewayUrl?: string;
}): string {
  const fromInput = normalizeOptionalText(input.gatewayUrl);
  if (fromInput) {
    return normalizeGatewayBaseUrl(fromInput);
  }
  const fromEnv = normalizeOptionalText(input.env.OPENMELD_GATEWAY_URL);
  if (fromEnv) {
    return normalizeGatewayBaseUrl(fromEnv);
  }
  return normalizeGatewayBaseUrl(
    resolveDefaultGatewayBaseUrl({ env: input.env })
  );
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
