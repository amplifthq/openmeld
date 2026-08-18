import { memberRoleHasOrganizationPermission } from "@openmeld/auth/organization-policy";

import { createCoreRpcHttpError } from "../rpc/errors";

export type ProjectReadAuthority = {
  organizationId: string;
  role: string;
  userId: string | null;
};

export type ProjectAuthority = Omit<ProjectReadAuthority, "userId"> & {
  userId: string;
};

export function canManageProject(input: {
  authority: ProjectAuthority;
  createdByUserId: string;
}): boolean {
  return (
    memberRoleHasOrganizationPermission(input.authority.role, {
      project: ["manage"],
    }) ||
    (hasProjectCreatorManageScope(input.authority.role) &&
      input.authority.userId === input.createdByUserId)
  );
}

export function canArchiveProject(input: {
  authority: ProjectAuthority;
  createdByUserId: string;
  hasActivity: boolean;
}): boolean {
  return (
    memberRoleHasOrganizationPermission(input.authority.role, {
      project: ["archive"],
    }) ||
    (hasProjectCreatorArchiveGrace(input.authority.role) &&
      input.authority.userId === input.createdByUserId &&
      !input.hasActivity)
  );
}

export function requireProjectCreateAuthority(
  authority: ProjectAuthority
): void {
  if (
    memberRoleHasOrganizationPermission(authority.role, {
      project: ["create"],
    })
  ) {
    return;
  }
  throwProjectForbidden();
}

export function requireProjectManageAuthority(input: {
  authority: ProjectAuthority;
  createdByUserId: string;
}): void {
  if (canManageProject(input)) {
    return;
  }
  throwProjectForbidden();
}

export function requireProjectArchiveAuthority(input: {
  authority: ProjectAuthority;
  createdByUserId: string;
}): "creator_grace" | "owner" {
  if (
    memberRoleHasOrganizationPermission(input.authority.role, {
      project: ["archive"],
    })
  ) {
    return "owner";
  }
  if (
    hasProjectCreatorArchiveGrace(input.authority.role) &&
    input.authority.userId === input.createdByUserId
  ) {
    return "creator_grace";
  }
  throwProjectForbidden();
}

function hasProjectCreatorArchiveGrace(role: string): boolean {
  return role.split(",").includes("member");
}

function hasProjectCreatorManageScope(role: string): boolean {
  const roles = role.split(",");
  return roles.includes("admin") || roles.includes("member");
}

function throwProjectForbidden(): never {
  throw createCoreRpcHttpError({
    code: "project.forbidden",
    reason: "You do not have permission to manage this Project.",
    status: 403,
  });
}
