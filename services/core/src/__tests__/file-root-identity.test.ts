import { describe, expect, it } from "vitest";
import { organizationFileRootName } from "../files/file-root-identity";

describe("organization file root identity", () => {
  it("keeps Team and member writers separate within the same Organization", () => {
    const team = organizationFileRootName({
      kind: "team",
      organizationId: "org-1",
    });
    const member = organizationFileRootName({
      kind: "member",
      organizationId: "org-1",
      memberUserId: "user-1",
    });
    expect(team).not.toBe(member);
    expect(member).not.toBe(
      organizationFileRootName({
        kind: "member",
        organizationId: "org-1",
        memberUserId: "user-2",
      })
    );
    expect(member).not.toBe(
      organizationFileRootName({
        kind: "member",
        organizationId: "org-2",
        memberUserId: "user-1",
      })
    );
  });

  it("does not admit a Space through the Team or member writer", () => {
    expect(() =>
      organizationFileRootName({
        kind: "space",
        organizationId: "org-1",
        spaceId: "space-1",
      } as never)
    ).toThrow("Space Files belong to the Space Durable Object.");
  });
});
