import { afterEach, describe, expect, it, vi } from "vitest";

const buildHeadersMock = vi.hoisted(() =>
  vi.fn(async () => ({
    authorization: "Bearer test-token",
  }))
);

vi.mock("../src/config/request-headers", () => {
  return {
    buildOpenMeldRequestContextHeadersWithAuth: (
      ...args: Parameters<typeof buildHeadersMock>
    ) => buildHeadersMock(...args),
  };
});

import {
  listProfileSpaceHistory as listProfileSpaceHistoryRaw,
  ProfileSpaceHistoryApiError,
  resolveGatewayHost,
  updateProfileSpaceHistoryStatus as updateProfileSpaceHistoryStatusRaw,
  upsertProfileSpaceHistory as upsertProfileSpaceHistoryRaw,
} from "../src/config/profile-space-history-api";

const SAMPLE_RECORD = {
  profileId: "hum_mira",
  gatewayHost: "gateway.testing.example",
  spaceId: "space-alpha",
  spaceName: "Mission Control",
  creatorProfileId: "hum_mira",
  creatorKind: "human",
  spaceCreatedAt: "2026-02-20T00:00:00.000Z",
  spaceUpdatedAt: "2026-02-20T01:00:00.000Z",
  lastJoinedAt: "2026-02-20T02:00:00.000Z",
  lastSeenTs: 42,
  pinnedAt: null,
  status: "active",
  createdAt: "2026-02-20T00:00:00.000Z",
  updatedAt: "2026-02-20T02:00:00.000Z",
} as const;

const SAMPLE_UPSERT_RESPONSE = {
  item: SAMPLE_RECORD,
  spaceIndexOverlay: {
    repairAttempted: false,
    status: "applied",
    updated: true,
  },
} as const;

const REQUEST_CONTEXT = {
  actorContext: {
    requestId: "req-test",
    openMeldProfileId: "hum_mira",
    profileKind: "human" as const,
    profileName: "Mira",
  },
};

type ListProfileSpaceHistoryInput = Omit<
  Parameters<typeof listProfileSpaceHistoryRaw>[0],
  "requestContext"
> & {
  requestContext?: Parameters<
    typeof listProfileSpaceHistoryRaw
  >[0]["requestContext"];
};

type UpsertProfileSpaceHistoryInput = Omit<
  Parameters<typeof upsertProfileSpaceHistoryRaw>[0],
  "requestContext"
> & {
  requestContext?: Parameters<
    typeof upsertProfileSpaceHistoryRaw
  >[0]["requestContext"];
};

type UpdateProfileSpaceHistoryStatusInput = Omit<
  Parameters<typeof updateProfileSpaceHistoryStatusRaw>[0],
  "requestContext"
> & {
  requestContext?: Parameters<
    typeof updateProfileSpaceHistoryStatusRaw
  >[0]["requestContext"];
};

const listProfileSpaceHistory = (input: ListProfileSpaceHistoryInput) =>
  listProfileSpaceHistoryRaw({
    ...input,
    requestContext: input.requestContext ?? REQUEST_CONTEXT,
  });

const upsertProfileSpaceHistory = (input: UpsertProfileSpaceHistoryInput) =>
  upsertProfileSpaceHistoryRaw({
    ...input,
    requestContext: input.requestContext ?? REQUEST_CONTEXT,
  });

const updateProfileSpaceHistoryStatus = (
  input: UpdateProfileSpaceHistoryStatusInput
) =>
  updateProfileSpaceHistoryStatusRaw({
    ...input,
    requestContext: input.requestContext ?? REQUEST_CONTEXT,
  });

async function expectApiError(
  operation: Promise<unknown>
): Promise<ProfileSpaceHistoryApiError> {
  try {
    await operation;
    throw new Error("expected ProfileSpaceHistoryApiError");
  } catch (error) {
    if (error instanceof ProfileSpaceHistoryApiError) {
      return error;
    }
    throw error;
  }
}

describe("profile-space-history api client", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    buildHeadersMock.mockReset();
    buildHeadersMock.mockResolvedValue({
      authorization: "Bearer test-token",
    });
  });

  it("builds list endpoint with default status/limit and normalized gatewayHost", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [SAMPLE_RECORD] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await listProfileSpaceHistory({
      baseUrl: "https://Gateway.Testing.Example/",
      openMeldProfileId: "hum/mira",
      profileName: "Mira",
    });

    const requestUrl = String(fetchMock.mock.calls[0]?.[0] ?? "");
    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const parsed = new URL(requestUrl);

    expect(parsed.pathname).toBe("/v1/profiles/hum%2Fmira/spaces");
    expect(parsed.searchParams.get("gatewayHost")).toBe(
      "gateway.testing.example"
    );
    expect(parsed.searchParams.getAll("status")).toEqual(["active"]);
    expect(parsed.searchParams.get("limit")).toBe("20");
    expect(requestInit?.headers).toEqual(
      expect.objectContaining({ authorization: "Bearer test-token" })
    );
    expect(
      (requestInit?.headers as Record<string, string> | undefined)?.[
        "content-type"
      ]
    ).toBeUndefined();
  });

  it("uses provided list statuses and clamps limit to at least 1", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [SAMPLE_RECORD] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await listProfileSpaceHistory({
      baseUrl: "https://gateway.testing.example",
      openMeldProfileId: "hum_mira",
      profileName: "Mira",
      statuses: ["active", "removed"],
      pinned: true,
      limit: 0,
    });

    const parsed = new URL(String(fetchMock.mock.calls[0]?.[0] ?? ""));
    expect(parsed.searchParams.getAll("status")).toEqual(["active", "removed"]);
    expect(parsed.searchParams.get("pinned")).toBe("true");
    expect(parsed.searchParams.get("limit")).toBe("1");
  });

  it("adds content-type for upsert body without mutating auth headers object", async () => {
    const authHeaders = { authorization: "Bearer shared-token" };
    buildHeadersMock.mockResolvedValueOnce(authHeaders);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(SAMPLE_UPSERT_RESPONSE), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await upsertProfileSpaceHistory({
      baseUrl: "https://gateway.testing.example",
      openMeldProfileId: "hum_mira",
      profileName: "Mira",
      spaceId: "space-alpha",
      body: {
        gatewayHost: "gateway.testing.example",
      },
    });

    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(requestInit?.headers).toEqual(
      expect.objectContaining({
        authorization: "Bearer shared-token",
        "content-type": "application/json",
      })
    );
    expect(requestInit?.body).toBe(
      JSON.stringify({ gatewayHost: "gateway.testing.example" })
    );
    expect(
      authHeaders["content-type" as keyof typeof authHeaders]
    ).toBeUndefined();
  });

  it("adds content-type for status update body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          profileId: "hum_mira",
          gatewayHost: "gateway.testing.example",
          spaceId: "space-alpha",
          status: "removed",
          updatedAt: "2026-02-20T03:00:00.000Z",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await updateProfileSpaceHistoryStatus({
      baseUrl: "https://gateway.testing.example",
      openMeldProfileId: "hum_mira",
      profileName: "Mira",
      spaceId: "space-alpha",
      body: {
        gatewayHost: "gateway.testing.example",
        status: "removed",
      },
    });

    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(requestInit?.headers).toEqual(
      expect.objectContaining({
        authorization: "Bearer test-token",
        "content-type": "application/json",
      })
    );
  });

  it("encodes profileId and spaceId in upsert/status endpoints", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(SAMPLE_UPSERT_RESPONSE), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            profileId: "hum_mira",
            gatewayHost: "gateway.testing.example",
            spaceId: "space-alpha",
            status: "active",
            updatedAt: "2026-02-20T03:00:00.000Z",
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      );
    vi.stubGlobal("fetch", fetchMock);

    await upsertProfileSpaceHistory({
      baseUrl: "https://gateway.testing.example",
      openMeldProfileId: "hum/mira",
      profileName: "Mira",
      spaceId: "space/alpha",
      body: {
        gatewayHost: "gateway.testing.example",
      },
    });
    await updateProfileSpaceHistoryStatus({
      baseUrl: "https://gateway.testing.example",
      openMeldProfileId: "hum/mira",
      profileName: "Mira",
      spaceId: "space/alpha",
      body: {
        gatewayHost: "gateway.testing.example",
        status: "active",
      },
    });

    const upsertUrl = new URL(String(fetchMock.mock.calls[0]?.[0] ?? ""));
    const statusUrl = new URL(String(fetchMock.mock.calls[1]?.[0] ?? ""));
    expect(upsertUrl.pathname).toBe(
      "/v1/profiles/hum%2Fmira/spaces/space%2Falpha"
    );
    expect(statusUrl.pathname).toBe(
      "/v1/profiles/hum%2Fmira/spaces/space%2Falpha/status"
    );
  });

  it("passes requestUrl/profile metadata into auth header builder", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [SAMPLE_RECORD] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await listProfileSpaceHistory({
      baseUrl: "https://gateway.testing.example",
      openMeldProfileId: "hum/mira",
      profileName: "Mira Ops",
    });

    expect(buildHeadersMock).toHaveBeenCalledTimes(1);
    expect(buildHeadersMock).toHaveBeenCalledWith(
      expect.objectContaining({
        requestUrl: expect.stringContaining("/v1/profiles/hum%2Fmira/spaces"),
        requestContext: expect.objectContaining({
          actorContext: expect.objectContaining({
            openMeldProfileId: "hum_mira",
            profileName: "Mira",
          }),
        }),
      })
    );
  });

  it("marks fallback true for 408 and 429 responses", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ code: "request.timeout", message: "slow upstream" }),
          { status: 408, headers: { "content-type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: "rate_limited",
            message: "too many requests",
          }),
          { status: 429, headers: { "content-type": "application/json" } }
        )
      );
    vi.stubGlobal("fetch", fetchMock);

    const timeoutError = await expectApiError(
      listProfileSpaceHistory({
        baseUrl: "https://gateway.testing.example",
        openMeldProfileId: "hum_mira",
        profileName: "Mira",
      })
    );

    expect(timeoutError.canFallbackToLocal).toBe(true);

    const rateLimitError = await expectApiError(
      listProfileSpaceHistory({
        baseUrl: "https://gateway.testing.example",
        openMeldProfileId: "hum_mira",
        profileName: "Mira",
      })
    );

    expect(rateLimitError.canFallbackToLocal).toBe(true);
  });

  it("keeps fallback disabled for auth failures and profile-missing 404 variants", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: "auth.unauthenticated",
            message: "auth required",
          }),
          { status: 401, headers: { "content-type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: "profile.not_found",
            message: "profile not found",
          }),
          { status: 404, headers: { "content-type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: "upstream_error",
            message: "profile not found",
          }),
          { status: 404, headers: { "content-type": "application/json" } }
        )
      );
    vi.stubGlobal("fetch", fetchMock);

    const authError = await expectApiError(
      listProfileSpaceHistory({
        baseUrl: "https://gateway.testing.example",
        openMeldProfileId: "hum_mira",
        profileName: "Mira",
      })
    );
    expect(authError.canFallbackToLocal).toBe(false);

    const profileNotFoundError = await expectApiError(
      listProfileSpaceHistory({
        baseUrl: "https://gateway.testing.example",
        openMeldProfileId: "hum_mira",
        profileName: "Mira",
      })
    );
    expect(profileNotFoundError.canFallbackToLocal).toBe(false);

    const wrappedProfileMissingError = await expectApiError(
      listProfileSpaceHistory({
        baseUrl: "https://gateway.testing.example",
        openMeldProfileId: "hum_mira",
        profileName: "Mira",
      })
    );
    expect(wrappedProfileMissingError.canFallbackToLocal).toBe(false);
  });

  it("enables fallback for unknown 404 and network errors", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: "route.missing" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        })
      )
      .mockRejectedValueOnce(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    const notFoundError = await expectApiError(
      listProfileSpaceHistory({
        baseUrl: "https://gateway.testing.example",
        openMeldProfileId: "hum_mira",
        profileName: "Mira",
      })
    );
    expect(notFoundError.canFallbackToLocal).toBe(true);

    const networkError = await expectApiError(
      listProfileSpaceHistory({
        baseUrl: "https://gateway.testing.example",
        openMeldProfileId: "hum_mira",
        profileName: "Mira",
      })
    );
    expect(networkError.code).toBe("profile_space_history.network_error");
    expect(networkError.canFallbackToLocal).toBe(true);
  });

  it("extracts nested error code/message and trims surrounding whitespace", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "  rate_limited  ",
            message: "  too many requests  ",
          },
        }),
        { status: 429, headers: { "content-type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const error = await expectApiError(
      listProfileSpaceHistory({
        baseUrl: "https://gateway.testing.example",
        openMeldProfileId: "hum_mira",
        profileName: "Mira",
      })
    );
    expect(error.code).toBe("rate_limited");
    expect(error.message).toBe("too many requests");
    expect(error.canFallbackToLocal).toBe(true);
  });

  it("falls back to raw error text and status fallback message", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("upstream temporarily unavailable", {
          status: 502,
          headers: { "content-type": "text/plain" },
        })
      )
      .mockResolvedValueOnce(
        new Response("   ", {
          status: 500,
          headers: { "content-type": "text/plain" },
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const rawTextError = await expectApiError(
      listProfileSpaceHistory({
        baseUrl: "https://gateway.testing.example",
        openMeldProfileId: "hum_mira",
        profileName: "Mira",
      })
    );
    expect(rawTextError.message).toBe("upstream temporarily unavailable");
    expect(rawTextError.canFallbackToLocal).toBe(true);

    const statusFallbackError = await expectApiError(
      listProfileSpaceHistory({
        baseUrl: "https://gateway.testing.example",
        openMeldProfileId: "hum_mira",
        profileName: "Mira",
      })
    );
    expect(statusFallbackError.message).toBe(
      "profile-space-history request failed with status 500"
    );
    expect(statusFallbackError.canFallbackToLocal).toBe(true);
  });

  it("normalizes network error messages for empty Error and non-Error throws", async () => {
    const blankMessageError = new Error("placeholder");
    blankMessageError.message = "   ";
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(blankMessageError)
      .mockRejectedValueOnce("network down");
    vi.stubGlobal("fetch", fetchMock);

    const emptyErrorMessage = await expectApiError(
      listProfileSpaceHistory({
        baseUrl: "https://gateway.testing.example",
        openMeldProfileId: "hum_mira",
        profileName: "Mira",
      })
    );
    expect(emptyErrorMessage.message).toBe("Error");

    const nonErrorThrow = await expectApiError(
      listProfileSpaceHistory({
        baseUrl: "https://gateway.testing.example",
        openMeldProfileId: "hum_mira",
        profileName: "Mira",
      })
    );
    expect(nonErrorThrow.message).toBe("network error");
  });

  it("wraps response body-read failures as ProfileSpaceHistoryApiError", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockRejectedValue(new Error("stream aborted")),
    } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    const bodyReadError = await expectApiError(
      listProfileSpaceHistory({
        baseUrl: "https://gateway.testing.example",
        openMeldProfileId: "hum_mira",
        profileName: "Mira",
      })
    );
    expect(bodyReadError.code).toBe("profile_space_history.network_error");
    expect(bodyReadError.message).toBe("stream aborted");
    expect(bodyReadError.status).toBe(200);
    expect(bodyReadError.canFallbackToLocal).toBe(true);
  });

  it("throws response_invalid for schema-mismatched responses per endpoint", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ invalid: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ invalid: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ invalid: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const listError = await expectApiError(
      listProfileSpaceHistory({
        baseUrl: "https://gateway.testing.example",
        openMeldProfileId: "hum_mira",
        profileName: "Mira",
      })
    );
    expect(listError.code).toBe("profile_space_history.response_invalid");
    expect(listError.canFallbackToLocal).toBe(true);

    const upsertError = await expectApiError(
      upsertProfileSpaceHistory({
        baseUrl: "https://gateway.testing.example",
        openMeldProfileId: "hum_mira",
        profileName: "Mira",
        spaceId: "space-alpha",
        body: {
          gatewayHost: "gateway.testing.example",
        },
      })
    );
    expect(upsertError.code).toBe("profile_space_history.response_invalid");
    expect(upsertError.canFallbackToLocal).toBe(false);

    const statusError = await expectApiError(
      updateProfileSpaceHistoryStatus({
        baseUrl: "https://gateway.testing.example",
        openMeldProfileId: "hum_mira",
        profileName: "Mira",
        spaceId: "space-alpha",
        body: {
          gatewayHost: "gateway.testing.example",
          status: "active",
        },
      })
    );
    expect(statusError.code).toBe("profile_space_history.response_invalid");
    expect(statusError.canFallbackToLocal).toBe(false);
  });

  it("normalizes gateway host from origin-only baseUrl", () => {
    expect(resolveGatewayHost("https://Gateway.Testing.Example///")).toBe(
      "gateway.testing.example"
    );
  });
});
