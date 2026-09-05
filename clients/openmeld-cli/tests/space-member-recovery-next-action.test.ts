import { describe, expect, it } from "vitest";
import {
  formatSpaceMemberRecoveryNextAction,
  resolveSpaceMemberJoinOnlyNextAction,
} from "../src/space/command";
import { resolveSpaceMemberJoinOnlyReason } from "../src/space/command-member-recovery";

describe("resolveSpaceMemberJoinOnlyNextAction", () => {
  it("uses shared availability copy for unavailable local participation", () => {
    expect(
      resolveSpaceMemberJoinOnlyReason({
        controllerEnabled: false,
      })
    ).toBe("Connect a local agent before this profile can reply.");
    expect(
      resolveSpaceMemberJoinOnlyReason({
        agentControllerRef: "builtin:codex",
        controllerEnabled: true,
        localParticipationReadiness: "not_running",
      })
    ).toBe("Connect your computer before this Agent can reply.");
  });

  it("points not-running local participation to profile status instead of service start", () => {
    const action = resolveSpaceMemberJoinOnlyNextAction({
      controllerEnabled: true,
      agentControllerRef: "builtin:codex",
      localParticipationReadiness: "not_running",
      localParticipationReasonCodes: ["service.not_running"],
      localTargetAgentId: "codex",
      profileId: "agt-codex",
    });

    expect(action).toEqual({
      command: "openmeld service status --profile agt-codex",
      kind: "command",
    });
    expect(formatSpaceMemberRecoveryNextAction(action)).toContain(
      "openmeld service status --profile agt-codex"
    );
    expect(formatSpaceMemberRecoveryNextAction(action)).not.toContain(
      "openmeld service start"
    );
  });

  it("points missing local service participation to profile status instead of service install", () => {
    const action = resolveSpaceMemberJoinOnlyNextAction({
      controllerEnabled: true,
      agentControllerRef: "builtin:codex",
      localParticipationReadiness: "not_installed",
      localParticipationReasonCodes: ["service.not_installed"],
      localTargetAgentId: "codex",
      profileId: "agt-codex",
    });

    expect(action).toEqual({
      command: "openmeld service status --profile agt-codex",
      kind: "command",
    });
    expect(formatSpaceMemberRecoveryNextAction(action)).toContain(
      "openmeld service status --profile agt-codex"
    );
    expect(formatSpaceMemberRecoveryNextAction(action)).not.toContain(
      "openmeld service install"
    );
  });

  it("prioritizes reconnect when command eligibility is paired with runtime mismatch evidence", () => {
    const action = resolveSpaceMemberJoinOnlyNextAction({
      controllerEnabled: true,
      agentControllerRef: "builtin:codex",
      localParticipationReadiness: "unknown",
      localParticipationReasonCodes: [
        "agent_profile_binding.command_eligible",
        "local_service.identity_mismatch",
        "claim_eligibility.binding_runtime_mismatch",
      ],
      localTargetAgentId: "codex",
      profileId: "agt-codex",
    });

    expect(action).toMatchObject({
      instruction:
        "Open this Agent in OpenMeld Web and reconnect it to the right local agent on this device.",
      kind: "instruction",
    });
    expect(formatSpaceMemberRecoveryNextAction(action)).toContain("reconnect");
    expect(formatSpaceMemberRecoveryNextAction(action)).not.toContain(
      "choose the local agent"
    );
  });

  it("keeps a missing profile connection on choose-local-agent guidance", () => {
    const action = resolveSpaceMemberJoinOnlyNextAction({
      controllerEnabled: true,
      agentControllerRef: "builtin:codex",
      localParticipationReadiness: "unknown",
      localParticipationReasonCodes: ["profile.unbound"],
      localTargetAgentId: "codex",
      profileId: "agt-codex",
    });

    expect(action).toMatchObject({
      instruction:
        "Open this Agent in OpenMeld Web and choose the local agent that should handle work from the Space.",
      kind: "instruction",
    });
  });
});
