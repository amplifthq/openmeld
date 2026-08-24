import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

import {
  MAC_OS_KEYCHAIN_HELPER_TIMEOUT_MS,
  runMacOsNativeKeychainRequestInChild,
} from "../src/config/macos-native-keychain";

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
    spawnMock.mockReset();
  });

  afterEach(() => {
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
          schemaVersion: 1,
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
          schemaVersion: 1,
          ok: true,
          operation: "read",
          accessToken: "stored-access-token",
        })
      );
      child.emit("close", 0, null);
    });

    await expect(request).resolves.toBe("stored-access-token");
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
});
