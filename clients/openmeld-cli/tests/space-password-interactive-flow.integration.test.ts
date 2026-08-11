import type { AccountSpaceIndexItem } from "@openmeld/schemas/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withTempHome } from "./helpers/fs";

const selectMock = vi.hoisted(() => vi.fn());
const textMock = vi.hoisted(() => vi.fn());
const passwordPromptMock = vi.hoisted(() => vi.fn());
const isCancelMock = vi.hoisted(() => vi.fn((_value: unknown) => false));
const listAccountSpaceIndexMock = vi.hoisted(() => vi.fn());
const listProfileSpaceHistoryMock = vi.hoisted(() => vi.fn());
const querySpaceDeletionTombstonesMock = vi.hoisted(() => vi.fn());
const fetchSpaceRequestWithTimeoutMock = vi.hoisted(() => vi.fn());
const getAuthSessionStateMock = vi.hoisted(() => vi.fn());
const promptSearchSelectMock = vi.hoisted(() => vi.fn());
const promptTextEntryMock = vi.hoisted(() => vi.fn());

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
    isCancel: (value: unknown) => isCancelMock(value),
    password: (input: unknown) => passwordPromptMock(input),
    select: (input: unknown) => selectMock(input),
    text: (input: unknown) => textMock(input),
  };
});

vi.mock("../src/runtime/context", () => {
  return {
    parseCliViewMode: vi.fn(),
    resolveRuntimeContext: vi.fn(async () => ({
      viewMode: "human",
      resolvedView: "human",
      interactive: true,
    })),
  };
});

vi.mock("../src/ui/search-select", () => {
  return {
    promptSearchMultiselectWorkbench: vi.fn(),
    promptSearchSelect: (...args: Parameters<typeof promptSearchSelectMock>) =>
      promptSearchSelectMock(...args),
  };
});

vi.mock("../src/config/resolve-openmeld-profile", () => {
  const profile = {
    openMeldProfileId: "hum-owner-profile",
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
    requireOpenMeldProfile: vi.fn(async () => profile),
    resolveOpenMeldProfileOrNull: vi.fn(async () => profile),
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

vi.mock("../src/config/request-headers", () => {
  return {
    buildOpenMeldProfileRequestHeadersWithAuth: vi.fn(async () => ({})),
    buildOpenMeldRequestContextHeadersWithAuth: vi.fn(async () => ({})),
    canAttachAuthTokenToRequest: vi.fn(() => true),
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
    listProfileSpaceHistory: (
      ...args: Parameters<typeof listProfileSpaceHistoryMock>
    ) => listProfileSpaceHistoryMock(...args),
    upsertProfileSpaceHistory: vi.fn(),
    updateProfileSpaceHistoryStatus: vi.fn(),
  };
});

vi.mock("../src/config/space-deletion-tombstone-api", () => {
  return {
    querySpaceDeletionTombstones: (
      ...args: Parameters<typeof querySpaceDeletionTombstonesMock>
    ) => querySpaceDeletionTombstonesMock(...args),
    upsertSpaceDeletionTombstone: vi.fn(),
  };
});

vi.mock("../src/space/fetch-with-timeout", () => {
  return {
    fetchSpaceRequestWithTimeout: (
      ...args: Parameters<typeof fetchSpaceRequestWithTimeoutMock>
    ) => fetchSpaceRequestWithTimeoutMock(...args),
  };
});

vi.mock("../src/ui/text-entry", () => {
  return {
    promptTextEntry: (...args: Parameters<typeof promptTextEntryMock>) =>
      promptTextEntryMock(...args),
  };
});

import { runSpacePassword } from "../src/space/command";

const OWN_SPACE_ID =
  "1111111111111111111111111111111111111111111111111111111111111111";
const PROTECTED_SPACE_ID =
  "2222222222222222222222222222222222222222222222222222222222222222";
const OTHER_SPACE_ID =
  "3333333333333333333333333333333333333333333333333333333333333333";
const OWNER_PROFILE_ID = "hum-owner-profile";

function createAccountSpaceIndexItem(
  input: Partial<AccountSpaceIndexItem> & { spaceId: string; spaceName: string }
): AccountSpaceIndexItem {
  const openProfileId = input.openProfileId ?? OWNER_PROFILE_ID;
  const openProfileName = input.openProfileName ?? "Mira";
  const lastJoinedAt = input.lastJoinedAt ?? "2026-02-20T02:00:00.000Z";
  return {
    creatorKind: input.creatorKind ?? "human",
    creatorOwnerUserId: input.creatorOwnerUserId ?? "user-1",
    creatorProfileId: input.creatorProfileId ?? OWNER_PROFILE_ID,
    creatorProfileName: input.creatorProfileName ?? "Mira",
    gatewayHost: input.gatewayHost ?? "gateway.openmeld.invalid",
    joinedProfiles: input.joinedProfiles ?? [
      {
        lastJoinedAt,
        pinnedAt: input.pinnedAt ?? null,
        profileId: openProfileId,
        profileName: openProfileName,
      },
    ],
    lastJoinedAt,
    lastSeenTs: input.lastSeenTs ?? 123,
    openProfileId,
    openProfileName,
    organizationId: input.organizationId ?? "org-1",
    pinnedAt: input.pinnedAt ?? null,
    pinnedProfileIds: input.pinnedProfileIds ?? [],
    spaceCreatedAt: input.spaceCreatedAt ?? "2026-02-20T00:00:00.000Z",
    spaceId: input.spaceId,
    spaceName: input.spaceName,
    spaceUpdatedAt: input.spaceUpdatedAt ?? "2026-02-20T01:00:00.000Z",
    status: input.status ?? "active",
    updatedAt: input.updatedAt ?? "2026-02-20T02:00:00.000Z",
    visibility: input.visibility ?? "private",
  };
}

function createSpaceMetaResponse(input: {
  spaceId: string;
  passwordProtected: boolean;
}) {
  return new Response(
    JSON.stringify({
      spaceId: input.spaceId,
      organizationId: "org-1",
      visibility: "private",
      passwordProtected: input.passwordProtected,
    }),
    {
      status: 200,
      headers: {
        "content-type": "application/json",
      },
    }
  );
}

function createSpacePasswordRequiredResponse() {
  return new Response(
    JSON.stringify({
      code: "space.password_required",
      message: "space password required",
    }),
    {
      status: 401,
      headers: {
        "content-type": "application/json",
      },
    }
  );
}

function createSpacePasswordMutationResponse() {
  return new Response(
    JSON.stringify({
      ok: true,
    }),
    {
      status: 200,
      headers: {
        "content-type": "application/json",
      },
    }
  );
}

describe("space password interactive flow", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    getAuthSessionStateMock.mockReset();
    selectMock.mockReset();
    textMock.mockReset();
    passwordPromptMock.mockReset();
    isCancelMock.mockReset();
    isCancelMock.mockImplementation((_value: unknown) => false);
    listAccountSpaceIndexMock.mockReset();
    listProfileSpaceHistoryMock.mockReset();
    querySpaceDeletionTombstonesMock.mockReset();
    querySpaceDeletionTombstonesMock.mockResolvedValue([]);
    fetchSpaceRequestWithTimeoutMock.mockReset();
    promptSearchSelectMock.mockReset();
    promptTextEntryMock.mockReset();
  });

  it("asks action first, then owned space selection, then password", async () => {
    getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
    listAccountSpaceIndexMock.mockResolvedValue({
      pinnedItems: [],
      spaceItems: [
        createAccountSpaceIndexItem({
          spaceId: OWN_SPACE_ID,
          spaceName: "Owner Space",
          creatorProfileId: OWNER_PROFILE_ID,
          lastSeenTs: 123,
        }),
        createAccountSpaceIndexItem({
          spaceId: OTHER_SPACE_ID,
          spaceName: "Other Space",
          creatorProfileId: "someone-else",
          creatorProfileName: "Someone Else",
          lastSeenTs: 456,
        }),
      ],
    });
    selectMock.mockResolvedValueOnce("set");
    promptSearchSelectMock.mockResolvedValueOnce({
      status: "submitted",
      value: "known:0",
    });
    passwordPromptMock
      .mockResolvedValueOnce("abc123")
      .mockResolvedValueOnce("abc123");
    fetchSpaceRequestWithTimeoutMock.mockImplementation(
      (input: { url?: string; init?: RequestInit }) => {
        if (input.url?.includes(`/spaces/${OWN_SPACE_ID}/meta`)) {
          return createSpaceMetaResponse({
            spaceId: OWN_SPACE_ID,
            passwordProtected: false,
          });
        }
        if (
          input.url?.includes(`/spaces/${OWN_SPACE_ID}/password`) &&
          input.init?.method === "PUT"
        ) {
          return createSpacePasswordMutationResponse();
        }
        throw new Error(`unexpected request: ${String(input.url ?? "")}`);
      }
    );

    await withTempHome(async () => {
      await runSpacePassword({
        profile: "hum-owner-profile",
        baseUrl: "https://gateway.openmeld.invalid",
        view: "human",
      });
    });

    expect(selectMock).toHaveBeenCalledTimes(1);
    expect(promptSearchSelectMock).toHaveBeenCalledTimes(1);
    const actionPromptOrder = selectMock.mock.invocationCallOrder[0];
    const targetPromptOrder =
      promptSearchSelectMock.mock.invocationCallOrder[0];
    const passwordPromptOrder = passwordPromptMock.mock.invocationCallOrder[0];
    expect(actionPromptOrder).toBeDefined();
    expect(targetPromptOrder).toBeDefined();
    expect(passwordPromptOrder).toBeDefined();
    if (
      actionPromptOrder === undefined ||
      targetPromptOrder === undefined ||
      passwordPromptOrder === undefined
    ) {
      throw new Error("expected prompt invocation order to be captured");
    }
    expect(actionPromptOrder).toBeLessThan(targetPromptOrder);
    expect(targetPromptOrder).toBeLessThan(passwordPromptOrder);

    const targetSelectInput = promptSearchSelectMock.mock.calls[0]?.[0] as
      | {
          message?: string;
          allowBack?: boolean;
          backLabel?: string;
          items?: Array<{ label?: string; value?: string }>;
        }
      | undefined;
    expect(targetSelectInput?.message).toBe(
      "Choose an unprotected space you created to set password"
    );
    expect(targetSelectInput?.allowBack).toBe(true);
    expect(targetSelectInput?.backLabel).toBe("Back");
    const optionLabels = (targetSelectInput?.items ?? [])
      .map((item) => String(item.label ?? ""))
      .join("\n");
    expect(optionLabels).toContain("Owner Space");
    expect(optionLabels).not.toContain("🔒");
    expect(optionLabels).not.toContain("Other Space");

    expect(fetchSpaceRequestWithTimeoutMock).toHaveBeenCalledTimes(2);
    const request = fetchSpaceRequestWithTimeoutMock.mock.calls[1]?.[0] as
      | {
          url?: string;
          init?: RequestInit;
        }
      | undefined;
    expect(request?.url).toContain(`/v1/spaces/${OWN_SPACE_ID}/password`);
    expect(request?.init?.method).toBe("PUT");
    const parsedBody = JSON.parse(String(request?.init?.body ?? "{}")) as {
      password?: string;
    };
    expect(parsedBody.password).toBe("abc123");
  });

  it("shows only password-protected owned spaces when clearing password", async () => {
    getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
    listAccountSpaceIndexMock.mockResolvedValue({
      pinnedItems: [],
      spaceItems: [
        createAccountSpaceIndexItem({
          spaceId: OWN_SPACE_ID,
          spaceName: "Owner Public Space",
          creatorProfileId: OWNER_PROFILE_ID,
          lastSeenTs: 123,
        }),
        createAccountSpaceIndexItem({
          spaceId: PROTECTED_SPACE_ID,
          spaceName: "Owner Protected Space",
          creatorProfileId: OWNER_PROFILE_ID,
          lastSeenTs: 456,
        }),
        createAccountSpaceIndexItem({
          spaceId: OTHER_SPACE_ID,
          spaceName: "Other Space",
          creatorProfileId: "someone-else",
          creatorProfileName: "Someone Else",
          lastSeenTs: 789,
        }),
      ],
    });
    selectMock.mockResolvedValueOnce("clear");
    promptSearchSelectMock.mockResolvedValueOnce({
      status: "submitted",
      value: "known:0",
    });
    fetchSpaceRequestWithTimeoutMock.mockImplementation(
      (input: { url?: string; init?: RequestInit }) => {
        if (input.url?.includes(`/spaces/${OWN_SPACE_ID}/meta`)) {
          return createSpaceMetaResponse({
            spaceId: OWN_SPACE_ID,
            passwordProtected: false,
          });
        }
        if (input.url?.includes(`/spaces/${PROTECTED_SPACE_ID}/meta`)) {
          return createSpacePasswordRequiredResponse();
        }
        if (
          input.url?.includes(`/spaces/${PROTECTED_SPACE_ID}/password`) &&
          input.init?.method === "DELETE"
        ) {
          return createSpacePasswordMutationResponse();
        }
        throw new Error(`unexpected request: ${String(input.url ?? "")}`);
      }
    );

    await withTempHome(async () => {
      await runSpacePassword({
        profile: "hum-owner-profile",
        baseUrl: "https://gateway.openmeld.invalid",
        view: "human",
      });
    });

    expect(promptSearchSelectMock).toHaveBeenCalledTimes(1);
    const targetSelectInput = promptSearchSelectMock.mock.calls[0]?.[0] as
      | {
          message?: string;
          allowBack?: boolean;
          backLabel?: string;
          items?: Array<{ label?: string; value?: string }>;
        }
      | undefined;
    expect(targetSelectInput?.message).toBe(
      "Choose a password-protected space you created to clear password"
    );
    expect(targetSelectInput?.allowBack).toBe(true);
    expect(targetSelectInput?.backLabel).toBe("Back");
    const optionLabels = (targetSelectInput?.items ?? [])
      .map((item) => String(item.label ?? ""))
      .join("\n");
    expect(optionLabels).toContain("🔒 Owner Protected Space");
    expect(optionLabels).not.toContain("Owner Public Space");
    expect(optionLabels).not.toContain("Other Space");

    expect(fetchSpaceRequestWithTimeoutMock).toHaveBeenCalledTimes(3);
    const request = fetchSpaceRequestWithTimeoutMock.mock.calls[2]?.[0] as
      | {
          url?: string;
          init?: RequestInit;
        }
      | undefined;
    expect(request?.url).toContain(`/v1/spaces/${PROTECTED_SPACE_ID}/password`);
    expect(request?.init?.method).toBe("DELETE");
  });

  it("falls back to manual entry when the password filter removes every owned space", async () => {
    // The Space-Index read path no longer reconstructs deleted-space notices
    // from profile history / tombstones (developing/architecture/
    // data-and-observability.md Projection Rules); the surviving behavior is the
    // manual fallback when password filtering leaves no eligible owned space.
    getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
    selectMock.mockResolvedValueOnce("set");
    promptTextEntryMock.mockResolvedValueOnce({ status: "cancelled" });
    listAccountSpaceIndexMock.mockResolvedValue({
      pinnedItems: [],
      spaceItems: [
        createAccountSpaceIndexItem({
          spaceId: OWN_SPACE_ID,
          spaceName: "Owner Protected Space",
          creatorProfileId: OWNER_PROFILE_ID,
          lastSeenTs: 123,
        }),
        createAccountSpaceIndexItem({
          spaceId: OTHER_SPACE_ID,
          spaceName: "Someone Else Space",
          creatorProfileId: "someone-else",
          creatorProfileName: "Someone Else",
          lastSeenTs: 456,
        }),
      ],
    });
    fetchSpaceRequestWithTimeoutMock.mockImplementation(
      (input: { url?: string; init?: RequestInit }) => {
        if (input.url?.includes(`/spaces/${OWN_SPACE_ID}/meta`)) {
          return createSpacePasswordRequiredResponse();
        }
        throw new Error(`unexpected request: ${String(input.url ?? "")}`);
      }
    );

    await withTempHome(async () => {
      await runSpacePassword({
        profile: "hum-owner-profile",
        baseUrl: "https://gateway.openmeld.invalid",
        view: "human",
      });
    });

    // The owned space is password-protected, so "set" filters it out and the
    // foreign space is dropped by ownership; with no eligible target the flow
    // offers manual entry instead of a picker.
    expect(promptSearchSelectMock).not.toHaveBeenCalled();
    expect(promptTextEntryMock).toHaveBeenCalledTimes(1);
  });

  it("returns to password action when the target picker goes back", async () => {
    getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
    listAccountSpaceIndexMock.mockResolvedValue({
      pinnedItems: [],
      spaceItems: [
        createAccountSpaceIndexItem({
          spaceId: OWN_SPACE_ID,
          spaceName: "Owner Public Space",
          creatorProfileId: OWNER_PROFILE_ID,
          lastSeenTs: 123,
        }),
        createAccountSpaceIndexItem({
          spaceId: PROTECTED_SPACE_ID,
          spaceName: "Owner Protected Space",
          creatorProfileId: OWNER_PROFILE_ID,
          lastSeenTs: 456,
        }),
      ],
    });
    selectMock.mockResolvedValueOnce("set").mockResolvedValueOnce("clear");
    promptSearchSelectMock
      .mockResolvedValueOnce({ status: "back" })
      .mockResolvedValueOnce({
        status: "submitted",
        value: "known:0",
      });
    fetchSpaceRequestWithTimeoutMock.mockImplementation(
      (input: { url?: string; init?: RequestInit }) => {
        if (input.url?.includes(`/spaces/${OWN_SPACE_ID}/meta`)) {
          return createSpaceMetaResponse({
            spaceId: OWN_SPACE_ID,
            passwordProtected: false,
          });
        }
        if (input.url?.includes(`/spaces/${PROTECTED_SPACE_ID}/meta`)) {
          return createSpacePasswordRequiredResponse();
        }
        if (
          input.url?.includes(`/spaces/${PROTECTED_SPACE_ID}/password`) &&
          input.init?.method === "DELETE"
        ) {
          return createSpacePasswordMutationResponse();
        }
        throw new Error(`unexpected request: ${String(input.url ?? "")}`);
      }
    );

    await withTempHome(async () => {
      await runSpacePassword({
        profile: "hum-owner-profile",
        baseUrl: "https://gateway.openmeld.invalid",
        view: "human",
      });
    });

    expect(selectMock).toHaveBeenCalledTimes(2);
    expect(promptSearchSelectMock).toHaveBeenCalledTimes(2);
    const firstTargetPrompt = promptSearchSelectMock.mock.calls[0]?.[0] as
      | {
          message?: string;
          allowBack?: boolean;
        }
      | undefined;
    const secondTargetPrompt = promptSearchSelectMock.mock.calls[1]?.[0] as
      | {
          message?: string;
          allowBack?: boolean;
        }
      | undefined;
    expect(firstTargetPrompt?.message).toBe(
      "Choose an unprotected space you created to set password"
    );
    expect(firstTargetPrompt?.allowBack).toBe(true);
    expect(secondTargetPrompt?.message).toBe(
      "Choose a password-protected space you created to clear password"
    );
    expect(secondTargetPrompt?.allowBack).toBe(true);

    const finalRequest = fetchSpaceRequestWithTimeoutMock.mock.calls.at(
      -1
    )?.[0] as
      | {
          url?: string;
          init?: RequestInit;
        }
      | undefined;
    expect(finalRequest?.url).toContain(
      `/v1/spaces/${PROTECTED_SPACE_ID}/password`
    );
    expect(finalRequest?.init?.method).toBe("DELETE");
  });
});
