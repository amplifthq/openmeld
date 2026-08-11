import type { AccountSpaceIndexItem } from "@openmeld/schemas/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const updateProfileSpaceHistoryStatusMock = vi.hoisted(() => vi.fn());
const resolveRuntimeContextMock = vi.hoisted(() => vi.fn());
const listAccountSpaceIndexMock = vi.hoisted(() => vi.fn());
const promptSearchSelectMock = vi.hoisted(() => vi.fn());
const promptSearchMultiselectMock = vi.hoisted(() => vi.fn());
const getAuthSessionStateMock = vi.hoisted(() => vi.fn());
const promptTextEntryMock = vi.hoisted(() => vi.fn());
const selectMock = vi.hoisted(() => vi.fn());
const listOpenMeldProfilesMock = vi.hoisted(() => vi.fn());

vi.mock("@clack/prompts", () => {
  return {
    cancel: vi.fn(),
    confirm: vi.fn(),
    isCancel: vi.fn(() => false),
    password: vi.fn(),
    select: (...args: unknown[]) => selectMock(...args),
    text: vi.fn(),
  };
});

vi.mock("../src/ui/search-select", () => {
  return {
    promptSearchSelect: (...args: Parameters<typeof promptSearchSelectMock>) =>
      promptSearchSelectMock(...args),
    promptSearchMultiselect: (
      ...args: Parameters<typeof promptSearchMultiselectMock>
    ) => promptSearchMultiselectMock(...args),
    promptSearchMultiselectWorkbench: vi.fn(),
  };
});

vi.mock("../src/ui/text-entry", () => {
  return {
    promptTextEntry: (...args: Parameters<typeof promptTextEntryMock>) =>
      promptTextEntryMock(...args),
  };
});

vi.mock("../src/runtime/context", () => {
  return {
    parseCliViewMode: vi.fn(),
    resolveRuntimeContext: (...args: unknown[]) =>
      resolveRuntimeContextMock(...args),
  };
});

vi.mock("../src/config/account-space-index-api", () => ({
  listAccountSpaceIndex: (
    ...args: Parameters<typeof listAccountSpaceIndexMock>
  ) => listAccountSpaceIndexMock(...args),
}));

vi.mock("../src/config/profile-space-history-api", () => {
  class ProfileSpaceHistoryApiError extends Error {
    readonly status: number | null;
    readonly code: string | null;
    readonly endpoint: string;
    readonly canFallbackToLocal: boolean;

    constructor(input: {
      message: string;
      endpoint: string;
      status?: number | null;
      code?: string | null;
      canFallbackToLocal?: boolean;
    }) {
      super(input.message);
      this.name = "ProfileSpaceHistoryApiError";
      this.status = input.status ?? null;
      this.code = input.code ?? null;
      this.endpoint = input.endpoint;
      this.canFallbackToLocal = input.canFallbackToLocal === true;
    }
  }

  return {
    ProfileSpaceHistoryApiError,
    listProfileSpaceHistory: vi.fn(),
    upsertProfileSpaceHistory: vi.fn(),
    updateProfileSpaceHistoryStatus: (
      ...args: Parameters<typeof updateProfileSpaceHistoryStatusMock>
    ) => updateProfileSpaceHistoryStatusMock(...args),
  };
});

vi.mock("../src/config/resolve-openmeld-profile", () => {
  return {
    resolveOpenMeldProfileOrNull: vi.fn(async () => ({
      openMeldProfileId: "hum-delete-owner",
      profileName: "Mira",
      profileKind: "human",
      status: "active",
      ownerUserId: "owner-1",
      source: "cli_create",
      createdByUserId: "owner-1",
      lastUsedAt: null,
      createdAt: "2026-02-20T00:00:00.000Z",
      updatedAt: "2026-02-20T00:00:00.000Z",
    })),
    requireOpenMeldProfile: vi.fn(),
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

vi.mock("../src/config/openmeld-profiles-api", () => {
  return {
    listOpenMeldProfiles: (
      ...args: Parameters<typeof listOpenMeldProfilesMock>
    ) => listOpenMeldProfilesMock(...args),
  };
});

import { confirm, password, text } from "@clack/prompts";
import { resolveOpenMeldProfileOrNull } from "../src/config/resolve-openmeld-profile";
import { runSpaceDelete } from "../src/space/command";
import { readSpaceConfig, upsertSpaceConfig } from "../src/space/local-state";
import { withSilencedStdio, withTempHome } from "./helpers/fs";
import { expectSpaceConfigReadValue } from "./helpers/local-state";
import { createTestOpenMeldProfile } from "./helpers/openmeld-profile-fixture";

const SPACE_ID =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const SPACE_ID_2 =
  "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
const OWNER_AGENT_RUNTIME_PROFILE_ID =
  "agt_22222222-2222-4222-8222-222222222222";
const VALID_AUTH_STATE = {
  state: "valid" as const,
  session: {
    v: 1 as const,
    accessToken: "token-123",
    tokenType: "Bearer",
    authBaseUrl: "http://localhost:8788",
    clientId: "openmeld-cli",
    createdAt: "2026-03-01T00:00:00.000Z",
    user: {
      id: "owner-1",
      email: "felix@example.com",
    },
  },
};

function createValidAuthState(authBaseUrl: string) {
  return {
    ...VALID_AUTH_STATE,
    session: {
      ...VALID_AUTH_STATE.session,
      authBaseUrl,
    },
  };
}

function createAccountSpaceIndexItem(
  input: Partial<AccountSpaceIndexItem> = {}
): AccountSpaceIndexItem {
  const openProfileId = input.openProfileId ?? "hum-delete-owner";
  const openProfileName = input.openProfileName ?? "Mira";
  const lastJoinedAt = input.lastJoinedAt ?? "2026-02-24T00:00:00.000Z";
  return {
    creatorKind: input.creatorKind ?? "human",
    creatorOwnerUserId: input.creatorOwnerUserId ?? "owner-1",
    creatorProfileId: input.creatorProfileId ?? "hum-delete-owner",
    creatorProfileName: input.creatorProfileName ?? "Mira",
    gatewayHost: input.gatewayHost ?? "localhost:8080",
    joinedProfiles: input.joinedProfiles ?? [
      {
        lastJoinedAt,
        pinnedAt: input.pinnedAt ?? null,
        profileId: openProfileId,
        profileName: openProfileName,
      },
    ],
    lastJoinedAt,
    lastSeenTs: input.lastSeenTs ?? 1_708_732_800_000,
    openProfileId,
    openProfileName,
    organizationId: input.organizationId ?? "org-1",
    pinnedAt: input.pinnedAt ?? null,
    pinnedProfileIds: input.pinnedProfileIds ?? [],
    spaceCreatedAt: input.spaceCreatedAt ?? "2026-02-24T00:00:00.000Z",
    spaceId: input.spaceId ?? SPACE_ID,
    spaceName: input.spaceName ?? "Delete Target",
    spaceUpdatedAt: input.spaceUpdatedAt ?? "2026-02-24T00:00:00.000Z",
    status: input.status ?? "active",
    updatedAt: input.updatedAt ?? "2026-02-24T00:00:00.000Z",
    visibility: input.visibility ?? "private",
  };
}

function accountSpaceIndexOf(spaceItems: AccountSpaceIndexItem[]) {
  return { pinnedItems: [], spaceItems };
}

describe("space delete", () => {
  beforeEach(() => {
    getAuthSessionStateMock.mockReset();
    getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
    listAccountSpaceIndexMock.mockReset();
    listAccountSpaceIndexMock.mockResolvedValue(accountSpaceIndexOf([]));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    updateProfileSpaceHistoryStatusMock.mockReset();
    resolveRuntimeContextMock.mockReset();
    listAccountSpaceIndexMock.mockReset();
    promptSearchSelectMock.mockReset();
    promptSearchMultiselectMock.mockReset();
    getAuthSessionStateMock.mockReset();
    promptTextEntryMock.mockReset();
    selectMock.mockReset();
    listOpenMeldProfilesMock.mockReset();
  });

  it("rejects delete in agent view and guides human approval flow", async () => {
    resolveRuntimeContextMock.mockResolvedValue({
      viewMode: "agent",
      resolvedView: "agent",
      interactive: true,
    });

    await withTempHome(async () => {
      await expect(
        runSpaceDelete({
          profile: "agt-delete-owner",
          baseUrl: "http://localhost:8080",
          space: SPACE_ID,
          view: "agent",
        })
      ).rejects.toMatchObject({
        name: "DualViewGuideError",
        code: "space.delete.human_approval_required",
      });
    });
  });

  it("requires interactive human tty for delete confirmation", async () => {
    resolveRuntimeContextMock.mockResolvedValue({
      viewMode: "human",
      resolvedView: "human",
      interactive: false,
    });

    await withTempHome(async () => {
      await expect(
        runSpaceDelete({
          profile: "hum-delete-owner",
          baseUrl: "http://localhost:8080",
          space: SPACE_ID,
          view: "human",
        })
      ).rejects.toThrow(
        "space delete requires an interactive human TTY session for confirmation"
      );
    });
  });

  it("requires human openmeld profile for delete even in human view", async () => {
    resolveRuntimeContextMock.mockResolvedValue({
      viewMode: "human",
      resolvedView: "human",
      interactive: true,
    });
    vi.mocked(resolveOpenMeldProfileOrNull).mockResolvedValueOnce(
      createTestOpenMeldProfile({
        openMeldProfileId: "agt-delete-owner",
        profileName: "Delete Agent",
        profileKind: "agent",
        ownerUserId: "owner-1",
        createdByUserId: "owner-1",
        createdAt: "2026-02-20T00:00:00.000Z",
        updatedAt: "2026-02-20T00:00:00.000Z",
      })
    );

    await withTempHome(async () => {
      await expect(
        runSpaceDelete({
          profile: "agt-delete-owner",
          baseUrl: "http://localhost:8080",
          space: SPACE_ID,
          view: "human",
        })
      ).rejects.toMatchObject({
        name: "DualViewGuideError",
        code: "space.delete.human_approval_required",
      });
    });
  });

  it("deletes space after human confirmation and removes local cache", async () => {
    resolveRuntimeContextMock.mockResolvedValue({
      viewMode: "human",
      resolvedView: "human",
      interactive: true,
    });
    vi.mocked(confirm).mockResolvedValue(true);
    vi.mocked(text).mockResolvedValue("DELETE");
    updateProfileSpaceHistoryStatusMock.mockResolvedValue({
      profileId: "hum-delete-owner",
      gatewayHost: "localhost:8080",
      spaceId: SPACE_ID,
      status: "removed",
      updatedAt: "2026-02-24T00:00:00.000Z",
    });

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input, init) => {
        const url = new URL(String(input));
        const method = String(init?.method ?? "GET").toUpperCase();
        if (method === "DELETE" && url.pathname === `/v1/spaces/${SPACE_ID}`) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                spaceId: SPACE_ID,
                deleted: true,
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        throw new Error(`unexpected fetch call: ${url.toString()}`);
      });

    await withTempHome(async () => {
      await upsertSpaceConfig({
        openMeldProfileId: "hum-delete-owner",
        baseUrl: "http://localhost:8080",
        space: SPACE_ID,
        profileName: "Mira",
        name: "Delete Target",
      });
      expectSpaceConfigReadValue(
        await readSpaceConfig({
          openMeldProfileId: "hum-delete-owner",
          space: SPACE_ID,
        })
      );

      await withSilencedStdio(async () => {
        await runSpaceDelete({
          profile: "hum-delete-owner",
          baseUrl: "http://localhost:8080",
          space: SPACE_ID,
          view: "human",
        });
      });

      expect(
        await readSpaceConfig({
          openMeldProfileId: "hum-delete-owner",
          space: SPACE_ID,
        })
      ).toMatchObject({
        kind: "missing",
        fileKind: "space_config",
      });
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining(`/v1/spaces/${SPACE_ID}`),
      expect.objectContaining({ method: "DELETE" })
    );
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(text).toHaveBeenCalledTimes(1);
    expect(text).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Type DELETE to confirm permanent deletion",
        placeholder: "DELETE",
      })
    );
    expect(updateProfileSpaceHistoryStatusMock).toHaveBeenCalledWith(
      expect.objectContaining({
        spaceId: SPACE_ID,
        body: expect.objectContaining({
          status: "removed",
        }),
      })
    );
  });

  it("returns back to the caller when the delete target picker backs out", async () => {
    resolveRuntimeContextMock.mockResolvedValue({
      viewMode: "human",
      resolvedView: "human",
      interactive: true,
    });
    listAccountSpaceIndexMock.mockResolvedValue(
      accountSpaceIndexOf([
        createAccountSpaceIndexItem({
          spaceId: SPACE_ID,
          spaceName: "Delete Target",
          creatorProfileId: "hum-delete-owner",
          creatorProfileName: "Mira",
          creatorKind: "human",
        }),
      ])
    );
    promptSearchMultiselectMock.mockResolvedValue({
      status: "back",
    });

    await withTempHome(async () => {
      const result = await withSilencedStdio(async () =>
        runSpaceDelete({
          profile: "hum-delete-owner",
          baseUrl: "http://localhost:8080",
          view: "human",
          allowBackToCaller: true,
        })
      );

      expect(result).toBe("back");
    });

    expect(promptSearchMultiselectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        allowBack: true,
        backLabel: "Back",
      })
    );
  });

  it("exits the standalone delete command when the target picker backs out", async () => {
    resolveRuntimeContextMock.mockResolvedValue({
      viewMode: "human",
      resolvedView: "human",
      interactive: true,
    });
    listAccountSpaceIndexMock.mockResolvedValue(
      accountSpaceIndexOf([
        createAccountSpaceIndexItem({
          spaceId: SPACE_ID,
          spaceName: "Delete Target",
          creatorProfileId: "hum-delete-owner",
          creatorProfileName: "Mira",
          creatorKind: "human",
        }),
      ])
    );
    promptSearchMultiselectMock.mockResolvedValue({
      status: "back",
    });

    await withTempHome(async () => {
      const result = await withSilencedStdio(async () =>
        runSpaceDelete({
          profile: "hum-delete-owner",
          baseUrl: "http://localhost:8080",
          view: "human",
        })
      );

      expect(result).toBe("cancelled");
    });

    expect(promptSearchMultiselectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        allowBack: true,
        backLabel: "Back",
      })
    );
  });

  it("returns from delete confirmation to target selection before exiting", async () => {
    resolveRuntimeContextMock.mockResolvedValue({
      viewMode: "human",
      resolvedView: "human",
      interactive: true,
    });
    listAccountSpaceIndexMock.mockResolvedValue(
      accountSpaceIndexOf([
        createAccountSpaceIndexItem({
          spaceId: SPACE_ID,
          spaceName: "Delete Target",
          creatorProfileId: "hum-delete-owner",
          creatorProfileName: "Mira",
          creatorKind: "human",
        }),
      ])
    );
    promptSearchMultiselectMock
      .mockResolvedValueOnce({
        status: "submitted",
        value: ["known:0"],
      })
      .mockResolvedValueOnce({
        status: "back",
      });
    selectMock.mockResolvedValueOnce("back");

    await withTempHome(async () => {
      const result = await withSilencedStdio(async () =>
        runSpaceDelete({
          profile: "hum-delete-owner",
          baseUrl: "http://localhost:8080",
          view: "human",
        })
      );

      expect(result).toBe("cancelled");
    });

    expect(promptSearchMultiselectMock).toHaveBeenCalledTimes(2);
    expect(selectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.arrayContaining([
          expect.objectContaining({ value: "confirm" }),
          expect.objectContaining({ value: "back" }),
          expect.objectContaining({ value: "cancel" }),
        ]),
      })
    );
    expect(promptTextEntryMock).not.toHaveBeenCalled();
  });

  it("uses cached target gateway for delete when baseUrl input is blank", async () => {
    resolveRuntimeContextMock.mockResolvedValue({
      viewMode: "human",
      resolvedView: "human",
      interactive: true,
    });
    vi.mocked(confirm).mockResolvedValue(true);
    vi.mocked(text).mockResolvedValue("DELETE");
    getAuthSessionStateMock.mockResolvedValue(
      createValidAuthState("https://auth.internal.example")
    );
    updateProfileSpaceHistoryStatusMock.mockResolvedValue({
      profileId: "hum-delete-owner",
      gatewayHost: "gateway.internal.example",
      spaceId: SPACE_ID,
      status: "removed",
      updatedAt: "2026-02-24T00:00:00.000Z",
    });

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input, init) => {
        const url = new URL(String(input));
        const method = String(init?.method ?? "GET").toUpperCase();
        if (
          method === "DELETE" &&
          url.origin === "https://gateway.internal.example" &&
          url.pathname === `/v1/spaces/${SPACE_ID}`
        ) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                spaceId: SPACE_ID,
                deleted: true,
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        throw new Error(`unexpected fetch call: ${url.toString()}`);
      });

    await withTempHome(async () => {
      await upsertSpaceConfig({
        openMeldProfileId: "hum-delete-owner",
        baseUrl: "https://gateway.internal.example",
        space: SPACE_ID,
        profileName: "Mira",
        name: "Delete Target",
      });

      await withSilencedStdio(async () => {
        await runSpaceDelete({
          profile: "hum-delete-owner",
          space: SPACE_ID,
          view: "human",
        });
      });
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("https://gateway.internal.example/v1/spaces/"),
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("prompts for password when deleting protected space and retries", async () => {
    resolveRuntimeContextMock.mockResolvedValue({
      viewMode: "human",
      resolvedView: "human",
      interactive: true,
    });
    vi.mocked(confirm).mockResolvedValue(true);
    vi.mocked(text).mockResolvedValue("DELETE");
    vi.mocked(password).mockResolvedValue("delete-space-pass");
    updateProfileSpaceHistoryStatusMock.mockResolvedValue({
      profileId: "hum-delete-owner",
      gatewayHost: "localhost:8080",
      spaceId: SPACE_ID,
      status: "removed",
      updatedAt: "2026-02-24T00:00:00.000Z",
    });

    const readHeader = (headers: unknown, key: string): string | null => {
      if (!headers) {
        return null;
      }
      if (headers instanceof Headers) {
        return headers.get(key);
      }
      if (Array.isArray(headers)) {
        const matched = headers.find((entry) => {
          if (!Array.isArray(entry) || entry.length < 2) {
            return false;
          }
          return String(entry[0]).toLowerCase() === key.toLowerCase();
        });
        return matched && Array.isArray(matched) ? String(matched[1]) : null;
      }
      const record = headers as Record<string, unknown>;
      const entry = Object.entries(record).find(
        ([name]) => name.toLowerCase() === key.toLowerCase()
      );
      return entry ? String(entry[1]) : null;
    };

    let deleteAttempt = 0;
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input, init) => {
        const url = new URL(String(input));
        const method = String(init?.method ?? "GET").toUpperCase();
        if (method === "DELETE" && url.pathname === `/v1/spaces/${SPACE_ID}`) {
          deleteAttempt += 1;
          const headerPassword = readHeader(
            init?.headers,
            "x-openmeld-space-password"
          );
          if (deleteAttempt === 1) {
            expect(headerPassword).toBeNull();
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  code: "space.password_required",
                  message: "space password required",
                }),
                {
                  status: 401,
                  headers: { "content-type": "application/json" },
                }
              )
            );
          }
          expect(headerPassword).toBe("delete-space-pass");
          return Promise.resolve(
            new Response(
              JSON.stringify({
                spaceId: SPACE_ID,
                deleted: true,
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        throw new Error(`unexpected fetch call: ${url.toString()}`);
      });

    await withTempHome(async () => {
      await upsertSpaceConfig({
        openMeldProfileId: "hum-delete-owner",
        baseUrl: "http://localhost:8080",
        space: SPACE_ID,
        profileName: "Mira",
        name: "Delete Target",
      });

      await withSilencedStdio(async () => {
        await runSpaceDelete({
          profile: "hum-delete-owner",
          baseUrl: "http://localhost:8080",
          space: SPACE_ID,
          view: "human",
        });
      });

      expect(
        await readSpaceConfig({
          openMeldProfileId: "hum-delete-owner",
          space: SPACE_ID,
        })
      ).toMatchObject({
        kind: "missing",
        fileKind: "space_config",
      });
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(password).toHaveBeenCalledTimes(1);
    expect(password).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Space password",
      })
    );
  });

  it("keeps local cache when delete is rejected by server", async () => {
    resolveRuntimeContextMock.mockResolvedValue({
      viewMode: "human",
      resolvedView: "human",
      interactive: true,
    });
    vi.mocked(confirm).mockResolvedValue(true);
    vi.mocked(text).mockResolvedValue("DELETE");

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input, init) => {
        const url = new URL(String(input));
        const method = String(init?.method ?? "GET").toUpperCase();
        if (method === "DELETE" && url.pathname === `/v1/spaces/${SPACE_ID}`) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                ok: false,
                code: "upstream_error",
                message:
                  "agent-created spaces require owner human confirmation",
              }),
              {
                status: 403,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        throw new Error(`unexpected fetch call: ${url.toString()}`);
      });

    await withTempHome(async () => {
      await upsertSpaceConfig({
        openMeldProfileId: "hum-delete-owner",
        baseUrl: "http://localhost:8080",
        space: SPACE_ID,
        profileName: "Mira",
        name: "Delete Target",
      });

      await expect(
        runSpaceDelete({
          profile: "hum-delete-owner",
          baseUrl: "http://localhost:8080",
          space: SPACE_ID,
          view: "human",
        })
      ).rejects.toThrow(
        "Delete blocked: this human profile can only delete its own spaces or your owned agent-created spaces (Delete Target)."
      );

      expect(
        await readSpaceConfig({
          openMeldProfileId: "hum-delete-owner",
          space: SPACE_ID,
        })
      ).toMatchObject({
        kind: "ok",
        fileKind: "space_config",
      });
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(updateProfileSpaceHistoryStatusMock).not.toHaveBeenCalled();
  });

  it("continues batch delete and reports partial result when one target fails", async () => {
    resolveRuntimeContextMock.mockResolvedValue({
      viewMode: "human",
      resolvedView: "human",
      interactive: true,
    });
    listAccountSpaceIndexMock.mockResolvedValue(
      accountSpaceIndexOf([
        createAccountSpaceIndexItem({
          spaceId: SPACE_ID,
          spaceName: "Delete Succeeds",
          creatorProfileId: "hum-delete-owner",
          creatorProfileName: "Mira",
          creatorKind: "human",
          lastJoinedAt: "2026-02-24T00:00:00.000Z",
          lastSeenTs: 1_708_732_800_000,
        }),
        createAccountSpaceIndexItem({
          spaceId: SPACE_ID_2,
          spaceName: "Delete Fails",
          creatorProfileId: "hum-delete-owner",
          creatorProfileName: "Mira",
          creatorKind: "human",
          lastJoinedAt: "2026-02-25T00:00:00.000Z",
          lastSeenTs: 1_708_819_200_000,
        }),
      ])
    );
    promptSearchMultiselectMock.mockResolvedValue({
      status: "submitted",
      value: ["known:0", "known:1"],
    });
    selectMock.mockResolvedValueOnce("confirm");
    promptTextEntryMock.mockResolvedValueOnce({
      status: "submitted",
      value: "DELETE",
    });
    updateProfileSpaceHistoryStatusMock.mockResolvedValue({
      profileId: "hum-delete-owner",
      gatewayHost: "localhost:8080",
      spaceId: SPACE_ID,
      status: "removed",
      updatedAt: "2026-02-24T00:00:00.000Z",
    });

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input, init) => {
        const url = new URL(String(input));
        const method = String(init?.method ?? "GET").toUpperCase();
        if (method === "DELETE" && url.pathname === `/v1/spaces/${SPACE_ID}`) {
          return Promise.resolve(
            new Response(JSON.stringify({ spaceId: SPACE_ID, deleted: true }), {
              status: 200,
              headers: { "content-type": "application/json" },
            })
          );
        }
        if (
          method === "DELETE" &&
          url.pathname === `/v1/spaces/${SPACE_ID_2}`
        ) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                ok: false,
                error: {
                  code: "upstream_unreachable",
                  message: "auth upstream unavailable",
                },
              }),
              {
                status: 502,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        throw new Error(`unexpected fetch call: ${url.toString()}`);
      });

    await withTempHome(async () => {
      await upsertSpaceConfig({
        openMeldProfileId: "hum-delete-owner",
        baseUrl: "http://localhost:8080",
        space: SPACE_ID,
        profileName: "Mira",
        name: "Delete Succeeds",
      });
      await upsertSpaceConfig({
        openMeldProfileId: "hum-delete-owner",
        baseUrl: "http://localhost:8080",
        space: SPACE_ID_2,
        profileName: "Mira",
        name: "Delete Fails",
      });

      await withSilencedStdio(async () => {
        await expect(
          runSpaceDelete({
            profile: "hum-delete-owner",
            baseUrl: "http://localhost:8080",
            view: "human",
          })
        ).resolves.toBe("completed");
      });

      expect(
        await readSpaceConfig({
          openMeldProfileId: "hum-delete-owner",
          space: SPACE_ID,
        })
      ).toMatchObject({
        kind: "missing",
        fileKind: "space_config",
      });
      expect(
        await readSpaceConfig({
          openMeldProfileId: "hum-delete-owner",
          space: SPACE_ID_2,
        })
      ).toMatchObject({
        kind: "ok",
        fileKind: "space_config",
      });
    });

    const deleteCalls = fetchSpy.mock.calls.filter(([, init]) => {
      return String(init?.method ?? "GET").toUpperCase() === "DELETE";
    });
    expect(deleteCalls).toHaveLength(2);
    expect(updateProfileSpaceHistoryStatusMock).toHaveBeenCalledTimes(1);
  });

  it("cancels delete when confirmation keyword mismatches", async () => {
    resolveRuntimeContextMock.mockResolvedValue({
      viewMode: "human",
      resolvedView: "human",
      interactive: true,
    });
    vi.mocked(confirm).mockResolvedValue(true);
    vi.mocked(text).mockResolvedValue("wrong-name");

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input) => {
        throw new Error(`unexpected fetch call: ${String(input)}`);
      });

    await withTempHome(async () => {
      await upsertSpaceConfig({
        openMeldProfileId: "hum-delete-owner",
        baseUrl: "http://localhost:8080",
        space: SPACE_ID,
        profileName: "Mira",
        name: "Delete Target",
      });

      await withSilencedStdio(async () => {
        await runSpaceDelete({
          profile: "hum-delete-owner",
          baseUrl: "http://localhost:8080",
          space: SPACE_ID,
          view: "human",
        });
      });

      expect(
        await readSpaceConfig({
          openMeldProfileId: "hum-delete-owner",
          space: SPACE_ID,
        })
      ).toMatchObject({
        kind: "ok",
        fileKind: "space_config",
      });
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(updateProfileSpaceHistoryStatusMock).not.toHaveBeenCalled();
  });

  it("filters delete picker to spaces created by current user", async () => {
    resolveRuntimeContextMock.mockResolvedValue({
      viewMode: "human",
      resolvedView: "human",
      interactive: true,
    });
    // The Space-Index projection already carries creator identity, so the
    // delete picker filters to owned spaces without a per-space /meta probe.
    // A foreign-created space (creatorProfileId not the current profile and a
    // different owner) is dropped by ownership filtering.
    listAccountSpaceIndexMock.mockResolvedValue(
      accountSpaceIndexOf([
        createAccountSpaceIndexItem({
          spaceId: SPACE_ID,
          spaceName: "Owned Human Space",
          creatorProfileId: "hum-delete-owner",
          creatorProfileName: "Mira",
          creatorKind: "human",
          lastJoinedAt: "2026-02-24T00:00:00.000Z",
          lastSeenTs: 1_708_732_800_000,
        }),
        createAccountSpaceIndexItem({
          spaceId: SPACE_ID_2,
          spaceName: "Owned Agent Space",
          creatorProfileId: OWNER_AGENT_RUNTIME_PROFILE_ID,
          creatorProfileName: "Owner Agent",
          creatorKind: "agent",
          creatorOwnerUserId: "owner-1",
          openProfileName: "Owner Agent",
          lastJoinedAt: "2026-02-25T00:00:00.000Z",
          lastSeenTs: 1_708_819_200_000,
        }),
        createAccountSpaceIndexItem({
          spaceId:
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          spaceName: "Foreign Space",
          creatorProfileId: "hum-someone-else",
          creatorProfileName: "Someone Else",
          creatorKind: "human",
          creatorOwnerUserId: "owner-2",
          lastJoinedAt: "2026-02-26T00:00:00.000Z",
          lastSeenTs: 1_708_905_600_000,
        }),
      ])
    );
    promptSearchMultiselectMock.mockResolvedValue({
      status: "submitted",
      value: [],
    });

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input) => {
        throw new Error(`unexpected fetch call: ${String(input)}`);
      });

    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runSpaceDelete({
          profile: "hum-delete-owner",
          baseUrl: "http://localhost:8080",
          view: "human",
        });
      });
    });

    const multiselectInput = promptSearchMultiselectMock.mock.calls[0]?.[0] as
      | {
          items?: Array<{ label?: string; detail?: string; value?: string }>;
        }
      | undefined;
    const labels = (multiselectInput?.items ?? [])
      .map((option) => [option.label ?? "", option.detail ?? ""].join("\n"))
      .join("\n");
    expect(labels).toContain("Owned Human Space");
    expect(labels).toContain("Owned Agent Space");
    expect(labels).not.toContain("Foreign Space");
    expect(labels).toContain("Owner Agent");
    expect(labels).toContain("ID");
    const deleteCalls = fetchSpy.mock.calls.filter(([, init]) => {
      return String(init?.method ?? "GET").toUpperCase() === "DELETE";
    });
    expect(deleteCalls).toHaveLength(0);
  });

  it("includes owned agent spaces from other profiles when deleting from the main human profile", async () => {
    resolveRuntimeContextMock.mockResolvedValue({
      viewMode: "human",
      resolvedView: "human",
      interactive: true,
    });
    vi.mocked(resolveOpenMeldProfileOrNull).mockResolvedValueOnce(
      createTestOpenMeldProfile({
        openMeldProfileId: "hum-delete-main",
        profileName: "Mira",
        profileKind: "human",
        isDefault: true,
        ownerUserId: "owner-1",
        createdByUserId: "owner-1",
        createdAt: "2026-02-20T00:00:00.000Z",
        updatedAt: "2026-02-20T00:00:00.000Z",
      })
    );
    listOpenMeldProfilesMock.mockResolvedValue([
      {
        openMeldProfileId: "hum-delete-main",
        profileName: "Mira",
        profileKind: "human",
        isDefault: true,
        status: "active",
        ownerUserId: "owner-1",
        source: "cloud",
        createdByUserId: "owner-1",
        lastUsedAt: null,
        createdAt: "2026-02-20T00:00:00.000Z",
        updatedAt: "2026-02-20T00:00:00.000Z",
      },
      {
        openMeldProfileId: "agt-owner-delete",
        profileName: "Owner Agent",
        profileKind: "agent",
        status: "active",
        ownerUserId: "owner-1",
        source: "cloud",
        createdByUserId: "owner-1",
        lastUsedAt: null,
        createdAt: "2026-02-20T00:00:00.000Z",
        updatedAt: "2026-02-20T00:00:00.000Z",
      },
    ]);
    // Account-scope projection already merges the owner's other agent profiles,
    // so the main human profile sees the owned agent space directly from the
    // index instead of a per-profile history fan-out.
    listAccountSpaceIndexMock.mockResolvedValue(
      accountSpaceIndexOf([
        createAccountSpaceIndexItem({
          spaceId: SPACE_ID_2,
          spaceName: "Owned Agent Space",
          creatorProfileId: "agt-owner-delete",
          creatorProfileName: "Owner Agent",
          creatorKind: "agent",
          creatorOwnerUserId: "owner-1",
          openProfileId: "agt-owner-delete",
          openProfileName: "Owner Agent",
          lastJoinedAt: "2026-02-25T00:00:00.000Z",
          lastSeenTs: 1_708_819_200_000,
        }),
      ])
    );
    promptSearchMultiselectMock.mockResolvedValue({
      status: "submitted",
      value: [],
    });

    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runSpaceDelete({
          profile: "hum-delete-main",
          baseUrl: "http://localhost:8080",
          view: "human",
        });
      });
    });

    expect(listAccountSpaceIndexMock).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "account",
        selectedProfileId: "hum-delete-main",
      })
    );
    const multiselectInput = promptSearchMultiselectMock.mock.calls[0]?.[0] as
      | {
          items?: Array<{ label?: string; detail?: string; value?: string }>;
        }
      | undefined;
    const labels = (multiselectInput?.items ?? [])
      .map((option) => [option.label ?? "", option.detail ?? ""].join("\n"))
      .join("\n");
    expect(labels).toContain("Owned Agent Space");
    expect(labels).toContain("Owner Agent");
    expect(labels).toContain("Enter a space ID manually");
  });

  it("hydrates explicit delete confirmation with the shared known-space details", async () => {
    resolveRuntimeContextMock.mockResolvedValue({
      viewMode: "human",
      resolvedView: "human",
      interactive: true,
    });
    vi.mocked(resolveOpenMeldProfileOrNull).mockResolvedValueOnce(
      createTestOpenMeldProfile({
        openMeldProfileId: "hum-delete-main",
        profileName: "Mira",
        profileKind: "human",
        isDefault: true,
        ownerUserId: "owner-1",
        createdByUserId: "owner-1",
        createdAt: "2026-02-20T00:00:00.000Z",
        updatedAt: "2026-02-20T00:00:00.000Z",
      })
    );
    listOpenMeldProfilesMock.mockResolvedValue([
      {
        openMeldProfileId: "hum-delete-main",
        profileName: "Mira",
        profileKind: "human",
        isDefault: true,
        status: "active",
        ownerUserId: "owner-1",
        source: "cloud",
        createdByUserId: "owner-1",
        lastUsedAt: null,
        createdAt: "2026-02-20T00:00:00.000Z",
        updatedAt: "2026-02-20T00:00:00.000Z",
      },
      {
        openMeldProfileId: "agt-owner-delete",
        profileName: "Owner Agent",
        profileKind: "agent",
        status: "active",
        ownerUserId: "owner-1",
        source: "cloud",
        createdByUserId: "owner-1",
        lastUsedAt: null,
        createdAt: "2026-02-20T00:00:00.000Z",
        updatedAt: "2026-02-20T00:00:00.000Z",
      },
    ]);
    // Explicit delete hydrates the confirmation card from the same Space-Index
    // read model used by the picker (creator identity included), not a
    // per-profile history fan-out.
    listAccountSpaceIndexMock.mockResolvedValue(
      accountSpaceIndexOf([
        createAccountSpaceIndexItem({
          spaceId: SPACE_ID_2,
          spaceName: "Owned Agent Space",
          creatorProfileId: "agt-owner-delete",
          creatorProfileName: "Owner Agent",
          creatorKind: "agent",
          creatorOwnerUserId: "owner-1",
          openProfileId: "agt-owner-delete",
          openProfileName: "Owner Agent",
          lastJoinedAt: "2026-02-25T00:00:00.000Z",
          lastSeenTs: 1_708_819_200_000,
        }),
      ])
    );
    vi.mocked(confirm).mockResolvedValue(false);

    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await runSpaceDelete({
          profile: "hum-delete-main",
          baseUrl: "http://localhost:8080",
          space: SPACE_ID_2,
          view: "human",
        });
      });
    });

    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("1. Owned Agent Space"),
      })
    );
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("Space Creator: Owner Agent"),
      })
    );
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining(
          "Space Creator Profile ID: agt-owner-delete"
        ),
      })
    );
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.not.stringContaining("Creator ID:"),
      })
    );
  });

  it("sends approved creator profile id for own agent-created delete", async () => {
    resolveRuntimeContextMock.mockResolvedValue({
      viewMode: "human",
      resolvedView: "human",
      interactive: true,
    });
    listAccountSpaceIndexMock.mockResolvedValue(
      accountSpaceIndexOf([
        createAccountSpaceIndexItem({
          spaceId: SPACE_ID,
          spaceName: "Owned Agent Space",
          creatorProfileId: OWNER_AGENT_RUNTIME_PROFILE_ID,
          creatorProfileName: "Owner Agent",
          creatorKind: "agent",
          creatorOwnerUserId: "owner-1",
          openProfileName: "Owner Agent",
        }),
      ])
    );
    promptSearchMultiselectMock.mockResolvedValue({
      status: "submitted",
      value: ["known:0"],
    });
    selectMock.mockResolvedValueOnce("confirm");
    promptTextEntryMock.mockResolvedValueOnce({
      status: "submitted",
      value: "DELETE",
    });
    updateProfileSpaceHistoryStatusMock.mockResolvedValue({
      profileId: "hum-delete-owner",
      gatewayHost: "localhost:8080",
      spaceId: SPACE_ID,
      status: "removed",
      updatedAt: "2026-02-24T00:00:00.000Z",
    });

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input, init) => {
        const url = new URL(String(input));
        const method = String(init?.method ?? "GET").toUpperCase();
        if (
          method === "GET" &&
          url.pathname === `/v1/spaces/${SPACE_ID}/meta`
        ) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                spaceId: SPACE_ID,
                name: "Owned Agent Space",
                creator: {
                  profileId: OWNER_AGENT_RUNTIME_PROFILE_ID,
                  profileName: "Owner Agent",
                  kind: "agent",
                  ownerUserId: "owner-1",
                },
                createdAt: "2026-02-24T00:00:00.000Z",
                updatedAt: "2026-02-24T00:00:00.000Z",
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        if (method === "DELETE" && url.pathname === `/v1/spaces/${SPACE_ID}`) {
          const body = typeof init?.body === "string" ? init.body : "";
          expect(body).toContain('"approvedAgentCreatorProfileId"');
          expect(body).toContain(`"${OWNER_AGENT_RUNTIME_PROFILE_ID}"`);
          return Promise.resolve(
            new Response(
              JSON.stringify({
                spaceId: SPACE_ID,
                deleted: true,
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        throw new Error(`unexpected fetch call: ${url.toString()}`);
      });

    await withTempHome(async () => {
      await runSpaceDelete({
        profile: "hum-delete-owner",
        baseUrl: "http://localhost:8080",
        view: "human",
      });
    });

    const deleteCalls = fetchSpy.mock.calls.filter(([, init]) => {
      return String(init?.method ?? "GET").toUpperCase() === "DELETE";
    });
    expect(deleteCalls).toHaveLength(1);
  });

  it("supports multi-select delete in interactive flow", async () => {
    resolveRuntimeContextMock.mockResolvedValue({
      viewMode: "human",
      resolvedView: "human",
      interactive: true,
    });
    // Descending lastJoinedAt keeps SPACE_ID first (known:0) in the sorted
    // picker, so the multi-select order matches the DELETE-call assertions.
    listAccountSpaceIndexMock.mockResolvedValue(
      accountSpaceIndexOf([
        createAccountSpaceIndexItem({
          spaceId: SPACE_ID,
          spaceName: "Delete Target",
          creatorProfileId: "hum-delete-owner",
          creatorProfileName: "Mira",
          creatorKind: "human",
          lastJoinedAt: "2026-02-26T00:00:00.000Z",
          lastSeenTs: 1_708_905_600_000,
        }),
        createAccountSpaceIndexItem({
          spaceId: SPACE_ID_2,
          spaceName: "Delete Target Two",
          creatorProfileId: "hum-delete-owner",
          creatorProfileName: "Mira",
          creatorKind: "human",
          lastJoinedAt: "2026-02-25T00:00:00.000Z",
          lastSeenTs: 1_708_819_200_000,
        }),
      ])
    );
    promptSearchMultiselectMock.mockResolvedValue({
      status: "submitted",
      value: ["known:0", "known:1"],
    });
    selectMock.mockResolvedValueOnce("confirm");
    promptTextEntryMock.mockResolvedValueOnce({
      status: "submitted",
      value: "delete",
    });
    updateProfileSpaceHistoryStatusMock.mockResolvedValue({
      profileId: "hum-delete-owner",
      gatewayHost: "localhost:8080",
      spaceId: SPACE_ID,
      status: "removed",
      updatedAt: "2026-02-24T00:00:00.000Z",
    });

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input, init) => {
        const url = new URL(String(input));
        const method = String(init?.method ?? "GET").toUpperCase();
        if (method === "DELETE" && url.pathname === `/v1/spaces/${SPACE_ID}`) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                spaceId: SPACE_ID,
                deleted: true,
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        if (
          method === "DELETE" &&
          url.pathname === `/v1/spaces/${SPACE_ID_2}`
        ) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                spaceId: SPACE_ID_2,
                deleted: true,
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }
        throw new Error(`unexpected fetch call: ${url.toString()}`);
      });

    await withTempHome(async () => {
      await runSpaceDelete({
        profile: "hum-delete-owner",
        baseUrl: "http://localhost:8080",
        view: "human",
      });
    });

    expect(promptSearchMultiselectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Choose space(s) to delete",
        required: true,
      })
    );
    const deleteCalls = fetchSpy.mock.calls.filter(([, init]) => {
      return String(init?.method ?? "GET").toUpperCase() === "DELETE";
    });
    expect(deleteCalls).toHaveLength(2);
    expect(deleteCalls[0]).toEqual([
      expect.stringContaining(`/v1/spaces/${SPACE_ID}`),
      expect.objectContaining({ method: "DELETE" }),
    ]);
    expect(deleteCalls[1]).toEqual([
      expect.stringContaining(`/v1/spaces/${SPACE_ID_2}`),
      expect.objectContaining({ method: "DELETE" }),
    ]);
    expect(selectMock).toHaveBeenCalledTimes(1);
    expect(promptTextEntryMock).toHaveBeenCalledTimes(1);
    expect(updateProfileSpaceHistoryStatusMock).toHaveBeenCalledTimes(2);
  });
});
