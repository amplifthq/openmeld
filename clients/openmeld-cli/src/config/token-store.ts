import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { openMeldRootDir } from "./paths";

const TOKEN_STORE_KEYCHAIN_SERVICE = "sh.openmeld.auth.token";
const INSECURE_FALLBACK_ENV_KEY = "OPENMELD_AUTH_ALLOW_INSECURE_FILE_TOKEN";
const FORCE_INSECURE_STORE_ENV_KEY = "OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN";
const COMMAND_MAX_BUFFER_BYTES = 1024 * 1024;
const COMMAND_TIMEOUT_MS = 30_000;
const TOKEN_FILE_KEY_PATTERN = /^[a-f0-9]{64}$/u;
const EXEC_FILE_BASE_OPTIONS = {
  windowsHide: true,
  maxBuffer: COMMAND_MAX_BUFFER_BYTES,
  timeout: COMMAND_TIMEOUT_MS,
} as const;
let insecureFallbackWarningShown = false;

type MacOsTokenRef = {
  provider: "macos-keychain";
  service: string;
  account: string;
};

type WindowsDpapiTokenRef = {
  provider: "windows-dpapi";
  key: string;
};

type InsecureFileTokenRef = {
  provider: "insecure-file";
  key: string;
};

export type StoredTokenRef =
  | MacOsTokenRef
  | WindowsDpapiTokenRef
  | InsecureFileTokenRef;

export type AccessTokenReadResult =
  | {
      accessToken: string;
      status: "found";
    }
  | {
      status: "missing";
    }
  | {
      errorMessage: string;
      status: "unavailable";
    };

type StoreTokenInput = {
  accessToken: string;
  authBaseUrl: string;
  clientId: string;
};

export async function storeAccessToken(
  input: StoreTokenInput
): Promise<StoredTokenRef> {
  const key = buildTokenKey({
    authBaseUrl: input.authBaseUrl,
    clientId: input.clientId,
  });

  if (shouldForceInsecureStore()) {
    await setInsecureFileToken({
      key,
      accessToken: input.accessToken,
    });
    return {
      provider: "insecure-file",
      key,
    };
  }

  if (process.platform === "darwin") {
    try {
      const account = buildMacOsAccount(key);
      await setMacOsKeychainToken({
        service: TOKEN_STORE_KEYCHAIN_SERVICE,
        account,
        accessToken: input.accessToken,
      });
      return {
        provider: "macos-keychain",
        service: TOKEN_STORE_KEYCHAIN_SERVICE,
        account,
      };
    } catch (error) {
      if (allowInsecureFallback()) {
        await setInsecureFileToken({
          key,
          accessToken: input.accessToken,
        });
        return {
          provider: "insecure-file",
          key,
        };
      }
      throw new Error(
        `failed to store access token in macOS Keychain: ${toErrorMessage(error)}`
      );
    }
  }

  if (process.platform === "win32") {
    try {
      await setWindowsDpapiToken({
        key,
        accessToken: input.accessToken,
      });
      return {
        provider: "windows-dpapi",
        key,
      };
    } catch (error) {
      if (allowInsecureFallback()) {
        await setInsecureFileToken({
          key,
          accessToken: input.accessToken,
        });
        return {
          provider: "insecure-file",
          key,
        };
      }
      throw new Error(
        `failed to store access token via Windows DPAPI: ${toErrorMessage(error)}`
      );
    }
  }

  if (allowInsecureFallback()) {
    await setInsecureFileToken({
      key,
      accessToken: input.accessToken,
    });
    return {
      provider: "insecure-file",
      key,
    };
  }

  throw new Error(
    `secure token storage is unavailable on platform "${process.platform}". ` +
      `Use ${INSECURE_FALLBACK_ENV_KEY}=1 only for local testing fallback.`
  );
}

export async function readAccessToken(
  ref: StoredTokenRef
): Promise<AccessTokenReadResult> {
  try {
    if (ref.provider === "macos-keychain") {
      return toAccessTokenReadResult(await getMacOsKeychainToken(ref));
    }
    if (ref.provider === "windows-dpapi") {
      return toAccessTokenReadResult(await getWindowsDpapiToken(ref));
    }
    if (ref.provider === "insecure-file") {
      return toAccessTokenReadResult(await getInsecureFileToken(ref));
    }
    return { status: "missing" };
  } catch (error) {
    return {
      errorMessage: toErrorMessage(error),
      status: "unavailable",
    };
  }
}

export async function deleteAccessToken(ref: StoredTokenRef): Promise<void> {
  if (ref.provider === "macos-keychain") {
    await deleteMacOsKeychainToken(ref).catch(() => undefined);
    return;
  }
  if (ref.provider === "windows-dpapi") {
    await deleteWindowsDpapiToken(ref).catch(() => undefined);
    return;
  }
  if (ref.provider === "insecure-file") {
    await deleteInsecureFileToken(ref).catch(() => undefined);
  }
}

export function isStoredTokenRef(value: unknown): value is StoredTokenRef {
  if (!(value && typeof value === "object")) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const provider = normalizeString(record.provider);
  if (provider === "macos-keychain") {
    return Boolean(
      normalizeString(record.service) && normalizeString(record.account)
    );
  }
  if (provider === "windows-dpapi" || provider === "insecure-file") {
    return normalizeTokenFileKey(record.key) !== null;
  }
  return false;
}

function buildTokenKey(input: {
  authBaseUrl: string;
  clientId: string;
}): string {
  const rootDir = resolve(openMeldRootDir());
  return createHash("sha256")
    .update(`${input.clientId}\n${input.authBaseUrl}\n${rootDir}`)
    .digest("hex");
}

function buildMacOsAccount(key: string): string {
  return `openmeld-auth-${key}`;
}

async function setMacOsKeychainToken(input: {
  service: string;
  account: string;
  accessToken: string;
}): Promise<void> {
  // Keep login non-interactive via the native `security` CLI integration.
  // This passes token via argv, which is a known exposure tradeoff.
  await runCommand("security", [
    "add-generic-password",
    "-U",
    "-a",
    input.account,
    "-s",
    input.service,
    "-w",
    input.accessToken,
  ]);
}

async function getMacOsKeychainToken(input: {
  service: string;
  account: string;
}): Promise<string | null> {
  try {
    const result = await runCommand("security", [
      "find-generic-password",
      "-a",
      input.account,
      "-s",
      input.service,
      "-w",
    ]);
    return result.stdout.trim();
  } catch (error) {
    if (isMacOsNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

async function deleteMacOsKeychainToken(input: {
  service: string;
  account: string;
}): Promise<void> {
  try {
    await runCommand("security", [
      "delete-generic-password",
      "-a",
      input.account,
      "-s",
      input.service,
    ]);
  } catch (error) {
    if (isMacOsNotFoundError(error)) {
      return;
    }
    throw error;
  }
}

async function setWindowsDpapiToken(input: {
  key: string;
  accessToken: string;
}): Promise<void> {
  const encrypted = await runPowerShellScript(
    WINDOWS_DPAPI_ENCRYPT_SCRIPT,
    input.accessToken,
    input.key
  );
  await mkdir(tokenDirectoryPath(), { recursive: true });
  // NOTE: `mode: 0o600` is POSIX-only and Windows ignores it.
  // For `tokenDirectoryPath()` + `windowsDpapiTokenPath()` we rely on DPAPI
  // and Windows ACLs for equivalent protection.
  await writeFile(windowsDpapiTokenPath(input.key), `${encrypted.trim()}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

async function getWindowsDpapiToken(input: {
  key: string;
}): Promise<string | null> {
  const encrypted = await readFile(
    windowsDpapiTokenPath(input.key),
    "utf8"
  ).catch((error) => {
    if (isFileNotFoundError(error)) {
      return null;
    }
    throw error;
  });
  if (!encrypted) {
    return null;
  }
  return runPowerShellScript(
    WINDOWS_DPAPI_DECRYPT_SCRIPT,
    encrypted.trim(),
    input.key
  );
}

async function deleteWindowsDpapiToken(input: { key: string }): Promise<void> {
  await rm(windowsDpapiTokenPath(input.key), { force: true });
}

async function setInsecureFileToken(input: {
  key: string;
  accessToken: string;
}): Promise<void> {
  await mkdir(tokenDirectoryPath(), { recursive: true });
  await writeFile(insecureTokenPath(input.key), `${input.accessToken}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

async function getInsecureFileToken(input: {
  key: string;
}): Promise<string | null> {
  const raw = await readFile(insecureTokenPath(input.key), "utf8").catch(
    (error) => {
      if (isFileNotFoundError(error)) {
        return null;
      }
      throw error;
    }
  );
  return raw ? raw.trim() : null;
}

async function deleteInsecureFileToken(input: { key: string }): Promise<void> {
  await rm(insecureTokenPath(input.key), { force: true });
}

function tokenDirectoryPath(): string {
  return join(openMeldRootDir(), "auth", "tokens");
}

function windowsDpapiTokenPath(key: string): string {
  return join(tokenDirectoryPath(), `${requireValidTokenFileKey(key)}.dpapi`);
}

function insecureTokenPath(key: string): string {
  return join(tokenDirectoryPath(), `${requireValidTokenFileKey(key)}.token`);
}

function allowInsecureFallback(): boolean {
  if (process.env[INSECURE_FALLBACK_ENV_KEY] === "1") {
    warnInsecureFallback("env");
    return true;
  }
  // Known downgrade behavior:
  // On platforms without native secure-store support, OpenMeld currently falls back
  // to local file token storage by default for compatibility.
  const fallbackEnabled = !isNativeSecureStorePlatform();
  if (fallbackEnabled) {
    warnInsecureFallback("platform");
  }
  return fallbackEnabled;
}

function warnInsecureFallback(reason: "env" | "platform"): void {
  if (insecureFallbackWarningShown) {
    return;
  }
  insecureFallbackWarningShown = true;

  const reasonText =
    reason === "env"
      ? `enabled by ${INSECURE_FALLBACK_ENV_KEY}=1`
      : `enabled automatically on platform "${process.platform}"`;
  console.warn(
    `[openmeld auth] plaintext file token storage fallback is active (${reasonText}). ` +
      `Unset ${INSECURE_FALLBACK_ENV_KEY} to disable explicit opt-in, ` +
      "and prefer macOS or Windows for native secure token storage."
  );
}

function shouldForceInsecureStore(): boolean {
  return process.env[FORCE_INSECURE_STORE_ENV_KEY] === "1";
}

function isNativeSecureStorePlatform(): boolean {
  return process.platform === "darwin" || process.platform === "win32";
}

async function runPowerShellScript(
  script: string,
  token: string,
  entropy: string
): Promise<string> {
  const payload = JSON.stringify({ token, entropy });
  const result = await runCommand(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      script,
    ],
    payload
  );
  return result.stdout.trim();
}

async function runCommand(
  command: string,
  args: string[],
  stdinPayload?: string
): Promise<{ stdout: string; stderr: string }> {
  try {
    if (stdinPayload === undefined) {
      const output = await runExecFile(command, args);
      return output;
    }

    const { execFile } = await import("node:child_process");
    const output = await new Promise<{ stdout: string; stderr: string }>(
      (resolve, reject) => {
        let stdout = "";
        let stderr = "";

        const child = execFile(command, args, { ...EXEC_FILE_BASE_OPTIONS });

        child.stdout?.setEncoding("utf8");
        child.stderr?.setEncoding("utf8");
        child.stdout?.on("data", (chunk: unknown) => {
          stdout += String(chunk);
        });
        child.stderr?.on("data", (chunk: unknown) => {
          stderr += String(chunk);
        });

        child.on("error", (error) => {
          reject(toCommandError(error, command));
        });

        child.on("close", (code) => {
          if (code === 0) {
            resolve({ stdout, stderr });
            return;
          }
          reject(
            toCommandError(
              {
                message: `command failed (${command}) with exit code ${code}`,
              },
              command
            )
          );
        });

        child.stdin?.write(stdinPayload);
        child.stdin?.end();
      }
    );
    return output;
  } catch (error) {
    throw toCommandError(error, command);
  }
}

async function runExecFile(
  command: string,
  args: string[]
): Promise<{ stdout: string; stderr: string }> {
  const { execFile } = await import("node:child_process");
  const output = await new Promise<{ stdout: string; stderr: string }>(
    (resolve, reject) => {
      execFile(
        command,
        args,
        {
          ...EXEC_FILE_BASE_OPTIONS,
          encoding: "utf8",
        },
        (error, stdout, stderr) => {
          if (error) {
            reject(toCommandError(error, command));
            return;
          }
          resolve({
            stdout: String(stdout ?? ""),
            stderr: String(stderr ?? ""),
          });
        }
      );
    }
  );
  return output;
}

function toCommandError(
  error: unknown,
  command: string
): Error & { code?: number | null; stdout?: string; stderr?: string } {
  if (!(error && typeof error === "object")) {
    return new Error(`command failed (${command}): ${String(error)}`);
  }
  const e = error as NodeJS.ErrnoException & {
    stdout?: string;
    stderr?: string;
    code?: number | null | string;
  };
  const code = typeof e.code === "number" ? e.code : null;
  const messageParts = [`command failed (${command})`];
  if (typeof e.stderr === "string" && e.stderr.trim()) {
    messageParts.push(`stderr: ${e.stderr.trim()}`);
  } else if (e.message) {
    messageParts.push(e.message);
  }
  const wrapped = new Error(messageParts.join("; ")) as Error & {
    code?: number | null;
    stdout?: string;
    stderr?: string;
  };
  wrapped.code = code;
  wrapped.stdout = e.stdout;
  wrapped.stderr = e.stderr;
  return wrapped;
}

function isMacOsNotFoundError(error: unknown): boolean {
  if (!(error && typeof error === "object")) {
    return false;
  }
  const record = error as { stderr?: string; message?: string; code?: number };
  const text = `${record.stderr ?? ""} ${record.message ?? ""}`.toLowerCase();
  return (
    record.code === 44 ||
    text.includes("could not be found in the keychain") ||
    text.includes("the specified item could not be found")
  );
}

function normalizeString(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeTokenFileKey(value: unknown): string | null {
  const normalized = normalizeString(value);
  if (!TOKEN_FILE_KEY_PATTERN.test(normalized)) {
    return null;
  }
  return normalized;
}

function requireValidTokenFileKey(value: unknown): string {
  const normalized = normalizeTokenFileKey(value);
  if (normalized === null) {
    throw new Error("stored token key is invalid");
  }
  return normalized;
}

function normalizeToken(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function toAccessTokenReadResult(value: string | null): AccessTokenReadResult {
  const accessToken = normalizeToken(value);
  if (!accessToken) {
    return { status: "missing" };
  }
  return {
    accessToken,
    status: "found",
  };
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function isFileNotFoundError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
  );
}

const WINDOWS_DPAPI_ENCRYPT_SCRIPT = [
  "$ErrorActionPreference='Stop'",
  "$rawInput = [Console]::In.ReadToEnd()",
  "$payload = $rawInput | ConvertFrom-Json",
  "$plain=[System.Text.Encoding]::UTF8.GetBytes($payload.token)",
  "$entropy=[System.Text.Encoding]::UTF8.GetBytes($payload.entropy)",
  "$cipher=[System.Security.Cryptography.ProtectedData]::Protect($plain,$entropy,[System.Security.Cryptography.DataProtectionScope]::CurrentUser)",
  "[System.Convert]::ToBase64String($cipher)",
].join(";");

const WINDOWS_DPAPI_DECRYPT_SCRIPT = [
  "$ErrorActionPreference='Stop'",
  "$rawInput = [Console]::In.ReadToEnd()",
  "$payload = $rawInput | ConvertFrom-Json",
  "$cipher=[System.Convert]::FromBase64String($payload.token)",
  "$entropy=[System.Text.Encoding]::UTF8.GetBytes($payload.entropy)",
  "$plain=[System.Security.Cryptography.ProtectedData]::Unprotect($cipher,$entropy,[System.Security.Cryptography.DataProtectionScope]::CurrentUser)",
  "[System.Text.Encoding]::UTF8.GetString($plain)",
].join(";");
