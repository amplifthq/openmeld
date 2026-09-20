import {
  createSpaceMemberAgentExecutionReadiness,
  createSpaceMemberAgentSnapshot,
  createSpaceMemberHumanSnapshot,
  createSpaceMembersSnapshot,
} from "@openmeld/schemas/testing";
import type { SpaceMemberAgentSnapshot } from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import {
  type PiTuiComposerAutocompleteItem,
  PiTuiComposerAutocompleteProvider,
} from "../src/space/shell/pi-tui/pi-tui-composer-autocomplete-provider";

const HUMAN_FELIX_ID = "11111111-1111-4111-8111-111111111111";
const HUMAN_AMY_ID = "22222222-2222-4222-8222-222222222222";
const HUMAN_ZED_ID = "33333333-3333-4333-8333-333333333333";
const AGENT_OPS_ID = "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AGENT_WATCHER_ID = "agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const AGENT_REVIEWER_ID = "agt_cccccccc-cccc-4ccc-8ccc-cccccccccccc";
describe("PiTuiComposerAutocompleteProvider", () => {
  it("returns slash command suggestions at the start of a message", () => {
    const provider = new PiTuiComposerAutocompleteProvider({
      getMembersSnapshot: () => null,
    });

    expect(provider.getSuggestions(["/sp"], 0, 3)).toEqual({
      items: [
        {
          value: "space",
          label: "/space",
          description: "Show current Space info",
        },
      ],
      prefix: "/sp",
    });
  });

  it("shows target rows first, then opens a relation menu and inserts exact canonical literals", () => {
    const provider = new PiTuiComposerAutocompleteProvider({
      getMembersSnapshot: () =>
        createSnapshot({
          humans: [
            createHumanMember({
              profileId: HUMAN_FELIX_ID,
              profileName: "Felix Space",
            }),
          ],
          agents: [
            createAgentMember({
              agentCanReply: true,
              profileId: AGENT_OPS_ID,
              profileName: "Ops Bot",
              liveNow: true,
            }),
          ],
        }),
    });

    const targetSuggestions = provider.getSuggestions(["@"], 0, 1);
    expect(targetSuggestions).toEqual({
      items: [
        {
          value: "__mention_section__:agent",
          label: "🤖",
          mentionPresentation: "section_header",
          mentionProfileKind: "agent",
        },
        {
          value: "Ops Bot",
          label: "Ops Bot",
          description: "codex · by Felix",
          mentionAllowedRelations: {
            mention: false,
            wake: true,
            reference: true,
          },
          mentionControllerDisplay: "codex",
          mentionAgentControllerRef: "builtin:codex",
          mentionOwnerDisplay: "Felix",
          mentionPresentation: "target_choice",
          mentionProfileId: AGENT_OPS_ID,
          mentionProfileKind: "agent",
          mentionProfileName: "Ops Bot",
          mentionPrimaryLabel: "Ops Bot",
          mentionLabelSource: "profile_name",
          mentionWakeAvailability: {
            status: "ready",
            reasonCodes: ["agent_execution.ready"],
            reasonText: "Available for Wake",
          },
        },
        {
          value: "__mention_spacer__",
          label: "",
          mentionPresentation: "spacer",
        },
        {
          value: "__mention_section__:human",
          label: "👤",
          mentionPresentation: "section_header",
          mentionProfileKind: "human",
        },
        {
          value: "Felix Space",
          label: "Felix Space",
          description: "Felix Space",
          mentionAllowedRelations: {
            mention: true,
            wake: false,
            reference: false,
          },
          mentionControllerDisplay: null,
          mentionAgentControllerRef: null,
          mentionOwnerDisplay: "Felix Space",
          mentionPresentation: "target_choice",
          mentionProfileId: HUMAN_FELIX_ID,
          mentionProfileKind: "human",
          mentionProfileName: "Felix Space",
          mentionPrimaryLabel: "Felix Space",
          mentionLabelSource: "profile_name",
          mentionWakeAvailability: {
            status: "unsupported",
            reasonCodes: [],
            reasonText: null,
          },
        },
      ],
      prefix: "@",
    });

    const targetItem = getMentionAutocompleteItemAt(
      targetSuggestions?.items ?? [],
      1
    );
    expect(provider.enterRelationPicker(targetItem, "@")).toBe(true);

    const relationSuggestions = provider.getSuggestions(["@"], 0, 1);
    expect(relationSuggestions).toEqual({
      items: [
        {
          value: `__mention_relation_header__:${AGENT_OPS_ID}`,
          label: "Ops Bot",
          mentionAllowedRelations: {
            mention: false,
            wake: true,
            reference: true,
          },
          mentionControllerDisplay: "codex",
          mentionAgentControllerRef: "builtin:codex",
          mentionOwnerDisplay: "Felix",
          mentionPresentation: "relation_header",
          mentionProfileId: AGENT_OPS_ID,
          mentionProfileKind: "agent",
          mentionProfileName: "Ops Bot",
          mentionPrimaryLabel: "Ops Bot",
          mentionLabelSource: "profile_name",
          mentionWakeAvailability: {
            status: "ready",
            reasonCodes: ["agent_execution.ready"],
            reasonText: "Available for Wake",
          },
        },
        {
          value: "@Ops Bot",
          label: "Wake",
          description: "Ask this agent to reply.",
          mentionAllowedRelations: {
            mention: false,
            wake: true,
            reference: true,
          },
          mentionControllerDisplay: "codex",
          mentionAgentControllerRef: "builtin:codex",
          mentionOwnerDisplay: "Felix",
          mentionPresentation: "relation_choice",
          mentionProfileId: AGENT_OPS_ID,
          mentionProfileKind: "agent",
          mentionProfileName: "Ops Bot",
          mentionRelation: "wake",
          mentionPrimaryLabel: "Ops Bot",
          mentionLabelSource: "profile_name",
          mentionWakeAvailability: {
            status: "ready",
            reasonCodes: ["agent_execution.ready"],
            reasonText: "Available for Wake",
          },
        },
        {
          value: "@Ops Bot",
          label: "Reference",
          description: "Add context without asking for a reply.",
          mentionAllowedRelations: {
            mention: false,
            wake: true,
            reference: true,
          },
          mentionControllerDisplay: "codex",
          mentionAgentControllerRef: "builtin:codex",
          mentionOwnerDisplay: "Felix",
          mentionPresentation: "relation_choice",
          mentionProfileId: AGENT_OPS_ID,
          mentionProfileKind: "agent",
          mentionProfileName: "Ops Bot",
          mentionRelation: "reference",
          mentionPrimaryLabel: "Ops Bot",
          mentionLabelSource: "profile_name",
          mentionWakeAvailability: {
            status: "ready",
            reasonCodes: ["agent_execution.ready"],
            reasonText: "Available for Wake",
          },
        },
        {
          value: `__mention_back__:${AGENT_OPS_ID}`,
          label: "Back",
          description: "Go back",
          mentionAllowedRelations: {
            mention: false,
            wake: true,
            reference: true,
          },
          mentionControllerDisplay: "codex",
          mentionAgentControllerRef: "builtin:codex",
          mentionOwnerDisplay: "Felix",
          mentionPresentation: "back_choice",
          mentionProfileId: AGENT_OPS_ID,
          mentionProfileKind: "agent",
          mentionProfileName: "Ops Bot",
          mentionPrimaryLabel: "Ops Bot",
          mentionLabelSource: "profile_name",
          mentionWakeAvailability: {
            status: "ready",
            reasonCodes: ["agent_execution.ready"],
            reasonText: "Available for Wake",
          },
        },
      ],
      prefix: "@",
    });

    const referenceItem = getMentionAutocompleteItemAt(
      relationSuggestions?.items ?? [],
      2
    );
    expect(
      provider.applyCompletion(["hello @"], 0, 7, referenceItem, "@")
    ).toEqual({
      lines: ["hello @Ops Bot "],
      cursorLine: 0,
      cursorCol: "hello ".length + "@Ops Bot".length + 1,
    });
  });

  it("shows duplicate profile names once each and surfaces exact insertion names in descriptions", () => {
    const provider = new PiTuiComposerAutocompleteProvider({
      getMembersSnapshot: () =>
        createSnapshot({
          agents: [
            createAgentMember({
              agentCanReply: true,
              profileId: AGENT_OPS_ID,
              profileName: "Ops Bot",
              mentionAlias: "ops_alpha",
            }),
            createAgentMember({
              agentCanReply: true,
              profileId: AGENT_WATCHER_ID,
              profileName: "Ops Bot",
              mentionAlias: "ops_bravo",
            }),
          ],
        }),
    });

    const suggestions = provider.getSuggestions(["hello @ops"], 0, 10);
    expect(suggestions).toEqual({
      items: [
        {
          value: "__mention_section__:agent",
          label: "🤖",
          mentionPresentation: "section_header",
          mentionProfileKind: "agent",
        },
        expect.objectContaining({
          label: "Ops Bot",
          mentionPresentation: "target_choice",
          mentionProfileId: AGENT_OPS_ID,
          mentionPrimaryLabel: "ops_alpha",
          description: "Use @ops_alpha · codex · by Felix",
        }),
        expect.objectContaining({
          label: "Ops Bot",
          mentionPresentation: "target_choice",
          mentionProfileId: AGENT_WATCHER_ID,
          mentionPrimaryLabel: "ops_bravo",
          description: "Use @ops_bravo · codex · by Felix",
        }),
      ],
      prefix: "@ops",
    });

    const firstTarget = getMentionAutocompleteItemAt(
      suggestions?.items ?? [],
      1
    );
    expect(provider.enterRelationPicker(firstTarget, "@ops")).toBe(true);
    const relationSuggestions = provider.getSuggestions(["hello @ops"], 0, 10);
    expect(relationSuggestions?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Wake",
          description: "Ask this agent to reply.",
          mentionPresentation: "relation_choice",
        }),
      ])
    );
  });

  it("supports canonical-name filtering with spaces and stops once parentheses begin", () => {
    const provider = new PiTuiComposerAutocompleteProvider({
      getMembersSnapshot: () =>
        createSnapshot({
          agents: [
            createAgentMember({
              profileId: AGENT_OPS_ID,
              profileName: "Ops Bot",
              wakeabilityStatus: "blocked",
            }),
          ],
        }),
    });

    expect(provider.getSuggestions(["hello @Ops B"], 0, 12)).toEqual({
      items: [
        {
          value: "__mention_section__:agent",
          label: "🤖",
          mentionPresentation: "section_header",
          mentionProfileKind: "agent",
        },
        expect.objectContaining({
          label: "Ops Bot",
          mentionPresentation: "target_choice",
        }),
      ],
      prefix: "@Ops B",
    });

    expect(provider.getSuggestions(["hello @Ops Bot("], 0, 15)).toBeNull();
  });

  it("keeps blocked agent targets visible and includes wake relations", () => {
    const provider = new PiTuiComposerAutocompleteProvider({
      getMembersSnapshot: () =>
        createSnapshot({
          agents: [
            createAgentMember({
              profileId: AGENT_OPS_ID,
              profileName: "Ops Bot",
              wakeabilityStatus: "blocked",
            }),
          ],
        }),
    });

    const suggestions = provider.getSuggestions(["@"], 0, 1);
    expect(suggestions?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          mentionPresentation: "target_choice",
          mentionProfileId: AGENT_OPS_ID,
          description: expect.stringContaining("Unavailable now:"),
        }),
      ])
    );

    const targetItem = getMentionAutocompleteItemAt(
      suggestions?.items ?? [],
      1
    );
    expect(provider.enterRelationPicker(targetItem, "@")).toBe(true);

    const relationSuggestions = provider.getSuggestions(["@"], 0, 1);
    expect(relationSuggestions?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          mentionPresentation: "relation_choice",
          mentionRelation: "wake",
        }),
        expect.objectContaining({
          mentionPresentation: "relation_choice",
          mentionRelation: "reference",
        }),
      ])
    );
  });

  it("shows distinct descriptions for different public unavailable reasons", () => {
    const provider = new PiTuiComposerAutocompleteProvider({
      getMembersSnapshot: () =>
        createSnapshot({
          agents: [
            createAgentMember({
              agentWakeAvailability: createUnavailableAgentWakeAvailability({
                reasonCode: "agent_profile.organization_mismatch",
                summary: "This Agent Profile belongs to another workspace.",
                tooltip: "Wrong workspace",
              }),
              profileId: AGENT_OPS_ID,
              profileName: "Organization Agent",
            }),
            createAgentMember({
              agentWakeAvailability: createUnavailableAgentWakeAvailability({
                reasonCode: "provider_account.access_required",
                summary: "Fix provider access before this agent can reply.",
                tooltip: "Provider access needed",
              }),
              profileId: AGENT_WATCHER_ID,
              profileName: "Account Agent",
            }),
            createAgentMember({
              agentWakeAvailability: createUnavailableAgentWakeAvailability({
                reasonCode: "agent_profile_binding.missing",
                summary: "Connect a local agent before this profile can reply.",
                tooltip: "Connect local agent",
              }),
              profileId: AGENT_REVIEWER_ID,
              profileName: "Disconnected Agent",
            }),
          ],
        }),
    });

    const targetItems = toMentionAutocompleteItems(
      provider.getSuggestions(["@"], 0, 1)?.items ?? []
    ).filter((item) => item.mentionPresentation === "target_choice");

    expect(
      targetItems.map(({ description, mentionProfileName }) => ({
        description,
        profileName: mentionProfileName,
      }))
    ).toEqual([
      {
        description:
          "codex · by Felix · Unavailable now: Fix provider access before this agent can reply",
        profileName: "Account Agent",
      },
      {
        description:
          "codex · by Felix · Unavailable now: Connect a local agent before this profile can reply",
        profileName: "Disconnected Agent",
      },
      {
        description:
          "codex · by Felix · Unavailable now: This Agent Profile belongs to another workspace",
        profileName: "Organization Agent",
      },
    ]);
  });

  it("uses recent mention state to reorder members inside each section", () => {
    const provider = new PiTuiComposerAutocompleteProvider({
      getMembersSnapshot: () =>
        createSnapshot({
          humans: [
            createHumanMember({
              profileId: HUMAN_AMY_ID,
              profileName: "Amy",
            }),
            createHumanMember({
              profileId: HUMAN_ZED_ID,
              profileName: "Zed",
            }),
          ],
          agents: [
            createAgentMember({
              profileId: AGENT_OPS_ID,
              profileName: "Ops Bot",
            }),
            createAgentMember({
              profileId: AGENT_WATCHER_ID,
              profileName: "Watcher",
            }),
          ],
        }),
      getRecentMentionProfileIds: () => [HUMAN_ZED_ID, AGENT_WATCHER_ID],
    });

    const suggestions = provider.getSuggestions(["@"], 0, 1);
    expect(suggestions?.prefix).toBe("@");
    const suggestionItems = toMentionAutocompleteItems(
      suggestions?.items ?? []
    );

    expect(listMentionTargetLabels(suggestionItems)).toEqual([
      "Watcher",
      "Ops Bot",
      "Zed",
      "Amy",
    ]);
  });

  it("restores the previously selected target when returning from the relation menu", () => {
    const provider = new PiTuiComposerAutocompleteProvider({
      getMembersSnapshot: () =>
        createSnapshot({
          agents: [
            createAgentMember({
              profileId: AGENT_OPS_ID,
              profileName: "Ops Bot",
            }),
            createAgentMember({
              profileId: AGENT_WATCHER_ID,
              profileName: "Watcher",
            }),
          ],
        }),
    });

    const targetSuggestions = provider.getSuggestions(["@"], 0, 1);
    const watcherTarget = getMentionAutocompleteItemAt(
      targetSuggestions?.items ?? [],
      2
    );
    expect(provider.enterRelationPicker(watcherTarget, "@")).toBe(true);
    expect(provider.returnToTargetPicker()).toBe(true);

    const nextSuggestions = provider.getSuggestions(["@"], 0, 1);
    const setSelectedIndex = vi.fn();
    provider.syncAutocompleteSelection({
      items: toMentionAutocompleteItems(nextSuggestions?.items ?? []),
      setSelectedIndex,
    });

    expect(setSelectedIndex).toHaveBeenCalledWith(2);
  });

  it("resets relation-menu focus to the first available relation when opening a later target", () => {
    const provider = new PiTuiComposerAutocompleteProvider({
      getMembersSnapshot: () =>
        createSnapshot({
          agents: [
            createAgentMember({
              profileId: AGENT_OPS_ID,
              profileName: "Ops Bot",
            }),
            createAgentMember({
              profileId: AGENT_WATCHER_ID,
              profileName: "Watcher",
            }),
          ],
        }),
    });

    const targetSuggestions = provider.getSuggestions(["@"], 0, 1);
    const watcherTarget = getMentionAutocompleteItemAt(
      targetSuggestions?.items ?? [],
      2
    );
    expect(provider.enterRelationPicker(watcherTarget, "@")).toBe(true);

    const relationSuggestions = provider.getSuggestions(["@"], 0, 1);
    const setSelectedIndex = vi.fn();
    provider.syncAutocompleteSelection({
      items: toMentionAutocompleteItems(relationSuggestions?.items ?? []),
      setSelectedIndex,
    });

    expect(setSelectedIndex).toHaveBeenCalledWith(1);
  });
});

function listMentionTargetLabels(
  items: readonly PiTuiComposerAutocompleteItem[]
): string[] {
  return items
    .filter((item) => item.mentionPresentation === "target_choice")
    .map((item) => item.label);
}

function toMentionAutocompleteItems(
  items: readonly PiTuiComposerAutocompleteItem[] | readonly unknown[]
): PiTuiComposerAutocompleteItem[] {
  return [...items] as PiTuiComposerAutocompleteItem[];
}

function getMentionAutocompleteItemAt(
  items: readonly PiTuiComposerAutocompleteItem[] | readonly unknown[],
  index: number
): PiTuiComposerAutocompleteItem {
  const item = toMentionAutocompleteItems(items)[index];
  if (!item) {
    throw new Error(`Expected mention autocomplete item at index ${index}`);
  }

  return item;
}

function createSnapshot(input: {
  humans?: ReturnType<typeof createHumanMember>[];
  agents?: ReturnType<typeof createAgentMember>[];
}) {
  return createSpaceMembersSnapshot({
    agents: input.agents,
    generatedAt: "2026-03-13T00:00:00.000Z",
    humans: input.humans,
    spaceId: "space-1",
  });
}

function createHumanMember(input: {
  profileId: string;
  profileName: string;
  mentionAlias?: string | null;
  liveNow?: boolean;
}) {
  return createSpaceMemberHumanSnapshot({
    addedAt: "2026-03-13T00:00:00.000Z",
    createdAt: "2026-03-13T00:00:00.000Z",
    firstEnteredAt: "2026-03-13T00:00:00.000Z",
    lastEnteredAt: "2026-03-13T00:00:00.000Z",
    lastSeenAt: "2026-03-13T00:00:00.000Z",
    lastSeenLabel: "Seen now",
    liveNow: input.liveNow ?? true,
    mentionAlias: input.mentionAlias ?? null,
    ownerName: input.profileName,
    ownerUserId: null,
    profileId: input.profileId,
    profileName: input.profileName,
    updatedAt: "2026-03-13T00:00:00.000Z",
  });
}

function createAgentMember(input: {
  agentCanReply?: boolean;
  agentWakeAvailability?: SpaceMemberAgentSnapshot["agentWakeAvailability"];
  profileId: string;
  profileName: string;
  mentionAlias?: string | null;
  wakeabilityStatus?: "ready" | "blocked";
  liveNow?: boolean;
}) {
  return createSpaceMemberAgentSnapshot({
    addedAt: "2026-03-13T00:00:00.000Z",
    addedByDisplayName: "Felix",
    addedByOwnerUserId: "user_felix",
    addedByProfileId: HUMAN_FELIX_ID,
    agentExecutionReadiness: input.agentCanReply
      ? createSpaceMemberAgentExecutionReadiness({
          agentProfileId: input.profileId,
          displayState: "ready",
          reasonCodes: [],
        })
      : undefined,
    agentWakeAvailability: input.agentWakeAvailability,
    createdAt: "2026-03-13T00:00:00.000Z",
    firstEnteredAt: "2026-03-13T00:00:00.000Z",
    lastEnteredAt: "2026-03-13T00:00:00.000Z",
    lastSeenAt: "2026-03-13T00:00:00.000Z",
    lastSeenLabel: "Seen now",
    liveNow: input.liveNow ?? false,
    mentionAlias: input.mentionAlias ?? null,
    ownerName: "Felix",
    ownerUserId: "user_felix",
    profileId: input.profileId,
    profileName: input.profileName,
    updatedAt: "2026-03-13T00:00:00.000Z",
    wakeabilityReasonCodes:
      input.wakeabilityStatus === "blocked"
        ? ["controller.binding.disabled"]
        : undefined,
    wakeabilityReasonText:
      input.wakeabilityStatus === "blocked"
        ? "Controller binding is disabled for this device"
        : undefined,
    wakeabilityStatus: input.wakeabilityStatus,
  });
}

function createUnavailableAgentWakeAvailability(input: {
  reasonCode: string;
  summary: string;
  tooltip: string;
}): NonNullable<SpaceMemberAgentSnapshot["agentWakeAvailability"]> {
  return {
    action: "reconnect_binding",
    badgeLabel: "Unavailable",
    category: "unavailable",
    isRefreshing: false,
    label: "Unavailable for Wake",
    phase: "unavailable",
    reasonCode: input.reasonCode,
    status: "unavailable_for_wake",
    summary: input.summary,
    tooltip: input.tooltip,
  };
}
