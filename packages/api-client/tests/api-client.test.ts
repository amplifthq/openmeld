import { buildOpenMeldRequestContextHeaders } from "@openmeld/gateway-contract";
import { getSpaceStatusResponseSchema } from "@openmeld/schemas";
import { describe, expect, it, vi } from "vitest";
import {
  buildAccountSpaceActiveWakeSummaryPath,
  buildAccountSpaceIndexPath,
  createFetchTransport,
  createOpenMeldApiClient,
  normalizeApiBaseUrl,
  OpenMeldApiClientHttpError,
  OpenMeldApiClientInvalidResponseError,
  publicSpaceUrls,
  toStructuredApiClientFailure,
} from "../src/index";

const REQUEST_CONTEXT = {
  actorContext: {
    requestId: "req-api-client-123",
    openMeldProfileId: "human_profile_1",
    profileKind: "human" as const,
    profileName: "Mira",
  },
};

const SPACE_STATUS_RESPONSE = {
  spaceId: "space-123",
  generatedAt: "2026-04-02T00:00:00.000Z",
  name: "phase-3-room",
  accessMode: "public",
  passwordProtected: false,
  dispatchPolicy: { mode: "mention_only" },
  publicationMode: "collaboration",
  allowedActions: ["post_message", "post_status", "stay_silent"],
  resultArchivePolicy: { mode: "all_final_results" },
  entryBrief: "default",
  dispatchBrief: "default",
  members: {
    totalCount: 2,
    humanCount: 1,
    agentCount: 1,
    liveNowCount: 1,
    wakeableAgentCount: 0,
    offlineAgentCount: 0,
    liveHumanCount: 1,
    liveAgentCount: 0,
  },
};

const SPACE_STATUS_CANONICAL_RESPONSE = {
  ...SPACE_STATUS_RESPONSE,
  members: {
    totalCount: 2,
    humanCount: 1,
    agentCount: 1,
    liveNowCount: 1,
    wakeableAgentCount: 0,
    offlineAgentCount: 0,
    liveHumanCount: 1,
    liveAgentCount: 0,
  },
};

describe("@openmeld/api-client", () => {
  it("normalizes origin-only base URLs", () => {
    expect(normalizeApiBaseUrl("https://gateway.openmeld.invalid/")).toBe(
      "https://gateway.openmeld.invalid"
    );
    expect(() =>
      normalizeApiBaseUrl("https://gateway.openmeld.invalid/v1")
    ).toThrow("baseUrl must be origin-only (no path prefix)");
    expect(() =>
      normalizeApiBaseUrl("https://gateway.openmeld.invalid?hello=world")
    ).toThrow("baseUrl must be origin-only (no query or hash)");
  });

  it("exposes only the phase 2 public space URL builders", () => {
    const urls = publicSpaceUrls("https://gateway.openmeld.invalid/");

    expect(Object.keys(urls).sort()).toEqual(["members", "signals", "status"]);
    expect(urls.status("space-1")).toBe(
      "https://gateway.openmeld.invalid/v1/spaces/space-1/status"
    );
    expect(urls.members("space-1")).toBe(
      "https://gateway.openmeld.invalid/v1/spaces/space-1/members"
    );
    expect(urls.signals("space-1")).toBe(
      "https://gateway.openmeld.invalid/v1/spaces/space-1/signals"
    );
  });

  it("builds account space index URLs with opt-in projection fields", () => {
    expect(
      buildAccountSpaceIndexPath({
        gatewayHost: "openmeld.invalid",
        includeDirectMessageProfileIds: true,
        includePurposes: true,
        includeMemberPreviews: true,
        includeRecentlyDeletedItems: true,
        limit: 20,
        scope: "account",
        selectedProfileId: "profile-123",
      })
    ).toBe(
      "/v1/account/spaces?gatewayHost=openmeld.invalid&scope=account&selectedProfileId=profile-123&limit=20&includeRecentlyDeletedItems=true&includeDirectMessageProfileIds=true&includePurposes=true&includeMemberPreviews=true"
    );
  });

  it("keeps active Wake summaries in the same Gateway host scope", () => {
    expect(
      buildAccountSpaceActiveWakeSummaryPath({
        gatewayHost: "openmeld.invalid",
        selectedProfileId: "profile-123",
      })
    ).toBe(
      "/v1/account/spaces/active-wake-summary?gatewayHost=openmeld.invalid&selectedProfileId=profile-123"
    );
  });

  it("composes auth headers, request-context headers, and request JSON parsing", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(SPACE_STATUS_RESPONSE), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      )
    );
    const client = createOpenMeldApiClient({
      baseUrl: "https://gateway.openmeld.invalid",
      transport,
      getAuthHeaders: async ({ requestUrl }) => ({
        Authorization: `Bearer ${new URL(requestUrl).host}`,
      }),
      getRequestContextHeaders: async ({ requestContext, spacePassword }) =>
        buildOpenMeldRequestContextHeaders({
          requestContext,
          ...(spacePassword === undefined ? {} : { spacePassword }),
        }),
    });

    const result = await client.requestJson({
      url: publicSpaceUrls("https://gateway.openmeld.invalid").status(
        "space-123"
      ),
      operation: "space.status.read",
      schema: getSpaceStatusResponseSchema,
      invalidMessage: "invalid space status response",
      requestContext: REQUEST_CONTEXT,
      spacePassword: "  pw-123  ",
    });

    expect(result).toEqual(SPACE_STATUS_CANONICAL_RESPONSE);
    expect(transport).toHaveBeenCalledOnce();
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://gateway.openmeld.invalid/v1/spaces/space-123/status",
        operation: "space.status.read",
        init: {
          headers: {
            Authorization: "Bearer gateway.openmeld.invalid",
            "x-openmeld-request-id": "req-api-client-123",
            "x-openmeld-profile-id": "human_profile_1",
            "x-openmeld-profile-kind": "human",
            "x-openmeld-profile-name": "Mira",
            "x-openmeld-space-password": "pw-123",
          },
        },
      })
    );
  });

  it("rejects per-request overrides of reserved headers", async () => {
    const client = createOpenMeldApiClient({
      baseUrl: "https://gateway.openmeld.invalid",
      transport: vi.fn(() => Promise.resolve(new Response("ok"))),
    });

    await expect(
      client.requestText({
        url: "/v1/spaces/space-123/status",
        operation: "space.status.read",
        headers: {
          Authorization: "Bearer override",
        },
      })
    ).rejects.toThrow(
      "request headers must not override reserved header: Authorization"
    );
    await expect(
      client.requestText({
        url: "/v1/spaces/space-123/status",
        operation: "space.status.read",
        headers: {
          "x-openmeld-requested-organization-slug": "forged-selector",
        },
      })
    ).rejects.toThrow(
      "request headers must not override reserved header: x-openmeld-requested-organization-slug"
    );
  });

  it("reads plain text responses", async () => {
    const client = createOpenMeldApiClient({
      baseUrl: "https://gateway.openmeld.invalid",
      transport: vi.fn(() =>
        Promise.resolve(new Response("plain text response"))
      ),
    });

    await expect(
      client.requestText({
        url: "/v1/spaces/space-123/status",
        operation: "space.status.read",
      })
    ).resolves.toBe("plain text response");
  });

  it("rejects invalid JSON responses with request and schema diagnostics", async () => {
    const client = createOpenMeldApiClient({
      baseUrl: "https://gateway.openmeld.invalid",
      transport: vi.fn(() =>
        Promise.resolve(
          new Response('{"unexpected":true}', {
            headers: {
              "x-openmeld-request-id": "req-invalid-space-status",
            },
          })
        )
      ),
    });

    const request = client.requestJson({
      url: "/v1/spaces/space-123/status",
      operation: "space.status.read",
      schema: getSpaceStatusResponseSchema,
      invalidMessage: "invalid space status response",
    });

    await expect(request).rejects.toMatchObject({
      code: "gateway.invalid_response",
      message: "invalid space status response",
      operation: "space.status.read",
      requestId: "req-invalid-space-status",
      status: 200,
      schemaIssuePath: "spaceId",
    });
    await expect(request).rejects.toBeInstanceOf(
      OpenMeldApiClientInvalidResponseError
    );
  });

  it("projects invalid response failures into a structured diagnostic surface", () => {
    const failure = toStructuredApiClientFailure(
      new OpenMeldApiClientInvalidResponseError({
        message: "invalid space members response",
        operation: "space.members.read",
        requestId: "req-invalid-members",
        status: 200,
        rawBody: '{"summary":{}}',
        schemaIssue: {
          message: "Invalid input",
          path: ["agents", 0, "agentExecutionReadiness"],
        },
      })
    );

    expect(failure).toEqual({
      code: "gateway.invalid_response",
      message: "invalid space members response",
      requestId: "req-invalid-members",
      status: 200,
      upstreamCode: null,
      schemaIssueMessage: "Invalid input",
      schemaIssuePath: "agents.0.agentExecutionReadiness",
    });
  });

  it("keeps an already structured invalid response failure readable", () => {
    const failure = {
      code: "gateway.invalid_response" as const,
      message: "invalid space members response",
      requestId: "req-structured-invalid",
      status: 200,
      upstreamCode: null,
      schemaIssueMessage: "Invalid input",
      schemaIssuePath: "agents.0.agentExecutionReadiness",
    };

    expect(toStructuredApiClientFailure(failure)).toEqual(failure);
  });

  it("keeps invalid JSON response diagnostics on the first rejection", async () => {
    const client = createOpenMeldApiClient({
      baseUrl: "https://gateway.openmeld.invalid",
      transport: vi.fn(() =>
        Promise.resolve(
          new Response('{"unexpected":true}', {
            headers: {
              "x-openmeld-request-id": "req-invalid-json-first-rejection",
            },
          })
        )
      ),
    });

    await expect(
      client.requestJson({
        url: "/v1/spaces/space-123/status",
        operation: "space.status.read",
        schema: getSpaceStatusResponseSchema,
        invalidMessage: "invalid space status response",
      })
    ).rejects.toMatchObject({
      code: "gateway.invalid_response",
      requestId: "req-invalid-json-first-rejection",
      schemaIssuePath: "spaceId",
    });
  });

  it("preserves canonical gateway error envelopes", async () => {
    const client = createOpenMeldApiClient({
      baseUrl: "https://gateway.openmeld.invalid",
      transport: vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              ok: false,
              error: {
                code: "space.not_found",
                message: "Space not found.",
                requestId: "req-api-client-404",
                upstreamCode: "controller.binding.lookup_failed",
              },
            }),
            {
              status: 404,
              headers: {
                "content-type": "application/json",
                "x-openmeld-request-id": "req-api-client-404",
              },
            }
          )
        )
      ),
    });

    await expect(
      client.requestJson({
        url: "/v1/spaces/missing/status",
        operation: "space.status.read",
        schema: getSpaceStatusResponseSchema,
        invalidMessage: "invalid space status response",
      })
    ).rejects.toMatchObject({
      code: "space.not_found",
      message: "Space not found.",
      requestId: "req-api-client-404",
      status: 404,
      upstreamCode: "controller.binding.lookup_failed",
    });
  });

  it("falls back to the request-id header when the body is not canonical", async () => {
    const client = createOpenMeldApiClient({
      baseUrl: "https://gateway.openmeld.invalid",
      transport: vi.fn(() =>
        Promise.resolve(
          new Response("upstream exploded", {
            status: 502,
            headers: {
              "x-openmeld-request-id": "req-header-only",
            },
          })
        )
      ),
    });

    await expect(
      client.requestText({
        url: "/v1/spaces/missing/status",
        operation: "space.status.read",
      })
    ).rejects.toMatchObject({
      code: "gateway.http_error",
      message: "upstream exploded",
      requestId: "req-header-only",
      status: 502,
    });
  });

  it("projects api-client HTTP failures into a structured failure surface", () => {
    const failure = toStructuredApiClientFailure(
      new OpenMeldApiClientHttpError({
        code: "space.not_found",
        message: "Space not found.",
        requestId: "req-surface",
        status: 404,
        rawBody: '{"ok":false}',
        upstreamCode: "controller.binding.lookup_failed",
      })
    );

    expect(failure).toEqual({
      code: "space.not_found",
      message: "Space not found.",
      requestId: "req-surface",
      status: 404,
      upstreamCode: "controller.binding.lookup_failed",
    });
  });

  it("keeps an already structured api-client failure readable", () => {
    const failure = {
      code: "space.not_found" as const,
      message: "Space not found.",
      requestId: "req-structured",
      status: 404,
      upstreamCode: "controller.binding.lookup_failed",
    };

    expect(toStructuredApiClientFailure(failure)).toEqual(failure);
  });

  it("preserves generic network failure codes in the structured failure surface", () => {
    const error = Object.assign(
      new Error(
        "space.status.read request could not reach http://localhost:8080 (fetch failed)"
      ),
      {
        code: "network.request_failed",
      }
    );

    expect(toStructuredApiClientFailure(error)).toEqual({
      code: "network.request_failed",
      message:
        "space.status.read request could not reach http://localhost:8080 (fetch failed)",
      requestId: null,
      status: null,
      upstreamCode: null,
    });
  });

  it("drops unknown generic failure codes from the structured failure surface", () => {
    const error = Object.assign(new Error("unexpected failure"), {
      code: "unknown.code",
    });

    expect(toStructuredApiClientFailure(error)).toEqual({
      code: null,
      message: "unexpected failure",
      requestId: null,
      status: null,
      upstreamCode: null,
    });
  });

  it("drops blank generic failure codes from the structured failure surface", () => {
    const error = Object.assign(new Error("unexpected failure"), {
      code: "   ",
    });

    expect(toStructuredApiClientFailure(error)).toEqual({
      code: null,
      message: "unexpected failure",
      requestId: null,
      status: null,
      upstreamCode: null,
    });
  });

  it("uses only explicit timeout configuration in the fetch transport", async () => {
    vi.spyOn(AbortSignal, "timeout").mockImplementation(() => {
      const controller = new AbortController();
      queueMicrotask(() => {
        controller.abort(new DOMException("timed out", "TimeoutError"));
      });
      return controller.signal;
    });

    const transport = createFetchTransport({
      fetch: vi.fn((_input, init) => {
        return new Promise<Response>((_resolve, reject) => {
          queueMicrotask(() => {
            reject(
              init?.signal?.reason ?? new DOMException("aborted", "AbortError")
            );
          });
        });
      }) as typeof globalThis.fetch,
      defaultTimeoutMs: 5,
    });

    await expect(
      transport({
        url: "https://gateway.openmeld.invalid/v1/spaces/space-123/status",
        operation: "space.status.read",
      })
    ).rejects.toMatchObject({
      code: "network.timeout",
      message: "space.status.read request timed out after 5ms",
    });
  });

  it.each([
    "timeout",
    "caller",
  ] as const)("keeps %s cancellation active after headers while the body is incomplete", async (source) => {
    const caller = new AbortController();
    const deadline = new AbortController();
    const timeoutSpy = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(deadline.signal);
    try {
      const transport = createFetchTransport({
        fetch: (async (_url, init) =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode('{"partial":'));
                init?.signal?.addEventListener(
                  "abort",
                  () => controller.error(init.signal?.reason),
                  { once: true }
                );
              },
            })
          )) as typeof fetch,
      });
      const response = await transport({
        url: "https://gateway.openmeld.invalid/v1/spaces/space-123/status",
        operation: "space.status.read",
        init: { signal: caller.signal },
        timeoutMs: 15_000,
      });
      const body = response.json();
      const rejection = expect(body).rejects.toMatchObject({
        name: "AbortError",
      });
      (source === "timeout" ? deadline : caller).abort();
      await rejection;
    } finally {
      timeoutSpy.mockRestore();
    }
  });

  it("annotates non-timeout network failures with the request target", async () => {
    const transport = createFetchTransport({
      fetch: vi.fn(() =>
        Promise.reject(new TypeError("fetch failed"))
      ) as typeof globalThis.fetch,
    });

    await expect(
      transport({
        url: "http://localhost:8080/v1/spaces/space-123/status",
        operation: "space.status.read",
      })
    ).rejects.toMatchObject({
      code: "network.request_failed",
      message:
        "space.status.read request could not reach http://localhost:8080 (fetch failed)",
    });
  });

  it("keeps non-transport errors unchanged", async () => {
    const networkError = new Error("socket closed");

    await expect(
      createFetchTransport({
        fetch: vi.fn(() =>
          Promise.reject(networkError)
        ) as typeof globalThis.fetch,
      })({
        url: "http://localhost:8080/v1/spaces/space-123/status",
        operation: "space.status.read",
      })
    ).rejects.toBe(networkError);
  });
});
