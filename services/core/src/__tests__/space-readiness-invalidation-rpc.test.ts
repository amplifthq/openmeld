import type { SpaceLiveInvalidationFrame } from "@openmeld/protocol";
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

function buildSqlStorage(rows: readonly SpaceMemberSqlRow[]): SqlStorage {
  return {
    exec: vi.fn((_query: string, ...params: unknown[]) => {
      const [status] = params;
      const selectedRows =
        status === undefined
          ? rows
          : rows.filter((row) => row.status === status);
      return {
        toArray: () => Array.from(selectedRows),
      };
    }),
  } as unknown as SqlStorage;
}

function buildStorage(rows: readonly SpaceMemberSqlRow[]) {
  const values = new Map<string, unknown>();
  return {
    get: vi.fn((key: string) => Promise.resolve(values.get(key))),
    put: vi.fn((key: string, value: unknown) => {
      values.set(key, value);
      return Promise.resolve();
    }),
    sql: buildSqlStorage(rows),
  };
}

function buildSpaceTestDouble(rows: readonly SpaceMemberSqlRow[]) {
  const broadcast = vi.fn();
  const space = Object.create(Space.prototype) as {
    rpcBroadcastAgentReadinessInvalidated: Space["rpcBroadcastAgentReadinessInvalidated"];
    rpcBroadcastWakeProgressChanged: Space["rpcBroadcastWakeProgressChanged"];
  };
  Object.defineProperties(space, {
    broadcast: { value: broadcast },
    ctx: {
      value: {
        storage: buildStorage(rows),
      },
    },
    durableObjectId: { value: "space-1" },
    lastLiveInvalidationVersion: { value: 0, writable: true },
    liveInvalidationVersionUpdate: { value: Promise.resolve(), writable: true },
    spaceId: { value: "space-1", writable: true },
  });
  return { broadcast, space };
}

describe("Space readiness invalidation RPC", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("broadcasts invalidations only for current active agent members", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(nowMs));
    const { broadcast, space } = buildSpaceTestDouble([
      buildSpaceMemberRow({
        profile_id: "agent-active-1",
        profile_kind_snapshot: "agent",
      }),
      buildSpaceMemberRow({
        profile_id: "human-active-1",
        profile_kind_snapshot: "human",
      }),
      buildSpaceMemberRow({
        profile_id: "agent-removed-1",
        profile_kind_snapshot: "agent",
        removed_at: nowMs + 1,
        status: "removed",
      }),
    ]);

    const result = await space.rpcBroadcastAgentReadinessInvalidated({
      agentProfileIds: [
        "agent-active-1",
        "human-active-1",
        "agent-removed-1",
        "agent-non-member-1",
      ],
      reason: "test.route.changed",
      spaceId: "space-1",
    });

    expect(result).toEqual({
      agentProfileIds: ["agent-active-1"],
      broadcast: true,
      ok: true,
      spaceId: "space-1",
    });
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        agentProfileIds: ["agent-active-1"],
        reason: "test.route.changed",
        spaceId: "space-1",
        type: "agent.readiness.invalidated",
        version: nowMs,
      }) satisfies Partial<SpaceLiveInvalidationFrame>
    );
  });

  it("uses a per-Space monotonic invalidation version", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(nowMs));
    const { broadcast, space } = buildSpaceTestDouble([
      buildSpaceMemberRow({
        profile_id: "agent-active-1",
        profile_kind_snapshot: "agent",
      }),
    ]);

    await space.rpcBroadcastAgentReadinessInvalidated({
      agentProfileIds: ["agent-active-1"],
      reason: "test.first",
      spaceId: "space-1",
    });
    await space.rpcBroadcastAgentReadinessInvalidated({
      agentProfileIds: ["agent-active-1"],
      reason: "test.second",
      spaceId: "space-1",
    });

    expect(broadcast).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        reason: "test.first",
        version: nowMs,
      }) satisfies Partial<SpaceLiveInvalidationFrame>
    );
    expect(broadcast).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        reason: "test.second",
        version: nowMs + 1,
      }) satisfies Partial<SpaceLiveInvalidationFrame>
    );
  });

  it("broadcasts Wake progress as a refresh signal without embedding state", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(nowMs));
    const { broadcast, space } = buildSpaceTestDouble([]);

    const result = await space.rpcBroadcastWakeProgressChanged({
      agentProfileIds: ["agent-active-1", "agent-active-1"],
      clientMessageIds: ["client-message-1"],
      reason: "runtime_coordinator.wake_progress_changed",
      spaceId: "space-1",
    });

    expect(result).toEqual({
      broadcast: true,
      ok: true,
      spaceId: "space-1",
    });
    expect(broadcast).toHaveBeenCalledWith({
      agentProfileIds: ["agent-active-1"],
      clientMessageIds: ["client-message-1"],
      reason: "runtime_coordinator.wake_progress_changed",
      spaceId: "space-1",
      type: "wake.progress.changed",
      version: nowMs,
    });
  });
});
