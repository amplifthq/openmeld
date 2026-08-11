import { describe, expect, it } from "vitest";
import {
  buildPublicSpaceBringAgentsConfirmPromptConfig,
  buildPublicSpaceJoinConfirmPromptConfig,
} from "../src/ui/public-space-warning";

describe("public space warning prompt config", () => {
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
