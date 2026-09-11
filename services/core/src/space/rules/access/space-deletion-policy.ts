import { isSpaceOwner } from "@openmeld/space";
import type { CoreRpcContextInput } from "../../../rpc/methods";
import type { SpaceMetaRecord } from "../../infrastructure/sql/space-meta-repo";

export function authorizeSpaceDeletion(input: {
  meta: SpaceMetaRecord;
  context: CoreRpcContextInput;
  approvedAgentCreatorProfileId?: string;
}):
  | { ok: true }
  | {
      ok: false;
      code: "space.forbidden" | "space.human_confirmation_required";
      message: string;
    } {
  if (input.context.actorContext.profileKind !== "human") {
    return {
      ok: false,
      code: "space.human_confirmation_required",
      message: "A Space owner must confirm deletion.",
    };
  }
  return isSpaceOwner({
    ownerUserIds: input.meta.ownerUserIds ?? [],
    actorOwnerUserId: input.context.actorContext.ownerUserId,
    actorKind: input.context.actorContext.profileKind,
  })
    ? { ok: true }
    : {
        ok: false,
        code: "space.forbidden",
        message: "Only a Space owner can delete this Space.",
      };
}
