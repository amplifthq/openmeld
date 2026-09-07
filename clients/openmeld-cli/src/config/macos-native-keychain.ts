import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  MAC_OS_KEYCHAIN_AUTHENTICATION_INTERACTION,
  MAC_OS_KEYCHAIN_HELPER_SCHEMA_VERSION,
  type MacOsKeychainHelperRequest,
  macOsKeychainHelperRequestSchema,
  macOsKeychainHelperResponseSchema,
} from "@openmeld/schemas";
import { isBinaryDistribution } from "../runtime/distribution";

const MAC_OS_KEYCHAIN_HELPER_ARG = "__openmeld_macos_keychain_helper";
const HELPER_OUTPUT_MAX_BYTES = 128 * 1024;
const OS_STATUS_PATTERN = /OSStatus (-?\d+)/u;
export const MAC_OS_KEYCHAIN_HELPER_TIMEOUT_MS = 5000;

type MacOsKeychainAddon = {
  isParentSameExecutable(): boolean;
  read(service: string, account: string): string | null;
  remove(service: string, account: string): void;
  store(service: string, account: string, accessToken: string): void;
};

type KeychainAddress = {
  account: string;
  service: string;
};

type MacOsKeychainHelperRequestInput =
  | Omit<
      Extract<MacOsKeychainHelperRequest, { operation: "read" }>,
      "authenticationInteraction" | "schemaVersion"
    >
  | Omit<
      Extract<MacOsKeychainHelperRequest, { operation: "store" }>,
      "authenticationInteraction" | "schemaVersion"
    >
  | Omit<
      Extract<MacOsKeychainHelperRequest, { operation: "delete" }>,
      "authenticationInteraction" | "schemaVersion"
    >;
type MacOsKeychainHelperReadRequestInput = Extract<
  MacOsKeychainHelperRequestInput,
  { operation: "read" }
>;
type MacOsKeychainHelperMutationRequestInput = Exclude<
  MacOsKeychainHelperRequestInput,
  MacOsKeychainHelperReadRequestInput
>;

let loadedAddon: MacOsKeychainAddon | null = null;
let unresponsiveKeychainError: Error | null = null;
let keychainRetryAt = 0;
let lastKeychainFailureCode: string | null = null;
export const MAC_OS_KEYCHAIN_RETRY_DELAY_MS = 30_000;

export async function storeMacOsNativeKeychainToken(
  input: KeychainAddress & { accessToken: string }
): Promise<void> {
  if (isBinaryDistribution()) {
    await runBoundedMacOsNativeKeychainRequest({
      operation: "store",
      service: input.service,
      account: input.account,
      accessToken: input.accessToken,
    });
    return;
  }
  const addon = await loadAddon();
  addon.store(input.service, input.account, input.accessToken);
}

export async function readMacOsNativeKeychainToken(
  input: KeychainAddress
): Promise<string | null> {
  if (isBinaryDistribution()) {
    return await runBoundedMacOsNativeKeychainRequest({
      operation: "read",
      service: input.service,
      account: input.account,
    });
  }
  const addon = await loadAddon();
  return addon.read(input.service, input.account);
}

export async function deleteMacOsNativeKeychainToken(
  input: KeychainAddress
): Promise<void> {
  if (isBinaryDistribution()) {
    await runBoundedMacOsNativeKeychainRequest({
      operation: "delete",
      service: input.service,
      account: input.account,
    });
    return;
  }
  const addon = await loadAddon();
  addon.remove(input.service, input.account);
}

export function runMacOsNativeKeychainRequestInChild(
  input: MacOsKeychainHelperReadRequestInput,
  options?: { timeoutMs?: number }
): Promise<string | null>;
export function runMacOsNativeKeychainRequestInChild(
  input: MacOsKeychainHelperMutationRequestInput,
  options?: { timeoutMs?: number }
): Promise<undefined>;
export async function runMacOsNativeKeychainRequestInChild(
  input: MacOsKeychainHelperRequestInput,
  options: { timeoutMs?: number } = {}
): Promise<string | null | undefined> {
  const request = macOsKeychainHelperRequestSchema.parse({
    schemaVersion: MAC_OS_KEYCHAIN_HELPER_SCHEMA_VERSION,
    authenticationInteraction: MAC_OS_KEYCHAIN_AUTHENTICATION_INTERACTION,
    ...input,
  });
  const timeoutMs = options.timeoutMs ?? MAC_OS_KEYCHAIN_HELPER_TIMEOUT_MS;
  if (!(Number.isSafeInteger(timeoutMs) && timeoutMs > 0)) {
    throw new Error("macOS Keychain helper timeout must be a positive integer");
  }

  return await new Promise<string | null | undefined>((resolve, reject) => {
    const child = spawn(process.execPath, [MAC_OS_KEYCHAIN_HELPER_ARG], {
      env: process.env,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let settled = false;
    let stdout = "";
    let stderr = "";

    const clearDeadline = () => {
      clearTimeout(deadline);
    };
    const rejectOnce = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearDeadline();
      reject(error);
    };
    const deadline = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill("SIGKILL");
      reject(
        new MacOsNativeKeychainTimeoutError(
          `macOS Keychain did not respond within ${formatTimeout(timeoutMs)}`
        )
      );
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: unknown) => {
      stdout += String(chunk);
      if (Buffer.byteLength(stdout, "utf8") > HELPER_OUTPUT_MAX_BYTES) {
        child.kill("SIGKILL");
        rejectOnce(new Error("macOS Keychain helper output was too large"));
      }
    });
    child.stderr.on("data", (chunk: unknown) => {
      stderr += String(chunk);
      if (Buffer.byteLength(stderr, "utf8") > HELPER_OUTPUT_MAX_BYTES) {
        stderr = stderr.slice(-HELPER_OUTPUT_MAX_BYTES);
      }
    });
    child.once("error", (error) => {
      rejectOnce(
        new Error(
          `macOS Keychain helper could not start: ${toErrorMessage(error)}`
        )
      );
    });
    child.stdin.once("error", (error) => {
      rejectOnce(
        new Error(
          `macOS Keychain helper input failed: ${toErrorMessage(error)}`
        )
      );
    });
    child.once("close", (code) => {
      if (settled) {
        return;
      }
      clearDeadline();
      settled = true;
      try {
        resolve(
          parseMacOsKeychainHelperResult({
            code,
            operation: request.operation,
            stderr,
            stdout,
          })
        );
      } catch (error) {
        reject(toError(error));
      }
    });

    child.stdin.end(JSON.stringify(request), "utf8");
  });
}

export async function runMacOsNativeKeychainHelperIfRequested(
  argv: readonly string[] = process.argv
): Promise<boolean> {
  if (!argv.includes(MAC_OS_KEYCHAIN_HELPER_ARG)) {
    return false;
  }
  if (!(isBinaryDistribution() && process.platform === "darwin")) {
    throw new Error(
      "the internal macOS Keychain helper is only available in the macOS binary"
    );
  }

  const addon = await loadAddon();
  if (!addon.isParentSameExecutable()) {
    throw new Error(
      "the internal macOS Keychain helper is reserved for an OpenMeld child process"
    );
  }

  const rawRequest = await readHelperStdin();
  let json: unknown;
  try {
    json = JSON.parse(rawRequest);
  } catch {
    throw new Error("invalid macOS Keychain helper request");
  }
  const request = macOsKeychainHelperRequestSchema.safeParse(json);
  if (!request.success) {
    throw new Error("invalid macOS Keychain helper request");
  }

  const response = await executeHelperRequest(request.data).catch((error) => ({
    schemaVersion: MAC_OS_KEYCHAIN_HELPER_SCHEMA_VERSION,
    ok: false as const,
    operation: request.data.operation,
    errorMessage: truncateErrorMessage(toErrorMessage(error)),
  }));
  process.stdout.write(JSON.stringify(response));
  return true;
}

async function runBoundedMacOsNativeKeychainRequest(
  input: MacOsKeychainHelperReadRequestInput
): Promise<string | null>;
async function runBoundedMacOsNativeKeychainRequest(
  input: MacOsKeychainHelperMutationRequestInput
): Promise<undefined>;
async function runBoundedMacOsNativeKeychainRequest(
  input: MacOsKeychainHelperRequestInput
): Promise<string | null | undefined> {
  if (unresponsiveKeychainError && Date.now() < keychainRetryAt) {
    throw unresponsiveKeychainError;
  }
  try {
    if (input.operation === "read") {
      const result = await runMacOsNativeKeychainRequestInChild(input);
      noteKeychainRecovery();
      return result;
    }
    await runMacOsNativeKeychainRequestInChild(input);
    noteKeychainRecovery();
  } catch (error) {
    const timedOut = error instanceof MacOsNativeKeychainTimeoutError;
    if (error instanceof MacOsNativeKeychainTimeoutError) {
      unresponsiveKeychainError = error;
      keychainRetryAt = Date.now() + MAC_OS_KEYCHAIN_RETRY_DELAY_MS;
    }
    const osStatus = OS_STATUS_PATTERN.exec(toErrorMessage(error))?.[1];
    let reasonCode = osStatus ? "keychain_os_error" : "keychain_helper_failed";
    if (timedOut) {
      reasonCode = "keychain_helper_timeout";
    }
    const failureCode = `${reasonCode}:${osStatus ?? "none"}`;
    if (lastKeychainFailureCode !== failureCode) {
      lastKeychainFailureCode = failureCode;
      console.warn(
        JSON.stringify({
          event: "cli.keychain.readiness_failed",
          observedAt: new Date().toISOString(),
          reasonCode,
          ...(osStatus ? { osStatus: Number(osStatus) } : {}),
          operation: input.operation,
          timeoutMs: MAC_OS_KEYCHAIN_HELPER_TIMEOUT_MS,
          ...(timedOut ? { retryAfterMs: MAC_OS_KEYCHAIN_RETRY_DELAY_MS } : {}),
        })
      );
    }
    throw error;
  }
}

function noteKeychainRecovery(): void {
  if (lastKeychainFailureCode) {
    console.warn(
      JSON.stringify({
        event: "cli.keychain.readiness_recovered",
        observedAt: new Date().toISOString(),
      })
    );
  }
  unresponsiveKeychainError = null;
  keychainRetryAt = 0;
  lastKeychainFailureCode = null;
}

function parseMacOsKeychainHelperResult(input: {
  code: number | null;
  operation: MacOsKeychainHelperRequest["operation"];
  stderr: string;
  stdout: string;
}): string | null | undefined {
  if (input.code !== 0) {
    throw new Error(
      `macOS Keychain helper exited with code ${input.code ?? "unknown"}${
        input.stderr.trim() ? `: ${input.stderr.trim()}` : ""
      }`
    );
  }

  let rawResponse: unknown;
  try {
    rawResponse = JSON.parse(input.stdout);
  } catch {
    throw new Error("macOS Keychain helper returned an invalid response");
  }
  const parsed = macOsKeychainHelperResponseSchema.safeParse(rawResponse);
  if (!(parsed.success && parsed.data.operation === input.operation)) {
    throw new Error("macOS Keychain helper returned an invalid response");
  }
  if (!parsed.data.ok) {
    throw new Error(parsed.data.errorMessage);
  }
  return parsed.data.operation === "read" ? parsed.data.accessToken : undefined;
}

async function executeHelperRequest(input: MacOsKeychainHelperRequest) {
  const addon = await loadAddon();
  if (input.operation === "store") {
    addon.store(input.service, input.account, input.accessToken);
    return {
      schemaVersion: MAC_OS_KEYCHAIN_HELPER_SCHEMA_VERSION,
      ok: true as const,
      operation: "store" as const,
    };
  }
  if (input.operation === "delete") {
    addon.remove(input.service, input.account);
    return {
      schemaVersion: MAC_OS_KEYCHAIN_HELPER_SCHEMA_VERSION,
      ok: true as const,
      operation: "delete" as const,
    };
  }
  return {
    schemaVersion: MAC_OS_KEYCHAIN_HELPER_SCHEMA_VERSION,
    ok: true as const,
    operation: "read" as const,
    accessToken: addon.read(input.service, input.account),
  };
}

async function readHelperStdin(): Promise<string> {
  let raw = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    raw += String(chunk);
    if (Buffer.byteLength(raw, "utf8") > HELPER_OUTPUT_MAX_BYTES) {
      throw new Error("macOS Keychain helper request was too large");
    }
  }
  return raw;
}

function truncateErrorMessage(message: string): string {
  const normalized = message.trim() || "macOS Keychain operation failed";
  return normalized.slice(0, 2048);
}

function formatTimeout(timeoutMs: number): string {
  return timeoutMs % 1000 === 0
    ? `${timeoutMs / 1000} seconds`
    : `${timeoutMs} ms`;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

class MacOsNativeKeychainTimeoutError extends Error {
  override readonly name = "MacOsNativeKeychainTimeoutError";
}

async function loadAddon(): Promise<MacOsKeychainAddon> {
  if (loadedAddon) {
    return loadedAddon;
  }
  if (process.platform !== "darwin") {
    throw new Error("macOS Keychain is only available on macOS");
  }

  if (isBinaryDistribution()) {
    const embedded = await import("./macos-native-keychain-embedded");
    loadedAddon = embedded.loadEmbeddedMacOsKeychainAddon();
    return loadedAddon;
  }

  const require = createRequire(import.meta.url);
  const addonPath = fileURLToPath(
    new URL("./native/openmeld-keychain.node", import.meta.url)
  );
  loadedAddon = require(addonPath) as MacOsKeychainAddon;
  return loadedAddon;
}
