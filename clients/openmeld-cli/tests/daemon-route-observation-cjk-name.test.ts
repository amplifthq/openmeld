import { decodeOpenMeldHeaderText } from "@openmeld/gateway-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchDaemonRouteObservation } from "../src/config/daemon-route-observation-api";

vi.mock("../src/config/auth-session", () => ({
  getAuthSessionState: vi.fn(async () => ({
    state: "missing",
    session: null,
  })),
}));

const AGENT_PROFILE_ID = "agt_11111111-1111-4111-8111-111111111111";

const ROUTE_OBSERVATION_RESPONSE = {
  observedAt: "2026-06-12T00:00:00.000Z",
  profileId: AGENT_PROFILE_ID,
  route: {
    online: false,
    reasonCode: "daemon.profile.offline",
  },
} as const;

// Production regression (CLI 0.7.61): a CJK profile name placed raw into
// x-openmeld-profile-name made undici throw "Cannot convert argument to a
// ByteString" before daemon.route_observation ever left the machine.
describe("daemon route observation with a CJK profile name", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reaches the gateway with ByteString-safe headers that decode back", async () => {
    const seenRequests: Request[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        // Real undici header validation — the production crash site. With a
        // raw CJK header value this constructor throws the ByteString error.
        const request = new Request(input, init);
        seenRequests.push(request);
        return Promise.resolve(
          new Response(JSON.stringify(ROUTE_OBSERVATION_RESPONSE), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
        );
      })
    );

    const result = await fetchDaemonRouteObservation({
      requestContext: {
        actorContext: {
          requestId: "req-cjk-route-1",
          openMeldProfileId: AGENT_PROFILE_ID,
          profileKind: "agent",
          profileName: "Codex 执行官",
          ownerUserId: "owner-001",
          ownerName: "Claude 指挥官",
        },
      },
      baseUrl: "https://gateway.testing.example",
      profileId: AGENT_PROFILE_ID,
    });

    expect(result).toEqual(ROUTE_OBSERVATION_RESPONSE);

    const request = seenRequests[0];
    expect(request).toBeDefined();
    expect(new URL(request?.url ?? "").pathname).toBe(
      `/v1/daemon/routes/${AGENT_PROFILE_ID}`
    );

    const wireProfileName = request?.headers.get("x-openmeld-profile-name");
    expect(wireProfileName).toBe("utf-8''Codex%20%E6%89%A7%E8%A1%8C%E5%AE%98");
    expect(decodeOpenMeldHeaderText(wireProfileName ?? "")).toBe(
      "Codex 执行官"
    );

    const wireOwnerName = request?.headers.get("x-openmeld-owner-name");
    expect(decodeOpenMeldHeaderText(wireOwnerName ?? "")).toBe("Claude 指挥官");
  });
});
