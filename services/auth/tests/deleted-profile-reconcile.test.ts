import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthBindings } from "../src/lib/bindings";
import { reconcileDeletedAgentProfileMemberships } from "../src/lib/profiles/deleted-profile-reconcile";

const AGENT_PROFILE = {
  ownerUserId: "owner-1",
  profileId: "agt_11111111-1111-4111-8111-111111111111",
  profileKind: "agent",
};

function createEnv(input: {
  reconcile?: ReturnType<typeof vi.fn>;
}): AuthBindings {
  return {
    OPENMELD_DB: {} as D1Database,
    OPENMELD_AUTH_KV: {} as KVNamespace,
    ...(input.reconcile
      ? {
          OPENMELD_CORE_WORKER: {
            reconcileDeletedAgentProfile: input.reconcile,
          },
        }
      : {}),
  } as unknown as AuthBindings;
}

describe("reconcileDeletedAgentProfileMemberships", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fans the deletion out to core with the profile's known space ids", async () => {
    const reconcile = vi.fn().mockResolvedValue({
      bindingDisabled: true,
      profileId: AGENT_PROFILE.profileId,
      spaces: [{ spaceId: "a".repeat(64), status: "removed" }],
    });

    await reconcileDeletedAgentProfileMemberships(
      createEnv({ reconcile }),
      AGENT_PROFILE
    );

    expect(reconcile).toHaveBeenCalledWith({
      ownerUserId: AGENT_PROFILE.ownerUserId,
      profileId: AGENT_PROFILE.profileId,
      profileKind: "agent",
      spaceIds: [],
    });
  });

  it("fans out human profile deletions with the human kind", async () => {
    const reconcile = vi.fn().mockResolvedValue({
      bindingDisabled: false,
      profileId: AGENT_PROFILE.profileId,
      spaces: [],
    });

    await reconcileDeletedAgentProfileMemberships(createEnv({ reconcile }), {
      ...AGENT_PROFILE,
      profileKind: "human",
    });

    expect(reconcile).toHaveBeenCalledWith(
      expect.objectContaining({ profileKind: "human" })
    );
  });

  it("warns instead of throwing when the core binding is missing", async () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    await expect(
      reconcileDeletedAgentProfileMemberships(createEnv({}), AGENT_PROFILE)
    ).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledWith(
      "[auth.profile.deleted_reconcile_skipped]",
      expect.objectContaining({
        reason: "openmeld_core_worker_unbound",
      })
    );
  });

  it("warns instead of throwing when the core call fails", async () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const reconcile = vi.fn().mockRejectedValue(new Error("core down"));

    await expect(
      reconcileDeletedAgentProfileMemberships(
        createEnv({ reconcile }),
        AGENT_PROFILE
      )
    ).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledWith(
      "[auth.profile.deleted_reconcile_failed]",
      expect.objectContaining({
        error: "core down",
        profileId: AGENT_PROFILE.profileId,
      })
    );
  });
});
