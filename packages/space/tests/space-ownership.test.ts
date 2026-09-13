import { describe, expect, it } from "vitest";
import { changeSpaceOwners, isSpaceOwner } from "../src/access/space-ownership";

describe("Space ownership", () => {
  it("gives each human owner management authority without granting it to their Agents", () => {
    for (const userId of ["first", "successor"]) {
      expect(
        isSpaceOwner({
          ownerUserIds: ["first", "successor"],
          actorOwnerUserId: userId,
          actorKind: "human",
        })
      ).toBe(true);
      expect(
        isSpaceOwner({
          ownerUserIds: ["first", "successor"],
          actorOwnerUserId: userId,
          actorKind: "agent",
        })
      ).toBe(false);
    }
    expect(
      isSpaceOwner({
        ownerUserIds: ["successor"],
        actorOwnerUserId: "creator",
        actorKind: "human",
      })
    ).toBe(false);
  });
  it("allows the original owner to leave after handing over, but retains the last owner", () => {
    const added = changeSpaceOwners({
      ownerUserIds: ["first"],
      userId: "successor",
      role: "owner",
    });
    expect(added).toEqual({ ok: true, ownerUserIds: ["first", "successor"] });
    const handedOver = changeSpaceOwners({
      ownerUserIds: ["first", "successor"],
      userId: "first",
      role: "member",
    });
    expect(handedOver).toEqual({ ok: true, ownerUserIds: ["successor"] });
    expect(
      changeSpaceOwners({
        ownerUserIds: ["successor"],
        userId: "successor",
        role: "member",
      })
    ).toEqual({ ok: false, code: "space.last_owner" });
  });
  it("makes repeated promotions idempotent", () => {
    expect(
      changeSpaceOwners({
        ownerUserIds: ["first"],
        userId: "first",
        role: "owner",
      })
    ).toEqual({ ok: true, ownerUserIds: ["first"] });
  });
});
