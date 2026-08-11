import type { CoreRpcContextInput } from "../../../rpc/methods";
import type { SpaceMetaRecord } from "../../infrastructure/sql/space-meta-repo";
import {
  normalizeOwnerUserId,
  normalizeSpaceCreatorOwnerUserId,
  normalizeSpaceCreatorProfileId,
} from "./space-creator-identity";

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
  const creatorProfileId = normalizeSpaceCreatorProfileId(input.meta.creator);
  if (!creatorProfileId) {
    return {
      ok: false,
      code: "space.forbidden",
      message: "space creator is missing; delete is not authorized",
    };
  }

  if (input.meta.creator?.kind === "agent") {
    if (input.context.actorContext.profileKind !== "human") {
      return {
        ok: false,
        code: "space.human_confirmation_required",
        message: "agent-created spaces require owner human confirmation",
      };
    }

    const creatorOwnerUserId = normalizeSpaceCreatorOwnerUserId(
      input.meta.creator
    );
    const requesterOwnerUserId = normalizeOwnerUserId(
      input.context.actorContext.ownerUserId
    );
    if (creatorOwnerUserId && requesterOwnerUserId) {
      if (creatorOwnerUserId === requesterOwnerUserId) {
        return { ok: true };
      }
      return {
        ok: false,
        code: "space.forbidden",
        message: "only owner human can delete this agent-created space",
      };
    }

    const approvedCreatorProfileId = normalizeSpaceCreatorProfileId({
      profileId: input.approvedAgentCreatorProfileId,
    });
    if (approvedCreatorProfileId === creatorProfileId) {
      return { ok: true };
    }

    return {
      ok: false,
      code: "space.human_confirmation_required",
      message: "agent-created spaces require owner human confirmation",
    };
  }

  if (input.context.actorContext.openMeldProfileId === creatorProfileId) {
    return { ok: true };
  }

  return {
    ok: false,
    code: "space.forbidden",
    message: "only space creator can delete this space",
  };
}
