import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenMeldProfile } from "../src/config/openmeld-profiles-api";

const listOpenMeldProfilesMock = vi.hoisted(() => vi.fn());
const getAuthSessionStateMock = vi.hoisted(() => vi.fn());
const emitSpaceCommandPreflightMock = vi.hoisted(() => vi.fn());
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

vi.mock("@clack/prompts", () => {
  return {
    cancel: vi.fn(),
    confirm: vi.fn(),
    isCancel: vi.fn(() => false),
    select: vi.fn(() => "no"),
    text: vi.fn(async () => "input"),
  };
});

vi.mock("../src/space/connect", () => {
  return {
    runConnect: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("../src/space/preflight", () => ({
  emitSpaceCommandPreflight: (
    ...args: Parameters<typeof emitSpaceCommandPreflightMock>
  ) => emitSpaceCommandPreflightMock(...args),
  emitResolvedSpaceCommandPreflight: vi.fn(),
  emitSpaceFailureNextStep: vi.fn(),
  resolveSpaceFailureGuidance: vi.fn(),
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

vi.mock("../src/config/resolve-openmeld-profile", () => {
  const toProfile = (openMeldProfileId: string) => {
    const isHuman = openMeldProfileId.toLowerCase().includes("mira");
    return {
      openMeldProfileId,
      profileName: isHuman ? "Mira" : "Codex",
      profileKind: isHuman ? "human" : "agent",
      status: "active",
      ownerUserId: "user-1",
      source: "cli_create",
      createdByUserId: "user-1",
      lastUsedAt: null,
      createdAt: "2026-02-20T00:00:00.000Z",
      updatedAt: "2026-02-20T00:00:00.000Z",
    } as const;
  };
  return {
    requireOpenMeldProfile: vi.fn(
      async ({ openMeldProfileId }: { openMeldProfileId?: string }) =>
        toProfile(String(openMeldProfileId ?? "default"))
    ),
    resolveOpenMeldProfileOrNull: vi.fn(
      async ({ openMeldProfileId }: { openMeldProfileId?: string }) =>
        toProfile(String(openMeldProfileId ?? "default"))
    ),
  };
});

vi.mock("../src/config/openmeld-profiles-api", () => {
  return {
    listOpenMeldProfiles: (
      ...args: Parameters<typeof listOpenMeldProfilesMock>
    ) => listOpenMeldProfilesMock(...args),
    resolveOpenMeldProfileByIdOrName: vi.fn(
      ({ profileIdentifier }: { profileIdentifier: string }) => {
        const isHuman = profileIdentifier.toLowerCase().includes("mira");
        return Promise.resolve({
          openMeldProfileId: profileIdentifier,
          profileName: isHuman ? "Mira" : "Codex",
          profileHandle: isHuman ? "mira-human" : "codex-agent",
          profileKind: isHuman ? "human" : "agent",
          status: "active",
          ownerUserId: "user-1",
          source: "cli_create",
          createdByUserId: "user-1",
          lastUsedAt: null,
          createdAt: "2026-02-20T00:00:00.000Z",
          updatedAt: "2026-02-20T00:00:00.000Z",
        });
      }
    ),
  };
});

import { runInit } from "../src/commands/init";
import { runSpaceJoin } from "../src/space/command";
import { runConnect } from "../src/space/connect";
import { resolveSpaceJoinRoleAliasBootstrap } from "../src/space/join-role-alias-bootstrap";
import { upsertSpaceConfig } from "../src/space/local-state";
import {
  withCapturedStdio,
  withSilencedStdio,
  withTempHome,
} from "./helpers/fs";

function buildValidationProfile(input: {
  openMeldProfileId: string;
  profileName: string;
  profileKind: "human" | "agent";
}): OpenMeldProfile {
  return {
    openMeldProfileId: input.openMeldProfileId,
    profileName: input.profileName,
    profileHandle: `${input.profileName.toLowerCase().replace(/\s+/g, "-")}-${input.profileKind}`,
    profileKind: input.profileKind,
    status: "active",
    ownerUserId: "user-1",
    source: "cli_create",
    createdByUserId: "user-1",
    lastUsedAt: null,
    createdAt: "2026-02-20T00:00:00.000Z",
    updatedAt: "2026-02-20T00:00:00.000Z",
  };
}

describe("space join role context", () => {
  beforeEach(() => {
    listOpenMeldProfilesMock.mockResolvedValue([]);
    getAuthSessionStateMock.mockReset().mockResolvedValue(VALID_AUTH_STATE);
    emitSpaceCommandPreflightMock.mockReset().mockResolvedValue({
      deviceReplyReadiness: {
        reasonCodes: [],
        reasonText: "Ready",
        replyReadiness: "ready",
        updatedAt: "2026-04-11T00:00:00.000Z",
        wakeableRouteCount: 1,
      },
      payload: {},
      serviceParticipationReadiness: {
        serviceReadiness: "ready",
        summaryText: "Ready",
        detailText:
          "OpenMeld Service is running and the local service link is available on this device",
        nextStepSummary: null,
        nextSteps: [],
        runtimeHeadline: "running",
      },
    });
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/meta")) {
        const segments = url.pathname.split("/");
        const spaceId = segments[3] ?? "";
        return Promise.resolve(
          new Response(
            JSON.stringify({
              spaceId,
              organizationId: "org-1",
              visibility: "private",
            }),
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
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    getAuthSessionStateMock.mockReset();
    listOpenMeldProfilesMock.mockReset();
  });

  it("keeps role fields optional for agent when prompts are unavailable", async () => {
    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runInit({
          profile: "codex--role-required",
          profileId: "aaaaaaaa-0000-0000-0000-000000000000",
          profileName: "Codex",
          kind: "agent",
        });
      });

      await withSilencedStdio(async () => {
        await runSpaceJoin({
          profile: "codex--role-required",
          view: "agent",
          space:
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        });
      });
    });

    expect(runConnect).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: "codex--role-required",
        role: undefined,
      })
    );
  });

  it("does not prompt role fields in agent view even when tty is available", async () => {
    const prompts = await import("@clack/prompts");
    const textMock = vi.mocked(prompts.text);
    const stdinTtyDescriptor = Object.getOwnPropertyDescriptor(
      process.stdin,
      "isTTY"
    );
    const stdoutTtyDescriptor = Object.getOwnPropertyDescriptor(
      process.stdout,
      "isTTY"
    );

    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      configurable: true,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      value: true,
      configurable: true,
    });

    try {
      await withTempHome(async () => {
        await withSilencedStdio(async () => {
          await runInit({
            profile: "codex--role-agent-tty",
            profileId: "abababab-0000-0000-0000-000000000000",
            profileName: "Codex",
            kind: "agent",
          });
        });

        await withSilencedStdio(async () => {
          await runSpaceJoin({
            profile: "codex--role-agent-tty",
            view: "agent",
            space:
              "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          });
        });
      });
    } finally {
      if (stdinTtyDescriptor) {
        Object.defineProperty(process.stdin, "isTTY", stdinTtyDescriptor);
      } else {
        Reflect.deleteProperty(process.stdin, "isTTY");
      }

      if (stdoutTtyDescriptor) {
        Object.defineProperty(process.stdout, "isTTY", stdoutTtyDescriptor);
      } else {
        Reflect.deleteProperty(process.stdout, "isTTY");
      }
    }

    expect(textMock).not.toHaveBeenCalled();
    expect(runConnect).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: "codex--role-agent-tty",
        role: undefined,
      })
    );
  });

  it("passes an explicit role for agent join", async () => {
    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runInit({
          profile: "codex--role-explicit",
          profileId: "bbbbbbbb-0000-0000-0000-000000000000",
          profileName: "Codex",
          kind: "agent",
        });
      });

      await withSilencedStdio(async () => {
        await runSpaceJoin({
          profile: "codex--role-explicit",
          view: "agent",
          space:
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          role: "Architect",
        });
      });
    });

    expect(runConnect).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: "codex--role-explicit",
        space:
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        role: "Architect",
      })
    );
  });

  it("does not auto-assign mentionAlias for agent join when alias is missing", async () => {
    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runInit({
          profile: "codexautoalias",
          profileId: "bcaabbbb-0000-0000-0000-000000000000",
          profileName: "Codex",
          kind: "agent",
        });
      });

      await withSilencedStdio(async () => {
        await runSpaceJoin({
          profile: "codexautoalias",
          view: "agent",
          space:
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          role: "Architect",
        });
      });
    });

    expect(runConnect).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: "codexautoalias",
        mentionAlias: undefined,
      })
    );
  });

  it("keeps explicit mentionAlias when provided", async () => {
    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runInit({
          profile: "codexexplicitalias",
          profileId: "bbcddddd-0000-0000-0000-000000000000",
          profileName: "Codex",
          kind: "agent",
        });
      });

      await withSilencedStdio(async () => {
        await runSpaceJoin({
          profile: "codexexplicitalias",
          view: "agent",
          space:
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          role: "Architect",
          mentionAlias: "codex-main",
        });
      });
    });

    expect(runConnect).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: "codexexplicitalias",
        mentionAlias: "codex-main",
      })
    );
  });

  it("rejects invalid explicit mentionAlias before connect", async () => {
    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runInit({
          profile: "codex-invalid-alias",
          profileId: "ccddeeef-0000-0000-0000-000000000000",
          profileName: "Codex",
          kind: "agent",
        });
      });

      await withSilencedStdio(async () => {
        await expect(
          runSpaceJoin({
            profile: "codex-invalid-alias",
            view: "agent",
            space:
              "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            role: "Architect",
            mentionAlias: "@bad alias",
          })
        ).rejects.toThrow(
          "invalid --mention-alias: use letters/numbers with optional . _ - (max 128 chars)"
        );
      });
    });

    expect(runConnect).not.toHaveBeenCalled();
  });

  it("reuses role context from cloud cursor for agent join", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockImplementation((input) => {
      const url = new URL(String(input));
      if (url.pathname.includes("/cursor")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              role: "Cloud Architect",
              mentionAlias: "cloud-codex",
            }),
            { status: 200 }
          )
        );
      }
      if (url.pathname.endsWith("/meta")) {
        const segments = url.pathname.split("/");
        const spaceId = segments[3] ?? "";
        return Promise.resolve(
          new Response(
            JSON.stringify({
              spaceId,
              organizationId: "org-1",
              visibility: "private",
            }),
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

    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runInit({
          profile: "codex--role-cloud",
          profileId: "bbbbcccc-0000-0000-0000-000000000000",
          profileName: "Codex",
          kind: "agent",
        });
      });

      await withSilencedStdio(async () => {
        await runSpaceJoin({
          profile: "codex--role-cloud",
          view: "agent",
          space:
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        });
      });
    });

    expect(runConnect).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: "codex--role-cloud",
        space:
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        role: "Cloud Architect",
        mentionAlias: "cloud-codex",
      })
    );
  });

  it("reuses role context from cloud cursor for human join when prompts are skipped", async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockImplementation((input) => {
      const url = new URL(String(input));
      if (url.pathname.includes("/cursor")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              role: "Cloud Facilitator",
            }),
            { status: 200 }
          )
        );
      }
      if (url.pathname.endsWith("/meta")) {
        const segments = url.pathname.split("/");
        const spaceId = segments[3] ?? "";
        return Promise.resolve(
          new Response(
            JSON.stringify({
              spaceId,
              organizationId: "org-1",
              visibility: "private",
            }),
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

    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runInit({
          profile: "mira--role-cloud",
          profileId: "ddddcccc-0000-0000-0000-000000000000",
          profileName: "Mira",
          kind: "human",
        });
      });

      await withSilencedStdio(async () => {
        await runSpaceJoin({
          profile: "mira--role-cloud",
          view: "human",
          space:
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          allowPrompt: false,
        });
      });
    });

    expect(runConnect).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: "mira--role-cloud",
        role: "Cloud Facilitator",
      })
    );
  });

  it("falls back to saved local role and alias when cloud cursor is unavailable", async () => {
    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runInit({
          profile: "mira--role-local",
          profileId: "eeeecccc-0000-0000-0000-000000000000",
          profileName: "Mira",
          kind: "human",
        });
      });

      await upsertSpaceConfig({
        openMeldProfileId: "mira--role-local",
        baseUrl: "https://gateway.openmeld.invalid",
        space:
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        profileName: "Mira",
        role: "Local Reviewer",
        mentionAlias: "local-mira",
      });

      const fetchMock = vi.mocked(globalThis.fetch);
      fetchMock.mockImplementation((input) => {
        const url = new URL(String(input));
        if (url.pathname.includes("/cursor")) {
          throw new Error("cursor get down");
        }
        if (url.pathname.endsWith("/meta")) {
          const segments = url.pathname.split("/");
          const spaceId = segments[3] ?? "";
          return Promise.resolve(
            new Response(
              JSON.stringify({
                spaceId,
                organizationId: "org-1",
                visibility: "private",
              }),
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

      await withSilencedStdio(async () => {
        await runSpaceJoin({
          profile: "mira--role-local",
          view: "human",
          baseUrl: "https://gateway.openmeld.invalid",
          space:
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          allowPrompt: false,
        });
      });
    });

    expect(runConnect).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: "mira--role-local",
        role: "Local Reviewer",
        mentionAlias: "local-mira",
      })
    );
  });

  it("emits a human-readable saved bootstrap summary before connect", async () => {
    const { plainStderr } = await withCapturedStdio(async () => {
      await withTempHome(async () => {
        await withSilencedStdio(async () => {
          await runInit({
            profile: "mira--role-summary",
            profileId: "efefcccc-0000-0000-0000-000000000000",
            profileName: "Mira",
            kind: "human",
          });
        });

        await upsertSpaceConfig({
          openMeldProfileId: "mira--role-summary",
          baseUrl: "https://gateway.openmeld.invalid",
          space:
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          profileName: "Mira",
          role: "Saved Moderator",
          mentionAlias: "saved-mira",
        });

        const fetchMock = vi.mocked(globalThis.fetch);
        fetchMock.mockImplementation((input) => {
          const url = new URL(String(input));
          if (url.pathname.includes("/cursor")) {
            throw new Error("cursor get down");
          }
          if (url.pathname.endsWith("/meta")) {
            const segments = url.pathname.split("/");
            const spaceId = segments[3] ?? "";
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  spaceId,
                  organizationId: "org-1",
                  visibility: "private",
                }),
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

        await runSpaceJoin({
          profile: "mira--role-summary",
          view: "human",
          baseUrl: "https://gateway.openmeld.invalid",
          space:
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          allowPrompt: false,
        });
      });
    });

    expect(plainStderr).toContain("Join context loaded:");
    expect(plainStderr).toContain("saved");
    expect(plainStderr).toContain("@saved-mira");
  });

  it("uses the resolved access password when fetching cursor bootstrap facts", async () => {
    const fetchSpaceCursorForBootstrap = vi.fn(
      async (_input: {
        openMeldProfile: OpenMeldProfile;
        baseUrl: string;
        space: string;
        password?: string;
      }) => ({
        role: "Protected Space Architect",
      })
    );
    const presenter = { event: vi.fn() } as unknown as {
      event: (...args: unknown[]) => void;
    };

    const result = await resolveSpaceJoinRoleAliasBootstrap(
      {
        openMeldProfile: buildValidationProfile({
          openMeldProfileId: "agt-protected-role",
          profileName: "Codex",
          profileKind: "agent",
        }),
        openMeldProfileId: "agt-protected-role",
        baseUrl: "https://gateway.example.test",
        space:
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        password: "resolved-secret",
        existingSpaceConfig: null,
        resolvedView: "agent",
        allowPromptRoleContext: false,
        presenter,
      },
      {
        fetchSpaceCursorForBootstrap,
      }
    );

    expect(fetchSpaceCursorForBootstrap).toHaveBeenCalledWith(
      expect.objectContaining({
        password: "resolved-secret",
      })
    );
    expect(result).toMatchObject({
      status: "ready",
      role: "Protected Space Architect",
      roleSource: "cloud",
      usedCursorBootstrap: true,
    });
  });

  it("tracks explicit role and cloud alias sources separately", async () => {
    const presenter = { event: vi.fn() } as unknown as {
      event: (...args: unknown[]) => void;
    };

    const result = await resolveSpaceJoinRoleAliasBootstrap(
      {
        openMeldProfile: buildValidationProfile({
          openMeldProfileId: "agt-mixed-cloud",
          profileName: "Codex",
          profileKind: "agent",
        }),
        openMeldProfileId: "agt-mixed-cloud",
        baseUrl: "https://gateway.example.test",
        space:
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        existingSpaceConfig: null,
        roleInput: "Explicit Architect",
        resolvedView: "agent",
        allowPromptRoleContext: false,
        presenter,
      },
      {
        fetchSpaceCursorForBootstrap: async () => ({
          mentionAlias: "cloud-codex",
        }),
      }
    );

    expect(result).toMatchObject({
      status: "ready",
      role: "Explicit Architect",
      mentionAlias: "cloud-codex",
      roleSource: "explicit",
      mentionAliasSource: "cloud",
      usedCursorBootstrap: true,
    });
  });

  it("tracks explicit role and local alias sources separately", async () => {
    const presenter = { event: vi.fn() } as unknown as {
      event: (...args: unknown[]) => void;
    };

    const result = await resolveSpaceJoinRoleAliasBootstrap(
      {
        openMeldProfile: buildValidationProfile({
          openMeldProfileId: "hum-mixed-local",
          profileName: "Mira",
          profileKind: "human",
        }),
        openMeldProfileId: "hum-mixed-local",
        baseUrl: "https://gateway.example.test",
        space:
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        existingSpaceConfig: {
          space:
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          baseUrl: "https://gateway.example.test",
          profileName: "Mira",
          mentionAlias: "local-mira",
        } as never,
        roleInput: "Explicit Reviewer",
        resolvedView: "human",
        allowPromptRoleContext: false,
        presenter,
      },
      {
        fetchSpaceCursorForBootstrap: async () => ({}),
      }
    );

    expect(result).toMatchObject({
      status: "ready",
      role: "Explicit Reviewer",
      mentionAlias: "local-mira",
      roleSource: "explicit",
      mentionAliasSource: "local",
      usedCursorBootstrap: false,
    });
  });

  it("keeps cloud role and local alias sources distinct", async () => {
    const presenter = { event: vi.fn() } as unknown as {
      event: (...args: unknown[]) => void;
    };

    const result = await resolveSpaceJoinRoleAliasBootstrap(
      {
        openMeldProfile: buildValidationProfile({
          openMeldProfileId: "agt-cloud-role-local-alias",
          profileName: "Codex",
          profileKind: "agent",
        }),
        openMeldProfileId: "agt-cloud-role-local-alias",
        baseUrl: "https://gateway.example.test",
        space:
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        existingSpaceConfig: {
          space:
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          baseUrl: "https://gateway.example.test",
          profileName: "Codex",
          mentionAlias: "local-codex",
        } as never,
        resolvedView: "agent",
        allowPromptRoleContext: false,
        presenter,
      },
      {
        fetchSpaceCursorForBootstrap: async () => ({
          role: "Cloud Architect",
        }),
      }
    );

    expect(result).toMatchObject({
      status: "ready",
      role: "Cloud Architect",
      mentionAlias: "local-codex",
      roleSource: "cloud",
      mentionAliasSource: "local",
      usedCursorBootstrap: true,
    });
  });

  it("emits bootstrap context event with explicit source metadata in agent view", async () => {
    const { stdout } = await withCapturedStdio(async () => {
      await withTempHome(async () => {
        await withSilencedStdio(async () => {
          await runInit({
            profile: "codex--role-summary",
            profileId: "ababcccc-0000-0000-0000-000000000000",
            profileName: "Codex",
            kind: "agent",
          });
        });

        await runSpaceJoin({
          profile: "codex--role-summary",
          view: "agent",
          space:
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          role: "Summary Architect",
          mentionAlias: "summary-codex",
        });
      });
    });

    const lines = stdout
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line));
    const bootstrapEvent = lines.find(
      (line) => line?.code === "space.join.bootstrap_context"
    );
    expect(bootstrapEvent).toMatchObject({
      type: "info",
      code: "space.join.bootstrap_context",
      data: {
        role: "Summary Architect",
        mentionAlias: "summary-codex",
        roleSource: "explicit",
        mentionAliasSource: "explicit",
        usedCursorBootstrap: false,
      },
    });
  });

  it("does not emit bootstrap summary when role and alias facts are absent", async () => {
    const { stdout } = await withCapturedStdio(async () => {
      await withTempHome(async () => {
        await withSilencedStdio(async () => {
          await runInit({
            profile: "codex--role-empty-summary",
            profileId: "acaccccc-0000-0000-0000-000000000000",
            profileName: "Codex",
            kind: "agent",
          });
        });

        await runSpaceJoin({
          profile: "codex--role-empty-summary",
          view: "agent",
          space:
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        });
      });
    });

    const lines = stdout
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line));
    expect(
      lines.find((line) => line?.code === "space.join.bootstrap_context")
    ).toBeUndefined();
  });

  it("does not force role prompts for agent when prompting is enabled", async () => {
    const prompts = await import("@clack/prompts");
    const textMock = vi.mocked(prompts.text);

    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runInit({
          profile: "codex--role-prompt",
          profileId: "cccccccc-0000-0000-0000-000000000000",
          profileName: "Codex",
          kind: "agent",
        });
      });

      await runSpaceJoin({
        profile: "codex--role-prompt",
        view: "agent",
        space:
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        allowPrompt: true,
      });
    });

    expect(runConnect).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: "codex--role-prompt",
        space:
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        role: undefined,
      })
    );
    expect(textMock).not.toHaveBeenCalled();
  });

  it("does not cancel agent join when role fields are empty and optional", async () => {
    const prompts = await import("@clack/prompts");
    const textMock = vi.mocked(prompts.text);
    textMock.mockResolvedValue("" as unknown as string);

    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runInit({
          profile: "codex--role-prompt-empty",
          profileId: "eeeeeeee-0000-0000-0000-000000000000",
          profileName: "Codex",
          kind: "agent",
        });
      });

      await runSpaceJoin({
        profile: "codex--role-prompt-empty",
        view: "agent",
        space:
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        allowPrompt: true,
      });
    });

    expect(runConnect).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: "codex--role-prompt-empty",
        role: undefined,
      })
    );
    expect(textMock).not.toHaveBeenCalled();
    expect(vi.mocked(prompts.cancel)).not.toHaveBeenCalled();
  });

  it("keeps the role optional for human join even when prompting is enabled", async () => {
    const prompts = await import("@clack/prompts");
    const textMock = vi.mocked(prompts.text);
    textMock.mockResolvedValueOnce("");

    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runInit({
          profile: "mira--role-optional",
          profileId: "dddddddd-0000-0000-0000-000000000000",
          profileName: "Mira",
          kind: "human",
        });
      });

      await runSpaceJoin({
        profile: "mira--role-optional",
        view: "human",
        space:
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        allowPrompt: true,
      });
    });

    const callInput = vi.mocked(runConnect).mock.calls[0]?.[0];
    expect(callInput?.role).toBeUndefined();
    expect(callInput?.mentionAlias).toBeUndefined();
  });
});
