import {
  createDaemonRouteObservationSummary,
  resolveMappedPublicAgentFailureReason,
  resolvePublicAgentFailureRecovery,
} from "@openmeld/schemas";
import {
  createSpaceMemberAgentExecutionReadiness,
  createSpaceMemberAgentSnapshot,
} from "@openmeld/schemas/testing";
import type { SpaceMemberAgentSnapshot } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
  type AgentProfileReplyReadinessEvidence,
  isAgentProfileLocalReadinessRefreshReasonCode,
  planAgentProfileReplyRecovery,
  type SelectableLocalAgentTarget,
} from "../src";

describe("planAgentProfileReplyRecovery", () => {
  it("does not invent a recovery action when readiness contains only a blank reason code", () => {
    const plan = planAgentProfileReplyRecovery({
      member: createBlockedAgent({
        agentExecutionReadiness: createSpaceMemberAgentExecutionReadiness({
          displayState: "not_ready",
          facts: {
            binding: {
              reasonCodes: [],
              routable: true,
              source: "binding_truth",
            },
          },
          primaryAction: "check_status",
          reasonCodes: [],
        }),
        profileName: "Codex",
        wakeabilityReasonCodes: [],
      }),
      profileReplyReadinessEvidence: createProfileReplyReadinessEvidence({
        level: "blocked",
        reasonCodes: [""],
      }),
    });

    expect(plan).toEqual({ kind: "none" });
  });

  it.each([
    "agent_profile_binding.agent_controller_report_missing",
    "agent_profile_binding.agent_controller_report_stale",
    "runtime.projection_missing",
    "runtime.agent_controller_report_missing",
    "runtime.agent_controller_report_stale",
    "claim_eligibility.agent_controller_report_missing",
    "claim_eligibility.agent_controller_report_stale",
  ])("recognizes %s as local-readiness refresh evidence", (reasonCode) => {
    expect(isAgentProfileLocalReadinessRefreshReasonCode(reasonCode)).toBe(
      true
    );
  });

  it("uses shared local-readiness recovery copy for Binding controller report refresh evidence", () => {
    const plan = planAgentProfileReplyRecovery({
      autoRefreshExhausted: true,
      member: createSpaceMemberAgentSnapshot({
        agentExecutionReadiness: createSpaceMemberAgentExecutionReadiness({
          displayState: "not_ready",
          facts: {
            binding: {
              reasonCodes: [
                "agent_profile_binding.agent_controller_report_missing",
              ],
              routable: false,
              source: "binding_truth",
            },
          },
          primaryAction: "run_prepare",
          reasonCodes: [
            "agent_profile_binding.agent_controller_report_missing",
          ],
        }),
        profileName: "Codex",
        wakeState: "offline",
        wakeabilityStatus: "blocked",
        wakeabilityReasonCodes: [
          "agent_profile_binding.agent_controller_report_missing",
        ],
        wakeabilityReasonText: "Blocked",
      }),
    });

    expect(plan).toMatchObject({
      body: "Codex is connected, but OpenMeld needs a current local agent connection from this computer before it can reply.",
      kind: "prepare_agent_profile",
      primaryActionLabel: "Connect local agent",
      recoveryReasonCode:
        "agent_profile_binding.agent_controller_report_missing",
      secondaryLabel:
        "Codex is connected, but OpenMeld needs a current local agent connection from this computer before it can reply.",
      title:
        "Codex is connected, but OpenMeld needs a current local agent connection from this computer before it can reply.",
    });
  });

  it("uses shared local-readiness recovery copy for claim controller report evidence", () => {
    const copy =
      "Codex is connected to an older computer setup. Update setup on this computer, then try again.";
    const plan = planAgentProfileReplyRecovery({
      autoRefreshExhausted: true,
      member: createSpaceMemberAgentSnapshot({
        agentExecutionReadiness: createSpaceMemberAgentExecutionReadiness({
          displayState: "not_ready",
          facts: {
            binding: {
              routable: true,
              source: "binding_truth",
            },
            claim: {
              executionBlocked: true,
              grantsClaimSuccess: false,
              reasonCodes: [
                "claim_eligibility.agent_controller_report_missing",
              ],
              source: "claim_diagnostics",
            },
          },
          primaryAction: "run_prepare",
          reasonCodes: ["claim_eligibility.agent_controller_report_missing"],
        }),
        profileName: "Codex",
        wakeState: "offline",
        wakeabilityStatus: "blocked",
        wakeabilityReasonCodes: [
          "claim_eligibility.agent_controller_report_missing",
        ],
        wakeabilityReasonText: "Blocked",
      }),
    });

    expect(plan).toMatchObject({
      body: copy,
      kind: "prepare_agent_profile",
      primaryActionLabel: "Connect local agent",
      recoveryReasonCode: "claim_eligibility.agent_controller_report_missing",
      secondaryLabel: copy,
      title: copy,
    });
  });

  it.each([
    [
      "runtime.projection_missing",
      "Codex is connected, but OpenMeld needs a current local agent connection from this computer before it can reply.",
    ],
    [
      "runtime.agent_controller_report_missing",
      "Codex is connected, but OpenMeld needs a current local agent connection from this computer before it can reply.",
    ],
    [
      "runtime.agent_controller_report_stale",
      "Codex is connected, but this computer's local agent connection is out of date. Connect the local agent again.",
    ],
  ] as const)("uses shared recovery copy for runtime reason %s", (reasonCode, copy) => {
    const plan = planAgentProfileReplyRecovery({
      autoRefreshExhausted: true,
      member: createSpaceMemberAgentSnapshot({
        agentExecutionReadiness: createSpaceMemberAgentExecutionReadiness({
          displayState: "not_ready",
          facts: {
            binding: {
              routable: true,
              source: "binding_truth",
            },
            runtime: {
              ready: false,
              reasonCodes: [reasonCode],
              source: "prepare_readiness",
            },
          },
          primaryAction: "run_prepare",
          reasonCodes: [reasonCode],
        }),
        profileName: "Codex",
        wakeState: "offline",
        wakeabilityStatus: "blocked",
        wakeabilityReasonCodes: [reasonCode],
        wakeabilityReasonText: "Blocked",
      }),
    });

    expect(plan).toMatchObject({
      body: copy,
      kind: "prepare_agent_profile",
      primaryActionLabel: "Connect local agent",
      recoveryReasonCode: reasonCode,
      secondaryLabel: copy,
      title: copy,
    });
  });

  it("returns no recovery plan for an authoritatively deleted profile", () => {
    const plan = planAgentProfileReplyRecovery({
      member: createBlockedAgent({
        agentExecutionReadiness: createSpaceMemberAgentExecutionReadiness({
          displayState: "blocked",
          facts: {
            profile: {
              active: false,
              reasonCodes: ["agent_profile.not_found"],
              source: "profile_identity",
            },
          },
          primaryAction: "check_status",
          reasonCodes: ["agent_profile.not_found"],
        }),
        agentControllerRef: "builtin:codex",
        profileName: "Felix Codex Session Dogfood",
        wakeabilityReasonCodes: ["profile.inactive"],
      }),
    });

    expect(plan).toEqual({ kind: "none" });
  });

  it("keeps a transient identity lookup failure on the normal recovery paths", () => {
    const plan = planAgentProfileReplyRecovery({
      selectableLocalAgentTargets: createSelectableLocalAgentTargets([
        createSelectableLocalAgentTarget({
          agentId: "codex",
          displayName: "Codex",
        }),
      ]),
      member: createBlockedAgent({
        agentExecutionReadiness: createSpaceMemberAgentExecutionReadiness({
          displayState: "not_ready",
          facts: {
            binding: {
              reasonCodes: ["agent_profile_binding.missing"],
              routable: false,
              source: "missing",
            },
            profile: {
              active: false,
              reasonCodes: ["agent_profile.identity_lookup_failed"],
              source: "unavailable",
            },
          },
          primaryAction: "reconnect_binding",
          reasonCodes: ["agent_profile_binding.missing"],
        }),
        agentControllerRef: "builtin:codex",
        profileName: "Codex",
        wakeabilityReasonCodes: ["profile.unbound"],
      }),
    });

    expect(plan).toMatchObject({
      kind: "connect_controller",
    });
  });

  it("connects an unbound space agent when Core supplies the controller target", () => {
    const copy = readSharedRecoveryCopy(
      "agent_profile_binding.missing",
      "Codex"
    );
    const plan = planAgentProfileReplyRecovery({
      selectableLocalAgentTargets: createSelectableLocalAgentTargets([
        createSelectableLocalAgentTarget({
          agentId: "codex",
          displayName: "Codex",
        }),
      ]),
      member: createBlockedAgent({
        agentExecutionReadiness: createMissingBindingAgentExecutionReadiness(),
        agentControllerRef: "builtin:codex",
        profileName: "Codex",
        wakeabilityReasonCodes: ["profile.unbound"],
      }),
    });

    expect(plan).toMatchObject({
      agentId: "codex",
      agentControllerRef: "builtin:codex",
      body: copy.body,
      kind: "connect_controller",
      primaryActionLabel: "Connect local agent",
      recoveryReasonCode: "agent_profile_binding.missing",
      secondaryLabel: copy.presentation,
      title: copy.presentation,
    });
  });

  it("routes duplicate controller conversations to agent settings review", () => {
    const plan = planAgentProfileReplyRecovery({
      member: createBlockedAgent({
        agentExecutionReadiness: createSpaceMemberAgentExecutionReadiness({
          displayState: "not_ready",
          facts: {
            binding: {
              reasonCodes: [
                "agent_profile_binding.controller_conversation_conflict",
              ],
              routable: false,
              source: "unavailable",
            },
          },
          primaryAction: "check_status",
          reasonCodes: [
            "agent_profile_binding.controller_conversation_conflict",
          ],
        }),
        profileName: "Codex",
        wakeabilityReasonCodes: [
          "agent_profile_binding.controller_conversation_conflict",
        ],
      }),
    });

    expect(plan).toMatchObject({
      body: "Codex shares a reply conversation with another Agent Profile. Review agent settings and choose one Agent Profile to keep this reply conversation.",
      kind: "review_agent_profile",
      primaryActionLabel: "Review agent settings",
      recoveryReasonCode:
        "agent_profile_binding.controller_conversation_conflict",
      secondaryLabel:
        "Codex shares a reply conversation with another Agent Profile. Review agent settings and choose one Agent Profile to keep this reply conversation.",
      title:
        "Codex shares a reply conversation with another Agent Profile. Review agent settings and choose one Agent Profile to keep this reply conversation.",
    });
  });

  it("reconnects an Agent Profile that is linked to an older local setup", () => {
    const plan = planAgentProfileReplyRecovery({
      selectableLocalAgentTargets: createSelectableLocalAgentTargets([
        createSelectableLocalAgentTarget({
          agentId: "codex",
          displayName: "Codex",
        }),
      ]),
      member: createBlockedAgent({
        agentExecutionReadiness: createOlderLocalSetupAgentExecutionReadiness(),
        agentControllerRef: "builtin:codex",
        profileName: "Felix Codex",
        wakeabilityReasonCodes: ["agent_profile_binding.missing"],
      }),
    });

    expect(plan).toMatchObject({
      agentId: "codex",
      body: "Felix Codex is connected to an older computer setup. Update setup on this computer, then try again.",
      agentControllerRef: "builtin:codex",
      kind: "connect_controller",
      primaryActionLabel: "Reconnect local agent",
      recoveryReasonCode: "claim_eligibility.binding_runtime_mismatch",
      secondaryLabel:
        "Felix Codex is connected to an older computer setup. Update setup on this computer, then try again.",
      title:
        "Felix Codex is connected to an older computer setup. Update setup on this computer, then try again.",
    });
  });

  it("does not guess the local agent from the profile name", () => {
    const copy = readSharedRecoveryCopy(
      "agent_profile_binding.missing",
      "Codex"
    );
    const plan = planAgentProfileReplyRecovery({
      selectableLocalAgentTargets: createSelectableLocalAgentTargets([
        createSelectableLocalAgentTarget({
          agentId: "codex",
          displayName: "Codex",
        }),
      ]),
      member: createBlockedAgent({
        agentExecutionReadiness: createMissingBindingAgentExecutionReadiness(),
        agentControllerRef: null,
        profileName: "Codex",
        wakeabilityReasonCodes: ["profile.unbound"],
      }),
    });

    expect(plan).toMatchObject({
      body: copy.body,
      kind: "choose_controller",
      primaryActionLabel: "Choose local agent",
      recoveryReasonCode: "agent_profile_binding.missing",
      secondaryLabel: copy.presentation,
      title: copy.presentation,
    });
  });

  it("asks the user to choose a local agent when no deterministic match exists", () => {
    const copy = readSharedRecoveryCopy(
      "agent_profile_binding.missing",
      "Research Agent"
    );
    const plan = planAgentProfileReplyRecovery({
      selectableLocalAgentTargets: createSelectableLocalAgentTargets([
        createSelectableLocalAgentTarget({
          agentId: "codex",
          displayName: "Codex",
        }),
      ]),
      member: createBlockedAgent({
        agentExecutionReadiness: createMissingBindingAgentExecutionReadiness(),
        agentControllerRef: null,
        profileName: "Research Agent",
        wakeabilityReasonCodes: ["profile.unbound"],
      }),
    });

    expect(plan).toMatchObject({
      body: copy.body,
      kind: "choose_controller",
      primaryActionLabel: "Choose local agent",
      recoveryReasonCode: "agent_profile_binding.missing",
      secondaryLabel: copy.presentation,
      title: copy.presentation,
    });
  });

  it("does not let checking local connection become stale setup recovery", () => {
    const plan = planAgentProfileReplyRecovery({
      autoRefreshExhausted: true,
      member: createBlockedAgent({
        agentExecutionReadiness: createRouteMissingAgentExecutionReadiness(),
        profileName: "Codex",
        wakeabilityReasonCodes: ["route.not_registered"],
      }),
      profileReplyReadinessEvidence: createProfileReplyReadinessEvidence({
        level: "blocked",
        reasonCodes: ["workspace.missing", "service.not_running"],
      }),
    });

    expect(plan).toEqual({ kind: "none" });
  });

  it("does not show reconnect when Core says the route is still checking", () => {
    const plan = planAgentProfileReplyRecovery({
      autoRefreshExhausted: true,
      member: createBlockedAgent({
        agentExecutionReadiness: createRouteMissingAgentExecutionReadiness(),
        profileName: "Codex",
        wakeabilityReasonCodes: ["route.not_registered"],
      }),
    });

    expect(plan).toEqual({ kind: "none" });
  });

  it("does not ask users to recover while the local route is still checking", () => {
    const plan = planAgentProfileReplyRecovery({
      autoRefreshExhausted: true,
      member: createBlockedAgent({
        agentExecutionReadiness: createRouteMissingAgentExecutionReadiness(),
        profileName: "Codex",
        wakeabilityReasonCodes: ["route.not_registered"],
      }),
      profileReplyReadinessEvidence: createProfileReplyReadinessEvidence({
        level: "ready",
        reasonCodes: [],
      }),
    });

    expect(plan).toEqual({ kind: "none" });
  });

  it("does not send users back to Prepare while the space route is checking", () => {
    const plan = planAgentProfileReplyRecovery({
      autoRefreshExhausted: true,
      currentLocalRuntimeReplyState: "ready",
      member: createBlockedAgent({
        agentExecutionReadiness: createRouteMissingAgentExecutionReadiness(),
        profileName: "Codex",
        wakeabilityReasonCodes: ["route.not_registered"],
      }),
    });

    expect(plan).toEqual({ kind: "none" });
  });

  it("does not turn exhausted local route checking into a reconnect action", () => {
    const plan = planAgentProfileReplyRecovery({
      autoRefreshExhausted: true,
      currentLocalRuntimeReplyState: "not_ready",
      member: createBlockedAgent({
        agentExecutionReadiness: createRouteMissingAgentExecutionReadiness(),
        profileName: "Codex",
        wakeabilityReasonCodes: ["route.not_registered"],
      }),
      profileReplyReadinessEvidence: createProfileReplyReadinessEvidence({
        level: "ready",
        reasonCodes: [],
      }),
    });

    expect(plan).toEqual({ kind: "none" });
  });

  it.each([
    "ready",
    "not_ready",
  ] as const)("uses shared route recovery copy when current local runtime is %s", (currentLocalRuntimeReplyState) => {
    const copy =
      "Codex is connected, but OpenMeld cannot see an active local Wake route from this computer yet. OpenMeld is checking the route from this computer.";
    const plan = planAgentProfileReplyRecovery({
      currentLocalRuntimeReplyState,
      member: createBlockedAgent({
        agentExecutionReadiness: createRouteMissingAgentExecutionReadiness({
          refreshable: false,
          runtimeReady: currentLocalRuntimeReplyState === "ready",
        }),
        profileName: "Codex",
        wakeabilityReasonCodes: ["agent_execution.route_missing"],
      }),
    });

    expect(plan).toMatchObject({
      body: copy,
      kind: "review_computer",
      primaryActionLabel: "Check status",
      recoveryReasonCode: "agent_execution.route_missing",
      secondaryLabel: copy,
      title: copy,
    });
  });

  it("does not let legacy computer readiness plan recovery when Core execution readiness is absent", () => {
    const plan = planAgentProfileReplyRecovery({
      currentLocalRuntimeReplyState: "not_ready",
      member: createSpaceMemberAgentSnapshot({
        includeAgentExecutionReadiness: false,
        profileName: "Codex",
        wakeState: "offline",
        wakeabilityStatus: "blocked",
        wakeabilityReasonCodes: ["route.not_registered"],
        wakeabilityReasonText: "Blocked",
      }),
      profileReplyReadinessEvidence: createProfileReplyReadinessEvidence({
        level: "ready",
        reasonCodes: [],
      }),
    });

    expect(plan).toEqual({ kind: "none" });
  });

  it("does not let stale computer readiness hide a wakeable space member", () => {
    const plan = planAgentProfileReplyRecovery({
      currentLocalRuntimeReplyState: "not_ready",
      member: createSpaceMemberAgentSnapshot({
        agentExecutionReadiness: createSpaceMemberAgentExecutionReadiness({
          displayState: "ready",
          reasonCodes: [],
        }),
        profileName: "Codex",
        wakeState: "wakeable",
        wakeabilityStatus: "ready",
        wakeabilityReasonCodes: [],
        wakeabilityReasonText: "Ready",
      }),
    });

    expect(plan).toEqual({ kind: "none" });
  });

  it("does not let stale profile readiness hide a wakeable space member", () => {
    const plan = planAgentProfileReplyRecovery({
      member: createSpaceMemberAgentSnapshot({
        agentExecutionReadiness: createSpaceMemberAgentExecutionReadiness({
          displayState: "ready",
          reasonCodes: [],
        }),
        profileName: "Codex",
        wakeState: "wakeable",
        wakeabilityStatus: "ready",
        wakeabilityReasonCodes: [],
        wakeabilityReasonText: "Ready",
      }),
      profileReplyReadinessEvidence: createProfileReplyReadinessEvidence({
        level: "blocked",
        reasonCodes: ["route.not_registered"],
      }),
    });

    expect(plan).toEqual({ kind: "none" });
  });

  it("uses execution readiness before stale legacy wakeability", () => {
    const copy = readSharedRecoveryCopy(
      "agent_profile_binding.missing",
      "Codex"
    );
    const plan = planAgentProfileReplyRecovery({
      selectableLocalAgentTargets: createSelectableLocalAgentTargets([
        createSelectableLocalAgentTarget({
          agentId: "codex",
          displayName: "Codex",
        }),
      ]),
      member: createSpaceMemberAgentSnapshot({
        agentExecutionReadiness: createSpaceMemberAgentExecutionReadiness({
          displayState: "not_ready",
          reasonCodes: ["agent_profile_binding.missing"],
        }),
        agentControllerRef: "builtin:codex",
        profileName: "Codex",
        wakeState: "wakeable",
        wakeabilityStatus: "ready",
        wakeabilityReasonCodes: [],
        wakeabilityReasonText: "Ready",
      }),
    });

    expect(plan).toMatchObject({
      body: copy.body,
      kind: "connect_controller",
      primaryActionLabel: "Connect local agent",
      recoveryReasonCode: "agent_profile_binding.missing",
      secondaryLabel: copy.presentation,
      title: copy.presentation,
    });
  });

  it("waits silently for refreshable local readiness evidence", () => {
    const plan = planAgentProfileReplyRecovery({
      member: createSpaceMemberAgentSnapshot({
        agentExecutionReadiness: createSpaceMemberAgentExecutionReadiness({
          displayState: "not_ready",
          primaryAction: "run_prepare",
          reasonCodes: ["runtime.agent_controller_report_stale"],
          facts: {
            binding: {
              routable: true,
              source: "binding_truth",
            },
            route: {
              online: true,
              source: "daemon_route",
            },
            localService: {
              reachable: true,
              refreshable: true,
              reasonCodes: ["local_service.refresh_in_progress"],
              source: "runtime_transport",
            },
            runtime: {
              ready: false,
              reasonCodes: ["runtime.agent_controller_report_stale"],
              source: "prepare_readiness",
            },
          },
        }),
        profileName: "Codex",
        wakeState: "offline",
        wakeabilityStatus: "blocked",
        wakeabilityReasonCodes: ["route.not_registered"],
        wakeabilityReasonText: "Blocked",
      }),
    });

    expect(plan).toEqual({ kind: "none" });
  });

  it("waits silently while Core can refresh stale execution target evidence", () => {
    const plan = planAgentProfileReplyRecovery({
      member: createSpaceMemberAgentSnapshot({
        agentExecutionReadiness: createSpaceMemberAgentExecutionReadiness({
          displayState: "not_ready",
          primaryAction: "check_status",
          reasonCodes: ["runtime.agent_controller_report_stale"],
          facts: {
            binding: {
              routable: true,
              source: "binding_truth",
            },
            route: {
              online: true,
              source: "daemon_route",
            },
            localService: {
              reachable: true,
              refreshable: true,
              reasonCodes: ["local_service.refresh_in_progress"],
              source: "runtime_transport",
            },
            runtime: {
              ready: false,
              reasonCodes: ["runtime.agent_controller_report_stale"],
              source: "prepare_readiness",
            },
          },
        }),
        profileName: "Codex",
        wakeState: "offline",
        wakeabilityStatus: "blocked",
        wakeabilityReasonCodes: ["runtime.agent_controller_report_stale"],
        wakeabilityReasonText: "Blocked",
      }),
    });

    expect(plan).toEqual({ kind: "none" });
  });

  it("does not convert an exhausted automatic status check into a user action", () => {
    const plan = planAgentProfileReplyRecovery({
      autoRefreshExhausted: true,
      member: createSpaceMemberAgentSnapshot({
        agentExecutionReadiness: createSpaceMemberAgentExecutionReadiness({
          displayState: "not_ready",
          primaryAction: "check_status",
          reasonCodes: ["runtime.agent_controller_report_stale"],
          facts: {
            binding: {
              routable: true,
              source: "binding_truth",
            },
            route: {
              online: true,
              source: "daemon_route",
            },
            localService: {
              reachable: true,
              refreshable: true,
              reasonCodes: ["local_service.refresh_in_progress"],
              source: "runtime_transport",
            },
            runtime: {
              ready: false,
              reasonCodes: ["runtime.agent_controller_report_stale"],
              source: "prepare_readiness",
            },
          },
        }),
        profileName: "Codex",
        wakeState: "offline",
        wakeabilityStatus: "blocked",
        wakeabilityReasonCodes: ["runtime.agent_controller_report_stale"],
        wakeabilityReasonText: "Blocked",
      }),
    });

    expect(plan).toEqual({ kind: "none" });
  });

  it.each([
    [
      "controller.client.upgrade_required",
      "Codex on this computer can't use the selected model. Update Codex or choose another Codex installation, then try again.",
      "Update or change local agent",
    ],
    [
      "controller.runtime.missing",
      "This local agent is not available on this device. Connect a local agent, then try again.",
      "Connect local agent",
    ],
  ] as const)("uses shared recovery copy for readiness-impact reason %s", (reasonCode, copy, actionLabel) => {
    const plan = planAgentProfileReplyRecovery({
      member: createSpaceMemberAgentSnapshot({
        agentExecutionReadiness: createSpaceMemberAgentExecutionReadiness({
          displayState: "blocked",
          primaryAction: "run_prepare",
          reasonCodes: [reasonCode],
          facts: {
            binding: {
              routable: true,
              source: "binding_truth",
            },
            readinessImpact: {
              blocked: true,
              expiresAtMs: 1_770_001_800_000,
              impactKind: "local_execution",
              observedAtMs: 1_770_000_000_000,
              reasonCodes: [reasonCode],
              source: "wake_failure",
            },
          },
        }),
        profileName: "Codex",
        wakeState: "offline",
        wakeabilityStatus: "blocked",
        wakeabilityReasonCodes: [reasonCode],
        wakeabilityReasonText: "Blocked",
      }),
    });

    expect(plan).toMatchObject({
      body: copy,
      kind: "prepare_agent_profile",
      primaryActionLabel: actionLabel,
      recoveryReasonCode: reasonCode,
      secondaryLabel: copy,
      title: copy,
    });
  });

  it.each([
    [
      "workspace.missing",
      "This agent is missing its local workspace on this device. Run `openmeld doctor --repair`, then `openmeld setup --profile <agent-profile-id>`, and try again.",
    ],
    [
      "workspace.invalid",
      "This agent's local workspace is broken on this device. Run `openmeld doctor --repair`, then `openmeld setup --profile <agent-profile-id>`, and try again.",
    ],
  ] as const)("uses shared recovery copy for workspace reason %s", (reasonCode, copy) => {
    const plan = planAgentProfileReplyRecovery({
      member: createSpaceMemberAgentSnapshot({
        agentExecutionReadiness: createSpaceMemberAgentExecutionReadiness({
          displayState: "blocked",
          facts: {
            binding: {
              routable: true,
              source: "binding_truth",
            },
          },
          primaryAction: "run_prepare",
          reasonCodes: [reasonCode],
        }),
        profileName: "Codex",
        wakeState: "offline",
        wakeabilityStatus: "blocked",
        wakeabilityReasonCodes: [reasonCode],
        wakeabilityReasonText: "Blocked",
      }),
    });

    expect(plan).toMatchObject({
      body: copy,
      kind: "prepare_agent_profile",
      primaryActionLabel: "Connect local agent",
      recoveryReasonCode: reasonCode,
      secondaryLabel: copy,
      title: copy,
    });
  });

  it("uses execution readiness primary action for OpenMeld Service update recovery", () => {
    const plan = planAgentProfileReplyRecovery({
      member: createSpaceMemberAgentSnapshot({
        agentExecutionReadiness: createSpaceMemberAgentExecutionReadiness({
          displayState: "not_ready",
          primaryAction: "update_service",
          reasonCodes: ["service.update_required"],
          facts: {
            binding: {
              routable: true,
              source: "binding_truth",
            },
            route: {
              online: true,
              source: "daemon_route",
            },
            runtime: {
              ready: false,
              reasonCodes: ["service.update_required"],
              source: "prepare_readiness",
            },
          },
        }),
        profileName: "Codex",
        wakeState: "offline",
        wakeabilityStatus: "blocked",
        wakeabilityReasonCodes: ["service.update_required"],
        wakeabilityReasonText: "Blocked",
      }),
    });

    expect(plan).toMatchObject({
      body: "Update OpenMeld on this computer before it can receive local Wake work.",
      kind: "review_computer",
      primaryActionLabel: "Update OpenMeld on Computer",
      recoveryReasonCode: "service.update_required",
      secondaryLabel:
        "Update OpenMeld on this computer before it can receive local Wake work.",
      title:
        "Update OpenMeld on this computer before it can receive local Wake work.",
    });
  });

  it.each([
    [
      "provider_account.subscription_access_unavailable",
      "Codex is connected, but its provider subscription does not include the access this agent needs. Review the provider plan or account on its computer before waking it again.",
    ],
    [
      "provider_account.organization_access_disabled",
      "Codex is connected, but its organization has disabled the provider access this agent needs. Ask the provider account admin to enable access before waking it again.",
    ],
    [
      "provider_account.capacity_exhausted",
      "Codex is connected, but its provider quota or credit balance is exhausted. Review the provider plan, billing, or credits before waking it again.",
    ],
  ] as const)("uses shared recovery copy for provider reason %s", (reasonCode, copy) => {
    const plan = planAgentProfileReplyRecovery({
      member: createSpaceMemberAgentSnapshot({
        agentExecutionReadiness: createSpaceMemberAgentExecutionReadiness({
          displayState: "blocked",
          facts: {
            binding: {
              routable: true,
              source: "binding_truth",
            },
            providerAccount: {
              blocked: true,
              expiresAtMs: 1_770_000_000_000,
              observedAtMs: 1_769_990_000_000,
              provider: "claude-code",
              reasonCodes: [reasonCode],
              source: "wake_failure",
            },
          },
          primaryAction: "fix_provider_account",
          reasonCodes: [reasonCode],
        }),
        profileName: "Codex",
        wakeState: "offline",
        wakeabilityStatus: "blocked",
        wakeabilityReasonCodes: [reasonCode],
        wakeabilityReasonText: "Blocked",
      }),
    });

    expect(plan).toMatchObject({
      body: copy,
      kind: "review_provider_account",
      primaryActionLabel: "Review agent settings",
      recoveryReasonCode: reasonCode,
      secondaryLabel: copy,
      title: copy,
    });
  });

  it("does not let stale computer readiness override Core OpenMeld Service update action", () => {
    const plan = planAgentProfileReplyRecovery({
      currentLocalRuntimeReplyState: "not_ready",
      member: createSpaceMemberAgentSnapshot({
        agentExecutionReadiness: createSpaceMemberAgentExecutionReadiness({
          displayState: "not_ready",
          primaryAction: "update_service",
          reasonCodes: ["service.update_required"],
          facts: {
            binding: {
              routable: true,
              source: "binding_truth",
            },
            route: {
              online: true,
              source: "daemon_route",
            },
            runtime: {
              ready: false,
              reasonCodes: ["service.update_required"],
              source: "prepare_readiness",
            },
          },
        }),
        profileName: "Codex",
        wakeState: "offline",
        wakeabilityStatus: "blocked",
        wakeabilityReasonCodes: ["service.update_required"],
        wakeabilityReasonText: "Blocked",
      }),
    });

    expect(plan).toMatchObject({
      kind: "review_computer",
      primaryActionLabel: "Update OpenMeld on Computer",
      recoveryReasonCode: "service.update_required",
      secondaryLabel:
        "Update OpenMeld on this computer before it can receive local Wake work.",
    });
  });

  it("does not let stale computer readiness override Core current-account service evidence", () => {
    const plan = planAgentProfileReplyRecovery({
      currentLocalRuntimeReplyState: "not_ready",
      member: createSpaceMemberAgentSnapshot({
        agentExecutionReadiness: createSpaceMemberAgentExecutionReadiness({
          displayState: "not_ready",
          primaryAction: "run_prepare",
          reasonCodes: ["local_service.not_connected_for_account"],
          facts: {
            binding: {
              routable: true,
              source: "binding_truth",
            },
            localService: {
              reachable: false,
              refreshable: false,
              reasonCodes: ["local_service.not_connected_for_account"],
              source: "runtime_transport",
            },
            route: {
              online: false,
              reasonCodes: ["route.not_registered"],
              source: "daemon_route",
            },
          },
        }),
        profileName: "Codex",
        wakeState: "offline",
        wakeabilityStatus: "blocked",
        wakeabilityReasonCodes: ["route.not_registered"],
        wakeabilityReasonText: "Blocked",
      }),
    });

    expect(plan).toMatchObject({
      kind: "review_computer",
      primaryActionLabel: "Reconnect Computer",
      recoveryReasonCode: "local_service.not_connected_for_account",
      secondaryLabel:
        "Codex's computer is not connected to the current OpenMeld account. Reconnect the computer.",
    });
  });

  it("does not let legacy computer update readiness override Core current-account service evidence", () => {
    const plan = planAgentProfileReplyRecovery({
      currentLocalRuntimeReplyState: "not_ready",
      member: createSpaceMemberAgentSnapshot({
        agentExecutionReadiness: createSpaceMemberAgentExecutionReadiness({
          displayState: "not_ready",
          primaryAction: "run_prepare",
          reasonCodes: ["local_service.not_connected_for_account"],
          facts: {
            binding: {
              routable: true,
              source: "binding_truth",
            },
            localService: {
              reachable: false,
              refreshable: false,
              reasonCodes: ["local_service.not_connected_for_account"],
              source: "runtime_transport",
            },
            route: {
              online: false,
              reasonCodes: ["route.not_registered"],
              source: "daemon_route",
            },
          },
        }),
        profileName: "Codex",
        wakeState: "offline",
        wakeabilityStatus: "blocked",
        wakeabilityReasonCodes: ["route.not_registered"],
        wakeabilityReasonText: "Blocked",
      }),
    });

    expect(plan).toMatchObject({
      kind: "review_computer",
      primaryActionLabel: "Reconnect Computer",
      recoveryReasonCode: "local_service.not_connected_for_account",
      secondaryLabel:
        "Codex's computer is not connected to the current OpenMeld account. Reconnect the computer.",
    });
  });

  it("trusts ready execution readiness before stale legacy blocked fields", () => {
    const plan = planAgentProfileReplyRecovery({
      member: createBlockedAgent({
        agentExecutionReadiness: createSpaceMemberAgentExecutionReadiness({
          displayState: "ready",
          reasonCodes: [],
        }),
        profileName: "Codex",
        wakeabilityReasonCodes: ["route.not_registered"],
      }),
    });

    expect(plan).toEqual({ kind: "none" });
  });

  it("trusts public Space presence before stale owner diagnostics state", () => {
    const plan = planAgentProfileReplyRecovery({
      member: createBlockedAgent({
        agentExecutionReadiness: createRouteMissingAgentExecutionReadiness(),
        profileName: "Codex",
        agentWakeAvailability: {
          action: "none",
          badgeLabel: "Available",
          category: "available",
          isRefreshing: false,
          label: "Available for Wake",
          phase: "available",
          reasonCode: "agent_execution.ready",
          status: "available_for_wake",
          summary: "Available for Wake",
          tooltip: "Available for Wake",
        },
        wakeabilityReasonCodes: ["route.not_registered"],
      }),
    });

    expect(plan).toEqual({ kind: "none" });
  });

  it("does not let stale profile service drift override Core checking state", () => {
    const plan = planAgentProfileReplyRecovery({
      autoRefreshExhausted: true,
      member: createBlockedAgent({
        agentExecutionReadiness: createRouteMissingAgentExecutionReadiness(),
        profileName: "Codex",
        wakeabilityReasonCodes: ["route.not_registered"],
      }),
      profileReplyReadinessEvidence: createProfileReplyReadinessEvidence({
        level: "blocked",
        reasonCodes: ["service.drifted"],
      }),
    });

    expect(plan).toEqual({ kind: "none" });
  });

  it("ignores stale member service drift when the current computer is ready", () => {
    const plan = planAgentProfileReplyRecovery({
      currentLocalRuntimeReplyState: "ready",
      member: createBlockedAgent({
        agentExecutionReadiness: createSpaceMemberAgentExecutionReadiness({
          displayState: "ready",
          reasonCodes: [],
        }),
        profileName: "Codex",
        wakeabilityReasonCodes: [],
      }),
      profileReplyReadinessEvidence: createProfileReplyReadinessEvidence({
        level: "blocked",
        reasonCodes: ["service.drifted"],
      }),
    });

    expect(plan).toEqual({ kind: "none" });
  });

  it("does not plan recovery for a wakeable agent", () => {
    const plan = planAgentProfileReplyRecovery({
      member: createSpaceMemberAgentSnapshot({
        agentExecutionReadiness: createSpaceMemberAgentExecutionReadiness({
          displayState: "ready",
          reasonCodes: [],
        }),
        profileName: "Codex",
        wakeState: "wakeable",
        wakeabilityStatus: "ready",
        wakeabilityReasonCodes: [],
        wakeabilityReasonText: "Ready",
      }),
    });

    expect(plan).toEqual({ kind: "none" });
  });

  it("does not infer recovery from legacy wakeability without execution readiness", () => {
    const plan = planAgentProfileReplyRecovery({
      member: createSpaceMemberAgentSnapshot({
        includeAgentExecutionReadiness: false,
        profileName: "Codex",
        wakeState: "wakeable",
        wakeabilityStatus: "ready",
        wakeabilityReasonCodes: [],
        wakeabilityReasonText: "Ready",
      }),
    });

    expect(plan).toEqual({ kind: "none" });
  });
});

function createBlockedAgent(
  input: Partial<SpaceMemberAgentSnapshot> & {
    agentExecutionReadiness: NonNullable<
      NonNullable<
        SpaceMemberAgentSnapshot["ownerWakeDiagnostics"]
      >["agentExecutionReadiness"]
    >;
    wakeabilityReasonCodes: readonly string[];
  }
): SpaceMemberAgentSnapshot {
  return createSpaceMemberAgentSnapshot({
    ...input,
    wakeRouteEvidence: createDaemonRouteObservationSummary({
      observedAt: "2026-04-29T00:00:00.000Z",
      status: "unavailable",
    }),
    wakeState: "offline",
    wakeabilityStatus: "blocked",
    wakeabilityReasonCodes: input.wakeabilityReasonCodes,
    wakeabilityReasonText: "Blocked",
  });
}

function readSharedRecoveryCopy(
  reasonCode: string,
  profileName: string
): {
  body: string;
  presentation: string;
} {
  const recovery = resolvePublicAgentFailureRecovery({
    errorCode: reasonCode,
    targetLabel: profileName,
  });
  if (!recovery) {
    throw new Error(`Missing shared recovery copy for ${reasonCode}`);
  }
  return {
    body: recovery.body,
    presentation:
      resolveMappedPublicAgentFailureReason(reasonCode, profileName) ??
      recovery.body,
  };
}

function createMissingBindingAgentExecutionReadiness(): NonNullable<
  NonNullable<
    SpaceMemberAgentSnapshot["ownerWakeDiagnostics"]
  >["agentExecutionReadiness"]
> {
  return createSpaceMemberAgentExecutionReadiness({
    displayState: "not_ready",
    facts: {
      binding: {
        reasonCodes: ["agent_profile_binding.missing"],
        routable: false,
        source: "missing",
      },
    },
    primaryAction: "reconnect_binding",
    reasonCodes: ["agent_profile_binding.missing"],
  });
}

function createOlderLocalSetupAgentExecutionReadiness(): NonNullable<
  NonNullable<
    SpaceMemberAgentSnapshot["ownerWakeDiagnostics"]
  >["agentExecutionReadiness"]
> {
  return createSpaceMemberAgentExecutionReadiness({
    displayState: "blocked",
    facts: {
      binding: {
        reasonCodes: ["agent_profile_binding.command_eligible"],
        routable: true,
        source: "binding_truth",
      },
      claim: {
        executionBlocked: true,
        grantsClaimSuccess: false,
        reasonCodes: ["claim_eligibility.binding_runtime_mismatch"],
        source: "claim_diagnostics",
      },
      localService: {
        reachable: false,
        refreshable: false,
        reasonCodes: ["local_service.identity_mismatch"],
        source: "runtime_transport",
      },
      runtime: {
        ready: false,
        reasonCodes: ["runtime.agent_controller_report_stale"],
        source: "prepare_readiness",
      },
    },
    primaryAction: "reconnect_binding",
    reasonCodes: [
      "agent_profile_binding.command_eligible",
      "local_service.identity_mismatch",
      "runtime.agent_controller_report_stale",
      "claim_eligibility.binding_runtime_mismatch",
    ],
  });
}

function createRouteMissingAgentExecutionReadiness(input?: {
  refreshable?: boolean;
  runtimeReady?: boolean;
}): NonNullable<
  NonNullable<
    SpaceMemberAgentSnapshot["ownerWakeDiagnostics"]
  >["agentExecutionReadiness"]
> {
  return createSpaceMemberAgentExecutionReadiness({
    displayState: "not_ready",
    facts: {
      binding: {
        reasonCodes: [],
        routable: true,
        source: "binding_truth",
      },
      route: {
        online: false,
        reasonCodes: ["agent_execution.route_missing"],
        source: "daemon_route",
      },
      localService: {
        reachable: true,
        refreshable: input?.refreshable ?? true,
        reasonCodes: ["local_service.refresh_in_progress"],
        source: "runtime_transport",
      },
      runtime: {
        ready: input?.runtimeReady ?? true,
        reasonCodes: [],
        source: "prepare_readiness",
      },
    },
    primaryAction: "check_status",
    reasonCodes: ["agent_execution.route_missing"],
  });
}

function createProfileReplyReadinessEvidence(
  overrides: Partial<AgentProfileReplyReadinessEvidence>
): AgentProfileReplyReadinessEvidence {
  return {
    level: "ready",
    reasonCodes: [],
    ...overrides,
  };
}

function createSelectableLocalAgentTargets(
  entries: readonly SelectableLocalAgentTarget[]
): readonly SelectableLocalAgentTarget[] {
  return entries;
}

function createSelectableLocalAgentTarget(
  input: Partial<SelectableLocalAgentTarget>
): SelectableLocalAgentTarget {
  const agentId = input.agentId ?? "codex";

  return {
    agentId,
    agentControllerRef: input.agentControllerRef ?? `builtin:${agentId}`,
    displayName: input.displayName ?? "Codex",
  };
}
