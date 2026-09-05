import {
  createAccessControl,
  type RoleAuthorizeRequest,
} from "better-auth/plugins/access";
import {
  adminAc,
  defaultStatements,
  memberAc,
  ownerAc,
} from "better-auth/plugins/organization/access";

const organizationStatements = {
  ...defaultStatements,
  organizationLogo: ["update"],
  joinLink: ["create", "read", "revoke"],
  space: ["create", "read", "update", "delete"],
  centerAgent: ["read", "designate", "update"],
  routine: ["create", "read", "update", "delete"],
  channel: ["connect", "disconnect"],
  connector: ["manage"],
  informationProtection: ["manage"],
  memory: ["manage"],
  feedback: ["manage"],
  organizationDocuments: ["saveApprovedKnowledge"],
  project: ["create", "manage", "archive"],
  workingLanguage: ["manage"],
} as const;

export type OrganizationPermissionCheck = RoleAuthorizeRequest<
  typeof organizationStatements
>;

export const organizationAccessControl = createAccessControl(
  organizationStatements
);

export const owner = organizationAccessControl.newRole({
  ...ownerAc.statements,
  organizationLogo: ["update"],
  joinLink: ["create", "read", "revoke"],
  space: ["create", "read", "update", "delete"],
  centerAgent: ["read", "designate", "update"],
  routine: ["create", "read", "update", "delete"],
  channel: ["connect", "disconnect"],
  connector: ["manage"],
  informationProtection: ["manage"],
  memory: ["manage"],
  feedback: ["manage"],
  organizationDocuments: ["saveApprovedKnowledge"],
  project: ["create", "manage", "archive"],
  workingLanguage: ["manage"],
});

export const admin = organizationAccessControl.newRole({
  ...adminAc.statements,
  joinLink: ["create", "read", "revoke"],
  space: ["create", "read", "update", "delete"],
  centerAgent: ["read", "designate", "update"],
  routine: ["create", "read", "update", "delete"],
  channel: ["connect", "disconnect"],
  connector: ["manage"],
  informationProtection: ["manage"],
  memory: ["manage"],
  feedback: ["manage"],
  organizationDocuments: ["saveApprovedKnowledge"],
  project: ["create"],
  workingLanguage: ["manage"],
});

export const member = organizationAccessControl.newRole({
  ...memberAc.statements,
  space: ["read"],
  centerAgent: ["read"],
  routine: ["create", "read"],
  project: ["create"],
});

export const organizationRoles = {
  owner,
  admin,
  member,
} as const;

// Match Better Auth hasPermissionFn: any comma-separated role may grant access.
export function memberRoleHasOrganizationPermission(
  role: string | null | undefined,
  permissions: OrganizationPermissionCheck
): boolean {
  if (!(role && Object.keys(permissions).length > 0)) {
    return false;
  }

  for (const roleName of role.split(",")) {
    const organizationRole =
      organizationRoles[roleName as keyof typeof organizationRoles];
    if (organizationRole?.authorize(permissions).success === true) {
      return true;
    }
  }
  return false;
}

export function canCreateOrganizationJoinLinkForRole(role: string): boolean {
  return memberRoleHasOrganizationPermission(role, {
    joinLink: ["create"],
  });
}

export function canUpdateOrganizationLogoForRole(role: string): boolean {
  return memberRoleHasOrganizationPermission(role, {
    organizationLogo: ["update"],
  });
}
