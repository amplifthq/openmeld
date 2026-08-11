import { describe, expect, it } from "vitest";
import {
  authRpcResolveOrganizationAccountIdentityInputSchema,
  authRpcResolveOrganizationAccountIdentityResultSchema,
  authRpcResolveOrganizationDirectoryAgentProfilesInputSchema,
  authRpcResolveOrganizationDirectoryAgentProfilesResultSchema,
  authRpcResolveOrganizationDirectoryMembersResultSchema,
  authRpcResolveProfileInputSchema,
  authRpcResolveProfileResultSchema,
  authRpcResolveRequestAuthInputSchema,
  authRpcResolveUserDisplayNameInputSchema,
  authRpcResolveUserDisplayNameResultSchema,
  openMeldRequestedOrganizationSelectorSchema,
} from "../../src/index";

describe("Auth RPC schemas", () => {
  it("accepts exactly one canonical Organization selector", () => {
    expect(
      openMeldRequestedOrganizationSelectorSchema.safeParse({
        organizationId: "org-1",
      }).success
    ).toBe(true);
    expect(
      openMeldRequestedOrganizationSelectorSchema.safeParse({
        organizationSlug: "amplift",
      }).success
    ).toBe(true);
    expect(
      openMeldRequestedOrganizationSelectorSchema.safeParse({}).success
    ).toBe(false);
    expect(
      openMeldRequestedOrganizationSelectorSchema.safeParse({
        organizationId: "org-1",
        organizationSlug: "amplift",
      }).success
    ).toBe(false);
  });

  it("keeps the Organization selector as one Auth RPC fact", () => {
    expect(
      authRpcResolveRequestAuthInputSchema.safeParse({
        requestId: "request-1",
        requestedOrganization: {
          organizationSlug: "amplift",
        },
      }).success
    ).toBe(true);
    expect(
      authRpcResolveRequestAuthInputSchema.safeParse({
        requestId: "request-1",
        requestedOrganizationId: "org-1",
      }).success
    ).toBe(false);
  });

  it("uses one strict input and result contract for direct Profile resolution", () => {
    expect(
      authRpcResolveProfileInputSchema.safeParse({
        profileKind: "agent",
        requestId: "request-1",
        openMeldProfileId: "agt_11111111-1111-4111-8111-111111111111",
      }).success
    ).toBe(true);
    expect(
      authRpcResolveProfileInputSchema.safeParse({
        requestId: "request-1",
        profileId: "agt_11111111-1111-4111-8111-111111111111",
      }).success
    ).toBe(false);
    expect(
      authRpcResolveProfileResultSchema.safeParse({
        ok: true,
      }).success
    ).toBe(false);
  });

  it("uses one strict Auth-owned contract for user display names", () => {
    expect(
      authRpcResolveUserDisplayNameInputSchema.safeParse({
        userId: "user-1",
      }).success
    ).toBe(true);
    expect(
      authRpcResolveUserDisplayNameInputSchema.safeParse({
        ownerUserId: "user-1",
      }).success
    ).toBe(false);
    expect(
      authRpcResolveUserDisplayNameResultSchema.safeParse({
        displayName: "Connector owner",
        ok: true,
        userId: "user-1",
      }).success
    ).toBe(true);
    expect(
      authRpcResolveUserDisplayNameResultSchema.safeParse({
        ok: true,
        userId: "user-1",
      }).success
    ).toBe(false);
  });
});

describe("Auth Organization account identity RPC", () => {
  it("accepts an Organization-only projection and account selectors", () => {
    expect(
      authRpcResolveOrganizationAccountIdentityInputSchema.parse({
        organizationId: "org_1",
      })
    ).toEqual({ organizationId: "org_1" });
    expect(
      authRpcResolveOrganizationAccountIdentityInputSchema.parse({
        account: { email: "member@example.test", kind: "email" },
        organizationId: "org_1",
      })
    ).toMatchObject({ account: { kind: "email" } });
    expect(
      authRpcResolveOrganizationAccountIdentityInputSchema.parse({
        account: {
          kind: "human_profile_id",
          profileId: "22222222-2222-4222-8222-222222222222",
        },
        organizationId: "org_1",
      })
    ).toMatchObject({ account: { kind: "human_profile_id" } });
  });

  it("keeps membership and the account default Human Profile as separate facts", () => {
    expect(
      authRpcResolveOrganizationAccountIdentityResultSchema.parse({
        account: {
          defaultHumanProfile: {
            profileId: "22222222-2222-4222-8222-222222222222",
            profileName: "Ari Human",
          },
          displayName: "Ari Human",
          email: "member@example.test",
          membership: { memberId: "member_1", role: "owner" },
          userId: "user_1",
        },
        ok: true,
        organization: {
          id: "org_1",
          memberCount: 1,
          name: "OpenMeld Labs",
          personal: false,
          slug: "openmeld-labs",
        },
      })
    ).toMatchObject({
      account: {
        defaultHumanProfile: { profileName: "Ari Human" },
        membership: { memberId: "member_1" },
      },
      ok: true,
    });
  });

  it("rejects a non-default role and malformed account email", () => {
    expect(
      authRpcResolveOrganizationAccountIdentityInputSchema.safeParse({
        account: { email: "not-an-email", kind: "email" },
        organizationId: "org_1",
      }).success
    ).toBe(false);
    expect(
      authRpcResolveOrganizationAccountIdentityResultSchema.safeParse({
        account: {
          defaultHumanProfile: null,
          displayName: "Ari",
          email: "ari@example.test",
          membership: { memberId: "member_1", role: "viewer" },
          userId: "user_1",
        },
        ok: true,
        organization: {
          id: "org_1",
          memberCount: 1,
          name: "OpenMeld Labs",
          personal: false,
          slug: "openmeld-labs",
        },
      }).success
    ).toBe(false);
  });
});

describe("Auth Organization Directory identity RPC", () => {
  it("keeps member identity separate from Agent Profile identity", () => {
    expect(
      authRpcResolveOrganizationDirectoryMembersResultSchema.parse({
        members: [
          {
            humanProfile: {
              lastUsedAt: null,
              profileHandle: "ari",
              profileId: "22222222-2222-4222-8222-222222222222",
              profileName: "Ari Human",
              status: "active",
            },
            joinedAt: "2026-08-03T00:00:00.000Z",
            memberId: "member_1",
            organizationId: "org_1",
            role: "member",
            user: {
              email: "ari@example.test",
              id: "user_1",
              image: null,
              name: "Ari Human",
            },
            userId: "user_1",
          },
        ],
        ok: true,
        organizationId: "org_1",
      })
    ).toMatchObject({ members: [{ userId: "user_1" }], ok: true });
  });

  it("separates Organization Agent Profiles from Core-requested additional identities", () => {
    const agentProfile = {
      createdAt: "2026-08-03T00:00:00.000Z",
      createdByUserId: "user_1",
      creatorProfileId: null,
      isDefault: false as const,
      lastUsedAt: null,
      managedRole: null,
      organizationId: "org_1",
      ownerName: "Ari Human",
      ownerUserId: "user_1",
      profileHandle: "codex",
      profileId: "agt_11111111-1111-4111-8111-111111111111",
      profileKind: "agent" as const,
      profileName: "Codex",
      source: "cli_create",
      status: "active" as const,
      updatedAt: "2026-08-03T00:00:00.000Z",
    };
    expect(
      authRpcResolveOrganizationDirectoryAgentProfilesInputSchema.parse({
        additionalAgentProfileIds: [agentProfile.profileId],
        organizationId: "org_1",
      })
    ).toMatchObject({ additionalAgentProfileIds: [agentProfile.profileId] });
    expect(
      authRpcResolveOrganizationDirectoryAgentProfilesResultSchema.parse({
        additionalAgentProfiles: [],
        ok: true,
        organizationAgentProfiles: [agentProfile],
        organizationId: "org_1",
      })
    ).toMatchObject({ organizationAgentProfiles: [agentProfile], ok: true });
  });
});
