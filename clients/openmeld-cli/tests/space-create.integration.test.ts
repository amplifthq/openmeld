import { afterEach, describe, expect, it, vi } from "vitest";
import { runInit } from "../src/commands/init";
import { runSpaceCreate } from "../src/space/command";
import {
  withCapturedStdio,
  withSilencedStdio,
  withTempHome,
} from "./helpers/fs";

const getAuthSessionStateMock = vi.hoisted(() => vi.fn());
const upsertProfileSpaceHistoryMock = vi.hoisted(() => vi.fn());
const HUMAN_RUNTIME_PROFILE_ID = "11111111-1111-4111-8111-111111111111";

vi.mock("../src/config/auth-session", async () => {
  const actual = await vi.importActual("../src/config/auth-session");
  return {
    ...actual,
    getAuthSessionState: (...args: unknown[]) =>
      getAuthSessionStateMock(...args),
  };
});

vi.mock("../src/config/resolve-openmeld-profile", () => {
  const profile = {
    openMeldProfileId: "mira--space-create",
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

vi.mock("../src/config/profile-space-history-api", () => {
  return {
    listProfileSpaceHistory: vi.fn(),
    upsertProfileSpaceHistory: (
      ...args: Parameters<typeof upsertProfileSpaceHistoryMock>
    ) => upsertProfileSpaceHistoryMock(...args),
    updateProfileSpaceHistoryStatus: vi.fn(),
  };
});

const createValidAuthState = (
  authBaseUrl = "https://auth.openmeld.invalid"
) => ({
  state: "valid" as const,
  session: {
    v: 1 as const,
    accessToken: "token-123",
    tokenType: "Bearer",
    authBaseUrl,
    clientId: "openmeld-cli",
    createdAt: "2026-03-01T00:00:00.000Z",
    user: {
      id: "user-1",
      email: "felix@example.com",
      name: "Felix",
    },
    activeOrganization: {
      id: "org-1",
      slug: "acme",
      name: "Acme",
      role: "owner",
    },
  },
});

const createAuthProbeResponse = () =>
  new Response(
    JSON.stringify({
      session: {
        expiresAt: "2026-12-31T23:59:59.000Z",
        activeOrganizationId: "org-1",
      },
      user: {
        id: "user-1",
      },
    }),
    {
      status: 200,
      headers: {
        "content-type": "application/json",
      },
    }
  );

function mockSpaceCreateFetchSequence(...responses: Response[]) {
  const fetchMock = vi.spyOn(globalThis, "fetch");
  const pendingResponses = [...responses];
  fetchMock.mockImplementation((input, init) => {
    const requestUrl =
      typeof input === "string" || input instanceof URL
        ? String(input)
        : input.url;
    const requestMethod = String(
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    const pathname = new URL(requestUrl).pathname;
    if (pathname.endsWith("/api/auth/get-session")) {
      return Promise.resolve(createAuthProbeResponse());
    }
    if (!(requestMethod === "POST" && pathname === "/v1/spaces")) {
      return Promise.resolve(
        new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );
    }
    const response = pendingResponses.shift();
    if (!response) {
      throw new Error(`Unexpected request: ${requestMethod} ${requestUrl}`);
    }
    return Promise.resolve(response);
  });
  return fetchMock;
}

async function readCreateRequestBody<
  T extends Record<string, unknown>,
>(fetchMock: {
  mock: { calls: [string | URL | Request, RequestInit?][] };
}): Promise<T> {
  for (const [request, requestInit] of [...fetchMock.mock.calls].reverse()) {
    if (
      typeof request === "string" &&
      requestInit?.method?.toUpperCase() === "POST" &&
      new URL(request).pathname === "/v1/spaces" &&
      typeof requestInit?.body === "string"
    ) {
      return JSON.parse(requestInit.body) as T;
    }
    if (
      request instanceof Request &&
      request.method.toUpperCase() === "POST" &&
      new URL(request.url).pathname === "/v1/spaces"
    ) {
      return JSON.parse(await request.clone().text()) as T;
    }
  }
  throw new Error("space create request body not found");
}

describe("space create", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    getAuthSessionStateMock.mockReset();
    upsertProfileSpaceHistoryMock.mockReset();
    vi.unstubAllEnvs();
  });

  it("renders openmeld-dev create guidance when the dev shortcut is active", async () => {
    vi.stubEnv("OPENMELD_USER_FACING_CLI_COMMAND", "openmeld-dev");
    getAuthSessionStateMock.mockResolvedValue(createValidAuthState());
    await withTempHome(async () => {
      let thrown: unknown = null;
      const { stdout } = await withCapturedStdio(async () => {
        try {
          await runSpaceCreate({
            name: "",
            view: "agent",
          });
        } catch (error) {
          thrown = error;
        }
      });

      const message = thrown instanceof Error ? thrown.message : "";
      expect(message).toContain(
        "openmeld-dev space create requires explicit --name and --visibility public|private in agent/non-interactive mode."
      );
      expect(message).toContain(
        "openmeld-dev space [--gateway-url <url>] create [--profile <profile-id>] --name <name> --visibility <public|private>"
      );
      const codes = parseAgentEnvelopeCodes(stdout);
      expect(codes[0]).toBe("space.create.agent_overview");
    });
  });

  it("requires explicit visibility in non-interactive agent create flow", async () => {
    getAuthSessionStateMock.mockResolvedValue(createValidAuthState());
    await withTempHome(async () => {
      let thrown: unknown = null;
      const { stdout } = await withCapturedStdio(async () => {
        try {
          await runSpaceCreate({
            name: "ops-room",
            view: "agent",
          });
        } catch (error) {
          thrown = error;
        }
      });

      const message = thrown instanceof Error ? thrown.message : "";
      expect(message).toContain(
        "openmeld space create requires explicit --visibility public|private in agent/non-interactive mode."
      );
      expect(message).toContain("--visibility <public|private>");
      const codes = parseAgentEnvelopeCodes(stdout);
      expect(codes[0]).toBe("space.create.agent_overview");
    });
  });

  it("renders the shared sign-in card when create auth refresh is needed", async () => {
    getAuthSessionStateMock.mockResolvedValue(createValidAuthState());

    await withTempHome(async () => {
      mockSpaceCreateFetchSequence(
        new Response(
          JSON.stringify({
            code: "auth.unauthenticated",
            message: "session missing",
            requestId: "req-auth-refresh",
          }),
          {
            status: 401,
            headers: {
              "content-type": "application/json",
            },
          }
        )
      );

      const { stdout, stderr } = await withCapturedStdio(async () => {
        await expect(
          runSpaceCreate({
            profile: "mira--space-create",
            baseUrl: "https://gateway.openmeld.invalid",
            name: "ops-room",
            visibility: "private",
            join: false,
            view: "human",
          })
        ).rejects.toMatchObject({
          code: "openmeld.space.output_handled",
        });
      });

      expect(stdout).toContain("Sign In Needed");
      expect(stdout).toContain("Status: Sign in before creating a space.");
      expect(stdout).toContain("Next: Run `openmeld login` to continue.");
      expect(stdout).not.toContain("Space Create Blocked");
      expect(stderr).not.toContain("error:");
    });
  });

  it("rejects create response when meta payload shape is invalid", async () => {
    getAuthSessionStateMock.mockResolvedValue(createValidAuthState());
    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runInit({
          profile: "mira--space-create",
          profileId: "aaaaaaaa-0000-0000-0000-000000000000",
          profileName: "Mira",
          kind: "human",
        });
      });

      mockSpaceCreateFetchSequence(
        new Response(
          JSON.stringify({
            spaceId: "ops-room",
            meta: {
              spaceId: 123,
            },
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          }
        )
      );

      await expect(
        runSpaceCreate({
          profile: "mira--space-create",
          baseUrl: "https://gateway.openmeld.invalid",
          name: "ops-room",
          visibility: "private",
          view: "human",
        })
      ).rejects.toThrow(
        "createSpaceMeta received invalid response payload from createSpace"
      );
    });
  });

  it("sends canonical password field in create body", async () => {
    getAuthSessionStateMock.mockResolvedValue(createValidAuthState());
    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runInit({
          profile: "mira--space-create",
          profileId: "aaaaaaaa-0000-0000-0000-000000000000",
          profileName: "Mira",
          kind: "human",
        });
      });

      const fetchMock = mockSpaceCreateFetchSequence(
        new Response(
          JSON.stringify({
            spaceId:
              "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          }
        )
      );

      await withSilencedStdio(async () => {
        await runSpaceCreate({
          profile: "mira--space-create",
          baseUrl: "https://gateway.openmeld.invalid",
          name: "ops-room",
          visibility: "private",
          password: "  P@ss  ",
          join: false,
          view: "human",
        });
      });

      const body = await readCreateRequestBody<{
        password?: string;
        visibility?: string;
        creator?: unknown;
      }>(fetchMock);
      expect(body.password).toBe("P@ss");
      expect(body.visibility).toBe("private");
      expect(body.creator).toBeUndefined();
    });
  });

  it("omits a whitespace-only guide from the create body", async () => {
    getAuthSessionStateMock.mockResolvedValue(createValidAuthState());
    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runInit({
          profile: "mira--space-create",
          profileId: "aaaaaaaa-0000-0000-0000-000000000000",
          profileName: "Mira",
          kind: "human",
        });
      });

      const fetchMock = mockSpaceCreateFetchSequence(
        new Response(
          JSON.stringify({
            spaceId:
              "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          }
        )
      );

      await withSilencedStdio(async () => {
        await runSpaceCreate({
          profile: "mira--space-create",
          baseUrl: "https://gateway.openmeld.invalid",
          name: "ops-room",
          visibility: "public",
          guide: "   ",
          join: false,
          view: "human",
        });
      });

      const body = await readCreateRequestBody<{
        guide?: string;
        visibility?: string;
      }>(fetchMock);
      expect(body.guide).toBeUndefined();
      expect(body.visibility).toBe("public");
    });
  });

  it("syncs created spaces into profile-space history before any join happens", async () => {
    getAuthSessionStateMock.mockResolvedValue(createValidAuthState());
    upsertProfileSpaceHistoryMock.mockResolvedValue({
      item: {
        profileId: "mira--space-create",
        gatewayHost: "gateway.openmeld.invalid",
        spaceId:
          "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        status: "active",
      },
    });

    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runInit({
          profile: "mira--space-create",
          profileId: "aaaaaaaa-0000-0000-0000-000000000000",
          profileName: "Mira",
          kind: "human",
        });
      });

      mockSpaceCreateFetchSequence(
        new Response(
          JSON.stringify({
            spaceId:
              "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            meta: {
              spaceId:
                "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              organizationId: "org-1",
              visibility: "private",
              name: "ops-room",
              creator: {
                profileId: HUMAN_RUNTIME_PROFILE_ID,
                profileName: "Mira",
                kind: "human",
                profile: "mira--space-create",
              },
              createdAt: "2026-03-12T08:00:00.000Z",
              updatedAt: "2026-03-12T08:00:01.000Z",
              passwordProtected: false,
            },
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          }
        )
      );

      await withSilencedStdio(async () => {
        await runSpaceCreate({
          profile: "mira--space-create",
          baseUrl: "https://gateway.openmeld.invalid",
          name: "ops-room",
          visibility: "private",
          join: false,
          view: "human",
        });
      });
    });

    expect(upsertProfileSpaceHistoryMock).toHaveBeenCalledTimes(1);
    expect(upsertProfileSpaceHistoryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: "https://gateway.openmeld.invalid",
        requestContext: {
          actorContext: {
            requestId: expect.any(String),
            openMeldProfileId: "mira--space-create",
            profileKind: "human",
            profileName: "Mira",
            profileHandle: undefined,
            ownerUserId: "user-1",
          },
        },
        openMeldProfileId: "mira--space-create",
        profileName: "Mira",
        spaceId:
          "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        body: {
          gatewayHost: "gateway.openmeld.invalid",
          spaceName: "ops-room",
          creatorProfileId: HUMAN_RUNTIME_PROFILE_ID,
          creatorKind: "human",
          spaceCreatedAt: "2026-03-12T08:00:00.000Z",
          spaceUpdatedAt: "2026-03-12T08:00:01.000Z",
          lastJoinedAt: "2026-03-12T08:00:00.000Z",
          status: "active",
        },
      })
    );
  });

  it("renders a create summary card with password security warning in human view", async () => {
    getAuthSessionStateMock.mockResolvedValue(createValidAuthState());
    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runInit({
          profile: "mira--space-create",
          profileId: "aaaaaaaa-0000-0000-0000-000000000000",
          profileName: "Mira",
          kind: "human",
        });
      });

      mockSpaceCreateFetchSequence(
        new Response(
          JSON.stringify({
            spaceId:
              "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          }
        )
      );

      const { stdout } = await withCapturedStdio(async () => {
        await runSpaceCreate({
          profile: "mira--space-create",
          baseUrl: "https://gateway.openmeld.invalid",
          name: "ops-room",
          visibility: "private",
          password: "P@ssword-123",
          join: false,
          view: "human",
        });
      });

      expect(stdout).toContain("✨ Space Created");
      expect(stdout).toContain(
        "🆔 Space ID: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      );
      expect(stdout).toContain(
        "🔗 Space URL: https://openmeld.invalid/o/acme/spaces/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      );
      expect(stdout).toContain("🔐 Password: Protection enabled.");
      expect(stdout).toContain("Organization: Acme (acme)");
      expect(stdout).toContain("Visibility: private");
      expect(stdout).toContain("⚠️ Important: Save this password securely.");
    });
  });
});

function parseAgentEnvelopeCodes(stdout: string): string[] {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{"))
    .map((line) => {
      try {
        return JSON.parse(line) as { code?: unknown };
      } catch {
        return {};
      }
    })
    .map((envelope) => String(envelope.code ?? "").trim())
    .filter((code) => code.length > 0);
}
