import { join } from "node:path";

export function resolveOpenCodeDatabasePath(input: {
  homeDir: string;
  xdgDataHome?: string | null;
}): string {
  const xdgDataHome = normalizeOptionalText(
    input.xdgDataHome ?? process.env.XDG_DATA_HOME
  );
  const dataHome = xdgDataHome ?? join(input.homeDir, ".local", "share");
  return join(dataHome, "opencode", "opencode.db");
}

export function resolveOpenCodeAuthPath(input: {
  homeDir: string;
  xdgDataHome?: string | null;
}): string {
  const xdgDataHome = normalizeOptionalText(
    input.xdgDataHome ?? process.env.XDG_DATA_HOME
  );
  const dataHome = xdgDataHome ?? join(input.homeDir, ".local", "share");
  return join(dataHome, "opencode", "auth.json");
}

function normalizeOptionalText(
  value: string | null | undefined
): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
