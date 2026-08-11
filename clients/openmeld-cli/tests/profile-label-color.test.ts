import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  createSpaceMembersSnapshot as createSharedSpaceMembersSnapshot,
  createSpaceMemberAgentSnapshot,
  createSpaceMemberHumanSnapshot,
} from "@openmeld/schemas/testing";
import type { SpaceMembersSnapshot } from "@openmeld/schemas/types";
import pc from "picocolors";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OPENMELD_COMPOSER_SURFACE_BG_RGB } from "../src/ui/brand";
import {
  colorizeAgentLabel,
  colorizeProfileName,
  HUMAN_PROFILE_NAME_COLOR_ENABLED,
  resolveAgentSurfaceRgb,
  resolveProfileAccentRgb,
  resolveProfileNameColorIdentity,
} from "../src/ui/profile-label-color";

const HUMAN_PROFILE_ID = "823a46d4-b711-45b2-933e-722ef5b3a8ee";
const HUMAN_OWNER_USER_ID = "user_openmeld_dev_local_test";
const AGENT_PROFILE_ID = "agt_46759e81-292c-4f7b-8108-95512ee2b2a1";
const TRUECOLOR_PREFIX_START = "\u001B[38;2;";
const originalColorSupport = pc.isColorSupported;

afterEach(() => {
  Object.defineProperty(pc, "isColorSupported", {
    value: originalColorSupport,
    configurable: true,
    writable: true,
  });
});

beforeEach(() => {
  Object.defineProperty(pc, "isColorSupported", {
    value: true,
    configurable: true,
    writable: true,
  });
});

describe("profile-label-color", () => {
  it("keeps all human and owner labels plain when the human color switch is off", () => {
    const snapshot = createSpaceMembersSnapshot();

    const speakerLabel = colorizeProfileName({
      label: "OpenMeld Dev Local Test",
      target: "display-profile",
      profileIdentity: {
        kind: "human",
        profileId: HUMAN_PROFILE_ID,
        profileName: "OpenMeld Dev Local Test",
      },
      spaceMembersSnapshot: snapshot,
    });
    const ownerLabel = colorizeProfileName({
      label: "OpenMeld Dev Local Test",
      target: "person",
      personIdentity: {
        ownerUserId: HUMAN_OWNER_USER_ID,
        ownerName: "OpenMeld Dev Local Test",
        profileId: HUMAN_PROFILE_ID,
        profileName: "OpenMeld Dev Local Test",
      },
      spaceMembersSnapshot: snapshot,
    });

    expect(HUMAN_PROFILE_NAME_COLOR_ENABLED).toBe(false);
    expect(speakerLabel).toBe("OpenMeld Dev Local Test");
    expect(ownerLabel).toBe("OpenMeld Dev Local Test");
  });

  it("resolves a human display profile through members snapshot owner identity", () => {
    const snapshot = createSpaceMembersSnapshot();

    const resolvedIdentity = resolveProfileNameColorIdentity({
      label: "OpenMeld Dev Local Test",
      target: "display-profile",
      profileIdentity: {
        kind: "human",
        profileId: HUMAN_PROFILE_ID,
        profileName: "OpenMeld Dev Local Test",
      },
      spaceMembersSnapshot: snapshot,
    });

    expect(resolvedIdentity).toMatchObject({
      identityKey: HUMAN_OWNER_USER_ID,
      kind: "human",
      profileId: HUMAN_PROFILE_ID,
      profileName: "OpenMeld Dev Local Test",
    });
  });

  it("keeps agent colors keyed by the agent profile id instead of the owner", () => {
    const agentIdentity = resolveProfileNameColorIdentity({
      label: "hi-agent",
      target: "agent",
      agentIdentity: {
        profileId: AGENT_PROFILE_ID,
        profileName: "hi-agent",
      },
    });
    const ownerIdentity = resolveProfileNameColorIdentity({
      label: "OpenMeld Dev Local Test",
      target: "person",
      personIdentity: {
        ownerUserId: HUMAN_OWNER_USER_ID,
        ownerName: "OpenMeld Dev Local Test",
        profileId: HUMAN_PROFILE_ID,
        profileName: "OpenMeld Dev Local Test",
      },
    });

    expect(agentIdentity).toMatchObject({
      identityKey: AGENT_PROFILE_ID,
      kind: "agent",
      profileId: AGENT_PROFILE_ID,
      profileName: "hi-agent",
    });
    expect(ownerIdentity).toMatchObject({
      identityKey: HUMAN_OWNER_USER_ID,
      kind: "human",
      profileId: HUMAN_PROFILE_ID,
      profileName: "OpenMeld Dev Local Test",
    });
    expect(resolveProfileAccentRgb("hi-agent", agentIdentity)).not.toEqual(
      resolveProfileAccentRgb("OpenMeld Dev Local Test", ownerIdentity)
    );
  });

  it("pins builtin codex agents to the official codex brand color", () => {
    const hiAgent = colorizeAgentLabel("hi-agent", {
      agentControllerRef: "builtin:codex",
      profileId: AGENT_PROFILE_ID,
      profileName: "hi-agent",
    });
    const batchAgent = colorizeAgentLabel("batch1-agent-model-compat", {
      agentControllerRef: "builtin:codex",
      profileId: "agt_43cf3590-c214-4a65-a445-58b21144f2dc",
      profileName: "batch1-agent-model-compat",
    });

    expect(extractTrueColorPrefix(hiAgent, "hi-agent")).toBe(
      "\u001B[38;2;134;159;255m"
    );
    expect(
      extractTrueColorPrefix(batchAgent, "batch1-agent-model-compat")
    ).toBe("\u001B[38;2;134;159;255m");
  });

  it("pins builtin claude-code and openclaw agents to their official brand colors", () => {
    const claudeAgent = colorizeAgentLabel("oh-my-claude", {
      agentControllerRef: "builtin:claude-code",
      profileId: "agt_802d7552-216a-4925-8f54-8fac62b7af77",
      profileName: "oh-my-claude",
    });
    const openclawAgent = colorizeAgentLabel("openresearch-agent", {
      agentControllerRef: "builtin:openclaw",
      profileId: "agt_f303f3cc-dc56-424e-989e-4db889dfd650",
      profileName: "openresearch-agent",
    });

    expect(extractTrueColorPrefix(claudeAgent, "oh-my-claude")).toBe(
      "\u001B[38;2;217;119;87m"
    );
    expect(extractTrueColorPrefix(openclawAgent, "openresearch-agent")).toBe(
      "\u001B[38;2;212;56;56m"
    );
  });

  it("does not color agents without a fixed builtin brand", () => {
    const customAgent = colorizeAgentLabel("custom-agent", {
      agentControllerRef: "custom:my-runtime",
      profileId: "agt_b8b20aa4-87d9-4d0c-8e1a-180006d2f200",
      profileName: "custom-agent",
    });
    const officialCodexAgent = colorizeAgentLabel("hi-agent", {
      agentControllerRef: "builtin:codex",
      profileId: AGENT_PROFILE_ID,
      profileName: "hi-agent",
    });

    expect(extractTrueColorPrefix(customAgent, "custom-agent")).toBeUndefined();
    expect(customAgent).toBe("custom-agent");
    expect(officialCodexAgent).not.toBe("hi-agent");
  });

  it("uses the composer surface for non-builtin agent bubble backgrounds", () => {
    const guestAgentSurface = resolveAgentSurfaceRgb("guest-agent", {
      agentControllerRef: "builtin:guest",
      profileId: "agt_guest_01",
      profileName: "guest-agent",
    });

    expect(guestAgentSurface).toEqual({
      r: OPENMELD_COMPOSER_SURFACE_BG_RGB[0],
      g: OPENMELD_COMPOSER_SURFACE_BG_RGB[1],
      b: OPENMELD_COMPOSER_SURFACE_BG_RGB[2],
    });
  });

  it("keeps space-scoped hues broadly separated across visible identities", () => {
    const snapshot = createLargeSpaceMembersSnapshot();
    const identities = [
      {
        label: "OpenMeld Dev Local Test",
        rgb: resolveProfileAccentRgb(
          "OpenMeld Dev Local Test",
          resolveProfileNameColorIdentity({
            label: "OpenMeld Dev Local Test",
            target: "person",
            personIdentity: {
              ownerUserId: HUMAN_OWNER_USER_ID,
              ownerName: "OpenMeld Dev Local Test",
              profileId: HUMAN_PROFILE_ID,
              profileName: "OpenMeld Dev Local Test",
            },
            spaceMembersSnapshot: snapshot,
          }),
          { spaceMembersSnapshot: snapshot }
        ),
      },
      {
        label: "history-debug-human",
        rgb: resolveProfileAccentRgb(
          "history-debug-human",
          resolveProfileNameColorIdentity({
            label: "history-debug-human",
            target: "person",
            personIdentity: {
              ownerUserId: "user_history_debug_human",
              ownerName: "history-debug-human",
              profileId: "3500f781-b75d-4f4f-b930-10373853f5c2",
              profileName: "history-debug-human",
            },
            spaceMembersSnapshot: snapshot,
          }),
          { spaceMembersSnapshot: snapshot }
        ),
      },
      {
        label: "hi-agent",
        rgb: resolveProfileAccentRgb(
          "hi-agent",
          resolveProfileNameColorIdentity({
            label: "hi-agent",
            target: "agent",
            agentIdentity: {
              agentControllerRef: "builtin:codex",
              profileId: AGENT_PROFILE_ID,
              profileName: "hi-agent",
            },
            spaceMembersSnapshot: snapshot,
          }),
          { spaceMembersSnapshot: snapshot }
        ),
      },
      {
        label: "oh-my-claude",
        rgb: resolveProfileAccentRgb(
          "oh-my-claude",
          resolveProfileNameColorIdentity({
            label: "oh-my-claude",
            target: "agent",
            agentIdentity: {
              agentControllerRef: "builtin:claude-code",
              profileId: "agt_802d7552-216a-4925-8f54-8fac62b7af77",
              profileName: "oh-my-claude",
            },
            spaceMembersSnapshot: snapshot,
          }),
          { spaceMembersSnapshot: snapshot }
        ),
      },
      {
        label: "openresearch-agent",
        rgb: resolveProfileAccentRgb(
          "openresearch-agent",
          resolveProfileNameColorIdentity({
            label: "openresearch-agent",
            target: "agent",
            agentIdentity: {
              agentControllerRef: "builtin:openclaw",
              profileId: "agt_f303f3cc-dc56-424e-989e-4db889dfd650",
              profileName: "openresearch-agent",
            },
            spaceMembersSnapshot: snapshot,
          }),
          { spaceMembersSnapshot: snapshot }
        ),
      },
      {
        label: "batch1-agent-model-compat",
        rgb: resolveProfileAccentRgb(
          "batch1-agent-model-compat",
          resolveProfileNameColorIdentity({
            label: "batch1-agent-model-compat",
            target: "agent",
            agentIdentity: {
              agentControllerRef: "builtin:codex",
              profileId: "agt_43cf3590-c214-4a65-a445-58b21144f2dc",
              profileName: "batch1-agent-model-compat",
            },
            spaceMembersSnapshot: snapshot,
          }),
          { spaceMembersSnapshot: snapshot }
        ),
      },
    ];

    const hues = identities.map((identity) => ({
      label: identity.label,
      hue: rgbToHue(identity.rgb.r, identity.rgb.g, identity.rgb.b),
    }));
    const uniqueHues = [...new Set(hues.map((entry) => entry.hue))];
    const minimumPairDistance = uniqueHues.reduce<number>(
      (minimumDistance, left, index) => {
        let nextMinimumDistance = minimumDistance;
        for (const right of uniqueHues.slice(index + 1)) {
          nextMinimumDistance = Math.min(
            nextMinimumDistance,
            circularHueDistance(left, right)
          );
        }
        return nextMinimumDistance;
      },
      Number.POSITIVE_INFINITY
    );

    expect(minimumPairDistance).toBeGreaterThanOrEqual(14);
  });

  it("keeps low-level profile color primitives private to the shared color layer", () => {
    const repoSrcRoot = path.resolve(import.meta.dirname, "../src");
    const forbiddenIdentifiers = [
      "colorizeProfileLabel",
      "resolveProfileAccentRgb",
      "resolveProfileSurfaceRgb",
      "resolveProfileNameColorIdentity",
      "resolveProfileNameSurfaceRgb",
    ];
    const files = walkSourceFiles(repoSrcRoot).filter(
      (filePath) => !filePath.endsWith("ui/profile-label-color.ts")
    );

    const violations: string[] = [];
    for (const filePath of files) {
      const contents = readFileSync(filePath, "utf8");
      for (const identifier of forbiddenIdentifiers) {
        if (
          contents.includes(identifier) &&
          contents.includes("profile-label-color")
        ) {
          violations.push(
            `${path.relative(repoSrcRoot, filePath)} -> ${identifier}`
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

function createSpaceMembersSnapshot(): SpaceMembersSnapshot {
  return createSharedSpaceMembersSnapshot({
    agents: [
      createAgentSnapshot({
        profileId: AGENT_PROFILE_ID,
        profileName: "hi-agent",
      }),
    ],
    generatedAt: "2026-03-15T00:00:00.000Z",
    humans: [
      createSpaceMemberHumanSnapshot({
        addedAt: "2026-03-15T00:00:00.000Z",
        createdAt: "2026-03-15T00:00:00.000Z",
        firstEnteredAt: "2026-03-15T00:00:00.000Z",
        lastEnteredAt: "2026-03-15T00:00:00.000Z",
        lastSeenAt: "2026-03-15T00:00:00.000Z",
        lastSeenLabel: "seen now",
        liveNow: true,
        memberSourceLabel: "space creator",
        ownerName: "OpenMeld Dev Local Test",
        ownerUserId: HUMAN_OWNER_USER_ID,
        profileId: HUMAN_PROFILE_ID,
        profileName: "OpenMeld Dev Local Test",
        updatedAt: "2026-03-15T00:00:00.000Z",
      }),
    ],
    spaceId: "ab1c3286d92926cc07e70b4023d24a359387d250f670619af138c3a767f92efd",
  });
}

function createLargeSpaceMembersSnapshot(): SpaceMembersSnapshot {
  const snapshot = createSpaceMembersSnapshot();
  return createSharedSpaceMembersSnapshot({
    agents: [
      ...snapshot.agents,
      createAgentSnapshot({
        agentControllerRef: "builtin:claude-code",
        profileId: "agt_802d7552-216a-4925-8f54-8fac62b7af77",
        profileName: "oh-my-claude",
      }),
      createAgentSnapshot({
        agentControllerRef: "builtin:openclaw",
        profileId: "agt_f303f3cc-dc56-424e-989e-4db889dfd650",
        profileName: "openresearch-agent",
      }),
      createAgentSnapshot({
        agentControllerRef: "builtin:codex",
        profileId: "agt_43cf3590-c214-4a65-a445-58b21144f2dc",
        profileName: "batch1-agent-model-compat",
      }),
      createAgentSnapshot({
        agentControllerRef: "builtin:codex",
        profileId: "agt_182fca6d-fce9-4d24-b3c6-b5912ee73e47",
        profileName: "cancel-removal-agent",
      }),
      createAgentSnapshot({
        agentControllerRef: "builtin:codex",
        profileId: "agt_6c1abdb6-1e8b-4c60-a6ee-3dd1a57c9c71",
        profileName: "hey-judy",
      }),
    ],
    generatedAt: snapshot.generatedAt,
    humans: [
      ...snapshot.humans,
      createSpaceMemberHumanSnapshot({
        addedAt: "2026-03-15T00:00:00.000Z",
        addedByDisplayName: "OpenMeld Dev Local Test",
        addedByOwnerUserId: HUMAN_OWNER_USER_ID,
        addedByProfileId: HUMAN_PROFILE_ID,
        createdAt: "2026-03-15T00:00:00.000Z",
        firstEnteredAt: "2026-03-15T00:00:00.000Z",
        lastEnteredAt: "2026-03-15T00:00:00.000Z",
        lastSeenAt: "2026-03-15T00:00:00.000Z",
        lastSeenLabel: "seen now",
        liveNow: true,
        memberSource: "added_by_member",
        memberSourceLabel: "added by OpenMeld Dev Local Test",
        ownerName: "history-debug-human",
        ownerUserId: "user_history_debug_human",
        profileId: "3500f781-b75d-4f4f-b930-10373853f5c2",
        profileName: "history-debug-human",
        updatedAt: "2026-03-15T00:00:00.000Z",
      }),
    ],
    spaceId: snapshot.spaceId,
  });
}

function createAgentSnapshot(input: {
  agentControllerRef?: string;
  profileId: string;
  profileName: string;
}): SpaceMembersSnapshot["agents"][number] {
  return createSpaceMemberAgentSnapshot({
    addedAt: "2026-03-15T00:00:00.000Z",
    addedByDisplayName: "OpenMeld Dev Local Test",
    addedByOwnerUserId: HUMAN_OWNER_USER_ID,
    addedByProfileId: HUMAN_PROFILE_ID,
    agentControllerConversationId:
      "codex resume 019ce83f-a125-7113-904e-884f60de8fe1",
    agentControllerRef: input.agentControllerRef ?? "builtin:codex",
    createdAt: "2026-03-15T00:00:00.000Z",
    firstEnteredAt: "2026-03-15T00:00:00.000Z",
    lastEnteredAt: "2026-03-15T00:00:00.000Z",
    lastSeenAt: "2026-03-15T00:00:00.000Z",
    lastSeenLabel: "seen now",
    liveNow: true,
    memberSourceLabel: "added by OpenMeld Dev Local Test",
    ownerName: "OpenMeld Dev Local Test",
    ownerUserId: HUMAN_OWNER_USER_ID,
    profileId: input.profileId,
    profileName: input.profileName,
    updatedAt: "2026-03-15T00:00:00.000Z",
    wakeabilityReasonText: "wakeable",
  });
}

function walkSourceFiles(rootDir: string): string[] {
  const entries = readdirSync(rootDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkSourceFiles(fullPath));
      continue;
    }

    if (entry.isFile() && fullPath.endsWith(".ts")) {
      files.push(fullPath);
    }
  }

  return files;
}

function rgbToHue(red: number, green: number, blue: number): number {
  const normalizedRed = red / 255;
  const normalizedGreen = green / 255;
  const normalizedBlue = blue / 255;
  const maxChannel = Math.max(normalizedRed, normalizedGreen, normalizedBlue);
  const minChannel = Math.min(normalizedRed, normalizedGreen, normalizedBlue);
  const chroma = maxChannel - minChannel;

  if (chroma === 0) {
    return 0;
  }

  if (maxChannel === normalizedRed) {
    return normalizeHue(((normalizedGreen - normalizedBlue) / chroma) * 60);
  }
  if (maxChannel === normalizedGreen) {
    return normalizeHue(120 + ((normalizedBlue - normalizedRed) / chroma) * 60);
  }
  return normalizeHue(240 + ((normalizedRed - normalizedGreen) / chroma) * 60);
}

function circularHueDistance(left: number, right: number): number {
  const distance = Math.abs(left - right);
  return Math.min(distance, 360 - distance);
}

function normalizeHue(value: number): number {
  const normalized = value % 360;
  return normalized >= 0 ? normalized : normalized + 360;
}

function extractTrueColorPrefix(
  value: string,
  label: string
): string | undefined {
  const labelIndex = value.indexOf(label);
  if (labelIndex < 0) {
    return undefined;
  }
  const startIndex = value.lastIndexOf(TRUECOLOR_PREFIX_START, labelIndex);
  if (startIndex < 0) {
    return undefined;
  }
  return value.slice(startIndex, labelIndex);
}
