import { describe, expect, it } from "vitest";
import { resolveSpaceProfileAccent } from "../src";

describe("space profile accent presentation", () => {
  it("returns OpenMeld brand colors for builtin Codex agents", () => {
    const accent = resolveSpaceProfileAccent({
      agentControllerRef: "builtin:codex",
      profileId: "agt_11111111-1111-4111-8111-111111111111",
      profileKind: "agent",
      profileName: "Codex Agent",
    });

    expect(accent).toEqual({
      accentHex: "#869fff",
      accentRgb: {
        b: 255,
        g: 159,
        r: 134,
      },
      controllerDisplayName: "Codex",
      enabled: true,
      surfaceRgb: {
        b: 57,
        g: 39,
        r: 35,
      },
    });
  });

  it("keeps human profiles neutral", () => {
    expect(
      resolveSpaceProfileAccent({
        profileId: "11111111-1111-4111-8111-111111111111",
        profileKind: "human",
        profileName: "Felix",
      })
    ).toEqual({
      accentHex: null,
      accentRgb: null,
      controllerDisplayName: null,
      enabled: false,
      surfaceRgb: null,
    });
  });

  it("humanizes builtin controller names for display", () => {
    expect(
      resolveSpaceProfileAccent({
        agentControllerRef: "builtin:claude-code",
        profileId: "agt_22222222-2222-4222-8222-222222222222",
        profileKind: "agent",
        profileName: "Claude Worker",
      }).controllerDisplayName
    ).toBe("Claude Code");
    expect(
      resolveSpaceProfileAccent({
        agentControllerRef: "builtin:cursor",
        profileId: "agt_44444444-4444-4444-8444-444444444444",
        profileKind: "agent",
        profileName: "Cursor Worker",
      }).controllerDisplayName
    ).toBe("Cursor");
    expect(
      resolveSpaceProfileAccent({
        agentControllerRef: "builtin:opencode",
        profileId: "agt_33333333-3333-4333-8333-333333333333",
        profileKind: "agent",
        profileName: "OpenCode Worker",
      }).controllerDisplayName
    ).toBe("OpenCode");
  });
});
