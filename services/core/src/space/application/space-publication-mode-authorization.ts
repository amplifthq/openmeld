import type { OpenMeldRequestContext } from "@openmeld/schemas/types";
import { isSpaceOwner } from "@openmeld/space";
import type { SpaceMetaRecord } from "../infrastructure/sql/space-meta-repo";

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
  return isSpaceOwner({
    ownerUserIds: input.meta.ownerUserIds ?? [],
    actorOwnerUserId: input.context.actorContext.ownerUserId,
    actorKind: input.context.actorContext.profileKind,
  })
    ? { ok: true }
    : {
        code: "space.publication_mode.owner_required",
        message: "Only a Space owner can change publication mode.",
        ok: false,
        status: 403,
      };
}
