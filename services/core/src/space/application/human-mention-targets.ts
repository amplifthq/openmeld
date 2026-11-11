import {
  MAX_ORGANIZATION_MENTION_TARGETS,
  SPACE_ADDRESSING_TARGET_INVALID_ERROR_CODE,
} from "@openmeld/schemas";
import type {
  ResolvedSpaceMemberProfile,
  SpaceHumanMentionTarget,
} from "@openmeld/schemas/types";
import { SpaceSignalAuthoringError } from "./space-signal-service";

export type ResolvedHumanMentionTarget = SpaceHumanMentionTarget & {
  ownerUserId: string;
};

/** Space remains the membership owner; Organization identity only permits a mention. */
export async function resolveSpaceHumanMentionTargets(input: {
  profileIds: readonly string[];
  readSpaceMember: (profileId: string) => {
    profileId: string;
    profileKind: string;
    profileName: string;
    ownerUserId: string | null;
  } | null;
  readOrganizationProfile: (
    profileId: string
  ) => Promise<ResolvedSpaceMemberProfile | null>;
}): Promise<ResolvedHumanMentionTarget[]> {
  const selected = [...new Set(input.profileIds)].map((profileId) => ({
    profileId,
    member: input.readSpaceMember(profileId),
  }));
  if (
    selected.filter(({ member }) => !member).length >
    MAX_ORGANIZATION_MENTION_TARGETS
  ) {
    throw new SpaceSignalAuthoringError({
      code: SPACE_ADDRESSING_TARGET_INVALID_ERROR_CODE,
      message: `Mention at most ${MAX_ORGANIZATION_MENTION_TARGETS} people outside this Space in one message.`,
    });
  }
  return await Promise.all(
    selected.map(async ({ profileId, member }) => {
      if (member && member.profileKind !== "human") {
        throw new SpaceSignalAuthoringError({
          code: SPACE_ADDRESSING_TARGET_INVALID_ERROR_CODE,
          targetProfileId: profileId,
          message: `OpenMeld could not mention ${profileId} because Human Mention only supports people. The message was not sent. Choose a person or use Wake or Reference for an agent.`,
        });
      }
      const profile =
        member ?? (await input.readOrganizationProfile(profileId));
      if (!profile || profile.profileKind !== "human" || !profile.ownerUserId) {
        throw new SpaceSignalAuthoringError({
          code: SPACE_ADDRESSING_TARGET_INVALID_ERROR_CODE,
          targetProfileId: profileId,
          message: `OpenMeld could not mention ${profileId} because it is not an active person in this Organization. Choose a current person and try again.`,
        });
      }
      return {
        profileId,
        profileName: profile.profileName,
        ownerUserId: profile.ownerUserId,
        scope: member ? "space" : "organization",
      };
    })
  );
}
