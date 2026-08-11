import { afterEach, describe, expect, it, vi } from "vitest";
import { runInit } from "../src/commands/init";
import {
  runSpaceGuideRead,
  runSpaceGuideSet,
} from "../src/space/guide-command";
import {
  withCapturedStdio,
  withSilencedStdio,
  withTempHome,
} from "./helpers/fs";

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

function createJsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createGuideProfilePayload(openMeldProfileId: string) {
  return {
    openMeldProfileId,
    profileName: "Mira",
    profileHandle: "mira",
    profileKind: "human",
    status: "active",
    ownerUserId: "user-1",
    source: "cli_create",
    createdByUserId: "user-1",
    lastUsedAt: null,
    createdAt: "2026-02-20T00:00:00.000Z",
    updatedAt: "2026-02-20T00:00:00.000Z",
  };
}

function createGuideProfileResponse(openMeldProfileId: string): Response {
  return createJsonResponse({
    ok: true,
    profile: createGuideProfilePayload(openMeldProfileId),
  });
}

function isGuideMetaRequest(input: unknown): boolean {
  return String(input).includes(
    "/v1/spaces/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef/meta"
  );
}

vi.mock("../src/config/resolve-openmeld-profile", () => {
  const profile = {
    openMeldProfileId: "mira--guide",
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

describe("space guide response parsing", () => {
  afterEach(() => {
    getAuthSessionStateMock.mockReset();
    vi.restoreAllMocks();
  });

  it("throws a clear error when fetchSpaceMeta gets invalid JSON", async () => {
    await withTempHome(async () => {
      getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
      await withSilencedStdio(async () => {
        await runInit({
          profile: "mira--guide-read",
          profileId: "aaaaaaaa-1111-2222-3333-aaaaaaaaaaaa",
          profileName: "Mira",
          kind: "human",
        });
      });

      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation((input) => {
          const url = new URL(String(input));
          if (url.pathname === "/v1/profiles/resolve") {
            return Promise.resolve(
              createGuideProfileResponse("mira--guide-read")
            );
          }
          if (!isGuideMetaRequest(input)) {
            throw new Error(`unexpected request: ${String(input)}`);
          }
          return Promise.resolve(
            new Response("{not-json", {
              status: 200,
              headers: { "content-type": "application/json" },
            })
          );
        });

      await withSilencedStdio(async () => {
        await expect(
          runSpaceGuideRead({
            profile: "mira--guide-read",
            space:
              "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            json: false,
            view: "human",
            entryChecksHandled: true,
          })
        ).rejects.toThrow("fetchSpaceMeta received invalid response payload");
      });
      expect(
        fetchSpy.mock.calls.filter(([input]) => isGuideMetaRequest(input))
      ).toHaveLength(1);
    });
  });

  it("throws a clear error when updateSpaceMeta gets invalid JSON", async () => {
    await withTempHome(async () => {
      getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
      await withSilencedStdio(async () => {
        await runInit({
          profile: "mira--guide-update",
          profileId: "bbbbbbbb-1111-2222-3333-bbbbbbbbbbbb",
          profileName: "Mira",
          kind: "human",
        });
      });

      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation((input, init) => {
          const url = new URL(String(input));
          if (url.pathname === "/v1/profiles/resolve") {
            return Promise.resolve(
              createGuideProfileResponse("mira--guide-update")
            );
          }
          if (!isGuideMetaRequest(input)) {
            throw new Error(`unexpected request: ${String(input)}`);
          }
          expect(String(init?.method ?? "GET").toUpperCase()).toBe("PATCH");
          return Promise.resolve(
            new Response("{not-json", {
              status: 200,
              headers: { "content-type": "application/json" },
            })
          );
        });

      await withSilencedStdio(async () => {
        await expect(
          runSpaceGuideSet({
            profile: "mira--guide-update",
            space:
              "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            guide: "Keep answers concise.",
            json: false,
            view: "human",
            entryChecksHandled: true,
          })
        ).rejects.toThrow("updateSpaceMeta received invalid response payload");
      });
      expect(
        fetchSpy.mock.calls.filter(([input]) => isGuideMetaRequest(input))
      ).toHaveLength(1);
    });
  });

  it("sanitizes remote guide text before human terminal output", async () => {
    const oscLink =
      "\u001B]8;;https://openmeld.invalid\u0007docs\u001B]8;;\u0007";

    await withTempHome(async () => {
      getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
      await withSilencedStdio(async () => {
        await runInit({
          profile: "mira--guide-sanitize",
          profileId: "cccccccc-1111-2222-3333-cccccccccccc",
          profileName: "Mira",
          kind: "human",
        });
      });

      vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
        const url = new URL(String(input));
        expect(url.pathname).toBe(
          "/v1/spaces/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef/meta"
        );
        return Promise.resolve(
          new Response(
            JSON.stringify({
              spaceId:
                "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
              organizationId: "org-1",
              visibility: "private",
              guide: `keep calm\r\n${oscLink}\n\u001B[41mred\u001B[0m\b!`,
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            }
          )
        );
      });

      const { stdout } = await withCapturedStdio(async () => {
        await runSpaceGuideRead({
          profile: "mira--guide-sanitize",
          space:
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          json: false,
          view: "human",
        });
      });

      expect(stdout.includes("\u001B")).toBe(false);
      expect(stdout.includes("\r")).toBe(false);
      expect(stdout.includes("\b")).toBe(false);
      expect(stdout).toContain("Space guide:");
      expect(stdout).toContain(
        "Space: 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
      );
      expect(stdout).toContain("Guide: set");
      expect(stdout).toContain("Guide text");
      expect(stdout).toContain("keep calm");
      expect(stdout).toContain("docs");
      expect(stdout).toContain("red!");
    });
  });
});
