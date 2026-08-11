import type { CenterAgentRoutineTargetSpace } from "@openmeld/schemas/types";
import { buildDirectMessagePairKey } from "@openmeld/space";
import { readCenterAgentDesignationRecord } from "../center-agent/center-agent-repository";
import { createCoreRpcHttpError } from "../rpc/errors";
import {
  listRoutineTargetSpacesFromSpaceIndex,
  readRoutineTargetSpaceEligibilityFromSpaceIndex,
  readSpaceIndexOrganizationJoinTarget,
} from "../space-index/space-index-repository";
import { isActiveCenterAgentProfile } from "./routine-repository";

export type RoutineRepresentedHuman = {
  profileId: string;
  userId: string;
};

type RoutineTargetEligibilityContext = {
  centerAgentDirectMessagePairKey: string;
  centerAgentIsActive: boolean;
  centerAgentProfileId: string;
};

type RoutineTargetEligibilityContextResolution =
  | { status: "available"; value: RoutineTargetEligibilityContext }
  | { status: "designation_missing" };

export function createRoutineTargetSpaceEligibility(input: {
  db: D1Database;
  projectionsDb: D1Database;
}) {
  return {
    async listEligible(inputList: {
      limit: number;
      organizationId: string;
      representedHuman: RoutineRepresentedHuman;
    }): Promise<CenterAgentRoutineTargetSpace[]> {
      const context = await resolveRoutineTargetEligibilityContext({
        db: input.db,
        organizationId: inputList.organizationId,
        representedHuman: inputList.representedHuman,
      });
      if (
        context.status !== "available" ||
        !context.value.centerAgentIsActive
      ) {
        return [];
      }
      const { centerAgentDirectMessagePairKey, centerAgentProfileId } =
        context.value;
      return await listRoutineTargetSpacesFromSpaceIndex({
        centerAgentDirectMessagePairKey,
        centerAgentProfileId,
        db: input.projectionsDb,
        limit: inputList.limit,
        organizationId: inputList.organizationId,
        representedHumanProfileId: inputList.representedHuman.profileId,
        representedHumanUserId: inputList.representedHuman.userId,
      });
    },

    async requireEligible(inputTarget: {
      organizationId: string;
      representedHuman: RoutineRepresentedHuman;
      targetSpaceId: string;
    }): Promise<void> {
      const target = await readSpaceIndexOrganizationJoinTarget({
        db: input.projectionsDb,
        spaceId: inputTarget.targetSpaceId,
      });
      if (!target) {
        throw targetSpaceNotFoundError();
      }
      if (target.organizationId !== inputTarget.organizationId) {
        throw targetSpaceOrganizationMismatchError();
      }

      const context = await resolveRoutineTargetEligibilityContext({
        db: input.db,
        organizationId: inputTarget.organizationId,
        representedHuman: inputTarget.representedHuman,
      });
      const queryContext =
        context.status === "available"
          ? {
              centerAgentDirectMessagePairKey:
                context.value.centerAgentDirectMessagePairKey,
              centerAgentProfileId: context.value.centerAgentProfileId,
            }
          : {
              centerAgentDirectMessagePairKey: null,
              centerAgentProfileId: null,
            };

      const eligibility = await readRoutineTargetSpaceEligibilityFromSpaceIndex(
        {
          ...queryContext,
          db: input.projectionsDb,
          organizationId: inputTarget.organizationId,
          representedHumanProfileId: inputTarget.representedHuman.profileId,
          representedHumanUserId: inputTarget.representedHuman.userId,
          targetSpaceId: inputTarget.targetSpaceId,
        }
      );
      if (!eligibility?.active) {
        throw targetSpaceNotFoundError();
      }
      if (
        !eligibility.sameOrganization ||
        eligibility.organizationId !== inputTarget.organizationId
      ) {
        throw targetSpaceOrganizationMismatchError();
      }
      if (!(eligibility.representedHumanVisible && eligibility.shapeAllowed)) {
        throw targetSpaceNotFoundError();
      }
      if (context.status === "designation_missing") {
        throw centerAgentRequiredError();
      }
      if (
        !(
          context.value.centerAgentIsActive &&
          eligibility.centerAgentCanPublish &&
          eligibility.eligible
        )
      ) {
        throw targetSpacePublicationUnavailableError();
      }
    },
  };
}

async function resolveRoutineTargetEligibilityContext(input: {
  db: D1Database;
  organizationId: string;
  representedHuman: RoutineRepresentedHuman;
}): Promise<RoutineTargetEligibilityContextResolution> {
  const designation = await readCenterAgentDesignationRecord({
    db: input.db,
    organizationId: input.organizationId,
  });
  if (!designation) {
    return { status: "designation_missing" };
  }
  const centerAgentIsActive = await isActiveCenterAgentProfile({
    db: input.db,
    organizationId: input.organizationId,
    profileId: designation.agentProfileId,
  });
  return {
    status: "available",
    value: {
      centerAgentDirectMessagePairKey: buildDirectMessagePairKey(
        input.representedHuman.profileId,
        designation.agentProfileId
      ),
      centerAgentIsActive,
      centerAgentProfileId: designation.agentProfileId,
    },
  };
}

function targetSpaceNotFoundError() {
  return createCoreRpcHttpError({
    status: 404,
    reason: "The target Space could not be found.",
    code: "routine.target_space_not_found",
  });
}

function targetSpaceOrganizationMismatchError() {
  return createCoreRpcHttpError({
    status: 403,
    reason: "The target Space does not belong to this Organization.",
    code: "routine.target_space_org_mismatch",
  });
}

function centerAgentRequiredError() {
  return createCoreRpcHttpError({
    status: 409,
    reason: "This Organization needs a designated Center Agent.",
    code: "routine.center_agent_required",
  });
}

function targetSpacePublicationUnavailableError() {
  return createCoreRpcHttpError({
    status: 409,
    reason: "The current Center Agent cannot publish to the target Space.",
    code: "routine.target_space_publication_unavailable",
  });
}
