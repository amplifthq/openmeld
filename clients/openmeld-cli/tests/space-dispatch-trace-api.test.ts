import { afterEach, describe, expect, it, vi } from "vitest";

const buildHeadersMock = vi.hoisted(() =>
  vi.fn(async () => ({
    authorization: "Bearer test-token",
  }))
);

vi.mock("../src/config/request-headers", () => ({
  buildOpenMeldRequestContextHeadersWithAuth: (
    ...args: Parameters<typeof buildHeadersMock>
  ) => buildHeadersMock(...args),
}));

import { fetchSpaceDispatchTrace } from "../src/config/space-dispatch-trace-api";

const REQUEST_CONTEXT = {
  actorContext: {
    requestId: "req-trace-test",
    openMeldProfileId: "hum_trace_test",
    profileKind: "human" as const,
    profileName: "Trace Tester",
  },
};

describe("Space dispatch trace API", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("preserves the first schema mismatch when a trace response is invalid", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          correlation: "invalid",
          query: {},
          trace: null,
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchSpaceDispatchTrace({
        requestContext: REQUEST_CONTEXT,
        baseUrl: "https://gateway.openmeld.invalid",
        space: "space-trace-test",
        dispatchId: "dispatch-trace-test",
      })
    ).rejects.toThrow(
      "invalid space dispatch trace response at correlation: Invalid input"
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://gateway.openmeld.invalid/v1/spaces/space-trace-test/dispatches/dispatch-trace-test/trace",
      expect.objectContaining({
        headers: {
          authorization: "Bearer test-token",
          "x-openmeld-space-dispatch-trace-response-version": "3",
        },
      })
    );
  });
});
