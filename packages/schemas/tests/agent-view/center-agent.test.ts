import { describe, expect, it } from "vitest";
import { centerAgentOrganizationScopeSchema } from "../../src/index";

describe("Center Agent Agent View Organization scope", () => {
  it("keeps only the frozen target and how the command selected it", () => {
    const scope = centerAgentOrganizationScopeSchema.parse({
      selection: "current",
      target: {
        id: "org-2",
        name: "Launch Team",
        slug: "launch",
      },
    });

    expect(scope).toEqual({
      selection: "current",
      target: {
        id: "org-2",
        name: "Launch Team",
        slug: "launch",
      },
    });
    expect(
      centerAgentOrganizationScopeSchema.safeParse({
        ...scope,
        active: {
          id: "org-stale",
          name: "Stale Organization",
          slug: "stale",
        },
      }).success
    ).toBe(false);
  });
});
