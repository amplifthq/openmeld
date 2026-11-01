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
        "agent:openmeld-openclaw-phase-one:openmeld-space:ops-room--v261626331323334356465616462656566"
      )
    ).toEqual({
      agentId: "openmeld-openclaw-phase-one",
      spaceId: "abc12345deadbeef",
      spaceSlug: "ops-room",
    });
  });

  it("parses the encoded space id back to the exact original id", () => {
    expect(
      parseOpenClawSpaceSessionKey(
        "agent:openmeld-openclaw-phase-one:openmeld-space:ops-room--v2443341442d423333462d313131312d31313131"
      )
    ).toEqual({
      agentId: "openmeld-openclaw-phase-one",
      spaceId: "D3AD-B33F-1111-1111",
      spaceSlug: "ops-room",
    });
  });

  it("does not parse prefix-era, unmarked, or unidentified session keys", () => {
    expect(
      parseOpenClawSpaceSessionKey(
        "agent:openmeld-openclaw-phase-one:openmeld-space:ops-room--abc12345"
      )
    ).toBeNull();
    expect(
      parseOpenClawSpaceSessionKey(
        "agent:openmeld-openclaw-phase-one:openmeld-space:ops-room--abc12345deadbeef"
      )
    ).toBeNull();
    expect(
      parseOpenClawSpaceSessionKey(
        "agent:openmeld-openclaw-phase-one:openmeld-space:ops-room--unidentified"
      )
    ).toBeNull();
  });

  it("matches canonical session keys against the bootstrap agent and space id", () => {
    expect(
      matchesOwnedOpenClawSpaceSessionKey({
        openClawBootstrapAgentId: "openmeld-openclaw-phase-one",
        sessionKey:
          "agent:openmeld-openclaw-phase-one:openmeld-space:ops-room--v261626331323334356465616462656566",
        spaceId: "abc12345deadbeef",
      })
    ).toBe(true);
    expect(
      matchesOwnedOpenClawSpaceSessionKey({
        openClawBootstrapAgentId: "openmeld-other-agent",
        sessionKey:
          "agent:openmeld-openclaw-phase-one:openmeld-space:ops-room--v261626331323334356465616462656566",
        spaceId: "abc12345deadbeef",
      })
    ).toBe(false);
  });

  it("does not match a session key minted for a space id that differs only in separator placement", () => {
    const sessionKey =
      "agent:openmeld-openclaw-phase-one:openmeld-space:ops-room--v261622d63";
    expect(
      matchesOwnedOpenClawSpaceSessionKey({
        openClawBootstrapAgentId: "openmeld-openclaw-phase-one",
        sessionKey,
        spaceId: "ab-c",
      })
    ).toBe(true);
    expect(
      matchesOwnedOpenClawSpaceSessionKey({
        openClawBootstrapAgentId: "openmeld-openclaw-phase-one",
        sessionKey,
        spaceId: "a-bc",
      })
    ).toBe(false);
    expect(
      classifyOpenClawAgentControllerConversation({
        agentControllerConversationId: sessionKey,
        openClawBootstrapAgentId: "openmeld-openclaw-phase-one",
        spaceId: "a-bc",
      })
    ).toBe("legacy");
  });

  it("does not match a prefix-era session key for the short space id it spells", () => {
    const sessionKey =
      "agent:openmeld-openclaw-phase-one:openmeld-space:ops-room--abc12345";
    expect(
      matchesOwnedOpenClawSpaceSessionKey({
        openClawBootstrapAgentId: "openmeld-openclaw-phase-one",
        sessionKey,
        spaceId: "abc12345",
      })
    ).toBe(false);
    expect(
      classifyOpenClawAgentControllerConversation({
        agentControllerConversationId: sessionKey,
        openClawBootstrapAgentId: "openmeld-openclaw-phase-one",
        spaceId: "abc12345",
      })
    ).toBe("legacy");
  });

  it("never matches a stored key whose space segment is the unidentified marker", () => {
    const sessionKey =
      "agent:openmeld-openclaw-phase-one:openmeld-space:ops-room--unidentified";
    expect(
      matchesOwnedOpenClawSpaceSessionKey({
        openClawBootstrapAgentId: "openmeld-openclaw-phase-one",
        sessionKey,
        spaceId: "",
      })
    ).toBe(false);
    expect(
      classifyOpenClawAgentControllerConversation({
        agentControllerConversationId: sessionKey,
        openClawBootstrapAgentId: "openmeld-openclaw-phase-one",
        spaceId: "",
      })
    ).toBe("legacy");
    expect(
      classifyOpenClawAgentControllerConversation({
        agentControllerConversationId:
          "agent:openmeld-openclaw-phase-one:openmeld-space:ops-room--00000000",
        openClawBootstrapAgentId: "openmeld-openclaw-phase-one",
        spaceId: "---",
      })
    ).toBe("legacy");
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
          "agent:openmeld-openclaw-phase-one:openmeld-space:ops-room--v2616263",
        spaceId: "abc",
      })
    ).toBe(true);
    expect(
      matchesOwnedOpenClawSpaceSessionKey({
        openClawBootstrapAgentId: "openmeld-openclaw-phase-one",
        sessionKey:
          "agent:openmeld-openclaw-phase-one:openmeld-space:ops-room--v2616263",
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
          "agent:openmeld-openclaw-phase-one:openmeld-space:ops-room--v261626331323334356465616462656566",
        openClawBootstrapAgentId: "openmeld-openclaw-phase-one",
        spaceId: "abc12345deadbeef",
      })
    ).toBe("canonical_owned");
  });

  it("classifies a canonical-looking controller conversation with the wrong agent as legacy", () => {
    expect(
      classifyOpenClawAgentControllerConversation({
        agentControllerConversationId:
          "agent:openmeld-other-agent:openmeld-space:ops-room--v261626331323334356465616462656566",
        openClawBootstrapAgentId: "openmeld-openclaw-phase-one",
        spaceId: "abc12345deadbeef",
      })
    ).toBe("legacy");
  });

  it("classifies a canonical-looking controller conversation with the wrong space id as legacy", () => {
    expect(
      classifyOpenClawAgentControllerConversation({
        agentControllerConversationId:
          "agent:openmeld-openclaw-phase-one:openmeld-space:ops-room--v266666666666666666666666666666666",
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
