import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runInit } from "../src/commands/init";
import { runSpaceCreate } from "../src/space/command";
import {
  withCapturedStdio,
  withSilencedStdio,
  withTempHome,
} from "./helpers/fs";

const confirmMock = vi.hoisted(() => vi.fn());
const passwordPromptMock = vi.hoisted(() => vi.fn());
const promptTextEntryMock = vi.hoisted(() => vi.fn());
const selectMock = vi.hoisted(() => vi.fn());
const textMock = vi.hoisted(() => vi.fn());
const resolveRuntimeContextMock = vi.hoisted(() => vi.fn());
const getAuthSessionStateMock = vi.hoisted(() => vi.fn());

vi.mock("@clack/prompts", () => {
  return {
    cancel: vi.fn(),
    confirm: (...args: unknown[]) => confirmMock(...args),
    isCancel: vi.fn(() => false),
    password: (...args: unknown[]) => passwordPromptMock(...args),
    select: (...args: unknown[]) => selectMock(...args),
    text: (...args: unknown[]) => textMock(...args),
  };
});

vi.mock("../src/runtime/context", () => {
  return {
    parseCliViewMode: vi.fn(),
    resolveRuntimeContext: (...args: unknown[]) =>
      resolveRuntimeContextMock(...args),
  };
});

vi.mock("../src/ui/text-entry", () => {
  return {
    promptTextEntry: (...args: unknown[]) => promptTextEntryMock(...args),
  };
});

vi.mock("../src/config/auth-session", async () => {
  const actual = await vi.importActual("../src/config/auth-session");
  return {
    ...actual,
    getAuthSessionState: (...args: unknown[]) =>
      getAuthSessionStateMock(...args),
  };
});

vi.mock("../src/config/resolve-openmeld-profile", () => {
  const toProfile = (openMeldProfileId: string) => {
    const normalized = openMeldProfileId.toLowerCase();
    const isAgent =
      normalized.startsWith("agt_") || normalized.startsWith("agt-");
    return {
      openMeldProfileId,
      profileName: isAgent ? "Codex" : "Mira",
      profileKind: isAgent ? "agent" : "human",
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
        toProfile(String(openMeldProfileId ?? "mira--space-create-prompt"))
    ),
    resolveOpenMeldProfileOrNull: vi.fn(
      async ({ openMeldProfileId }: { openMeldProfileId?: string }) =>
        toProfile(String(openMeldProfileId ?? "mira--space-create-prompt"))
    ),
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

const CREATED_SPACE_ID =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const createSpaceCreatedResponse = () =>
  new Response(
    JSON.stringify({
      spaceId: CREATED_SPACE_ID,
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
  for (const response of responses) {
    fetchMock.mockResolvedValueOnce(response);
  }
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

  const callSummary = await Promise.all(
    fetchMock.mock.calls.map(async ([request, requestInit]) => {
      if (request instanceof Request) {
        return {
          bodyType: typeof requestInit?.body,
          initMethod: requestInit?.method ?? null,
          requestMethod: request.method,
          requestText: await request
            .clone()
            .text()
            .catch(() => null),
          url: request.url,
        };
      }
      return {
        bodyType: typeof requestInit?.body,
        initMethod: requestInit?.method ?? null,
        requestMethod: null,
        requestText: null,
        url: String(request),
      };
    })
  );
  throw new Error(
    `space create request body not found in fetch calls: ${JSON.stringify(callSummary)}`
  );
}

describe("space create password prompt", () => {
  beforeEach(() => {
    getAuthSessionStateMock.mockReset();
    getAuthSessionStateMock.mockResolvedValue(createValidAuthState());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    resolveRuntimeContextMock.mockReset();
    confirmMock.mockReset();
    passwordPromptMock.mockReset();
    promptTextEntryMock.mockReset();
    selectMock.mockReset();
    textMock.mockReset();
    getAuthSessionStateMock.mockReset();
  });

  it("prompts for password in interactive human view and sends confirmed value", async () => {
    resolveRuntimeContextMock.mockResolvedValue({
      viewMode: "human",
      resolvedView: "human",
      interactive: true,
    });
    promptTextEntryMock.mockResolvedValueOnce({
      status: "submitted",
      value: "",
    });
    selectMock.mockResolvedValueOnce("set");
    passwordPromptMock
      .mockResolvedValueOnce("pw-123456")
      .mockResolvedValueOnce("pw-123456");

    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runInit({
          profile: "mira--space-create-prompt",
          profileId: "aaaaaaaa-0000-0000-0000-000000000000",
          profileName: "Mira",
          kind: "human",
        });
      });

      const fetchMock = mockSpaceCreateFetchSequence(
        createAuthProbeResponse(),
        createSpaceCreatedResponse()
      );

      await withSilencedStdio(async () => {
        await runSpaceCreate({
          profile: "mira--space-create-prompt",
          baseUrl: "https://gateway.openmeld.invalid",
          name: "ops-room",
          visibility: "private",
          join: false,
          view: "human",
        });
      });

      expect(selectMock).toHaveBeenCalledTimes(1);
      const selectInput = selectMock.mock.calls[0]?.[0] as
        | {
            message?: string;
            options?: Array<{ label?: string; value?: string }>;
          }
        | undefined;
      expect(selectInput?.message).toContain("⚠️ Check Before You Continue");
      expect(selectInput?.message).toContain(
        "Without a password, only current members can open this Space. New participants must be added explicitly."
      );
      expect(selectInput?.message).toContain(
        "With a password, only people who have it can open and join the Space."
      );
      expect(selectInput?.message).toContain(
        "Passwords must be at least 6 characters."
      );
      expect(selectInput?.message).toContain(
        "Require a password to open and join?"
      );
      expect(selectInput?.message).not.toContain("data leakage");
      expect(selectInput?.message).not.toContain("Space ID");
      expect(selectInput?.options).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            label: "Yes, require a password to open and join",
            value: "set",
          }),
          expect.objectContaining({
            label: "No, keep access members-only",
            value: "skip",
          }),
        ])
      );
      expect(selectInput?.message).toContain("┐");
      expect(selectInput?.message).toContain("┘");
      expect(promptTextEntryMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Space guide (optional)",
          allowEmpty: true,
        })
      );
      expect(passwordPromptMock).toHaveBeenCalledTimes(2);
      const body = await readCreateRequestBody<{
        password?: string;
      }>(fetchMock);
      expect(body.password).toBe("pw-123456");
    });
  });

  it("skips the optional guide prompt when start already handled it", async () => {
    resolveRuntimeContextMock.mockResolvedValue({
      viewMode: "human",
      resolvedView: "human",
      interactive: true,
    });
    selectMock.mockResolvedValueOnce("skip");

    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runInit({
          profile: "mira--space-create-prompt",
          profileId: "aaaaaaaa-0000-0000-0000-000000000000",
          profileName: "Mira",
          kind: "human",
        });
      });

      const fetchMock = mockSpaceCreateFetchSequence(
        createAuthProbeResponse(),
        createSpaceCreatedResponse()
      );

      await withSilencedStdio(async () => {
        await runSpaceCreate({
          profile: "mira--space-create-prompt",
          baseUrl: "https://gateway.openmeld.invalid",
          name: "ops-room",
          visibility: "private",
          guidePromptHandled: true,
          join: false,
          view: "human",
        });
      });

      expect(promptTextEntryMock).not.toHaveBeenCalled();
      expect(selectMock).toHaveBeenCalledTimes(1);
      const body = await readCreateRequestBody<{
        guide?: string;
      }>(fetchMock);
      expect(body.guide).toBeUndefined();
    });
  });

  it("prompts for organization visibility when no visibility flag is provided", async () => {
    resolveRuntimeContextMock.mockResolvedValue({
      viewMode: "human",
      resolvedView: "human",
      interactive: true,
    });
    selectMock.mockResolvedValueOnce("public").mockResolvedValueOnce("skip");

    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runInit({
          profile: "mira--space-create-prompt",
          profileId: "aaaaaaaa-0000-0000-0000-000000000000",
          profileName: "Mira",
          kind: "human",
        });
      });

      const fetchMock = mockSpaceCreateFetchSequence(
        createAuthProbeResponse(),
        createSpaceCreatedResponse()
      );

      await withSilencedStdio(async () => {
        await runSpaceCreate({
          profile: "mira--space-create-prompt",
          baseUrl: "https://gateway.openmeld.invalid",
          name: "ops-room",
          guidePromptHandled: true,
          join: false,
          view: "human",
        });
      });

      expect(selectMock).toHaveBeenCalledTimes(2);
      expect(selectMock.mock.calls[0]?.[0]).toMatchObject({
        message: "Organization visibility",
      });
      const passwordSelectInput = selectMock.mock.calls[1]?.[0] as
        | {
            message?: string;
            options?: Array<{ label?: string; value?: string }>;
          }
        | undefined;
      expect(passwordSelectInput?.message).toContain(
        "Without a password, anyone with this Space link can read what is shared here and join."
      );
      expect(passwordSelectInput?.options).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            label: "No, anyone with the link can join",
            value: "skip",
          }),
        ])
      );
      const body = await readCreateRequestBody<{
        visibility?: string;
      }>(fetchMock);
      expect(body.visibility).toBe("public");
    });
  });

  it("treats a whitespace-only provided guide as unset and still prompts for one", async () => {
    resolveRuntimeContextMock.mockResolvedValue({
      viewMode: "human",
      resolvedView: "human",
      interactive: true,
    });
    promptTextEntryMock.mockResolvedValueOnce({
      status: "submitted",
      value: "Keep it concise",
    });
    selectMock.mockResolvedValueOnce("skip");

    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runInit({
          profile: "mira--space-create-prompt",
          profileId: "aaaaaaaa-0000-0000-0000-000000000000",
          profileName: "Mira",
          kind: "human",
        });
      });

      const fetchMock = mockSpaceCreateFetchSequence(
        createAuthProbeResponse(),
        new Response(
          JSON.stringify({
            spaceId:
              "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
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
          profile: "mira--space-create-prompt",
          baseUrl: "https://gateway.openmeld.invalid",
          name: "ops-room",
          visibility: "private",
          guide: "   ",
          join: false,
          view: "human",
        });
      });

      expect(promptTextEntryMock).toHaveBeenCalledTimes(1);
      expect(promptTextEntryMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Space guide (optional)",
          allowEmpty: true,
        })
      );

      const body = await readCreateRequestBody<{
        guide?: string;
      }>(fetchMock);
      expect(body.guide).toBe("Keep it concise");
    });
  });

  it("skips password field when user selects no password", async () => {
    resolveRuntimeContextMock.mockResolvedValue({
      viewMode: "human",
      resolvedView: "human",
      interactive: true,
    });
    promptTextEntryMock.mockResolvedValueOnce({
      status: "submitted",
      value: "",
    });
    selectMock.mockResolvedValueOnce("skip");

    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runInit({
          profile: "mira--space-create-prompt",
          profileId: "aaaaaaaa-0000-0000-0000-000000000000",
          profileName: "Mira",
          kind: "human",
        });
      });

      const fetchMock = mockSpaceCreateFetchSequence(
        createAuthProbeResponse(),
        createSpaceCreatedResponse()
      );

      await withSilencedStdio(async () => {
        await runSpaceCreate({
          profile: "mira--space-create-prompt",
          baseUrl: "https://gateway.openmeld.invalid",
          name: "ops-room",
          visibility: "private",
          join: false,
          view: "human",
        });
      });

      expect(selectMock).toHaveBeenCalledTimes(1);
      expect(passwordPromptMock).not.toHaveBeenCalled();
      const body = await readCreateRequestBody<{
        password?: string;
      }>(fetchMock);
      expect(body.password).toBeUndefined();
    });
  });

  it("renders a bordered failure card when create fails after the password decision prompt", async () => {
    resolveRuntimeContextMock.mockResolvedValue({
      viewMode: "human",
      resolvedView: "human",
      interactive: true,
    });
    promptTextEntryMock.mockResolvedValueOnce({
      status: "submitted",
      value: "",
    });
    selectMock.mockResolvedValueOnce("skip");

    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runInit({
          profile: "mira--space-create-prompt",
          profileId: "aaaaaaaa-0000-0000-0000-000000000000",
          profileName: "Mira",
          kind: "human",
        });
      });

      mockSpaceCreateFetchSequence(
        createAuthProbeResponse(),
        new Response(
          JSON.stringify({
            ok: false,
            error: {
              code: "upstream_unreachable",
              message: "auth upstream unavailable",
              requestId: "req-space-create-502",
            },
          }),
          {
            status: 502,
            headers: {
              "content-type": "application/json",
            },
          }
        )
      );

      const { stdout, stderr } = await withCapturedStdio(async () => {
        await expect(
          runSpaceCreate({
            profile: "mira--space-create-prompt",
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

      expect(stdout).toContain("Space couldn't be created");
      expect(stdout).toContain(
        "What happened: OpenMeld auth service is temporarily unavailable."
      );
      expect(stdout).toContain("Next: Try again in a moment.");
      expect(stdout).not.toContain("HTTP Status");
      expect(stdout).not.toContain("upstream_unreachable");
      expect(stdout).not.toContain("req-space-create-502");
      expect(stdout).not.toContain("auth upstream unavailable");
      expect(stderr).not.toContain("error: HTTP 502");
    });
  });

  it("blocks before asking for name or password when auth precheck fails", async () => {
    resolveRuntimeContextMock.mockResolvedValue({
      viewMode: "human",
      resolvedView: "human",
      interactive: true,
    });

    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runInit({
          profile: "mira--space-create-prompt",
          profileId: "aaaaaaaa-0000-0000-0000-000000000000",
          profileName: "Mira",
          kind: "human",
        });
      });

      mockSpaceCreateFetchSequence(
        new Response(
          JSON.stringify({
            ok: false,
            error: {
              code: "upstream_unreachable",
              message: "auth upstream unavailable",
              requestId: "req-auth-check-502",
            },
          }),
          {
            status: 502,
            headers: {
              "content-type": "application/json",
            },
          }
        )
      );

      const { stdout, stderr } = await withCapturedStdio(async () => {
        await expect(
          runSpaceCreate({
            profile: "mira--space-create-prompt",
            baseUrl: "https://gateway.openmeld.invalid",
            join: false,
            view: "human",
          })
        ).rejects.toMatchObject({
          code: "openmeld.space.output_handled",
        });
      });

      expect(textMock).not.toHaveBeenCalled();
      expect(confirmMock).not.toHaveBeenCalled();
      expect(promptTextEntryMock).not.toHaveBeenCalled();
      expect(selectMock).not.toHaveBeenCalled();
      expect(passwordPromptMock).not.toHaveBeenCalled();
      expect(stdout).toContain("Space couldn't be created");
      expect(stdout).toContain(
        "What happened: OpenMeld auth service is temporarily unavailable."
      );
      expect(stdout).toContain("Next: Try again after OpenMeld is reachable.");
      expect(stdout).not.toContain("HTTP Status");
      expect(stdout).not.toContain("upstream_unreachable");
      expect(stdout).not.toContain("req-auth-check-502");
      expect(stdout).not.toContain("auth upstream unavailable");
      expect(stderr).not.toContain("error:");
    });
  });

  it("emits full optional password guidance in non-interactive agent create flow", async () => {
    vi.stubEnv("OPENMELD_USER_FACING_CLI_COMMAND", "openmeld-dev");
    resolveRuntimeContextMock.mockResolvedValue({
      viewMode: "agent",
      resolvedView: "agent",
      interactive: false,
    });

    await withTempHome(async () => {
      const fetchMock = mockSpaceCreateFetchSequence(
        createAuthProbeResponse(),
        createSpaceCreatedResponse()
      );

      const { stdout } = await withCapturedStdio(async () => {
        await runSpaceCreate({
          profile: "agt-space-create-prompt",
          baseUrl: "https://gateway.openmeld.invalid",
          name: "ops-room",
          visibility: "private",
          join: false,
          view: "agent",
        });
      });

      const hintEnvelope = stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map(
          (line) =>
            JSON.parse(line) as {
              code?: string;
              data?: { command?: string };
              text?: string;
            }
        )
        .find((line) => line.code === "space.create.password.optional_hint");
      expect(hintEnvelope?.text).toContain("Password is optional");
      expect(hintEnvelope?.text).toContain(
        "Without a password, only current members can open this Space"
      );
      expect(hintEnvelope?.text).toContain(
        "New participants must be added explicitly"
      );
      expect(hintEnvelope?.text).not.toContain("anyone with the Space link");
      expect(hintEnvelope?.text).not.toContain("Space ID");
      expect(hintEnvelope?.text).toContain("at least 6 characters");
      expect(hintEnvelope?.text).toContain("--password <value>");
      expect(hintEnvelope?.data?.command).toBe(
        "openmeld-dev space create --profile agt-space-create-prompt --name <name> --visibility <public|private> --password <value> --view agent"
      );

      const body = await readCreateRequestBody<{
        password?: string;
      }>(fetchMock);
      expect(body.password).toBeUndefined();
    });
  });

  it("explains public link access when an agent creates a public Space without a password", async () => {
    resolveRuntimeContextMock.mockResolvedValue({
      viewMode: "agent",
      resolvedView: "agent",
      interactive: false,
    });

    await withTempHome(async () => {
      mockSpaceCreateFetchSequence(
        createAuthProbeResponse(),
        createSpaceCreatedResponse()
      );

      const { stdout } = await withCapturedStdio(async () => {
        await runSpaceCreate({
          profile: "agt-space-create-prompt",
          baseUrl: "https://gateway.openmeld.invalid",
          name: "public-room",
          visibility: "public",
          join: false,
          view: "agent",
        });
      });

      const hintEnvelope = stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map(
          (line) =>
            JSON.parse(line) as {
              code?: string;
              text?: string;
            }
        )
        .find((line) => line.code === "space.create.password.optional_hint");

      expect(hintEnvelope?.text).toContain(
        "Without a password, anyone with this Space link can read what is shared here and join"
      );
      expect(hintEnvelope?.text).not.toContain("members-only");
    });
  });

  it("prompts for space name when --name is missing in interactive human view", async () => {
    resolveRuntimeContextMock.mockResolvedValue({
      viewMode: "human",
      resolvedView: "human",
      interactive: true,
    });
    promptTextEntryMock
      .mockResolvedValueOnce({
        status: "submitted",
        value: "apple-space",
      })
      .mockResolvedValueOnce({
        status: "submitted",
        value: "",
      });
    selectMock.mockResolvedValueOnce("skip");

    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runInit({
          profile: "mira--space-create-prompt",
          profileId: "aaaaaaaa-0000-0000-0000-000000000000",
          profileName: "Mira",
          kind: "human",
        });
      });

      const fetchMock = mockSpaceCreateFetchSequence(
        createAuthProbeResponse(),
        createSpaceCreatedResponse()
      );

      await withSilencedStdio(async () => {
        await runSpaceCreate({
          profile: "mira--space-create-prompt",
          baseUrl: "https://gateway.openmeld.invalid",
          visibility: "private",
          join: false,
          view: "human",
        });
      });

      expect(promptTextEntryMock).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          message: "Space name",
        })
      );
      const textInput = promptTextEntryMock.mock.calls[0]?.[0] as
        | { message?: string; placeholder?: string }
        | undefined;
      expect(textInput?.message).toBe("Space name");
      expect(textInput?.placeholder).toContain("design-review");

      const body = await readCreateRequestBody<{
        name?: string;
      }>(fetchMock);
      expect(body.name).toBe("apple-space");
    });
  });

  it("lets standalone create back from guide to name before creating", async () => {
    resolveRuntimeContextMock.mockResolvedValue({
      viewMode: "human",
      resolvedView: "human",
      interactive: true,
    });
    promptTextEntryMock
      .mockResolvedValueOnce({
        status: "submitted",
        value: "first-space",
      })
      .mockResolvedValueOnce({
        status: "back",
      })
      .mockResolvedValueOnce({
        status: "submitted",
        value: "final-space",
      })
      .mockResolvedValueOnce({
        status: "submitted",
        value: "Keep it concise",
      });
    selectMock.mockResolvedValueOnce("skip").mockResolvedValueOnce("skip");

    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runInit({
          profile: "mira--space-create-prompt",
          profileId: "aaaaaaaa-0000-0000-0000-000000000000",
          profileName: "Mira",
          kind: "human",
        });
      });

      const fetchMock = mockSpaceCreateFetchSequence(
        createAuthProbeResponse(),
        createSpaceCreatedResponse()
      );

      await withSilencedStdio(async () => {
        await runSpaceCreate({
          profile: "mira--space-create-prompt",
          baseUrl: "https://gateway.openmeld.invalid",
          visibility: "private",
          view: "human",
        });
      });

      const body = await readCreateRequestBody<{
        name?: string;
        guide?: string;
      }>(fetchMock);
      expect(body.name).toBe("final-space");
      expect(body.guide).toBe("Keep it concise");
    });
  });

  it("lets standalone create back from join to password selection", async () => {
    resolveRuntimeContextMock.mockResolvedValue({
      viewMode: "human",
      resolvedView: "human",
      interactive: true,
    });
    promptTextEntryMock
      .mockResolvedValueOnce({
        status: "submitted",
        value: "ops-room",
      })
      .mockResolvedValueOnce({
        status: "submitted",
        value: "Stay focused",
      });
    selectMock
      .mockResolvedValueOnce("set")
      .mockResolvedValueOnce("back")
      .mockResolvedValueOnce("skip")
      .mockResolvedValueOnce("skip");
    passwordPromptMock
      .mockResolvedValueOnce("pw-123456")
      .mockResolvedValueOnce("pw-123456");

    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runInit({
          profile: "mira--space-create-prompt",
          profileId: "aaaaaaaa-0000-0000-0000-000000000000",
          profileName: "Mira",
          kind: "human",
        });
      });

      const fetchMock = mockSpaceCreateFetchSequence(
        createAuthProbeResponse(),
        createSpaceCreatedResponse()
      );

      await withSilencedStdio(async () => {
        await runSpaceCreate({
          profile: "mira--space-create-prompt",
          baseUrl: "https://gateway.openmeld.invalid",
          visibility: "private",
          view: "human",
        });
      });

      const body = await readCreateRequestBody<{
        password?: string;
        guide?: string;
      }>(fetchMock);
      expect(body.guide).toBe("Stay focused");
      expect(body.password).toBeUndefined();
      expect(passwordPromptMock).toHaveBeenCalledTimes(2);
      expect(selectMock).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          message: "Join this space now?",
        })
      );
      expect(selectMock).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({
          message: expect.stringContaining("⚠️ Check Before You Continue"),
        })
      );
    });
  });
});
