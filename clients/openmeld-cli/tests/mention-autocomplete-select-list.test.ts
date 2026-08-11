import { SelectList } from "@mariozechner/pi-tui";
import pc from "picocolors";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decorateMentionAutocompleteSelectList } from "../src/space/shell/pi-tui/mention-autocomplete-select-list";
import type { PiTuiComposerAutocompleteItem } from "../src/space/shell/pi-tui/pi-tui-composer-autocomplete-provider";

const ARROW_DOWN = "\u001B[B";
const ARROW_UP = "\u001B[A";
const ENTER = "\r";
const TRUECOLOR_PREFIX_START = "\u001B[38;2;";
const originalColorSupport = pc.isColorSupported;

const selectListTheme = {
  description: (text: string) => text,
  noMatch: (text: string) => text,
  scrollInfo: (text: string) => text,
  selectedPrefix: (text: string) => text,
  selectedText: (text: string) => text,
};

beforeEach(() => {
  Object.defineProperty(pc, "isColorSupported", {
    value: true,
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  Object.defineProperty(pc, "isColorSupported", {
    value: originalColorSupport,
    configurable: true,
    writable: true,
  });
});

describe("decorateMentionAutocompleteSelectList", () => {
  it("renders target rows without @ or relation suffixes and keeps section grouping", () => {
    const list = createMentionSelectList([
      createSectionHeader("agent"),
      createTargetItem({
        description: "codex · by OpenMeld Dev Local Test",
        profileKind: "agent",
        value: "hi-agent",
        label: "hi-agent",
      }),
      createSpacerItem(),
      createSectionHeader("human"),
      createTargetItem({
        description: "OpenMeld Dev Local Test",
        profileKind: "human",
        value: "openmeld-dev-local-test",
        label: "OpenMeld Dev Local Test",
      }),
    ]);

    decorateMentionAutocompleteSelectList(list as never);

    expect(list.render(120)).toEqual([
      "  🤖",
      "→ hi-agent                        codex · by OpenMeld Dev Local Test",
      "",
      "  👤",
      "  OpenMeld Dev Local Test         OpenMeld Dev Local Test",
    ]);
  });

  it("renders a relation menu with a target header, relation rows, and a back row", () => {
    const list = createMentionSelectList([
      createRelationHeader("Phase 2a Agent"),
      createRelationChoice({
        description: "Ask this agent to reply.",
        label: "Wake",
        profileKind: "agent",
        value: "@Phase 2a Agent(wake)",
      }),
      createRelationChoice({
        description: "Add context without asking for a reply.",
        label: "Reference",
        profileKind: "agent",
        value: "@Phase 2a Agent(reference)",
      }),
      createBackChoice(),
    ]);

    decorateMentionAutocompleteSelectList(list as never);

    expect(list.render(120)).toEqual([
      "  Phase 2a Agent",
      "→ Wake                            Ask this agent to reply.",
      "  Reference                       Add context without asking for a reply.",
      "  Back                            Go back",
    ]);
  });

  it("skips headers and spacer rows during keyboard navigation and confirmation", () => {
    const list = createMentionSelectList([
      createSectionHeader("agent"),
      createTargetItem({
        description: "codex · by OpenMeld Dev Local Test",
        profileKind: "agent",
        value: "hi-agent",
        label: "hi-agent",
      }),
      createTargetItem({
        description: "claude-code · by OpenMeld Dev Local Test",
        profileKind: "agent",
        value: "ops-agent",
        label: "ops-agent",
      }),
      createSpacerItem(),
      createSectionHeader("human"),
      createTargetItem({
        description: "OpenMeld Dev Local Test",
        profileKind: "human",
        value: "openmeld-dev-local-test",
        label: "OpenMeld Dev Local Test",
      }),
    ]);
    const onSelect = vi.fn();

    list.onSelect = onSelect;
    decorateMentionAutocompleteSelectList(list as never);

    expect(list.getSelectedItem()?.value).toBe("hi-agent");

    list.handleInput(ARROW_DOWN);
    expect(list.getSelectedItem()?.value).toBe("ops-agent");

    list.handleInput(ARROW_DOWN);
    expect(list.getSelectedItem()?.value).toBe("openmeld-dev-local-test");

    list.handleInput(ARROW_UP);
    expect(list.getSelectedItem()?.value).toBe("ops-agent");

    list.handleInput(ENTER);
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ value: "ops-agent" })
    );
  });

  it("colorizes unselected agent target labels and controller text from the controller identity", () => {
    const list = createMentionSelectList([
      createSectionHeader("agent"),
      createTargetItem({
        controllerDisplay: "codex",
        agentControllerRef: "builtin:codex",
        description: "codex · by OpenMeld Dev Local Test",
        label: "example-agent",
        profileId: "agt_selected",
        profileKind: "agent",
        profileName: "example-agent",
        value: "example-agent",
      }),
      createTargetItem({
        controllerDisplay: "claude-code",
        agentControllerRef: "builtin:claude-code",
        description: "claude-code · by OpenMeld Dev Local Test",
        label: "hi-agent",
        profileId: "agt_hi",
        profileKind: "agent",
        profileName: "hi-agent",
        value: "hi-agent",
      }),
    ]);

    decorateMentionAutocompleteSelectList(list as never);

    const renderedLine = list.render(80)[2] ?? "";
    expect(renderedLine).toContain("\u001B[38;2;217;119;87mhi-agent");
    expect(renderedLine).toContain("\u001B[38;2;217;119;87mclaude-code");
    expect(renderedLine).toContain("by OpenMeld Dev Local Test");
    expect(renderedLine).not.toContain(
      "\u001B[38;2;217;119;87mby OpenMeld Dev Local Test"
    );
  });

  it("keeps relation rows plain even when they belong to an agent target", () => {
    const list = createMentionSelectList([
      createRelationHeader("hi-agent"),
      createRelationChoice({
        description: "Ask this agent to reply.",
        label: "Wake",
        profileKind: "agent",
        value: "@hi-agent(wake)",
      }),
    ]);

    decorateMentionAutocompleteSelectList(list as never);

    const renderedLine = list.render(80)[1] ?? "";
    expect(renderedLine).toContain("Wake");
    expect(renderedLine).not.toContain(TRUECOLOR_PREFIX_START);
  });
});

function createMentionSelectList(
  items: PiTuiComposerAutocompleteItem[],
  theme = selectListTheme
) {
  return new SelectList(items, 6, theme);
}

function createTargetItem(input: {
  controllerDisplay?: string | null;
  agentControllerRef?: string | null;
  description: string;
  label: string;
  profileId?: string;
  profileKind: "human" | "agent";
  profileName?: string;
  value: string;
}): PiTuiComposerAutocompleteItem {
  return {
    value: input.value,
    label: input.label,
    description: input.description,
    mentionControllerDisplay: input.controllerDisplay,
    mentionAgentControllerRef: input.agentControllerRef,
    mentionPresentation: "target_choice",
    mentionProfileId: input.profileId,
    mentionProfileKind: input.profileKind,
    mentionProfileName: input.profileName,
  };
}

function createRelationChoice(input: {
  description: string;
  label: string;
  profileKind: "human" | "agent";
  value: string;
}): PiTuiComposerAutocompleteItem {
  return {
    value: input.value,
    label: input.label,
    description: input.description,
    mentionPresentation: "relation_choice",
    mentionProfileKind: input.profileKind,
  };
}

function createBackChoice(): PiTuiComposerAutocompleteItem {
  return {
    value: "__mention_back__:agt_hi",
    label: "Back",
    description: "Go back",
    mentionPresentation: "back_choice",
    mentionProfileKind: "agent",
  };
}

function createSectionHeader(
  profileKind: "human" | "agent"
): PiTuiComposerAutocompleteItem {
  return {
    value: `__mention_section__:${profileKind}`,
    label: profileKind === "human" ? "👤" : "🤖",
    mentionPresentation: "section_header",
    mentionProfileKind: profileKind,
  };
}

function createRelationHeader(label: string): PiTuiComposerAutocompleteItem {
  return {
    value: "__mention_relation_header__:agt_hi",
    label,
    mentionPresentation: "relation_header",
    mentionProfileKind: "agent",
  };
}

function createSpacerItem(): PiTuiComposerAutocompleteItem {
  return {
    value: "__mention_spacer__",
    label: "",
    mentionPresentation: "spacer",
  };
}
