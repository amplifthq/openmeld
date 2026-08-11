import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runInit } from "../src/commands/init";
import {
  runSpaceGuideClear,
  runSpaceGuideRead,
  runSpaceGuideSet,
} from "../src/space/guide-command";
import {
  LocalSpaceStateIntegrityError,
  readSpaceConfig,
  upsertSpaceConfig,
} from "../src/space/local-state";
import {
  withCapturedStdio,
  withSilencedStdio,
  withTempHome,
} from "./helpers/fs";
import { expectSpaceConfigReadValue } from "./helpers/local-state";
import { createSpaceMetaFixture } from "./helpers/space-meta-fixture";

const getAuthSessionStateMock = vi.hoisted(() => vi.fn());
const passwordPromptMock = vi.hoisted(() => vi.fn());

const PROFILE = {
  openMeldProfileId: "mira--guide-read",
  profileName: "Mira",
  profileKind: "human",
  status: "active",
  ownerUserId: "user-1",
  source: "cli_create",
  createdByUserId: "user-1",
  lastUsedAt: null,
  createdAt: "2026-03-21T00:00:00.000Z",
  updatedAt: "2026-03-21T00:00:00.000Z",
} as const;

const HUMAN_PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const VALID_SPACE_ID =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const FALLBACK_SPACE_CACHE_PATH = [
  ".openmeld",
  "accounts",
  "unauthenticated",
  "local",
  "profiles",
  PROFILE.openMeldProfileId,
  "space-cache",
] as const;

const VALID_AUTH_STATE = {
  state: "valid" as const,
  session: {
    v: 1 as const,
    accessToken: "token-123",
    tokenType: "Bearer",
    authBaseUrl: "http://localhost",
    clientId: "openmeld-cli",
    createdAt: "2026-03-21T00:00:00.000Z",
    user: {
      id: "user-1",
      email: "felix@example.com",
    },
  },
};

vi.mock("@clack/prompts", () => ({
  cancel: vi.fn(),
  confirm: vi.fn(),
  isCancel: vi.fn(() => false),
  multiselect: vi.fn(),
  note: vi.fn(),
  outro: vi.fn(),
  password: (input: unknown) => passwordPromptMock(input),
  select: vi.fn(() => "no"),
  spinner: vi.fn(),
  text: vi.fn(),
}));

vi.mock("../src/config/resolve-openmeld-profile", () => ({
  resolveOpenMeldProfileOrNull: vi.fn(
    async ({ openMeldProfileId }: { openMeldProfileId?: string }) => ({
      ...PROFILE,
      openMeldProfileId: String(openMeldProfileId ?? PROFILE.openMeldProfileId),
    })
  ),
}));

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

vi.mock("../src/runtime/interaction", () => ({
  canUseInteractivePrompts: vi.fn(() => true),
}));

describe("space guide commands", () => {
  afterEach(() => {
    getAuthSessionStateMock.mockReset();
    passwordPromptMock.mockReset();
    vi.restoreAllMocks();
  });

  it("emits structured guide json for space guide reads", async () => {
    await withTempHome(async () => {
      getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
      await withSilencedStdio(async () => {
        await runInit({
          profile: PROFILE.openMeldProfileId,
          profileId: HUMAN_PROFILE_ID,
          profileName: PROFILE.profileName,
          kind: "human",
        });
      });

      vi.spyOn(globalThis, "fetch").mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify(
              createSpaceMetaFixture({
                spaceId: VALID_SPACE_ID,
                name: "ops-room",
                guide: "Keep public replies concise.\nEscalate blockers early.",
                updatedAt: "2026-03-21T01:00:00.000Z",
              })
            ),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            }
          )
        )
      );

      const { stdout } = await withCapturedStdio(async () => {
        await runSpaceGuideRead({
          profile: PROFILE.openMeldProfileId,
          baseUrl: "http://localhost",
          space: VALID_SPACE_ID,
          json: true,
          view: "human",
        });
      });

      const payload = JSON.parse(stdout.trim()) as {
        summary: string;
        forHumans: { steps: string[] };
      };
      expect(payload.summary).toBe("Space guide for ops-room.");
      expect(payload.forHumans.steps).toEqual([
        "Keep public replies concise.",
        "Escalate blockers early.",
      ]);
    });
  });

  it("renders a human card after updating the space guide", async () => {
    await withTempHome(async () => {
      getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
      await withSilencedStdio(async () => {
        await runInit({
          profile: PROFILE.openMeldProfileId,
          profileId: HUMAN_PROFILE_ID,
          profileName: PROFILE.profileName,
          kind: "human",
        });
      });

      vi.spyOn(globalThis, "fetch").mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify(
              createSpaceMetaFixture({
                spaceId: VALID_SPACE_ID,
                name: "ops-room",
                guide: "Keep public replies concise.",
                updatedAt: "2026-03-21T01:00:00.000Z",
              })
            ),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            }
          )
        )
      );

      const { plainStdout } = await withCapturedStdio(async () => {
        await runSpaceGuideSet({
          profile: PROFILE.openMeldProfileId,
          baseUrl: "http://localhost",
          space: VALID_SPACE_ID,
          guide: "Keep public replies concise.",
          json: false,
          view: "human",
        });
      });

      expect(plainStdout).toContain("Space guide updated:");
      expect(plainStdout).toContain("Space: ops-room");
      expect(plainStdout).toContain("Guide: set");
      expect(plainStdout).toContain("Guide text");
      expect(plainStdout).toContain("Keep public replies concise.");
    });
  });

  it("renders the empty state after clearing the space guide", async () => {
    await withTempHome(async () => {
      getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
      await withSilencedStdio(async () => {
        await runInit({
          profile: PROFILE.openMeldProfileId,
          profileId: HUMAN_PROFILE_ID,
          profileName: PROFILE.profileName,
          kind: "human",
        });
      });

      vi.spyOn(globalThis, "fetch").mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify(
              createSpaceMetaFixture({
                spaceId: VALID_SPACE_ID,
                name: "ops-room",
                updatedAt: "2026-03-21T01:00:00.000Z",
              })
            ),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            }
          )
        )
      );

      const { plainStdout } = await withCapturedStdio(async () => {
        await runSpaceGuideClear({
          profile: PROFILE.openMeldProfileId,
          baseUrl: "http://localhost",
          space: VALID_SPACE_ID,
          json: false,
          view: "human",
        });
      });

      expect(plainStdout).toContain("Space guide cleared:");
      expect(plainStdout).toContain("Guide: empty");
    });
  });

  it("preserves cached meta fields when guide reads omit them", async () => {
    await withTempHome(async () => {
      getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
      await withSilencedStdio(async () => {
        await runInit({
          profile: PROFILE.openMeldProfileId,
          profileId: HUMAN_PROFILE_ID,
          profileName: PROFILE.profileName,
          kind: "human",
        });
      });

      await upsertSpaceConfig({
        openMeldProfileId: PROFILE.openMeldProfileId,
        baseUrl: "http://localhost",
        space: VALID_SPACE_ID,
        profileName: PROFILE.profileName,
        name: "cached-room",
        creator: {
          profileId: HUMAN_PROFILE_ID,
          profileName: "Felix",
          kind: "human",
          profile: PROFILE.openMeldProfileId,
        },
        guide: "cached guide",
        spaceCreatedAt: "2026-03-20T00:00:00.000Z",
        spaceUpdatedAt: "2026-03-20T00:00:01.000Z",
      });

      vi.spyOn(globalThis, "fetch").mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify(
              createSpaceMetaFixture({
                spaceId: VALID_SPACE_ID,
              })
            ),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            }
          )
        )
      );

      await withSilencedStdio(async () => {
        await runSpaceGuideRead({
          profile: PROFILE.openMeldProfileId,
          baseUrl: "http://localhost",
          space: VALID_SPACE_ID,
          json: false,
          view: "human",
        });
      });

      const cached = expectSpaceConfigReadValue(
        await readSpaceConfig({
          openMeldProfileId: PROFILE.openMeldProfileId,
          space: VALID_SPACE_ID,
        })
      );
      expect(cached).toMatchObject({
        name: "cached-room",
        guide: "cached guide",
        creator: {
          profileId: HUMAN_PROFILE_ID,
          profileName: "Felix",
        },
        spaceCreatedAt: "2026-03-20T00:00:00.000Z",
        spaceUpdatedAt: "2026-03-20T00:00:01.000Z",
      });
    });
  });

  it("clears the cached guide after a successful clear even when the response omits guide", async () => {
    await withTempHome(async () => {
      getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
      await withSilencedStdio(async () => {
        await runInit({
          profile: PROFILE.openMeldProfileId,
          profileId: HUMAN_PROFILE_ID,
          profileName: PROFILE.profileName,
          kind: "human",
        });
      });

      await upsertSpaceConfig({
        openMeldProfileId: PROFILE.openMeldProfileId,
        baseUrl: "http://localhost",
        space: VALID_SPACE_ID,
        profileName: PROFILE.profileName,
        guide: "cached guide",
      });

      vi.spyOn(globalThis, "fetch").mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify(
              createSpaceMetaFixture({
                spaceId: VALID_SPACE_ID,
                name: "ops-room",
                updatedAt: "2026-03-21T01:00:00.000Z",
              })
            ),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            }
          )
        )
      );

      await withSilencedStdio(async () => {
        await runSpaceGuideClear({
          profile: PROFILE.openMeldProfileId,
          baseUrl: "http://localhost",
          space: VALID_SPACE_ID,
          json: false,
          view: "human",
        });
      });

      const cached = expectSpaceConfigReadValue(
        await readSpaceConfig({
          openMeldProfileId: PROFILE.openMeldProfileId,
          space: VALID_SPACE_ID,
        })
      );
      expect(cached.guide).toBeUndefined();
    });
  });

  it("prompts for a password and retries protected guide reads", async () => {
    await withTempHome(async () => {
      getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
      passwordPromptMock.mockResolvedValueOnce("secret-0321");
      await withSilencedStdio(async () => {
        await runInit({
          profile: PROFILE.openMeldProfileId,
          profileId: HUMAN_PROFILE_ID,
          profileName: PROFILE.profileName,
          kind: "human",
        });
      });

      // Key the password retry on the space-meta read itself, not on call
      // order: profile resolution now makes its own gateway requests
      // (/v1/profiles/resolve, /v1/profiles) ahead of the meta read, so a
      // positional "first request" stub would mis-target those and never
      // exercise the protected meta path.
      vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
        const url = String(input);
        if (url.includes(`/spaces/${VALID_SPACE_ID}/meta`)) {
          const password =
            new Headers(init?.headers).get("x-openmeld-space-password") ?? "";
          if (password !== "secret-0321") {
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  ok: false,
                  error: {
                    code: "space.password_required",
                    message: "space password required",
                  },
                }),
                {
                  status: 401,
                  headers: { "content-type": "application/json" },
                }
              )
            );
          }
          return Promise.resolve(
            new Response(
              JSON.stringify(
                createSpaceMetaFixture({
                  spaceId: VALID_SPACE_ID,
                  guide: "Protected guide",
                })
              ),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify({}), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
        );
      });

      const { plainStdout } = await withCapturedStdio(async () => {
        await runSpaceGuideRead({
          profile: PROFILE.openMeldProfileId,
          baseUrl: "http://localhost",
          space: VALID_SPACE_ID,
          json: false,
          view: "human",
        });
      });

      expect(passwordPromptMock).toHaveBeenCalledTimes(1);
      expect(plainStdout).toContain(
        "This space is protected. Enter password to continue."
      );
      expect(plainStdout).toContain("Protected guide");
    });
  });

  it("does not overwrite a corrupt local guide cache file", async () => {
    await withTempHome(async (home) => {
      getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
      await withSilencedStdio(async () => {
        await runInit({
          profile: PROFILE.openMeldProfileId,
          profileId: HUMAN_PROFILE_ID,
          profileName: PROFILE.profileName,
          kind: "human",
        });
      });

      const cacheDir = join(home, ...FALLBACK_SPACE_CACHE_PATH);
      const cachePath = join(cacheDir, `${VALID_SPACE_ID}.json`);
      await mkdir(cacheDir, { recursive: true });
      await writeFile(cachePath, "{", "utf8");

      vi.spyOn(globalThis, "fetch").mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify(
              createSpaceMetaFixture({
                spaceId: VALID_SPACE_ID,
                name: "ops-room",
                guide: "Keep public replies concise.",
                updatedAt: "2026-03-21T01:00:00.000Z",
              })
            ),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            }
          )
        )
      );

      await expect(
        runSpaceGuideSet({
          profile: PROFILE.openMeldProfileId,
          baseUrl: "http://localhost",
          space: VALID_SPACE_ID,
          guide: "Keep public replies concise.",
          json: false,
          view: "human",
        })
      ).rejects.toBeInstanceOf(LocalSpaceStateIntegrityError);

      await expect(readFile(cachePath, "utf8")).resolves.toBe("{");
    });
  });
});
