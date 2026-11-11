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
      "agent:openmeld-openclaw-phase-one:openmeld-space-v2:yc-agent-lab--v266303330333061343432376565646135636263623632323064633966336530373038346430383466643862326561366562376463616563616162376438326566"
    );
    expect(isCanonicalOpenClawSpaceSessionKey(sessionKey)).toBe(true);
  });

  it("builds distinct session keys for space ids that differ only in separator placement or case", () => {
    const first = buildOpenClawSpaceSessionKey({
      agentId: "openmeld-openclaw-phase-one",
      spaceId: "ab-c",
      spaceNameSnapshot: "Ops Room",
    });
    const second = buildOpenClawSpaceSessionKey({
      agentId: "openmeld-openclaw-phase-one",
      spaceId: "a-bc",
      spaceNameSnapshot: "Ops Room",
    });
    const upper = buildOpenClawSpaceSessionKey({
      agentId: "openmeld-openclaw-phase-one",
      spaceId: "AB-C",
      spaceNameSnapshot: "Ops Room",
    });

    expect(first).toBe(
      "agent:openmeld-openclaw-phase-one:openmeld-space-v2:ops-room--v261622d63"
    );
    expect(second).toBe(
      "agent:openmeld-openclaw-phase-one:openmeld-space-v2:ops-room--v2612d6263"
    );
    expect(first).not.toBe(second);
    expect(upper).not.toBe(first);
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
    expect(first).not.toContain("unidentified");
    expect(second).not.toContain("unidentified");
  });

  it("marks keys for unidentifiable space ids as unidentified instead of a shared placeholder", () => {
    for (const spaceId of ["", "   "]) {
      const sessionKey = buildOpenClawSpaceSessionKey({
        agentId: "openmeld-openclaw-phase-one",
        spaceId,
        spaceNameSnapshot: "Ops Room",
      });

      expect(sessionKey).toBe(
        "agent:openmeld-openclaw-phase-one:openmeld-space-v2:ops-room--unidentified"
      );
      expect(isCanonicalOpenClawSpaceSessionKey(sessionKey)).toBe(false);
    }
  });

  it("does not treat prefix-era or unmarked full-id session keys as canonical", () => {
    expect(
      isCanonicalOpenClawSpaceSessionKey(
        "agent:openmeld-openclaw-phase-one:openmeld-space:ops-room--abc12345"
      )
    ).toBe(false);
    expect(
      isCanonicalOpenClawSpaceSessionKey(
        "agent:openmeld-openclaw-phase-one:openmeld-space:ops-room--abc12345deadbeef"
      )
    ).toBe(false);
    // A v2 segment under the prefix-era component is not canonical either:
    // the version marker is the fixed key component, not the segment.
    expect(
      isCanonicalOpenClawSpaceSessionKey(
        "agent:openmeld-openclaw-phase-one:openmeld-space:ops-room--v261626331323334356465616462656566"
      )
    ).toBe(false);
  });

  it("mints short-id keys under a component the prefix-era builder could never emit", () => {
    // The prefix-era builder minted this key for v2616263deadbeef with
    // Space name Ops; its eight-character segment is also the v2 encoding
    // of the short id abc. The current builder must not mint it again.
    const prefixEraKey = "agent:openmeld-demo:openmeld-space:ops--v2616263";
    const sessionKey = buildOpenClawSpaceSessionKey({
      agentId: "openmeld-demo",
      spaceId: "abc",
      spaceNameSnapshot: "Ops",
    });

    expect(sessionKey).toBe(
      "agent:openmeld-demo:openmeld-space-v2:ops--v2616263"
    );
    expect(sessionKey).not.toBe(prefixEraKey);
    expect(isCanonicalOpenClawSpaceSessionKey(prefixEraKey)).toBe(false);
    expect(isCanonicalOpenClawSpaceSessionKey(sessionKey)).toBe(true);
  });

  it("falls back to a safe default slug when the space name is missing", () => {
    expect(
      buildOpenClawSpaceSessionKey({
        agentId: "openmeld-openclaw-phase-one",
        spaceId: "abc12345deadbeef",
        spaceNameSnapshot: null,
      })
    ).toBe(
      "agent:openmeld-openclaw-phase-one:openmeld-space-v2:space--v261626331323334356465616462656566"
    );
  });
});
