import { readFile } from "node:fs/promises";
import type {
  BuiltinAgentControllerOfficialChannel,
  BuiltinAgentControllerVersionMaintenanceDefinition,
  ControllerVersionLatestSpec,
} from "./builtin-agent-controller-definitions";
import {
  isBunGlobalCommandPath,
  isHomebrewCommandPath,
  isNpmGlobalCommandPath,
  isPnpmGlobalCommandPath,
} from "./controller-command-paths";

const LATEST_VERSION_TIMEOUT_MS = 4000;
const LATEST_VERSION_CACHE_TTL_MS = 60 * 60 * 1000;
const FAILED_LATEST_VERSION_CACHE_TTL_MS = 5 * 60 * 1000;
const HOMEBREW_CELLAR_RE = /^(.*)\/[Cc]ellar\/([^/]+)\/([^/]+)\//u;
const HOMEBREW_CASKROOM_RE = /^(.*)\/[Cc]askroom\/([^/]+)\/([^/]+)\//u;
const HOMEBREW_FORMULA_VERSION_RE = /^\s*version\s+"([^"]+)"/mu;
const HOMEBREW_RELEASE_URL_VERSION_RE =
  /releases\/download\/v?([^/]+)(?:\/|$)/u;
const GITHUB_TAG_PREFIX_RE = /^v/u;
const PLAIN_VERSION_LINE_RE = /\r?\n/u;
const OFFICIAL_HOMEBREW_TAPS = new Set([
  "homebrew/core",
  "homebrew/cask",
  "homebrew/homebrew-core",
  "homebrew/homebrew-cask",
]);
const OPENMELD_VERSION_LOOKUP_USER_AGENT = "OpenMeld";

export type LatestVersionFetchFailureDiagnostic = {
  attempt: 1 | 2;
  errorMessage: string | null;
  errorName: string | null;
  reason: "http_error" | "invalid_response" | "request_error" | "timeout";
  statusCode: number | null;
  url: string;
};

export type LatestVersionLookupResult = {
  failureDiagnostics: readonly LatestVersionFetchFailureDiagnostic[];
  version: string | null;
};

export type ControllerVersionChannel = {
  cacheKey: string;
  latest: ControllerResolvedLatestLookup;
  updateCommand: string | null;
};

type ControllerResolvedLatestLookup =
  | { kind: "github-release"; repository: string }
  | {
      kind: "homebrew-api";
      package: NonNullable<
        BuiltinAgentControllerVersionMaintenanceDefinition["homebrewPackage"]
      >;
    }
  | { kind: "homebrew-tap-formula"; name: string; tap: string }
  | { kind: "http-json"; url: string }
  | { kind: "http-text"; url: string }
  | { kind: "npm"; packageName: string };

type HomebrewInstallIdentity = {
  kind: "cask" | "formula";
  name: string;
  tap: string | null;
};

const latestControllerVersionCache = new Map<
  string,
  { expiresAtMs: number; version: string | null }
>();

export async function resolveControllerVersionChannel(input: {
  commandPath: string;
  commandPaths: readonly string[];
  definition: BuiltinAgentControllerVersionMaintenanceDefinition;
}): Promise<ControllerVersionChannel | null> {
  const officialChannel = findOfficialChannel(
    input.commandPath,
    input.commandPaths,
    input.definition.officialChannels
  );
  if (officialChannel) {
    const latest = resolveDeclaredLatestLookup(
      officialChannel.latest,
      input.definition
    );
    if (!latest) {
      return null;
    }
    return {
      cacheKey: buildLatestCacheKey(latest),
      latest,
      updateCommand: officialChannel.updateCommand,
    };
  }

  if (isPackageManagerCommandPath(input.commandPaths)) {
    if (input.definition.npmPackageName) {
      return {
        cacheKey: `npm:${input.definition.npmPackageName}`,
        latest: {
          kind: "npm",
          packageName: input.definition.npmPackageName,
        },
        updateCommand: resolvePackageManagerUpdateCommand({
          commandPaths: input.commandPaths,
          packageName: input.definition.npmPackageName,
        }),
      };
    }
    return null;
  }

  if (
    input.definition.homebrewPackage &&
    input.commandPaths.some(isHomebrewCommandPath)
  ) {
    const homebrewInstall = await resolveHomebrewInstallIdentity({
      commandPaths: input.commandPaths,
      declaredPackage: input.definition.homebrewPackage,
    });
    if (!homebrewInstall) {
      return null;
    }
    const latest = resolveHomebrewLatestLookup(homebrewInstall);
    return {
      cacheKey: buildLatestCacheKey(latest),
      latest,
      updateCommand: resolveHomebrewUpdateCommand(homebrewInstall),
    };
  }

  if (input.definition.npmPackageName) {
    return {
      cacheKey: `npm:${input.definition.npmPackageName}`,
      latest: {
        kind: "npm",
        packageName: input.definition.npmPackageName,
      },
      updateCommand: `npm install -g ${input.definition.npmPackageName}@latest`,
    };
  }

  return null;
}

export async function fetchLatestControllerVersion(
  channel: ControllerVersionChannel
): Promise<LatestVersionLookupResult> {
  const nowMs = Date.now();
  const cached = latestControllerVersionCache.get(channel.cacheKey);
  if (cached && cached.expiresAtMs > nowMs) {
    return { failureDiagnostics: [], version: cached.version };
  }

  const lookupResult = await fetchLatestForLookup(channel.latest);
  latestControllerVersionCache.set(channel.cacheKey, {
    expiresAtMs:
      nowMs +
      (lookupResult.version
        ? LATEST_VERSION_CACHE_TTL_MS
        : FAILED_LATEST_VERSION_CACHE_TTL_MS),
    version: lookupResult.version,
  });
  return lookupResult;
}

export function buildHomebrewFormulaeApiUrl(input: {
  kind: "cask" | "formula";
  name: string;
}): string {
  return `https://formulae.brew.sh/api/${input.kind}/${encodeURIComponent(input.name)}.json`;
}

export function buildHomebrewTapFormulaUrls(input: {
  name: string;
  tap: string;
}): string[] {
  const repository = resolveHomebrewTapGitHubRepository(input.tap);
  if (!repository) {
    return [];
  }
  const base = `https://raw.githubusercontent.com/${repository.owner}/${repository.repo}/HEAD`;
  return [`${base}/${input.name}.rb`, `${base}/Formula/${input.name}.rb`];
}

export function parseHomebrewFormulaVersion(source: string): string | null {
  const declaredVersion = source.match(HOMEBREW_FORMULA_VERSION_RE)?.[1];
  if (declaredVersion) {
    return declaredVersion.trim();
  }
  const releaseVersion = source.match(HOMEBREW_RELEASE_URL_VERSION_RE)?.[1];
  return releaseVersion ? releaseVersion.trim() : null;
}

function findOfficialChannel(
  commandPath: string,
  commandPaths: readonly string[],
  channels: BuiltinAgentControllerVersionMaintenanceDefinition["officialChannels"]
): BuiltinAgentControllerOfficialChannel | null {
  if (!channels) {
    return null;
  }
  for (const channel of channels) {
    if (channel.matchesPath(commandPath)) {
      return channel;
    }
  }
  for (const path of commandPaths) {
    if (path === commandPath) {
      continue;
    }
    for (const channel of channels) {
      if (channel.matchesPath(path)) {
        return channel;
      }
    }
  }
  return null;
}

function resolveDeclaredLatestLookup(
  latest: ControllerVersionLatestSpec,
  definition: BuiltinAgentControllerVersionMaintenanceDefinition
): ControllerResolvedLatestLookup | null {
  if (latest.kind === "npm") {
    return definition.npmPackageName
      ? { kind: "npm", packageName: definition.npmPackageName }
      : null;
  }
  if (latest.kind === "homebrew") {
    return definition.homebrewPackage
      ? { kind: "homebrew-api", package: definition.homebrewPackage }
      : null;
  }
  return latest;
}

function isPackageManagerCommandPath(commandPaths: readonly string[]): boolean {
  return (
    commandPaths.some(isBunGlobalCommandPath) ||
    commandPaths.some(isPnpmGlobalCommandPath) ||
    commandPaths.some(isNpmGlobalCommandPath)
  );
}

function resolvePackageManagerUpdateCommand(input: {
  commandPaths: readonly string[];
  packageName: string;
}): string {
  if (input.commandPaths.some(isBunGlobalCommandPath)) {
    return `bun i -g ${input.packageName}@latest`;
  }
  if (input.commandPaths.some(isPnpmGlobalCommandPath)) {
    return `pnpm add -g ${input.packageName}@latest`;
  }
  return `npm install -g ${input.packageName}@latest`;
}

async function resolveHomebrewInstallIdentity(input: {
  commandPaths: readonly string[];
  declaredPackage: NonNullable<
    BuiltinAgentControllerVersionMaintenanceDefinition["homebrewPackage"]
  >;
}): Promise<HomebrewInstallIdentity | null> {
  for (const commandPath of input.commandPaths) {
    const cellarInstall = parseHomebrewPrefixInstall(commandPath, "formula");
    if (cellarInstall) {
      const tap = await readHomebrewReceiptTap(cellarInstall.installDir);
      return {
        kind: "formula",
        name: cellarInstall.name,
        tap,
      };
    }
    const caskInstall = parseHomebrewPrefixInstall(commandPath, "cask");
    if (caskInstall) {
      const tap = await readHomebrewReceiptTap(caskInstall.installDir);
      return {
        kind: "cask",
        name: caskInstall.name,
        tap: tap ?? "homebrew/cask",
      };
    }
  }
  if (!input.commandPaths.some(isHomebrewCommandPath)) {
    return null;
  }
  return {
    kind: input.declaredPackage.kind,
    name: input.declaredPackage.name,
    tap:
      input.declaredPackage.kind === "cask" ? "homebrew/cask" : "homebrew/core",
  };
}

function parseHomebrewPrefixInstall(
  commandPath: string,
  kind: "cask" | "formula"
): { installDir: string; name: string } | null {
  const normalized = commandPath.replaceAll("\\", "/");
  const match =
    kind === "formula"
      ? HOMEBREW_CELLAR_RE.exec(normalized)
      : HOMEBREW_CASKROOM_RE.exec(normalized);
  const name = match?.[2];
  const matchedPrefix = match?.[0];
  if (!(name && matchedPrefix)) {
    return null;
  }
  return {
    installDir: normalized.slice(0, matchedPrefix.length - 1),
    name,
  };
}

async function readHomebrewReceiptTap(
  installDir: string
): Promise<string | null> {
  try {
    const receipt = JSON.parse(
      await readFile(`${installDir}/INSTALL_RECEIPT.json`, "utf8")
    ) as unknown;
    if (!receipt || typeof receipt !== "object") {
      return null;
    }
    const tap = (receipt as { source?: { tap?: unknown } }).source?.tap;
    return typeof tap === "string" && tap.trim().length > 0 ? tap.trim() : null;
  } catch {
    return null;
  }
}

function resolveHomebrewLatestLookup(
  install: HomebrewInstallIdentity
): ControllerResolvedLatestLookup {
  if (install.tap && isThirdPartyHomebrewTap(install.tap)) {
    return {
      kind: "homebrew-tap-formula",
      name: install.name,
      tap: install.tap,
    };
  }
  return {
    kind: "homebrew-api",
    package: { kind: install.kind, name: install.name },
  };
}

function resolveHomebrewUpdateCommand(
  install: HomebrewInstallIdentity
): string {
  const packageSpec =
    install.tap && isThirdPartyHomebrewTap(install.tap)
      ? `${install.tap}/${install.name}`
      : install.name;
  return install.kind === "cask"
    ? `brew upgrade --cask ${packageSpec}`
    : `brew upgrade ${packageSpec}`;
}

function isThirdPartyHomebrewTap(tap: string): boolean {
  return !OFFICIAL_HOMEBREW_TAPS.has(tap);
}

function resolveHomebrewTapGitHubRepository(
  tap: string
): { owner: string; repo: string } | null {
  const [owner, name] = tap.split("/");
  if (!(owner && name)) {
    return null;
  }
  return {
    owner,
    repo: name.startsWith("homebrew-") ? name : `homebrew-${name}`,
  };
}

function buildLatestCacheKey(latest: ControllerResolvedLatestLookup): string {
  switch (latest.kind) {
    case "github-release":
      return `github-release:${latest.repository}`;
    case "homebrew-api":
      return `brew-api:${latest.package.kind}:${latest.package.name}`;
    case "homebrew-tap-formula":
      return `brew-tap:${latest.tap}:${latest.name}`;
    case "http-json":
    case "http-text":
      return `${latest.kind}:${latest.url}`;
    case "npm":
      return `npm:${latest.packageName}`;
    default: {
      const exhaustive: never = latest;
      throw new Error(
        `Unsupported latest lookup: ${JSON.stringify(exhaustive)}`
      );
    }
  }
}

function fetchLatestForLookup(
  latest: ControllerResolvedLatestLookup
): Promise<LatestVersionLookupResult> {
  switch (latest.kind) {
    case "github-release":
      return fetchLatestVersion({
        accept: "application/vnd.github+json",
        parse: parseGitHubReleaseTag,
        url: `https://api.github.com/repos/${latest.repository}/releases/latest`,
        userAgent: OPENMELD_VERSION_LOOKUP_USER_AGENT,
      });
    case "homebrew-api":
      return fetchLatestVersion({
        accept: "application/json",
        parse: (body) => parseHomebrewApiVersion(body, latest.package.kind),
        url: buildHomebrewFormulaeApiUrl(latest.package),
      });
    case "homebrew-tap-formula":
      return fetchFirstSuccessfulLatestVersion(
        buildHomebrewTapFormulaUrls(latest).map((url) => ({
          accept: "text/plain",
          parse: parseHomebrewFormulaVersion,
          url,
        }))
      );
    case "http-json":
      return fetchLatestVersion({
        accept: "application/json",
        parse: parseJsonVersionField,
        url: latest.url,
      });
    case "http-text":
      return fetchLatestVersion({
        accept: "text/plain",
        parse: parsePlainVersion,
        url: latest.url,
      });
    case "npm":
      return fetchLatestVersion({
        accept: "application/json",
        parse: parseJsonVersionField,
        url: `https://registry.npmjs.org/${encodeURIComponent(latest.packageName)}/latest`,
      });
    default: {
      const exhaustive: never = latest;
      throw new Error(
        `Unsupported latest lookup: ${JSON.stringify(exhaustive)}`
      );
    }
  }
}

async function fetchFirstSuccessfulLatestVersion(
  lookups: readonly {
    accept: string;
    parse: (body: string) => string | null;
    url: string;
  }[]
): Promise<LatestVersionLookupResult> {
  const failureDiagnostics: LatestVersionFetchFailureDiagnostic[] = [];
  for (const lookup of lookups) {
    const lookupResult = await fetchLatestVersion(lookup);
    if (lookupResult.version) {
      return {
        failureDiagnostics: [
          ...failureDiagnostics,
          ...lookupResult.failureDiagnostics,
        ],
        version: lookupResult.version,
      };
    }
    failureDiagnostics.push(...lookupResult.failureDiagnostics);
  }
  return { failureDiagnostics, version: null };
}

async function fetchLatestVersion(input: {
  accept: string;
  parse: (body: string) => string | null;
  url: string;
  userAgent?: string;
}): Promise<LatestVersionLookupResult> {
  const failureDiagnostics: LatestVersionFetchFailureDiagnostic[] = [];
  for (const attempt of [1, 2] as const) {
    const attemptResult = await fetchLatestVersionAttempt({
      ...input,
      attempt,
    });
    if (attemptResult.ok) {
      return {
        failureDiagnostics,
        version: attemptResult.version,
      };
    }
    failureDiagnostics.push(attemptResult.failureDiagnostic);
  }
  return { failureDiagnostics, version: null };
}

async function fetchLatestVersionAttempt(input: {
  accept: string;
  attempt: 1 | 2;
  parse: (body: string) => string | null;
  url: string;
  userAgent?: string;
}): Promise<
  | { failureDiagnostic: LatestVersionFetchFailureDiagnostic; ok: false }
  | { ok: true; version: string }
> {
  const abortController = new AbortController();
  const timeout = setTimeout(() => {
    abortController.abort();
  }, LATEST_VERSION_TIMEOUT_MS);
  try {
    const response = await fetch(input.url, {
      headers: {
        accept: input.accept,
        ...(input.userAgent ? { "user-agent": input.userAgent } : {}),
      },
      signal: abortController.signal,
    });
    if (!response.ok) {
      return {
        failureDiagnostic: {
          attempt: input.attempt,
          errorMessage: null,
          errorName: null,
          reason: "http_error",
          statusCode: response.status,
          url: input.url,
        },
        ok: false,
      };
    }
    const version = input.parse(await response.text());
    if (!version) {
      return {
        failureDiagnostic: {
          attempt: input.attempt,
          errorMessage: null,
          errorName: null,
          reason: "invalid_response",
          statusCode: response.status,
          url: input.url,
        },
        ok: false,
      };
    }
    return { ok: true, version };
  } catch (error) {
    const errorName = error instanceof Error ? error.name : null;
    return {
      failureDiagnostic: {
        attempt: input.attempt,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorName,
        reason: errorName === "AbortError" ? "timeout" : "request_error",
        statusCode: null,
        url: input.url,
      },
      ok: false,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function parseJsonVersionField(body: string): string | null {
  try {
    const payload: unknown = JSON.parse(body);
    if (!payload || typeof payload !== "object") {
      return null;
    }
    const version = (payload as { version?: unknown }).version;
    return typeof version === "string" && version.trim().length > 0
      ? version.trim()
      : null;
  } catch {
    return null;
  }
}

function parseGitHubReleaseTag(body: string): string | null {
  try {
    const payload: unknown = JSON.parse(body);
    if (!payload || typeof payload !== "object") {
      return null;
    }
    const tagName = (payload as { tag_name?: unknown }).tag_name;
    if (typeof tagName !== "string" || tagName.trim().length === 0) {
      return null;
    }
    return tagName.trim().replace(GITHUB_TAG_PREFIX_RE, "");
  } catch {
    return null;
  }
}

function parseHomebrewApiVersion(
  body: string,
  kind: "cask" | "formula"
): string | null {
  try {
    const payload: unknown = JSON.parse(body);
    if (!payload || typeof payload !== "object") {
      return null;
    }
    if (kind === "cask") {
      const version = (payload as { version?: unknown }).version;
      return typeof version === "string" && version.trim().length > 0
        ? version.trim()
        : null;
    }
    const versions = (payload as { versions?: { stable?: unknown } }).versions;
    const stable = versions?.stable;
    return typeof stable === "string" && stable.trim().length > 0
      ? stable.trim()
      : null;
  } catch {
    return null;
  }
}

function parsePlainVersion(body: string): string | null {
  const version = body.split(PLAIN_VERSION_LINE_RE, 1)[0]?.trim() ?? "";
  return version.length > 0 ? version : null;
}
