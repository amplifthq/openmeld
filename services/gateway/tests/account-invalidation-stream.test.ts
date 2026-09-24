import { OPENMELD_HEADER_REQUESTED_ORGANIZATION_ID } from "@openmeld/gateway-contract";
import { describe, expect, it, vi } from "vitest";
import app from "../src/index";

const executionContext = {
  waitUntil: () => undefined,
  passThroughOnException: () => undefined,
  props: {},
  exports: {},
} as unknown as ExecutionContext;

type AcceptedWebSocket = WebSocket & { accept(): void };

describe("account invalidation stream", () => {
  it("authenticates the requested Organization and forwards only refresh hints", async () => {
    const auth = vi.fn(async () => ({
      ok: true as const,
      claims: {
        authenticated: true as const,
        requestId: "req-account-stream",
        callerPrincipalId: "user-1",
        activeOrganizationId: "org-1",
        organizationContextSource: "request" as const,
        profileId: "11111111-1111-4111-8111-111111111111",
        profileKind: "human" as const,
        ownerIds: ["user-1"],
        authMethod: "session" as const,
      },
      profile: {
        ok: true as const,
        resolvedProfile: {
          openMeldProfileId: "11111111-1111-4111-8111-111111111111",
          profileName: "Mira",
          profileKind: "human" as const,
          ownerUserId: "user-1",
        },
      },
    }));
    // biome-ignore lint/correctness/noUndeclaredVariables: Provided by the Workers test runtime.
    const pair = new WebSocketPair();
    const upstreamClient = pair[0];
    const upstreamServer = pair[1];
    upstreamServer.accept();
    const coreFetch = vi.fn(
      async (_request: Request) =>
        new Response(null, { status: 101, webSocket: upstreamClient })
    );
    const env = {
      OPENMELD_AUTH_WORKER: { resolveRequestAuthWithProfile: auth },
      OPENMELD_CORE_WORKER: { fetch: coreFetch },
    } as unknown as CloudflareBindings;
    const response = await app.fetch(
      new Request(
        "http://local/v1/account/invalidation-stream?organizationId=org-1",
        { headers: { Upgrade: "websocket" } }
      ),
      env,
      executionContext
    );
    expect(response.status).toBe(101);
    expect(auth).toHaveBeenCalledWith(
      expect.objectContaining({
        requestedOrganization: { organizationId: "org-1" },
      })
    );
    const upstreamRequest = coreFetch.mock.calls[0]?.[0];
    expect(upstreamRequest?.headers.get("x-openmeld-owner-user-id")).toBe(
      "user-1"
    );
    const client = response.webSocket as AcceptedWebSocket;
    client.accept();
    const received = new Promise<string>((resolve) => {
      client.addEventListener(
        "message",
        (event) => resolve(String(event.data)),
        {
          once: true,
        }
      );
    });
    upstreamServer.send(JSON.stringify({ type: "space_index.changed" }));
    expect(await received).toBe('{"type":"space_index.changed"}');
    client.close();
  });

  it("rejects conflicting Organization selectors before opening a socket", async () => {
    const auth = vi.fn();
    const response = await app.fetch(
      new Request(
        "http://local/v1/account/invalidation-stream?organizationId=org-1",
        {
          headers: {
            Upgrade: "websocket",
            [OPENMELD_HEADER_REQUESTED_ORGANIZATION_ID]: "org-2",
          },
        }
      ),
      {
        OPENMELD_AUTH_WORKER: { resolveRequestAuthWithProfile: auth },
        OPENMELD_CORE_WORKER: { fetch: vi.fn() },
      } as unknown as CloudflareBindings,
      executionContext
    );
    expect(response.status).toBe(400);
    expect(auth).not.toHaveBeenCalled();
  });
});
