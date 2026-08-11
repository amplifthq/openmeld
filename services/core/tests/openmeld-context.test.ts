import {
  applyOpenMeldRequestContextHeaders,
  OPENMELD_EXPECTED_FORWARDED_BY,
  OPENMELD_HEADER_FORWARDED_BY,
  OPENMELD_HEADER_SPACE_PASSWORD,
  readOpenMeldRequestContext,
} from "@openmeld/gateway-contract";
import { describe, expect, it } from "vitest";
import {
  applyResolvedOpenMeldContextHeaders,
  readResolvedOpenMeldContext,
  toProtocolProfile,
  toSpaceCreator,
} from "../src/shared/context/openmeld-context";

const AGENT_PROFILE_ID = "agt_11111111-1111-4111-8111-111111111111";
const SECOND_AGENT_PROFILE_ID = "agt_22222222-2222-4222-8222-222222222222";

describe("core openmeld context compatibility", () => {
  it("reads canonical forwarded headers with actor and flow metadata", () => {
    const headers = applyOpenMeldRequestContextHeaders(
      new Headers(),
      {
        requestContext: {
          actorContext: {
            requestId: "req-gateway-1",
            openMeldProfileId: AGENT_PROFILE_ID,
            profileKind: "agent",
            profileHandle: "codex",
            profileName: "Codex Agent",
            ownerUserId: "owner-001",
            ownerName: "Felix",
            agentControllerRef: "builtin:codex",
            dispatchChainId: "chain-123",
            autoRelayDepth: 2,
            visitedProfileIds: [AGENT_PROFILE_ID, SECOND_AGENT_PROFILE_ID],
            visitedProfileIdsHash: "stable32:abc12345",
          },
          activeOrganizationId: "org-core-1",
          agentControllerConversationId: "ctx-123",
        },
        spacePassword: "pw-demo",
      },
      OPENMELD_EXPECTED_FORWARDED_BY
    );

    expect(readResolvedOpenMeldContext(headers, "fallback-id")).toEqual({
      ok: true,
      context: {
        actorContext: {
          requestId: "req-gateway-1",
          openMeldProfileId: AGENT_PROFILE_ID,
          profileKind: "agent",
          profileHandle: "codex",
          profileName: "Codex Agent",
          ownerUserId: "owner-001",
          ownerName: "Felix",
          agentControllerRef: "builtin:codex",
          dispatchChainId: "chain-123",
          autoRelayDepth: 2,
          visitedProfileIds: [AGENT_PROFILE_ID, SECOND_AGENT_PROFILE_ID],
          visitedProfileIdsHash: "stable32:abc12345",
        },
        activeOrganizationId: "org-core-1",
        agentControllerConversationId: "ctx-123",
      },
      spacePassword: "pw-demo",
    });
  });

  it("writes canonical headers that round-trip through shared parser", () => {
    const headers = applyResolvedOpenMeldContextHeaders(new Headers(), {
      context: {
        actorContext: {
          requestId: "req-core-1",
          openMeldProfileId: AGENT_PROFILE_ID,
          profileKind: "agent",
          profileHandle: "claude-code",
          profileName: "Claude Code",
          ownerUserId: "owner-003",
          ownerName: "Mira",
          agentControllerRef: "builtin:claude-code",
          dispatchChainId: "chain-789",
          autoRelayDepth: 4,
          visitedProfileIds: [AGENT_PROFILE_ID, SECOND_AGENT_PROFILE_ID],
          visitedProfileIdsHash: "stable32:def67890",
        },
        activeOrganizationId: "org-core-3",
        agentControllerConversationId: "ctx-789",
      },
      spacePassword: "pw-space",
    });

    expect(headers.get(OPENMELD_HEADER_FORWARDED_BY)).toBe(
      OPENMELD_EXPECTED_FORWARDED_BY
    );
    expect(headers.get(OPENMELD_HEADER_SPACE_PASSWORD)).toBe("pw-space");
    expect(headers.get("x-openmeld-profile")).toBeNull();
    expect(readOpenMeldRequestContext(headers, "fallback-id")).toEqual({
      actorContext: {
        requestId: "req-core-1",
        openMeldProfileId: AGENT_PROFILE_ID,
        profileKind: "agent",
        profileHandle: "claude-code",
        profileName: "Claude Code",
        ownerUserId: "owner-003",
        ownerName: "Mira",
        agentControllerRef: "builtin:claude-code",
        dispatchChainId: "chain-789",
        autoRelayDepth: 4,
        visitedProfileIds: [AGENT_PROFILE_ID, SECOND_AGENT_PROFILE_ID],
        visitedProfileIdsHash: "stable32:def67890",
      },
      activeOrganizationId: "org-core-3",
      agentControllerConversationId: "ctx-789",
    });
  });

  it("round-trips non-Latin-1 profile names and space passwords", () => {
    const context = {
      actorContext: {
        requestId: "req-cjk-1",
        openMeldProfileId: AGENT_PROFILE_ID,
        profileKind: "agent" as const,
        profileName: "Codex 执行官",
        ownerUserId: "owner-007",
        ownerName: "Claude 指挥官",
      },
    };

    const headers = applyResolvedOpenMeldContextHeaders(new Headers(), {
      context,
      spacePassword: "执行官密码",
    });

    expect(headers.get("x-openmeld-profile-name")).toBe(
      "utf-8''Codex%20%E6%89%A7%E8%A1%8C%E5%AE%98"
    );
    expect(readResolvedOpenMeldContext(headers, "fallback-id")).toEqual({
      ok: true,
      context,
      spacePassword: "执行官密码",
    });
  });

  it("rejects non-forwarded requests before reading canonical context", () => {
    const headers = new Headers({
      "x-openmeld-request-id": "req-direct-1",
      "x-openmeld-profile-id": AGENT_PROFILE_ID,
      "x-openmeld-profile-kind": "agent",
    });

    expect(readResolvedOpenMeldContext(headers, "fallback-id")).toEqual({
      ok: false,
      requestId: "req-direct-1",
      message: "authentication required",
    });
  });

  it("derives protocol profile and space creator from canonical request context", () => {
    const context = {
      actorContext: {
        requestId: "req-core-2",
        openMeldProfileId: AGENT_PROFILE_ID,
        profileKind: "agent" as const,
        profileHandle: "claude-code",
        profileName: "Claude Code",
        ownerUserId: "owner-005",
        ownerName: "Mira",
        agentControllerRef: "builtin:claude-code",
      },
      agentControllerConversationId: "ctx-555",
    };

    expect(toProtocolProfile(context)).toEqual({
      kind: "agent",
      profileId: AGENT_PROFILE_ID,
      profileHandle: "claude-code",
      profileName: "Claude Code",
      owner: "owner-005",
      ownerName: "Mira",
      agentControllerRef: "builtin:claude-code",
      agentControllerConversationId: "ctx-555",
    });
    expect(toSpaceCreator(context)).toEqual({
      profileId: AGENT_PROFILE_ID,
      profileName: "Claude Code",
      kind: "agent",
      ownerUserId: "owner-005",
      ownerName: "Mira",
    });
  });
});
