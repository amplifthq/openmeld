import { describe, expect, it } from "vitest";
import { Space } from "../src/space/transport/do/space";

type SpaceRefGuardTarget = {
  durableObjectId: string;
  spaceId: string;
};

const applySpaceRef = (
  Space.prototype as unknown as {
    applySpaceRef(this: SpaceRefGuardTarget, spaceId: string): void;
  }
).applySpaceRef;

describe("space rpc bound-id guard", () => {
  it("stores normalized spaceId when it matches bound durable object id", () => {
    const target: SpaceRefGuardTarget = {
      durableObjectId: "space-id-1",
      spaceId: "old-value",
    };

    applySpaceRef.call(target, "  space-id-1  ");

    expect(target.spaceId).toBe("space-id-1");
  });

  it("returns stable structured error for mismatched bound durable object id", () => {
    const target: SpaceRefGuardTarget = {
      durableObjectId: "space-id-1",
      spaceId: "space-id-1",
    };

    try {
      applySpaceRef.call(target, "space-id-2");
      throw new Error("expected mismatch guard to throw");
    } catch (error) {
      expect(error).toMatchObject({
        cause: {
          status: 400,
          code: "invalid_space_binding",
          message: "spaceId does not match the bound durable object",
        },
      });
      expect((error as Error).message).toContain("HTTP 400");
      expect((error as Error).message).toContain("invalid_space_binding");
    }
  });
});
