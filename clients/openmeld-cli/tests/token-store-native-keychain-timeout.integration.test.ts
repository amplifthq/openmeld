import { EventEmitter } from "node:events";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withTempHome } from "./helpers/fs";

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

vi.mock("../src/runtime/distribution", () => ({
  isBinaryDistribution: () => true,
}));

import { readAccessToken, storeAccessToken } from "../src/config/token-store";

type MockChild = EventEmitter & {
  kill: ReturnType<typeof vi.fn>;
  stderr: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
  stdin: EventEmitter & { end: ReturnType<typeof vi.fn> };
  stdout: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
};

const ORIGINAL_PLATFORM = process.platform;

function createHungKeychainChild(): MockChild {
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

describe("macOS native Keychain timeout recovery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    spawnMock.mockReset();
    Object.defineProperty(process, "platform", {
      value: "darwin",
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", {
      value: ORIGINAL_PLATFORM,
      configurable: true,
    });
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("stops retrying an unresponsive Keychain and lets fresh login use private storage", async () => {
    const child = createHungKeychainChild();
    spawnMock.mockReturnValue(child);
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    await withTempHome(async (home) => {
      const oldSessionRead = readAccessToken({
        provider: "macos-keychain",
        service: "sh.openmeld.auth.token",
        account: "openmeld-auth-old-session",
      });

      await vi.advanceTimersByTimeAsync(5000);

      await expect(oldSessionRead).resolves.toMatchObject({
        status: "unavailable",
        errorMessage: expect.stringContaining(
          "macOS Keychain did not respond within 5 seconds"
        ),
      });
      expect(child.kill).toHaveBeenCalledWith("SIGKILL");

      const replacementRef = await storeAccessToken({
        accessToken: "replacement-access-token",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
      });

      expect(replacementRef.provider).toBe("insecure-file");
      if (replacementRef.provider !== "insecure-file") {
        throw new Error("Expected the macOS private-file fallback.");
      }
      expect(spawnMock).toHaveBeenCalledTimes(1);
      await expect(readAccessToken(replacementRef)).resolves.toEqual({
        accessToken: "replacement-access-token",
        status: "found",
      });

      const tokenDirectory = join(home, ".openmeld", "auth", "tokens");
      const tokenFile = join(tokenDirectory, `${replacementRef.key}.token`);
      expect((await stat(tokenDirectory)).mode % 0o1000).toBe(0o700);
      expect((await stat(tokenFile)).mode % 0o1000).toBe(0o600);
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("setup can continue")
    );
  });
});
