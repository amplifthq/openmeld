import type { OpenMeldRequestContext } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
  applyOpenMeldRequestContextHeaders,
  buildOpenMeldRequestContextHeaders,
  decodeOpenMeldHeaderText,
  OPENMELD_EXPECTED_FORWARDED_BY,
  OPENMELD_HEADER_ACTIVE_ORGANIZATION_ID,
  OPENMELD_HEADER_AGENT_CONTROLLER_CONVERSATION_ID,
  OPENMELD_HEADER_AGENT_CONTROLLER_REF,
  OPENMELD_HEADER_AUTO_RELAY_DEPTH,
  OPENMELD_HEADER_CALLER_PRINCIPAL_ID,
  OPENMELD_HEADER_DISPATCH_CHAIN_ID,
  OPENMELD_HEADER_FORWARDED_BY,
  OPENMELD_HEADER_OWNER_NAME,
  OPENMELD_HEADER_OWNER_USER_ID,
  OPENMELD_HEADER_PROFILE_HANDLE,
  OPENMELD_HEADER_PROFILE_ID,
  OPENMELD_HEADER_PROFILE_KIND,
  OPENMELD_HEADER_PROFILE_NAME,
  OPENMELD_HEADER_REQUEST_ID,
  OPENMELD_HEADER_REQUESTED_ORGANIZATION_ID,
  OPENMELD_HEADER_REQUESTED_ORGANIZATION_SLUG,
  OPENMELD_HEADER_SPACE_PASSWORD,
  OPENMELD_HEADER_VISITED_PROFILE_IDS,
  OPENMELD_HEADER_VISITED_PROFILE_IDS_HASH,
  readOpenMeldRequestContext,
  readOpenMeldRequestedOrganizationSelector,
} from "../src";

const PRINTABLE_ASCII_PATTERN = /^[\x20-\x7e]*$/;

describe("gateway-contract headers", () => {
  it("reads the untrusted Organization selector without treating it as request context", () => {
    const headers = new Headers({
      [OPENMELD_HEADER_REQUESTED_ORGANIZATION_SLUG]: "amplift",
    });

    expect(readOpenMeldRequestedOrganizationSelector(headers)).toEqual({
      organizationSlug: "amplift",
    });
    expect(readOpenMeldRequestContext(headers, "req-selector")).toBeNull();
  });

  it("rejects two Organization selector headers instead of choosing one", () => {
    const headers = new Headers({
      [OPENMELD_HEADER_REQUESTED_ORGANIZATION_ID]: "org-1",
      [OPENMELD_HEADER_REQUESTED_ORGANIZATION_SLUG]: "amplift",
    });

    expect(() => readOpenMeldRequestedOrganizationSelector(headers)).toThrow();
  });

  it("builds canonical OpenMeld request context headers", () => {
    const headers = buildOpenMeldRequestContextHeaders({
      requestContext: {
        actorContext: {
          requestId: "req-123",
          callerPrincipalId: "auth-user-123",
          openMeldProfileId: "profile-001",
          profileKind: "agent",
          profileHandle: "mira-agent",
          profileName: "Mira",
          ownerUserId: "owner-001",
          ownerName: "Felix",
          agentControllerRef: "builtin:codex",
          dispatchChainId: "dispatch-123",
          autoRelayDepth: 2,
          visitedProfileIds: ["agt-1", "agt-2"],
          visitedProfileIdsHash: "stable32:1234abcd",
        },
        activeOrganizationId: "org-123",
        agentControllerConversationId: "thread-ctx-7",
      },
      spacePassword: "  p@ss  ",
    });

    expect(headers[OPENMELD_HEADER_REQUEST_ID]).toBe("req-123");
    expect(headers[OPENMELD_HEADER_CALLER_PRINCIPAL_ID]).toBe("auth-user-123");
    expect(headers[OPENMELD_HEADER_PROFILE_ID]).toBe("profile-001");
    expect(headers[OPENMELD_HEADER_PROFILE_KIND]).toBe("agent");
    expect(headers[OPENMELD_HEADER_PROFILE_HANDLE]).toBe("mira-agent");
    expect(headers[OPENMELD_HEADER_PROFILE_NAME]).toBe("Mira");
    expect(headers[OPENMELD_HEADER_OWNER_USER_ID]).toBe("owner-001");
    expect(headers[OPENMELD_HEADER_OWNER_NAME]).toBe("Felix");
    expect(headers[OPENMELD_HEADER_AGENT_CONTROLLER_REF]).toBe("builtin:codex");
    expect(headers[OPENMELD_HEADER_AGENT_CONTROLLER_CONVERSATION_ID]).toBe(
      "thread-ctx-7"
    );
    expect(headers[OPENMELD_HEADER_ACTIVE_ORGANIZATION_ID]).toBe("org-123");
    expect(headers[OPENMELD_HEADER_DISPATCH_CHAIN_ID]).toBe("dispatch-123");
    expect(headers[OPENMELD_HEADER_AUTO_RELAY_DEPTH]).toBe("2");
    expect(headers[OPENMELD_HEADER_VISITED_PROFILE_IDS]).toBe("agt-1,agt-2");
    expect(headers[OPENMELD_HEADER_VISITED_PROFILE_IDS_HASH]).toBe(
      "stable32:1234abcd"
    );
    expect(headers[OPENMELD_HEADER_SPACE_PASSWORD]).toBe("p@ss");
    expect(headers["x-openmeld-profile"]).toBeUndefined();
  });

  it("reads and re-applies canonical request context headers", () => {
    const requestContext: OpenMeldRequestContext = {
      actorContext: {
        requestId: "req-321",
        callerPrincipalId: "auth-user-321",
        openMeldProfileId: "agt_22222222-2222-4222-8222-222222222222",
        profileKind: "human",
        profileHandle: "theo",
        profileName: "Theo",
        ownerUserId: "owner-002",
        ownerName: "Theo Owner",
        agentControllerRef: "builtin:claude-code",
        dispatchChainId: "dispatch-456",
        autoRelayDepth: 3,
        visitedProfileIds: [
          "agt_11111111-1111-4111-8111-111111111111",
          "agt_22222222-2222-4222-8222-222222222222",
        ],
        visitedProfileIdsHash: "stable32:5678efgh",
      },
      activeOrganizationId: "org-321",
      agentControllerConversationId: "thread-ctx-8",
    };

    const forwarded = applyOpenMeldRequestContextHeaders(
      new Headers(),
      { requestContext },
      OPENMELD_EXPECTED_FORWARDED_BY
    );

    expect(readOpenMeldRequestContext(forwarded, "fallback-id")).toEqual(
      requestContext
    );
    expect(forwarded.get(OPENMELD_HEADER_REQUEST_ID)).toBe("req-321");
    expect(forwarded.get(OPENMELD_HEADER_CALLER_PRINCIPAL_ID)).toBe(
      "auth-user-321"
    );
    expect(forwarded.get(OPENMELD_HEADER_PROFILE_KIND)).toBe("human");
    expect(forwarded.get(OPENMELD_HEADER_PROFILE_HANDLE)).toBe("theo");
    expect(forwarded.get(OPENMELD_HEADER_OWNER_USER_ID)).toBe("owner-002");
    expect(forwarded.get(OPENMELD_HEADER_OWNER_NAME)).toBe("Theo Owner");
    expect(forwarded.get(OPENMELD_HEADER_AGENT_CONTROLLER_REF)).toBe(
      "builtin:claude-code"
    );
    expect(
      forwarded.get(OPENMELD_HEADER_AGENT_CONTROLLER_CONVERSATION_ID)
    ).toBe("thread-ctx-8");
    expect(forwarded.get(OPENMELD_HEADER_ACTIVE_ORGANIZATION_ID)).toBe(
      "org-321"
    );
    expect(forwarded.get(OPENMELD_HEADER_DISPATCH_CHAIN_ID)).toBe(
      "dispatch-456"
    );
    expect(forwarded.get(OPENMELD_HEADER_AUTO_RELAY_DEPTH)).toBe("3");
    expect(forwarded.get(OPENMELD_HEADER_VISITED_PROFILE_IDS)).toBe(
      "agt_11111111-1111-4111-8111-111111111111,agt_22222222-2222-4222-8222-222222222222"
    );
    expect(forwarded.get(OPENMELD_HEADER_VISITED_PROFILE_IDS_HASH)).toBe(
      "stable32:5678efgh"
    );
    expect(forwarded.get(OPENMELD_HEADER_FORWARDED_BY)).toBe(
      OPENMELD_EXPECTED_FORWARDED_BY
    );
    expect(forwarded.get("x-openmeld-profile")).toBeNull();
  });

  it("drops invalid relay depth and blank optional fields", () => {
    const headers = buildOpenMeldRequestContextHeaders({
      requestContext: {
        actorContext: {
          requestId: "req-555",
          openMeldProfileId: "profile-555",
          profileKind: "agent",
          ownerUserId: "   ",
          ownerName: "   ",
          agentControllerRef: "   ",
          autoRelayDepth: -1,
          visitedProfileIds: ["   ", "  "],
          visitedProfileIdsHash: "   ",
        },
        agentControllerConversationId: "   ",
      },
    });

    expect(headers[OPENMELD_HEADER_REQUEST_ID]).toBe("req-555");
    expect(headers[OPENMELD_HEADER_OWNER_USER_ID]).toBeUndefined();
    expect(headers[OPENMELD_HEADER_OWNER_NAME]).toBeUndefined();
    expect(headers[OPENMELD_HEADER_AGENT_CONTROLLER_REF]).toBeUndefined();
    expect(
      headers[OPENMELD_HEADER_AGENT_CONTROLLER_CONVERSATION_ID]
    ).toBeUndefined();
    expect(headers[OPENMELD_HEADER_AUTO_RELAY_DEPTH]).toBeUndefined();
    expect(headers[OPENMELD_HEADER_VISITED_PROFILE_IDS]).toBeUndefined();
    expect(headers[OPENMELD_HEADER_VISITED_PROFILE_IDS_HASH]).toBeUndefined();
  });

  it("does not set space password header when empty after normalization", () => {
    const headers = buildOpenMeldRequestContextHeaders({
      requestContext: {
        actorContext: {
          requestId: "req-666",
          openMeldProfileId: "profile-666",
          profileKind: "human",
        },
      },
      spacePassword: "   ",
    });

    expect(headers[OPENMELD_HEADER_REQUEST_ID]).toBe("req-666");
    expect(headers[OPENMELD_HEADER_SPACE_PASSWORD]).toBeUndefined();
  });

  it("removes stale managed headers before applying the canonical request context", () => {
    const target = new Headers({
      authorization: "Bearer local-test-token",
      [OPENMELD_HEADER_REQUEST_ID]: "stale-request",
      [OPENMELD_HEADER_PROFILE_ID]: "stale-profile",
      [OPENMELD_HEADER_PROFILE_KIND]: "agent",
      [OPENMELD_HEADER_ACTIVE_ORGANIZATION_ID]: "stale-org",
      [OPENMELD_HEADER_REQUESTED_ORGANIZATION_ID]: "untrusted-org",
      [OPENMELD_HEADER_REQUESTED_ORGANIZATION_SLUG]: "untrusted-slug",
      [OPENMELD_HEADER_SPACE_PASSWORD]: "   ",
      [OPENMELD_HEADER_FORWARDED_BY]: "stale-hop",
    });

    const headers = applyOpenMeldRequestContextHeaders(target, {
      requestContext: {
        actorContext: {
          requestId: "req-777",
          openMeldProfileId: "profile-777",
          profileKind: "human",
        },
      },
      spacePassword: "   ",
    });

    expect(headers.get("authorization")).toBe("Bearer local-test-token");
    expect(headers.get(OPENMELD_HEADER_REQUEST_ID)).toBe("req-777");
    expect(headers.get(OPENMELD_HEADER_PROFILE_ID)).toBe("profile-777");
    expect(headers.get(OPENMELD_HEADER_PROFILE_KIND)).toBe("human");
    expect(headers.get(OPENMELD_HEADER_ACTIVE_ORGANIZATION_ID)).toBeNull();
    expect(headers.get(OPENMELD_HEADER_REQUESTED_ORGANIZATION_ID)).toBeNull();
    expect(headers.get(OPENMELD_HEADER_REQUESTED_ORGANIZATION_SLUG)).toBeNull();
    expect(headers.get(OPENMELD_HEADER_SPACE_PASSWORD)).toBeNull();
    expect(headers.get(OPENMELD_HEADER_FORWARDED_BY)).toBe(
      OPENMELD_EXPECTED_FORWARDED_BY
    );
  });

  it("rejects canonical request context when mandatory fields are missing", () => {
    const headers = new Headers({
      [OPENMELD_HEADER_REQUEST_ID]: "req-incomplete",
      [OPENMELD_HEADER_PROFILE_KIND]: "agent",
    });

    expect(readOpenMeldRequestContext(headers, "fallback-id")).toBeNull();
  });

  it("carries non-Latin-1 profile text as ByteString-safe header values", () => {
    const requestContext: OpenMeldRequestContext = {
      actorContext: {
        requestId: "req-cjk-1",
        openMeldProfileId: "agt_33333333-3333-4333-8333-333333333333",
        profileKind: "agent",
        profileName: "Codex 执行官",
        ownerUserId: "owner-003",
        ownerName: "Claude 指挥官",
      },
    };

    const built = buildOpenMeldRequestContextHeaders({ requestContext });

    // The production failure mode: undici and workerd reject header values
    // with code points above 0xff. Constructing Headers runs that validation.
    const fetchHeaders = new Headers(built);
    expect(fetchHeaders.get(OPENMELD_HEADER_PROFILE_NAME)).toBe(
      "utf-8''Codex%20%E6%89%A7%E8%A1%8C%E5%AE%98"
    );
    for (const value of Object.values(built)) {
      expect(value).toMatch(PRINTABLE_ASCII_PATTERN);
    }

    const forwarded = applyOpenMeldRequestContextHeaders(new Headers(), {
      requestContext,
    });
    expect(readOpenMeldRequestContext(forwarded, "fallback-id")).toEqual(
      requestContext
    );
  });

  it("keeps printable-ascii header values byte-identical on the wire", () => {
    const built = buildOpenMeldRequestContextHeaders({
      requestContext: {
        actorContext: {
          requestId: "req-ascii-1",
          openMeldProfileId: "agt_44444444-4444-4444-8444-444444444444",
          profileKind: "agent",
          profileName: "Codex Executor",
          ownerUserId: "owner-004",
        },
      },
      spacePassword: "hunter2",
    });

    expect(built[OPENMELD_HEADER_PROFILE_NAME]).toBe("Codex Executor");
    expect(built[OPENMELD_HEADER_SPACE_PASSWORD]).toBe("hunter2");
  });

  it("round-trips profile text that begins with the encoding marker", () => {
    const requestContext: OpenMeldRequestContext = {
      actorContext: {
        requestId: "req-marker-1",
        openMeldProfileId: "agt_55555555-5555-4555-8555-555555555555",
        profileKind: "agent",
        profileName: "utf-8''not-actually-encoded",
        ownerUserId: "owner-005",
      },
    };

    const forwarded = applyOpenMeldRequestContextHeaders(new Headers(), {
      requestContext,
    });

    expect(readOpenMeldRequestContext(forwarded, "fallback-id")).toEqual(
      requestContext
    );
  });

  it("decodes a maximum-length CJK profile name despite the raw cap", () => {
    const profileName = "执".repeat(64);
    const requestContext: OpenMeldRequestContext = {
      actorContext: {
        requestId: "req-long-cjk-1",
        openMeldProfileId: "agt_66666666-6666-4666-8666-666666666666",
        profileKind: "agent",
        profileName,
        ownerUserId: "owner-006",
      },
    };

    const forwarded = applyOpenMeldRequestContextHeaders(new Headers(), {
      requestContext,
    });

    expect(
      readOpenMeldRequestContext(forwarded, "fallback-id")?.actorContext
        .profileName
    ).toBe(profileName);
  });

  it("falls back to the raw value when an encoded header is malformed", () => {
    const headers = new Headers({
      [OPENMELD_HEADER_REQUEST_ID]: "req-malformed-1",
      [OPENMELD_HEADER_PROFILE_ID]: "agt_77777777-7777-4777-8777-777777777777",
      [OPENMELD_HEADER_PROFILE_KIND]: "agent",
      [OPENMELD_HEADER_PROFILE_NAME]: "utf-8''%E6%89",
    });

    expect(
      readOpenMeldRequestContext(headers, "fallback-id")?.actorContext
        .profileName
    ).toBe("utf-8''%E6%89");
  });

  it("encodes and decodes non-Latin-1 space passwords", () => {
    const built = buildOpenMeldRequestContextHeaders({
      requestContext: {
        actorContext: {
          requestId: "req-pw-1",
          openMeldProfileId: "agt_88888888-8888-4888-8888-888888888888",
          profileKind: "agent",
        },
      },
      spacePassword: "执行官密码",
    });

    const wireValue = built[OPENMELD_HEADER_SPACE_PASSWORD];
    expect(wireValue).toBe(
      "utf-8''%E6%89%A7%E8%A1%8C%E5%AE%98%E5%AF%86%E7%A0%81"
    );
    expect(new Headers(built).get(OPENMELD_HEADER_SPACE_PASSWORD)).toBe(
      wireValue
    );
    expect(decodeOpenMeldHeaderText(wireValue ?? "")).toBe("执行官密码");
  });

  it("round-trips a relay chain that visited more than three profiles", () => {
    // Four agt_<uuid> entries join to 163 chars — past the generic 128-char
    // header cap that used to truncate the list mid-id and null the context.
    const visitedProfileIds = Array.from(
      { length: 8 },
      (_, index) =>
        `agt_${String(index + 1).repeat(8)}-1111-4111-8111-111111111111`
    );
    const requestContext: OpenMeldRequestContext = {
      actorContext: {
        requestId: "req-relay-chain-1",
        openMeldProfileId: "agt_99999999-9999-4999-8999-999999999999",
        profileKind: "agent",
        ownerUserId: "owner-relay-1",
        dispatchChainId: "dispatch-relay-1",
        autoRelayDepth: 8,
        visitedProfileIds,
        visitedProfileIdsHash: "stable32:00c0ffee",
      },
    };

    const forwarded = applyOpenMeldRequestContextHeaders(new Headers(), {
      requestContext,
    });

    expect(readOpenMeldRequestContext(forwarded, "fallback-id")).toEqual(
      requestContext
    );
  });

  it("round-trips the schema-maximum visited profile list", () => {
    const visitedProfileIds = Array.from({ length: 256 }, (_, index) => {
      const suffix = index.toString(16).padStart(12, "0");
      return `agt_aaaaaaaa-aaaa-4aaa-8aaa-${suffix}`;
    });
    const requestContext: OpenMeldRequestContext = {
      actorContext: {
        requestId: "req-relay-chain-max",
        openMeldProfileId: "agt_99999999-9999-4999-8999-999999999999",
        profileKind: "agent",
        ownerUserId: "owner-relay-2",
        visitedProfileIds,
      },
    };

    const forwarded = applyOpenMeldRequestContextHeaders(new Headers(), {
      requestContext,
    });

    expect(readOpenMeldRequestContext(forwarded, "fallback-id")).toEqual(
      requestContext
    );
  });

  it("fails closed when the visited profile list exceeds the schema maximum", () => {
    // 257 entries overflow visitedProfileIdsSchema's max(256). The context
    // parse rejects the whole request instead of silently truncating a list
    // that exists to detect dispatch cycles.
    const visitedProfileIds = Array.from({ length: 257 }, (_, index) => {
      const suffix = index.toString(16).padStart(12, "0");
      return `agt_bbbbbbbb-bbbb-4bbb-8bbb-${suffix}`;
    });
    const requestContext: OpenMeldRequestContext = {
      actorContext: {
        requestId: "req-relay-chain-overflow",
        openMeldProfileId: "agt_99999999-9999-4999-8999-999999999999",
        profileKind: "agent",
        visitedProfileIds,
      },
    };

    const forwarded = applyOpenMeldRequestContextHeaders(new Headers(), {
      requestContext,
    });

    expect(readOpenMeldRequestContext(forwarded, "fallback-id")).toBeNull();
  });
});
