import { buildOpenMeldRequestContextHeaders } from "@openmeld/gateway-contract";
import { describe, expect, it } from "vitest";

describe("buildOpenMeldRequestContextHeaders", () => {
  it("includes canonical actor context headers when provided", () => {
    const headers = buildOpenMeldRequestContextHeaders({
      requestContext: {
        actorContext: {
          requestId: "req-123",
          openMeldProfileId: "profileIdentity-001",
          profileKind: "human",
          profileName: "Mira",
        },
      },
    });

    expect(headers["x-openmeld-request-id"]).toBe("req-123");
    expect(headers["x-openmeld-profile-id"]).toBe("profileIdentity-001");
    expect(headers["x-openmeld-profile-kind"]).toBe("human");
    expect(headers["x-openmeld-profile-name"]).toBe("Mira");
    expect(headers["x-openmeld-profile"]).toBeUndefined();
  });

  it("preserves the provided request id", () => {
    const headers = buildOpenMeldRequestContextHeaders({
      requestContext: {
        actorContext: {
          requestId: "req-456",
          openMeldProfileId: "profileIdentity-001",
          profileKind: "human",
        },
      },
    });
    const requestId = headers["x-openmeld-request-id"];
    expect(requestId).toBe("req-456");
  });
});
