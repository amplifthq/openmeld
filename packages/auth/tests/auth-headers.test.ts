import { describe, expect, it } from "vitest";
import {
  buildAuthClaimsHeaders,
  OPENMELD_AUTH_HEADER_AUTHENTICATED,
  OPENMELD_AUTH_HEADER_CALLER_PRINCIPAL_ID,
  OPENMELD_AUTH_HEADER_METHOD,
  OPENMELD_AUTH_HEADER_PROFILE_ID,
  OPENMELD_AUTH_HEADER_PROFILE_KIND,
  OPENMELD_AUTH_HEADER_REQUEST_ID,
  readAuthClaimsHeaders,
} from "../src/headers/auth-headers";

describe("auth claim headers", () => {
  it("builds and reads authenticated claims", () => {
    const built = buildAuthClaimsHeaders({
      authenticated: true,
      requestId: "req-1",
      profileId: "profile-123",
      profileKind: "agent",
      callerPrincipalId: "auth-user-123",
      ownerIds: ["owner-a", "owner-b"],
      authMethod: "session",
    });

    expect(built[OPENMELD_AUTH_HEADER_AUTHENTICATED]).toBe("1");
    expect(built[OPENMELD_AUTH_HEADER_PROFILE_ID]).toBe("profile-123");
    expect(built[OPENMELD_AUTH_HEADER_CALLER_PRINCIPAL_ID]).toBe(
      "auth-user-123"
    );

    const claims = readAuthClaimsHeaders(new Headers(built), "fallback-id");
    expect(claims.authenticated).toBe(true);
    expect(claims.profileId).toBe("profile-123");
    expect(claims.profileKind).toBe("agent");
    expect(claims.callerPrincipalId).toBe("auth-user-123");
    expect(claims.ownerIds).toEqual(["owner-a", "owner-b"]);
    expect(claims.authMethod).toBe("session");
  });

  it("falls back to unauthenticated claims", () => {
    const claims = readAuthClaimsHeaders(new Headers(), "fallback-id");
    expect(claims.authenticated).toBe(false);
    expect(claims.requestId).toBe("fallback-id");
    expect(claims.authMethod).toBe("none");
  });

  it("maps unsupported auth methods to none", () => {
    const baseHeaders = {
      [OPENMELD_AUTH_HEADER_AUTHENTICATED]: "1",
      [OPENMELD_AUTH_HEADER_REQUEST_ID]: "req-legacy",
      [OPENMELD_AUTH_HEADER_PROFILE_ID]: "profile-123",
      [OPENMELD_AUTH_HEADER_PROFILE_KIND]: "agent",
    };

    const unknownMethodA = readAuthClaimsHeaders(
      new Headers({
        ...baseHeaders,
        [OPENMELD_AUTH_HEADER_METHOD]: "legacy-method-a",
      }),
      "fallback-id"
    );
    expect(unknownMethodA.authenticated).toBe(true);
    expect(unknownMethodA.authMethod).toBe("none");

    const unknownMethodB = readAuthClaimsHeaders(
      new Headers({
        ...baseHeaders,
        [OPENMELD_AUTH_HEADER_METHOD]: "legacy-method-b",
      }),
      "fallback-id"
    );
    expect(unknownMethodB.authenticated).toBe(true);
    expect(unknownMethodB.authMethod).toBe("none");
  });
});
