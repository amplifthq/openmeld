import type { SignalEnvelope } from "@openmeld/protocol";
import { describe, expect, it, vi } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import { SpaceProfileLineageCache } from "../src/space/application/space-profile-lineage-cache";
import type { CreatorProfileIdsByProfileId } from "../src/space/rules/privacy/profile-lineage";
import { Space } from "../src/space/transport/do/space";

const OWNER_USER_ID = "owner-lineage-cache";
const VIEWER_PROFILE_ID = "human-lineage-cache";

type SpaceProfileLineageCacheHarness = {
  bindings: CoreBindings;
  ctx: {
    storage: {
      sql: SqlStorage;
    };
  };
  loadRecentSignals: () => SignalEnvelope[];
  measureBootstrapBranchTiming: <T>(
    timing: unknown,
    metricName: string,
    description: string,
    load: () => Promise<T> | T
  ) => Promise<T>;
  measureBootstrapBranchTimingSync: <T>(
    timing: unknown,
    metricName: string,
    description: string,
    load: () => T
  ) => T;
  ownerCreatorProfileIdsByOwnerUserId: Map<
    string,
    CreatorProfileIdsByProfileId
  >;
  preloadOwnerCreatorProfileIdsByOwnerUserId: (
    ownerUserIds: Iterable<string>
  ) => Promise<void>;
  profileLineageCache: SpaceProfileLineageCache;
  readSpaceMetaRecord: () => object;
  readViewerHistoryBoundary: () => Promise<null>;
  resolveOwnerCreatorProfileIdsByProfileId: (input: {
    ownerUserId?: string;
  }) => Promise<CreatorProfileIdsByProfileId | undefined>;
  resolveViewerCreatorProfileIdsByProfileId: (input: {
    viewerOwnerUserId?: string;
    viewerProfileId?: string;
  }) => Promise<CreatorProfileIdsByProfileId | undefined>;
  spaceId: string;
};

const resolveOwnerCreatorProfileIdsByProfileId = (
  Space.prototype as unknown as {
    resolveOwnerCreatorProfileIdsByProfileId(
      this: SpaceProfileLineageCacheHarness,
      input: { ownerUserId?: string }
    ): Promise<CreatorProfileIdsByProfileId | undefined>;
  }
).resolveOwnerCreatorProfileIdsByProfileId;

const resolveViewerCreatorProfileIdsByProfileId = (
  Space.prototype as unknown as {
    resolveViewerCreatorProfileIdsByProfileId(
      this: SpaceProfileLineageCacheHarness,
      input: {
        viewerOwnerUserId?: string;
        viewerProfileId?: string;
      }
    ): Promise<CreatorProfileIdsByProfileId | undefined>;
  }
).resolveViewerCreatorProfileIdsByProfileId;

const preloadDispatchContinuityCreatorProfileIds = (
  Space.prototype as unknown as {
    preloadDispatchContinuityCreatorProfileIds(
      this: SpaceProfileLineageCacheHarness
    ): Promise<void>;
  }
).preloadDispatchContinuityCreatorProfileIds;

const preloadOwnerCreatorProfileIdsByOwnerUserId = (
  Space.prototype as unknown as {
    preloadOwnerCreatorProfileIdsByOwnerUserId(
      this: SpaceProfileLineageCacheHarness,
      ownerUserIds: Iterable<string>
    ): Promise<void>;
  }
).preloadOwnerCreatorProfileIdsByOwnerUserId;

const handleListSignals = (
  Space.prototype as unknown as {
    handleListSignals(
      this: SpaceProfileLineageCacheHarness,
      input: {
        request: Request;
        viewerOwnerUserId?: string;
        viewerProfileId?: string;
      }
    ): Promise<Response>;
  }
).handleListSignals;

describe("Space profile lineage cache", () => {
  it("loads viewer lineage once across consecutive listSignals reads", async () => {
    const { listProfileLineage, space } = createHarness();

    expect(await listSignals(space)).toHaveProperty("status", 200);
    expect(await listSignals(space)).toHaveProperty("status", 200);

    expect(listProfileLineage).toHaveBeenCalledTimes(1);
    expect(listProfileLineage).toHaveBeenCalledWith({
      ownerUserId: OWNER_USER_ID,
    });
  });

  it("reuses dispatch continuity lineage preload for a later listSignals read", async () => {
    const { listProfileLineage, space } = createHarness();

    await preloadDispatchContinuityCreatorProfileIds.call(space);
    expect(listProfileLineage).toHaveBeenCalledTimes(1);

    expect(await listSignals(space)).toHaveProperty("status", 200);
    expect(listProfileLineage).toHaveBeenCalledTimes(1);
  });
});

function createHarness(): {
  listProfileLineage: ReturnType<typeof vi.fn>;
  space: SpaceProfileLineageCacheHarness;
} {
  const listProfileLineage = vi.fn().mockResolvedValue({
    ok: true,
    profiles: [
      {
        creatorProfileId: null,
        profileId: VIEWER_PROFILE_ID,
      },
    ],
  });
  // Keeps the stored lineage row; every other read sees one active member.
  let lineageRow: Record<string, unknown> | null = null;
  const sql = {
    exec: vi.fn((query: string, ...params: unknown[]) => {
      if (query.includes("INSERT INTO space_profile_lineage")) {
        const [owner_user_id, creator, covered, fetched_at_ms] = params;
        lineageRow = {
          owner_user_id,
          creator_profile_ids_json: creator,
          covered_profile_ids_json: covered,
          fetched_at_ms,
        };
        return { toArray: () => [] };
      }
      if (query.includes("FROM space_profile_lineage")) {
        return { toArray: () => (lineageRow ? [lineageRow] : []) };
      }
      return { toArray: () => [createActiveMemberRow()] };
    }),
  } as unknown as SqlStorage;
  const ownerCreatorProfileIdsByOwnerUserId = new Map<
    string,
    CreatorProfileIdsByProfileId
  >();
  const bindings = {
    OPENMELD_AUTH_WORKER: {
      listProfileLineage,
    },
  } as unknown as CoreBindings;
  // Other Space methods come from the prototype; only state is stubbed.
  const state: SpaceProfileLineageCacheHarness = {
    bindings,
    ctx: { storage: { sql } },
    loadRecentSignals: () => [],
    measureBootstrapBranchTiming: async (
      _timing,
      _metricName,
      _description,
      load
    ) => await load(),
    measureBootstrapBranchTimingSync: (
      _timing,
      _metricName,
      _description,
      load
    ) => load(),
    ownerCreatorProfileIdsByOwnerUserId,
    preloadOwnerCreatorProfileIdsByOwnerUserId,
    profileLineageCache: new SpaceProfileLineageCache({
      authRpc: () => bindings.OPENMELD_AUTH_WORKER,
      onLoadError: () => undefined,
      resolvedByOwnerUserId: ownerCreatorProfileIdsByOwnerUserId,
      sql: () => sql,
      waitUntil: () => undefined,
    }),
    readSpaceMetaRecord: () => ({}),
    readViewerHistoryBoundary: async () => null,
    resolveOwnerCreatorProfileIdsByProfileId,
    resolveViewerCreatorProfileIdsByProfileId,
    spaceId: "space-lineage-cache",
  };
  const space = Object.assign(
    Object.create(Space.prototype) as object,
    state
  ) as SpaceProfileLineageCacheHarness;
  return { listProfileLineage, space };
}

async function listSignals(
  space: SpaceProfileLineageCacheHarness
): Promise<Response> {
  return await handleListSignals.call(space, {
    request: new Request(
      "https://openmeld-core.test/signals?recent=true&limit=20"
    ),
    viewerOwnerUserId: OWNER_USER_ID,
    viewerProfileId: VIEWER_PROFILE_ID,
  });
}

function createActiveMemberRow() {
  return {
    added_at: 1,
    added_by_display_name_snapshot: null,
    added_by_owner_user_id: OWNER_USER_ID,
    added_by_profile_id: VIEWER_PROFILE_ID,
    controller_ref_snapshot: null,
    created_at: 1,
    first_entered_at: 1,
    last_entered_at: 1,
    member_source: "space_creator",
    owner_name_snapshot: "Test Owner",
    owner_user_id_snapshot: OWNER_USER_ID,
    profile_id: VIEWER_PROFILE_ID,
    profile_kind_snapshot: "human",
    profile_name_snapshot: "Test Owner",
    removal_reason: null,
    removed_at: null,
    removed_by_owner_user_id: null,
    removed_by_profile_id: null,
    space_id: "space-lineage-cache",
    status: "active",
    updated_at: 1,
  };
}
