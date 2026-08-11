import { describe, expect, it } from "vitest";
import {
  acceptOrganizationJoinLinkResponseSchema,
  centerAgentCreateOrganizationInviteLinkResponseSchema,
  centerAgentCreateOrganizationInviteLinkToolRpcInputSchema,
  centerAgentGetOrganizationInviteLinkResponseSchema,
  organizationJoinLinkErrorResponseSchema,
  organizationJoinLinkTokenSchema,
  previewOrganizationJoinLinkResponseSchema,
} from "../../src";

describe("organization join link HTTP schemas", () => {
  const token = `joinlink_${"a".repeat(64)}`;

  it("accepts only tokens backed by 32 bytes of lowercase hex entropy", () => {
    expect(organizationJoinLinkTokenSchema.safeParse(token).success).toBe(true);
    expect(
      organizationJoinLinkTokenSchema.safeParse(`joinlink_${"a".repeat(63)}`)
        .success
    ).toBe(false);
    expect(
      organizationJoinLinkTokenSchema.safeParse(`invite_${"a".repeat(64)}`)
        .success
    ).toBe(false);
  });

  it("keeps inactive previews free of organization identity", () => {
    expect(
      previewOrganizationJoinLinkResponseSchema.safeParse({
        active: false,
        ok: true,
      }).success
    ).toBe(true);
    expect(
      previewOrganizationJoinLinkResponseSchema.safeParse({
        active: false,
        ok: true,
        organizationName: "Leaked organization",
      }).success
    ).toBe(false);
  });

  it("preserves an existing elevated role in accept responses", () => {
    expect(
      acceptOrganizationJoinLinkResponseSchema.safeParse({
        alreadyMember: true,
        ok: true,
        organizationId: "org-1",
        organizationName: "Acme",
        organizationSlug: "acme",
        role: "admin",
      }).success
    ).toBe(true);
  });

  it("exposes actionable join link errors", () => {
    expect(
      organizationJoinLinkErrorResponseSchema.safeParse({
        code: "organization.join_link.email_verification_required",
        message: "Verify your email before joining this organization.",
        ok: false,
      }).success
    ).toBe(true);
    expect(
      organizationJoinLinkErrorResponseSchema.safeParse({
        code: "auth.invalid_origin",
        message: "Request origin is not trusted.",
        ok: false,
      }).success
    ).toBe(true);
    expect(
      organizationJoinLinkErrorResponseSchema.safeParse({
        code: "organization.join_link.accept.rate_limited",
        message: "Too many join attempts. Try again in a minute.",
        ok: false,
      }).success
    ).toBe(true);
  });

  it("keeps the Center Agent invite-link result explicit for active and missing links", () => {
    expect(
      centerAgentGetOrganizationInviteLinkResponseSchema.parse({
        active: true,
        organizationName: "Acme",
        url: `https://openmeld.ai/join-organization?token=${token}`,
      })
    ).toEqual({
      active: true,
      organizationName: "Acme",
      url: `https://openmeld.ai/join-organization?token=${token}`,
    });
    expect(
      centerAgentGetOrganizationInviteLinkResponseSchema.parse({
        active: false,
        generationGuidance: {
          requiredRole: "owner_or_admin",
          settingsLocation: "Settings → Workspace → General",
          settingsSection: "Invite link",
        },
      })
    ).toEqual({
      active: false,
      generationGuidance: {
        requiredRole: "owner_or_admin",
        settingsLocation: "Settings → Workspace → General",
        settingsSection: "Invite link",
      },
    });
  });

  it("keeps Center Agent invite-link creation role-free and structurally explicit", () => {
    const context = {
      activeOrganizationId: "org-1",
      actorContext: {
        callerPrincipalId: "user-1",
        profileKind: "agent" as const,
        requestId: "request-1",
        openMeldProfileId: "agt_11111111-1111-4111-8111-111111111111",
      },
      agentControllerConversationId: "conversation-1",
    };
    expect(
      centerAgentCreateOrganizationInviteLinkToolRpcInputSchema.safeParse({
        context,
        speakerMember: { memberId: "member-1", userId: "user-1" },
      }).success
    ).toBe(true);
    expect(
      centerAgentCreateOrganizationInviteLinkToolRpcInputSchema.safeParse({
        context,
        speakerMember: {
          memberId: "member-1",
          role: "owner",
          userId: "user-1",
        },
      }).success
    ).toBe(false);

    expect(
      centerAgentCreateOrganizationInviteLinkResponseSchema.parse({
        ok: true,
        organizationName: "Acme",
        url: `https://openmeld.ai/join-organization?token=${token}`,
      })
    ).toEqual({
      ok: true,
      organizationName: "Acme",
      url: `https://openmeld.ai/join-organization?token=${token}`,
    });
    expect(
      centerAgentCreateOrganizationInviteLinkResponseSchema.parse({
        error: {
          code: "organization.join_link.forbidden",
          message:
            "Only an Organization owner or admin can create an invite link.",
        },
        ok: false,
      })
    ).toEqual({
      error: {
        code: "organization.join_link.forbidden",
        message:
          "Only an Organization owner or admin can create an invite link.",
      },
      ok: false,
    });
  });
});
