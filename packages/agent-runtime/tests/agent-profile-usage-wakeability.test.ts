import { describe, expect, it } from "vitest";
import {
  resolveAgentProfileUsageRecoveryAvailability,
  resolveAgentProfileUsageWakeability,
} from "../src";

const NOW_MS = Date.parse("2026-08-30T00:10:00.000Z");

function createUsageLimit(
  status: "available" | "exhausted" | "stale" | "unavailable" | "unsupported",
  overrides: Partial<{
    observedAt: string;
    resetsAt: string | null;
    usedPercent: number | null;
  }> = {}
) {
  const hasKnownUsage =
    status === "available" || status === "exhausted" || status === "stale";
  let usedPercent: number | null = null;
  if (status === "exhausted") {
    usedPercent = 100;
  } else if (hasKnownUsage) {
    usedPercent = 42;
  }
  return {
    key: "five_hour",
    label: "5-hour Usage Limit",
    observedAt: "2026-08-30T00:00:00.000Z",
    resetsAt: hasKnownUsage ? "2026-08-30T01:00:00.000Z" : null,
    status,
    usedPercent,
    ...overrides,
  };
}

describe("resolveAgentProfileUsageWakeability", () => {
  it("blocks new work only for reliable fresh Usage that is explicitly exhausted", () => {
    expect(
      resolveAgentProfileUsageWakeability({
        nowMs: NOW_MS,
        report: {
          expiresAtMs: NOW_MS + 60_000,
          status: "ready",
          usageLimits: [createUsageLimit("exhausted")],
        },
      })
    ).toEqual({ blocksNewWork: true, reasonCode: "usage_exhausted" });
  });

  it.each([
    ["available", createUsageLimit("available")],
    ["stale", createUsageLimit("stale")],
    ["unavailable", createUsageLimit("unavailable")],
    ["unsupported", createUsageLimit("unsupported")],
    ["not evaluated", undefined],
  ] as const)("does not let %s Usage reduce Wakeability", (_label, usageLimit) => {
    expect(
      resolveAgentProfileUsageWakeability({
        nowMs: NOW_MS,
        report: {
          expiresAtMs: NOW_MS + 60_000,
          status: "ready",
          usageLimits: usageLimit ? [usageLimit] : undefined,
        },
      })
    ).toEqual({ blocksNewWork: false, reasonCode: null });
  });

  it("does not block from expired reports, stale observations, or elapsed resets", () => {
    const cases = [
      {
        expiresAtMs: NOW_MS - 1,
        usageLimits: [createUsageLimit("exhausted")],
      },
      {
        expiresAtMs: NOW_MS + 60_000,
        usageLimits: [
          createUsageLimit("exhausted", {
            observedAt: "2026-08-29T23:49:59.999Z",
          }),
        ],
      },
      {
        expiresAtMs: NOW_MS + 60_000,
        usageLimits: [
          createUsageLimit("exhausted", {
            resetsAt: "2026-08-30T00:10:00.000Z",
          }),
        ],
      },
    ];

    for (const value of cases) {
      expect(
        resolveAgentProfileUsageWakeability({
          nowMs: NOW_MS,
          report: { ...value, status: "ready" },
        })
      ).toEqual({ blocksNewWork: false, reasonCode: null });
    }
  });

  it("does not block from missing or non-ready reports", () => {
    expect(
      resolveAgentProfileUsageWakeability({ nowMs: NOW_MS, report: null })
    ).toEqual({ blocksNewWork: false, reasonCode: null });
    expect(
      resolveAgentProfileUsageWakeability({
        nowMs: NOW_MS,
        report: {
          expiresAtMs: NOW_MS + 60_000,
          status: "unavailable",
          usageLimits: [createUsageLimit("exhausted")],
        },
      })
    ).toEqual({ blocksNewWork: false, reasonCode: null });
  });
});

describe("resolveAgentProfileUsageRecoveryAvailability", () => {
  it("requires a fresh ready report whose supported Usage Limits are all explicitly available", () => {
    expect(
      resolveAgentProfileUsageRecoveryAvailability({
        nowMs: NOW_MS,
        report: {
          expiresAtMs: NOW_MS + 60_000,
          status: "ready",
          usageLimits: [
            createUsageLimit("available"),
            createUsageLimit("available", {
              observedAt: "2026-08-30T00:01:00.000Z",
            }),
          ].map((limit, index) => ({ ...limit, key: `limit_${index}` })),
        },
      })
    ).toEqual({ available: true });
  });

  it.each([
    ["missing", undefined],
    ["unsupported", [createUsageLimit("unsupported")]],
    ["unavailable", [createUsageLimit("unavailable")]],
    ["stale", [createUsageLimit("stale")]],
    [
      "partially known",
      [createUsageLimit("available"), createUsageLimit("stale")].map(
        (limit, index) => ({ ...limit, key: `limit_${index}` })
      ),
    ],
    ["exhausted", [createUsageLimit("exhausted")]],
  ] as const)("does not claim Usage recovered when evidence is %s", (_label, limits) => {
    expect(
      resolveAgentProfileUsageRecoveryAvailability({
        nowMs: NOW_MS,
        report: {
          expiresAtMs: NOW_MS + 60_000,
          status: "ready",
          usageLimits: limits,
        },
      })
    ).toEqual({ available: false });
  });
});
