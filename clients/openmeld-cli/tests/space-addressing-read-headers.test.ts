import {
  OPENMELD_HEADER_SPACE_ADDRESSING_VERSION,
  OPENMELD_SPACE_ADDRESSING_VERSION,
} from "@openmeld/gateway-contract";
import { afterEach, describe, expect, it, vi } from "vitest";

const buildHeadersMock = vi.hoisted(() =>
  vi.fn(async () => ({ authorization: "Bearer test-token" }))
);

vi.mock("../src/config/request-headers", () => ({
  buildOpenMeldRequestContextHeadersWithAuth: buildHeadersMock,
}));

import { fetchSpaceDispatchResult } from "../src/space/result-api";
import { fetchSpaceUpdates } from "../src/space/updates-api";

const REQUEST_CONTEXT = {
  actorContext: {
    openMeldProfileId: "11111111-1111-4111-8111-111111111111",
    profileKind: "human" as const,
    profileName: "Felix",
    requestId: "request-space-addressing-reads",
  },
};

describe("current Space Addressing read headers", () => {
  afterEach(() => {
    buildHeadersMock.mockClear();
    vi.unstubAllGlobals();
  });

  it("advertises the current contract on direct updates and result reads", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ signals: [] }))
      .mockResolvedValueOnce(
        Response.json({
          actorProfileId: "agt_22222222-2222-4222-8222-222222222222",
          createdAt: "2026-08-31T00:00:00.000Z",
          dispatchId: "dispatch-1",
          finalText: "Done.",
          publicOutcome: "post_message",
          resultKind: "text",
          resultRef: "result-1",
          spaceId: "space-1",
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    await fetchSpaceUpdates({
      afterSignalId: "signal-1",
      baseUrl: "https://gateway.testing.example",
      limit: 10,
      requestContext: REQUEST_CONTEXT,
      space: "space-1",
    });
    await fetchSpaceDispatchResult({
      baseUrl: "https://gateway.testing.example",
      dispatchId: "dispatch-1",
      requestContext: REQUEST_CONTEXT,
      space: "space-1",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchMock.mock.calls) {
      expect(
        new Headers(init?.headers).get(OPENMELD_HEADER_SPACE_ADDRESSING_VERSION)
      ).toBe(OPENMELD_SPACE_ADDRESSING_VERSION);
    }
  });
});
