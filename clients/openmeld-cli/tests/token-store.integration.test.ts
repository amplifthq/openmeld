import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execFileMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
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

function createMockExecFileChild(stdoutText = ""): EventEmitter & {
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
    child.emit("close", 0);
  });
  return child;
}

describe("token-store command execution options", () => {
  beforeEach(() => {
    execFileMock.mockReset();
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

  it("passes timeout options to callback-based execFile path", async () => {
    await deleteAccessToken({
      provider: "macos-keychain",
      service: "svc",
      account: "acct",
    });

    const securityCall = execFileMock.mock.calls.find(
      (call) => call[0] === "security" && typeof call[3] === "function"
    );
    expect(securityCall).toBeDefined();
    expect(securityCall?.[2]).toEqual(
      expect.objectContaining({
        windowsHide: true,
        maxBuffer: COMMAND_MAX_BUFFER_BYTES,
        timeout: COMMAND_TIMEOUT_MS,
        encoding: "utf8",
      })
    );
  });

  it("reports missing macOS keychain tokens separately from unavailable keychain reads", async () => {
    setProcessPlatform("darwin");
    execFileMock.mockImplementationOnce(
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
        const error = Object.assign(new Error("not found"), {
          code: 44,
          stderr: "The specified item could not be found in the keychain.",
        });
        callback?.(error);
      }
    );
    await expect(
      readAccessToken({
        account: "acct",
        provider: "macos-keychain",
        service: "svc",
      })
    ).resolves.toEqual({ status: "missing" });

    execFileMock.mockImplementationOnce(
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
        const error = Object.assign(new Error("security failed"), {
          code: 1,
          stderr: "securityd unavailable",
        });
        callback?.(error);
      }
    );
    const unavailable = await readAccessToken({
      account: "acct",
      provider: "macos-keychain",
      service: "svc",
    });

    expect(unavailable.status).toBe("unavailable");
    expect(
      unavailable.status === "unavailable" ? unavailable.errorMessage : ""
    ).toContain("securityd unavailable");
  });

  it("passes timeout options to stdin-based execFile path", async () => {
    setProcessPlatform("win32");

    await withTempHome(async () => {
      await storeAccessToken({
        accessToken: "token-123",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
      });
    });

    const powershellCall = execFileMock.mock.calls.find(
      (call) => call[0] === "powershell.exe" && typeof call[3] !== "function"
    );
    expect(powershellCall).toBeDefined();
    expect(powershellCall?.[2]).toEqual(
      expect.objectContaining({
        windowsHide: true,
        maxBuffer: COMMAND_MAX_BUFFER_BYTES,
        timeout: COMMAND_TIMEOUT_MS,
      })
    );
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
    expect(firstRef).not.toEqual(secondRef);
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
  });
});
