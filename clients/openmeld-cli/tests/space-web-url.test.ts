import { describe, expect, it } from "vitest";
import {
  buildSpaceWebUrl,
  resolveGatewayWebOrigin,
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

  it("preserves an optional profile target on the org-scoped Space URL", () => {
    expect(
      buildSpaceWebUrl("https://gateway.openmeld.ai", "acme", "space-123", {
        profileId: "hum_123",
      })
    ).toBe("https://openmeld.ai/o/acme/spaces/space-123?profileId=hum_123");
  });
});
