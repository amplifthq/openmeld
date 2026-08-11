import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  runProfileCreate,
  runProfileDelete,
  runProfileList,
  runProfileSet,
  runProfileShow,
  runProfileUpdate,
} from "../src/commands/profile";
import { setAuthSession } from "../src/config/auth-session";
import {
  getSelectedOpenMeldProfileId,
  setSelectedOpenMeldProfileId,
} from "../src/config/openmeld-profile-selection";
import { resetOpenMeldProfilesSessionCacheForTests } from "../src/config/openmeld-profiles-api";
import { readProfileWorkspaceConfig } from "../src/profile-workspace/service";
import {
  createEnabledPreferredBuiltinTargetState,
  resolvePreferredAgentControllerRef,
} from "./helpers/agent-registry-derived";
import {
  withCapturedStdio,
  withSilencedStdio,
  withTempHome,
} from "./helpers/fs";
import { createTestProfileHandle } from "./helpers/openmeld-profile-fixture";

describe("profiles", () => {
  afterEach(() => {
    resetOpenMeldProfilesSessionCacheForTests();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("sets selected OpenMeld profile via resolve API", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-1",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
      });

      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(createJsonResponse(createSessionPayload()))
        .mockResolvedValueOnce(
          createJsonResponse({
            ok: true,
            profile: createProfilePayload({
              openMeldProfileId: "agt_bot_1",
              profileKind: "agent",
            }),
          })
        )
        .mockResolvedValueOnce(createJsonResponse(createSessionPayload()))
        .mockResolvedValueOnce(
          createJsonResponse({
            ok: true,
            profile: createProfilePayload({
              openMeldProfileId: "agt_show_human",
              profileName: "Show Human Bot",
              profileKind: "agent",
            }),
          })
        )
        .mockResolvedValueOnce(createJsonResponse(createSessionPayload()))
        .mockResolvedValueOnce(
          createJsonResponse({
            ok: true,
            profile: createProfilePayload({
              openMeldProfileId: "agt_show_human",
              profileName: "Show Human Bot",
              profileKind: "agent",
            }),
          })
        );
      vi.stubGlobal("fetch", fetchMock);

      const { stdout } = await withCapturedStdio(async () => {
        await runProfileSet({ profile: "agt_bot_1", view: "human" });
      });

      expect(await getSelectedOpenMeldProfileId()).toBe("agt_bot_1");
      expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
        "https://auth.openmeld.invalid/api/auth/get-session"
      );
      expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
        "https://auth.openmeld.invalid/v1/profiles/resolve"
      );
      expect(stdout).toContain("Profile Created");
      expect(stdout).toContain("Result: Selected");
      expect(stdout).toContain("Profile ID: agt_bot_1");
      expect(stdout).toContain("Profile Handle: @agt-bot-1");
      expect(stdout).not.toContain("Local agent selection:");
      expect(stdout).not.toContain("Agent On:");
      expect(stdout).toContain("Connection Type: Not set up");
      expect(stdout).toContain(
        "Can Reply in Space: Blocked (Connect a local agent before this profile can reply.)"
      );
    });
  });

  it("keeps structured set output in agent view", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-1",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
      });

      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(createJsonResponse(createSessionPayload()))
        .mockResolvedValueOnce(
          createJsonResponse({
            ok: true,
            profile: createProfilePayload({
              openMeldProfileId: "agt_bot_1",
              profileName: "Research Bot",
              profileKind: "agent",
            }),
          })
        );
      vi.stubGlobal("fetch", fetchMock);

      const { stdout } = await withCapturedStdio(async () => {
        await runProfileSet({ profile: "agt_bot_1", view: "agent" });
      });

      const lines = stdout
        .trim()
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as { code?: string; data?: unknown });
      const codes = lines.map((line) => String(line.code ?? ""));
      expect(codes).toEqual(["profile.current_set"]);
      const setLine = lines.find(
        (line) => String(line.code ?? "") === "profile.current_set"
      );
      expect(setLine).toMatchObject({
        data: {
          openMeldProfileId: "agt_bot_1",
          profileName: "Research Bot",
          profileHandle: "research-bot",
          profileKind: "agent",
          transportMode: "not configured",
          autoReplyReady: false,
          autoReplyReason:
            "Connect a local agent before this profile can reply.",
        },
      });
      expect(
        codes.some((code) => code.startsWith("profile.created.card"))
      ).toBe(false);
      expect(
        codes.some((code) => code.startsWith("profile.current_set.card"))
      ).toBe(false);
    });
  });

  it("creates OpenMeld agent profile and selects it when kind is agent", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-1",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
      });

      const fetchMock = createProfileCreateFetchMock({
        createPath: "/v1/profiles/agents",
        createStatus: 201,
        createResponseBody: {
          ok: true,
          profile: createProfilePayload({
            openMeldProfileId: "agt_bot_new",
            profileName: "Research Bot",
            profileKind: "agent",
          }),
        },
      });
      vi.stubGlobal("fetch", fetchMock);

      const { stdout } = await withCapturedStdio(async () => {
        await runProfileCreate({
          profileName: "Research Bot",
          kind: "agent",
          view: "human",
        });
      });

      expect(await getSelectedOpenMeldProfileId()).toBe("agt_bot_new");
      await expect(
        readProfileWorkspaceConfig({
          openMeldProfileId: "agt_bot_new",
        })
      ).resolves.toMatchObject({
        status: "missing",
      });
      expect(
        fetchMock.mock.calls.some(
          ([request, init]) =>
            String(request) ===
              "https://auth.openmeld.invalid/v1/profiles/agents" &&
            String(
              (init as RequestInit | undefined)?.method ?? "GET"
            ).toUpperCase() === "POST"
        )
      ).toBe(true);
      expect(stdout).toContain("Agent Profile Identity Created");
      expect(stdout).toContain("Space identity: Created");
      expect(stdout).toContain(
        "Next: Add this profile to a Space when the user wants this teammate to participate."
      );
      expect(stdout).toContain("Profile Name: Research Bot");
      expect(stdout).toContain("Profile Handle: @research-bot");
      expect(stdout).toContain("Type: agent");
      expect(stdout).toContain("Profile ID: agt_bot_new");
      expect(stdout).toContain("Account ID: user-1");
      expect(stdout).not.toContain("Local agent selection:");
      expect(stdout).not.toContain("Agent On:");
      expect(stdout).not.toContain("Connection Type:");
      expect(stdout).not.toContain("Can Reply in Space:");
    });
  });

  it("creates OpenMeld human profile and selects it when kind is human", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-1",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
      });

      const fetchMock = createProfileCreateFetchMock({
        createPath: "/v1/profiles/humans",
        createStatus: 201,
        createResponseBody: {
          ok: true,
          profile: createProfilePayload({
            openMeldProfileId: "hum_felix_new",
            profileName: "Felix Secondary",
            profileKind: "human",
          }),
        },
      });
      vi.stubGlobal("fetch", fetchMock);

      const { stdout } = await withCapturedStdio(async () => {
        await runProfileCreate({
          profileName: "Felix Secondary",
          kind: "human",
          view: "human",
        });
      });

      expect(await getSelectedOpenMeldProfileId()).toBe("hum_felix_new");
      expect(
        fetchMock.mock.calls.some(
          ([request]) =>
            String(request) ===
            "https://auth.openmeld.invalid/v1/profiles/humans"
        )
      ).toBe(true);
      expect(stdout).toContain("Profile Name: Felix Secondary");
      expect(stdout).toContain("Profile Handle: @felix-secondary");
      expect(stdout).toContain("Type: human");
      expect(stdout).toContain("Profile ID: hum_felix_new");
      expect(stdout).toContain("Account ID: user-1");
    });
  });

  it("surfaces local auth migration guidance for profile create internal errors", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-1",
        tokenType: "Bearer",
        authBaseUrl: "http://localhost:8788",
        clientId: "openmeld-cli-dev",
      });

      const fetchMock = createProfileCreateFetchMock({
        createPath: "/v1/profiles/agents",
        createStatus: 500,
        createResponseBody: {
          ok: false,
          code: "profile.internal_error",
          message: "internal error",
        },
      });
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        runProfileCreate({
          profileName: "Research Bot",
          kind: "agent",
          view: "human",
        })
      ).rejects.toThrow("`pnpm db:migrate:dev`");
    });
  });

  it("surfaces hosted auth guidance for profile create internal errors", async () => {
    await withTempHome(async () => {
      const agentControllerRef = resolvePreferredAgentControllerRef();
      const agentsRegistry = await import("../src/agents/registry");
      const listAgentTargetStatesSpy = vi
        .spyOn(agentsRegistry, "listAgentTargetStates")
        .mockResolvedValue([createEnabledPreferredBuiltinTargetState()]);
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-1",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
      });

      const fetchMock = createProfileCreateFetchMock({
        createPath: "/v1/profiles/agents",
        createStatus: 500,
        createResponseBody: {
          ok: false,
          code: "profile.internal_error",
          message: "internal error",
        },
      });
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        runProfileCreate({
          profileName: "Research Bot",
          kind: "agent",
          agentController: agentControllerRef,
          controllerEnabled: true,
          view: "human",
        })
      ).rejects.toThrow(
        "hosted auth deployment is likely out of sync with the latest profile flow"
      );
      listAgentTargetStatesSpy.mockRestore();
    });
  });

  it("keeps structured create output in agent view", async () => {
    await withTempHome(async () => {
      vi.stubEnv("OPENMELD_USER_FACING_CLI_COMMAND", "openmeld-dev");
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-1",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
      });

      const fetchMock = createProfileCreateFetchMock({
        createPath: "/v1/profiles/agents",
        createStatus: 201,
        createResponseBody: {
          ok: true,
          profile: createProfilePayload({
            openMeldProfileId: "agt_bot_new",
            profileName: "Research Bot",
            profileKind: "agent",
          }),
        },
      });
      vi.stubGlobal("fetch", fetchMock);

      const { stdout } = await withCapturedStdio(async () => {
        await runProfileCreate({
          profileName: "Research Bot",
          kind: "agent",
          view: "agent",
        });
      });

      const lines = stdout
        .trim()
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as { code?: string; data?: unknown });
      const codes = lines.map((line) => String(line.code ?? ""));
      expect(codes).toEqual(["profile.created", "profile.selection_unchanged"]);
      const createdLine = lines.find(
        (line) => String(line.code ?? "") === "profile.created"
      );
      const selectionLine = lines.find(
        (line) => String(line.code ?? "") === "profile.selection_unchanged"
      );
      expect(createdLine).toMatchObject({
        data: {
          openMeldProfileId: "agt_bot_new",
          profileName: "Research Bot",
          profileHandle: "research-bot",
          profileKind: "agent",
          currentProfileChanged: false,
          identityCreated: true,
          wakeReadinessVerified: false,
          wakeReadinessNote:
            "Profile creation creates the Space identity. Add it to a Space when the user wants this teammate to participate.",
          nextSteps: [
            "openmeld-dev space add-members <space-id> --member agt_bot_new --profile <human-profile-id> --view agent",
          ],
        },
      });
      expect(
        createdLine && "transportMode" in ((createdLine.data ?? {}) as object)
      ).toBe(false);
      expect(
        createdLine && "autoReplyReady" in ((createdLine.data ?? {}) as object)
      ).toBe(false);
      expect(selectionLine).toMatchObject({
        data: {
          createdProfileId: "agt_bot_new",
          currentProfileChanged: false,
          reason:
            "Agent View profile creation does not change the acting identity. Pass --profile explicitly when this profile should act.",
          identityCreated: true,
          wakeReadinessVerified: false,
          wakeReadinessNote:
            "Profile creation creates the Space identity. Add it to a Space when the user wants this teammate to participate.",
          nextSteps: [
            "openmeld-dev space add-members <space-id> --member agt_bot_new --profile <human-profile-id> --view agent",
          ],
        },
      });
      expect(
        codes.some((code) => code.startsWith("profile.created.card"))
      ).toBe(false);
    });
  });

  it("requires explicit kind in agent view for profile create", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-1",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
      });

      await expect(
        runProfileCreate({
          profileName: "Research Bot",
          view: "agent",
        })
      ).rejects.toThrow(
        "agent view requires explicit --kind and only supports creating agent profiles."
      );
    });
  });

  it("deleting selected profile switches to remaining fallback", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-1",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
      });
      await setSelectedOpenMeldProfileId("agt_bot_1");

      let listCallCount = 0;
      const fetchMock = vi.fn((input: unknown, init?: RequestInit) => {
        const url = String(input);
        const method = String(init?.method ?? "GET").toUpperCase();

        if (url.endsWith("/api/auth/get-session")) {
          return createJsonResponse(createSessionPayload());
        }

        if (url.endsWith("/v1/profiles") && method === "GET") {
          listCallCount += 1;
          if (listCallCount === 1) {
            return createJsonResponse({
              ok: true,
              profiles: [
                createProfilePayload({
                  openMeldProfileId: "agt_bot_1",
                  profileKind: "agent",
                }),
                createProfilePayload({
                  openMeldProfileId: "agt_bot_2",
                  profileKind: "agent",
                }),
              ],
            });
          }

          return createJsonResponse({
            ok: true,
            profiles: [
              createProfilePayload({
                openMeldProfileId: "agt_bot_2",
                profileKind: "agent",
              }),
            ],
          });
        }

        if (url.endsWith("/v1/profiles/resolve") && method === "POST") {
          return createJsonResponse({
            ok: true,
            profile: createProfilePayload({
              openMeldProfileId: "agt_bot_1",
              profileKind: "agent",
            }),
          });
        }

        if (url.endsWith("/v1/profiles/agt_bot_1") && method === "DELETE") {
          return createJsonResponse({
            ok: true,
            profile: createProfilePayload({
              openMeldProfileId: "agt_bot_1",
              profileKind: "agent",
            }),
          });
        }

        return createJsonResponse(
          { ok: false, error: "unexpected request" },
          500
        );
      });
      vi.stubGlobal("fetch", fetchMock);

      await withSilencedStdio(async () => {
        await runProfileDelete({
          profile: "agt_bot_1",
          force: true,
          view: "human",
        });
      });

      expect(await getSelectedOpenMeldProfileId()).toBe("agt_bot_2");
    });
  });

  it("delete reconciles stale selected profile pointer", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-1",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
      });
      await setSelectedOpenMeldProfileId("stale_profile");

      let listCallCount = 0;
      const fetchMock = vi.fn((input: unknown, init?: RequestInit) => {
        const url = String(input);
        const method = String(init?.method ?? "GET").toUpperCase();

        if (url.endsWith("/api/auth/get-session")) {
          return createJsonResponse(createSessionPayload());
        }

        if (url.endsWith("/v1/profiles") && method === "GET") {
          listCallCount += 1;
          if (listCallCount === 1) {
            return createJsonResponse({
              ok: true,
              profiles: [
                createProfilePayload({
                  openMeldProfileId: "agt_bot_1",
                  profileKind: "agent",
                }),
              ],
            });
          }
          return createJsonResponse({
            ok: true,
            profiles: [],
          });
        }

        if (url.endsWith("/v1/profiles/resolve") && method === "POST") {
          return createJsonResponse({
            ok: true,
            profile: createProfilePayload({
              openMeldProfileId: "agt_bot_1",
              profileKind: "agent",
            }),
          });
        }

        if (url.endsWith("/v1/profiles/agt_bot_1") && method === "DELETE") {
          return createJsonResponse({
            ok: true,
            profile: createProfilePayload({
              openMeldProfileId: "agt_bot_1",
              profileKind: "agent",
            }),
          });
        }

        return createJsonResponse(
          { ok: false, error: "unexpected request" },
          500
        );
      });
      vi.stubGlobal("fetch", fetchMock);

      await withSilencedStdio(async () => {
        await runProfileDelete({
          profile: "agt_bot_1",
          force: true,
          view: "human",
        });
      });

      expect(await getSelectedOpenMeldProfileId()).toBeNull();
    });
  });

  it("list marks selected OpenMeld profile as default", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-1",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
      });
      await setSelectedOpenMeldProfileId("agt_bot_2");

      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(createJsonResponse(createSessionPayload()))
        .mockResolvedValueOnce(
          createJsonResponse({
            ok: true,
            profiles: [
              createProfilePayload({
                openMeldProfileId: "user_1",
                profileKind: "human",
              }),
              createProfilePayload({
                openMeldProfileId: "agt_bot_2",
                profileKind: "agent",
              }),
            ],
          })
        );
      vi.stubGlobal("fetch", fetchMock);

      const { stdout } = await withCapturedStdio(() =>
        runProfileList({ view: "human" })
      );

      expect(stdout).toContain("* agt_bot_2 (selected)");
      expect(stdout).toContain("  user_1");
    });
  });

  it("accepts Center Agent managed profiles in Auth profile responses", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-1",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
      });

      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(createJsonResponse(createSessionPayload()))
        .mockResolvedValueOnce(
          createJsonResponse({
            ok: true,
            profiles: [
              createProfilePayload({
                openMeldProfileId: "agt_center_agent",
                profileKind: "agent",
                managedRole: "center_agent",
              }),
              createProfilePayload({
                openMeldProfileId: "agt_regular",
                profileKind: "agent",
              }),
            ],
          })
        );
      vi.stubGlobal("fetch", fetchMock);

      const { stdout } = await withCapturedStdio(() =>
        runProfileList({ view: "human" })
      );

      expect(stdout).toContain("agt_center_agent");
      expect(stdout).toContain("agt_regular");
    });
  });

  it("prompts re-login when profile API returns unauthenticated", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-1",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
      });

      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(createJsonResponse(createSessionPayload()))
        .mockResolvedValueOnce(
          createJsonResponse(
            {
              code: "auth.unauthenticated",
              message: "Unauthorized",
            },
            401
          )
        );
      vi.stubGlobal("fetch", fetchMock);

      await expect(runProfileList({ view: "human" })).rejects.toThrow(
        "sign-in required; run `openmeld login`"
      );
    });
  });

  it("keeps stale selected profile unchanged in read-only list mode", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-1",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
      });
      await setSelectedOpenMeldProfileId("stale_profile");

      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(createJsonResponse(createSessionPayload()))
        .mockResolvedValueOnce(
          createJsonResponse({
            ok: true,
            profiles: [
              createProfilePayload({
                openMeldProfileId: "user_1",
                profileKind: "human",
              }),
              createProfilePayload({
                openMeldProfileId: "agt_bot_2",
                profileKind: "agent",
              }),
            ],
          })
        );
      vi.stubGlobal("fetch", fetchMock);

      await withSilencedStdio(async () => {
        await runProfileList({ view: "human" });
      });

      expect(await getSelectedOpenMeldProfileId()).toBe("stale_profile");
    });
  });

  it("keeps stale selected profile when list is empty", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-1",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
      });
      await setSelectedOpenMeldProfileId("stale_profile");

      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(createJsonResponse(createSessionPayload()))
        .mockResolvedValueOnce(
          createJsonResponse({
            ok: true,
            profiles: [],
          })
        );
      vi.stubGlobal("fetch", fetchMock);

      await withSilencedStdio(async () => {
        await runProfileList({ view: "human" });
      });

      expect(await getSelectedOpenMeldProfileId()).toBe("stale_profile");
    });
  });

  it("keeps human profile creation focused on identity and workspace setup", async () => {
    await withTempHome(async () => {
      const agentControllerRef = resolvePreferredAgentControllerRef();
      const agentsRegistry = await import("../src/agents/registry");
      const listAgentTargetStatesSpy = vi
        .spyOn(agentsRegistry, "listAgentTargetStates")
        .mockResolvedValue([createEnabledPreferredBuiltinTargetState()]);

      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-1",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
      });

      const fetchMock = createProfileCreateFetchMock({
        createPath: "/v1/profiles/agents",
        createStatus: 201,
        createResponseBody: {
          ok: true,
          profile: createProfilePayload({
            openMeldProfileId: "agt_codex_bound",
            profileName: "Codex Bound",
            profileKind: "agent",
          }),
        },
      });
      vi.stubGlobal("fetch", fetchMock);

      const { stdout } = await withCapturedStdio(async () => {
        await runProfileCreate({
          profileName: "Codex Bound",
          kind: "agent",
          agentController: agentControllerRef,
          controllerEnabled: true,
          view: "human",
        });
      });

      expect(stdout).not.toContain("Local agent selection:");
      expect(stdout).not.toContain("Agent On:");
      expect(stdout).not.toContain("Connection Type:");
      expect(stdout).not.toContain("Can Reply in Space:");
      expect(stdout).toContain("Space identity: Created");
      expect(stdout).toContain(
        "Next: Add this profile to a Space when the user wants this teammate to participate."
      );
      await expect(
        readProfileWorkspaceConfig({
          openMeldProfileId: "agt_codex_bound",
        })
      ).resolves.toMatchObject({
        status: "valid",
        value: {
          mode: "openmeld_managed",
        },
      });
      listAgentTargetStatesSpy.mockRestore();
    });
  });

  it("updates OpenMeld agent profile name", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-1",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
      });

      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(createJsonResponse(createSessionPayload()))
        .mockResolvedValueOnce(
          createJsonResponse({
            ok: true,
            profile: createProfilePayload({
              openMeldProfileId: "agt_bot_rename",
              profileName: "Before Rename",
              profileKind: "agent",
            }),
          })
        )
        .mockResolvedValueOnce(
          createJsonResponse({
            ok: true,
            profile: createProfilePayload({
              openMeldProfileId: "agt_bot_rename",
              profileName: "After Rename",
              profileKind: "agent",
            }),
          })
        );
      vi.stubGlobal("fetch", fetchMock);

      const { stdout } = await withCapturedStdio(async () => {
        await runProfileUpdate({
          profile: "agt_bot_rename",
          profileName: "After Rename",
          view: "human",
        });
      });

      expect(stdout).toContain("Profile Created");
      expect(stdout).toContain("Result: Updated");
      expect(stdout).toContain("Profile Name: After Rename");
      expect(stdout).toContain("Profile Handle: @after-rename");

      const patchCall = fetchMock.mock.calls[2];
      expect(String(patchCall?.[0])).toBe(
        "https://auth.openmeld.invalid/v1/profiles/agt_bot_rename"
      );
      expect((patchCall?.[1] as RequestInit | undefined)?.method).toBe("PATCH");
      expect(
        JSON.parse(
          String((patchCall?.[1] as RequestInit | undefined)?.body ?? "{}")
        )
      ).toMatchObject({
        profileName: "After Rename",
      });
    });
  });

  it("prints update candidates and fails in agent view when profile is missing", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-1",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
      });

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
              createProfilePayload({
                openMeldProfileId: "human_1",
                profileName: "Human One",
                profileKind: "human",
              }),
            ],
          })
        );
      vi.stubGlobal("fetch", fetchMock);

      let thrown: unknown = null;
      const { stdout } = await withCapturedStdio(async () => {
        try {
          await runProfileUpdate({
            view: "agent",
          });
        } catch (error) {
          thrown = error;
        }
      });

      expect(thrown).toBeInstanceOf(Error);
      expect(thrown instanceof Error ? thrown.message : "").toContain(
        "openmeld profiles update: explicit profile argument is required in agent view."
      );
      const records = stdout
        .trim()
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as { code?: string; data?: unknown });
      expect(
        records.some(
          (item) => String(item.code ?? "") === "profile.update.candidates"
        )
      ).toBe(false);
    });
  });

  it("prints update candidates and fails in human non-interactive mode when profile is missing", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-1",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
      });

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
                openMeldProfileId: "agt_2",
                profileName: "Agent Two",
                profileKind: "agent",
              }),
            ],
          })
        );
      vi.stubGlobal("fetch", fetchMock);

      let thrown: unknown = null;
      const { stdout } = await withCapturedStdio(async () => {
        try {
          await runProfileUpdate({
            view: "human",
          });
        } catch (error) {
          thrown = error;
        }
      });

      expect(thrown).toBeInstanceOf(Error);
      expect(thrown instanceof Error ? thrown.message : "").toContain(
        "Missing required argument 'profile' for `openmeld profiles update`"
      );
      expect(stdout).toContain("Available profiles to update:");
      expect(stdout).toContain("openmeld profiles update user_1 --name");
      expect(stdout).toContain("openmeld setup --profile agt_2");
    });
  });

  it("updates model selection without reconnecting the Binding target", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-1",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
      });

      const fetchMock = vi.fn((input: unknown, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/auth/get-session")) {
          return createJsonResponse(createSessionPayload());
        }
        if (url.endsWith("/v1/profiles/resolve")) {
          return createJsonResponse({
            ok: true,
            profile: createProfilePayload({
              openMeldProfileId: "agt_99999999-9999-4999-8999-999999999999",
              profileName: "Model Bot",
              profileKind: "agent",
            }),
          });
        }
        if (
          url.endsWith(
            "/v1/agent-profiles/agt_99999999-9999-4999-8999-999999999999/primary-binding/model-selection"
          )
        ) {
          return createJsonResponse({
            binding: createPrimaryBindingPayload({
              agentProfileId: "agt_99999999-9999-4999-8999-999999999999",
              modelSelection: {
                modelId: "gpt-5.4-mini",
                reasoningLevel: "medium",
              },
            }).binding,
            grantsClaimSuccess: false,
            outcome: "reused",
            reasonCodes: ["agent_profile_binding.command_eligible"],
            routable: true,
            status: "accepted",
          });
        }
        if (
          url.endsWith(
            "/v1/agent-profiles/agt_99999999-9999-4999-8999-999999999999/primary-binding"
          )
        ) {
          return createJsonResponse(
            createPrimaryBindingPayload({
              agentProfileId: "agt_99999999-9999-4999-8999-999999999999",
              modelSelection: {
                modelId: "gpt-5.4-mini",
                reasoningLevel: "medium",
              },
            })
          );
        }
        return createJsonResponse(
          { ok: false, error: "unexpected request", url, method: init?.method },
          500
        );
      });
      vi.stubGlobal("fetch", fetchMock);

      const { stdout } = await withCapturedStdio(async () => {
        await runProfileUpdate({
          profile: "agt_99999999-9999-4999-8999-999999999999",
          model: "gpt-5.4-mini",
          reasoningEffort: "medium",
          view: "agent",
        });
      });

      const modelPatchCall = fetchMock.mock.calls.find(([request]) =>
        String(request).endsWith(
          "/v1/agent-profiles/agt_99999999-9999-4999-8999-999999999999/primary-binding/model-selection"
        )
      );
      expect(modelPatchCall).toBeTruthy();
      expect((modelPatchCall?.[1] as RequestInit | undefined)?.method).toBe(
        "PATCH"
      );
      expect(
        JSON.parse(
          String((modelPatchCall?.[1] as RequestInit | undefined)?.body ?? "{}")
        )
      ).toEqual({
        modelId: "gpt-5.4-mini",
        reasoningLevel: "medium",
      });
      expect(
        fetchMock.mock.calls.some(
          ([request, init]) =>
            String(request).endsWith(
              "/v1/agent-profiles/agt_99999999-9999-4999-8999-999999999999/primary-binding"
            ) && (init as RequestInit | undefined)?.method === "PUT"
        )
      ).toBe(false);
      expect(
        fetchMock.mock.calls.some(([request]) =>
          String(request).includes("runtime-agent-controller")
        )
      ).toBe(false);
      expect(stdout).toContain('"updatedFields":["modelSelection"]');
    });
  });

  it("updates Agent Controller Permission Mode without reconnecting the Binding target", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-1",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
      });

      const fetchMock = vi.fn((input: unknown, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/auth/get-session")) {
          return createJsonResponse(createSessionPayload());
        }
        if (url.endsWith("/v1/profiles/resolve")) {
          return createJsonResponse({
            ok: true,
            profile: createProfilePayload({
              openMeldProfileId: "agt_88888888-8888-4888-8888-888888888888",
              profileName: "Trusted Bot",
              profileKind: "agent",
            }),
          });
        }
        if (
          url.endsWith(
            "/v1/agent-profiles/agt_88888888-8888-4888-8888-888888888888/primary-binding/agent-controller-permission-mode"
          )
        ) {
          return createJsonResponse({
            binding: createPrimaryBindingPayload({
              agentControllerPermissionMode: "codex:approveForMe",
              agentProfileId: "agt_88888888-8888-4888-8888-888888888888",
            }).binding,
            grantsClaimSuccess: false,
            outcome: "reused",
            reasonCodes: ["agent_profile_binding.command_eligible"],
            routable: true,
            status: "accepted",
          });
        }
        if (
          url.endsWith(
            "/v1/agent-profiles/agt_88888888-8888-4888-8888-888888888888/primary-binding"
          )
        ) {
          return createJsonResponse(
            createPrimaryBindingPayload({
              agentControllerPermissionMode: "codex:approveForMe",
              agentProfileId: "agt_88888888-8888-4888-8888-888888888888",
            })
          );
        }
        return createJsonResponse(
          { ok: false, error: "unexpected request", url, method: init?.method },
          500
        );
      });
      vi.stubGlobal("fetch", fetchMock);

      const { stdout } = await withCapturedStdio(async () => {
        await runProfileUpdate({
          profile: "agt_88888888-8888-4888-8888-888888888888",
          agentControllerPermissionModeInput: "approve-for-me",
          view: "agent",
        });
      });

      const permissionModePatchCall = fetchMock.mock.calls.find(([request]) =>
        String(request).endsWith(
          "/v1/agent-profiles/agt_88888888-8888-4888-8888-888888888888/primary-binding/agent-controller-permission-mode"
        )
      );
      expect(permissionModePatchCall).toBeTruthy();
      expect(
        (permissionModePatchCall?.[1] as RequestInit | undefined)?.method
      ).toBe("PATCH");
      expect(
        JSON.parse(
          String(
            (permissionModePatchCall?.[1] as RequestInit | undefined)?.body ??
              "{}"
          )
        )
      ).toEqual({
        agentControllerPermissionMode: "codex:approveForMe",
      });
      expect(
        fetchMock.mock.calls.some(
          ([request, init]) =>
            String(request).endsWith(
              "/v1/agent-profiles/agt_88888888-8888-4888-8888-888888888888/primary-binding"
            ) && (init as RequestInit | undefined)?.method === "PUT"
        )
      ).toBe(false);
      expect(
        fetchMock.mock.calls.some(([request]) =>
          String(request).includes("runtime-agent-controller")
        )
      ).toBe(false);
      expect(stdout).toContain(
        '"updatedFields":["agentControllerPermissionMode"]'
      );
      expect(stdout).toContain(
        '"agentControllerPermissionMode":"codex:approveForMe"'
      );
    });
  });

  it("shows unified workspace facts in human profile show", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-1",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
      });
      const workspacePath = await mkdtemp(
        join(tmpdir(), "openmeld-profile-show-human-")
      );

      const fetchMock = vi.fn((input: unknown) => {
        const url = String(input);
        if (url.endsWith("/api/auth/get-session")) {
          return createJsonResponse(createSessionPayload());
        }
        if (url.endsWith("/v1/profiles/resolve")) {
          return createJsonResponse({
            ok: true,
            profile: createProfilePayload({
              openMeldProfileId: "agt_show_human",
              profileName: "Show Human Bot",
              profileKind: "agent",
            }),
          });
        }
        return createJsonResponse(
          { ok: false, error: "unexpected request" },
          500
        );
      });
      vi.stubGlobal("fetch", fetchMock);

      await runProfileUpdate({
        profile: "agt_show_human",
        workspaceMode: "custom",
        workspacePath,
        view: "human",
      });

      const { stdout } = await withCapturedStdio(async () => {
        await runProfileShow({
          profile: "agt_show_human",
          view: "human",
        });
      });

      expect(stdout).toContain("Profile");
      expect(stdout).toContain("Profile Name: Show Human Bot");
      expect(stdout).toContain("Server Can Reach This Device: Unavailable");
      expect(stdout).toContain("Workspace: Custom");
      expect(stdout).toContain(`Workspace Folder: ${workspacePath}`);
      expect(stdout).toContain(`Current Working Folder: ${workspacePath}`);
    });
  });

  it("shows unified workspace facts in agent profile show payload", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-1",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
      });

      const fetchMock = vi.fn((input: unknown) => {
        const url = String(input);
        if (url.endsWith("/api/auth/get-session")) {
          return createJsonResponse(createSessionPayload());
        }
        if (url.endsWith("/v1/profiles/resolve")) {
          return createJsonResponse({
            ok: true,
            profile: createProfilePayload({
              openMeldProfileId: "agt_show_agent",
              profileName: "Show Agent Bot",
              profileKind: "agent",
            }),
          });
        }
        if (url.includes("/v1/agent-profiles/agt_show_agent/primary-binding")) {
          return createJsonResponse(
            createPrimaryBindingPayload({
              agentProfileId: "agt_show_agent",
              modelSelection: {
                modelId: "gpt-5.4-mini",
                reasoningLevel: "low",
              },
            })
          );
        }
        return createJsonResponse(
          { ok: false, error: "unexpected request" },
          500
        );
      });
      vi.stubGlobal("fetch", fetchMock);

      await runProfileUpdate({
        profile: "agt_show_agent",
        workspaceMode: "openmeld-managed",
        view: "agent",
      });

      const { stdout } = await withCapturedStdio(async () => {
        await runProfileShow({
          profile: "agt_show_agent",
          view: "agent",
        });
      });

      const lines = stdout
        .trim()
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as { code?: string; data?: unknown });
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({
        code: "profile.show",
        data: {
          openMeldProfileId: "agt_show_agent",
          profileName: "Show Agent Bot",
          binding: {
            modelSelection: {
              modelId: "gpt-5.4-mini",
              reasoningLevel: "low",
            },
          },
          wakeRouteEvidence: {
            status: "unavailable",
            reasonCode: "lookup_failed",
          },
          workspace: {
            workspace: "OpenMeld-managed",
            workspaceSource: "OpenMeld-managed",
          },
        },
      });
    });
  });

  it("includes model selection in profile show json binding payload", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-1",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
      });

      const fetchMock = vi.fn((input: unknown) => {
        const url = String(input);
        if (url.endsWith("/api/auth/get-session")) {
          return createJsonResponse(createSessionPayload());
        }
        if (url.endsWith("/v1/profiles/resolve")) {
          return createJsonResponse({
            ok: true,
            profile: createProfilePayload({
              openMeldProfileId: "agt_show_json_model",
              profileName: "Show JSON Model Bot",
              profileKind: "agent",
            }),
          });
        }
        if (
          url.includes("/v1/agent-profiles/agt_show_json_model/primary-binding")
        ) {
          return createJsonResponse(
            createPrimaryBindingPayload({
              agentProfileId: "agt_show_json_model",
              modelSelection: {
                modelId: "gpt-5.4-mini",
                reasoningLevel: "low",
              },
            })
          );
        }
        return createJsonResponse(
          { ok: false, error: "unexpected request" },
          500
        );
      });
      vi.stubGlobal("fetch", fetchMock);

      const consoleLogSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => undefined);
      await runProfileShow({
        json: true,
        profile: "agt_show_json_model",
        view: "agent",
      });

      const [payload] = consoleLogSpy.mock.calls[0] ?? [];
      consoleLogSpy.mockRestore();
      expect(JSON.parse(String(payload))).toMatchObject({
        openMeldProfileId: "agt_show_json_model",
        binding: {
          modelSelection: {
            modelId: "gpt-5.4-mini",
            reasoningLevel: "low",
          },
        },
      });
    });
  });

  it("omits unsupported controller permission mode in profile show json binding payload", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-1",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
      });

      const fetchMock = vi.fn((input: unknown) => {
        const url = String(input);
        if (url.endsWith("/api/auth/get-session")) {
          return createJsonResponse(createSessionPayload());
        }
        if (url.endsWith("/v1/profiles/resolve")) {
          return createJsonResponse({
            ok: true,
            profile: createProfilePayload({
              openMeldProfileId: "agt_show_json_opencode",
              profileName: "Show JSON OpenCode Bot",
              profileKind: "agent",
            }),
          });
        }
        if (
          url.includes(
            "/v1/agent-profiles/agt_show_json_opencode/primary-binding"
          )
        ) {
          return createJsonResponse(
            createPrimaryBindingPayload({
              agentControllerPermissionMode: "claude-code:default",
              agentControllerRef: "builtin:opencode",
              agentProfileId: "agt_show_json_opencode",
            })
          );
        }
        return createJsonResponse(
          { ok: false, error: "unexpected request" },
          500
        );
      });
      vi.stubGlobal("fetch", fetchMock);

      const consoleLogSpy = vi
        .spyOn(console, "log")
        .mockImplementation(() => undefined);
      await runProfileShow({
        json: true,
        profile: "agt_show_json_opencode",
        view: "agent",
      });

      const [payload] = consoleLogSpy.mock.calls[0] ?? [];
      consoleLogSpy.mockRestore();
      expect(JSON.parse(String(payload))).toMatchObject({
        openMeldProfileId: "agt_show_json_opencode",
        binding: {
          agentControllerPermissionMode: null,
          agentControllerRef: "builtin:opencode",
        },
      });
    });
  });

  it("updates profile workspace to OpenMeld-managed in agent view", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-1",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
      });

      const fetchMock = vi.fn((input: unknown) => {
        const url = String(input);
        if (url.endsWith("/api/auth/get-session")) {
          return createJsonResponse(createSessionPayload());
        }
        if (url.endsWith("/v1/profiles/resolve")) {
          return createJsonResponse({
            ok: true,
            profile: createProfilePayload({
              openMeldProfileId: "agt_update_workspace_managed",
              profileName: "Workspace Managed Bot",
              profileKind: "agent",
            }),
          });
        }
        if (
          url.includes(
            "/v1/agent-profiles/agt_update_workspace_managed/primary-binding"
          )
        ) {
          return createJsonResponse(
            createPrimaryBindingPayload({
              agentProfileId: "agt_update_workspace_managed",
              modelSelection: {
                modelId: "gpt-5.4-mini",
                reasoningLevel: "low",
              },
            })
          );
        }
        return createJsonResponse(
          { ok: false, error: "unexpected request" },
          500
        );
      });
      vi.stubGlobal("fetch", fetchMock);

      const { stdout } = await withCapturedStdio(async () => {
        await runProfileUpdate({
          profile: "agt_update_workspace_managed",
          workspaceMode: "openmeld-managed",
          view: "agent",
        });
      });

      await expect(
        readProfileWorkspaceConfig({
          openMeldProfileId: "agt_update_workspace_managed",
        })
      ).resolves.toMatchObject({
        status: "valid",
        value: {
          mode: "openmeld_managed",
        },
      });

      const lines = stdout
        .trim()
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as { code?: string; data?: unknown });
      const updatedLine = lines.find(
        (line) => String(line.code ?? "") === "profile.updated"
      );
      expect(updatedLine).toMatchObject({
        data: {
          openMeldProfileId: "agt_update_workspace_managed",
          binding: {
            modelSelection: {
              modelId: "gpt-5.4-mini",
              reasoningLevel: "low",
            },
          },
          updatedFields: ["workspace"],
          workspace: {
            workspace: "OpenMeld-managed",
            workspaceSource: "OpenMeld-managed",
          },
        },
      });
    });
  });

  it("requires workspace path when custom workspace mode is requested", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-1",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
      });

      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(createJsonResponse(createSessionPayload()))
        .mockResolvedValueOnce(
          createJsonResponse({
            ok: true,
            profile: createProfilePayload({
              openMeldProfileId: "agt_update_workspace_custom",
              profileName: "Workspace Custom Bot",
              profileKind: "agent",
            }),
          })
        );
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        runProfileUpdate({
          profile: "agt_update_workspace_custom",
          workspaceMode: "custom",
          view: "agent",
        })
      ).rejects.toThrow(
        "--workspace-path is required when --workspace-mode custom is used."
      );
    });
  });
});

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
  profileName?: string;
  profileKind: "human" | "agent" | "system";
  managedRole?: "openmeld_assistant" | "center_agent" | null;
}) {
  return {
    openMeldProfileId: input.openMeldProfileId,
    profileName: input.profileName ?? input.openMeldProfileId,
    profileHandle: createTestProfileHandle(
      input.profileName ?? input.openMeldProfileId,
      input.profileKind
    ),
    profileKind: input.profileKind,
    isDefault: input.profileKind === "human",
    status: "active",
    ownerUserId: "user-1",
    source: "cli_create",
    managedRole: input.managedRole ?? null,
    createdByUserId: "user-1",
    lastUsedAt: null,
    createdAt: "2026-02-20T00:00:00.000Z",
    updatedAt: "2026-02-20T00:00:00.000Z",
  };
}

function createPrimaryBindingPayload(input: {
  agentControllerRef?: string;
  agentControllerPermissionMode?:
    | "claude-code:default"
    | "claude-code:acceptEdits"
    | "claude-code:plan"
    | "claude-code:auto"
    | "claude-code:dontAsk"
    | "claude-code:bypassPermissions"
    | "codex:askForApproval"
    | "codex:approveForMe"
    | "codex:fullAccess"
    | "codex:customConfig";
  agentProfileId: string;
  modelSelection?: {
    modelId: string;
    reasoningLevel?: string;
  };
}) {
  return {
    binding: {
      agentProfileId: input.agentProfileId,
      authoritySource: "binding_truth",
      bindingId: `binding_${input.agentProfileId}`,
      bindingState: "enabled_primary",
      dispatchEligibility: {
        reasonCodes: ["agent_profile_binding.command_eligible"],
        routable: true,
        status: "routable",
      },
      executionTarget: {
        agentControllerRef: input.agentControllerRef ?? "builtin:codex",
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: "runtime_test",
        },
      },
      grantsClaimSuccess: false,
      ...(input.agentControllerPermissionMode
        ? { agentControllerPermissionMode: input.agentControllerPermissionMode }
        : {}),
      ...(input.modelSelection ? { modelSelection: input.modelSelection } : {}),
      reasonCodes: ["agent_profile_binding.command_eligible"],
      resolutionSource: "binding_truth",
      routable: true,
    },
    grantsClaimSuccess: false,
    status: "found",
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

function createProfileCreateFetchMock(input: {
  createPath: string;
  listProfilesResponseBody?: unknown;
  createResponseBody: unknown;
  createStatus?: number;
}) {
  return vi.fn((request: unknown, init?: RequestInit) => {
    const url = String(request);
    const method = String(init?.method ?? "GET").toUpperCase();

    if (url.endsWith("/api/auth/get-session")) {
      return createJsonResponse(createSessionPayload());
    }

    if (url.endsWith("/v1/profiles/capabilities") && method === "GET") {
      return createJsonResponse({
        ok: true,
        additionalHumanProfileCreationEnabled: true,
      });
    }

    if (url.endsWith(input.createPath) && method === "POST") {
      return createJsonResponse(
        input.createResponseBody,
        input.createStatus ?? 200
      );
    }

    if (url.endsWith("/v1/profiles") && method === "GET") {
      return createJsonResponse(
        input.listProfilesResponseBody ?? {
          ok: true,
          profiles: [],
        }
      );
    }

    throw new Error(`unexpected request: ${method} ${url}`);
  });
}
