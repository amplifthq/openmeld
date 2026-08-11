import type {
  AutocompleteItem,
  AutocompleteProvider,
} from "@mariozechner/pi-tui";
import type { MessageMentionType } from "@openmeld/schemas";
import type { SpaceMembersSnapshot } from "@openmeld/schemas/types";
import type {
  MentionPickerState,
  MentionPickerTarget,
  SpaceMentionSuggestion,
  SpaceSendTargetAllowedRelations,
  SpaceSendTargetProjectionEntry,
  SpaceSendTargetWakeAvailability,
} from "@openmeld/space";
import {
  closeMentionPickerState,
  enterRelationPickerState,
  extractMentionAuthoringPrefix,
  isRelationPickerState,
  isTargetPickerState,
  listSpaceMentionRelationChoices,
  listSpaceMentionSuggestions,
  openTargetPickerState,
  returnToTargetPickerState,
} from "@openmeld/space";
import { listSpaceSlashCommands } from "../../composer/slash-command-registry";

const MENTION_SECTION_ITEM_VALUE = "__mention_section__";
const MENTION_SPACER_ITEM_VALUE = "__mention_spacer__";
const MENTION_RELATION_HEADER_ITEM_VALUE = "__mention_relation_header__";
const MENTION_BACK_ITEM_VALUE = "__mention_back__";

export type PiTuiMentionAutocompleteItemPresentation =
  | "back_choice"
  | "relation_choice"
  | "relation_header"
  | "section_header"
  | "spacer"
  | "target_choice";

export type PiTuiComposerAutocompleteItem = AutocompleteItem & {
  mentionAllowedRelations?: SpaceSendTargetAllowedRelations;
  mentionControllerDisplay?: string | null;
  mentionAgentControllerRef?: string | null;
  mentionOwnerDisplay?: string | null;
  mentionPresentation?: PiTuiMentionAutocompleteItemPresentation;
  mentionProfileId?: string;
  mentionProfileKind?: "human" | "agent";
  mentionProfileName?: string;
  mentionRelation?: MessageMentionType;
  mentionPrimaryLabel?: string;
  mentionLabelSource?: SpaceSendTargetProjectionEntry["labelSource"];
  mentionWakeAvailability?: SpaceSendTargetWakeAvailability;
};

export class PiTuiComposerAutocompleteProvider implements AutocompleteProvider {
  readonly #getMembersSnapshot: () => SpaceMembersSnapshot | null;
  readonly #getRecentMentionProfileIds: () => readonly string[];

  #mentionPickerState: MentionPickerState = closeMentionPickerState();
  #resetRelationSelectionOnNextSync = false;

  constructor(input: {
    getMembersSnapshot: () => SpaceMembersSnapshot | null;
    getRecentMentionProfileIds?: () => readonly string[];
  }) {
    this.#getMembersSnapshot = input.getMembersSnapshot;
    this.#getRecentMentionProfileIds =
      input.getRecentMentionProfileIds ?? (() => []);
  }

  getSuggestions(lines: string[], cursorLine: number, cursorCol: number) {
    const currentLine = lines[cursorLine] ?? "";
    const textBeforeCursor = currentLine.slice(0, cursorCol);

    const slashSuggestions = this.#getSlashSuggestions(textBeforeCursor);
    if (slashSuggestions) {
      return slashSuggestions;
    }

    const mentionSuggestions = this.#getMentionSuggestions(textBeforeCursor);
    if (mentionSuggestions) {
      return mentionSuggestions;
    }

    return null;
  }

  applyCompletion(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    item: AutocompleteItem,
    prefix: string
  ) {
    if (prefix.startsWith("/")) {
      const currentLine = lines[cursorLine] ?? "";
      const beforePrefix = currentLine.slice(0, cursorCol - prefix.length);
      const afterCursor = currentLine.slice(cursorCol);
      const nextLines = [...lines];

      nextLines[cursorLine] = `${beforePrefix}/${item.value} ${afterCursor}`;
      return {
        lines: nextLines,
        cursorLine,
        cursorCol: beforePrefix.length + item.value.length + 2,
      };
    }

    const mentionItem = asMentionAutocompleteItem(item);
    if (
      !(mentionItem && isSelectableMentionAutocompleteItem(mentionItem)) ||
      mentionItem.mentionPresentation !== "relation_choice"
    ) {
      return {
        lines: [...lines],
        cursorLine,
        cursorCol,
      };
    }

    const currentLine = lines[cursorLine] ?? "";
    const beforePrefix = currentLine.slice(0, cursorCol - prefix.length);
    const afterCursor = currentLine.slice(cursorCol);
    const nextLines = [...lines];

    this.resetMentionPicker();
    nextLines[cursorLine] =
      `${beforePrefix}${mentionItem.value} ${afterCursor}`;
    return {
      lines: nextLines,
      cursorLine,
      cursorCol: beforePrefix.length + mentionItem.value.length + 1,
    };
  }

  enterRelationPicker(item: AutocompleteItem, prefix: string): boolean {
    const mentionItem = asMentionAutocompleteItem(item);
    if (
      mentionItem?.mentionPresentation !== "target_choice" ||
      !prefix.startsWith("@")
    ) {
      return false;
    }

    const target = buildMentionPickerTargetFromItem(mentionItem);
    if (!target) {
      return false;
    }

    this.#mentionPickerState = enterRelationPickerState({
      query: prefix,
      target,
    });
    this.#resetRelationSelectionOnNextSync = true;
    return true;
  }

  isRelationPickerOpen(): boolean {
    return isRelationPickerState(this.#mentionPickerState);
  }

  prepareForEditableInput(): boolean {
    return this.returnToTargetPicker();
  }

  resetMentionPicker(): void {
    this.#mentionPickerState = closeMentionPickerState();
    this.#resetRelationSelectionOnNextSync = false;
  }

  returnToTargetPicker(): boolean {
    if (!isRelationPickerState(this.#mentionPickerState)) {
      return false;
    }

    this.#mentionPickerState = returnToTargetPickerState(
      this.#mentionPickerState
    );
    this.#resetRelationSelectionOnNextSync = false;
    return true;
  }

  syncAutocompleteSelection(input: {
    items: readonly PiTuiComposerAutocompleteItem[];
    setSelectedIndex: (index: number) => void;
  }): void {
    if (
      isRelationPickerState(this.#mentionPickerState) &&
      this.#resetRelationSelectionOnNextSync
    ) {
      const firstRelationIndex = input.items.findIndex(
        (item) => item.mentionPresentation === "relation_choice"
      );
      if (firstRelationIndex >= 0) {
        input.setSelectedIndex(firstRelationIndex);
      }
      this.#resetRelationSelectionOnNextSync = false;
      return;
    }

    if (!isTargetPickerState(this.#mentionPickerState)) {
      return;
    }

    const selectedProfileId = this.#mentionPickerState.selectedProfileId;
    if (!selectedProfileId) {
      return;
    }

    const selectedIndex = input.items.findIndex(
      (item) =>
        item.mentionPresentation === "target_choice" &&
        item.mentionProfileId === selectedProfileId
    );
    if (selectedIndex >= 0) {
      input.setSelectedIndex(selectedIndex);
    }
  }

  #getSlashSuggestions(textBeforeCursor: string): {
    items: AutocompleteItem[];
    prefix: string;
  } | null {
    if (!textBeforeCursor.startsWith("/")) {
      return null;
    }
    if (textBeforeCursor.includes(" ")) {
      return null;
    }
    const query = textBeforeCursor.slice(1).trim().toLowerCase();
    const items = listSpaceSlashCommands()
      .filter((command) =>
        query ? command.name.toLowerCase().startsWith(query) : true
      )
      .map((command) => ({
        value: command.name,
        label: command.trigger,
        description: command.description,
      }));
    if (items.length === 0) {
      return null;
    }
    return {
      items,
      prefix: textBeforeCursor,
    };
  }

  #getMentionSuggestions(textBeforeCursor: string): {
    items: PiTuiComposerAutocompleteItem[];
    prefix: string;
  } | null {
    const prefix = extractMentionAuthoringPrefix(textBeforeCursor);
    if (!prefix) {
      this.resetMentionPicker();
      return null;
    }

    if (
      isRelationPickerState(this.#mentionPickerState) &&
      this.#mentionPickerState.query === prefix
    ) {
      return {
        items: buildRelationPickerItems(this.#mentionPickerState.target),
        prefix,
      };
    }

    const suggestions = listSpaceMentionSuggestions({
      query: prefix,
      snapshot: this.#getMembersSnapshot(),
      recentProfileIds: this.#getRecentMentionProfileIds(),
    });
    const selectedProfileId = resolveSelectedProfileId(
      this.#mentionPickerState
    );
    this.#mentionPickerState = openTargetPickerState({
      query: prefix,
      selectedProfileId,
    });

    const items = buildGroupedTargetAutocompleteItems(suggestions);
    if (items.length === 0) {
      return null;
    }

    return {
      items,
      prefix,
    };
  }
}

export function isSelectableMentionAutocompleteItem(
  item: AutocompleteItem
): boolean {
  return (
    !("mentionPresentation" in item) ||
    item.mentionPresentation === undefined ||
    item.mentionPresentation === "back_choice" ||
    item.mentionPresentation === "relation_choice" ||
    item.mentionPresentation === "target_choice"
  );
}

function asMentionAutocompleteItem(
  item: AutocompleteItem
): PiTuiComposerAutocompleteItem | null {
  return item as PiTuiComposerAutocompleteItem | null;
}

function resolveSelectedProfileId(state: MentionPickerState): string | null {
  if (isRelationPickerState(state)) {
    return state.target.profileId;
  }

  if (isTargetPickerState(state)) {
    return state.selectedProfileId;
  }

  return null;
}

function buildGroupedTargetAutocompleteItems(
  suggestions: SpaceMentionSuggestion[]
): PiTuiComposerAutocompleteItem[] {
  const agentItems = suggestions
    .filter((suggestion) => suggestion.profileKind === "agent")
    .map((suggestion) => buildTargetItem(suggestion));
  const humanItems = suggestions
    .filter((suggestion) => suggestion.profileKind === "human")
    .map((suggestion) => buildTargetItem(suggestion));
  const items: PiTuiComposerAutocompleteItem[] = [];

  if (agentItems.length > 0) {
    items.push(buildSectionHeaderItem("agent"));
    items.push(...agentItems);
  }

  if (humanItems.length > 0 && agentItems.length > 0) {
    items.push(buildSpacerItem());
  }

  if (humanItems.length > 0) {
    items.push(buildSectionHeaderItem("human"));
    items.push(...humanItems);
  }

  return items;
}

function buildTargetItem(
  suggestion: SpaceMentionSuggestion
): PiTuiComposerAutocompleteItem {
  return {
    value: suggestion.primaryMentionLabel,
    label: suggestion.profileName,
    description: buildTargetChoiceDescription(suggestion),
    mentionAllowedRelations: suggestion.allowedRelations,
    mentionControllerDisplay: suggestion.controllerDisplay,
    mentionAgentControllerRef: suggestion.agentControllerRef,
    mentionOwnerDisplay: suggestion.ownerDisplay,
    mentionPresentation: "target_choice",
    mentionProfileId: suggestion.profileId,
    mentionProfileKind: suggestion.profileKind,
    mentionProfileName: suggestion.profileName,
    mentionPrimaryLabel: suggestion.primaryMentionLabel,
    mentionLabelSource: suggestion.labelSource,
    mentionWakeAvailability: suggestion.wakeAvailability,
  };
}

function buildTargetChoiceDescription(
  suggestion: SpaceMentionSuggestion
): string {
  const baseDescription = suggestion.description.trim();
  if (suggestion.primaryMentionLabel === suggestion.profileName) {
    return baseDescription;
  }

  return [
    `Use @${suggestion.primaryMentionLabel}`,
    baseDescription.length > 0 ? baseDescription : null,
  ]
    .filter((segment): segment is string => Boolean(segment))
    .join(" · ");
}

function buildRelationPickerItems(
  target: MentionPickerTarget
): PiTuiComposerAutocompleteItem[] {
  const items: PiTuiComposerAutocompleteItem[] = [
    {
      value: `${MENTION_RELATION_HEADER_ITEM_VALUE}:${target.profileId}`,
      label: target.profileName,
      mentionAllowedRelations: target.allowedRelations,
      mentionControllerDisplay: target.controllerDisplay,
      mentionAgentControllerRef: target.agentControllerRef,
      mentionOwnerDisplay: target.ownerDisplay,
      mentionPresentation: "relation_header",
      mentionProfileId: target.profileId,
      mentionProfileKind: target.profileKind,
      mentionProfileName: target.profileName,
      mentionPrimaryLabel: target.primaryMentionLabel,
      mentionLabelSource: target.labelSource,
      mentionWakeAvailability: target.wakeAvailability,
    },
  ];

  for (const relationChoice of listSpaceMentionRelationChoices(target)) {
    items.push({
      value: relationChoice.canonicalLiteral,
      label: relationChoice.label,
      description: relationChoice.description,
      mentionAllowedRelations: target.allowedRelations,
      mentionControllerDisplay: target.controllerDisplay,
      mentionAgentControllerRef: target.agentControllerRef,
      mentionOwnerDisplay: target.ownerDisplay,
      mentionPresentation: "relation_choice",
      mentionProfileId: target.profileId,
      mentionProfileKind: target.profileKind,
      mentionProfileName: target.profileName,
      mentionRelation: relationChoice.relation,
      mentionPrimaryLabel: target.primaryMentionLabel,
      mentionLabelSource: target.labelSource,
      mentionWakeAvailability: target.wakeAvailability,
    });
  }

  items.push({
    value: `${MENTION_BACK_ITEM_VALUE}:${target.profileId}`,
    label: "Back",
    description: "Go back",
    mentionAllowedRelations: target.allowedRelations,
    mentionControllerDisplay: target.controllerDisplay,
    mentionAgentControllerRef: target.agentControllerRef,
    mentionOwnerDisplay: target.ownerDisplay,
    mentionPresentation: "back_choice",
    mentionProfileId: target.profileId,
    mentionProfileKind: target.profileKind,
    mentionProfileName: target.profileName,
    mentionPrimaryLabel: target.primaryMentionLabel,
    mentionLabelSource: target.labelSource,
    mentionWakeAvailability: target.wakeAvailability,
  });

  return items;
}

function buildMentionPickerTargetFromItem(
  item: PiTuiComposerAutocompleteItem
): MentionPickerTarget | null {
  const allowedRelations = item.mentionAllowedRelations;
  const profileId = item.mentionProfileId;
  const profileKind = item.mentionProfileKind;
  const profileName = item.mentionProfileName;

  if (!(allowedRelations && profileId && profileKind && profileName)) {
    return null;
  }

  const primaryMentionLabel = item.mentionPrimaryLabel;
  const labelSource = item.mentionLabelSource;
  const wakeAvailability = item.mentionWakeAvailability;
  if (!(primaryMentionLabel && labelSource && wakeAvailability)) {
    return null;
  }

  return {
    allowedRelations,
    controllerDisplay: item.mentionControllerDisplay ?? null,
    agentControllerRef: item.mentionAgentControllerRef ?? null,
    description: item.description ?? "",
    ownerDisplay: item.mentionOwnerDisplay ?? null,
    profileId,
    profileKind,
    profileName,
    labelSource,
    primaryMentionLabel,
    wakeAvailability,
  };
}

function buildSectionHeaderItem(
  profileKind: "human" | "agent"
): PiTuiComposerAutocompleteItem {
  return {
    value: `${MENTION_SECTION_ITEM_VALUE}:${profileKind}`,
    label: profileKind === "human" ? "👤" : "🤖",
    mentionPresentation: "section_header",
    mentionProfileKind: profileKind,
  };
}

function buildSpacerItem(): PiTuiComposerAutocompleteItem {
  return {
    value: MENTION_SPACER_ITEM_VALUE,
    label: "",
    mentionPresentation: "spacer",
  };
}
