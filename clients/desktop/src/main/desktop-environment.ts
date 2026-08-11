export type DesktopEnvPreset = "prod" | "dev-local" | "canary";

const DEFAULT_WEB_URL_BY_PRESET = {
  prod: "https://openmeld.ai",
  "dev-local": "http://localhost:3000",
  canary: "http://localhost:3000",
} as const satisfies Record<DesktopEnvPreset, string>;
const DEFAULT_NODE_DOWNLOAD_URL = "https://nodejs.org/en/download";
const DEFAULT_DESKTOP_DOWNLOAD_PAGE_URL_BY_PRESET = {
  prod: "https://openmeld.ai/desktop",
  "dev-local": "http://localhost:3000/desktop",
  canary: "http://localhost:3000/desktop",
} as const satisfies Record<DesktopEnvPreset, string>;
const DEFAULT_DESKTOP_UPDATE_MANIFEST_URL_BY_PRESET = {
  prod: "https://openmeld.ai/desktop/update.json",
  "dev-local": "http://localhost:3000/desktop/update.json",
  canary: "http://localhost:3000/desktop/update.json",
} as const satisfies Record<DesktopEnvPreset, string>;

export function resolveDesktopWebUrl(
  input: { env?: NodeJS.ProcessEnv; path?: string } = {}
): string {
  const env = input.env ?? process.env;
  const explicitWebUrl = normalizeOptionalText(env.WEB_APP_URL);
  const webUrl = explicitWebUrl
    ? normalizeHttpUrl(explicitWebUrl, "WEB_APP_URL")
    : DEFAULT_WEB_URL_BY_PRESET[resolveDesktopEnvPreset({ env })];
  if (!input.path) {
    return webUrl;
  }
  return withWebPath(webUrl, input.path);
}

function withWebPath(webUrl: string, path: string): string {
  if (!isAbsoluteWebPath(path)) {
    throw new Error("Web path must start with a single /.");
  }
  const url = new URL(webUrl);
  url.pathname = path;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function isAbsoluteWebPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//")
  );
}

export function resolveNodeDownloadUrl(
  input: { env?: NodeJS.ProcessEnv } = {}
): string {
  const env = input.env ?? process.env;
  const explicitNodeDownloadUrl = normalizeOptionalText(
    env.OPENMELD_NODE_DOWNLOAD_URL
  );
  if (explicitNodeDownloadUrl) {
    return normalizeHttpUrl(
      explicitNodeDownloadUrl,
      "OPENMELD_NODE_DOWNLOAD_URL"
    );
  }
  return DEFAULT_NODE_DOWNLOAD_URL;
}

export function resolveDesktopDownloadPageUrl(
  input: { env?: NodeJS.ProcessEnv } = {}
): string {
  const env = input.env ?? process.env;
  const explicitDownloadPageUrl = normalizeOptionalText(
    env.OPENMELD_DESKTOP_DOWNLOAD_PAGE_URL
  );
  if (explicitDownloadPageUrl) {
    return normalizeHttpUrl(
      explicitDownloadPageUrl,
      "OPENMELD_DESKTOP_DOWNLOAD_PAGE_URL"
    );
  }
  return DEFAULT_DESKTOP_DOWNLOAD_PAGE_URL_BY_PRESET[
    resolveDesktopEnvPreset({ env })
  ];
}

export function resolveDesktopUpdateManifestUrl(
  input: { env?: NodeJS.ProcessEnv } = {}
): string {
  const env = input.env ?? process.env;
  const explicitManifestUrl = normalizeOptionalText(
    env.OPENMELD_DESKTOP_UPDATE_MANIFEST_URL
  );
  if (explicitManifestUrl) {
    return normalizeHttpUrl(
      explicitManifestUrl,
      "OPENMELD_DESKTOP_UPDATE_MANIFEST_URL"
    );
  }
  return DEFAULT_DESKTOP_UPDATE_MANIFEST_URL_BY_PRESET[
    resolveDesktopEnvPreset({ env })
  ];
}

export function resolveDesktopEnvPreset(
  input: { env?: NodeJS.ProcessEnv } = {}
): DesktopEnvPreset {
  const normalized = normalizeOptionalText(
    (input.env ?? process.env).OPENMELD_ENV_PRESET
  )?.toLowerCase();
  if (
    normalized === "prod" ||
    normalized === "dev-local" ||
    normalized === "canary"
  ) {
    return normalized;
  }
  return "prod";
}

function normalizeHttpUrl(value: string, label: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid URL.`);
  }
  if (!(url.protocol === "https:" || url.protocol === "http:")) {
    throw new Error(`${label} must use http or https.`);
  }
  return value;
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
