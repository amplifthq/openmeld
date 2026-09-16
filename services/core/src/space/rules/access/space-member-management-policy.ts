import { isSpaceOwner } from "@openmeld/space";
import type { CoreRpcContextInput } from "../../../rpc/methods";
import type { SpaceMetaRecord } from "../../infrastructure/sql/space-meta-repo";

export function authorizeSpaceMemberRemoval(input: {
  meta: SpaceMetaRecord;
  context: CoreRpcContextInput;
}): { ok: true } | { ok: false; code: "space.forbidden"; message: string } {
  return isSpaceOwner({
    ownerUserIds: input.meta.ownerUserIds ?? [],
    actorOwnerUserId: input.context.actorContext.ownerUserId,
    actorKind: input.context.actorContext.profileKind,
  })
    ? { ok: true }
    : {
        ok: false,
        code: "space.forbidden",
        message: "Only a Space owner can manage members.",
      };
}
