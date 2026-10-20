import type { PostgresDatabase } from "@openmeld/db/postgresql";
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

// The grouping read returns the Profile's current Binding controller ref.
function database(agentControllerRef: string | null) {
  const query = vi.fn(async (config: { text: string }) =>
    config.text.includes("pg_advisory_xact_lock")
      ? { rowCount: 1, rows: [{}] }
      : {
          rowCount: agentControllerRef ? 1 : 0,
          rows: agentControllerRef
            ? [{ agent_controller_ref: agentControllerRef }]
            : [],
        }
  );
  return {
    transaction: async <T>(callback: (client: unknown) => Promise<T>) =>
      await callback({ query }),
  } as unknown as PostgresDatabase;
}

function profile(agentControllerRef: string | null) {
  return {
    agentProfileId: "agt-second-cursor",
    db: database(agentControllerRef),
    ownerUserId: "user-1",
  };
}

describe("assignBoundProfileToMemberAgent", () => {
  it("asks Auth to assign a Profile bound to a builtin Harness", async () => {
    const { assignAgentProfileMemberAgent, env } = authWorker(async () => ({
      ok: true,
      outcome: "assigned",
      memberAgentId: "ma-cursor",
    }));

    const outcome = await assignBoundProfileToMemberAgent(
      env,
      profile("builtin:cursor"),
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
      profile("custom:my-runner"),
      { enabled: true }
    );

    expect(outcome).toBeNull();
    expect(assignAgentProfileMemberAgent).not.toHaveBeenCalled();
  });

  it("leaves a never-bound Profile unassigned", async () => {
    const { assignAgentProfileMemberAgent, env } = authWorker(async () => ({}));

    const outcome = await assignBoundProfileToMemberAgent(env, profile(null), {
      enabled: true,
    });

    expect(outcome).toBeNull();
    expect(assignAgentProfileMemberAgent).not.toHaveBeenCalled();
  });

  it("does nothing while the release gate is off", async () => {
    const { assignAgentProfileMemberAgent, env } = authWorker(async () => ({}));

    await assignBoundProfileToMemberAgent(env, profile("builtin:cursor"), {
      enabled: false,
    });

    expect(assignAgentProfileMemberAgent).not.toHaveBeenCalled();
  });

  it("never fails the accepted Binding when Auth fails", async () => {
    const { env } = authWorker(() => Promise.reject(new Error("auth down")));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(
      assignBoundProfileToMemberAgent(env, profile("builtin:cursor"), {
        enabled: true,
      })
    ).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith(
      "[core.member_agents.profile_assignment_failed]",
      expect.objectContaining({ agentProfileId: "agt-second-cursor" })
    );
    warn.mockRestore();
  });
});
