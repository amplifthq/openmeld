import {
	memberRoleHasOrganizationPermission,
	type OrganizationPermissionCheck,
} from "@openmeld/auth";

// Use the shared pure function so Web and server authorization stay on the same AC source.
export function canManageOrganizationArea(
	role: string | null | undefined,
	permissions: OrganizationPermissionCheck
): boolean {
	return memberRoleHasOrganizationPermission(role, permissions);
}
