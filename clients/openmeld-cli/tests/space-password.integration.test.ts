import { afterEach, describe, expect, it, vi } from "vitest";
import { runSpacePassword } from "../src/space/command";
import { withCapturedStdio, withTempHome } from "./helpers/fs";

const getAuthSessionStateMock = vi.hoisted(() => vi.fn());

const VALID_AUTH_STATE = {
  state: "valid" as const,
  session: {
    v: 1 as const,
    accessToken: "token-123",
    tokenType: "Bearer",
    authBaseUrl: "https://auth.openmeld.invalid",
    clientId: "openmeld-cli",
    createdAt: "2026-03-01T00:00:00.000Z",
    user: {
      id: "user-1",
      email: "felix@example.com",
    },
  },
};

vi.mock("../src/config/auth-session", async () => {
  const actual = await vi.importActual<
    typeof import("../src/config/auth-session")
  >("../src/config/auth-session");
  return {
    ...actual,
    getAuthSessionState: (
      ...args: Parameters<typeof getAuthSessionStateMock>
    ) => getAuthSessionStateMock(...args),
  };
});

vi.mock("../src/config/resolve-openmeld-profile", () => {
  const profile = {
    openMeldProfileId: "mira--space-password",
    profileName: "Mira",
    profileKind: "human",
    status: "active",
    ownerUserId: "user-1",
    source: "cli_create",
    createdByUserId: "user-1",
    lastUsedAt: null,
    createdAt: "2026-02-20T00:00:00.000Z",
    updatedAt: "2026-02-20T00:00:00.000Z",
  } as const;
  return {
    requireOpenMeldProfile: vi.fn(
      async ({ openMeldProfileId }: { openMeldProfileId?: string }) => ({
        ...profile,
        openMeldProfileId: String(
          openMeldProfileId ?? profile.openMeldProfileId
        ),
      })
    ),
    resolveOpenMeldProfileOrNull: vi.fn(
      async ({ openMeldProfileId }: { openMeldProfileId?: string }) => ({
        ...profile,
        openMeldProfileId: String(
          openMeldProfileId ?? profile.openMeldProfileId
        ),
      })
    ),
  };
});

describe("space password", () => {
  afterEach(() => {
    getAuthSessionStateMock.mockReset();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("upserts password via PUT /password with canonical password body", async () => {
    getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
    await withTempHome(async () => {
      const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              spaceId:
                "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              passwordProtected: true,
            }),
            {
              status: 200,
              headers: {
                "content-type": "application/json",
              },
            }
          )
        )
      );

      const { stdout } = await withCapturedStdio(async () => {
        await runSpacePassword({
          profile: "mira--space-password",
          baseUrl: "https://gateway.openmeld.invalid",
          space:
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          password: "  P@ss  ",
          clear: false,
          view: "human",
        });
      });

      expect(stdout).toContain("✅ Password Updated");
      expect(stdout).toContain("Space: Untitled space");
      expect(stdout).toContain(
        "Space ID: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      );
      expect(stdout).toContain("Join access: Password required");
      expect(stdout).toContain(
        "Security note: Save this password securely. If you lose it, you'll need to set a new one."
      );
      const passwordRequest = fetchMock.mock.calls.find(([request]) =>
        String(request).includes("/password")
      );
      expect(passwordRequest).toBeDefined();
      const requestInit = passwordRequest?.[1] as RequestInit | undefined;
      expect(requestInit?.method).toBe("PUT");
      const body = JSON.parse(String(requestInit?.body ?? "{}")) as {
        password?: string;
      };
      expect(body.password).toBe("P@ss");
      expect(String(passwordRequest?.[0])).toContain("/password");
    });
  });

  it("clears password via DELETE /password", async () => {
    getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
    await withTempHome(async () => {
      const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              spaceId:
                "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              passwordProtected: false,
            }),
            {
              status: 200,
              headers: {
                "content-type": "application/json",
              },
            }
          )
        )
      );

      const { stdout } = await withCapturedStdio(async () => {
        await runSpacePassword({
          profile: "mira--space-password",
          baseUrl: "https://gateway.openmeld.invalid",
          space:
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          clear: true,
          view: "human",
        });
      });

      expect(stdout).toContain("✅ Password Cleared");
      expect(stdout).toContain("Space: Untitled space");
      expect(stdout).toContain(
        "Space ID: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      );
      expect(stdout).toContain("Join access: No password required");
      const passwordRequest = fetchMock.mock.calls.find(([request]) =>
        String(request).includes("/password")
      );
      expect(passwordRequest).toBeDefined();
      const requestInit = passwordRequest?.[1] as RequestInit | undefined;
      expect(requestInit?.method).toBe("DELETE");
      expect(requestInit?.body).toBeUndefined();
      expect(String(passwordRequest?.[0])).toContain("/password");
    });
  });

  it("rejects invalid space id", async () => {
    getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
    await withTempHome(async () => {
      await expect(
        runSpacePassword({
          profile: "mira--space-password",
          baseUrl: "https://gateway.openmeld.invalid",
          space: "ops-room",
          password: "secret-123",
          clear: false,
          view: "human",
        })
      ).rejects.toThrow("Invalid space target");
    });
  });

  it("shows agent guide when action arguments are missing in non-interactive agent view", async () => {
    await withTempHome(async () => {
      await expect(
        runSpacePassword({
          profile: "mira--space-password",
          view: "agent",
        })
      ).rejects.toThrow(
        "openmeld space password needs a space ID and one action (--password or --clear) in agent view."
      );
    });
  });

  it("renders openmeld-dev password guidance when the dev shortcut is active", async () => {
    vi.stubEnv("OPENMELD_USER_FACING_CLI_COMMAND", "openmeld-dev");
    getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);

    await withTempHome(async () => {
      await expect(
        runSpacePassword({
          profile: "mira--space-password",
          space:
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          view: "human",
        })
      ).rejects.toThrow(
        "`openmeld-dev space password` requires --password <value> or --clear"
      );
    });
  });
});
