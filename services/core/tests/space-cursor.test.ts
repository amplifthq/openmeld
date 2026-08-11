import { describe, expect, it } from "vitest";
import { normalizeStoredSpaceCursorRecord } from "../src/space/rules/parsers/space-cursor";

describe("space cursor normalization", () => {
  it("accepts stored cursor when request uses a different space alias", () => {
    const record = normalizeStoredSpaceCursorRecord({
      raw: JSON.stringify({
        v: 1,
        spaceId: "space-name-alias",
        profileId: "profile-1",
        lastSeenTs: 123,
        createdAt: "2026-02-01T00:00:00.000Z",
        updatedAt: "2026-02-01T00:00:00.000Z",
      }),
      profileId: "profile-1",
      requestSpaceId:
        "a5427c4552bad0e29ccd12e322e4392b294bf8e9ef05fa126d892125c386ee57",
    });

    expect(record).not.toBeNull();
    expect(record?.spaceId).toBe(
      "a5427c4552bad0e29ccd12e322e4392b294bf8e9ef05fa126d892125c386ee57"
    );
    expect(record?.lastSeenTs).toBe(123);
  });

  it("rejects mismatched profile id", () => {
    const record = normalizeStoredSpaceCursorRecord({
      raw: JSON.stringify({
        v: 1,
        spaceId: "space-name-alias",
        profileId: "profile-2",
        lastSeenTs: 123,
      }),
      profileId: "profile-1",
      requestSpaceId: "space-id",
    });

    expect(record).toBeNull();
  });

  it("normalizes invalid stored lastSeenTs values", () => {
    const record = normalizeStoredSpaceCursorRecord({
      raw: JSON.stringify({
        v: 1,
        spaceId: "space-name-alias",
        profileId: "profile-1",
        lastSeenTs: -10.8,
      }),
      profileId: "profile-1",
      requestSpaceId: "space-id",
    });

    expect(record).not.toBeNull();
    expect(record?.lastSeenTs).toBe(0);
  });

  it("accepts role and mentionAlias when lastSeenTs is not present", () => {
    const record = normalizeStoredSpaceCursorRecord({
      raw: JSON.stringify({
        v: 1,
        spaceId: "space-name-alias",
        profileId: "profile-1",
        role: "  Spaceship Engineer  ",
        mentionAlias: "  ops-bot  ",
      }),
      profileId: "profile-1",
      requestSpaceId: "space-id",
    });

    expect(record).not.toBeNull();
    expect(record?.lastSeenTs).toBeUndefined();
    expect(record?.role).toBe("Spaceship Engineer");
    expect(record?.mentionAlias).toBe("ops-bot");
  });
});
