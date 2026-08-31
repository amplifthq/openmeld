import { describe, expect, it } from "vitest";
import {
  parseSpaceTarget,
  resolveSpaceReadCommandTarget,
} from "../src/space/space-target";

const SPACE_ID =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("Space target parsing", () => {
  it("uses the canonical invalid-target error for a blank target", () => {
    expect(() => parseSpaceTarget("  ")).toThrow(
      "Space target must be a 64-character Space ID or an OpenMeld Space URL."
    );
  });

  it("normalizes malformed URL path encoding into the canonical read-target error", () => {
    expect(() =>
      parseSpaceTarget("https://openmeld.ai/o/example/spaces/%ZZ")
    ).toThrow(
      "Space target must be a 64-character Space ID or an OpenMeld Space URL."
    );
  });

  it("maps the staging Web origin to the staging Gateway", () => {
    expect(
      resolveSpaceReadCommandTarget({
        space: `https://staging.openmeld.ai/o/example/spaces/${SPACE_ID}`,
      })
    ).toEqual({
      baseUrl: "https://gateway.staging.openmeld.ai",
      space: SPACE_ID,
    });
  });

  it("rejects an untrusted copied URL instead of deriving a network target", () => {
    expect(() =>
      resolveSpaceReadCommandTarget({
        space: `https://gateway.attacker.example/o/example/spaces/${SPACE_ID}`,
      })
    ).toThrow("Space URL must use a trusted OpenMeld Web origin");
  });

  it("uses an explicit Gateway without trusting the copied URL origin", () => {
    expect(
      resolveSpaceReadCommandTarget({
        baseUrl: "http://localhost:31489",
        space: `http://localhost:31488/o/example/spaces/${SPACE_ID}`,
      })
    ).toEqual({
      baseUrl: "http://localhost:31489",
      space: SPACE_ID,
    });
  });

  it("keeps explicit Gateway precedence in the shared target parser", () => {
    expect(
      parseSpaceTarget(
        `http://localhost:31488/o/example/spaces/${SPACE_ID}?profileId=hum_url`,
        { baseUrl: "http://localhost:31489" }
      )
    ).toEqual({
      baseUrl: "http://localhost:31489",
      profileId: "hum_url",
      spaceId: SPACE_ID,
    });
  });

  it("maps the standard localhost Web port to the standard Gateway port", () => {
    expect(
      resolveSpaceReadCommandTarget({
        space: `http://localhost:3000/o/example/spaces/${SPACE_ID}`,
      })
    ).toEqual({
      baseUrl: "http://localhost:8080",
      space: SPACE_ID,
    });
  });
});
