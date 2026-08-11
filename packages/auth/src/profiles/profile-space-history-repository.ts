import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { createD1Db } from "../db";
import type {
  OpenMeldProfileSpaceCreatorKind,
  OpenMeldProfileSpaceHistoryStatus,
} from "../db/profile-space-history.schema";
import { openMeldProfileSpaceHistory } from "../db/profile-space-history.schema";

export type ProfileSpaceHistoryRecord = InferSelectModel<
  typeof openMeldProfileSpaceHistory
>;

type NewProfileSpaceHistoryRecord = InferInsertModel<
  typeof openMeldProfileSpaceHistory
>;

export type ListProfileSpaceHistoryInput = {
  profileId: string;
  gatewayHost: string;
  statuses?: OpenMeldProfileSpaceHistoryStatus[];
  pinned?: boolean;
  limit: number;
};

export type ListProfileSpaceHistoryForProfilesInput = {
  profileIds: string[];
  gatewayHost: string;
  statuses?: OpenMeldProfileSpaceHistoryStatus[];
  limit: number;
};

export type UpsertProfileSpaceHistoryInput = {
  profileId: string;
  gatewayHost: string;
  spaceId: string;
  spaceName?: string | null;
  creatorProfileId?: string | null;
  creatorKind?: OpenMeldProfileSpaceCreatorKind | null;
  spaceCreatedAt?: Date | null;
  spaceUpdatedAt?: Date | null;
  lastJoinedAt?: Date;
  lastSeenTs?: number | null;
  pinnedAt?: Date | null;
  status?: OpenMeldProfileSpaceHistoryStatus;
};

export type UpdateProfileSpaceHistoryStatusInput = {
  profileId: string;
  gatewayHost: string;
  spaceId: string;
  status: OpenMeldProfileSpaceHistoryStatus;
};

export type ListAccessibleSpaceIdsInput = {
  profileIds: string[];
  gatewayHost: string;
  spaceIds: string[];
};

export type ProfileSpaceHistoryRepository = {
  listByProfileAndGateway: (
    input: ListProfileSpaceHistoryInput
  ) => Promise<ProfileSpaceHistoryRecord[]>;
  listByProfilesAndGateway: (
    input: ListProfileSpaceHistoryForProfilesInput
  ) => Promise<ProfileSpaceHistoryRecord[]>;
  listAccessibleSpaceIds: (
    input: ListAccessibleSpaceIdsInput
  ) => Promise<string[]>;
  upsert: (
    input: UpsertProfileSpaceHistoryInput
  ) => Promise<ProfileSpaceHistoryRecord>;
  updateStatus: (
    input: UpdateProfileSpaceHistoryStatusInput
  ) => Promise<ProfileSpaceHistoryRecord | null>;
};

type OpenMeldProfileDatabase = ReturnType<typeof createD1Db>;

export function createDrizzleProfileSpaceHistoryRepository(
  db: OpenMeldProfileDatabase
): ProfileSpaceHistoryRepository {
  return {
    listByProfileAndGateway(input) {
      const statuses = input.statuses ?? [];
      const filters = [
        eq(openMeldProfileSpaceHistory.profileId, input.profileId),
        eq(openMeldProfileSpaceHistory.gatewayHost, input.gatewayHost),
      ];
      if (statuses.length > 0) {
        filters.push(inArray(openMeldProfileSpaceHistory.status, statuses));
      }
      if (input.pinned === true) {
        filters.push(isNotNull(openMeldProfileSpaceHistory.pinnedAt));
      } else if (input.pinned === false) {
        filters.push(isNull(openMeldProfileSpaceHistory.pinnedAt));
      }

      const orderByColumns =
        input.pinned === true
          ? [
              desc(openMeldProfileSpaceHistory.pinnedAt),
              desc(openMeldProfileSpaceHistory.lastJoinedAt),
              desc(openMeldProfileSpaceHistory.updatedAt),
            ]
          : [
              desc(openMeldProfileSpaceHistory.lastJoinedAt),
              desc(openMeldProfileSpaceHistory.updatedAt),
            ];

      return db
        .select()
        .from(openMeldProfileSpaceHistory)
        .where(and(...filters))
        .orderBy(...orderByColumns)
        .limit(input.limit);
    },
    listByProfilesAndGateway(input) {
      if (input.profileIds.length === 0) {
        return Promise.resolve([]);
      }

      const statuses = input.statuses ?? [];
      const filters = [
        inArray(openMeldProfileSpaceHistory.profileId, input.profileIds),
        eq(openMeldProfileSpaceHistory.gatewayHost, input.gatewayHost),
      ];
      if (statuses.length > 0) {
        filters.push(inArray(openMeldProfileSpaceHistory.status, statuses));
      }

      return db
        .select()
        .from(openMeldProfileSpaceHistory)
        .where(and(...filters))
        .orderBy(
          desc(openMeldProfileSpaceHistory.pinnedAt),
          desc(openMeldProfileSpaceHistory.lastJoinedAt),
          desc(openMeldProfileSpaceHistory.updatedAt)
        )
        .limit(input.limit);
    },
    async listAccessibleSpaceIds(input) {
      if (input.profileIds.length === 0 || input.spaceIds.length === 0) {
        return [];
      }

      const rows = await db
        .select({
          spaceId: openMeldProfileSpaceHistory.spaceId,
        })
        .from(openMeldProfileSpaceHistory)
        .where(
          and(
            inArray(openMeldProfileSpaceHistory.profileId, input.profileIds),
            eq(openMeldProfileSpaceHistory.gatewayHost, input.gatewayHost),
            inArray(openMeldProfileSpaceHistory.spaceId, input.spaceIds)
          )
        );
      return Array.from(new Set(rows.map((row) => row.spaceId)));
    },
    upsert(input) {
      const keyWhere = buildProfileSpaceHistoryKeyWhere(input);
      return (async () => {
        const current =
          (
            await db
              .select()
              .from(openMeldProfileSpaceHistory)
              .where(keyWhere)
              .limit(1)
          )[0] ?? null;

        const now = new Date();
        const record = buildProfileSpaceHistoryUpsertRecord({
          input,
          current,
          now,
        });

        await db
          .insert(openMeldProfileSpaceHistory)
          .values(record)
          .onConflictDoUpdate({
            target: [
              openMeldProfileSpaceHistory.profileId,
              openMeldProfileSpaceHistory.gatewayHost,
              openMeldProfileSpaceHistory.spaceId,
            ],
            set: toProfileSpaceHistoryUpdateSet(record),
          });

        const stored =
          (
            await db
              .select()
              .from(openMeldProfileSpaceHistory)
              .where(keyWhere)
              .limit(1)
          )[0] ?? null;

        if (!stored) {
          throw new Error("failed to persist profile space history");
        }

        return stored;
      })();
    },
    async updateStatus(input) {
      const rows = await db
        .update(openMeldProfileSpaceHistory)
        .set({
          status: input.status,
          updatedAt: new Date(),
        })
        .where(buildProfileSpaceHistoryKeyWhere(input))
        .returning();

      return rows[0] ?? null;
    },
  };
}

// Owner-agnostic scan for the periodic Space Index overlay reconcile
// (physical-db-split.md D7). The per-write onHistoryWritten hook is
// fire-and-forget, so a dropped/failed Auth→Core overlay announcement (broken
// binding window, projection lag, transient RPC error) would otherwise leave
// the membership overlay (pinned/last-joined) permanently stale. This returns
// the most-recently-updated active history rows so a bounded periodic sweep can
// re-announce them and converge the projection from its source of truth.
export function listActiveProfileSpaceHistoryForOverlayReconcile(
  db: OpenMeldProfileDatabase,
  limit: number
): Promise<ProfileSpaceHistoryRecord[]> {
  return db
    .select()
    .from(openMeldProfileSpaceHistory)
    .where(eq(openMeldProfileSpaceHistory.status, "active"))
    .orderBy(desc(openMeldProfileSpaceHistory.updatedAt))
    .limit(limit);
}

function buildProfileSpaceHistoryKeyWhere(input: {
  profileId: string;
  gatewayHost: string;
  spaceId: string;
}) {
  return and(
    eq(openMeldProfileSpaceHistory.profileId, input.profileId),
    eq(openMeldProfileSpaceHistory.gatewayHost, input.gatewayHost),
    eq(openMeldProfileSpaceHistory.spaceId, input.spaceId)
  );
}

function buildProfileSpaceHistoryUpsertRecord(input: {
  input: UpsertProfileSpaceHistoryInput;
  current: ProfileSpaceHistoryRecord | null;
  now: Date;
}): NewProfileSpaceHistoryRecord {
  return {
    profileId: input.input.profileId,
    gatewayHost: input.input.gatewayHost,
    spaceId: input.input.spaceId,
    spaceName: resolveNullableUpdateValue(
      input.current?.spaceName,
      input.input.spaceName
    ),
    creatorProfileId: resolveNullableUpdateValue(
      input.current?.creatorProfileId,
      input.input.creatorProfileId
    ),
    creatorKind: resolveNullableUpdateValue(
      input.current?.creatorKind,
      input.input.creatorKind
    ),
    spaceCreatedAt: resolveNullableUpdateValue(
      input.current?.spaceCreatedAt,
      input.input.spaceCreatedAt
    ),
    spaceUpdatedAt: resolveNullableUpdateValue(
      input.current?.spaceUpdatedAt,
      input.input.spaceUpdatedAt
    ),
    lastJoinedAt:
      input.input.lastJoinedAt ?? input.current?.lastJoinedAt ?? input.now,
    lastSeenTs: resolveNullableUpdateValue(
      input.current?.lastSeenTs,
      input.input.lastSeenTs
    ),
    pinnedAt: resolveNullableUpdateValue(
      input.current?.pinnedAt,
      input.input.pinnedAt
    ),
    status: input.input.status ?? input.current?.status ?? "active",
    createdAt: input.current?.createdAt ?? input.now,
    updatedAt: input.now,
  };
}

function toProfileSpaceHistoryUpdateSet(record: NewProfileSpaceHistoryRecord) {
  return {
    spaceName: record.spaceName ?? null,
    creatorProfileId: record.creatorProfileId ?? null,
    creatorKind: record.creatorKind ?? null,
    spaceCreatedAt: record.spaceCreatedAt ?? null,
    spaceUpdatedAt: record.spaceUpdatedAt ?? null,
    lastJoinedAt: record.lastJoinedAt,
    lastSeenTs: record.lastSeenTs ?? null,
    pinnedAt: record.pinnedAt ?? null,
    status: record.status,
    updatedAt: record.updatedAt,
  } as const;
}

function resolveNullableUpdateValue<T>(
  current: T | null | undefined,
  incoming: T | null | undefined
): T | null {
  if (incoming === undefined) {
    return current ?? null;
  }
  return incoming;
}
