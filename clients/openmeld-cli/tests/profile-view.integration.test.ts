import { afterEach, describe, expect, it, vi } from "vitest";
import {
  runProfileDelete,
  runProfileList,
  runProfileMenu,
  runProfileSet,
  runProfileUpdate,
} from "../src/commands/profile";
import { setAuthSession } from "../src/config/auth-session";
import { resetOpenMeldProfilesSessionCacheForTests } from "../src/config/openmeld-profiles-api";
import { withCapturedStdio, withTempHome } from "./helpers/fs";
import { createTestProfileHandle } from "./helpers/openmeld-profile-fixture";

describe("profile view mode", () => {
  afterEach(() => {
    resetOpenMeldProfilesSessionCacheForTests();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("throws dual-view guide in agent view menu without fallback list output", async () => {
    await withTempHome(async () => {
      let thrown: unknown = null;
      const { stdout } = await withCapturedStdio(async () => {
        try {
          await runProfileMenu({ view: "agent" });
        } catch (error) {
          thrown = error;
        }
      });

      expect(thrown).toBeInstanceOf(Error);
      expect(thrown instanceof Error ? thrown.message : "").toContain(
        "openmeld profiles menu is interactive in human view only."
      );
      expect(thrown instanceof Error ? thrown.message : "").toContain(
        "[FOR HUMAN OPERATORS]"
      );
      expect(thrown instanceof Error ? thrown.message : "").toContain(
        "[FOR AGENTS]"
      );
      expect(thrown instanceof Error ? thrown.message : "").toContain(
        "openmeld profiles set <profile-id> [--profile <id>]"
      );
      expect(stdout.trim()).toBe("");
    });
  });

  it("throws menu interactive guide in human view when non-interactive", async () => {
    await withTempHome(async () => {
      await expect(runProfileMenu({ view: "human" })).rejects.toThrow(
        "openmeld profiles menu is interactive in human view only."
      );
    });
  });

  it("emits human and agent profiles in agent view", async () => {
    await withTempHome(async () => {
      await bootstrapAuthSession();

      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(createJsonResponse(createSessionPayload()))
        .mockResolvedValueOnce(
          createJsonResponse({
            ok: true,
            profiles: [
              createProfilePayload({
                openMeldProfileId: "user_1",
                profileName: "Felix",
                profileKind: "human",
              }),
              createProfilePayload({
                openMeldProfileId: "agt_bot_1",
                profileName: "Codex",
                profileKind: "agent",
              }),
            ],
          })
        );
      vi.stubGlobal("fetch", fetchMock);

      const { stdout } = await withCapturedStdio(async () => {
        await runProfileList({ view: "agent" });
      });

      const lines = stdout
        .trim()
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line));

      expect(lines).toHaveLength(2);
      expect(lines[0]).toMatchObject({
        type: "line",
        code: "profile.item",
        data: {
          profile: "user_1",
          openMeldProfileId: "user_1",
          profileName: "Felix",
          profileKind: "human",
          profileStatus: "active",
          ownerUserId: "user-1",
          source: "cli_create",
          createdByUserId: "user-1",
          lastUsedAt: null,
          createdAt: "2026-02-20T00:00:00.000Z",
          updatedAt: "2026-02-20T00:00:00.000Z",
          selected: false,
          default: true,
        },
      });
      expect(lines[1]).toMatchObject({
        type: "line",
        code: "profile.item",
        data: {
          profile: "agt_bot_1",
          openMeldProfileId: "agt_bot_1",
          profileName: "Codex",
          profileKind: "agent",
          profileStatus: "active",
          ownerUserId: "user-1",
          source: "cli_create",
          createdByUserId: "user-1",
          lastUsedAt: null,
          createdAt: "2026-02-20T00:00:00.000Z",
          updatedAt: "2026-02-20T00:00:00.000Z",
          selected: false,
          default: false,
        },
      });
    });
  });

  it("emits all profiles in human view", async () => {
    await withTempHome(async () => {
      await bootstrapAuthSession();

      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(createJsonResponse(createSessionPayload()))
        .mockResolvedValueOnce(
          createJsonResponse({
            ok: true,
            profiles: [
              createProfilePayload({
                openMeldProfileId: "user_1",
                profileName: "Felix",
                profileKind: "human",
              }),
              createProfilePayload({
                openMeldProfileId: "agt_bot_1",
                profileName: "Codex",
                profileKind: "agent",
              }),
            ],
          })
        );
      vi.stubGlobal("fetch", fetchMock);

      const { stdout } = await withCapturedStdio(async () => {
        await runProfileList({ view: "human" });
      });

      const lines = stdout
        .trim()
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      expect(
        lines.some((line) =>
          line.includes("Felix · human · active · id: user_1")
        )
      ).toBe(true);
      expect(lines.some((line) => line.includes("(selected)"))).toBe(false);
      expect(
        lines.some((line) =>
          line.includes("Codex · agent · active · id: agt_bot_1")
        )
      ).toBe(true);
    });
  });

  it("requires explicit profile in agent view for set", async () => {
    await withTempHome(async () => {
      await bootstrapAuthSession();

      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(createJsonResponse(createSessionPayload()))
        .mockResolvedValueOnce(
          createJsonResponse({
            ok: true,
            profiles: [
              createProfilePayload({
                openMeldProfileId: "agt_bot_1",
                profileName: "Codex",
                profileKind: "agent",
              }),
            ],
          })
        );
      vi.stubGlobal("fetch", fetchMock);

      await expect(runProfileSet({ view: "agent" })).rejects.toThrow(
        "openmeld profiles set: explicit profile argument is required in agent view."
      );
    });
  });

  it("renders non-interactive update examples with openmeld-dev commands", async () => {
    await withTempHome(async () => {
      vi.stubEnv("OPENMELD_USER_FACING_CLI_COMMAND", "openmeld-dev");
      await bootstrapAuthSession();

      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(createJsonResponse(createSessionPayload()))
        .mockResolvedValueOnce(
          createJsonResponse({
            ok: true,
            profiles: [
              createProfilePayload({
                openMeldProfileId: "user_1",
                profileName: "Felix",
                profileKind: "human",
              }),
              createProfilePayload({
                openMeldProfileId: "agt_bot_1",
                profileName: "Codex",
                profileKind: "agent",
              }),
            ],
          })
        );
      vi.stubGlobal("fetch", fetchMock);

      let thrown: unknown = null;
      const { stdout } = await withCapturedStdio(async () => {
        try {
          await runProfileUpdate({ view: "human" });
        } catch (error) {
          thrown = error;
        }
      });

      expect(thrown).toBeInstanceOf(Error);
      expect(thrown instanceof Error ? thrown.message : "").toContain(
        "Missing required argument 'profile'"
      );
      expect(stdout).toContain(
        '- openmeld-dev profiles update user_1 --name "<new-name>"'
      );
      expect(stdout).toContain("- openmeld-dev setup --profile agt_bot_1");
      expect(stdout).toContain(
        "- openmeld-dev profiles update agt_bot_1 --workspace-mode custom --workspace-path /absolute/path"
      );
      expect(stdout).not.toContain("- openmeld profiles update user_1");
    });
  });

  it("persists profile selection after profile set in agent view", async () => {
    await withTempHome(async () => {
      await bootstrapAuthSession();

      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(createJsonResponse(createSessionPayload()))
        .mockResolvedValueOnce(
          createJsonResponse({
            ok: true,
            profile: createProfilePayload({
              openMeldProfileId: "agt_bot_2",
              profileName: "Codex 2",
              profileKind: "agent",
            }),
          })
        );
      vi.stubGlobal("fetch", fetchMock);

      const { stdout } = await withCapturedStdio(async () => {
        await runProfileSet({ view: "agent", profile: "agt_bot_2" });
      });
      const lines = stdout
        .trim()
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line));
      const nonPersistent = lines.find(
        (line) => String(line.code ?? "") === "profile.selection.non_persistent"
      );
      expect(nonPersistent).toBeUndefined();
    });
  });

  it("allows selecting a human profile in agent view", async () => {
    await withTempHome(async () => {
      await bootstrapAuthSession();

      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(createJsonResponse(createSessionPayload()))
        .mockResolvedValueOnce(
          createJsonResponse({
            ok: true,
            profile: createProfilePayload({
              openMeldProfileId: "user_1",
              profileName: "Felix",
              profileKind: "human",
            }),
          })
        );
      vi.stubGlobal("fetch", fetchMock);

      const { stdout } = await withCapturedStdio(async () => {
        await runProfileSet({ view: "agent", profile: "user_1" });
      });

      const lines = stdout
        .trim()
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line));
      expect(lines[0]).toMatchObject({
        type: "line",
        code: "profile.current_set",
        data: {
          profile: "user_1",
          openMeldProfileId: "user_1",
          profileName: "Felix",
          profileKind: "human",
        },
      });
    });
  });

  it("rejects deleting a human profile in agent view", async () => {
    await withTempHome(async () => {
      await bootstrapAuthSession();

      const fetchMock = vi.fn((input: unknown, init?: RequestInit) => {
        const url = String(input);
        const method = String(init?.method ?? "GET").toUpperCase();

        if (url.endsWith("/api/auth/get-session")) {
          return createJsonResponse(createSessionPayload());
        }

        if (url.endsWith("/v1/profiles") && method === "GET") {
          return createJsonResponse({
            ok: true,
            profiles: [
              createProfilePayload({
                openMeldProfileId: "user_1",
                profileName: "Felix",
                profileKind: "human",
              }),
            ],
          });
        }

        if (url.endsWith("/v1/profiles/resolve") && method === "POST") {
          return createJsonResponse({
            ok: true,
            profile: createProfilePayload({
              openMeldProfileId: "user_1",
              profileName: "Felix",
              profileKind: "human",
            }),
          });
        }

        return createJsonResponse(
          { ok: false, error: "unexpected request" },
          500
        );
      });
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        runProfileDelete({
          view: "agent",
          profile: "user_1",
          force: true,
        })
      ).rejects.toThrow(
        "agent view can select or inspect human profiles, but human profile changes require human view"
      );
    });
  });

  it("rejects updating a human profile in agent view", async () => {
    await withTempHome(async () => {
      await bootstrapAuthSession();

      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(createJsonResponse(createSessionPayload()))
        .mockResolvedValueOnce(
          createJsonResponse({
            ok: true,
            profile: createProfilePayload({
              openMeldProfileId: "user_1",
              profileName: "Felix",
              profileKind: "human",
            }),
          })
        );
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        runProfileUpdate({
          view: "agent",
          profile: "user_1",
          profileName: "Felix 2",
        })
      ).rejects.toThrow(
        "agent view can select or inspect human profiles, but human profile changes require human view"
      );
    });
  });

  it("returns dual-view guide for missing profile in agent update", async () => {
    await withTempHome(async () => {
      await bootstrapAuthSession();

      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(createJsonResponse(createSessionPayload()))
        .mockResolvedValueOnce(
          createJsonResponse({
            ok: true,
            profiles: [
              createProfilePayload({
                openMeldProfileId: "agt_1",
                profileName: "Agent One",
                profileKind: "agent",
              }),
            ],
          })
        );
      vi.stubGlobal("fetch", fetchMock);

      await expect(runProfileUpdate({ view: "agent" })).rejects.toThrow(
        "openmeld profiles update: explicit profile argument is required in agent view."
      );
    });
  });
});

async function bootstrapAuthSession(): Promise<void> {
  process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
  await setAuthSession({
    accessToken: "token-1",
    tokenType: "Bearer",
    authBaseUrl: "https://auth.openmeld.invalid",
    clientId: "openmeld-cli",
  });
}

function createSessionPayload() {
  return {
    session: { id: "session-1" },
    user: {
      id: "user-1",
      email: "you@company.com",
      name: "Felix",
    },
  };
}

function createProfilePayload(input: {
  openMeldProfileId: string;
  profileName: string;
  profileKind: "human" | "agent" | "system";
}) {
  return {
    openMeldProfileId: input.openMeldProfileId,
    profileName: input.profileName,
    profileHandle: createTestProfileHandle(
      input.profileName,
      input.profileKind
    ),
    profileKind: input.profileKind,
    isDefault: input.profileKind === "human",
    status: "active",
    ownerUserId: "user-1",
    source: "cli_create",
    createdByUserId: "user-1",
    lastUsedAt: null,
    createdAt: "2026-02-20T00:00:00.000Z",
    updatedAt: "2026-02-20T00:00:00.000Z",
  };
}

function createJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}
