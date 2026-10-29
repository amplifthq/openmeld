import {
  projectObservabilityWakeCorrelation,
  SPACE_DISPATCH_TRACE_RESPONSE_CONTRACT_VERSION,
} from "@openmeld/schemas";
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

  it.each([
    1, 2, 3,
  ] as const)("accepts runtime diagnostics v%s during the receiver-first rollout", async (version) => {
    const query = {
      spaceId: "space-trace-test",
      dispatchId: "dispatch-trace-test",
    };
    const diagnostics = {
      activeRuns: [],
      ...(version === 1 ? { attemptMarkers: [] } : {}),
      callbackContexts: [],
      collectedAt: "2026-08-12T00:00:00.000Z",
      durableObjectAlarmAtMs: null,
      fibers: [],
      schedules:
        version === 3
          ? [
              {
                id: "schedule-1",
                callback: "retryCallback",
                type: "delayed",
                timeMs: 9000,
                delayInSeconds: 5,
              },
            ]
          : [],
      spaceId: query.spaceId,
      submissions: [],
      v: version,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            correlation: projectObservabilityWakeCorrelation({
              selector: { kind: "dispatch", ...query },
            }),
            query,
            trace: null,
            remoteAgentRuntimeDiagnostics: diagnostics,
          }),
          { status: 200 }
        )
      )
    );
    const result = await fetchSpaceDispatchTrace({
      requestContext: REQUEST_CONTEXT,
      baseUrl: "https://gateway.openmeld.invalid",
      space: query.spaceId,
      dispatchId: query.dispatchId,
      includeRemoteAgentRuntimeDiagnostics: true,
    });
    expect(result.remoteAgentRuntimeDiagnostics).toEqual(diagnostics);
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
      "https://gateway.openmeld.invalid/v1/spaces/space-trace-test/dispatches/dispatch-trace-test/trace?includeServiceConnectionDiagnostics=true",
      expect.objectContaining({
        headers: {
          authorization: "Bearer test-token",
          "x-openmeld-space-dispatch-trace-response-version": String(
            SPACE_DISPATCH_TRACE_RESPONSE_CONTRACT_VERSION
          ),
        },
      })
    );
  });
});
