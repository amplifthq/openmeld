import type { createAuth } from ".";

type BetterAuthInstance = ReturnType<typeof createAuth>;

type AddMemberInput = {
  body: {
    organizationId: string;
    role: "member";
    userId: string;
  };
};

type HasPermissionInput = {
  body: {
    organizationId: string;
    permissions: {
      joinLink: ("create" | "read" | "revoke")[];
    };
  };
  headers: Headers;
};

export type OrganizationServerApi = {
  addMember: (input: AddMemberInput) => Promise<unknown>;
  hasPermission: (input: HasPermissionInput) => Promise<{ success: boolean }>;
};

export function getOrganizationServerApi(
  auth: BetterAuthInstance
): OrganizationServerApi {
  const api = auth.api as unknown as Record<string, unknown>;
  if (
    typeof api.addMember !== "function" ||
    typeof api.hasPermission !== "function"
  ) {
    throw new Error(
      "Better Auth organization server API is missing addMember or hasPermission"
    );
  }

  return {
    addMember: api.addMember as OrganizationServerApi["addMember"],
    hasPermission: api.hasPermission as OrganizationServerApi["hasPermission"],
  };
}
