import type { AssignAgentProfileMemberAgentRpcInput } from "@openmeld/schemas";
import { describe, expect, it, vi } from "vitest";
import type { CoreBindings } from "../../lib/bindings";
import { assignBoundProfileToMemberAgent } from "../../member-agent/member-agent-profile-assignment";

function authWorker(
  assign: (input: AssignAgentProfileMemberAgentRpcInput) => Promise<unknown>
) {
  const assignAgentProfileMemberAgent = vi.fn(assign);
  return {
    assignAgentProfileMemberAgent,
    env: {
      OPENMELD_AUTH_WORKER: { assignAgentProfileMemberAgent },
    } as unknown as Pick<CoreBindings, "OPENMELD_AUTH_WORKER">,
  };
}

const PROFILE = {
  agentProfileId: "agt-second-cursor",
  ownerUserId: "user-1",
};

describe("assignBoundProfileToMemberAgent", () => {
  it("asks Auth to assign a Profile bound to a builtin Harness", async () => {
    const { assignAgentProfileMemberAgent, env } = authWorker(async () => ({
      ok: true,
      outcome: "assigned",
      memberAgentId: "ma-cursor",
    }));

    const outcome = await assignBoundProfileToMemberAgent(
      env,
      { ...PROFILE, agentControllerRef: "builtin:cursor" },
      { enabled: true }
    );

    expect(outcome).toBe("assigned");
    expect(assignAgentProfileMemberAgent).toHaveBeenCalledWith({
      harnessKind: "cursor",
      ownerUserId: "user-1",
      profileId: "agt-second-cursor",
    });
  });

  it("leaves a custom controller's Profile unassigned", async () => {
    const { assignAgentProfileMemberAgent, env } = authWorker(async () => ({}));

    const outcome = await assignBoundProfileToMemberAgent(
      env,
      { ...PROFILE, agentControllerRef: "custom:my-runner" },
      { enabled: true }
    );

    expect(outcome).toBeNull();
    expect(assignAgentProfileMemberAgent).not.toHaveBeenCalled();
  });

  it("does nothing while the release gate is off", async () => {
    const { assignAgentProfileMemberAgent, env } = authWorker(async () => ({}));

    await assignBoundProfileToMemberAgent(
      env,
      { ...PROFILE, agentControllerRef: "builtin:cursor" },
      { enabled: false }
    );

    expect(assignAgentProfileMemberAgent).not.toHaveBeenCalled();
  });

  it("never fails the accepted Binding when Auth fails", async () => {
    const { env } = authWorker(() => Promise.reject(new Error("auth down")));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(
      assignBoundProfileToMemberAgent(
        env,
        { ...PROFILE, agentControllerRef: "builtin:cursor" },
        { enabled: true }
      )
    ).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith(
      "[core.member_agents.profile_assignment_failed]",
      expect.objectContaining({ agentProfileId: "agt-second-cursor" })
    );
    warn.mockRestore();
  });
});
