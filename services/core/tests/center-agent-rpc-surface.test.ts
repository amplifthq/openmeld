import { describe, expect, it } from "vitest";
import {
  CenterAgentRoutineRpcEntrypoint,
  CenterAgentRpcEntrypoint,
  GatewayRpcEntrypoint,
} from "../src/index";
import { env } from "../test-support/worker-env";

const ROUTINE_RPC_METHODS = [
  "centerAgentListRoutines",
  "centerAgentCreateRoutine",
  "centerAgentUpdateRoutine",
  "centerAgentDeleteRoutine",
  "centerAgentPauseRoutine",
  "centerAgentResumeRoutine",
] as const;

const ORGANIZATION_INVITE_LINK_RPC_METHOD =
  "centerAgentGetOrganizationInviteLink";
const CENTER_AGENT_SLACK_INVITE_RPC_METHOD = "centerAgentInviteSlackTeammates";
const SLACK_WELCOME_INTERACTION_RPC_METHOD = "handleSlackWelcomeInteraction";

const PROJECT_RPC_METHODS = [
  "centerAgentListProjects",
  "centerAgentCreateProject",
  "centerAgentUpdateProject",
  "centerAgentSetAgentProfileDefaultProject",
  "centerAgentPrepareRemoveProject",
  "centerAgentRemoveProject",
] as const;

const WAKE_CONTROL_RPC_METHODS = [
  "centerAgentListActiveSpaceWakes",
  "centerAgentReadSpaceWakeProgress",
  "centerAgentStopSpaceWake",
] as const;

describe("Private Center Agent RPC surface", () => {
  it("requires the explicit device-wait receiver and does not expose its implementation as RPC", async () => {
    const entrypoint = Object.create(
      GatewayRpcEntrypoint.prototype
    ) as GatewayRpcEntrypoint;
    Reflect.set(entrypoint, "env", env);
    const request = {
      authoringPolicy: "user_authored" as const,
      profile: {
        kind: "human" as const,
        profileId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        profileName: "Test requester",
      },
      spaceId: "space-1",
      text: "Check",
      deviceWait: {
        bindingId: "binding-1",
        openMeldServiceRuntimeId: "runtime-1",
        targetProfileId: "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        deadlineAtMs: Date.now() + 60_000,
      },
    };
    await expect(entrypoint.postSignal(request)).rejects.toThrow(
      "require postDeviceWaitingSignal"
    );
    await expect(
      entrypoint.postDeviceWaitingSignal({ ...request, deviceWait: undefined })
    ).rejects.toThrow("waiting request is required");
    expect("postSignalWithEvidence" in entrypoint).toBe(false);
  });

  it("keeps the local scheduler trigger unavailable outside local development", async () => {
    const entrypoint = Object.create(
      GatewayRpcEntrypoint.prototype
    ) as GatewayRpcEntrypoint;
    Reflect.set(entrypoint, "env", {
      ...env,
      OPENMELD_WORKER_ENVIRONMENT: "prod",
    });

    await expect(entrypoint.runLocalRoutineSchedulerTick()).rejects.toThrow(
      "unavailable outside local development"
    );
  });

  it("exposes the six private Routine methods on the Center Agent entrypoint", () => {
    const methods = Object.getOwnPropertyNames(
      CenterAgentRpcEntrypoint.prototype
    );

    for (const method of ROUTINE_RPC_METHODS) {
      expect(methods).toContain(method);
    }
  });

  it("keeps the six private Routine methods off the Gateway entrypoint", () => {
    const methods = Object.getOwnPropertyNames(GatewayRpcEntrypoint.prototype);

    for (const method of ROUTINE_RPC_METHODS) {
      expect(methods).not.toContain(method);
    }
  });

  it("exposes the private Organization invite-link read only to Remote Agent", () => {
    expect(
      Object.getOwnPropertyNames(CenterAgentRpcEntrypoint.prototype)
    ).toContain(ORGANIZATION_INVITE_LINK_RPC_METHOD);
    expect(
      Object.getOwnPropertyNames(GatewayRpcEntrypoint.prototype)
    ).not.toContain(ORGANIZATION_INVITE_LINK_RPC_METHOD);
  });

  it("separates signed Gateway interactions from authorized Remote Agent invitations", () => {
    const centerAgentMethods = Object.getOwnPropertyNames(
      CenterAgentRpcEntrypoint.prototype
    );
    const gatewayMethods = Object.getOwnPropertyNames(
      GatewayRpcEntrypoint.prototype
    );

    expect(centerAgentMethods).toContain(CENTER_AGENT_SLACK_INVITE_RPC_METHOD);
    expect(centerAgentMethods).not.toContain(
      SLACK_WELCOME_INTERACTION_RPC_METHOD
    );
    expect(gatewayMethods).toContain(SLACK_WELCOME_INTERACTION_RPC_METHOD);
    expect(gatewayMethods).not.toContain(CENTER_AGENT_SLACK_INVITE_RPC_METHOD);
  });

  it("exposes Project management only on the private Center Agent entrypoint", () => {
    const centerAgentMethods = Object.getOwnPropertyNames(
      CenterAgentRpcEntrypoint.prototype
    );
    const gatewayMethods = Object.getOwnPropertyNames(
      GatewayRpcEntrypoint.prototype
    );

    for (const method of PROJECT_RPC_METHODS) {
      expect(centerAgentMethods).toContain(method);
      expect(gatewayMethods).not.toContain(method);
    }
  });

  it("exposes Wake controls only on the private Center Agent entrypoint", () => {
    const centerAgentMethods = Object.getOwnPropertyNames(
      CenterAgentRpcEntrypoint.prototype
    );
    const gatewayMethods = Object.getOwnPropertyNames(
      GatewayRpcEntrypoint.prototype
    );

    for (const method of WAKE_CONTROL_RPC_METHODS) {
      expect(centerAgentMethods).toContain(method);
      expect(gatewayMethods).not.toContain(method);
    }
  });

  it("keeps member-attributed audit reads on the private Center Agent entrypoint", () => {
    expect(
      Object.getOwnPropertyNames(CenterAgentRpcEntrypoint.prototype)
    ).toContain("centerAgentReadAuditJournal");
    expect(
      Object.getOwnPropertyNames(GatewayRpcEntrypoint.prototype)
    ).not.toContain("centerAgentReadAuditJournal");
  });

  it("keeps historical Routine evidence on the private Center Agent surface", () => {
    for (const name of [
      "centerAgentListRoutineRuns",
      "centerAgentReadRoutineRunDiagnostics",
    ]) {
      expect(
        Object.getOwnPropertyNames(CenterAgentRpcEntrypoint.prototype)
      ).toContain(name);
      expect(
        Object.getOwnPropertyNames(GatewayRpcEntrypoint.prototype)
      ).not.toContain(name);
    }
  });

  it("keeps explicit memory search off the Gateway surface", () => {
    expect(
      Object.getOwnPropertyNames(CenterAgentRpcEntrypoint.prototype)
    ).toContain("centerAgentSearchMemory");
    expect(
      Object.getOwnPropertyNames(GatewayRpcEntrypoint.prototype)
    ).not.toContain("centerAgentSearchMemory");
  });

  it("keeps the historical Routine entrypoint as a compatibility alias", () => {
    expect(
      Object.getPrototypeOf(CenterAgentRoutineRpcEntrypoint.prototype)
    ).toBe(CenterAgentRpcEntrypoint.prototype);
  });
});
