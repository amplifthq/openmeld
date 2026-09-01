import { normalizeBaseUrl } from "../protocol/urls";
import { isLoopbackHostname } from "./loopback-hostname";
import { resolveOpenMeldEnvPreset } from "./paths";
import { getConfiguredBaseUrl } from "./runtime-config";

export const DEFAULT_GATEWAY_BASE_URL = "https://gateway.openmeld.ai";
export const DEV_LOCAL_GATEWAY_BASE_URL = "http://localhost:8080";
const AUTH_HOST_LABEL = "auth";
const AUTH_HOST_PREFIX = "auth-";
const LOCAL_AUTH_PORT = "8788";

export async function resolveBaseUrl(
  cliValue?: string,
  input: { env?: NodeJS.ProcessEnv } = {}
): Promise<string> {
  const env = input.env ?? process.env;
  const fromCli = String(cliValue ?? "").trim();
  if (fromCli) {
    return normalizeGatewayBaseUrl(fromCli);
  }

  // False-positive guard: OPENMELD_BASE_URL fallback is intentionally removed.
  // We only support OPENMELD_GATEWAY_URL to avoid ambiguous env precedence.
  const fromEnv = String(env.OPENMELD_GATEWAY_URL ?? "").trim();
  if (fromEnv) {
    return normalizeGatewayBaseUrl(fromEnv);
  }

  const fromConfig = await getConfiguredBaseUrl();
  if (fromConfig) {
    return normalizeGatewayBaseUrl(fromConfig);
  }

  return normalizeGatewayBaseUrl(resolveDefaultGatewayBaseUrl({ env }));
}

export async function resolveBaseUrlOrNull(
  cliValue?: string
): Promise<string | null> {
  try {
    return await resolveBaseUrl(cliValue);
  } catch {
    return null;
  }
}

export async function resolveExplicitGatewayUrlOrThrow(
  cliValue?: string
): Promise<string | undefined> {
  const explicitGatewayUrl = normalizeOptionalString(cliValue);
  if (!explicitGatewayUrl) {
    return undefined;
  }

  try {
    return await Promise.resolve().then(() =>
      normalizeGatewayBaseUrl(explicitGatewayUrl)
    );
  } catch (error) {
    throw new Error(
      `Invalid explicit gateway URL "${explicitGatewayUrl}": ${toErrorMessage(error)}`
    );
  }
}

export function normalizeGatewayBaseUrl(gatewayUrl: string): string {
  const normalizedGatewayUrl = normalizeBaseUrl(gatewayUrl);
  const parsedGatewayUrl = new URL(normalizedGatewayUrl);
  if (isAuthWorkerUrl(parsedGatewayUrl)) {
    throw new Error(
      "gateway URL must point to the OpenMeld gateway, not the OpenMeld auth worker"
    );
  }
  return normalizedGatewayUrl;
}

export function normalizeGatewayBaseUrlOrNull(
  gatewayUrl?: string | null
): string | null {
  const normalizedGatewayUrl = normalizeOptionalString(gatewayUrl);
  if (!normalizedGatewayUrl) {
    return null;
  }
  try {
    return normalizeGatewayBaseUrl(normalizedGatewayUrl);
  } catch {
    return null;
  }
}

function normalizeOptionalString(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

export function resolveDefaultGatewayBaseUrl(
  input: { env?: NodeJS.ProcessEnv } = {}
): string {
  const preset = resolveOpenMeldEnvPreset(input);
  if (preset === "dev-local" || preset === "canary") {
    return DEV_LOCAL_GATEWAY_BASE_URL;
  }
  return DEFAULT_GATEWAY_BASE_URL;
}

function isAuthWorkerUrl(url: URL): boolean {
  if (isLoopbackHostname(url.hostname)) {
    return resolveUrlPort(url) === LOCAL_AUTH_PORT;
  }

  const [firstLabel = ""] = url.hostname.toLowerCase().split(".");
  return (
    firstLabel === AUTH_HOST_LABEL || firstLabel.startsWith(AUTH_HOST_PREFIX)
  );
}

function resolveUrlPort(url: URL): string {
  if (url.port) {
    return url.port;
  }
  if (url.protocol === "http:" || url.protocol === "ws:") {
    return "80";
  }
  if (url.protocol === "https:" || url.protocol === "wss:") {
    return "443";
  }
  return "";
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
