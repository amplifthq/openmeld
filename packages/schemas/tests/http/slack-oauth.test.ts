import { describe, expect, it } from "vitest";
import {
  slackOAuthIdentityLinkInputSchema,
  slackOAuthInstallationInputSchema,
  slackOAuthStateConsumeResponseSchema,
  slackOAuthStateCreateResponseSchema,
} from "../../src/index";

describe("Slack OAuth schemas", () => {
  it("keeps the OpenMeld installer and Slack installer identities distinct", () => {
    expect(
      slackOAuthInstallationInputSchema.safeParse({
        actorProfileId: "human-1",
        botToken: "xoxb-installed-token",
        botUserId: "U_BOT",
        installedByUserId: "openmeld-user-1",
        organizationId: "org-1",
        slackInstallerUserId: "U_INSTALLER",
        slackTeamId: "T_WORKSPACE",
      })
    ).toMatchObject({ success: true });
  });

  it("accepts the previous Gateway payload during a rolling deployment", () => {
    expect(
      slackOAuthInstallationInputSchema.safeParse({
        actorProfileId: "human-1",
        botToken: "xoxb-installed-token",
        botUserId: "U_BOT",
        installedByUserId: "openmeld-user-1",
        organizationId: "org-1",
        slackTeamId: "T_WORKSPACE",
      })
    ).toMatchObject({ success: true });
  });

  it("keeps member identity authorization distinct from app installation", () => {
    expect(
      slackOAuthStateCreateResponseSchema.parse({
        expiresAtMs: 1,
        purpose: "member_identity",
        slackTeamId: "T_WORKSPACE",
        state: `slackidentity_${"a".repeat(64)}`,
      })
    ).toMatchObject({ purpose: "member_identity" });

    expect(
      slackOAuthStateConsumeResponseSchema.parse({
        actorProfileId: "human-1",
        moveFromOrganizationId: null,
        organizationId: "org-1",
        purpose: "member_identity",
        returnPath: "/o/acme/people",
        status: "valid",
        userId: "openmeld-user-1",
      })
    ).toMatchObject({ purpose: "member_identity" });
  });

  it("requires the verified provider identity needed for an exact link", () => {
    expect(
      slackOAuthIdentityLinkInputSchema.safeParse({
        actorProfileId: "human-1",
        organizationId: "org-1",
        slackAccountEmail: "felix@amplift.ai",
        slackTeamId: "T_WORKSPACE",
        slackUserId: "U_MEMBER",
        userId: "openmeld-user-1",
      })
    ).toMatchObject({ success: true });
    expect(
      slackOAuthIdentityLinkInputSchema.safeParse({
        actorProfileId: "human-1",
        organizationId: "org-1",
        slackAccountEmail: "not-an-email",
        slackTeamId: "T_WORKSPACE",
        slackUserId: "U_MEMBER",
        userId: "openmeld-user-1",
      })
    ).toMatchObject({ success: false });
  });
});
