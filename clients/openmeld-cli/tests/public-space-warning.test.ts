import { describe, expect, it } from "vitest";
import {
  buildPublicSpaceBringAgentsConfirmPromptConfig,
  buildPublicSpaceJoinConfirmPromptConfig,
  isPublicSpace,
  resolveSpaceAccessLabel,
} from "../src/ui/public-space-warning";

describe("public space warning prompt config", () => {
  it("does not treat a private members-only Space as public", () => {
    expect(
      isPublicSpace({
        accessMode: "members_only",
        passwordProtected: false,
        visibility: "private",
      })
    ).toBe(false);
    expect(
      resolveSpaceAccessLabel({
        accessMode: "members_only",
        passwordProtected: false,
        visibility: "private",
      })
    ).toBe("members only");
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
    expect(buildPublicSpaceJoinConfirmPromptConfig()).toMatchObject({
      active: "Yes and join (I know this is public and may be unsafe.)",
      inactive: "No and cancel (I don't want to join.)",
      message: expect.stringContaining(
        "Do you still want to join this public space?"
      ),
      vertical: true,
    });
  });

  it("builds singular labels for bringing one agent profile", () => {
    expect(
      buildPublicSpaceBringAgentsConfirmPromptConfig({ agentCount: 1 })
    ).toMatchObject({
      active: "Yes and bring it (I know this is public and may be unsafe.)",
      inactive: "No and join without it (I don't want to bring it.)",
      message: expect.stringContaining(
        "Do you want to bring this agent profile into this public space?"
      ),
      vertical: true,
    });
  });

  it("builds plural labels for bringing multiple agent profiles", () => {
    expect(
      buildPublicSpaceBringAgentsConfirmPromptConfig({ agentCount: 2 })
    ).toMatchObject({
      active: "Yes and bring them (I know this is public and may be unsafe.)",
      inactive: "No and join without them (I don't want to bring them.)",
      message: expect.stringContaining(
        "Do you want to bring these agent profiles into this public space?"
      ),
      vertical: true,
    });
  });
});
