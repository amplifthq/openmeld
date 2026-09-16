import { EventEmitter } from "node:events";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { inspect } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execFileMock = vi.hoisted(() => vi.fn());
const macOsNativeTokens = vi.hoisted(() => new Map<string, string>());
const macOsNativeKeychainState = vi.hoisted(() => ({
  binaryDistribution: true,
  storeError: null as Error | null,
}));

vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
}));

vi.mock("../src/runtime/distribution", () => ({
  isBinaryDistribution: () => macOsNativeKeychainState.binaryDistribution,
}));

vi.mock("../src/config/macos-native-keychain", () => ({
  getMacOsKeychainRetryAfterMs: () => 0,
  deleteMacOsNativeKeychainToken: vi.fn(
    (input: { account: string; service: string }) => {
      macOsNativeTokens.delete(`${input.service}\n${input.account}`);
    }
  ),
  readMacOsNativeKeychainToken: vi.fn(
    (input: { account: string; service: string }) =>
      macOsNativeTokens.get(`${input.service}\n${input.account}`) ?? null
  ),
  storeMacOsNativeKeychainToken: vi.fn(
    (input: { accessToken: string; account: string; service: string }) => {
      if (macOsNativeKeychainState.storeError) {
        throw macOsNativeKeychainState.storeError;
      }
      macOsNativeTokens.set(
        `${input.service}\n${input.account}`,
        input.accessToken
      );
    }
  ),
}));

import {
  deleteAccessToken,
  isStoredTokenRef,
  readAccessToken,
  storeAccessToken,
} from "../src/config/token-store";
import { withTempHome } from "./helpers/fs";

const ORIGINAL_PLATFORM = process.platform;
const COMMAND_TIMEOUT_MS = 30_000;
const COMMAND_MAX_BUFFER_BYTES = 1024 * 1024;

function setProcessPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", {
    value,
    configurable: true,
  });
}

function createMockExecFileChild(
  stdoutText = "",
  failure?: {
    code: number | null;
    stderr?: string;
    error?: NodeJS.ErrnoException;
  }
): EventEmitter & {
  stdout: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
  stderr: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
  stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
} {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
    stderr: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
    stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
  };
  const stdout = new EventEmitter() as EventEmitter & {
    setEncoding: ReturnType<typeof vi.fn>;
  };
  const stderr = new EventEmitter() as EventEmitter & {
    setEncoding: ReturnType<typeof vi.fn>;
  };
  stdout.setEncoding = vi.fn();
  stderr.setEncoding = vi.fn();
  child.stdout = stdout;
  child.stderr = stderr;
  child.stdin = {
    write: vi.fn(),
    end: vi.fn(),
  };

  queueMicrotask(() => {
    if (stdoutText.length > 0) {
      child.stdout.emit("data", stdoutText);
    }
    if (failure?.stderr) {
      child.stderr.emit("data", failure.stderr);
    }
    if (failure?.error) {
      child.emit("error", failure.error);
    }
    child.emit("close", failure ? failure.code : 0);
  });
  return child;
}

describe("token-store command execution options", () => {
  beforeEach(() => {
    execFileMock.mockReset();
    macOsNativeTokens.clear();
    macOsNativeKeychainState.binaryDistribution = true;
    macOsNativeKeychainState.storeError = null;
    execFileMock.mockImplementation(
      (
        _command: string,
        _args: string[],
        _options: Record<string, unknown>,
        callback?: (
          error: Error | null,
          stdout?: string | Buffer,
          stderr?: string | Buffer
        ) => void
      ) => {
        if (typeof callback === "function") {
          callback(null, "", "");
          return undefined;
        }
        return createMockExecFileChild("encrypted-value");
      }
    );
  });

  afterEach(() => {
    setProcessPlatform(ORIGINAL_PLATFORM);
    vi.restoreAllMocks();
  });

  it("does not read or delete Keychain items through the interactive security CLI", async () => {
    setProcessPlatform("darwin");
    macOsNativeKeychainState.binaryDistribution = false;

    await expect(
      readAccessToken({
        account: "acct",
        provider: "macos-keychain",
        service: "svc",
      })
    ).resolves.toMatchObject({
      status: "unavailable",
      errorMessage: expect.stringContaining(
        "will not open an authorization window"
      ),
    });

    await expect(
      deleteAccessToken({
        account: "acct",
        provider: "macos-keychain",
        service: "svc",
      })
    ).rejects.toThrow("unavailable in this OpenMeld distribution");

    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("loads DPAPI in each fresh PowerShell process and keeps credentials on stdin", async () => {
    setProcessPlatform("win32");

    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_ALLOW_INSECURE_FILE_TOKEN = undefined;
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = undefined;
      const ref = await storeAccessToken({
        accessToken: "token-123",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
      });
      await readAccessToken(ref);
    });

    const powershellCalls = execFileMock.mock.calls.filter(
      (call) => call[0] === "powershell.exe" && typeof call[3] !== "function"
    );
    expect(powershellCalls).toHaveLength(2);
    for (const powershellCall of powershellCalls) {
      const args = powershellCall[1] as string[];
      const script = args.at(-1) ?? "";
      const loadIndex = script.indexOf(
        "Add-Type -AssemblyName System.Security -ErrorAction Stop"
      );
      expect(loadIndex).toBeGreaterThanOrEqual(0);
      expect(loadIndex).toBeLessThan(
        script.indexOf("[System.Security.Cryptography.ProtectedData]")
      );
      expect(args.join(" ")).not.toContain("token-123");
      expect(args).toContain("-NoProfile");
      expect(powershellCall[2]).toEqual(
        expect.objectContaining({
          windowsHide: true,
          maxBuffer: COMMAND_MAX_BUFFER_BYTES,
          timeout: COMMAND_TIMEOUT_MS,
        })
      );
    }
  });

  it.each([
    {
      code: 1,
      stderr: "OPENMELD_DPAPI_ASSEMBLY_LOAD_FAILED\r\n",
      reason: "Windows credential encryption could not be initialized",
      diagnosticCode: "1",
    },
    {
      code: 1,
      stderr: "OPENMELD_DPAPI_OPERATION_FAILED\r\n",
      reason: "Windows could not encrypt or decrypt the stored credential",
      diagnosticCode: "1",
    },
    {
      code: 9,
      stderr: "private-token-in-stderr",
      reason: "PowerShell did not complete the credential operation",
      diagnosticCode: "9",
    },
    {
      code: null,
      stderr: "",
      reason: "PowerShell did not complete the credential operation",
      diagnosticCode: "no exit code",
    },
    {
      code: -2,
      error: Object.assign(new Error("private-token-in-message"), {
        code: "ENOENT",
        stdout: "private-token-in-error-output",
      }),
      reason: "PowerShell could not be started",
      diagnosticCode: "ENOENT",
    },
  ])("reports safe credential failures: $diagnosticCode / $reason", async ({
    code,
    stderr,
    error,
    reason,
    diagnosticCode,
  }) => {
    setProcessPlatform("win32");
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_ALLOW_INSECURE_FILE_TOKEN = undefined;
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = undefined;
      const ref = await storeAccessToken({
        accessToken: "private-token-on-stdin",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
      });
      execFileMock.mockImplementation(() =>
        createMockExecFileChild("private-token-on-stdout", {
          code,
          stderr,
          error,
        })
      );
      const read = await readAccessToken(ref);
      expect(read.status).toBe("unavailable");
      if (read.status !== "unavailable") {
        throw new Error("Expected a credential read failure");
      }
      const storeError = await storeAccessToken({
        accessToken: "private-token-on-stdin",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
      }).catch((failure: unknown) => failure);
      expect(storeError).toBeInstanceOf(Error);
      expect((storeError as Error).cause).toMatchObject({
        code: error?.code ?? code,
      });
      for (const message of [
        read.errorMessage,
        (storeError as Error).message,
      ]) {
        expect(message).toContain(reason);
        expect(message).toContain(diagnosticCode);
        expect(message.match(/command failed/gu)).toHaveLength(1);
        expect(message).not.toContain("private-token");
      }
      expect(inspect(storeError, { depth: null })).not.toContain(
        "private-token"
      );
      await deleteAccessToken(ref);
      expect(await readAccessToken(ref)).toEqual({ status: "missing" });
    });
  });

  it("isolates native token refs by OPENMELD_HOME", async () => {
    setProcessPlatform("darwin");

    const firstRef = await withTempHome(async () =>
      storeAccessToken({
        accessToken: "token-1",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
      })
    );
    const secondRef = await withTempHome(async () =>
      storeAccessToken({
        accessToken: "token-2",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
      })
    );

    expect(firstRef.provider).toBe("macos-keychain");
    expect(secondRef.provider).toBe("macos-keychain");
    expect(firstRef).not.toHaveProperty("accessGroup");
    expect(secondRef).not.toHaveProperty("accessGroup");
    expect(firstRef).not.toEqual(secondRef);
    expect(execFileMock).not.toHaveBeenCalledWith(
      "security",
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
  });

  it("keeps setup usable with an explicit private-file fallback when macOS Keychain is unavailable", async () => {
    setProcessPlatform("darwin");
    macOsNativeKeychainState.storeError = new Error("securityd unavailable");
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    await withTempHome(async (home) => {
      const ref = await storeAccessToken({
        accessToken: "token-private",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
      });

      expect(ref.provider).toBe("insecure-file");
      if (ref.provider !== "insecure-file") {
        throw new Error("Expected the private macOS token fallback.");
      }
      await expect(readAccessToken(ref)).resolves.toEqual({
        accessToken: "token-private",
        status: "found",
      });
      const tokenDirectory = join(home, ".openmeld", "auth", "tokens");
      const tokenFile = join(tokenDirectory, `${ref.key}.token`);
      expect((await stat(tokenDirectory)).mode % 0o1000).toBe(0o700);
      expect((await stat(tokenFile)).mode % 0o1000).toBe(0o600);

      const replacementRef = await storeAccessToken({
        accessToken: "token-private-replacement",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
      });
      expect(replacementRef.provider).toBe("insecure-file");
      expect(replacementRef).not.toEqual(ref);
      await expect(readAccessToken(ref)).resolves.toEqual({
        accessToken: "token-private",
        status: "found",
      });
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("macOS Keychain is unavailable")
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("protected for your macOS user account")
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "This session stays in private local storage unless a later sign-in replaces it."
      )
    );
    expect(String(warnSpy.mock.calls[0]?.[0] ?? "")).not.toContain(
      "A future successful setup or login will move"
    );
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("uses private local storage instead of the interactive security CLI in an npm distribution", async () => {
    vi.resetModules();
    setProcessPlatform("darwin");
    macOsNativeKeychainState.binaryDistribution = false;
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const {
      readAccessToken: readNpmAccessToken,
      storeAccessToken: storeNpmAccessToken,
    } = await import("../src/config/token-store");

    await withTempHome(async () => {
      const replacementRef = await storeNpmAccessToken({
        accessToken: "replacement-token",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
      });
      expect(replacementRef.provider).toBe("insecure-file");
      await expect(readNpmAccessToken(replacementRef)).resolves.toEqual({
        accessToken: "replacement-token",
        status: "found",
      });
    });

    expect(execFileMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "This npm installation cannot use macOS Keychain."
      )
    );
    expect(String(warnSpy.mock.calls[0]?.[0] ?? "")).not.toContain(
      "A future successful setup or login will move"
    );
  });

  it("warns once when plaintext file-token fallback is used", async () => {
    vi.resetModules();
    const { storeAccessToken: reloadedStoreAccessToken } = await import(
      "../src/config/token-store"
    );
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    setProcessPlatform("linux");

    await withTempHome(async () => {
      await reloadedStoreAccessToken({
        accessToken: "token-1",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
      });
      await reloadedStoreAccessToken({
        accessToken: "token-2",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
      });
    });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]?.[0] ?? "")).toContain(
      "OPENMELD_AUTH_ALLOW_INSECURE_FILE_TOKEN"
    );
  });

  it("rejects tampered file-backed token refs with unsafe keys", () => {
    expect(
      isStoredTokenRef({
        provider: "insecure-file",
        key: "../escape",
      })
    ).toBe(false);
    expect(
      isStoredTokenRef({
        provider: "windows-dpapi",
        key: "not-a-sha256-key",
      })
    ).toBe(false);
    expect(
      isStoredTokenRef({
        accessGroup: "attacker.example",
        account: "openmeld-auth-test",
        provider: "macos-keychain",
        service: "sh.openmeld.auth.token",
      })
    ).toBe(false);
  });
});
