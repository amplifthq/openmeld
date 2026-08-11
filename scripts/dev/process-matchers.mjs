import { join } from "node:path";

const wranglerServiceDirectoryNames = [
  ["services", "auth"],
  ["services", "core"],
  ["services", "gateway"],
];

export function buildProcessMatcherContext(repoRoot) {
  const normalizedRepoRoot = normalizeProcessMatchText(repoRoot);
  return {
    normalizedRepoRoot,
    normalizedRepoRootPathPrefix: withTrailingSlash(normalizedRepoRoot),
    normalizedWebClientPath: normalizeProcessMatchText(
      withTrailingSlash(join(repoRoot, "clients", "web"))
    ),
    normalizedDevGuardPath: normalizeProcessMatchText(
      join(repoRoot, "scripts", "dev", "dev-guard.mjs")
    ),
    normalizedRepoNodeModulesPath: normalizeProcessMatchText(
      withTrailingSlash(join(repoRoot, "node_modules"))
    ),
    normalizedWranglerServicePaths: wranglerServiceDirectoryNames.map(
      (segments) =>
        normalizeProcessMatchText(
          withTrailingSlash(join(repoRoot, ...segments))
        )
    ),
  };
}

export function normalizeProcessMatchText(value) {
  return String(value ?? "")
    .trim()
    .replaceAll("\\", "/");
}

export function isRepoProcessCommand(normalizedCommand, matcherContext) {
  return normalizedCommand.includes(
    matcherContext.normalizedRepoRootPathPrefix ??
      withTrailingSlash(matcherContext.normalizedRepoRoot)
  );
}

export function isDevGuardCommand(normalizedCommand, matcherContext) {
  return normalizedCommand.includes(matcherContext.normalizedDevGuardPath);
}

export function isTurboDevCommand(normalizedCommand) {
  return (
    normalizedCommand.includes("turbo") &&
    normalizedCommand.includes(" run dev")
  );
}

export function isWranglerDevCommand(normalizedCommand, matcherContext) {
  const isWranglerDev =
    normalizedCommand.includes("wrangler") &&
    normalizedCommand.includes(" dev");
  if (!isWranglerDev) {
    return false;
  }

  if (
    matcherContext.normalizedWranglerServicePaths.some((servicePath) =>
      normalizedCommand.includes(servicePath)
    )
  ) {
    return true;
  }

  return (
    normalizedCommand.includes(matcherContext.normalizedRepoNodeModulesPath) &&
    normalizedCommand.includes("/wrangler-dist/cli.js")
  );
}

export function isWranglerWorkerdCommand(normalizedCommand, matcherContext) {
  const isRepoWorkerdBinary =
    normalizedCommand.includes(matcherContext.normalizedRepoNodeModulesPath) &&
    normalizedCommand.includes("@cloudflare/workerd-") &&
    (normalizedCommand.includes("/bin/workerd serve") ||
      normalizedCommand.includes("/bin/workerd.exe serve"));
  if (!isRepoWorkerdBinary) {
    return false;
  }

  return (
    normalizedCommand.includes("--external-addr=loopback=") ||
    normalizedCommand.includes("--socket-addr=entry=localhost:") ||
    normalizedCommand.includes("--socket-addr=entry=127.0.0.1:")
  );
}

export function isWebViteDevCommand(normalizedCommand, matcherContext) {
  if (!normalizedCommand.includes(matcherContext.normalizedWebClientPath)) {
    return false;
  }

  return (
    normalizedCommand.includes("/vite/bin/vite") &&
    normalizedCommand.includes(" dev") &&
    normalizedCommand.includes("--port 3000")
  );
}

function withTrailingSlash(value) {
  return value.endsWith("/") || value.endsWith("\\") ? value : `${value}/`;
}
