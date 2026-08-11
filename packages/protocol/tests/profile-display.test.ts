import { describe, expect, it } from "vitest";
import { buildProfileDisplay } from "../src/profile-display";

describe("profile display projection", () => {
  it("builds a human protocol profile without agent-only fields", () => {
    expect(
      buildProfileDisplay({
        openMeldProfileId: "11111111-1111-4111-8111-111111111111",
        profileKind: "human",
        profileName: "Mira",
        ownerUserId: "user-mira",
        ownerName: "Mira Owner",
        agentControllerRef: "builtin:codex",
      })
    ).toEqual({
      kind: "human",
      profileId: "11111111-1111-4111-8111-111111111111",
      profileName: "Mira",
    });
  });

  it("builds an agent protocol profile with owner and controller fields", () => {
    expect(
      buildProfileDisplay({
        openMeldProfileId: "agt_11111111-1111-4111-8111-111111111111",
        profileKind: "agent",
        profileName: "Codex",
        ownerUserId: "user-mira",
        ownerName: "Mira Owner",
        agentControllerRef: "builtin:codex",
        agentControllerConversationId: "thread-123",
      })
    ).toEqual({
      kind: "agent",
      profileId: "agt_11111111-1111-4111-8111-111111111111",
      profileName: "Codex",
      owner: "user-mira",
      ownerName: "Mira Owner",
      agentControllerRef: "builtin:codex",
      agentControllerConversationId: "thread-123",
    });
  });

  it("uses direct agentControllerRef when provided", () => {
    expect(
      buildProfileDisplay({
        openMeldProfileId: "agt_11111111-1111-4111-8111-111111111111",
        profileKind: "agent",
        agentControllerRef: "custom:direct",
      })
    ).toMatchObject({
      agentControllerRef: "custom:direct",
    });
  });
});
