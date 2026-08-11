import { describe, expect, it } from "vitest";
import type { OpenMeldProfile } from "../src/config/openmeld-profiles-api";
import { resolveOpenClawDiagnosticsGuidance } from "../src/system/provider-diagnostics/openclaw/guidance";
import type { AgentReplyReadinessStatus } from "../src/system/reply-readiness";
import { buildReplyReadinessGuidance } from "../src/system/reply-readiness-guidance";

describe("buildReplyReadinessGuidance", () => {
  it("uses the shared OpenClaw diagnostics mapping for bootstrap conflicts", () => {
    const profile = createOpenClawProfile();

    const guidance = buildReplyReadinessGuidance({
      openClawLocalDiagnostics: {
        agentId: "openmeld-openclaw-phase-one",
        authStatus: "present",
        bootstrapResolution: null,
        bootstrapStatus: "binding_conflict",
        errorCode: "openclaw.bootstrap.binding_conflict",
        gatewayHealth: "unhealthy",
        gatewayVisibility: "not_checked",
        message: "binding conflict",
        workspaceDir: "/tmp/openmeld-openclaw-profile",
      },
      profile,
      replyReadiness: createReplyReadiness({
        reasonCodes: ["controller.bootstrap.failed"],
        reasonText:
          "OpenMeld couldn't finish setting up the local OpenClaw agent for this profile.",
        replyReadiness: "blocked",
      }),
    });

    expect(guidance.summary).toBe(
      "OpenMeld found a local OpenClaw binding conflict for this profile."
    );
    expect(guidance.nextSteps).toEqual([
      "openmeld setup --profile agt-openclaw",
      "openclaw agents list",
    ]);
  });

  it("uses the shared OpenClaw diagnostics mapping for gateway visibility failures", () => {
    const profile = createOpenClawProfile();

    const guidance = buildReplyReadinessGuidance({
      openClawLocalDiagnostics: {
        agentId: "openmeld-openclaw-phase-one",
        authStatus: "present",
        bootstrapResolution: null,
        bootstrapStatus: "healthy",
        errorCode: "openclaw.gateway.agent_not_visible",
        gatewayHealth: "healthy",
        gatewayVisibility: "not_visible",
        message: "not visible",
        workspaceDir: "/tmp/openmeld-openclaw-profile",
      },
      profile,
      replyReadiness: createReplyReadiness({
        reasonCodes: ["controller.gateway.unhealthy"],
        reasonText:
          "OpenMeld can see the local OpenClaw agent, but the OpenClaw Gateway is not healthy yet.",
        replyReadiness: "blocked",
      }),
    });

    expect(guidance.summary).toBe(
      "OpenMeld can reach the local OpenClaw Gateway, but this OpenClaw agent is still not visible there."
    );
    expect(guidance.nextSteps).toEqual([
      "openmeld setup --profile agt-openclaw",
      "openclaw agents list",
    ]);
  });

  it("uses shell-safe placeholders in ready guidance", () => {
    const guidance = buildReplyReadinessGuidance({
      openClawLocalDiagnostics: null,
      profile: createOpenClawProfile(),
      replyReadiness: createReplyReadiness(),
    });

    expect(guidance.nextSteps).toEqual([
      "openmeld space join YOUR_SPACE_ID",
      'Send a message with an exact mention like "@Name(wake)".',
    ]);
  });

  it("routes repair-needed builtin agents through the local agent repair entrypoint first", () => {
    const guidance = buildReplyReadinessGuidance({
      openClawLocalDiagnostics: null,
      profile: {
        ...createOpenClawProfile(),
      },
      replyReadiness: createReplyReadiness({
        localAgentId: "openclaw",
        reasonCodes: ["controller.launch.needs_repair"],
        reasonText:
          "OpenMeld can see this agent, but OpenMeld can't start it on this device yet.",
        replyReadiness: "blocked",
      }),
    });

    expect(guidance.nextSteps).toEqual([
      "openmeld agents repair --agent openclaw",
    ]);
  });

  it("routes install-choice builtin agents through the local agent enable entrypoint first", () => {
    const guidance = buildReplyReadinessGuidance({
      openClawLocalDiagnostics: null,
      profile: createCodexProfile(),
      replyReadiness: createReplyReadiness({
        localAgentId: "codex",
        profileId: "agt-codex",
        reasonCodes: ["controller.launch.choice_required"],
        reasonText:
          "OpenMeld found more than one Codex install on this computer.",
        replyReadiness: "blocked",
      }),
    });

    expect(guidance.summary).toBe(
      "OpenMeld found more than one install for this agent on this device. Choose which one OpenMeld should use here, then try again."
    );
    expect(guidance.nextSteps).toEqual([
      "openmeld agents enable --agent codex",
      "openmeld agents repair --agent codex",
    ]);
  });

  it("maps unknown bootstrap states to the same guidance as missing", () => {
    const diagnostics = {
      agentId: "openmeld-openclaw-phase-one",
      authStatus: "present",
      bootstrapResolution: null,
      bootstrapStatus: "missing",
      errorCode: "openclaw.bootstrap.missing",
      gatewayHealth: "unhealthy",
      gatewayVisibility: "not_checked",
      message: "missing bootstrap",
      workspaceDir: "/tmp/openmeld-openclaw-profile",
    } as const;

    const missingGuidance = resolveOpenClawDiagnosticsGuidance({
      diagnostics,
      profileId: "agt-openclaw",
    });
    const unknownGuidance = resolveOpenClawDiagnosticsGuidance({
      diagnostics: {
        ...diagnostics,
        bootstrapStatus: "unexpected_state",
      } as unknown as Parameters<
        typeof resolveOpenClawDiagnosticsGuidance
      >[0]["diagnostics"],
      profileId: "agt-openclaw",
    });

    expect(unknownGuidance).toEqual(missingGuidance);
  });

  it("uses hosted retry guidance for dispatch storage readiness failures", () => {
    const guidance = buildReplyReadinessGuidance({
      openClawLocalDiagnostics: null,
      profile: createOpenClawProfile(),
      replyReadiness: createReplyReadiness({
        deviceReplyReadiness: {
          reasonCodes: ["dispatch.storage_not_ready"],
          reasonText:
            "Core dispatch storage is not ready for wake execution yet.",
          replyReadiness: "blocked",
          updatedAt: "2026-03-24T00:00:00.000Z",
          wakeableRouteCount: 1,
        },
        reasonCodes: ["dispatch.storage_not_ready"],
        reasonText:
          "Core dispatch storage is not ready for wake execution yet.",
        replyReadiness: "blocked",
      }),
    });

    expect(guidance.summary).toBe(
      "Core dispatch storage is not ready for wake execution yet."
    );
    expect(guidance.nextSteps).toEqual([
      "Retry the OpenMeld command shortly.",
      "If this continues, contact OpenMeld support with the latest command output.",
    ]);
  });

  it("explains when the daemon route is offline on the server", () => {
    const guidance = buildReplyReadinessGuidance({
      openClawLocalDiagnostics: null,
      profile: createOpenClawProfile(),
      replyReadiness: createReplyReadiness({
        reasonCodes: ["route.offline"],
        reasonText:
          "OpenMeld server can't currently see an active reply route for this profile (server reported daemon.profile.offline).",
        replyReadiness: "blocked",
      }),
    });

    expect(guidance.summary).toBe(
      "This profile is connected, but OpenMeld cannot see an active local Wake route from this device yet. OpenMeld is checking the route from this device."
    );
    expect(guidance.nextSteps).toEqual([
      "openmeld service status --profile agt-openclaw",
      "openmeld service repair",
    ]);
  });

  it("guides workspace.missing through local agent repair instead of prepare", () => {
    const guidance = buildReplyReadinessGuidance({
      openClawLocalDiagnostics: null,
      profile: createOpenClawProfile(),
      replyReadiness: createReplyReadiness({
        reasonCodes: ["workspace.missing"],
        reasonText:
          "This profile is missing its local workspace on this device.",
        replyReadiness: "blocked",
      }),
    });

    expect(guidance.summary).toBe(
      "This agent is missing its local workspace on this device. Run `openmeld doctor --repair`, then `openmeld setup --profile <agent-profile-id>`, and try again."
    );
    expect(guidance.nextSteps).toEqual([
      "openmeld agents repair --agent <agent-id>",
      "openmeld agents list",
    ]);
  });

  it("guides workspace.invalid through local agent repair instead of prepare", () => {
    const guidance = buildReplyReadinessGuidance({
      openClawLocalDiagnostics: null,
      profile: createOpenClawProfile(),
      replyReadiness: createReplyReadiness({
        reasonCodes: ["workspace.invalid"],
        reasonText: "This profile's local workspace is broken on this device.",
        replyReadiness: "blocked",
      }),
    });

    expect(guidance.summary).toBe(
      "This agent's local workspace is broken on this device. Run `openmeld doctor --repair`, then `openmeld setup --profile <agent-profile-id>`, and try again."
    );
    expect(guidance.nextSteps).toEqual([
      "openmeld agents repair --agent <agent-id>",
      "openmeld agents list",
    ]);
  });

  it("prioritizes workspace guidance before service guidance when both are blocked", () => {
    const guidance = buildReplyReadinessGuidance({
      openClawLocalDiagnostics: null,
      profile: createOpenClawProfile(),
      replyReadiness: createReplyReadiness({
        deviceReplyReadiness: {
          reasonCodes: ["workspace.missing", "service.not_running"],
          reasonText:
            "This profile is missing its local workspace on this device.",
          replyReadiness: "blocked",
          updatedAt: "2026-03-24T00:00:00.000Z",
          wakeableRouteCount: 0,
        },
        reasonCodes: ["workspace.missing", "service.not_running"],
        reasonText:
          "This profile is missing its local workspace on this device.",
        replyReadiness: "blocked",
      }),
    });

    expect(guidance.summary).toBe(
      "This agent is missing its local workspace on this device. Run `openmeld doctor --repair`, then `openmeld setup --profile <agent-profile-id>`, and try again."
    );
    expect(guidance.nextSteps).toEqual([
      "openmeld agents repair --agent <agent-id>",
      "openmeld agents list",
    ]);
  });

  it("avoids placeholder controller commands when an agent profile is unbound", () => {
    const guidance = buildReplyReadinessGuidance({
      openClawLocalDiagnostics: null,
      profile: createOpenClawProfile(),
      replyReadiness: createReplyReadiness({
        reasonCodes: ["profile.unbound"],
        reasonText: "local agent connection is missing",
        replyReadiness: "blocked",
      }),
    });

    expect(guidance.summary).toBe(
      "This profile is in this space, but OpenMeld cannot tell which local agent should reply for it yet."
    );
    expect(guidance.nextSteps).toEqual([
      "Open this Agent in OpenMeld Web and choose a local agent.",
    ]);
  });
});

function createOpenClawProfile(): OpenMeldProfile {
  return {
    openMeldProfileId: "agt-openclaw",
    profileName: "OpenClaw Phase One",
    profileHandle: "openclaw-phase-one",
    profileKind: "agent",
    status: "active",
    ownerUserId: "user-owner",
    source: "cli_create",
    createdByUserId: "user-owner",
    lastUsedAt: null,
    createdAt: "2026-03-24T00:00:00.000Z",
    updatedAt: "2026-03-24T00:00:00.000Z",
  };
}

function createCodexProfile(): OpenMeldProfile {
  return {
    openMeldProfileId: "agt-codex",
    profileName: "Codex",
    profileHandle: "codex",
    profileKind: "agent",
    status: "active",
    ownerUserId: "user-owner",
    source: "cli_create",
    createdByUserId: "user-owner",
    lastUsedAt: null,
    createdAt: "2026-03-24T00:00:00.000Z",
    updatedAt: "2026-03-24T00:00:00.000Z",
  };
}

function createReplyReadiness(
  overrides: Partial<AgentReplyReadinessStatus> = {}
): AgentReplyReadinessStatus {
  return {
    deviceReplyReadiness: {
      reasonCodes: [],
      reasonText:
        "This device is ready for Space replies from local agent profiles",
      replyReadiness: "ready",
      updatedAt: "2026-03-24T00:00:00.000Z",
      wakeableRouteCount: 1,
    },
    localAgentId: null,
    profileId: "agt-openclaw",
    reasonCodes: [],
    reasonText: "This profile can reply from Space when mentioned",
    replyReadiness: "ready",
    transportMode: "local-cli",
    updatedAt: "2026-03-24T00:00:00.000Z",
    ...overrides,
  };
}
