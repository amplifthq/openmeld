import { describe, expect, it } from "vitest";
import {
  classifyOpenClawAgentControllerConversation,
  matchesOwnedOpenClawSpaceSessionKey,
  parseOpenClawSpaceSessionKey,
} from "../src/provider-hosts/openclaw/agent-controller-conversation";

describe("openclaw agent controller conversation helpers", () => {
  it("parses canonical session keys into ownership fields", () => {
    expect(
      parseOpenClawSpaceSessionKey(
        "agent:openmeld-openclaw-phase-one:openmeld-space:ops-room--abc12345deadbeef"
      )
    ).toEqual({
      agentId: "openmeld-openclaw-phase-one",
      spaceId: "abc12345deadbeef",
      spaceSlug: "ops-room",
    });
  });

  it("matches canonical session keys against the bootstrap agent and space id", () => {
    expect(
      matchesOwnedOpenClawSpaceSessionKey({
        openClawBootstrapAgentId: "openmeld-openclaw-phase-one",
        sessionKey:
          "agent:openmeld-openclaw-phase-one:openmeld-space:ops-room--abc12345deadbeef",
        spaceId: "abc12345deadbeef",
      })
    ).toBe(true);
    expect(
      matchesOwnedOpenClawSpaceSessionKey({
        openClawBootstrapAgentId: "openmeld-other-agent",
        sessionKey:
          "agent:openmeld-openclaw-phase-one:openmeld-space:ops-room--abc12345deadbeef",
        spaceId: "abc12345deadbeef",
      })
    ).toBe(false);
  });

  it("does not match a session key minted for a space whose id shares only an eight-character prefix", () => {
    expect(
      matchesOwnedOpenClawSpaceSessionKey({
        openClawBootstrapAgentId: "openmeld-openclaw-phase-one",
        sessionKey:
          "agent:openmeld-openclaw-phase-one:openmeld-space:ops-room--d3adb33f11111111",
        spaceId: "d3ad_b33f_2222_2222",
      })
    ).toBe(false);
    expect(
      classifyOpenClawAgentControllerConversation({
        agentControllerConversationId:
          "agent:openmeld-openclaw-phase-one:openmeld-space:ops-room--d3adb33f11111111",
        openClawBootstrapAgentId: "openmeld-openclaw-phase-one",
        spaceId: "d3ad_b33f_2222_2222",
      })
    ).toBe("legacy");
  });

  it("matches short space ids by their complete id, not a shared placeholder", () => {
    expect(
      matchesOwnedOpenClawSpaceSessionKey({
        openClawBootstrapAgentId: "openmeld-openclaw-phase-one",
        sessionKey:
          "agent:openmeld-openclaw-phase-one:openmeld-space:ops-room--abc",
        spaceId: "abc",
      })
    ).toBe(true);
    expect(
      matchesOwnedOpenClawSpaceSessionKey({
        openClawBootstrapAgentId: "openmeld-openclaw-phase-one",
        sessionKey:
          "agent:openmeld-openclaw-phase-one:openmeld-space:ops-room--abc",
        spaceId: "abd",
      })
    ).toBe(false);
  });

  it("classifies a missing controller conversation as missing", () => {
    expect(
      classifyOpenClawAgentControllerConversation({
        agentControllerConversationId: null,
        openClawBootstrapAgentId: "openmeld-openclaw-phase-one",
        spaceId: "abc12345deadbeef",
      })
    ).toBe("missing");
  });

  it("classifies a legacy session id as legacy", () => {
    expect(
      classifyOpenClawAgentControllerConversation({
        agentControllerConversationId: "session-legacy-openclaw-1",
        openClawBootstrapAgentId: "openmeld-openclaw-phase-one",
        spaceId: "abc12345deadbeef",
      })
    ).toBe("legacy");
  });

  it("classifies a canonical controller conversation with matching ownership as canonical_owned", () => {
    expect(
      classifyOpenClawAgentControllerConversation({
        agentControllerConversationId:
          "agent:openmeld-openclaw-phase-one:openmeld-space:ops-room--abc12345deadbeef",
        openClawBootstrapAgentId: "openmeld-openclaw-phase-one",
        spaceId: "abc12345deadbeef",
      })
    ).toBe("canonical_owned");
  });

  it("classifies a canonical-looking controller conversation with the wrong agent as legacy", () => {
    expect(
      classifyOpenClawAgentControllerConversation({
        agentControllerConversationId:
          "agent:openmeld-other-agent:openmeld-space:ops-room--abc12345deadbeef",
        openClawBootstrapAgentId: "openmeld-openclaw-phase-one",
        spaceId: "abc12345deadbeef",
      })
    ).toBe("legacy");
  });

  it("classifies a canonical-looking controller conversation with the wrong space id as legacy", () => {
    expect(
      classifyOpenClawAgentControllerConversation({
        agentControllerConversationId:
          "agent:openmeld-openclaw-phase-one:openmeld-space:ops-room--ffffffffffffffff",
        openClawBootstrapAgentId: "openmeld-openclaw-phase-one",
        spaceId: "abc12345deadbeef",
      })
    ).toBe("legacy");
  });

  it("classifies a prefix-era session key as legacy, so the space derives its own key", () => {
    expect(
      classifyOpenClawAgentControllerConversation({
        agentControllerConversationId:
          "agent:openmeld-openclaw-phase-one:openmeld-space:ops-room--abc12345",
        openClawBootstrapAgentId: "openmeld-openclaw-phase-one",
        spaceId: "abc12345deadbeef",
      })
    ).toBe("legacy");
  });
});
