import type { OpenMeldRequestContext } from "@openmeld/schemas/types";
import type { SpaceMetaRecord } from "../infrastructure/sql/space-meta-repo";
import {
  normalizeSpaceCreatorOwnerUserId,
  normalizeSpaceCreatorProfileId,
} from "../rules/access/space-creator-identity";

type SpacePublicationModeAuthorizationFailureCode =
  | "space.password_invalid"
  | "space.password_required"
  | "space.publication_mode.owner_required"
  | "space.publication_mode.password_not_configured";

export type SpacePublicationModeAuthorizationResult =
  | { ok: true }
  | {
      code: SpacePublicationModeAuthorizationFailureCode;
      message: string;
      ok: false;
      status: 401 | 403 | 409;
    };

export async function authorizeSpacePublicationModeChange(input: {
  context: OpenMeldRequestContext;
  meta: SpaceMetaRecord;
  spacePassword?: string;
  verifySpacePasswordProof: (
    password: string,
    proof: NonNullable<SpaceMetaRecord["passwordProof"]>
  ) => Promise<boolean>;
}): Promise<SpacePublicationModeAuthorizationResult> {
  const ownerAuthorization = authorizePublicationModeOwner({
    context: input.context,
    meta: input.meta,
  });
  if (!ownerAuthorization.ok) {
    return ownerAuthorization;
  }

  if (!input.meta.passwordProof) {
    return {
      code: "space.publication_mode.password_not_configured",
      message:
        "Set a Space password before changing the Space publication mode.",
      ok: false,
      status: 409,
    };
  }

  if (input.spacePassword === undefined) {
    return {
      code: "space.password_required",
      message: "Space password required to change publication mode.",
      ok: false,
      status: 401,
    };
  }

  const valid = await input.verifySpacePasswordProof(
    input.spacePassword,
    input.meta.passwordProof
  );
  if (!valid) {
    return {
      code: "space.password_invalid",
      message: "Space password invalid.",
      ok: false,
      status: 401,
    };
  }

  return { ok: true };
}

function authorizePublicationModeOwner(input: {
  context: OpenMeldRequestContext;
  meta: SpaceMetaRecord;
}): SpacePublicationModeAuthorizationResult {
  const creatorProfileId = normalizeSpaceCreatorProfileId(input.meta.creator);
  if (!creatorProfileId) {
    return {
      code: "space.publication_mode.owner_required",
      message:
        "Space publication mode can only be changed when the Space creator is known.",
      ok: false,
      status: 403,
    };
  }

  if (input.meta.creator?.kind === "agent") {
    const creatorOwnerUserId = normalizeSpaceCreatorOwnerUserId(
      input.meta.creator
    );
    if (
      input.context.actorContext.profileKind === "human" &&
      creatorOwnerUserId &&
      input.context.actorContext.ownerUserId === creatorOwnerUserId
    ) {
      return { ok: true };
    }

    return {
      code: "space.publication_mode.owner_required",
      message:
        "Agent-created Spaces require the owner human to change publication mode.",
      ok: false,
      status: 403,
    };
  }

  if (input.context.actorContext.openMeldProfileId !== creatorProfileId) {
    return {
      code: "space.publication_mode.owner_required",
      message: "Space publication mode can only be changed by the Space owner.",
      ok: false,
      status: 403,
    };
  }

  return { ok: true };
}
