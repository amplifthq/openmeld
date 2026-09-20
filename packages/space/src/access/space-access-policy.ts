import type {
  SpaceAccessMode,
  SpaceLinkJoinPolicy,
  SpaceOrganizationVisibility,
} from "@openmeld/schemas/types";

/** Pure policy over verified facts. Callers must re-read facts before a mutation. */
export function resolveSpaceAccess(input: {
  visibility: SpaceOrganizationVisibility;
  accessMode: SpaceAccessMode;
  linkJoinPolicy?: SpaceLinkJoinPolicy;
  organizationMember: boolean;
  activeMember: boolean;
  invited?: boolean;
  password: "missing" | "invalid" | "valid";
}) {
  const organizationJoin =
    input.organizationMember && input.visibility === "public";
  const publicRead =
    input.accessMode === "public" ||
    input.accessMode === "public_view_join_password";
  const passwordAccess =
    input.password === "valid" &&
    (input.accessMode === "protected" ||
      input.accessMode === "public_view_join_password");
  const linkJoinAllowed = input.linkJoinPolicy !== "invite_only";
  return {
    canDiscover:
      input.activeMember || organizationJoin || input.invited === true,
    canRead: input.activeMember || publicRead || passwordAccess,
    canJoin:
      input.activeMember ||
      organizationJoin ||
      (linkJoinAllowed && (input.accessMode === "public" || passwordAccess)),
  };
}
