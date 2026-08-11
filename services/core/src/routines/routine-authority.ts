import { memberRoleHasOrganizationPermission } from "@openmeld/auth";

import { createCoreRpcHttpError } from "../rpc/errors";

export type RoutineAuthority = {
  organizationId: string;
  role: string;
  userId: string;
};

export function canManageRoutine(input: {
  authority: RoutineAuthority;
  createdByUserId: string;
}): boolean {
  return canMutateRoutine({ ...input, action: "update" });
}

function canMutateRoutine(input: {
  action: "delete" | "update";
  authority: RoutineAuthority;
  createdByUserId: string;
}): boolean {
  return (
    memberRoleHasOrganizationPermission(input.authority.role, {
      routine: [input.action],
    }) ||
    (hasRoutineCreatorMutationScope(input.authority.role) &&
      input.createdByUserId === input.authority.userId)
  );
}

export function requireRoutineCreateAuthority(
  authority: RoutineAuthority
): void {
  if (
    memberRoleHasOrganizationPermission(authority.role, {
      routine: ["create"],
    })
  ) {
    return;
  }

  throwRoutineForbidden();
}

export function requireRoutineMutationAuthority(input: {
  action: "delete" | "update";
  authority: RoutineAuthority;
  createdByUserId: string;
}): void {
  if (canMutateRoutine(input)) {
    return;
  }

  throwRoutineForbidden();
}

function hasRoutineCreatorMutationScope(role: string): boolean {
  return role.split(",").includes("member");
}

function throwRoutineForbidden(): never {
  throw createCoreRpcHttpError({
    status: 403,
    reason: "You do not have permission to manage this Routine.",
    code: "routine.forbidden",
  });
}
