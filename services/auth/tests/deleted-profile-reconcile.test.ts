import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthBindings } from "../src/lib/bindings";
import {
  reconcileDeletedAgentProfileMemberships,
  runDeletedProfileReconcileOutbox,
} from "../src/lib/profiles/deleted-profile-reconcile";
import {
  applyDrizzleMigrations,
  createSqliteD1Harness,
  type SqliteD1Harness,
} from "./support/sqlite-d1-harness";

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

const harnesses: SqliteD1Harness[] = [];

afterEach(() => {
  for (const harness of harnesses.splice(0)) {
    harness.close();
  }
  vi.restoreAllMocks();
});

function createEnv(input: {
  reconcile?: ReturnType<typeof vi.fn>;
  profile?: TestDeletedProfile;
}): { env: AuthBindings; harness: SqliteD1Harness } {
  const harness = createSqliteD1Harness();
  harnesses.push(harness);
  applyDrizzleMigrations(harness.database);
  const profile = input.profile ?? AGENT_PROFILE;
  seedOutbox(harness, profile);
  return {
    env: {
      OPENMELD_DB: harness.db,
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

function seedOutbox(
  harness: SqliteD1Harness,
  profile: {
    ownerUserId: string;
    profileId: string;
    profileKind: "agent" | "human";
  }
): void {
  const nowMs = Date.now();
  harness.run({
    params: [
      profile.profileId,
      profile.ownerUserId,
      profile.profileKind,
      nowMs,
      nowMs,
      nowMs,
    ],
    sql: `
      INSERT INTO openmeld_profile_deletion_outbox (
        profile_id,
        owner_user_id,
        profile_kind,
        next_attempt_at_ms,
        created_at_ms,
        updated_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?)
    `,
  });
}

function readOutbox(
  harness: SqliteD1Harness,
  profileId = AGENT_PROFILE.profileId
): { attempt_count: number; last_error: string | null } | null {
  return harness.queryFirst({
    params: [profileId],
    sql: `
      SELECT attempt_count, last_error
      FROM openmeld_profile_deletion_outbox
      WHERE profile_id = ?
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
    const { env, harness } = createEnv({ reconcile });

    await reconcileDeletedAgentProfileMemberships(env, AGENT_PROFILE);

    expect(reconcile).toHaveBeenCalledWith({
      ownerUserId: AGENT_PROFILE.ownerUserId,
      profileId: AGENT_PROFILE.profileId,
      profileKind: "agent",
      spaceIds: [],
    });
    expect(readOutbox(harness)).toBeNull();
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
    const { env, harness } = createEnv({
      profile: humanProfile,
      reconcile,
    });

    await reconcileDeletedAgentProfileMemberships(env, humanProfile);

    expect(reconcile).toHaveBeenCalledWith(
      expect.objectContaining({ profileKind: "human" })
    );
    expect(readOutbox(harness, humanProfile.profileId)).toBeNull();
  });

  it("keeps the item retryable when the Core binding is missing", async () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const { env, harness } = createEnv({});

    await expect(
      reconcileDeletedAgentProfileMemberships(env, AGENT_PROFILE)
    ).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledWith(
      "[auth.profile.deleted_reconcile_skipped]",
      expect.objectContaining({
        reason: "openmeld_core_worker_unbound",
      })
    );
    expect(readOutbox(harness)).toMatchObject({
      attempt_count: 1,
      last_error: "openmeld_core_worker_unbound",
    });
  });

  it("keeps the item retryable when the Core call fails", async () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const reconcile = vi.fn().mockRejectedValue(new Error("core down"));
    const { env, harness } = createEnv({ reconcile });

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
    expect(readOutbox(harness)).toMatchObject({
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
    const { env, harness } = createEnv({ reconcile });

    await reconcileDeletedAgentProfileMemberships(env, AGENT_PROFILE);

    expect(readOutbox(harness)).toMatchObject({
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
    const { env, harness } = createEnv({ reconcile });
    seedOutbox(harness, secondProfile);
    harness.run({
      params: [Date.now() - 1],
      sql: "UPDATE openmeld_profile_deletion_outbox SET next_attempt_at_ms = ?",
    });

    await expect(
      runDeletedProfileReconcileOutbox(env, { limit: 10 })
    ).resolves.toEqual({ completed: 1, failed: 1, scanned: 2 });

    expect(readOutbox(harness, AGENT_PROFILE.profileId)).toBeNull();
    expect(readOutbox(harness, secondProfile.profileId)).toMatchObject({
      attempt_count: 1,
      last_error: "core_reconcile_incomplete",
    });
  });
});
