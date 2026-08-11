import { afterEach, describe, expect, it, vi } from "vitest";
import { Space } from "../space/transport/do/space";

type SpaceMemberSqlRow = {
  space_id: string;
  profile_id: string;
  profile_kind_snapshot: "agent" | "human";
  profile_name_snapshot: string;
  owner_user_id_snapshot: string | null;
  owner_name_snapshot: string | null;
  controller_ref_snapshot: string | null;
  status: "active" | "removed";
  member_source:
    | "added_by_member"
    | "backfilled"
    | "joined_directly"
    | "space_creator";
  added_at: number;
  removed_at: number | null;
  added_by_profile_id: string | null;
  added_by_owner_user_id: string | null;
  added_by_display_name_snapshot: string | null;
  removed_by_profile_id: string | null;
  removed_by_owner_user_id: string | null;
  removal_reason: string | null;
  first_entered_at: number | null;
  last_entered_at: number | null;
  created_at: number;
  updated_at: number;
};

const nowMs = Date.UTC(2026, 0, 1, 0, 0, 0);

function buildSpaceMemberRow(
  overrides: Partial<SpaceMemberSqlRow> & {
    profile_id: string;
    profile_kind_snapshot: "agent" | "human";
  }
): SpaceMemberSqlRow {
  return {
    added_at: nowMs,
    added_by_display_name_snapshot: null,
    added_by_owner_user_id: null,
    added_by_profile_id: null,
    controller_ref_snapshot: null,
    created_at: nowMs,
    first_entered_at: null,
    last_entered_at: null,
    member_source: "added_by_member",
    owner_name_snapshot: null,
    owner_user_id_snapshot: null,
    profile_name_snapshot: "Test Member",
    removal_reason: null,
    removed_at: null,
    removed_by_owner_user_id: null,
    removed_by_profile_id: null,
    space_id: "space-1",
    status: "active",
    updated_at: nowMs,
    ...overrides,
  };
}

function buildSpaceTestDouble(rows: readonly SpaceMemberSqlRow[]) {
  const livenessWrites: { params: unknown[]; sql: string }[] = [];
  const syncSpaceBackgroundAlarm = vi.fn(() => Promise.resolve());
  const sql = {
    exec: vi.fn((query: string, ...params: unknown[]) => {
      if (query.includes("space_member_profile_liveness")) {
        livenessWrites.push({ params, sql: query });
        return { toArray: () => [] };
      }
      if (query.includes("FROM space_members")) {
        const [profileId] = params;
        const selectedRows = rows.filter((row) => row.profile_id === profileId);
        return { toArray: () => Array.from(selectedRows) };
      }
      return { toArray: () => [] };
    }),
  } as unknown as SqlStorage;
  const space = Object.create(Space.prototype) as {
    rpcRecordMemberProfileNotFoundObservation: Space["rpcRecordMemberProfileNotFoundObservation"];
  };
  Object.defineProperties(space, {
    ctx: {
      value: {
        storage: { sql },
      },
    },
    durableObjectId: { value: "space-1" },
    spaceId: { value: "space-1", writable: true },
    syncSpaceBackgroundAlarm: { value: syncSpaceBackgroundAlarm },
  });
  return { livenessWrites, space, syncSpaceBackgroundAlarm };
}

describe("Space member liveness observation RPC", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("records evidence for an active agent member and arms the liveness alarm", async () => {
    const { livenessWrites, space, syncSpaceBackgroundAlarm } =
      buildSpaceTestDouble([
        buildSpaceMemberRow({
          profile_id: "agent-active-1",
          profile_kind_snapshot: "agent",
        }),
      ]);

    const result = await space.rpcRecordMemberProfileNotFoundObservation({
      profileId: "agent-active-1",
      spaceId: "space-1",
    });

    expect(result).toEqual({ recorded: true });
    expect(livenessWrites).toHaveLength(1);
    expect(livenessWrites[0]?.sql).toContain(
      "INSERT INTO space_member_profile_liveness"
    );
    expect(livenessWrites[0]?.params[0]).toBe("agent-active-1");
    // A dormant Space may see no other DO activity: the write itself must
    // guarantee the background alarm wakes to re-verify and reconcile.
    expect(syncSpaceBackgroundAlarm).toHaveBeenCalledTimes(1);
  });

  it("noops for a human member", async () => {
    const { livenessWrites, space, syncSpaceBackgroundAlarm } =
      buildSpaceTestDouble([
        buildSpaceMemberRow({
          profile_id: "human-active-1",
          profile_kind_snapshot: "human",
        }),
      ]);

    const result = await space.rpcRecordMemberProfileNotFoundObservation({
      profileId: "human-active-1",
      spaceId: "space-1",
    });

    expect(result).toEqual({ recorded: false });
    expect(livenessWrites).toHaveLength(0);
    expect(syncSpaceBackgroundAlarm).not.toHaveBeenCalled();
  });

  it("noops for an already-removed agent member", async () => {
    const { livenessWrites, space, syncSpaceBackgroundAlarm } =
      buildSpaceTestDouble([
        buildSpaceMemberRow({
          profile_id: "agent-removed-1",
          profile_kind_snapshot: "agent",
          removed_at: nowMs + 1,
          status: "removed",
        }),
      ]);

    const result = await space.rpcRecordMemberProfileNotFoundObservation({
      profileId: "agent-removed-1",
      spaceId: "space-1",
    });

    expect(result).toEqual({ recorded: false });
    expect(livenessWrites).toHaveLength(0);
    expect(syncSpaceBackgroundAlarm).not.toHaveBeenCalled();
  });

  it("noops for a profile that is not a member of this Space", async () => {
    const { livenessWrites, space, syncSpaceBackgroundAlarm } =
      buildSpaceTestDouble([]);

    const result = await space.rpcRecordMemberProfileNotFoundObservation({
      profileId: "agent-non-member-1",
      spaceId: "space-1",
    });

    expect(result).toEqual({ recorded: false });
    expect(livenessWrites).toHaveLength(0);
    expect(syncSpaceBackgroundAlarm).not.toHaveBeenCalled();
  });

  it("rejects a spaceId that does not match the bound durable object", async () => {
    const { livenessWrites, space } = buildSpaceTestDouble([
      buildSpaceMemberRow({
        profile_id: "agent-active-1",
        profile_kind_snapshot: "agent",
      }),
    ]);

    await expect(
      space.rpcRecordMemberProfileNotFoundObservation({
        profileId: "agent-active-1",
        spaceId: "space-2",
      })
    ).rejects.toThrow();
    expect(livenessWrites).toHaveLength(0);
  });
});
