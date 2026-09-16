import { describe, expect, it } from "vitest";
import { resolveSpaceAccess } from "../src/access/space-access-policy";

describe("shared Space access", () => {
  const internal = {
    visibility: "public",
    accessMode: "members_only",
    organizationMember: true,
    activeMember: false,
    password: "missing",
  } as const;
  it("lets a colleague discover and join without exposing content before joining", () => {
    expect(resolveSpaceAccess(internal)).toEqual({
      canDiscover: true,
      canRead: false,
      canJoin: true,
    });
    expect(
      resolveSpaceAccess({ ...internal, organizationMember: false })
    ).toEqual({ canDiscover: false, canRead: false, canJoin: false });
  });
  it("shows a private invitation only to its recipient without granting content or self-join", () => {
    expect(
      resolveSpaceAccess({ ...internal, visibility: "private", invited: true })
    ).toEqual({ canDiscover: true, canRead: false, canJoin: false });
    expect(
      resolveSpaceAccess({ ...internal, visibility: "private" }).canDiscover
    ).toBe(false);
  });
  it("allows accepted membership without requiring organization membership", () => {
    expect(
      resolveSpaceAccess({
        ...internal,
        visibility: "private",
        organizationMember: false,
        activeMember: true,
      })
    ).toEqual({ canDiscover: true, canRead: true, canJoin: true });
  });
  it("preserves password link read and join boundaries", () => {
    const external = {
      ...internal,
      visibility: "private",
      organizationMember: false,
      accessMode: "public_view_join_password",
    } as const;
    expect(resolveSpaceAccess(external)).toEqual({
      canDiscover: false,
      canRead: true,
      canJoin: false,
    });
    expect(resolveSpaceAccess({ ...external, password: "valid" }).canJoin).toBe(
      true
    );
    expect(
      resolveSpaceAccess({
        ...external,
        accessMode: "protected",
        password: "invalid",
      }).canRead
    ).toBe(false);
  });
});
