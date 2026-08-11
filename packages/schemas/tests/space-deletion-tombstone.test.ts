import { describe, expect, it } from "vitest";
import {
  querySpaceDeletionTombstonesBodySchema,
  upsertSpaceDeletionTombstoneBodySchema,
} from "../src/index";

describe("space deletion tombstone schemas", () => {
  it("normalizes gateway host and deduplicates query space ids", () => {
    const parsed = querySpaceDeletionTombstonesBodySchema.safeParse({
      gatewayHost: "HTTP://LOCALHOST:8788",
      spaceIds: ["space-a", "space-a", "space-b"],
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) {
      return;
    }

    expect(parsed.data).toEqual({
      gatewayHost: "localhost:8788",
      spaceIds: ["space-a", "space-b"],
    });
  });

  it("accepts nullable deleter fields on tombstone upsert", () => {
    const parsed = upsertSpaceDeletionTombstoneBodySchema.safeParse({
      gatewayHost: "localhost:8788",
      spaceName: "ops-room",
      deletedByProfileId: null,
      deletedByProfileName: null,
      deletedByOwnerUserId: null,
    });

    expect(parsed.success).toBe(true);
  });
});
