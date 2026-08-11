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
  querySpaceDeletionTombstones as querySpaceDeletionTombstonesRaw,
  SpaceDeletionTombstoneApiError,
  upsertSpaceDeletionTombstone as upsertSpaceDeletionTombstoneRaw,
} from "../src/config/space-deletion-tombstone-api";

const SAMPLE_RECORD = {
  gatewayHost: "gateway.testing.example",
  spaceId: "space-alpha",
  spaceName: "Mission Control",
  creatorProfileId: "hum_mira",
  creatorKind: "human",
  deletedByProfileId: null,
  deletedByProfileName: null,
  deletedByOwnerUserId: null,
  deletedAt: "2026-03-12T08:00:00.000Z",
  createdAt: "2026-03-12T08:00:00.000Z",
  updatedAt: "2026-03-12T08:00:00.000Z",
} as const;

const REQUEST_CONTEXT = {
  actorContext: {
    requestId: "req-test",
    openMeldProfileId: "hum_mira",
    profileKind: "human" as const,
    profileName: "Mira",
  },
};

type QuerySpaceDeletionTombstonesInput = Omit<
  Parameters<typeof querySpaceDeletionTombstonesRaw>[0],
  "requestContext"
> & {
  requestContext?: Parameters<
    typeof querySpaceDeletionTombstonesRaw
  >[0]["requestContext"];
};

type UpsertSpaceDeletionTombstoneInput = Omit<
  Parameters<typeof upsertSpaceDeletionTombstoneRaw>[0],
  "requestContext"
> & {
  requestContext?: Parameters<
    typeof upsertSpaceDeletionTombstoneRaw
  >[0]["requestContext"];
};

const querySpaceDeletionTombstones = (
  input: QuerySpaceDeletionTombstonesInput
) =>
  querySpaceDeletionTombstonesRaw({
    ...input,
    requestContext: input.requestContext ?? REQUEST_CONTEXT,
  });

const upsertSpaceDeletionTombstone = (
  input: UpsertSpaceDeletionTombstoneInput
) =>
  upsertSpaceDeletionTombstoneRaw({
    ...input,
    requestContext: input.requestContext ?? REQUEST_CONTEXT,
  });

async function expectApiError(
  operation: Promise<unknown>
): Promise<SpaceDeletionTombstoneApiError> {
  try {
    await operation;
    throw new Error("expected SpaceDeletionTombstoneApiError");
  } catch (error) {
    if (error instanceof SpaceDeletionTombstoneApiError) {
      return error;
    }
    throw error;
  }
}

describe("space-deletion-tombstone api client", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    buildHeadersMock.mockReset();
    buildHeadersMock.mockResolvedValue({
      authorization: "Bearer test-token",
    });
  });

  it("posts tombstone query requests with auth headers and json body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [SAMPLE_RECORD] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const items = await querySpaceDeletionTombstones({
      baseUrl: "https://gateway.testing.example",
      openMeldProfileId: "hum_mira",
      profileName: "Mira",
      body: {
        gatewayHost: "gateway.testing.example",
        spaceIds: ["space-alpha", "space-beta"],
      },
    });

    expect(items).toEqual([SAMPLE_RECORD]);
    const requestUrl = String(fetchMock.mock.calls[0]?.[0] ?? "");
    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(new URL(requestUrl).pathname).toBe(
      "/v1/spaces/deletion-tombstones/query"
    );
    expect(requestInit?.method).toBe("POST");
    expect(requestInit?.headers).toEqual(
      expect.objectContaining({
        authorization: "Bearer test-token",
        "content-type": "application/json",
      })
    );
    expect(requestInit?.body).toBe(
      JSON.stringify({
        gatewayHost: "gateway.testing.example",
        spaceIds: ["space-alpha", "space-beta"],
      })
    );
  });

  it("puts tombstone upsert requests without mutating auth headers", async () => {
    const authHeaders = { authorization: "Bearer shared-token" };
    buildHeadersMock.mockResolvedValueOnce(authHeaders);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ item: SAMPLE_RECORD }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await upsertSpaceDeletionTombstone({
      baseUrl: "https://gateway.testing.example",
      openMeldProfileId: "hum_mira",
      profileName: "Mira",
      spaceId: "space/alpha",
      body: {
        gatewayHost: "gateway.testing.example",
        spaceName: "Mission Control",
      },
    });

    const requestUrl = String(fetchMock.mock.calls[0]?.[0] ?? "");
    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(new URL(requestUrl).pathname).toBe(
      "/v1/spaces/space%2Falpha/deletion-tombstone"
    );
    expect(requestInit?.method).toBe("PUT");
    expect(requestInit?.headers).toEqual(
      expect.objectContaining({
        authorization: "Bearer shared-token",
        "content-type": "application/json",
      })
    );
    expect(
      authHeaders["content-type" as keyof typeof authHeaders]
    ).toBeUndefined();
  });

  it("wraps network failures as fallback-capable query errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("network down");
      })
    );

    const error = await expectApiError(
      querySpaceDeletionTombstones({
        baseUrl: "https://gateway.testing.example",
        openMeldProfileId: "hum_mira",
        profileName: "Mira",
        body: {
          gatewayHost: "gateway.testing.example",
          spaceIds: ["space-alpha"],
        },
      })
    );

    expect(error.code).toBe("space_deletion_tombstone.network_error");
    expect(error.canFallbackToLocal).toBe(true);
    expect(error.message).toBe("network down");
  });

  it("rejects invalid tombstone query responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ items: [{ wrong: true }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      )
    );

    const error = await expectApiError(
      querySpaceDeletionTombstones({
        baseUrl: "https://gateway.testing.example",
        openMeldProfileId: "hum_mira",
        profileName: "Mira",
        body: {
          gatewayHost: "gateway.testing.example",
          spaceIds: ["space-alpha"],
        },
      })
    );

    expect(error.code).toBe("space_deletion_tombstone.response_invalid");
    expect(error.canFallbackToLocal).toBe(true);
  });
});
