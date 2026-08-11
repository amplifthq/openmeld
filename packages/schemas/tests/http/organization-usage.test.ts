import { describe, expect, it } from "vitest";
import { organizationUsageOverviewResponseSchema } from "../../src/schemas/http/organization-usage";

const VALID_OVERVIEW = {
  centerAgentWakes: {
    dailyLimit: 200,
    resetsAt: "2026-07-17T00:00:00.000Z",
    usedToday: 12,
  },
  routines: {
    count: 7,
    limit: 50,
  },
} as const;

describe("organization usage overview contract", () => {
  it("accepts the complete organization usage read model", () => {
    expect(
      organizationUsageOverviewResponseSchema.safeParse(VALID_OVERVIEW).success
    ).toBe(true);
  });

  it("rejects unknown fields at the response and nested object boundaries", () => {
    expect(
      organizationUsageOverviewResponseSchema.safeParse({
        ...VALID_OVERVIEW,
        unexpected: true,
      }).success
    ).toBe(false);
    expect(
      organizationUsageOverviewResponseSchema.safeParse({
        ...VALID_OVERVIEW,
        centerAgentWakes: {
          ...VALID_OVERVIEW.centerAgentWakes,
          unexpected: true,
        },
      }).success
    ).toBe(false);
    expect(
      organizationUsageOverviewResponseSchema.safeParse({
        ...VALID_OVERVIEW,
        routines: {
          ...VALID_OVERVIEW.routines,
          enabledCount: 3,
        },
      }).success
    ).toBe(false);
  });

  it("rejects an invalid reset time", () => {
    expect(
      organizationUsageOverviewResponseSchema.safeParse({
        ...VALID_OVERVIEW,
        centerAgentWakes: {
          ...VALID_OVERVIEW.centerAgentWakes,
          resetsAt: "tomorrow",
        },
      }).success
    ).toBe(false);
  });

  it("rejects a negative count", () => {
    expect(
      organizationUsageOverviewResponseSchema.safeParse({
        ...VALID_OVERVIEW,
        centerAgentWakes: {
          ...VALID_OVERVIEW.centerAgentWakes,
          usedToday: -1,
        },
      }).success
    ).toBe(false);
  });

  it("rejects a non-positive limit", () => {
    expect(
      organizationUsageOverviewResponseSchema.safeParse({
        ...VALID_OVERVIEW,
        centerAgentWakes: {
          ...VALID_OVERVIEW.centerAgentWakes,
          dailyLimit: 0,
        },
      }).success
    ).toBe(false);
  });
});
