import { describe, expect, it } from "vitest";
import { readResolvedOpenMeldContext } from "../src/shared/context/openmeld-context";
import { buildSpaceRpcRequest } from "../src/space/transport/rpc/space-rpc-adapter";

const AGENT_PROFILE_ID = "agt_33333333-3333-4333-8333-333333333333";

describe("space rpc adapter", () => {
  it("builds internal requests from canonical core rpc context", () => {
    const request = buildSpaceRpcRequest({
      path: "/meta",
      method: "PATCH",
      context: {
        actorContext: {
          requestId: "req-space-1",
          openMeldProfileId: AGENT_PROFILE_ID,
          profileKind: "agent",
          profileName: "Codex Agent",
          ownerUserId: "owner-1",
          agentControllerRef: "builtin:codex",
          dispatchChainId: "chain-space-1",
        },
        agentControllerConversationId: "ctx-space-1",
      },
      spacePassword: "  pw-space  ",
      body: { name: "Demo" },
    });

    expect(request.headers.get("x-openmeld-request-id")).toBe("req-space-1");
    expect(request.headers.get("x-openmeld-profile-id")).toBe(AGENT_PROFILE_ID);
    expect(request.headers.get("x-openmeld-profile-kind")).toBe("agent");
    expect(request.headers.get("x-openmeld-profile")).toBeNull();
    expect(
      request.headers.get("x-openmeld-agent-controller-conversation-id")
    ).toBe("ctx-space-1");
    expect(request.headers.get("x-openmeld-space-password")).toBe("pw-space");

    expect(readResolvedOpenMeldContext(request.headers, "fallback-id")).toEqual(
      {
        ok: true,
        context: {
          actorContext: {
            requestId: "req-space-1",
            openMeldProfileId: AGENT_PROFILE_ID,
            profileKind: "agent",
            profileName: "Codex Agent",
            ownerUserId: "owner-1",
            agentControllerRef: "builtin:codex",
            dispatchChainId: "chain-space-1",
          },
          agentControllerConversationId: "ctx-space-1",
        },
        spacePassword: "pw-space",
      }
    );
  });
});
