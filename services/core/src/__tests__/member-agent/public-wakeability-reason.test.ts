import { publicWakeabilityReasonSchema } from "@openmeld/schemas";
import { describe, expect, it } from "vitest";
import {
  resolvePublicWakeabilityReason,
  resolveUsageExhaustedResetAt,
} from "../../agent-execution/application/public-wakeability-reason";

const NOW_MS = Date.parse("2026-10-18T12:00:00.000Z");

describe("resolvePublicWakeabilityReason", () => {
  it.each([
    ["controller.auth.unauthenticated", { code: "not_signed_in" }],
    [
      "provider_account.subscription_access_unavailable",
      { code: "no_subscription" },
    ],
    ["provider_account.organization_access_disabled", { code: "org_disabled" }],
    ["controller.registry.disabled", { code: "harness_turned_off" }],
    ["profile.workspace.missing", { code: "no_working_folder" }],
  ] as const)("names the exact owner reason %s", (reasonCode, expected) => {
    const reason = resolvePublicWakeabilityReason({
      availability: { category: "unavailable", reasonCode },
    });
    expect(reason).toEqual(expected);
    expect(publicWakeabilityReasonSchema.parse(reason)).toEqual(expected);
  });

  it("names an offline computer without naming the computer", () => {
    expect(
      resolvePublicWakeabilityReason({
        availability: {
          category: "offline",
          reasonCode: "daemon.profile.offline",
        },
      })
    ).toEqual({ code: "computer_offline" });
  });

  it("carries only the reset time for a Usage Limit", () => {
    expect(
      resolvePublicWakeabilityReason({
        availability: {
          category: "unavailable",
          reasonCode: "usage_exhausted",
        },
        usageResetAt: "2026-10-18T15:00:00.000Z",
      })
    ).toEqual({
      code: "usage_exhausted",
      resetAt: "2026-10-18T15:00:00.000Z",
    });
    expect(
      resolvePublicWakeabilityReason({
        availability: {
          category: "unavailable",
          reasonCode: "usage_exhausted",
        },
      })
    ).toEqual({ code: "usage_exhausted", resetAt: null });
  });

  it("leaves the reason absent instead of inferring one", () => {
    for (const availability of [
      { category: "available", reasonCode: "agent_execution.ready" },
      { category: "checking", reasonCode: "usage_checking" },
      {
        category: "unavailable",
        reasonCode: "provider_account.access_required",
      },
      { category: "unavailable", reasonCode: "model.retired" },
      {
        category: "unavailable",
        reasonCode: "provider_account.capacity_exhausted",
      },
      { category: "unavailable", reasonCode: null },
    ] as const) {
      expect(resolvePublicWakeabilityReason({ availability })).toBeNull();
    }
  });
});

describe("resolveUsageExhaustedResetAt", () => {
  const limit = (status: string, resetsAt: string | null) =>
    ({
      observedAt: "2026-10-18T11:59:00.000Z",
      resetsAt,
      status,
      usedPercent: 100,
    }) as never;

  it("returns the earliest future reset of exhausted limits only", () => {
    expect(
      resolveUsageExhaustedResetAt({
        nowMs: NOW_MS,
        usageLimits: [
          limit("exhausted", "2026-10-19T00:00:00.000Z"),
          limit("exhausted", "2026-10-18T13:00:00.000Z"),
          limit("available", "2026-10-18T12:30:00.000Z"),
          limit("exhausted", "2026-10-18T11:00:00.000Z"),
          limit("exhausted", null),
        ],
      })
    ).toBe("2026-10-18T13:00:00.000Z");
    expect(
      resolveUsageExhaustedResetAt({ nowMs: NOW_MS, usageLimits: [] })
    ).toBeNull();
  });
});
