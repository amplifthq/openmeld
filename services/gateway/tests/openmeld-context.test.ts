import type { Context } from "hono";
import { describe, expect, it } from "vitest";
import type { GatewayResolvedProfile } from "../src/lib/auth-rpc-client";
import type { HonoBindings } from "../src/lib/bindings";
import {
  buildGatewayActorContext,
  buildOpenMeldRequestContext,
} from "../src/lib/openmeld-context";
import { buildCoreRpcContext } from "../src/routes/rpc-http.helpers";

const AGENT_PROFILE_ID = "agt_33333333-3333-4333-8333-333333333333";

const RESOLVED_PROFILE: GatewayResolvedProfile = {
  openMeldProfileId: AGENT_PROFILE_ID,
  profileHandle: "codex-agent",
  profileName: "Codex Agent",
  profileKind: "agent",
  ownerUserId: "owner-1",
  ownerName: "Felix",
  agentControllerRef: "builtin:codex",
};

describe("gateway openmeld context adapters", () => {
  it("builds shared actor context before transport compatibility fields", () => {
    const result = buildGatewayActorContext({
      callerPrincipalId: "auth-user-1",
      ingressContext: {
        requestId: "req-legacy",
        agentControllerConversationId: "ctx-1",
        dispatchChainId: "chain-1",
        autoRelayDepth: 2,
        visitedProfileIds: [AGENT_PROFILE_ID],
        visitedProfileIdsHash: "stable32:abc123",
      },
      requestId: "req-1",
      resolvedProfile: RESOLVED_PROFILE,
    });

    expect(result).toEqual({
      requestId: "req-1",
      callerPrincipalId: "auth-user-1",
      openMeldProfileId: AGENT_PROFILE_ID,
      profileKind: "agent",
      profileHandle: "codex-agent",
      profileName: "Codex Agent",
      ownerUserId: "owner-1",
      ownerName: "Felix",
      agentControllerRef: "builtin:codex",
      dispatchChainId: "chain-1",
      autoRelayDepth: 2,
      visitedProfileIds: [AGENT_PROFILE_ID],
      visitedProfileIdsHash: "stable32:abc123",
    });
    expect((result as Record<string, unknown>).profileId).toBeUndefined();
    expect((result as Record<string, unknown>).profile).toBeUndefined();
    expect(
      (result as Record<string, unknown>).agentControllerConversationId
    ).toBeUndefined();
  });

  it("drops invalid transport-only relay metadata before returning canonical actor context", () => {
    const result = buildGatewayActorContext({
      ingressContext: {
        requestId: "req-legacy",
        dispatchChainId: "chain-1",
        visitedProfileIds: ["agt-invalid"],
        visitedProfileIdsHash: "stable32:dropme",
      },
      requestId: "req-1",
      resolvedProfile: RESOLVED_PROFILE,
    });

    expect(result).toEqual({
      requestId: "req-1",
      openMeldProfileId: AGENT_PROFILE_ID,
      profileKind: "agent",
      profileHandle: "codex-agent",
      profileName: "Codex Agent",
      ownerUserId: "owner-1",
      ownerName: "Felix",
      agentControllerRef: "builtin:codex",
      dispatchChainId: "chain-1",
    });
    expect(result.visitedProfileIds).toBeUndefined();
    expect(result.visitedProfileIdsHash).toBeUndefined();
  });

  it("builds canonical request context with transport companion split out", () => {
    const result = buildOpenMeldRequestContext({
      callerPrincipalId: "auth-user-2",
      ingressContext: {
        requestId: "req-legacy",
        agentControllerConversationId: "ctx-2",
        dispatchChainId: "chain-2",
        autoRelayDepth: 1,
      },
      requestId: "req-2",
      resolvedProfile: RESOLVED_PROFILE,
    });

    expect(result).toEqual({
      actorContext: {
        requestId: "req-2",
        callerPrincipalId: "auth-user-2",
        openMeldProfileId: AGENT_PROFILE_ID,
        profileKind: "agent",
        profileHandle: "codex-agent",
        profileName: "Codex Agent",
        ownerUserId: "owner-1",
        ownerName: "Felix",
        agentControllerRef: "builtin:codex",
        dispatchChainId: "chain-2",
        autoRelayDepth: 1,
      },
      agentControllerConversationId: "ctx-2",
    });
  });

  it("builds core rpc context through the explicit gateway adapter", () => {
    const openMeldRequestContext = buildOpenMeldRequestContext({
      ingressContext: {
        requestId: "req-legacy",
        agentControllerConversationId: "ctx-2",
        dispatchChainId: "chain-2",
        autoRelayDepth: 1,
      },
      requestId: "req-2",
      resolvedProfile: RESOLVED_PROFILE,
    });

    const c = {
      var: {
        openMeldRequestContext,
      },
    } as Context<HonoBindings>;

    expect(buildCoreRpcContext(c)).toEqual(openMeldRequestContext);
  });
});
