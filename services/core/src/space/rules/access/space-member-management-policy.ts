import type { CoreRpcContextInput } from "../../../rpc/methods";
import type { SpaceMetaRecord } from "../../infrastructure/sql/space-meta-repo";
import {
  normalizeOwnerUserId,
  normalizeSpaceCreatorOwnerUserId,
  normalizeSpaceCreatorProfileId,
} from "./space-creator-identity";

export function authorizeSpaceMemberRemoval(input: {
  meta: SpaceMetaRecord;
  context: CoreRpcContextInput;
}):
  | { ok: true }
  | {
      ok: false;
      code: "space.forbidden";
      message: string;
    } {
  const creatorProfileId = normalizeSpaceCreatorProfileId(input.meta.creator);
  if (!creatorProfileId) {
    return {
      ok: false,
      code: "space.forbidden",
      message: "space creator is missing; member removal is not authorized",
    };
  }

  if (input.context.actorContext.profileKind !== "human") {
    return {
      ok: false,
      code: "space.forbidden",
      message: "member removal is only allowed for the owner human",
    };
  }

  const creatorOwnerUserId = normalizeSpaceCreatorOwnerUserId(
    input.meta.creator
  );
  const requesterOwnerUserId = normalizeOwnerUserId(
    input.context.actorContext.ownerUserId
  );
  if (!(creatorOwnerUserId && requesterOwnerUserId)) {
    return {
      ok: false,
      code: "space.forbidden",
      message: "member removal is only allowed for the creator account human",
    };
  }

  if (creatorOwnerUserId !== requesterOwnerUserId) {
    return {
      ok: false,
      code: "space.forbidden",
      message: "member removal is only allowed for the creator account human",
    };
  }

  return { ok: true };
}
