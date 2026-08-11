import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import { and, eq, inArray } from "drizzle-orm";
import type { createD1Db } from "../db";
import type { OpenMeldProfileSpaceCreatorKind } from "../db/profile-space-history.schema";
import { openMeldSpaceDeletionTombstones } from "../db/space-deletion-tombstone.schema";

export type SpaceDeletionTombstoneRecord = InferSelectModel<
  typeof openMeldSpaceDeletionTombstones
>;

type NewSpaceDeletionTombstoneRecord = InferInsertModel<
  typeof openMeldSpaceDeletionTombstones
>;

export type QuerySpaceDeletionTombstonesInput = {
  gatewayHost: string;
  spaceIds: string[];
};

export type UpsertSpaceDeletionTombstoneInput = {
  gatewayHost: string;
  spaceId: string;
  spaceName?: string | null;
  creatorProfileId?: string | null;
  creatorKind?: OpenMeldProfileSpaceCreatorKind | null;
  deletedByProfileId?: string | null;
  deletedByProfileName?: string | null;
  deletedByOwnerUserId?: string | null;
  deletedAt?: Date;
};

export type SpaceDeletionTombstoneRepository = {
  queryByGatewayAndSpaceIds: (
    input: QuerySpaceDeletionTombstonesInput
  ) => Promise<SpaceDeletionTombstoneRecord[]>;
  upsert: (
    input: UpsertSpaceDeletionTombstoneInput
  ) => Promise<SpaceDeletionTombstoneRecord>;
};

type OpenMeldProfileDatabase = ReturnType<typeof createD1Db>;

export function createDrizzleSpaceDeletionTombstoneRepository(
  db: OpenMeldProfileDatabase
): SpaceDeletionTombstoneRepository {
  return {
    queryByGatewayAndSpaceIds(input) {
      if (input.spaceIds.length === 0) {
        return Promise.resolve([]);
      }

      return (async () => {
        const items = await db
          .select()
          .from(openMeldSpaceDeletionTombstones)
          .where(
            and(
              eq(
                openMeldSpaceDeletionTombstones.gatewayHost,
                input.gatewayHost
              ),
              inArray(openMeldSpaceDeletionTombstones.spaceId, input.spaceIds)
            )
          );

        const order = new Map(
          input.spaceIds.map((spaceId, index) => [spaceId, index] as const)
        );
        return items.sort(
          (left, right) =>
            (order.get(left.spaceId) ?? Number.MAX_SAFE_INTEGER) -
            (order.get(right.spaceId) ?? Number.MAX_SAFE_INTEGER)
        );
      })();
    },
    upsert(input) {
      const keyWhere = buildSpaceDeletionTombstoneKeyWhere(input);
      return (async () => {
        const current =
          (
            await db
              .select()
              .from(openMeldSpaceDeletionTombstones)
              .where(keyWhere)
              .limit(1)
          )[0] ?? null;

        const now = new Date();
        const record = buildSpaceDeletionTombstoneUpsertRecord({
          input,
          current,
          now,
        });

        await db
          .insert(openMeldSpaceDeletionTombstones)
          .values(record)
          .onConflictDoUpdate({
            target: [
              openMeldSpaceDeletionTombstones.gatewayHost,
              openMeldSpaceDeletionTombstones.spaceId,
            ],
            set: toSpaceDeletionTombstoneUpdateSet(record),
          });

        const stored =
          (
            await db
              .select()
              .from(openMeldSpaceDeletionTombstones)
              .where(keyWhere)
              .limit(1)
          )[0] ?? null;

        if (!stored) {
          throw new Error("failed to persist space deletion tombstone");
        }

        return stored;
      })();
    },
  };
}

function buildSpaceDeletionTombstoneKeyWhere(input: {
  gatewayHost: string;
  spaceId: string;
}) {
  return and(
    eq(openMeldSpaceDeletionTombstones.gatewayHost, input.gatewayHost),
    eq(openMeldSpaceDeletionTombstones.spaceId, input.spaceId)
  );
}

function buildSpaceDeletionTombstoneUpsertRecord(input: {
  input: UpsertSpaceDeletionTombstoneInput;
  current: SpaceDeletionTombstoneRecord | null;
  now: Date;
}): NewSpaceDeletionTombstoneRecord {
  return {
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
    deletedByProfileId: resolvePreservingActorValue(
      input.current?.deletedByProfileId,
      input.input.deletedByProfileId
    ),
    deletedByProfileName: resolvePreservingActorValue(
      input.current?.deletedByProfileName,
      input.input.deletedByProfileName
    ),
    deletedByOwnerUserId: resolvePreservingActorValue(
      input.current?.deletedByOwnerUserId,
      input.input.deletedByOwnerUserId
    ),
    deletedAt: input.input.deletedAt ?? input.current?.deletedAt ?? input.now,
    createdAt: input.current?.createdAt ?? input.now,
    updatedAt: input.now,
  };
}

function toSpaceDeletionTombstoneUpdateSet(
  record: NewSpaceDeletionTombstoneRecord
) {
  return {
    spaceName: record.spaceName ?? null,
    creatorProfileId: record.creatorProfileId ?? null,
    creatorKind: record.creatorKind ?? null,
    deletedByProfileId: record.deletedByProfileId ?? null,
    deletedByProfileName: record.deletedByProfileName ?? null,
    deletedByOwnerUserId: record.deletedByOwnerUserId ?? null,
    deletedAt: record.deletedAt,
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

function resolvePreservingActorValue(
  current: string | null | undefined,
  incoming: string | null | undefined
): string | null {
  if (incoming === undefined || incoming === null) {
    return current ?? null;
  }
  return incoming;
}
