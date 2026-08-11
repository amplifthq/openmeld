import { createAgentProfileBindingDisplayProjection } from "@openmeld/agent-runtime";
import { describe, expect, it } from "vitest";
import {
  buildServiceTraceAgentExecutionStatus,
  buildServiceTraceAgentExecutionStatusRows,
  buildServiceTraceEvidenceSyncHealth,
  buildServiceTraceLocalExecutionDiagnosticRows,
} from "../src/commands/service-trace-agent-execution-status";

const READY_PREFIX_RE = /^(?:Ready|Available for Wake)\b/u;

describe("service trace agent execution status", () => {
  it("builds the underlying local execution projection from connection, prepare, and route evidence", () => {
    const projection = buildServiceTraceAgentExecutionStatus({
      agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
      binding: createAgentProfileBindingDisplayProjection({
        agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
        bindingId: "bind_11111111-1111-4111-8111-111111111111",
        bindingState: "enabled_primary",
        executionTarget: {
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
        },
      }),
      executionAuthorityDiagnostics: {
        reasonCodes: ["runtime_coordinator.execution_authority_present"],
        status: "accepted",
      },
      prepareReadiness: {
        nonRunnableCapabilityCount: 0,
        reasonCodes: ["runtime.ready"],
        runnableCapabilityCount: 1,
        source: "prepare_readiness_api",
        status: "ready",
      },
      route: {
        observedAt: "2026-05-10T12:00:00.000Z",
        status: "online",
      },
    });

    expect(buildServiceTraceAgentExecutionStatusRows(projection)).toEqual(
      expect.arrayContaining([
        {
          label: "Reply status",
          value:
            "Available for Wake · This agent can reply from this computer.",
        },
        {
          label: "Connection",
          value: "Local agent connection is set.",
        },
        {
          label: "Local agent capability",
          value: "Local agent capability is current.",
        },
        {
          label: "Reply route",
          value: "OpenMeld Service is online for replies.",
        },
        {
          label: "Wake",
          value: "Wake is available from this computer.",
        },
      ])
    );
    expect(projection.facts.claim).toMatchObject({
      executionBlocked: false,
      grantsClaimSuccess: false,
    });
    expect(projection).not.toHaveProperty("runtimeExecutionSucceeded");
  });

  it("builds owner-only EvidenceSyncHealth from trace execution evidence", () => {
    const projection = buildServiceTraceAgentExecutionStatus({
      agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
      binding: createAgentProfileBindingDisplayProjection({
        agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
        bindingId: "bind_11111111-1111-4111-8111-111111111111",
        bindingState: "enabled_primary",
        executionTarget: {
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
        },
      }),
      executionAuthorityDiagnostics: {
        reasonCodes: ["runtime_coordinator.execution_authority_present"],
        status: "accepted",
      },
      prepareReadiness: {
        nonRunnableCapabilityCount: 0,
        reasonCodes: ["runtime.ready"],
        runnableCapabilityCount: 1,
        source: "prepare_readiness_api",
        status: "ready",
      },
      route: {
        observedAt: "2026-05-10T12:00:00.000Z",
        status: "online",
      },
    });

    const health = buildServiceTraceEvidenceSyncHealth({
      generatedAt: "2026-06-11T07:05:00.000Z",
      projection,
    });

    expect(health).toMatchObject({
      authoritative: false,
      scope: "owner_diagnostics",
      source: "evidence_sync_health",
      useInstead: ["AgentWakeAvailability", "openmeld service trace"],
      verdict: "not_wake_readiness",
    });
    expect(health.channels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "route_catalog_sync",
          lastSuccessAt: "2026-05-10T12:00:00.000Z",
          status: "healthy",
        }),
        expect.objectContaining({
          id: "execution_authority_diagnostic",
          role: "owner_diagnostic",
          status: "healthy",
        }),
      ])
    );
  });

  it("formats local execution diagnostics without presenting local evidence as Ready authority", () => {
    const projection = buildServiceTraceAgentExecutionStatus({
      agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
      binding: createAgentProfileBindingDisplayProjection({
        agentProfileId: "agt_11111111-1111-4111-8111-111111111111",
        bindingId: "bind_11111111-1111-4111-8111-111111111111",
        bindingState: "enabled_primary",
        executionTarget: {
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
        },
      }),
      executionAuthorityDiagnostics: {
        reasonCodes: ["runtime_coordinator.execution_authority_present"],
        status: "accepted",
      },
      prepareReadiness: {
        nonRunnableCapabilityCount: 0,
        reasonCodes: ["runtime.ready"],
        runnableCapabilityCount: 1,
        source: "prepare_readiness_api",
        status: "ready",
      },
      route: {
        observedAt: "2026-05-10T12:00:00.000Z",
        status: "online",
      },
    });

    const rows = buildServiceTraceLocalExecutionDiagnosticRows(projection);
    expect(rows).toEqual(
      expect.arrayContaining([
        {
          label: "Current Local Execution Projection",
          value:
            "Local evidence: reply-capable · This agent can reply from this computer.",
        },
        {
          label: "Current Binding Evidence",
          value: "Local agent connection is set.",
        },
        {
          label: "Current Local Agent Capability",
          value: "Local agent capability is current.",
        },
        {
          label: "OpenMeld Service",
          value:
            "OpenMeld Service can check this agent again on this computer.",
        },
        {
          label: "Current Daemon Route Evidence",
          value: "OpenMeld Service is online for replies.",
        },
        {
          label: "Current Wake Diagnostic",
          value:
            "Local evidence says Wake can be attempted from this computer.",
        },
      ])
    );
    expect(rows).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Reply status",
        }),
      ])
    );
    expect(rows).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          value: expect.stringMatching(READY_PREFIX_RE),
        }),
      ])
    );
  });

  it("shows a missing local connection as not ready", () => {
    const projection = buildServiceTraceAgentExecutionStatus({
      agentProfileId: "agt_22222222-2222-4222-8222-222222222222",
      prepareReadiness: {
        nonRunnableCapabilityCount: 0,
        reasonCodes: ["runtime.ready"],
        runnableCapabilityCount: 1,
        source: "prepare_readiness_api",
        status: "ready",
      },
      route: {
        observedAt: "2026-05-10T12:00:00.000Z",
        status: "online",
      },
    });

    expect(buildServiceTraceAgentExecutionStatusRows(projection)).toEqual(
      expect.arrayContaining([
        {
          label: "Reply status",
          value:
            "Unavailable · This agent is not connected to a local agent yet.",
        },
        {
          label: "Connection",
          value: "Choose a local agent for this profile.",
        },
      ])
    );
  });

  it("fails closed when the local connection belongs to another agent profile", () => {
    const projection = buildServiceTraceAgentExecutionStatus({
      agentProfileId: "agt_33333333-3333-4333-8333-333333333333",
      binding: createAgentProfileBindingDisplayProjection({
        agentProfileId: "agt_99999999-9999-4999-8999-999999999999",
        bindingId: "bind_33333333-3333-4333-8333-333333333333",
        bindingState: "enabled_primary",
        executionTarget: {
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
        },
      }),
      prepareReadiness: {
        nonRunnableCapabilityCount: 0,
        reasonCodes: ["runtime.ready"],
        runnableCapabilityCount: 1,
        source: "prepare_readiness_api",
        status: "ready",
      },
      route: {
        observedAt: "2026-05-10T12:00:00.000Z",
        status: "online",
      },
    });

    expect(buildServiceTraceAgentExecutionStatusRows(projection)).toEqual(
      expect.arrayContaining([
        {
          label: "Reply status",
          value:
            "Blocked · This local connection belongs to a different agent profile.",
        },
        {
          label: "Connection",
          value: "This local connection belongs to a different agent profile.",
        },
      ])
    );
  });

  it("shows Binding read failures as unavailable instead of missing truth", () => {
    const projection = buildServiceTraceAgentExecutionStatus({
      agentProfileId: "agt_55555555-5555-4555-8555-555555555555",
      binding: {
        reasonCodes: ["agent_profile_binding.read_unavailable"],
        status: "unavailable",
      },
      prepareReadiness: {
        nonRunnableCapabilityCount: 0,
        reasonCodes: ["runtime.ready"],
        runnableCapabilityCount: 1,
        source: "prepare_readiness_api",
        status: "ready",
      },
      route: {
        observedAt: "2026-05-10T12:00:00.000Z",
        status: "online",
      },
    });

    expect(buildServiceTraceAgentExecutionStatusRows(projection)).toEqual(
      expect.arrayContaining([
        {
          label: "Reply status",
          value:
            "Unavailable · OpenMeld could not check this agent's local connection.",
        },
        {
          label: "Connection",
          value: "OpenMeld could not check this agent's local connection.",
        },
      ])
    );
  });

  it("keeps not-checked Binding evidence distinct from missing Binding truth", () => {
    const projection = buildServiceTraceAgentExecutionStatus({
      agentProfileId: "agt_77777777-7777-4777-8777-777777777777",
      binding: {
        reasonCodes: ["not_requested"],
        status: "not_checked",
      },
    });

    expect(projection.facts.binding).toEqual({
      reasonCodes: ["not_requested"],
      routable: false,
      source: "not_checked",
    });
    expect(buildServiceTraceAgentExecutionStatusRows(projection)).toEqual(
      expect.arrayContaining([
        {
          label: "Connection",
          value:
            "Local agent connection has not been checked for this profile.",
        },
      ])
    );
  });

  it("shows Prepare readiness read failures as unavailable instead of missing truth", () => {
    const projection = buildServiceTraceAgentExecutionStatus({
      agentProfileId: "agt_66666666-6666-4666-8666-666666666666",
      binding: createAgentProfileBindingDisplayProjection({
        agentProfileId: "agt_66666666-6666-4666-8666-666666666666",
        bindingId: "bind_66666666-6666-4666-8666-666666666666",
        bindingState: "enabled_primary",
        executionTarget: {
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
        },
      }),
      prepareReadiness: {
        nonRunnableCapabilityCount: 0,
        reason: "read_failed",
        reasonCodes: ["prepare_readiness.read_failed"],
        runnableCapabilityCount: 0,
        source: "prepare_readiness_api",
        status: "unavailable",
      },
    });

    expect(buildServiceTraceAgentExecutionStatusRows(projection)).toEqual(
      expect.arrayContaining([
        {
          label: "Reply status",
          value: "Unavailable · no supporting evidence",
        },
        {
          label: "Local agent capability",
          value:
            "OpenMeld could not check this computer for local agent support.",
        },
      ])
    );
  });

  it("shows accepted execution authority without granting Runtime execution success", () => {
    const projection = buildServiceTraceAgentExecutionStatus({
      agentProfileId: "agt_44444444-4444-4444-8444-444444444444",
      binding: createAgentProfileBindingDisplayProjection({
        agentProfileId: "agt_44444444-4444-4444-8444-444444444444",
        bindingId: "bind_44444444-4444-4444-8444-444444444444",
        bindingState: "enabled_primary",
        executionTarget: {
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
        },
      }),
      executionAuthorityDiagnostics: {
        reasonCodes: ["runtime_coordinator.execution_authority_present"],
        status: "accepted",
      },
      prepareReadiness: {
        nonRunnableCapabilityCount: 0,
        reasonCodes: ["runtime.ready"],
        runnableCapabilityCount: 1,
        source: "prepare_readiness_api",
        status: "ready",
      },
      route: {
        observedAt: "2026-05-10T12:00:00.000Z",
        status: "online",
      },
    });

    expect(buildServiceTraceAgentExecutionStatusRows(projection)).toEqual(
      expect.arrayContaining([
        {
          label: "Reply status",
          value:
            "Available for Wake · This agent can reply from this computer.",
        },
        {
          label: "Wake",
          value: "Wake is available from this computer.",
        },
      ])
    );
    expect(projection.facts.claim).toMatchObject({
      executionBlocked: false,
      grantsClaimSuccess: false,
    });
  });

  it("keeps missing execution authority diagnostic-only when a RuntimeCoordinator execution is present", () => {
    const projection = buildServiceTraceAgentExecutionStatus({
      agentProfileId: "agt_99999999-9999-4999-8999-999999999999",
      binding: createAgentProfileBindingDisplayProjection({
        agentProfileId: "agt_99999999-9999-4999-8999-999999999999",
        bindingId: "bind_99999999-9999-4999-8999-999999999999",
        bindingState: "enabled_primary",
        executionTarget: {
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
        },
      }),
      executionAuthorityDiagnostics: {
        reasonCodes: ["execution_authority.missing"],
        status: "unavailable",
      },
      prepareReadiness: {
        nonRunnableCapabilityCount: 0,
        reasonCodes: ["runtime.ready"],
        runnableCapabilityCount: 1,
        source: "prepare_readiness_api",
        status: "ready",
      },
      route: {
        observedAt: "2026-05-10T12:00:00.000Z",
        status: "online",
      },
      runtimeCoordinatorExecutionId: "rce-runtime-coordinator",
    });

    expect(projection.facts.claim).toMatchObject({
      executionBlocked: false,
      grantsClaimSuccess: false,
      reasonCodes: ["runtime_coordinator.execution_authority_present"],
    });
    expect(buildServiceTraceAgentExecutionStatusRows(projection)).toEqual(
      expect.arrayContaining([
        {
          label: "Reply status",
          value:
            "Available for Wake · This agent can reply from this computer.",
        },
        {
          label: "Wake",
          value: "Wake is available from this computer.",
        },
      ])
    );
  });

  it("keeps missing execution authority blocking when no RuntimeCoordinator boundary is present", () => {
    const projection = buildServiceTraceAgentExecutionStatus({
      agentProfileId: "agt_88888888-8888-4888-8888-888888888888",
      binding: createAgentProfileBindingDisplayProjection({
        agentProfileId: "agt_88888888-8888-4888-8888-888888888888",
        bindingId: "bind_88888888-8888-4888-8888-888888888888",
        bindingState: "enabled_primary",
        executionTarget: {
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
        },
      }),
      executionAuthorityDiagnostics: {
        reasonCodes: ["execution_authority.missing"],
        status: "unavailable",
      },
      prepareReadiness: {
        nonRunnableCapabilityCount: 0,
        reasonCodes: ["runtime.ready"],
        runnableCapabilityCount: 1,
        source: "prepare_readiness_api",
        status: "ready",
      },
      route: {
        observedAt: "2026-05-10T12:00:00.000Z",
        status: "online",
      },
    });

    expect(projection.facts.claim).toMatchObject({
      executionBlocked: true,
      grantsClaimSuccess: false,
      reasonCodes: ["execution_authority.missing"],
    });
    expect(buildServiceTraceAgentExecutionStatusRows(projection)).toEqual(
      expect.arrayContaining([
        {
          label: "Reply status",
          value: "Blocked · Wake execution authority is missing.",
        },
      ])
    );
  });

  it("treats missing execution authority as diagnostic-only when RuntimeCoordinator creation already failed", () => {
    const projection = buildServiceTraceAgentExecutionStatus({
      agentProfileId: "agt_99999999-9999-4999-8999-999999999999",
      binding: createAgentProfileBindingDisplayProjection({
        agentProfileId: "agt_99999999-9999-4999-8999-999999999999",
        bindingId: "bind_99999999-9999-4999-8999-999999999999",
        bindingState: "enabled_primary",
        executionTarget: {
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D5",
        },
      }),
      executionAuthorityDiagnostics: {
        reasonCodes: ["execution_authority.missing"],
        status: "unavailable",
      },
      prepareReadiness: {
        nonRunnableCapabilityCount: 0,
        reasonCodes: ["runtime.ready"],
        runnableCapabilityCount: 1,
        source: "prepare_readiness_api",
        status: "ready",
      },
      route: {
        observedAt: "2026-05-10T12:00:00.000Z",
        reasonCodes: [
          "agent_execution.route_offline",
          "daemon_route.daemon.profile.offline",
        ],
        status: "offline",
      },
      runtimeCoordinatorCreationReasonCode: "daemon.profile.offline",
    });

    expect(projection.facts.claim).toMatchObject({
      executionBlocked: false,
      grantsClaimSuccess: false,
      reasonCodes: [
        "runtime_coordinator.execution_creation_failed",
        "daemon.profile.offline",
      ],
    });
    expect(buildServiceTraceAgentExecutionStatusRows(projection)).not.toEqual(
      expect.arrayContaining([
        {
          label: "Reply status",
          value: "Blocked · Wake execution authority is missing.",
        },
      ])
    );
  });
});
