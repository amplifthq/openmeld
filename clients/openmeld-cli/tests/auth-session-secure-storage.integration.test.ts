import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { withTempHome } from "./helpers/fs";

const secureStorage = vi.hoisted(() => ({
  accessToken: "token-secure",
  deleteAccessToken: vi.fn(),
  readAccessToken: vi.fn(),
  storeAccessToken: vi.fn(),
}));

vi.mock("../src/config/token-store", () => ({
  deleteAccessToken: secureStorage.deleteAccessToken,
  isStoredTokenRef: () => true,
  readAccessToken: secureStorage.readAccessToken,
  storeAccessToken: secureStorage.storeAccessToken,
}));

import { getAuthSession, setAuthSession } from "../src/config/auth-session";

const TOKEN_REF = {
  account: "openmeld-auth-test",
  provider: "macos-keychain" as const,
  service: "sh.openmeld.auth.token",
};
const REPLACEMENT_TOKEN_REF = {
  account: "openmeld-auth-replacement",
  provider: "macos-keychain" as const,
  service: "sh.openmeld.auth.token",
};

describe("auth session secure storage boundary", () => {
  beforeEach(() => {
    secureStorage.deleteAccessToken.mockReset();
    secureStorage.readAccessToken.mockReset();
    secureStorage.storeAccessToken.mockReset();
    secureStorage.deleteAccessToken.mockResolvedValue(undefined);
    secureStorage.storeAccessToken.mockResolvedValue(TOKEN_REF);
    secureStorage.readAccessToken.mockResolvedValue({
      accessToken: secureStorage.accessToken,
      status: "found",
    });
  });

  it("does not persist session metadata when the stored token cannot be reloaded", async () => {
    secureStorage.readAccessToken.mockResolvedValue({ status: "missing" });

    await withTempHome(async (home) => {
      await expect(
        setAuthSession({
          accessToken: secureStorage.accessToken,
          authBaseUrl: "https://auth.openmeld.invalid",
          clientId: "openmeld-cli",
        })
      ).rejects.toThrow("stored access token could not be reloaded");
      await expect(
        readFile(join(home, ".openmeld", "auth", "session.json"), "utf8")
      ).rejects.toMatchObject({ code: "ENOENT" });
    });

    expect(secureStorage.deleteAccessToken).toHaveBeenCalledWith(TOKEN_REF);
  });

  it("reuses a verified token while the persisted session is unchanged", async () => {
    await withTempHome(async () => {
      await setAuthSession({
        accessToken: secureStorage.accessToken,
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
      });

      await expect(getAuthSession()).resolves.toMatchObject({
        accessToken: secureStorage.accessToken,
      });
      await expect(getAuthSession()).resolves.toMatchObject({
        accessToken: secureStorage.accessToken,
      });
    });

    expect(secureStorage.readAccessToken).toHaveBeenCalledTimes(1);
  });

  it("removes a private fallback after a later login succeeds in Keychain", async () => {
    const privateFallbackRef = {
      key: "a".repeat(64),
      provider: "insecure-file" as const,
    };
    secureStorage.storeAccessToken
      .mockResolvedValueOnce(privateFallbackRef)
      .mockResolvedValueOnce(REPLACEMENT_TOKEN_REF);

    await withTempHome(async () => {
      await setAuthSession({
        accessToken: secureStorage.accessToken,
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
      });
      await setAuthSession({
        accessToken: secureStorage.accessToken,
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
      });
    });

    expect(secureStorage.deleteAccessToken).toHaveBeenCalledWith(
      privateFallbackRef
    );
    expect(secureStorage.deleteAccessToken).not.toHaveBeenCalledWith(
      REPLACEMENT_TOKEN_REF
    );
  });
});
