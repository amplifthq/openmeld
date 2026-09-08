import { readFile, writeFile } from "node:fs/promises";
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

import {
  beginAuthSessionTransition,
  getAuthSession,
  getAuthSessionMetadata,
  getAuthSessionState,
  getInterruptedComputerAuthSessionRecovery,
  markInterruptedComputerAuthSessionRecovery,
  setAuthSession,
} from "../src/config/auth-session";

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
const FINAL_TOKEN_REF = {
  account: "openmeld-auth-final",
  provider: "macos-keychain" as const,
  service: "sh.openmeld.auth.token",
};

describe("auth session secure storage boundary", () => {
  it("finishes interrupted cleanup without reading an already revoked candidate credential", async () => {
    await withTempHome(async () => {
      const transition = await beginAuthSessionTransition(
        {
          accessToken: secureStorage.accessToken,
          authBaseUrl: "https://auth.openmeld.invalid",
          clientId: "openmeld-cli",
          user: { id: "owner" },
        },
        { computerHandoff: { gatewayUrl: "https://gateway.openmeld.invalid" } }
      );
      await transition.rollback();
      const recovery = await getInterruptedComputerAuthSessionRecovery();
      expect(recovery).not.toBeNull();
      if (!recovery) {
        throw new Error("expected interrupted handoff");
      }
      await markInterruptedComputerAuthSessionRecovery({
        id: recovery.id,
        phase: "service",
      });
      await markInterruptedComputerAuthSessionRecovery({
        id: recovery.id,
        phase: "remote_session",
      });
      secureStorage.readAccessToken.mockClear();
      secureStorage.readAccessToken.mockResolvedValue({
        status: "unavailable",
        errorMessage: "Keychain denied access",
      });
      await expect(
        getInterruptedComputerAuthSessionRecovery()
      ).resolves.toBeNull();
      expect(secureStorage.readAccessToken).not.toHaveBeenCalled();
      await expect(
        getInterruptedComputerAuthSessionRecovery()
      ).resolves.toBeNull();
      secureStorage.readAccessToken.mockResolvedValue({
        status: "found",
        accessToken: "fresh",
      });
      const retry = await beginAuthSessionTransition({
        accessToken: "fresh",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        user: { id: "owner" },
      });
      await retry.commit();
      await expect(getAuthSession()).resolves.toMatchObject({
        accessToken: "fresh",
        user: { id: "owner" },
      });
    });
  });
  it("preserves an unreadable old session on rollback without blocking recovery cleanup", async () => {
    await withTempHome(async (home) => {
      await setAuthSession({
        accessToken: secureStorage.accessToken,
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        user: { id: "owner" },
      });
      const path = join(home, ".openmeld", "auth", "session.json");
      const original = JSON.parse(await readFile(path, "utf8"));
      original.createdAt = "2026-01-01T00:00:00.000Z";
      await writeFile(path, JSON.stringify(original));
      secureStorage.readAccessToken.mockImplementation(async (ref) =>
        ref.account === TOKEN_REF.account
          ? { status: "unavailable", errorMessage: "Keychain denied access" }
          : { status: "found", accessToken: "replacement" }
      );
      secureStorage.storeAccessToken.mockResolvedValue(REPLACEMENT_TOKEN_REF);
      await expect(
        getAuthSessionState({ validateRemote: false })
      ).resolves.toMatchObject({ reasonCode: "session_token_unavailable" });
      const metadata = await getAuthSessionMetadata();
      const transition = await beginAuthSessionTransition(
        {
          accessToken: "replacement",
          authBaseUrl: "https://auth.openmeld.invalid",
          clientId: "openmeld-cli",
          user: { id: "owner" },
        },
        {
          expectedPreviousSession: metadata,
          computerHandoff: { gatewayUrl: "https://gateway.openmeld.invalid" },
        }
      );
      await transition.rollback();
      expect(JSON.parse(await readFile(path, "utf8"))).toEqual(original);
      await expect(
        getInterruptedComputerAuthSessionRecovery()
      ).resolves.toMatchObject({
        previousSession: null,
        candidateSession: { accessToken: "replacement" },
      });
    });
  });
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

  it("retains failed old-credential cleanup and retries it on a later login", async () => {
    secureStorage.storeAccessToken
      .mockResolvedValueOnce(TOKEN_REF)
      .mockResolvedValueOnce(REPLACEMENT_TOKEN_REF)
      .mockResolvedValueOnce(FINAL_TOKEN_REF);
    secureStorage.deleteAccessToken
      .mockRejectedValueOnce(new Error("Keychain delete unavailable"))
      .mockResolvedValue(undefined);

    await withTempHome(async (home) => {
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

      const cleanupPath = join(
        home,
        ".openmeld",
        "auth",
        "pending-token-cleanup.json"
      );
      await expect(readFile(cleanupPath, "utf8")).resolves.toContain(
        "openmeld-auth-test"
      );

      await setAuthSession({
        accessToken: secureStorage.accessToken,
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
      });

      await expect(readFile(cleanupPath, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
    });

    expect(secureStorage.deleteAccessToken).toHaveBeenCalledWith(TOKEN_REF);
    expect(secureStorage.deleteAccessToken).toHaveBeenCalledWith(
      REPLACEMENT_TOKEN_REF
    );
  });
});
