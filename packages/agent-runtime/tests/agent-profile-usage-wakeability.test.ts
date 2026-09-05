import { describe, expect, it } from "vitest";
import {
  AGENT_CONTROLLER_USAGE_LIMIT_SUPPORT_MATRIX_VERSION,
  resolveAgentControllerUsageLimitSupport,
  resolveAgentControllerUsageProviderId,
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
        agentControllerRef: "builtin:codex",
        nowMs: NOW_MS,
        report: {
          expiresAtMs: NOW_MS + 60_000,
          status: "ready",
          usageLimits: [createUsageLimit("exhausted")],
          usageLimitsSupportMatrixVersion:
            AGENT_CONTROLLER_USAGE_LIMIT_SUPPORT_MATRIX_VERSION,
        },
      })
    ).toEqual({
      blocksNewWork: true,
      reasonCode: "usage_exhausted",
      status: "unavailable",
    });
  });

  it.each([
    ["available", createUsageLimit("available")],
    ["unsupported", createUsageLimit("unsupported")],
  ] as const)("does not let %s Usage block Wakeability", (_label, usageLimit) => {
    expect(
      resolveAgentProfileUsageWakeability({
        agentControllerRef: "builtin:codex",
        nowMs: NOW_MS,
        report: {
          expiresAtMs: NOW_MS + 60_000,
          status: "ready",
          usageLimits: usageLimit ? [usageLimit] : undefined,
          usageLimitsSupportMatrixVersion:
            AGENT_CONTROLLER_USAGE_LIMIT_SUPPORT_MATRIX_VERSION,
        },
      })
    ).toEqual({
      blocksNewWork: false,
      reasonCode: null,
      status: "available",
    });
  });

  it.each([
    ["stale", createUsageLimit("stale")],
    ["unavailable", createUsageLimit("unavailable")],
  ] as const)("keeps supported %s Usage in Checking until it can confirm capacity", (_label, usageLimit) => {
    expect(
      resolveAgentProfileUsageWakeability({
        agentControllerRef: "builtin:codex",
        nowMs: NOW_MS,
        report: {
          expiresAtMs: NOW_MS + 60_000,
          status: "ready",
          usageLimits: [usageLimit],
          usageLimitsSupportMatrixVersion:
            AGENT_CONTROLLER_USAGE_LIMIT_SUPPORT_MATRIX_VERSION,
        },
      })
    ).toEqual({
      blocksNewWork: true,
      reasonCode: "usage_checking",
      status: "checking",
    });
  });

  it("stops using an expired report while keeping a current inconclusive report bounded by its expiry", () => {
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
          agentControllerRef: "builtin:codex",
          nowMs: NOW_MS,
          report: {
            ...value,
            status: "ready",
            usageLimitsSupportMatrixVersion:
              AGENT_CONTROLLER_USAGE_LIMIT_SUPPORT_MATRIX_VERSION,
          },
        })
      ).toEqual({
        blocksNewWork: true,
        reasonCode: "usage_checking",
        status: "checking",
      });
    }
  });

  it("keeps a native Usage controller in bounded Checking until a current report arrives", () => {
    expect(
      resolveAgentProfileUsageWakeability({
        agentControllerRef: "builtin:codex",
        nowMs: NOW_MS,
        report: null,
      })
    ).toEqual({
      blocksNewWork: true,
      reasonCode: "usage_checking",
      status: "checking",
    });
  });

  it.each([
    "builtin:codex",
    "builtin:grok-build",
  ])("parses a legacy %s report but keeps admission closed without the current Usage matrix", (agentControllerRef) => {
    expect(
      resolveAgentProfileUsageWakeability({
        agentControllerRef,
        nowMs: NOW_MS,
        report: {
          expiresAtMs: NOW_MS + 60_000,
          status: "ready",
        },
      })
    ).toEqual({
      blocksNewWork: true,
      reasonCode: "usage_checking",
      status: "checking",
    });
  });

  it.each([
    ["available", createUsageLimit("available")],
    ["exhausted", createUsageLimit("exhausted")],
    ["stale", createUsageLimit("stale")],
    ["unavailable", createUsageLimit("unavailable")],
  ] as const)("does not authorize from legacy %s Usage evidence without the current matrix", (_label, usageLimit) => {
    expect(
      resolveAgentProfileUsageWakeability({
        agentControllerRef: "builtin:codex",
        nowMs: NOW_MS,
        report: {
          expiresAtMs: NOW_MS + 60_000,
          status: "ready",
          usageLimits: [usageLimit],
        },
      })
    ).toEqual({
      blocksNewWork: true,
      reasonCode: "usage_checking",
      status: "checking",
    });
  });

  it("keeps a current native Usage contract in Checking until it reports a limit", () => {
    expect(
      resolveAgentProfileUsageWakeability({
        agentControllerRef: "builtin:codex",
        nowMs: NOW_MS,
        report: {
          expiresAtMs: NOW_MS + 60_000,
          status: "ready",
          usageLimitsSupportMatrixVersion:
            AGENT_CONTROLLER_USAGE_LIMIT_SUPPORT_MATRIX_VERSION,
        },
      })
    ).toEqual({
      blocksNewWork: true,
      reasonCode: "usage_checking",
      status: "checking",
    });
  });

  it("does not use unreliable or unsupported Usage as a Wake condition", () => {
    for (const agentControllerRef of [
      "builtin:claude-code",
      "builtin:cursor",
      "builtin:opencode",
      "builtin:openclaw",
      "custom:unknown",
    ]) {
      expect(
        resolveAgentProfileUsageWakeability({
          agentControllerRef,
          nowMs: NOW_MS,
          report: {
            expiresAtMs: NOW_MS + 60_000,
            status: "ready",
            usageLimits: [createUsageLimit("exhausted")],
          },
        })
      ).toEqual({
        blocksNewWork: false,
        reasonCode: null,
        status: "available",
      });
    }
  });

  it("checks only the selected OpenCode provider", () => {
    const providerLimit = (
      providerId: string,
      status: "available" | "exhausted"
    ) => ({
      ...createUsageLimit(status),
      key: `${providerId}:five_hour`,
      provider: { displayName: providerId, id: providerId },
    });
    const report = {
      expiresAtMs: NOW_MS + 60_000,
      status: "ready" as const,
      usageLimits: [
        providerLimit("opencode-go", "available"),
        providerLimit("openai", "exhausted"),
      ],
      usageLimitsSupportMatrixVersion:
        AGENT_CONTROLLER_USAGE_LIMIT_SUPPORT_MATRIX_VERSION,
    };

    expect(
      resolveAgentProfileUsageWakeability({
        agentControllerRef: "builtin:opencode",
        nowMs: NOW_MS,
        providerId: "opencode-go",
        report,
      })
    ).toEqual({
      blocksNewWork: false,
      reasonCode: null,
      status: "available",
    });
    expect(
      resolveAgentProfileUsageWakeability({
        agentControllerRef: "builtin:opencode",
        nowMs: NOW_MS,
        providerId: "openai",
        report,
      })
    ).toEqual({
      blocksNewWork: false,
      reasonCode: null,
      status: "available",
    });
  });

  it("blocks OpenCode Go when its selected provider is exhausted", () => {
    expect(
      resolveAgentProfileUsageWakeability({
        agentControllerRef: "builtin:opencode",
        nowMs: NOW_MS,
        providerId: "opencode-go",
        report: {
          expiresAtMs: NOW_MS + 60_000,
          status: "ready",
          usageLimits: [
            {
              ...createUsageLimit("exhausted"),
              key: "opencode-go:rolling",
              provider: {
                displayName: "OpenCode Go",
                id: "opencode-go",
              },
            },
          ],
          usageLimitsSupportMatrixVersion:
            AGENT_CONTROLLER_USAGE_LIMIT_SUPPORT_MATRIX_VERSION,
        },
      })
    ).toEqual({
      blocksNewWork: true,
      reasonCode: "usage_exhausted",
      status: "unavailable",
    });
  });

  it("keeps OpenCode Go checking when only another provider reported usage", () => {
    expect(
      resolveAgentProfileUsageWakeability({
        agentControllerRef: "builtin:opencode",
        nowMs: NOW_MS,
        providerId: "opencode-go",
        report: {
          expiresAtMs: NOW_MS + 60_000,
          status: "ready",
          usageLimits: [
            {
              ...createUsageLimit("available"),
              key: "openai:provider",
              provider: { displayName: "OpenAI", id: "openai" },
            },
          ],
          usageLimitsSupportMatrixVersion:
            AGENT_CONTROLLER_USAGE_LIMIT_SUPPORT_MATRIX_VERSION,
        },
      })
    ).toEqual({
      blocksNewWork: true,
      reasonCode: "usage_checking",
      status: "checking",
    });
  });

  it("keeps one versioned Usage support matrix for Core and the Local Service", () => {
    expect(AGENT_CONTROLLER_USAGE_LIMIT_SUPPORT_MATRIX_VERSION).toBe(2);
    expect(resolveAgentControllerUsageLimitSupport("builtin:codex")).toBe(
      "native"
    );
    expect(resolveAgentControllerUsageLimitSupport("builtin:grok-build")).toBe(
      "native"
    );
    expect(resolveAgentControllerUsageLimitSupport("builtin:claude-code")).toBe(
      "passive"
    );
    expect(resolveAgentControllerUsageLimitSupport("builtin:cursor")).toBe(
      "unsupported"
    );
    expect(resolveAgentControllerUsageLimitSupport("builtin:opencode")).toBe(
      "provider_scoped"
    );
    expect(
      resolveAgentControllerUsageProviderId({
        agentControllerRef: "builtin:opencode",
        modelId: "opencode-go/qwen3-coder",
      })
    ).toBe("opencode-go");
  });

  it("keeps known supported Usage in Checking while its controller report is non-ready", () => {
    expect(
      resolveAgentProfileUsageWakeability({
        agentControllerRef: "builtin:codex",
        nowMs: NOW_MS,
        report: {
          expiresAtMs: NOW_MS + 60_000,
          status: "unavailable",
          usageLimits: [createUsageLimit("unavailable")],
          usageLimitsSupportMatrixVersion:
            AGENT_CONTROLLER_USAGE_LIMIT_SUPPORT_MATRIX_VERSION,
        },
      })
    ).toEqual({
      blocksNewWork: true,
      reasonCode: "usage_checking",
      status: "checking",
    });
  });
});

describe("resolveAgentProfileUsageRecoveryAvailability", () => {
  it("requires a fresh ready report whose supported Usage Limits are all explicitly available", () => {
    expect(
      resolveAgentProfileUsageRecoveryAvailability({
        agentControllerRef: "builtin:codex",
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
          usageLimitsSupportMatrixVersion:
            AGENT_CONTROLLER_USAGE_LIMIT_SUPPORT_MATRIX_VERSION,
        },
      })
    ).toEqual({ available: true });
  });

  it("ignores explicitly unsupported limits when supported Usage has recovered", () => {
    expect(
      resolveAgentProfileUsageRecoveryAvailability({
        agentControllerRef: "builtin:codex",
        nowMs: NOW_MS,
        report: {
          expiresAtMs: NOW_MS + 60_000,
          status: "ready",
          usageLimits: [
            createUsageLimit("available"),
            createUsageLimit("unsupported"),
          ].map((limit, index) => ({ ...limit, key: `limit_${index}` })),
          usageLimitsSupportMatrixVersion:
            AGENT_CONTROLLER_USAGE_LIMIT_SUPPORT_MATRIX_VERSION,
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
        agentControllerRef: "builtin:codex",
        nowMs: NOW_MS,
        report: {
          expiresAtMs: NOW_MS + 60_000,
          status: "ready",
          usageLimits: limits,
          usageLimitsSupportMatrixVersion:
            AGENT_CONTROLLER_USAGE_LIMIT_SUPPORT_MATRIX_VERSION,
        },
      })
    ).toEqual({ available: false });
  });

  it("does not auto-resume from a legacy report without the current Usage matrix", () => {
    expect(
      resolveAgentProfileUsageRecoveryAvailability({
        agentControllerRef: "builtin:codex",
        nowMs: NOW_MS,
        report: {
          expiresAtMs: NOW_MS + 60_000,
          status: "ready",
          usageLimits: [createUsageLimit("available")],
        },
      })
    ).toEqual({ available: false });
  });
});
