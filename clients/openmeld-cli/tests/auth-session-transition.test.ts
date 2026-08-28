import { describe, expect, it, vi } from "vitest";
import { withTempHome } from "./helpers/fs";

const { deleteAccessTokenMock, readAccessTokenMock, storeAccessTokenMock } =
  vi.hoisted(() => ({
    deleteAccessTokenMock: vi.fn(),
    readAccessTokenMock: vi.fn(),
    storeAccessTokenMock: vi.fn(),
  }));

vi.mock("../src/config/token-store", () => ({
  deleteAccessToken: deleteAccessTokenMock,
  isStoredTokenRef: (value: unknown) =>
    Boolean(
      value &&
        typeof value === "object" &&
        "provider" in value &&
        value.provider === "macos-keychain"
    ),
  readAccessToken: readAccessTokenMock,
  storeAccessToken: storeAccessTokenMock,
}));

import {
  beginAuthSessionTransition,
  getAuthSession,
} from "../src/config/auth-session";

describe("auth session transition", () => {
  it("creates session metadata storage when a secure token store does not create it", async () => {
    storeAccessTokenMock.mockResolvedValue({
      account: "openmeld-cli:test",
      provider: "macos-keychain",
      service: "ai.openmeld.cli",
    });
    readAccessTokenMock.mockResolvedValue({
      accessToken: "candidate-token",
      status: "found",
    });
    deleteAccessTokenMock.mockResolvedValue(undefined);

    await withTempHome(async () => {
      const transition = await beginAuthSessionTransition({
        accessToken: "candidate-token",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        user: { id: "user-new" },
      });

      await expect(getAuthSession()).resolves.toMatchObject({
        accessToken: "candidate-token",
        user: { id: "user-new" },
      });
      await transition.rollback();
    });
  });
});
