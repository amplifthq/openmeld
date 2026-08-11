import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";
import process from "node:process";

const DARWIN_GUI_PATH_DIRS = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
  "/bin",
  "/usr/sbin",
  "/sbin",
] as const;

export function buildDesktopCommandEnv(
  env: NodeJS.ProcessEnv | undefined
): NodeJS.ProcessEnv {
  const source = env ?? process.env;
  const path = searchDirs(source).join(delimiter);
  return { ...source, PATH: path };
}

export function resolveExecutableOnPath(input: {
  env?: NodeJS.ProcessEnv;
  names: readonly string[];
}): string | null {
  const env = input.env ?? process.env;
  for (const directory of searchDirs(env)) {
    for (const name of input.names) {
      const candidate = join(directory, name);
      if (canExecute(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

export function executableNamesForPlatform(
  baseName: string,
  env: NodeJS.ProcessEnv
): string[] {
  if (process.platform !== "win32") {
    return [baseName];
  }
  const extensions = normalizeOptionalText(env.PATHEXT)
    ?.split(";")
    .map((extension) => extension.trim().toLowerCase())
    .filter(Boolean) ?? [".exe", ".cmd", ".bat", ".com"];
  return [
    baseName,
    ...extensions.map((extension) => `${baseName}${extension}`),
  ];
}

export function canExecute(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function searchDirs(env: NodeJS.ProcessEnv): string[] {
  const dirs = new Set<string>();
  const pathValue = normalizeOptionalText(env.PATH);
  if (pathValue) {
    for (const directory of pathValue.split(delimiter)) {
      const normalizedDirectory = normalizeOptionalText(directory);
      if (normalizedDirectory) {
        dirs.add(normalizedDirectory);
      }
    }
  }
  if (process.platform === "darwin" && sourceAllowsDarwinGuiPathDirs(env)) {
    for (const directory of DARWIN_GUI_PATH_DIRS) {
      dirs.add(directory);
    }
  }
  return [...dirs];
}

function sourceAllowsDarwinGuiPathDirs(env: NodeJS.ProcessEnv): boolean {
  return env.OPENMELD_DESKTOP_DISABLE_COMMON_PATH_DIRS !== "1";
}

function normalizeOptionalText(value: unknown): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}
