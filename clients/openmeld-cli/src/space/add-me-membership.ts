import { runSpaceAddMembers } from "./command";
import type { SpaceCommandNavigationStatus } from "./navigation-status";

export type SpaceAddMeMembershipInput = Parameters<
  typeof runSpaceAddMembers
>[0];
export type SpaceAddMeMembershipRunner = (
  input: SpaceAddMeMembershipInput
) => Promise<SpaceCommandNavigationStatus>;

export async function runSpaceAddMeMembership(
  input: SpaceAddMeMembershipInput
): Promise<SpaceCommandNavigationStatus> {
  return await runSpaceAddMembers(input);
}
