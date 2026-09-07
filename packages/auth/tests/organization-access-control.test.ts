import { describe, expect, it } from "vitest";

import {
  canCreateOrganizationJoinLinkForRole,
  memberRoleHasOrganizationPermission,
  type OrganizationPermissionCheck,
} from "../src/organization/access-control";

const permissionMatrix = [
  {
    actions: ["connect", "disconnect"],
    admin: true,
    member: false,
    owner: true,
    resource: "channel",
  },
  {
    actions: ["manage"],
    admin: true,
    member: false,
    owner: true,
    resource: "connector",
  },
  {
    actions: ["manage"],
    admin: true,
    member: false,
    owner: true,
    resource: "informationProtection",
  },
  {
    actions: ["manage"],
    admin: true,
    member: false,
    owner: true,
    resource: "memory",
  },
  {
    actions: ["manage"],
    admin: true,
    member: false,
    owner: true,
    resource: "feedback",
  },
  {
    actions: ["create"],
    admin: true,
    member: true,
    owner: true,
    resource: "project",
  },
  {
    actions: ["manage", "archive"],
    admin: false,
    member: false,
    owner: true,
    resource: "project",
  },
  {
    actions: ["manage"],
    admin: true,
    member: false,
    owner: true,
    resource: "workingLanguage",
  },
  {
    actions: ["saveApprovedKnowledge"],
    admin: true,
    member: false,
    owner: true,
    resource: "organizationDocuments",
  },
] as const satisfies ReadonlyArray<{
  actions: readonly string[];
  admin: boolean;
  member: boolean;
  owner: boolean;
  resource: keyof OrganizationPermissionCheck;
}>;

describe("organization access control", () => {
  it.each(
    permissionMatrix
  )("authorizes $resource:$actions for the configured role matrix", ({
    actions,
    admin,
    member,
    owner,
    resource,
  }) => {
    const permissions = {
      [resource]: actions,
    } as OrganizationPermissionCheck;

    expect(memberRoleHasOrganizationPermission("owner", permissions)).toBe(
      owner
    );
    expect(memberRoleHasOrganizationPermission("admin", permissions)).toBe(
      admin
    );
    expect(memberRoleHasOrganizationPermission("member", permissions)).toBe(
      member
    );
  });

  it("merges the official Better Auth organization statements", () => {
    expect(
      memberRoleHasOrganizationPermission("owner", {
        organization: ["delete"],
      })
    ).toBe(true);
    expect(
      memberRoleHasOrganizationPermission("admin", {
        organization: ["delete"],
      })
    ).toBe(false);
    expect(
      memberRoleHasOrganizationPermission("member", { ac: ["read"] })
    ).toBe(true);
  });

  it("grants a multi-role member when any role grants the permission", () => {
    expect(
      memberRoleHasOrganizationPermission("admin,member", {
        connector: ["manage"],
      })
    ).toBe(true);
  });

  it("fails closed for missing roles and unsupported permission requests", () => {
    expect(
      memberRoleHasOrganizationPermission("unknown", {
        connector: ["manage"],
      })
    ).toBe(false);
    expect(
      memberRoleHasOrganizationPermission("", { connector: ["manage"] })
    ).toBe(false);
    expect(
      memberRoleHasOrganizationPermission(undefined, {
        connector: ["manage"],
      })
    ).toBe(false);
    expect(memberRoleHasOrganizationPermission(null, {})).toBe(false);
    expect(
      memberRoleHasOrganizationPermission("owner", {
        unsupported: ["manage"],
      } as unknown as OrganizationPermissionCheck)
    ).toBe(false);
  });

  it("preserves Organization join-link creation behavior", () => {
    expect(canCreateOrganizationJoinLinkForRole("owner")).toBe(true);
    expect(canCreateOrganizationJoinLinkForRole("admin")).toBe(true);
    expect(canCreateOrganizationJoinLinkForRole("member")).toBe(true);
  });
});
