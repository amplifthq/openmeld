export function hasPathSeparator(value: string): boolean {
  return value.includes("/") || value.includes("\\");
}

export function normalizeControllerCommandPath(commandPath: string): string {
  return commandPath.replaceAll("\\", "/").toLowerCase();
}

export function isBunGlobalCommandPath(commandPath: string): boolean {
  return normalizeControllerCommandPath(commandPath).includes("/.bun/bin/");
}

export function isPnpmGlobalCommandPath(commandPath: string): boolean {
  const normalized = normalizeControllerCommandPath(commandPath);
  return (
    normalized.includes("/.local/share/pnpm/") ||
    normalized.includes("/library/pnpm/") ||
    normalized.includes("/local/share/pnpm/") ||
    normalized.includes("/appdata/local/pnpm/") ||
    normalized.includes("/pnpm/global/")
  );
}

export function isNpmGlobalCommandPath(commandPath: string): boolean {
  const normalized = normalizeControllerCommandPath(commandPath);
  return (
    normalized.includes("/node_modules/.bin/") ||
    normalized.includes("/lib/node_modules/") ||
    normalized.includes("/npm/node_modules/")
  );
}

export function isHomebrewCommandPath(commandPath: string): boolean {
  const normalized = normalizeControllerCommandPath(commandPath);
  return (
    normalized.includes("/opt/homebrew/cellar/") ||
    normalized.includes("/usr/local/cellar/") ||
    normalized.includes("/homebrew/cellar/") ||
    normalized.includes("/opt/homebrew/caskroom/") ||
    normalized.includes("/usr/local/caskroom/") ||
    normalized.startsWith("/opt/homebrew/bin/") ||
    normalized.startsWith("/usr/local/bin/")
  );
}

export function isClaudeNativeCommandPath(commandPath: string): boolean {
  const normalized = normalizeControllerCommandPath(commandPath);
  return (
    normalized.endsWith("/.local/bin/claude") ||
    normalized.endsWith("/.local/bin/claude.exe") ||
    normalized.includes("/.local/share/claude/")
  );
}

export function isCursorNativeCommandPath(commandPath: string): boolean {
  const normalized = normalizeControllerCommandPath(commandPath);
  return (
    normalized.endsWith("/.local/bin/cursor-agent") ||
    normalized.endsWith("/.cursor/bin/cursor-agent") ||
    (normalized.includes("/.local/share/cursor-agent/versions/") &&
      normalized.endsWith("/cursor-agent"))
  );
}

export function isGrokBuildNativeCommandPath(commandPath: string): boolean {
  const normalized = normalizeControllerCommandPath(commandPath);
  return (
    normalized.endsWith("/.grok/bin/grok") ||
    normalized.endsWith("/.grok/bin/grok.exe") ||
    normalized.endsWith("/.local/bin/grok") ||
    normalized.endsWith("/.local/bin/grok.exe") ||
    normalized.includes("/.grok/downloads/")
  );
}

export function isOpenCodeNativeCommandPath(commandPath: string): boolean {
  const normalized = normalizeControllerCommandPath(commandPath);
  return (
    normalized.includes("/.opencode/bin/") &&
    (normalized.endsWith("/opencode") || normalized.endsWith("/opencode.exe"))
  );
}
