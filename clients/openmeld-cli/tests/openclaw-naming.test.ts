import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildOpenClawBootstrapAgentId,
  buildOpenClawSpaceSessionKey,
  isCanonicalOpenClawSpaceSessionKey,
} from "../src/provider-hosts/openclaw/naming";

describe("openclaw naming helpers", () => {
  it("builds profile-unique bootstrap agent ids from profile display names", () => {
    expect(
      buildOpenClawBootstrapAgentId({
        openMeldProfileId: "agt_openclaw_phase_one",
        laneKey: "prod",
        profileName: "OpenClaw Phase One",
      })
    ).toBe(
      `openmeld-openclaw-phase-one-prod-agt-open-${createHash("sha256")
        .update("prod:agt_openclaw_phase_one")
        .digest("hex")
        .slice(0, 8)}`
    );
    expect(
      buildOpenClawBootstrapAgentId({
        openMeldProfileId: "  agt_demo_bot  ",
        laneKey: "canary",
        profileName: "  Démo Bot  ",
      })
    ).toBe(
      `openmeld-demo-bot-canary-agt-demo-${createHash("sha256")
        .update("canary:agt_demo_bot")
        .digest("hex")
        .slice(0, 8)}`
    );
  });

  it("builds distinct bootstrap agent ids for profiles that share a display name", () => {
    const firstAgentId = buildOpenClawBootstrapAgentId({
      openMeldProfileId: "agt_same_name_a",
      laneKey: "prod",
      profileName: "Demo Bot",
    });
    const secondAgentId = buildOpenClawBootstrapAgentId({
      openMeldProfileId: "agt_same_name_b",
      laneKey: "prod",
      profileName: "Demo Bot",
    });

    expect(firstAgentId).not.toBe(secondAgentId);
  });

  it("builds distinct bootstrap agent ids across OpenMeld lanes for the same profile", () => {
    const prodAgentId = buildOpenClawBootstrapAgentId({
      openMeldProfileId: "agt_same_name_a",
      laneKey: "prod",
      profileName: "Demo Bot",
    });
    const canaryAgentId = buildOpenClawBootstrapAgentId({
      openMeldProfileId: "agt_same_name_a",
      laneKey: "canary",
      profileName: "Demo Bot",
    });

    expect(prodAgentId).not.toBe(canaryAgentId);
  });

  it("builds stable canonical session keys with a readable space slug", () => {
    const sessionKey = buildOpenClawSpaceSessionKey({
      agentId: "openmeld-openclaw-phase-one",
      spaceId:
        "f03030a4427eeda5cbcb6220dc9f3e07084d084fd8b2ea6eb7dcaecaab7d82ef",
      spaceNameSnapshot: "YC Agent Lab",
    });

    expect(sessionKey).toBe(
      "agent:openmeld-openclaw-phase-one:openmeld-space:yc-agent-lab--f03030a4427eeda5cbcb6220dc9f3e07084d084fd8b2ea6eb7dcaecaab7d82ef"
    );
    expect(isCanonicalOpenClawSpaceSessionKey(sessionKey)).toBe(true);
  });

  it("builds distinct session keys for space ids that share an eight-character prefix", () => {
    const first = buildOpenClawSpaceSessionKey({
      agentId: "openmeld-openclaw-phase-one",
      spaceId: "D3AD-B33F-1111-1111",
      spaceNameSnapshot: "Ops Room",
    });
    const second = buildOpenClawSpaceSessionKey({
      agentId: "openmeld-openclaw-phase-one",
      spaceId: "d3ad_b33f_2222_2222",
      spaceNameSnapshot: "Ops Room",
    });

    expect(first).not.toBe(second);
  });

  it("builds distinct session keys for short space ids instead of one shared placeholder", () => {
    const first = buildOpenClawSpaceSessionKey({
      agentId: "openmeld-openclaw-phase-one",
      spaceId: "abc",
      spaceNameSnapshot: "Ops Room",
    });
    const second = buildOpenClawSpaceSessionKey({
      agentId: "openmeld-openclaw-phase-one",
      spaceId: "abd",
      spaceNameSnapshot: "Ops Room",
    });

    expect(first).not.toBe(second);
    expect(first).not.toContain("00000000");
    expect(second).not.toContain("00000000");
  });

  it("falls back to a safe default slug when the space name is missing", () => {
    expect(
      buildOpenClawSpaceSessionKey({
        agentId: "openmeld-openclaw-phase-one",
        spaceId: "abc12345deadbeef",
        spaceNameSnapshot: null,
      })
    ).toBe(
      "agent:openmeld-openclaw-phase-one:openmeld-space:space--abc12345deadbeef"
    );
  });
});
