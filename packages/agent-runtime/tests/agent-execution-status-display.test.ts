import { describe, expect, it } from "vitest";
import {
  createAgentExecutionStatusDisplayRows,
  createAgentProfileBindingDisplayProjection,
  resolveAgentExecutionStatus,
} from "../src";

describe("agent execution status display rows", () => {
  const onlineRoute = {
    deviceId: "device_11111111-1111-4111-8111-111111111111",
    observedAt: "2026-05-09T12:00:00.000Z",
    status: "online" as const,
  };

  it("renders ready with user-facing status text", () => {
    const projection = resolveAgentExecutionStatus({
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
      route: onlineRoute,
      runtimeReadiness: {
        displayState: "ready",
        ready: true,
        reasonCodes: ["runtime.ready"],
      },
    });

    expect(createAgentExecutionStatusDisplayRows(projection)).toEqual(
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
      ])
    );
  });

  it("renders missing Binding as not ready", () => {
    const projection = resolveAgentExecutionStatus({
      agentProfileId: "agt_22222222-2222-4222-8222-222222222222",
      route: onlineRoute,
      runtimeReadiness: {
        displayState: "ready",
        ready: true,
        reasonCodes: ["runtime.ready"],
      },
    });

    expect(createAgentExecutionStatusDisplayRows(projection)).toEqual(
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

  it("renders duplicate controller conversation Binding conflicts explicitly", () => {
    const projection = resolveAgentExecutionStatus({
      agentProfileId: "agt_23232323-2323-4232-8232-232323232323",
      binding: {
        reasonCodes: ["agent_profile_binding.controller_conversation_conflict"],
        status: "unavailable",
      },
      route: onlineRoute,
      runtimeReadiness: {
        displayState: "ready",
        ready: true,
        reasonCodes: ["runtime.ready"],
      },
    });

    expect(createAgentExecutionStatusDisplayRows(projection)).toEqual(
      expect.arrayContaining([
        {
          label: "Reply status",
          value:
            "Unavailable · This agent shares a reply conversation with another Agent Profile.",
        },
        {
          label: "Connection",
          value:
            "This agent shares a reply conversation with another Agent Profile.",
        },
      ])
    );
  });

  it("renders local connection mismatch as blocked", () => {
    const projection = resolveAgentExecutionStatus({
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
      route: onlineRoute,
      runtimeReadiness: {
        displayState: "ready",
        ready: true,
        reasonCodes: ["runtime.ready"],
      },
    });

    expect(createAgentExecutionStatusDisplayRows(projection)).toEqual(
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

  it("renders unavailable Binding and Prepare readiness separately from missing truth", () => {
    expect(
      createAgentExecutionStatusDisplayRows(
        resolveAgentExecutionStatus({
          agentProfileId: "agt_44444444-4444-4444-8444-444444444444",
          binding: {
            reasonCodes: ["agent_profile_binding.read_unavailable"],
            status: "unavailable",
          },
          route: onlineRoute,
          runtimeReadiness: {
            displayState: "ready",
            ready: true,
            reasonCodes: ["runtime.ready"],
          },
        })
      )
    ).toEqual(
      expect.arrayContaining([
        {
          label: "Connection",
          value: "OpenMeld could not check this agent's local connection.",
        },
      ])
    );

    expect(
      createAgentExecutionStatusDisplayRows(
        resolveAgentExecutionStatus({
          agentProfileId: "agt_55555555-5555-4555-8555-555555555555",
          binding: createAgentProfileBindingDisplayProjection({
            agentProfileId: "agt_55555555-5555-4555-8555-555555555555",
            bindingId: "bind_55555555-5555-4555-8555-555555555555",
            bindingState: "enabled_primary",
            executionTarget: {
              agentControllerRef: "builtin:codex",
              openMeldServiceRuntimeId:
                "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
            },
          }),
          route: onlineRoute,
          runtimeReadiness: {
            displayState: "unavailable",
            ready: false,
            reasonCodes: ["prepare_readiness.read_failed"],
          },
        })
      )
    ).toEqual(
      expect.arrayContaining([
        {
          label: "Local agent capability",
          value:
            "OpenMeld could not check this computer for local agent support.",
        },
      ])
    );
  });

  it("renders claim diagnostics without implying Runtime execution success", () => {
    const accepted = createAgentExecutionStatusDisplayRows(
      resolveAgentExecutionStatus({
        agentProfileId: "agt_66666666-6666-4666-8666-666666666666",
        claimDiagnostics: {
          reasonCodes: ["runtime_coordinator.execution_authority_present"],
          status: "accepted",
        },
      })
    );
    expect(accepted).toContainEqual({
      label: "Wake",
      value:
        "Wake is waiting for this computer to check local agent support again.",
    });

    const rejected = createAgentExecutionStatusDisplayRows(
      resolveAgentExecutionStatus({
        agentProfileId: "agt_77777777-7777-4777-8777-777777777777",
        binding: createAgentProfileBindingDisplayProjection({
          agentProfileId: "agt_77777777-7777-4777-8777-777777777777",
          bindingId: "bind_77777777-7777-4777-8777-777777777777",
          bindingState: "enabled_primary",
          executionTarget: {
            agentControllerRef: "builtin:codex",
            openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
          },
        }),
        claimDiagnostics: {
          reasonCodes: ["execution_authority.missing"],
          status: "rejected",
        },
        route: onlineRoute,
        runtimeReadiness: {
          displayState: "ready",
          ready: true,
          reasonCodes: ["runtime.ready"],
        },
      })
    );
    expect(rejected).toContainEqual({
      label: "Reply status",
      value: "Blocked · Wake execution authority is missing.",
    });
    expect(rejected).toContainEqual({
      label: "Wake",
      value: "Wake execution authority is missing.",
    });
  });

  it("does not expose raw Agent Controller availability reason codes", () => {
    const rows = createAgentExecutionStatusDisplayRows(
      resolveAgentExecutionStatus({
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
        route: onlineRoute,
        runtimeReadiness: {
          displayState: "stale",
          ready: false,
          reasonCodes: ["runtime.agent_controller_report_stale"],
        },
      })
    );

    expect(rows).toContainEqual({
      label: "Reply status",
      value: "Unavailable · This computer's setup check is out of date.",
    });
    expect(JSON.stringify(rows)).not.toContain(
      "runtime.agent_controller_report_stale"
    );
  });

  it("describes an offline refreshable reply route without claiming an active reconnect task", () => {
    const rows = createAgentExecutionStatusDisplayRows(
      resolveAgentExecutionStatus({
        agentProfileId: "agt_89898989-8989-4898-8989-898989898989",
        binding: createAgentProfileBindingDisplayProjection({
          agentProfileId: "agt_89898989-8989-4898-8989-898989898989",
          bindingId: "bind_89898989-8989-4898-8989-898989898989",
          bindingState: "enabled_primary",
          executionTarget: {
            agentControllerRef: "builtin:codex",
            openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
          },
        }),
        localService: {
          reachable: true,
          refreshable: true,
          reasonCodes: ["local_service.refresh_in_progress"],
          source: "runtime_transport",
        },
        route: {
          observedAt: "2026-05-09T12:00:00.000Z",
          reasonCodes: [
            "agent_execution.route_offline",
            "route.not_registered",
          ],
          status: "offline",
        },
        runtimeReadiness: {
          displayState: "ready",
          ready: true,
          reasonCodes: ["runtime.ready"],
        },
      })
    );

    expect(rows).toContainEqual({
      label: "Reply status",
      value:
        "Unavailable · OpenMeld is checking this agent's local reply route.",
    });
    expect(rows).toContainEqual({
      label: "Reply route",
      value: "OpenMeld is checking this agent's local reply route.",
    });
  });

  it("does not expose raw claim eligibility reason codes", () => {
    const rows = createAgentExecutionStatusDisplayRows(
      resolveAgentExecutionStatus({
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
        claimDiagnostics: {
          reasonCodes: [
            "claim_eligibility.openmeld_service_runtime_id_mismatch",
          ],
          status: "mismatch",
        },
        route: onlineRoute,
        runtimeReadiness: {
          displayState: "ready",
          ready: true,
          reasonCodes: ["runtime.ready"],
        },
      })
    );

    expect(rows).toContainEqual({
      label: "Reply status",
      value: "Blocked · This agent is connected to an older computer setup.",
    });
    expect(JSON.stringify(rows)).not.toContain(
      "claim_eligibility.openmeld_service_runtime_id_mismatch"
    );
  });

  it("does not let historical delivery impact override current ready facts", () => {
    const rows = createAgentExecutionStatusDisplayRows(
      resolveAgentExecutionStatus({
        agentProfileId: "agt_96969696-9696-4969-8969-969696969696",
        binding: createAgentProfileBindingDisplayProjection({
          agentProfileId: "agt_96969696-9696-4969-8969-969696969696",
          bindingId: "bind_96969696-9696-4969-8969-969696969696",
          bindingState: "enabled_primary",
          executionTarget: {
            agentControllerRef: "builtin:codex",
            openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
          },
        }),
        readinessImpact: {
          blocked: true,
          expiresAtMs: 1_770_001_800_000,
          impactKind: "local_execution",
          observedAtMs: 1_770_000_000_000,
          reasonCodes: ["runtime_coordinator.delivery_expired"],
          source: "wake_failure",
        },
        route: onlineRoute,
        runtimeReadiness: {
          displayState: "ready",
          ready: true,
          reasonCodes: ["runtime.ready"],
        },
      })
    );

    expect(rows).toContainEqual({
      label: "Reply status",
      value: "Available for Wake · This agent can reply from this computer.",
    });
    expect(JSON.stringify(rows)).not.toContain(
      "runtime_coordinator.delivery_expired"
    );
  });

  it.each([
    "controller.launch.choice_required",
    "controller.launch.needs_repair",
    "controller.client.upgrade_required",
    "controller.runtime.missing",
    "workspace.invalid",
    "workspace.missing",
  ] as const)("does not let historical readiness impact %s override current ready facts", (reasonCode) => {
    const rows = createAgentExecutionStatusDisplayRows(
      resolveAgentExecutionStatus({
        agentProfileId: "agt_96969696-9696-4969-8969-969696969696",
        binding: createAgentProfileBindingDisplayProjection({
          agentProfileId: "agt_96969696-9696-4969-8969-969696969696",
          bindingId: "bind_96969696-9696-4969-8969-969696969696",
          bindingState: "enabled_primary",
          executionTarget: {
            agentControllerRef: "builtin:codex",
            openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
          },
        }),
        readinessImpact: {
          blocked: true,
          expiresAtMs: 1_770_001_800_000,
          impactKind: "local_execution",
          observedAtMs: 1_770_000_000_000,
          reasonCodes: [reasonCode],
          source: "wake_failure",
        },
        route: onlineRoute,
        runtimeReadiness: {
          displayState: "ready",
          ready: true,
          reasonCodes: ["runtime.ready"],
        },
      })
    );

    expect(rows).toContainEqual({
      label: "Reply status",
      value: "Available for Wake · This agent can reply from this computer.",
    });
    expect(JSON.stringify(rows)).not.toContain(reasonCode);
  });

  it.each([
    "service.update_required",
    "background_helper.update_required",
    "daemon.runtime_contract.mismatch",
  ])("renders update-required service reasons as an update action: %s", (reasonCode) => {
    const rows = createAgentExecutionStatusDisplayRows(
      resolveAgentExecutionStatus({
        agentProfileId: "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        binding: createAgentProfileBindingDisplayProjection({
          agentProfileId: "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          bindingId: "bind_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          bindingState: "enabled_primary",
          executionTarget: {
            agentControllerRef: "builtin:codex",
            openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
          },
        }),
        route: onlineRoute,
        runtimeReadiness: {
          displayState: "needs_repair",
          ready: false,
          reasonCodes: [reasonCode],
        },
      })
    );

    expect(rows).toContainEqual({
      label: "Reply status",
      value:
        "Unavailable · OpenMeld Service needs an update before this agent can reply from this computer.",
    });
    expect(JSON.stringify(rows)).not.toContain(reasonCode);
  });

  it("renders missing runtime contract evidence without an update action", () => {
    const rows = createAgentExecutionStatusDisplayRows(
      resolveAgentExecutionStatus({
        agentProfileId: "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        binding: createAgentProfileBindingDisplayProjection({
          agentProfileId: "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          bindingId: "bind_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          bindingState: "enabled_primary",
          executionTarget: {
            agentControllerRef: "builtin:codex",
            openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
          },
        }),
        route: onlineRoute,
        runtimeReadiness: {
          displayState: "needs_repair",
          ready: false,
          reasonCodes: ["daemon.runtime_contract.missing"],
        },
      })
    );

    expect(rows).toContainEqual({
      label: "Reply status",
      value:
        "Unavailable · OpenMeld Service has not reported execution compatibility yet.",
    });
    expect(JSON.stringify(rows)).not.toContain("needs an update");
  });

  it("renders OpenMeld Service execution contract failures as update required", () => {
    const rows = createAgentExecutionStatusDisplayRows(
      resolveAgentExecutionStatus({
        agentProfileId: "agt_abababab-abab-4bab-8bab-abababababab",
        binding: createAgentProfileBindingDisplayProjection({
          agentProfileId: "agt_abababab-abab-4bab-8bab-abababababab",
          bindingId: "bind_abababab-abab-4bab-8bab-abababababab",
          bindingState: "enabled_primary",
          executionTarget: {
            agentControllerRef: "builtin:codex",
            openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
          },
        }),
        localService: {
          reachable: true,
          refreshable: false,
          reasonCodes: [],
          source: "runtime_transport",
        },
        route: onlineRoute,
        runtimeReadiness: {
          displayState: "ready",
          ready: true,
          reasonCodes: ["runtime.ready"],
        },
        service: {
          executionCompatible: false,
          expectedEpoch: "daemon-runtime-epoch-current",
          observedEpoch: "daemon-runtime-epoch-previous",
          reasonCodes: [
            "service.update_required",
            "daemon.runtime_contract.mismatch",
          ],
          source: "runtime_transport",
        },
      })
    );

    expect(rows).toContainEqual({
      label: "Reply status",
      value:
        "Blocked · OpenMeld Service needs an update before this agent can reply from this computer.",
    });
    expect(rows).toContainEqual({
      label: "OpenMeld Service",
      value:
        "OpenMeld Service needs an update before this agent can reply from this computer.",
    });
  });

  it.each([
    {
      reasonCode: "claim_eligibility.binding_runtime_mismatch",
      status: "Blocked · This agent is connected to an older computer setup.",
    },
    {
      reasonCode: "claim_eligibility.binding_capability_mismatch",
      status:
        "Blocked · This agent is connected to a different local agent setup.",
    },
    {
      reasonCode: "claim_eligibility.agent_controller_report_stale",
      status: "Blocked · This computer's setup check is out of date.",
    },
  ])("renders concrete claim readiness reasons: $reasonCode", ({
    reasonCode,
    status,
  }) => {
    const rows = createAgentExecutionStatusDisplayRows(
      resolveAgentExecutionStatus({
        agentProfileId: "agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        binding: createAgentProfileBindingDisplayProjection({
          agentProfileId: "agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          bindingId: "bind_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          bindingState: "enabled_primary",
          executionTarget: {
            agentControllerRef: "builtin:codex",
            openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
          },
        }),
        claimDiagnostics: {
          reasonCodes: [reasonCode],
          status: "mismatch",
        },
        route: onlineRoute,
        runtimeReadiness: {
          displayState: "ready",
          ready: true,
          reasonCodes: ["runtime.ready"],
        },
      })
    );

    expect(rows).toContainEqual({
      label: "Reply status",
      value: status,
    });
    expect(JSON.stringify(rows)).not.toContain(reasonCode);
    expect(JSON.stringify(rows)).not.toContain(
      "Wake cannot use this local connection for this agent yet."
    );
  });

  it("prefers the actionable claim reason over the umbrella blocked code", () => {
    const rows = createAgentExecutionStatusDisplayRows(
      resolveAgentExecutionStatus({
        agentProfileId: "agt_cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        binding: createAgentProfileBindingDisplayProjection({
          agentProfileId: "agt_cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          bindingId: "bind_cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          bindingState: "enabled_primary",
          executionTarget: {
            agentControllerRef: "builtin:codex",
            openMeldServiceRuntimeId: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
          },
        }),
        claimDiagnostics: {
          reasonCodes: [
            "dispatch.claim_eligibility.blocked",
            "dispatch.claim_eligibility.binding.owner_mismatch",
          ],
          status: "mismatch",
        },
        route: onlineRoute,
        runtimeReadiness: {
          displayState: "ready",
          ready: true,
          reasonCodes: ["runtime.ready"],
        },
      })
    );

    expect(rows).toContainEqual({
      label: "Reply status",
      value:
        "Blocked · This agent is connected to a different OpenMeld account.",
    });
    expect(JSON.stringify(rows)).not.toContain(
      "No local agent has been selected to reply for this agent yet."
    );
  });
});
