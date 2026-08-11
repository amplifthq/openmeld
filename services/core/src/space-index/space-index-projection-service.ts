import type { SpaceMemberRecord } from "../space/infrastructure/sql/space-member-repo";
import type { SpaceMetaRecord } from "../space/infrastructure/sql/space-meta-repo";
import {
  type SpaceIndexMembershipProjection,
  type SpaceIndexSpaceProjection,
  upsertSpaceIndexMembership,
  upsertSpaceIndexSpace,
  writeSpaceIndexProjectionEvent,
} from "./space-index-repository";

export type ProjectSpaceIndexSnapshotInput = {
  db: D1Database;
  eventType:
    | "space.index_backfilled"
    | "space.created"
    | "space.meta_updated"
    | "space.members_updated"
    | "space.deleted";
  metaRecord: SpaceMetaRecord;
  memberRecords: readonly SpaceMemberRecord[];
};

export type ProjectDeletedSpaceIndexSnapshotInput =
  ProjectSpaceIndexSnapshotInput & {
    deletedAt: string;
    deletedByOwnerUserId?: string | null;
    deletedByProfileId?: string | null;
    deletedByProfileName?: string | null;
  };

export async function projectActiveSpaceIndexSnapshot(
  input: ProjectSpaceIndexSnapshotInput
): Promise<{ memberCount: number; projectionEventId: string }> {
  const sourceUpdatedAt = resolveActiveSnapshotSourceUpdatedAt(input);
  const projectionEventId = buildSpaceIndexProjectionEventId({
    eventType: input.eventType,
    sourceUpdatedAt,
    spaceId: input.metaRecord.spaceId,
  });
  await upsertSpaceIndexSpace({
    db: input.db,
    space: toActiveSpaceProjection({
      memberRecords: input.memberRecords,
      metaRecord: input.metaRecord,
      projectionEventId,
      sourceUpdatedAt,
    }),
  });
  for (const memberRecord of input.memberRecords) {
    await upsertSpaceIndexMembership({
      db: input.db,
      membership: toMembershipProjection({
        memberRecord,
        projectionEventId,
        sourceUpdatedAt: memberRecord.updatedAt,
      }),
    });
  }
  await writeSpaceIndexProjectionEvent({
    db: input.db,
    event: {
      eventType: input.eventType,
      payload: {
        memberCount: input.memberRecords.length,
        spaceId: input.metaRecord.spaceId,
      },
      projectionEventId,
      sourceUpdatedAt,
      spaceId: input.metaRecord.spaceId,
    },
  });
  return {
    memberCount: input.memberRecords.length,
    projectionEventId,
  };
}

export async function projectDeletedSpaceIndexSnapshot(
  input: ProjectDeletedSpaceIndexSnapshotInput
): Promise<{ projectionEventId: string }> {
  const projectionEventId = buildSpaceIndexProjectionEventId({
    eventType: "space.deleted",
    sourceUpdatedAt: input.deletedAt,
    spaceId: input.metaRecord.spaceId,
  });
  await upsertSpaceIndexSpace({
    db: input.db,
    space: toDeletedSpaceProjection({
      deletedAt: input.deletedAt,
      deletedByOwnerUserId: input.deletedByOwnerUserId ?? null,
      deletedByProfileId: input.deletedByProfileId ?? null,
      deletedByProfileName: input.deletedByProfileName ?? null,
      memberRecords: input.memberRecords,
      metaRecord: input.metaRecord,
      projectionEventId,
    }),
  });
  for (const memberRecord of input.memberRecords) {
    await upsertSpaceIndexMembership({
      db: input.db,
      membership: toMembershipProjection({
        memberRecord: {
          ...memberRecord,
          removedAt: memberRecord.removedAt ?? input.deletedAt,
          removedByOwnerUserId:
            memberRecord.removedByOwnerUserId ??
            input.deletedByOwnerUserId ??
            null,
          removedByProfileId:
            memberRecord.removedByProfileId ?? input.deletedByProfileId ?? null,
          removalReason: memberRecord.removalReason ?? "space_deleted",
          status: "removed",
          updatedAt: input.deletedAt,
        },
        projectionEventId,
        sourceUpdatedAt: input.deletedAt,
      }),
    });
  }
  await writeSpaceIndexProjectionEvent({
    db: input.db,
    event: {
      eventType: "space.deleted",
      payload: {
        deletedByOwnerUserId: input.deletedByOwnerUserId ?? null,
        deletedByProfileId: input.deletedByProfileId ?? null,
        memberCount: input.memberRecords.length,
        spaceId: input.metaRecord.spaceId,
      },
      projectionEventId,
      sourceUpdatedAt: input.deletedAt,
      spaceId: input.metaRecord.spaceId,
    },
  });
  return { projectionEventId };
}

function toActiveSpaceProjection(input: {
  memberRecords: readonly SpaceMemberRecord[];
  metaRecord: SpaceMetaRecord;
  projectionEventId: string;
  sourceUpdatedAt: string;
}): SpaceIndexSpaceProjection {
  const activeMemberRecords = input.memberRecords.filter(
    (memberRecord) => memberRecord.status === "active"
  );
  const activeHumanCount = activeMemberRecords.filter(
    (memberRecord) => memberRecord.profileKindSnapshot === "human"
  ).length;
  const activeAgentCount = activeMemberRecords.filter(
    (memberRecord) => memberRecord.profileKindSnapshot === "agent"
  ).length;
  return {
    activeAgentCount,
    activeHumanCount,
    activeMemberCount: activeMemberRecords.length,
    creatorKind: input.metaRecord.creator?.kind ?? null,
    creatorOwnerUserId: input.metaRecord.creator?.ownerUserId ?? null,
    creatorProfileId: input.metaRecord.creator?.profileId ?? null,
    creatorProfileName: input.metaRecord.creator?.profileName ?? null,
    projectionEventId: input.projectionEventId,
    sourceUpdatedAt: input.sourceUpdatedAt,
    organizationId: input.metaRecord.organizationId,
    visibility: input.metaRecord.visibility,
    spaceCreatedAt: input.metaRecord.createdAt,
    spaceId: input.metaRecord.spaceId,
    spaceName: input.metaRecord.name ?? null,
    spacePurpose: input.metaRecord.purpose ?? null,
    directMessagePairKey: input.metaRecord.directMessage?.pairKey ?? null,
    directMessageConvertedAt:
      input.metaRecord.directMessage?.convertedAt ?? null,
    spaceUpdatedAt: input.metaRecord.updatedAt,
    status: "active",
  };
}

function toDeletedSpaceProjection(input: {
  deletedAt: string;
  deletedByOwnerUserId: string | null;
  deletedByProfileId: string | null;
  deletedByProfileName: string | null;
  memberRecords: readonly SpaceMemberRecord[];
  metaRecord: SpaceMetaRecord;
  projectionEventId: string;
}): SpaceIndexSpaceProjection {
  return {
    ...toActiveSpaceProjection({
      memberRecords: input.memberRecords,
      metaRecord: input.metaRecord,
      projectionEventId: input.projectionEventId,
      sourceUpdatedAt: input.deletedAt,
    }),
    deletedAt: input.deletedAt,
    deletedByOwnerUserId: input.deletedByOwnerUserId,
    deletedByProfileId: input.deletedByProfileId,
    deletedByProfileName: input.deletedByProfileName,
    sourceUpdatedAt: input.deletedAt,
    status: "deleted",
  };
}

function toMembershipProjection(input: {
  memberRecord: SpaceMemberRecord;
  projectionEventId: string;
  sourceUpdatedAt: string;
}): SpaceIndexMembershipProjection {
  return {
    addedAt: input.memberRecord.addedAt,
    addedByDisplayNameSnapshot: input.memberRecord.addedByDisplayNameSnapshot,
    addedByOwnerUserId: input.memberRecord.addedByOwnerUserId,
    addedByProfileId: input.memberRecord.addedByProfileId,
    controllerRefSnapshot: input.memberRecord.controllerRefSnapshot,
    firstEnteredAt: input.memberRecord.firstEnteredAt,
    lastEnteredAt: input.memberRecord.lastEnteredAt,
    memberSource: input.memberRecord.memberSource,
    ownerNameSnapshot: input.memberRecord.ownerNameSnapshot,
    ownerUserIdSnapshot: input.memberRecord.ownerUserIdSnapshot,
    profileId: input.memberRecord.profileId,
    profileKindSnapshot: input.memberRecord.profileKindSnapshot,
    profileNameSnapshot: input.memberRecord.profileNameSnapshot,
    projectionEventId: input.projectionEventId,
    removalReason: input.memberRecord.removalReason,
    removedAt: input.memberRecord.removedAt,
    removedByOwnerUserId: input.memberRecord.removedByOwnerUserId,
    removedByProfileId: input.memberRecord.removedByProfileId,
    sourceUpdatedAt: input.sourceUpdatedAt,
    spaceId: input.memberRecord.spaceId,
    status: input.memberRecord.status,
  };
}

function resolveActiveSnapshotSourceUpdatedAt(
  input: ProjectSpaceIndexSnapshotInput
): string {
  return input.memberRecords.reduce((latest, memberRecord) => {
    return Date.parse(memberRecord.updatedAt) > Date.parse(latest)
      ? memberRecord.updatedAt
      : latest;
  }, input.metaRecord.updatedAt);
}

function buildSpaceIndexProjectionEventId(input: {
  eventType: string;
  sourceUpdatedAt: string;
  spaceId: string;
}): string {
  return `${input.spaceId}:${input.eventType}:${input.sourceUpdatedAt}`;
}
