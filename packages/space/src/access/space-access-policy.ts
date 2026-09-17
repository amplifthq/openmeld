import type {
  SpaceAccessMode,
  SpaceOrganizationVisibility,
} from "@openmeld/schemas/types";

/** Pure policy over verified facts. Callers must re-read facts before a mutation. */
export function resolveSpaceAccess(input: {
  visibility: SpaceOrganizationVisibility;
  accessMode: SpaceAccessMode;
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
  return {
    canDiscover:
      input.activeMember || organizationJoin || input.invited === true,
    canRead: input.activeMember || publicRead || passwordAccess,
    canJoin:
      input.activeMember ||
      organizationJoin ||
      input.accessMode === "public" ||
      passwordAccess,
  };
}
