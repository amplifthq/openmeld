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
      "agent:openmeld-openclaw-phase-one:openmeld-space:yc-agent-lab--f03030a4"
    );
    expect(isCanonicalOpenClawSpaceSessionKey(sessionKey)).toBe(true);
  });

  it("falls back to a safe default slug when the space name is missing", () => {
    expect(
      buildOpenClawSpaceSessionKey({
        agentId: "openmeld-openclaw-phase-one",
        spaceId: "abc12345deadbeef",
        spaceNameSnapshot: null,
      })
    ).toBe("agent:openmeld-openclaw-phase-one:openmeld-space:space--abc12345");
  });
});
