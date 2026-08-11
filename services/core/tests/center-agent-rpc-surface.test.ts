import { describe, expect, it } from "vitest";
import {
  CenterAgentRoutineRpcEntrypoint,
  CenterAgentRpcEntrypoint,
  GatewayRpcEntrypoint,
} from "../src/index";

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

const PROJECT_RPC_METHODS = [
  "centerAgentListProjects",
  "centerAgentCreateProject",
  "centerAgentUpdateProject",
  "centerAgentSetAgentProfileDefaultProject",
  "centerAgentPrepareRemoveProject",
  "centerAgentRemoveProject",
] as const;

describe("Private Center Agent RPC surface", () => {
  it("keeps the local scheduler trigger unavailable outside local development", async () => {
    const entrypoint = Object.create(
      GatewayRpcEntrypoint.prototype
    ) as GatewayRpcEntrypoint;
    Reflect.set(entrypoint, "env", {
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

  it("keeps the historical Routine entrypoint as a compatibility alias", () => {
    expect(
      Object.getPrototypeOf(CenterAgentRoutineRpcEntrypoint.prototype)
    ).toBe(CenterAgentRpcEntrypoint.prototype);
  });
});
