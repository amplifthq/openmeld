import { describe, expect, it } from "vitest";

import { resolveRuntimeReportingHealthDiagnostic } from "../src/local-service/diagnostics/runtime-reporting-health-diagnostic";

describe("runtime reporting health diagnostic", () => {
  it("does not warn when provider conversation proof reporting is not applicable after 31 minutes", () => {
    const result = resolveRuntimeReportingHealthDiagnostic({
      effectiveRuntimeStatus: "running",
      healthState: {
        schema: "openmeld-runtime-reporting-health-v1",
        v: 1,
        runtimeAgentController: {
          applicability: {
            observedAt: "2026-07-10T08:00:00.000Z",
            status: "applicable",
          },
          consecutiveFailures: 0,
          lastFailure: null,
          lastSuccessAt: "2026-07-10T08:29:00.000Z",
        },
        providerConversationProof: {
          applicability: {
            observedAt: "2026-07-10T08:00:00.000Z",
            status: "not_applicable",
          },
          consecutiveFailures: 0,
          lastFailure: null,
          lastSuccessAt: null,
        },
      },
      nowMs: Date.parse("2026-07-10T08:31:00.000Z"),
      runtimeStartedAt: "2026-07-10T08:00:00.000Z",
    });

    expect(result).toMatchObject({
      kind: "ok",
      message: "Local agent reporting is healthy.",
    });
  });

  it("starts fresh after service identity observations are reset", () => {
    const result = resolveRuntimeReportingHealthDiagnostic({
      effectiveRuntimeStatus: "running",
      healthState: {
        schema: "openmeld-runtime-reporting-health-v1",
        v: 1,
        serviceIdentityObservedAt: "2026-07-10T08:30:00.000Z",
        runtimeAgentController: {
          consecutiveFailures: 0,
          lastFailure: null,
          lastSuccessAt: null,
        },
        providerConversationProof: {
          consecutiveFailures: 0,
          lastFailure: null,
          lastSuccessAt: null,
        },
      },
      nowMs: Date.parse("2026-07-10T08:31:00.000Z"),
      runtimeStartedAt: "2026-07-10T07:00:00.000Z",
    });

    expect(result).toMatchObject({
      kind: "info",
      message: "Local agent reporting is starting.",
    });
  });

  it("reports healthy when both channels are healthy", () => {
    const result = resolveRuntimeReportingHealthDiagnostic({
      effectiveRuntimeStatus: "running",
      healthState: {
        schema: "openmeld-runtime-reporting-health-v1",
        v: 1,
        runtimeAgentController: {
          consecutiveFailures: 0,
          lastFailure: null,
          lastSuccessAt: "2026-07-10T08:25:00.000Z",
        },
        providerConversationProof: {
          consecutiveFailures: 0,
          lastFailure: null,
          lastSuccessAt: "2026-07-10T08:26:00.000Z",
        },
      },
      nowMs: Date.parse("2026-07-10T08:30:00.000Z"),
      runtimeStartedAt: "2026-07-10T08:00:00.000Z",
    });

    expect(result).toEqual({
      facts: {
        runtimeAgentController: {
          consecutiveFailures: 0,
          lastFailureAt: null,
          lastFailureReasonCode: null,
          lastSuccessAt: "2026-07-10T08:25:00.000Z",
        },
        providerConversationProof: {
          consecutiveFailures: 0,
          lastFailureAt: null,
          lastFailureReasonCode: null,
          lastSuccessAt: "2026-07-10T08:26:00.000Z",
        },
      },
      kind: "ok",
      message: "Local agent reporting is healthy.",
    });
  });

  it("warns when only runtimeAgentController is degraded, naming that channel", () => {
    const result = resolveRuntimeReportingHealthDiagnostic({
      effectiveRuntimeStatus: "running",
      healthState: {
        schema: "openmeld-runtime-reporting-health-v1",
        v: 1,
        runtimeAgentController: {
          consecutiveFailures: 3,
          lastFailure: {
            at: "2026-07-10T08:29:00.000Z",
            message: "authentication required",
            reasonCode: "runtime.reporting.authentication_required",
          },
          lastSuccessAt: "2026-07-10T08:20:00.000Z",
        },
        providerConversationProof: {
          consecutiveFailures: 0,
          lastFailure: null,
          lastSuccessAt: "2026-07-10T08:28:00.000Z",
        },
      },
      nowMs: Date.parse("2026-07-10T08:30:00.000Z"),
      runtimeStartedAt: "2026-07-10T08:00:00.000Z",
    });

    expect(result).toEqual({
      facts: {
        runtimeAgentController: {
          consecutiveFailures: 3,
          lastFailureAt: "2026-07-10T08:29:00.000Z",
          lastFailureReasonCode: "runtime.reporting.authentication_required",
          lastSuccessAt: "2026-07-10T08:20:00.000Z",
        },
        providerConversationProof: {
          consecutiveFailures: 0,
          lastFailureAt: null,
          lastFailureReasonCode: null,
          lastSuccessAt: "2026-07-10T08:28:00.000Z",
        },
      },
      kind: "warn",
      message:
        "Local agent version and status data may not be syncing to OpenMeld. Runtime agent controller reporting has 3 consecutive failures; last error: authentication required.",
    });
    expect(result.message).not.toContain("Provider conversation proof");
  });

  it("warns when only providerConversationProof is degraded, naming that channel", () => {
    const result = resolveRuntimeReportingHealthDiagnostic({
      effectiveRuntimeStatus: "running",
      healthState: {
        schema: "openmeld-runtime-reporting-health-v1",
        v: 1,
        runtimeAgentController: {
          consecutiveFailures: 0,
          lastFailure: null,
          lastSuccessAt: "2026-07-10T08:29:00.000Z",
        },
        providerConversationProof: {
          consecutiveFailures: 3,
          lastFailure: {
            at: "2026-07-10T08:29:00.000Z",
            message: "proof request timed out",
            reasonCode: "provider_conversation.runtime_reporting.write_failed",
          },
          lastSuccessAt: "2026-07-10T07:00:00.000Z",
        },
      },
      nowMs: Date.parse("2026-07-10T08:30:00.000Z"),
      runtimeStartedAt: "2026-07-10T08:00:00.000Z",
    });

    expect(result).toEqual({
      facts: {
        runtimeAgentController: {
          consecutiveFailures: 0,
          lastFailureAt: null,
          lastFailureReasonCode: null,
          lastSuccessAt: "2026-07-10T08:29:00.000Z",
        },
        providerConversationProof: {
          consecutiveFailures: 3,
          lastFailureAt: "2026-07-10T08:29:00.000Z",
          lastFailureReasonCode:
            "provider_conversation.runtime_reporting.write_failed",
          lastSuccessAt: "2026-07-10T07:00:00.000Z",
        },
      },
      kind: "warn",
      message:
        "Local agent version and status data may not be syncing to OpenMeld. Provider conversation proof reporting has 3 consecutive failures; last error: proof request timed out.",
    });
    expect(result.message).not.toContain("Runtime agent controller");
  });

  it("warns and lists both channels when both are degraded", () => {
    const result = resolveRuntimeReportingHealthDiagnostic({
      effectiveRuntimeStatus: "running",
      healthState: {
        schema: "openmeld-runtime-reporting-health-v1",
        v: 1,
        runtimeAgentController: {
          consecutiveFailures: 3,
          lastFailure: {
            at: "2026-07-10T08:29:00.000Z",
            message: "authentication required",
            reasonCode: "runtime.reporting.authentication_required",
          },
          lastSuccessAt: "2026-07-10T08:20:00.000Z",
        },
        providerConversationProof: {
          consecutiveFailures: 0,
          lastFailure: null,
          lastSuccessAt: "2026-07-10T07:59:59.999Z",
        },
      },
      nowMs: Date.parse("2026-07-10T08:30:00.000Z"),
      runtimeStartedAt: "2026-07-10T08:00:00.000Z",
    });

    expect(result).toEqual({
      facts: {
        runtimeAgentController: {
          consecutiveFailures: 3,
          lastFailureAt: "2026-07-10T08:29:00.000Z",
          lastFailureReasonCode: "runtime.reporting.authentication_required",
          lastSuccessAt: "2026-07-10T08:20:00.000Z",
        },
        providerConversationProof: {
          consecutiveFailures: 0,
          lastFailureAt: null,
          lastFailureReasonCode: null,
          lastSuccessAt: "2026-07-10T07:59:59.999Z",
        },
      },
      kind: "warn",
      message:
        "Local agent version and status data may not be syncing to OpenMeld. Runtime agent controller reporting has 3 consecutive failures; last error: authentication required. Provider conversation proof reporting has had no successful report in the last 30 minutes.",
    });
  });

  it("reports starting while neither channel has completed a first success", () => {
    const result = resolveRuntimeReportingHealthDiagnostic({
      effectiveRuntimeStatus: "running",
      healthState: {
        schema: "openmeld-runtime-reporting-health-v1",
        v: 1,
        runtimeAgentController: {
          consecutiveFailures: 2,
          lastFailure: {
            at: "2026-07-10T08:09:00.000Z",
            message: "OpenMeld reporting request timed out.",
            reasonCode: "runtime.reporting.write_failed",
          },
          lastSuccessAt: null,
        },
        providerConversationProof: {
          consecutiveFailures: 0,
          lastFailure: null,
          lastSuccessAt: null,
        },
      },
      nowMs: Date.parse("2026-07-10T08:10:00.000Z"),
      runtimeStartedAt: "2026-07-10T08:00:00.000Z",
    });

    expect(result).toMatchObject({
      kind: "info",
      message: "Local agent reporting is starting.",
    });
    expect(result.facts.runtimeAgentController).toMatchObject({
      consecutiveFailures: 2,
      lastFailureReasonCode: "runtime.reporting.write_failed",
      lastSuccessAt: null,
    });
    expect(result.facts.providerConversationProof).toMatchObject({
      consecutiveFailures: 0,
      lastSuccessAt: null,
    });
  });

  it("returns info without flagging degradation when the daemon is not running", () => {
    const result = resolveRuntimeReportingHealthDiagnostic({
      effectiveRuntimeStatus: "not_running",
      healthState: {
        schema: "openmeld-runtime-reporting-health-v1",
        v: 1,
        runtimeAgentController: {
          consecutiveFailures: 5,
          lastFailure: {
            at: "2026-07-10T08:29:00.000Z",
            message: "authentication required",
            reasonCode: "runtime.reporting.authentication_required",
          },
          lastSuccessAt: null,
        },
        providerConversationProof: {
          consecutiveFailures: 5,
          lastFailure: {
            at: "2026-07-10T08:29:00.000Z",
            message: "proof request timed out",
            reasonCode: "provider_conversation.runtime_reporting.write_failed",
          },
          lastSuccessAt: null,
        },
      },
      nowMs: Date.parse("2026-07-10T08:30:00.000Z"),
      runtimeStartedAt: "2026-07-10T08:00:00.000Z",
    });

    expect(result).toEqual({
      facts: {
        runtimeAgentController: {
          consecutiveFailures: 5,
          lastFailureAt: "2026-07-10T08:29:00.000Z",
          lastFailureReasonCode: "runtime.reporting.authentication_required",
          lastSuccessAt: null,
        },
        providerConversationProof: {
          consecutiveFailures: 5,
          lastFailureAt: "2026-07-10T08:29:00.000Z",
          lastFailureReasonCode:
            "provider_conversation.runtime_reporting.write_failed",
          lastSuccessAt: null,
        },
      },
      kind: "info",
      message:
        "Local agent reporting health is available when OpenMeld Service is running.",
    });
  });
});
