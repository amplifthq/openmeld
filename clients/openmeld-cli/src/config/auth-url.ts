import { normalizeBaseUrl } from "../protocol/urls";
import { resolveOpenMeldEnvPreset } from "./paths";

export const DEFAULT_AUTH_BASE_URL = "https://auth.openmeld.ai";
export const DEV_LOCAL_AUTH_BASE_URL = "http://localhost:8788";

export function resolveAuthBaseUrl(
  cliValue?: string,
  input: { env?: NodeJS.ProcessEnv } = {}
): string {
  const env = input.env ?? process.env;
  const fromCli = String(cliValue ?? "").trim();
  if (fromCli) {
    return normalizeBaseUrl(fromCli);
  }

  const fromEnv = String(env.OPENMELD_AUTH_URL ?? "").trim();
  if (fromEnv) {
    return normalizeBaseUrl(fromEnv);
  }

  return normalizeBaseUrl(resolveDefaultAuthBaseUrl(env));
}

function resolveDefaultAuthBaseUrl(env: NodeJS.ProcessEnv): string {
  const preset = resolveOpenMeldEnvPreset({ env });
  if (preset === "dev-local" || preset === "canary") {
    return DEV_LOCAL_AUTH_BASE_URL;
  }
  return DEFAULT_AUTH_BASE_URL;
}
