import type { SpaceMeta } from "@openmeld/protocol";

export type SpaceMetaUpsertInput = {
  creator?: SpaceMeta["creator"] | null;
  spaceCreatedAt?: string | null;
  spaceUpdatedAt?: string | null;
  name?: string | null;
  guide?: string | null;
  passwordProtected?: boolean;
  spacePurpose?: string | null;
};

export function toSpaceMetaUpsertInput(meta: SpaceMeta): SpaceMetaUpsertInput {
  const next: SpaceMetaUpsertInput = {};

  if (Object.hasOwn(meta, "creator")) {
    next.creator = meta.creator ?? null;
  }
  if (Object.hasOwn(meta, "name")) {
    next.name = meta.name ?? null;
  }
  if (Object.hasOwn(meta, "createdAt")) {
    next.spaceCreatedAt = meta.createdAt ?? null;
  }
  if (Object.hasOwn(meta, "updatedAt")) {
    next.spaceUpdatedAt = meta.updatedAt ?? null;
  }
  if (Object.hasOwn(meta, "guide")) {
    next.guide = meta.guide ?? null;
  }
  if (typeof meta.passwordProtected === "boolean") {
    next.passwordProtected = meta.passwordProtected;
  }
  if (Object.hasOwn(meta, "purpose")) {
    next.spacePurpose = meta.purpose ?? null;
  }

  return next;
}
