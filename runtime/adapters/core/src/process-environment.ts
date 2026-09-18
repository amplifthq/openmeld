const WINDOWS_KEY_SPELLINGS: Record<string, string> = {
  PATH: "PATH",
  PATHEXT: "PATHEXT",
  SYSTEMROOT: "SystemRoot",
  COMSPEC: "ComSpec",
  WINDIR: "WINDIR",
  USERPROFILE: "USERPROFILE",
  HOMEDRIVE: "HOMEDRIVE",
  HOMEPATH: "HOMEPATH",
  APPDATA: "APPDATA",
  LOCALAPPDATA: "LOCALAPPDATA",
  TEMP: "TEMP",
  TMP: "TMP",
};

/** Match Node's Windows duplicate-key precedence, then use stable OS key names. */
export function normalizeCommandEnvironment(
  source: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform
): NodeJS.ProcessEnv {
  if (platform !== "win32") {
    return { ...source };
  }
  const result: NodeJS.ProcessEnv = {};
  const seen = new Set<string>();
  for (const key of Object.keys(source).sort()) {
    const value = source[key];
    const identity = key.toUpperCase();
    if (value === undefined || seen.has(identity)) {
      continue;
    }
    seen.add(identity);
    result[WINDOWS_KEY_SPELLINGS[identity] ?? key] = value;
  }
  return result;
}

/** Non-secret Windows runtime context needed by an independently started process. */
export const WINDOWS_RUNTIME_ENV_KEYS = [
  "SystemRoot",
  "ComSpec",
  "WINDIR",
  "PATHEXT",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "APPDATA",
  "LOCALAPPDATA",
  "TEMP",
  "TMP",
] as const;
