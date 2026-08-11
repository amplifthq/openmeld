import { describe, expect, it } from "vitest";
import { createUnauthenticatedClaims } from "../src/types/auth-claims";

describe("createUnauthenticatedClaims", () => {
  it("returns the default unauthenticated shape", () => {
    const claims = createUnauthenticatedClaims("req-123");

    expect(claims).toEqual({
      authenticated: false,
      requestId: "req-123",
      ownerIds: [],
      authMethod: "none",
    });
  });
});
