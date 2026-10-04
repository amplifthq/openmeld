import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPostgresHarness,
  type PostgresHarness,
  postgresTestBinding,
} from "../../../tooling/postgresql/test-harness";
import type { AuthBindings } from "../src/lib/bindings";
import {
  reconcileDeletedAgentProfileMemberships,
  runDeletedProfileReconcileOutbox,
} from "../src/lib/profiles/deleted-profile-reconcile";

const AGENT_PROFILE = {
  ownerUserId: "owner-1",
  profileId: "agt_11111111-1111-4111-8111-111111111111",
  profileKind: "agent",
} as const;

type TestDeletedProfile = {
  ownerUserId: string;
  profileId: string;
  profileKind: "agent" | "human";
};

const harnesses: PostgresHarness[] = [];

afterEach(async () => {
  for (const harness of harnesses.splice(0)) {
    await harness.close();
  }
  vi.restoreAllMocks();
});

async function createEnv(input: {
  reconcile?: ReturnType<typeof vi.fn>;
  profile?: TestDeletedProfile;
}): Promise<{ env: AuthBindings; harness: PostgresHarness }> {
  const harness = await createPostgresHarness();
  harnesses.push(harness);

  const profile = input.profile ?? AGENT_PROFILE;
  await seedOutbox(harness, profile);
  return {
    env: {
      OPENMELD_POSTGRESQL: postgresTestBinding(harness.db),
      OPENMELD_AUTH_KV: {} as KVNamespace,
      ...(input.reconcile
        ? {
            OPENMELD_CORE_WORKER: {
              reconcileDeletedAgentProfile: input.reconcile,
            },
          }
        : {}),
    } as unknown as AuthBindings,
    harness,
  };
}

async function seedOutbox(
  harness: PostgresHarness,
  profile: {
    ownerUserId: string;
    profileId: string;
    profileKind: "agent" | "human";
  }
): Promise<void> {
  const nowMs = Date.now();
  await harness.query({
    values: [
      profile.profileId,
      profile.ownerUserId,
      profile.profileKind,
      nowMs,
      nowMs,
      nowMs,
    ],
    text: `
      INSERT INTO "openmeld"."openmeld_profile_deletion_outbox" (
        profile_id,
        owner_user_id,
        profile_kind,
        next_attempt_at_ms,
        created_at_ms,
        updated_at_ms
      ) VALUES ($1, $2, $3, $4, $5, $6)
    `,
  });
}

async function readOutbox(
  harness: PostgresHarness,
  profileId = AGENT_PROFILE.profileId
): Promise<{ attempt_count: number; last_error: string | null } | null> {
  return await harness.queryFirst({
    values: [profileId],
    text: `
      SELECT attempt_count, last_error
      FROM "openmeld"."openmeld_profile_deletion_outbox"
      WHERE profile_id = $1
    `,
  });
}

describe("reconcileDeletedAgentProfileMemberships", () => {
  it("removes the durable retry item only after Core confirms every consequence", async () => {
    const reconcile = vi.fn().mockResolvedValue({
      bindingDisabled: true,
      complete: true,
      profileId: AGENT_PROFILE.profileId,
      spaces: [{ spaceId: "a".repeat(64), status: "removed" }],
    });
    const { env, harness } = await createEnv({ reconcile });

    await reconcileDeletedAgentProfileMemberships(env, AGENT_PROFILE);

    expect(reconcile).toHaveBeenCalledWith({
      ownerUserId: AGENT_PROFILE.ownerUserId,
      profileId: AGENT_PROFILE.profileId,
      profileKind: "agent",
      spaceIds: [],
    });
    expect(await readOutbox(harness)).toBeNull();
  });

  it("fans out human Profile deletions with the human kind", async () => {
    const humanProfile = {
      ...AGENT_PROFILE,
      profileId: "33333333-3333-4333-8333-333333333333",
      profileKind: "human",
    } as const;
    const reconcile = vi.fn().mockResolvedValue({
      bindingDisabled: false,
      complete: true,
      profileId: humanProfile.profileId,
      spaces: [],
    });
    const { env, harness } = await createEnv({
      profile: humanProfile,
      reconcile,
    });

    await reconcileDeletedAgentProfileMemberships(env, humanProfile);

    expect(reconcile).toHaveBeenCalledWith(
      expect.objectContaining({ profileKind: "human" })
    );
    expect(await readOutbox(harness, humanProfile.profileId)).toBeNull();
  });

  it("keeps the item retryable when the Core binding is missing", async () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const { env, harness } = await createEnv({});

    await expect(
      reconcileDeletedAgentProfileMemberships(env, AGENT_PROFILE)
    ).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledWith(
      "[auth.profile.deleted_reconcile_skipped]",
      expect.objectContaining({
        reason: "openmeld_core_worker_unbound",
      })
    );
    expect(await readOutbox(harness)).toMatchObject({
      attempt_count: 1,
      last_error: "openmeld_core_worker_unbound",
    });
  });

  it("keeps the item retryable when the Core call fails", async () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const reconcile = vi.fn().mockRejectedValue(new Error("core down"));
    const { env, harness } = await createEnv({ reconcile });

    await expect(
      reconcileDeletedAgentProfileMemberships(env, AGENT_PROFILE)
    ).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledWith(
      "[auth.profile.deleted_reconcile_failed]",
      expect.objectContaining({
        error: "core down",
        profileId: AGENT_PROFILE.profileId,
      })
    );
    expect(await readOutbox(harness)).toMatchObject({
      attempt_count: 1,
      last_error: "core down",
    });
  });

  it("keeps the item when Core omits completion during a rolling deploy", async () => {
    const reconcile = vi.fn().mockResolvedValue({
      bindingDisabled: true,
      profileId: AGENT_PROFILE.profileId,
      spaces: [],
    });
    const { env, harness } = await createEnv({ reconcile });

    await reconcileDeletedAgentProfileMemberships(env, AGENT_PROFILE);

    expect(await readOutbox(harness)).toMatchObject({
      attempt_count: 1,
      last_error: "core_reconcile_incomplete",
    });
  });
});

describe("runDeletedProfileReconcileOutbox", () => {
  it("retries due deletions and clears only the confirmed item", async () => {
    const secondProfile = {
      ownerUserId: "owner-2",
      profileId: "agt_22222222-2222-4222-8222-222222222222",
      profileKind: "agent",
    } as const;
    const reconcile = vi
      .fn()
      .mockResolvedValueOnce({
        bindingDisabled: false,
        complete: true,
        profileId: AGENT_PROFILE.profileId,
        spaces: [],
      })
      .mockResolvedValueOnce({
        bindingDisabled: false,
        complete: false,
        profileId: secondProfile.profileId,
        spaces: [],
      });
    const { env, harness } = await createEnv({ reconcile });
    await seedOutbox(harness, secondProfile);
    await harness.query({
      values: [Date.now() - 1],
      text: 'UPDATE "openmeld"."openmeld_profile_deletion_outbox" SET next_attempt_at_ms = $1',
    });

    await expect(
      runDeletedProfileReconcileOutbox(env, { limit: 10 })
    ).resolves.toEqual({ completed: 1, failed: 1, scanned: 2 });

    expect(await readOutbox(harness, AGENT_PROFILE.profileId)).toBeNull();
    expect(await readOutbox(harness, secondProfile.profileId)).toMatchObject({
      attempt_count: 1,
      last_error: "core_reconcile_incomplete",
    });
  });
});
