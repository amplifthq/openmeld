import { describe, expect, it } from "vitest";
import {
  buildPublicSpaceBringAgentsConfirmPromptConfig,
  buildPublicSpaceJoinConfirmPromptConfig,
  resolvePublicSpaceExposure,
  resolveSpaceAccessLabel,
} from "../src/ui/public-space-warning";

describe("public space warning prompt config", () => {
  it("does not treat a private members-only Space as public", () => {
    expect(
      resolvePublicSpaceExposure({
        accessMode: "members_only",
        passwordProtected: false,
        visibility: "private",
      })
    ).toBeNull();
    expect(
      resolveSpaceAccessLabel({
        accessMode: "members_only",
        passwordProtected: false,
        visibility: "private",
      })
    ).toBe("members only");
  });

  it("warns for every access mode that lets anyone with the link read", () => {
    expect(
      resolvePublicSpaceExposure({
        accessMode: "public",
        passwordProtected: false,
        visibility: "public",
      })
    ).toBe("anyone_can_join");
    expect(
      resolvePublicSpaceExposure({
        accessMode: "public_view_join_password",
        passwordProtected: true,
        visibility: "private",
      })
    ).toBe("anyone_can_view");
  });

  it("uses only the legacy password fact when accessMode is absent", () => {
    expect(
      resolvePublicSpaceExposure({
        passwordProtected: false,
        visibility: "private",
      })
    ).toBe("anyone_can_join");
    expect(
      resolveSpaceAccessLabel({
        passwordProtected: false,
        visibility: "private",
      })
    ).toBe("anyone with the link");
  });

  it("describes each Space access mode from canonical access facts", () => {
    expect(
      resolveSpaceAccessLabel({
        accessMode: "public",
        passwordProtected: false,
        visibility: "public",
      })
    ).toBe("anyone with the link");
    expect(
      resolveSpaceAccessLabel({
        accessMode: "public_view_join_password",
        passwordProtected: false,
        visibility: "public",
      })
    ).toBe("anyone can view; password required to join");
    expect(
      resolveSpaceAccessLabel({
        accessMode: "protected",
        passwordProtected: true,
        visibility: "private",
      })
    ).toBe("password required to view and join");
  });

  it("builds clear labels for the public-space join confirmation", () => {
    expect(
      buildPublicSpaceJoinConfirmPromptConfig({
        exposure: "anyone_can_join",
      })
    ).toMatchObject({
      active: "Yes, join this Space",
      inactive: "No, go back",
      message: expect.stringContaining("Do you want to join this Space?"),
      vertical: true,
    });
  });

  it("explains when anyone can read but joining still needs a password", () => {
    const config = buildPublicSpaceJoinConfirmPromptConfig({
      exposure: "anyone_can_view",
    });

    expect(config.message).toContain(
      "Anyone with this Space link can read what is shared here. A password is required to join."
    );
    expect(config.message).not.toContain("anyone with this Space ID can join");
  });

  it("builds singular labels for bringing one agent profile", () => {
    expect(
      buildPublicSpaceBringAgentsConfirmPromptConfig({
        agentCount: 1,
        exposure: "anyone_can_join",
      })
    ).toMatchObject({
      active: "Yes, bring this agent",
      inactive: "No, join without this agent",
      message: expect.stringContaining(
        "Bring this agent into a Space that anyone with the link can read?"
      ),
      vertical: true,
    });
  });

  it("builds plural labels for bringing multiple agent profiles", () => {
    expect(
      buildPublicSpaceBringAgentsConfirmPromptConfig({
        agentCount: 2,
        exposure: "anyone_can_view",
      })
    ).toMatchObject({
      active: "Yes, bring these agents",
      inactive: "No, join without these agents",
      message: expect.stringContaining(
        "Bring these agents into a Space that anyone with the link can read?"
      ),
      vertical: true,
    });
  });
});
