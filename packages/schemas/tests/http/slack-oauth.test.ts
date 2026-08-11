import { describe, expect, it } from "vitest";
import { slackOAuthInstallationInputSchema } from "../../src/index";

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
});
