import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { MAC_OS_KEYCHAIN_HELPER_SCHEMA_VERSION } from "@openmeld/schemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());
const embeddedAddonMock = vi.hoisted(() => ({
  isParentSameExecutable: vi.fn(() => true),
  read: vi.fn(() => "stored-access-token"),
  remove: vi.fn(),
  store: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

vi.mock("../src/runtime/distribution", () => ({
  isBinaryDistribution: () => true,
}));

vi.mock("../src/config/macos-native-keychain-embedded", () => ({
  loadEmbeddedMacOsKeychainAddon: () => embeddedAddonMock,
}));

import {
  MAC_OS_KEYCHAIN_HELPER_TIMEOUT_MS,
  runMacOsNativeKeychainHelperIfRequested,
  runMacOsNativeKeychainRequestInChild,
} from "../src/config/macos-native-keychain";

const ORIGINAL_PLATFORM = process.platform;

function setProcessPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", {
    configurable: true,
    value,
  });
}

type MockChild = EventEmitter & {
  kill: ReturnType<typeof vi.fn>;
  stderr: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
  stdin: EventEmitter & { end: ReturnType<typeof vi.fn> };
  stdout: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
};

function createMockChild(): MockChild {
  const child = new EventEmitter() as MockChild;
  child.kill = vi.fn(() => true);
  child.stdin = Object.assign(new EventEmitter(), { end: vi.fn() });
  child.stdout = Object.assign(new EventEmitter(), {
    setEncoding: vi.fn(),
  });
  child.stderr = Object.assign(new EventEmitter(), {
    setEncoding: vi.fn(),
  });
  return child;
}

describe("macOS native Keychain child boundary", () => {
  beforeEach(() => {
    setProcessPlatform("darwin");
    spawnMock.mockReset();
    embeddedAddonMock.isParentSameExecutable.mockReset().mockReturnValue(true);
    embeddedAddonMock.read.mockReset().mockReturnValue("stored-access-token");
    embeddedAddonMock.remove.mockReset();
    embeddedAddonMock.store.mockReset();
  });

  afterEach(() => {
    setProcessPlatform(ORIGINAL_PLATFORM);
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("kills a Keychain helper that does not return before the deadline", async () => {
    vi.useFakeTimers();
    const child = createMockChild();
    spawnMock.mockReturnValue(child);

    const request = runMacOsNativeKeychainRequestInChild(
      {
        operation: "read",
        service: "sh.openmeld.auth.token",
        account: "openmeld-auth-test",
      },
      { timeoutMs: 25 }
    );
    const rejection = expect(request).rejects.toThrow(
      "macOS Keychain did not respond within 25 ms"
    );

    await vi.advanceTimersByTimeAsync(25);

    await rejection;
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("keeps access tokens in stdin instead of argv", async () => {
    const child = createMockChild();
    spawnMock.mockReturnValue(child);

    const request = runMacOsNativeKeychainRequestInChild({
      operation: "store",
      service: "sh.openmeld.auth.token",
      account: "openmeld-auth-test",
      accessToken: "secret-access-token",
    });
    queueMicrotask(() => {
      child.stdout.emit(
        "data",
        JSON.stringify({
          schemaVersion: MAC_OS_KEYCHAIN_HELPER_SCHEMA_VERSION,
          ok: true,
          operation: "store",
        })
      );
      child.emit("close", 0, null);
    });

    await expect(request).resolves.toBeUndefined();
    const [, args] = spawnMock.mock.calls[0] ?? [];
    expect(JSON.stringify(args)).not.toContain("secret-access-token");
    expect(child.stdin.end).toHaveBeenCalledWith(
      expect.stringContaining("secret-access-token"),
      "utf8"
    );
    const serializedRequest = child.stdin.end.mock.calls[0]?.[0];
    expect(JSON.parse(String(serializedRequest))).toMatchObject({
      operation: "store",
      authenticationInteraction: "disallow",
    });
  });

  it("returns a read value only from a valid helper response", async () => {
    const child = createMockChild();
    spawnMock.mockReturnValue(child);

    const request = runMacOsNativeKeychainRequestInChild({
      operation: "read",
      service: "sh.openmeld.auth.token",
      account: "openmeld-auth-test",
    });
    queueMicrotask(() => {
      child.stdout.emit(
        "data",
        JSON.stringify({
          schemaVersion: MAC_OS_KEYCHAIN_HELPER_SCHEMA_VERSION,
          ok: true,
          operation: "read",
          accessToken: "stored-access-token",
        })
      );
      child.emit("close", 0, null);
    });

    await expect(request).resolves.toBe("stored-access-token");
  });

  it("disallows macOS authentication UI for access-token reads", async () => {
    const child = createMockChild();
    spawnMock.mockReturnValue(child);

    const request = runMacOsNativeKeychainRequestInChild({
      operation: "read",
      service: "sh.openmeld.auth.token",
      account: "openmeld-auth-test",
    });
    queueMicrotask(() => {
      child.stdout.emit(
        "data",
        JSON.stringify({
          schemaVersion: MAC_OS_KEYCHAIN_HELPER_SCHEMA_VERSION,
          ok: true,
          operation: "read",
          accessToken: "stored-access-token",
        })
      );
      child.emit("close", 0, null);
    });

    await expect(request).resolves.toBe("stored-access-token");
    const serializedRequest = child.stdin.end.mock.calls[0]?.[0];
    expect(JSON.parse(String(serializedRequest))).toMatchObject({
      operation: "read",
      authenticationInteraction: "disallow",
    });
  });

  it("rejects malformed helper output instead of treating it as success", async () => {
    const child = createMockChild();
    spawnMock.mockReturnValue(child);

    const request = runMacOsNativeKeychainRequestInChild({
      operation: "delete",
      service: "sh.openmeld.auth.token",
      account: "openmeld-auth-test",
    });
    queueMicrotask(() => {
      child.stdout.emit("data", '{"ok":true}');
      child.emit("close", 0, null);
    });

    await expect(request).rejects.toThrow(
      "macOS Keychain helper returned an invalid response"
    );
  });

  it("uses a short production deadline", () => {
    expect(MAC_OS_KEYCHAIN_HELPER_TIMEOUT_MS).toBe(5000);
  });

  it("rejects a direct external helper invocation before reading a token", async () => {
    embeddedAddonMock.isParentSameExecutable.mockReturnValue(false);
    const originalStdin = Object.getOwnPropertyDescriptor(process, "stdin");
    const request = JSON.stringify({
      schemaVersion: MAC_OS_KEYCHAIN_HELPER_SCHEMA_VERSION,
      operation: "read",
      service: "sh.openmeld.auth.token",
      account: "openmeld-auth-known-account",
      authenticationInteraction: "disallow",
    });
    Object.defineProperty(process, "stdin", {
      configurable: true,
      value: Readable.from([request]),
    });
    const stdoutWrite = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    try {
      await expect(
        runMacOsNativeKeychainHelperIfRequested([
          "/path/to/openmeld",
          "__openmeld_macos_keychain_helper",
        ])
      ).rejects.toThrow("reserved for an OpenMeld child process");
      expect(embeddedAddonMock.read).not.toHaveBeenCalled();
      expect(stdoutWrite).not.toHaveBeenCalled();
    } finally {
      stdoutWrite.mockRestore();
      if (originalStdin) {
        Object.defineProperty(process, "stdin", originalStdin);
      } else {
        Reflect.deleteProperty(process, "stdin");
      }
    }
  });
});
