export const OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE = "openmeld_dm_space";

export type DirectMessageSpaceStateInput = {
  activeMemberCount: number | null | undefined;
  directMessageConvertedAt?: string | null | undefined;
  purpose: string | null | undefined;
};

export function isDirectMessageSpace(
  input: DirectMessageSpaceStateInput
): boolean {
  return (
    input.purpose === OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE &&
    !input.directMessageConvertedAt &&
    input.activeMemberCount === 2
  );
}

export function buildDirectMessagePairKey(
  firstProfileId: string,
  secondProfileId: string
): string {
  const first = firstProfileId.trim();
  const second = secondProfileId.trim();
  if (!(first && second)) {
    throw new Error("Direct Message pair key requires two profile IDs.");
  }
  return [first, second].sort(compareProfileIds).join(":");
}

function compareProfileIds(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}
