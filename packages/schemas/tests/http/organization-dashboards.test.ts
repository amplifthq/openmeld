import { describe, expect, it } from "vitest";
import { organizationDashboardMutationSchema } from "../../src/schemas/http/organization-dashboards";

const draft = {
  name: "Engineering",
  organizationId: "org-1",
  operation: "create",
};

describe("Dashboard config source boundaries", () => {
  it("accepts a named GitHub config and rejects an artifact on it", () => {
    const input = {
      ...draft,
      kind: "github_issues",
      repository: "acme/project",
    };
    expect(organizationDashboardMutationSchema.safeParse(input).success).toBe(
      true
    );
    expect(
      organizationDashboardMutationSchema.safeParse({
        ...input,
        artifact: { spaceId: "space-1", fileId: "file-1", revision: 1 },
      }).success
    ).toBe(false);
    expect(
      organizationDashboardMutationSchema.safeParse({
        ...input,
        repository: "https://evil.example/x",
      }).success
    ).toBe(false);
  });
  it("accepts an immutable native artifact revision, not raw HTML or external URLs", () => {
    const input = {
      ...draft,
      kind: "traffic",
      artifact: { spaceId: "space-1", fileId: "file-1", revision: 1 },
    };
    expect(organizationDashboardMutationSchema.safeParse(input).success).toBe(
      true
    );
    expect(
      organizationDashboardMutationSchema.safeParse({
        ...input,
        artifact: { ...input.artifact, revision: 0 },
      }).success
    ).toBe(false);
    expect(
      organizationDashboardMutationSchema.safeParse({
        ...input,
        artifact: "https://evil.example/dashboard",
      }).success
    ).toBe(false);
    expect(
      organizationDashboardMutationSchema.safeParse({
        ...input,
        artifact: { ...input.artifact, html: "<script>bad()</script>" },
      }).success
    ).toBe(false);
  });
});
