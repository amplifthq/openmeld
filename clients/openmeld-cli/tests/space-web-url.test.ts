import { describe, expect, it } from "vitest";
import {
  buildSpaceWebUrl,
  resolveGatewayWebOrigin,
  resolveSpaceWebGatewayOrigin,
} from "../src/space/web-url";

describe("Space web URLs", () => {
  it("maps the production gateway origin to the public web origin", () => {
    expect(resolveGatewayWebOrigin("https://gateway.openmeld.ai")).toBe(
      "https://openmeld.ai"
    );
    expect(
      buildSpaceWebUrl("https://gateway.openmeld.ai", "acme", "space-123")
    ).toBe("https://openmeld.ai/o/acme/spaces/space-123");
  });

  it("maps the non-routable gateway fixture origin to the matching web origin", () => {
    expect(resolveGatewayWebOrigin("https://gateway.openmeld.invalid")).toBe(
      "https://openmeld.invalid"
    );
    expect(
      buildSpaceWebUrl("https://gateway.openmeld.invalid", "acme", "space-123")
    ).toBe("https://openmeld.invalid/o/acme/spaces/space-123");
  });

  it("keeps production, staging, fixture, and localhost mappings bidirectional", () => {
    expect(
      resolveSpaceWebGatewayOrigin(
        new URL("https://openmeld.ai/o/acme/spaces/space-123")
      )
    ).toBe("https://gateway.openmeld.ai");
    expect(
      resolveSpaceWebGatewayOrigin(
        new URL("https://staging.openmeld.ai/o/acme/spaces/space-123")
      )
    ).toBe("https://gateway.staging.openmeld.ai");
    expect(resolveGatewayWebOrigin("https://gateway.staging.openmeld.ai")).toBe(
      "https://staging.openmeld.ai"
    );
    expect(
      resolveSpaceWebGatewayOrigin(
        new URL("https://openmeld.invalid/o/acme/spaces/space-123")
      )
    ).toBe("https://gateway.openmeld.invalid");
    expect(
      resolveSpaceWebGatewayOrigin(
        new URL("http://localhost:3000/o/acme/spaces/space-123")
      )
    ).toBe("http://localhost:8080");
  });

  it("rejects a copied Space URL from an untrusted origin", () => {
    expect(() =>
      resolveSpaceWebGatewayOrigin(
        new URL("https://gateway.attacker.example/o/acme/spaces/space-123")
      )
    ).toThrow("Space URL must use a trusted OpenMeld Web origin");
  });

  it("preserves an optional profile target on the org-scoped Space URL", () => {
    expect(
      buildSpaceWebUrl("https://gateway.openmeld.ai", "acme", "space-123", {
        profileId: "hum_123",
      })
    ).toBe("https://openmeld.ai/o/acme/spaces/space-123?profileId=hum_123");
  });
});
