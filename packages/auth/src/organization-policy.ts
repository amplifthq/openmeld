// biome-ignore-all lint/performance/noBarrelFile: This is the package's intentionally narrow, runtime-light policy entrypoint.

export type { OrganizationPermissionCheck } from "./organization/access-control";
export { memberRoleHasOrganizationPermission } from "./organization/access-control";
export { isPersonalOrganization } from "./organization/personal-organization";
