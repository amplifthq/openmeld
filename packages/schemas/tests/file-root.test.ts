import { describe, expect, it } from "vitest";
import {
  fileRootSchema,
  listFileRootResponseSchema,
} from "../src/schemas/http/file-root";

describe("file root", () => {
  it("keeps each file location within its Organization", () => {
    expect(
      fileRootSchema.parse({ kind: "team", organizationId: "team-1" })
    ).toEqual({ kind: "team", organizationId: "team-1" });
    expect(
      fileRootSchema.parse({
        kind: "member",
        organizationId: "team-1",
        memberUserId: "user-1",
      })
    ).toMatchObject({ kind: "member", memberUserId: "user-1" });
    expect(
      fileRootSchema.parse({
        kind: "space",
        organizationId: "team-1",
        spaceId: "space-1",
      })
    ).toMatchObject({ kind: "space", spaceId: "space-1" });
  });

  it("rejects a root with missing or mixed ownership", () => {
    expect(
      fileRootSchema.safeParse({ kind: "member", organizationId: "team-1" })
        .success
    ).toBe(false);
    expect(
      fileRootSchema.safeParse({
        kind: "team",
        organizationId: "team-1",
        memberUserId: "user-1",
      }).success
    ).toBe(false);
    expect(
      fileRootSchema.safeParse({
        kind: "space",
        organizationId: "team-1",
        spaceId: " ",
      }).success
    ).toBe(false);
  });

  it("does not expose the Space repository identity in a Team listing", () => {
    const response = listFileRootResponseSchema.safeParse({
      root: { kind: "team", organizationId: "team-1" },
      parentId: null,
      view: "active",
      breadcrumbs: [{ id: null, name: "Files" }],
      entries: [],
      capabilities: { canRead: true, canWrite: true },
      spaceId: "internal-writer-id",
    });
    expect(response.success).toBe(false);
  });
});
