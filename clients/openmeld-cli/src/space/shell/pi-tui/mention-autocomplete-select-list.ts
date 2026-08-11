import {
  getEditorKeybindings,
  type SelectListTheme,
} from "@mariozechner/pi-tui";
import { colorizeAgentLabel } from "../../../ui/profile-label-color";
import type { PiTuiComposerAutocompleteItem } from "./pi-tui-composer-autocomplete-provider";

type SelectListInternals = {
  filteredItems: PiTuiComposerAutocompleteItem[];
  items: PiTuiComposerAutocompleteItem[];
  maxVisible: number;
  onCancel?: (() => void) | undefined;
  onSelect?: ((item: PiTuiComposerAutocompleteItem) => void) | undefined;
  onSelectionChange?:
    | ((item: PiTuiComposerAutocompleteItem) => void)
    | undefined;
  selectedIndex: number;
  theme: SelectListTheme;
  getSelectedItem: () => PiTuiComposerAutocompleteItem | null;
  handleInput: (keyData: string) => void;
  notifySelectionChange: () => void;
  render: (width: number) => string[];
  setSelectedIndex: (index: number) => void;
  openMeldMentionAutocompleteDecorated?: boolean;
};

type MentionSelectListItem = PiTuiComposerAutocompleteItem;
type MemberRowPieceTone =
  | "agent-accent"
  | "description"
  | "plain"
  | "selected-prefix";
type MemberRowTextPiece = {
  text: string;
  tone: MemberRowPieceTone;
};

export function decorateMentionAutocompleteSelectList(
  list: SelectListInternals
): void {
  if (
    list.openMeldMentionAutocompleteDecorated ||
    !hasPresentationRows(list.items)
  ) {
    return;
  }

  list.openMeldMentionAutocompleteDecorated = true;
  const originalSetSelectedIndex = list.setSelectedIndex.bind(list);

  list.setSelectedIndex = (index: number): void => {
    const nextIndex = findNearestSelectableIndex(list.filteredItems, index);
    if (nextIndex === null) {
      originalSetSelectedIndex(0);
      return;
    }
    originalSetSelectedIndex(nextIndex);
  };

  list.getSelectedItem = (): MentionSelectListItem | null => {
    const selectedIndex = findNearestSelectableIndex(
      list.filteredItems,
      list.selectedIndex
    );
    if (selectedIndex === null) {
      return null;
    }
    return list.filteredItems[selectedIndex] ?? null;
  };

  list.notifySelectionChange = (): void => {
    const selectedItem = list.getSelectedItem();
    if (selectedItem && list.onSelectionChange) {
      list.onSelectionChange(selectedItem);
    }
  };

  list.handleInput = (keyData: string): void => {
    const keybindings = getEditorKeybindings();

    if (keybindings.matches(keyData, "selectUp")) {
      moveSelection(list, -1);
      return;
    }

    if (keybindings.matches(keyData, "selectDown")) {
      moveSelection(list, 1);
      return;
    }

    if (keybindings.matches(keyData, "selectConfirm")) {
      const selectedItem = list.getSelectedItem();
      if (selectedItem && list.onSelect) {
        list.onSelect(selectedItem);
      }
      return;
    }

    if (keybindings.matches(keyData, "selectCancel")) {
      list.onCancel?.();
    }
  };

  list.render = (width: number): string[] => {
    const items = list.filteredItems;
    if (items.length === 0) {
      return [list.theme.noMatch("  No matching commands")];
    }

    const selectedIndex = findNearestSelectableIndex(items, list.selectedIndex);
    if (selectedIndex !== null && selectedIndex !== list.selectedIndex) {
      list.selectedIndex = selectedIndex;
    }

    const safeSelectedIndex = selectedIndex ?? 0;
    let startIndex = Math.max(
      0,
      Math.min(
        safeSelectedIndex - Math.floor(list.maxVisible / 2),
        items.length - list.maxVisible
      )
    );
    startIndex = expandWindowForSectionContext(
      items,
      startIndex,
      safeSelectedIndex
    );
    const endIndex = Math.min(startIndex + list.maxVisible, items.length);
    const visibleItems = items.slice(startIndex, endIndex);
    const lines = visibleItems.map((item, offset) =>
      renderMentionAutocompleteRow({
        item,
        isSelected: startIndex + offset === safeSelectedIndex,
        theme: list.theme,
        width,
      })
    );

    if (startIndex > 0 || endIndex < items.length) {
      const selectableCount = items.filter(isSelectableItem).length;
      const selectedSelectableIndex = countSelectableItemsBefore(
        items,
        safeSelectedIndex
      );
      lines.push(
        list.theme.scrollInfo(
          truncateText(
            `  (${selectedSelectableIndex + 1}/${selectableCount})`,
            Math.max(0, width - 2)
          )
        )
      );
    }

    return lines;
  };

  list.setSelectedIndex(list.selectedIndex);
}

function hasPresentationRows(items: MentionSelectListItem[]): boolean {
  return items.some((item) => item.mentionPresentation !== undefined);
}

function moveSelection(list: SelectListInternals, direction: -1 | 1): void {
  const items = list.filteredItems;
  if (items.length === 0) {
    return;
  }

  const currentIndex =
    findNearestSelectableIndex(items, list.selectedIndex) ?? 0;
  let nextIndex = currentIndex;

  for (const _item of items) {
    nextIndex =
      (nextIndex + direction + items.length) % Math.max(1, items.length);
    if (isSelectableItem(items[nextIndex])) {
      list.selectedIndex = nextIndex;
      list.notifySelectionChange();
      return;
    }
  }
}

function renderMentionAutocompleteRow(input: {
  item: MentionSelectListItem;
  isSelected: boolean;
  theme: SelectListTheme;
  width: number;
}): string {
  const { item, isSelected, theme, width } = input;

  switch (item.mentionPresentation) {
    case "relation_header":
    case "section_header":
      return theme.selectedPrefix(
        `  ${truncateText(item.label ?? "", width - 2)}`
      );
    case "spacer":
      return "";
    default:
      return renderMemberRow({
        isSelected,
        item,
        theme,
        width,
      });
  }
}

function renderMemberRow(input: {
  isSelected: boolean;
  item: MentionSelectListItem;
  theme: SelectListTheme;
  width: number;
}): string {
  const prefix = input.isSelected ? "→ " : "  ";
  const label =
    normalizeSingleLineText(input.item.label || input.item.value) ?? "";
  const description = buildMemberDescriptionText(input.item);
  const maxWidth = Math.max(0, input.width - prefix.length - 2);

  if (!description || input.width <= 40) {
    return renderMemberRowPieces({
      isSelected: input.isSelected,
      item: input.item,
      pieces: [
        {
          text: prefix,
          tone: input.isSelected ? "selected-prefix" : "plain",
        },
        createMemberLabelPiece(input.item, truncateText(label, maxWidth)),
      ],
      theme: input.theme,
    });
  }

  const maxLabelWidth = Math.min(
    30,
    Math.max(0, input.width - prefix.length - 4)
  );
  const truncatedLabel = truncateText(label, maxLabelWidth);
  const spacing = " ".repeat(Math.max(1, 32 - truncatedLabel.length));
  const descriptionStart =
    prefix.length + truncatedLabel.length + spacing.length;
  const remainingWidth = Math.max(0, input.width - descriptionStart - 2);

  if (remainingWidth <= 10) {
    return renderMemberRowPieces({
      isSelected: input.isSelected,
      item: input.item,
      pieces: [
        {
          text: prefix,
          tone: input.isSelected ? "selected-prefix" : "plain",
        },
        createMemberLabelPiece(input.item, truncateText(label, maxWidth)),
      ],
      theme: input.theme,
    });
  }

  return renderMemberRowPieces({
    isSelected: input.isSelected,
    item: input.item,
    pieces: [
      {
        text: prefix,
        tone: input.isSelected ? "selected-prefix" : "plain",
      },
      createMemberLabelPiece(input.item, truncatedLabel),
      { text: spacing, tone: "description" },
      ...buildMemberDescriptionPieces({
        item: input.item,
        maxWidth: remainingWidth,
      }),
    ],
    theme: input.theme,
  });
}

function expandWindowForSectionContext(
  items: MentionSelectListItem[],
  startIndex: number,
  selectedIndex: number
): number {
  let nextStartIndex = startIndex;
  const previousItem = items[selectedIndex - 1];
  const previousPreviousItem = items[selectedIndex - 2];

  if (previousItem?.mentionPresentation === "section_header") {
    nextStartIndex = Math.min(nextStartIndex, Math.max(0, selectedIndex - 1));
  }

  if (
    previousItem?.mentionPresentation === "spacer" &&
    previousPreviousItem?.mentionPresentation === "section_header"
  ) {
    nextStartIndex = Math.min(nextStartIndex, Math.max(0, selectedIndex - 2));
  }

  return nextStartIndex;
}

function findNearestSelectableIndex(
  items: MentionSelectListItem[],
  index: number
): number | null {
  if (items.length === 0) {
    return null;
  }

  const clampedIndex = Math.max(0, Math.min(index, items.length - 1));
  if (isSelectableItem(items[clampedIndex])) {
    return clampedIndex;
  }

  for (let offset = 1; offset < items.length; offset += 1) {
    const nextIndex = clampedIndex + offset;
    if (nextIndex < items.length && isSelectableItem(items[nextIndex])) {
      return nextIndex;
    }
    const previousIndex = clampedIndex - offset;
    if (previousIndex >= 0 && isSelectableItem(items[previousIndex])) {
      return previousIndex;
    }
  }

  return null;
}

function countSelectableItemsBefore(
  items: MentionSelectListItem[],
  index: number
): number {
  let count = 0;
  for (let currentIndex = 0; currentIndex <= index; currentIndex += 1) {
    if (isSelectableItem(items[currentIndex])) {
      count += 1;
    }
  }
  return Math.max(0, count - 1);
}

function isSelectableItem(item: MentionSelectListItem | undefined): boolean {
  return (
    item?.mentionPresentation === "back_choice" ||
    item?.mentionPresentation === "relation_choice" ||
    item?.mentionPresentation === "target_choice"
  );
}

function buildMemberDescriptionText(
  item: MentionSelectListItem
): string | null {
  return normalizeSingleLineText(item.description);
}

function createMemberLabelPiece(
  item: MentionSelectListItem,
  label: string
): MemberRowTextPiece {
  if (shouldColorizeAgentMentionItem(item)) {
    return { text: label, tone: "agent-accent" };
  }

  return { text: label, tone: "plain" };
}

function buildMemberDescriptionPieces(input: {
  item: MentionSelectListItem;
  maxWidth: number;
}): MemberRowTextPiece[] {
  const description = buildMemberDescriptionText(input.item);
  if (!description) {
    return [];
  }

  const controllerDisplay = normalizeSingleLineText(
    input.item.mentionControllerDisplay
  );
  const controllerShown = Boolean(
    controllerDisplay && description.startsWith(controllerDisplay)
  );

  if (!(controllerShown && controllerDisplay)) {
    return truncateMemberRowPieces(
      [{ text: description, tone: "description" }],
      input.maxWidth
    );
  }

  const descriptionTail = description.slice(controllerDisplay.length);
  const pieces: MemberRowTextPiece[] = [
    {
      text: controllerDisplay,
      tone: shouldColorizeAgentMentionItem(input.item)
        ? "agent-accent"
        : "description",
    },
  ];

  if (descriptionTail) {
    pieces.push({ text: descriptionTail, tone: "description" });
  }

  return truncateMemberRowPieces(pieces, input.maxWidth);
}

function truncateMemberRowPieces(
  pieces: MemberRowTextPiece[],
  maxWidth: number
): MemberRowTextPiece[] {
  let remainingWidth = maxWidth;
  const truncatedPieces: MemberRowTextPiece[] = [];

  for (const piece of pieces) {
    if (remainingWidth <= 0) {
      break;
    }

    const truncatedText = truncateText(piece.text, remainingWidth);
    if (!truncatedText) {
      continue;
    }

    truncatedPieces.push({
      ...piece,
      text: truncatedText,
    });
    remainingWidth -= measureTextWidth(truncatedText);
  }

  return truncatedPieces;
}

function renderMemberRowPieces(input: {
  isSelected: boolean;
  item: MentionSelectListItem;
  pieces: MemberRowTextPiece[];
  theme: SelectListTheme;
}): string {
  return input.pieces
    .map((piece) => renderMemberRowPiece(piece, input.item, input.theme))
    .join("");
}

function renderMemberRowPiece(
  piece: MemberRowTextPiece,
  item: MentionSelectListItem,
  theme: SelectListTheme
): string {
  switch (piece.tone) {
    case "agent-accent":
      return colorizeMentionAgentText(piece.text, item);
    case "description":
      return theme.description(piece.text);
    case "selected-prefix":
      return theme.selectedPrefix(piece.text);
    default:
      return piece.text;
  }
}

function colorizeMentionAgentText(
  text: string,
  item: MentionSelectListItem
): string {
  const agentControllerRef = normalizeSingleLineText(
    item.mentionAgentControllerRef
  );
  if (!(text && agentControllerRef && item.mentionProfileKind === "agent")) {
    return text;
  }

  return colorizeAgentLabel(text, {
    agentControllerRef,
    profileId: normalizeSingleLineText(item.mentionProfileId) ?? undefined,
    profileName:
      normalizeSingleLineText(item.mentionProfileName) ??
      normalizeSingleLineText(item.label || item.value) ??
      undefined,
  });
}

function shouldColorizeAgentMentionItem(item: MentionSelectListItem): boolean {
  return Boolean(
    item.mentionPresentation === "target_choice" &&
      item.mentionProfileKind === "agent" &&
      normalizeSingleLineText(item.mentionAgentControllerRef)
  );
}

function normalizeSingleLineText(
  text: string | number | null | undefined
): string | null {
  const normalized = String(text ?? "")
    .replace(/[\r\n]+/g, " ")
    .trim();
  return normalized.length > 0 ? normalized : null;
}

function measureTextWidth(text: string): number {
  return Array.from(text).length;
}

function truncateText(text: string, maxWidth: number): string {
  if (maxWidth <= 0) {
    return "";
  }
  return Array.from(text).slice(0, maxWidth).join("");
}
