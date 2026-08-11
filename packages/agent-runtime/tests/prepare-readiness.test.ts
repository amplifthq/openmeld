import { describe, expect, it } from "vitest";
import {
  assertPrepareOutputHasNoBindingWriteAction,
  assertPrepareOutputHasNoExecutableWorkAction,
  resolvePrepareReadinessFromAgentControllerReports,
  resolvePrepareReadinessSummary,
} from "../src";

describe("agent-runtime prepare readiness model", () => {
  it("does not treat a missing projection as ready", () => {
    expect(resolvePrepareReadinessSummary(null)).toEqual({
      ready: false,
      displayState: "unknown",
      reasonCodes: ["runtime.projection_missing"],
    });
  });

  it("does not treat stale or unavailable projections as ready", () => {
    expect(
      resolvePrepareReadinessSummary(
        {
          projectionStatus: "ready",
          allRunnableCapabilitiesPrepared: {
            status: "prepared",
          },
          reasonCodes: [],
          expiresAt: "2026-04-30T00:00:00.000Z",
        },
        {
          now: "2026-05-01T00:00:00.000Z",
        }
      )
    ).toEqual({
      ready: false,
      displayState: "stale",
      reasonCodes: ["runtime.projection_stale"],
    });

    expect(
      resolvePrepareReadinessSummary({
        projectionStatus: "unavailable",
        allRunnableCapabilitiesPrepared: {
          status: "prepared",
        },
        reasonCodes: ["runtime.projection_unavailable"],
      })
    ).toEqual({
      ready: false,
      displayState: "unavailable",
      reasonCodes: ["runtime.projection_unavailable"],
    });
  });

  it("requires all runnable capabilities to be prepared before returning ready", () => {
    expect(
      resolvePrepareReadinessSummary({
        projectionStatus: "ready",
        allRunnableCapabilitiesPrepared: {
          status: "prepared",
        },
        serviceReadiness: {
          status: "running",
        },
        reasonCodes: [],
      })
    ).toEqual({
      ready: true,
      displayState: "ready",
      reasonCodes: ["runtime.ready", "capability.ready", "service.ready"],
    });

    expect(
      resolvePrepareReadinessSummary({
        projectionStatus: "ready",
        allRunnableCapabilitiesPrepared: {
          status: "unknown",
        },
        reasonCodes: [],
      })
    ).toEqual({
      ready: false,
      displayState: "unknown",
      reasonCodes: ["capability.readiness_unknown"],
    });
  });

  it("does not let missing prepared capabilities become runtime readiness truth", () => {
    expect(
      resolvePrepareReadinessSummary({
        projectionStatus: "ready",
        allRunnableCapabilitiesPrepared: {
          status: "not_prepared",
        },
        reasonCodes: ["runtime.prepare_required"],
      })
    ).toEqual({
      ready: false,
      displayState: "needs_prepare",
      reasonCodes: ["runtime.prepare_required"],
    });
  });

  it("rejects prepare outputs that try to write Agent Profile Binding", () => {
    expect(() =>
      assertPrepareOutputHasNoBindingWriteAction({
        nextSteps: [
          {
            kind: "create_binding",
          },
        ],
      })
    ).toThrow("prepare.contract_invalid");
  });

  it("keeps missing Agent Controller availability reports explicit instead of ready", () => {
    expect(
      resolvePrepareReadinessFromAgentControllerReports({
        agentControllerRefsToEvaluate: ["builtin:codex"],
        currentReports: [],
        nowMs: 2000,
      })
    ).toMatchObject({
      nonRunnableCapabilities: [
        {
          agentControllerRef: "builtin:codex",
          reasonCodes: ["runtime.agent_controller_report_missing"],
          status: "missing",
        },
      ],
      runnableCapabilities: [],
      summary: {
        displayState: "needs_prepare",
        ready: false,
        reasonCodes: ["runtime.agent_controller_report_missing"],
      },
    });
  });

  it("keeps stale Agent Controller availability reports non-runnable", () => {
    expect(
      resolvePrepareReadinessFromAgentControllerReports({
        agentControllerRefsToEvaluate: ["builtin:codex"],
        currentReports: [
          {
            agentControllerRef: "builtin:codex",
            expiresAtMs: 2000,
            observedAtMs: 1000,
            reasonCodes: ["runtime.agent_controller_report.available"],
            status: "ready",
          },
        ],
        nowMs: 2000,
      })
    ).toMatchObject({
      nonRunnableCapabilities: [
        {
          agentControllerRef: "builtin:codex",
          reasonCodes: [
            "runtime.agent_controller_report_stale",
            "runtime.agent_controller_report.available",
          ],
          status: "stale",
        },
      ],
      runnableCapabilities: [],
      summary: {
        displayState: "stale",
        ready: false,
      },
    });
  });

  it.each([
    {
      expectedDisplayState: "needs_prepare",
      status: "disabled",
    },
    {
      expectedDisplayState: "unavailable",
      status: "unavailable",
    },
    {
      expectedDisplayState: "unknown",
      status: "unknown",
    },
  ] as const)("keeps $status Agent Controller availability reports non-runnable", ({
    expectedDisplayState,
    status,
  }) => {
    expect(
      resolvePrepareReadinessFromAgentControllerReports({
        agentControllerRefsToEvaluate: ["builtin:codex"],
        currentReports: [
          {
            agentControllerRef: "builtin:codex",
            expiresAtMs: 5000,
            observedAtMs: 1000,
            reasonCodes: [`runtime.agent_controller_report.${status}`],
            status,
          },
        ],
        nowMs: 2000,
      })
    ).toMatchObject({
      nonRunnableCapabilities: [
        {
          agentControllerRef: "builtin:codex",
          reasonCodes: [
            `runtime.agent_controller_report_${status}`,
            `runtime.agent_controller_report.${status}`,
          ],
          status,
        },
      ],
      runnableCapabilities: [],
      summary: {
        displayState: expectedDisplayState,
        ready: false,
      },
    });
  });

  it("uses a fresh ready Agent Controller availability report as runnable evidence only", () => {
    expect(
      resolvePrepareReadinessFromAgentControllerReports({
        agentControllerRefsToEvaluate: ["builtin:codex"],
        currentReports: [
          {
            agentControllerRef: "builtin:codex",
            expiresAtMs: 5000,
            observedAtMs: 1000,
            reasonCodes: [],
            status: "ready",
          },
        ],
        nowMs: 2000,
      })
    ).toMatchObject({
      nonRunnableCapabilities: [],
      projection: {
        allRunnableCapabilitiesPrepared: {
          status: "prepared",
        },
        projectionStatus: "ready",
      },
      runnableCapabilities: [
        {
          agentControllerRef: "builtin:codex",
          expiresAtMs: 5000,
          observedAtMs: 1000,
          status: "ready",
        },
      ],
      summary: {
        displayState: "ready",
        ready: true,
      },
    });
  });

  it("fails closed when a requested agentControllerRef is invalid", () => {
    expect(
      resolvePrepareReadinessFromAgentControllerReports({
        agentControllerRefsToEvaluate: ["codex"],
        currentReports: [
          {
            agentControllerRef: "builtin:codex",
            expiresAtMs: 5000,
            observedAtMs: 1000,
            reasonCodes: [],
            status: "ready",
          },
        ],
        nowMs: 2000,
      })
    ).toMatchObject({
      nonRunnableCapabilities: [
        {
          agentControllerRef: "codex",
          reasonCodes: ["runtime.agent_controller_ref_invalid"],
          status: "invalid",
        },
      ],
      runnableCapabilities: [],
      summary: {
        ready: false,
      },
    });
  });

  it.each([
    "join_space",
    "send_wake",
    "claim_dispatch",
    "write_result",
  ])("rejects prepare outputs that try to perform %s", (kind) => {
    expect(() =>
      assertPrepareOutputHasNoExecutableWorkAction({
        nextSteps: [
          {
            kind,
          },
        ],
      })
    ).toThrow("prepare.contract_invalid");
  });
});
