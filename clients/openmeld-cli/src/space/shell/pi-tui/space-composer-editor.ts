import {
  Editor,
  type EditorTheme,
  getEditorKeybindings,
  Key,
  matchesKey,
  type TUI,
} from "@mariozechner/pi-tui";
import { decorateMentionAutocompleteSelectList } from "./mention-autocomplete-select-list";
import {
  type PiTuiComposerAutocompleteItem,
  PiTuiComposerAutocompleteProvider,
} from "./pi-tui-composer-autocomplete-provider";

type SelectListInternals = {
  openMeldMentionAutocompleteDecorated?: boolean;
  filteredItems: PiTuiComposerAutocompleteItem[];
  getSelectedItem: () => PiTuiComposerAutocompleteItem | null;
  setSelectedIndex: (index: number) => void;
};

type EditorInternals = {
  autocompleteList?: SelectListInternals;
  autocompletePrefix: string;
  autocompleteProvider?: unknown;
  disableSubmit: boolean;
  forceFileAutocomplete: (explicitTab?: boolean) => void;
  handleInput: (data: string) => void;
  shouldSubmitOnBackslashEnter: (data: string, kb: unknown) => boolean;
  state: {
    cursorCol: number;
    cursorLine: number;
    lines: string[];
  };
  submitValue: () => void;
  tryTriggerAutocomplete: (explicitTab?: boolean) => void;
  updateAutocomplete: () => void;
};

export function createSpaceComposerEditor(
  tui: TUI,
  theme: EditorTheme,
  options?: {
    autocompleteMaxVisible?: number;
    paddingX?: number;
  }
): Editor {
  const editor = new Editor(tui, theme, options);
  disableBackslashContinuation(editor);
  return editor;
}

function disableBackslashContinuation(editor: Editor): void {
  const editorInternals = editor as unknown as EditorInternals;
  const originalHandleInput = editorInternals.handleInput.bind(editorInternals);
  const originalTryTriggerAutocomplete =
    editorInternals.tryTriggerAutocomplete.bind(editorInternals);
  const originalForceFileAutocomplete =
    editorInternals.forceFileAutocomplete.bind(editorInternals);
  const originalUpdateAutocomplete =
    editorInternals.updateAutocomplete.bind(editorInternals);

  editorInternals.shouldSubmitOnBackslashEnter = () => false;
  editorInternals.handleInput = (data: string): void => {
    if (handleNestedMentionPickerInput(editorInternals, data)) {
      return;
    }
    if (shouldSubmitLiteralBackslash(editorInternals, data)) {
      if (!editorInternals.disableSubmit) {
        editorInternals.submitValue();
      }
      return;
    }
    originalHandleInput(data);
  };
  editorInternals.tryTriggerAutocomplete = (explicitTab?: boolean): void => {
    originalTryTriggerAutocomplete(explicitTab);
    decorateMentionAutocomplete(editorInternals);
  };
  editorInternals.forceFileAutocomplete = (explicitTab?: boolean): void => {
    originalForceFileAutocomplete(explicitTab);
    decorateMentionAutocomplete(editorInternals);
  };
  editorInternals.updateAutocomplete = (): void => {
    originalUpdateAutocomplete();
    decorateMentionAutocomplete(editorInternals);
  };
}

function shouldSubmitLiteralBackslash(
  editor: EditorInternals,
  data: string
): boolean {
  if (!matchesKey(data, Key.enter)) {
    return false;
  }
  const currentLine = editor.state.lines[editor.state.cursorLine] ?? "";
  return (
    editor.state.cursorCol > 0 &&
    currentLine[editor.state.cursorCol - 1] === "\\"
  );
}

function decorateMentionAutocomplete(editor: EditorInternals): void {
  if (!(editor.autocompleteList && editor.autocompletePrefix.startsWith("@"))) {
    return;
  }

  const autocompleteList = editor.autocompleteList as SelectListInternals &
    Parameters<typeof decorateMentionAutocompleteSelectList>[0];
  decorateMentionAutocompleteSelectList(autocompleteList);

  const mentionProvider = getMentionAutocompleteProvider(editor);
  mentionProvider?.syncAutocompleteSelection({
    items: autocompleteList.filteredItems,
    setSelectedIndex: (index) => {
      autocompleteList.setSelectedIndex(index);
    },
  });
}

function handleNestedMentionPickerInput(
  editor: EditorInternals,
  data: string
): boolean {
  if (!(editor.autocompleteList && editor.autocompletePrefix.startsWith("@"))) {
    return false;
  }

  const mentionProvider = getMentionAutocompleteProvider(editor);
  if (!mentionProvider) {
    return false;
  }

  const keybindings = getEditorKeybindings();
  const selectedItem = editor.autocompleteList.getSelectedItem();
  const confirmsSelection =
    keybindings.matches(data, "selectConfirm") ||
    keybindings.matches(data, "tab");

  if (
    confirmsSelection &&
    selectedItem?.mentionPresentation === "target_choice" &&
    mentionProvider.enterRelationPicker(selectedItem, editor.autocompletePrefix)
  ) {
    editor.updateAutocomplete();
    return true;
  }

  if (!mentionProvider.isRelationPickerOpen()) {
    return false;
  }

  if (
    selectedItem?.mentionPresentation === "back_choice" &&
    confirmsSelection
  ) {
    mentionProvider.returnToTargetPicker();
    editor.updateAutocomplete();
    return true;
  }

  if (
    keybindings.matches(data, "cursorLeft") ||
    keybindings.matches(data, "selectCancel")
  ) {
    mentionProvider.returnToTargetPicker();
    editor.updateAutocomplete();
    return true;
  }

  if (shouldResumeTargetPickerSearch(data)) {
    mentionProvider.prepareForEditableInput();
  }

  return false;
}

function getMentionAutocompleteProvider(
  editor: EditorInternals
): PiTuiComposerAutocompleteProvider | null {
  if (
    editor.autocompleteProvider instanceof PiTuiComposerAutocompleteProvider
  ) {
    return editor.autocompleteProvider;
  }
  return null;
}

function shouldResumeTargetPickerSearch(data: string): boolean {
  const keybindings = getEditorKeybindings();
  if (
    keybindings.matches(data, "deleteCharBackward") ||
    keybindings.matches(data, "deleteCharForward") ||
    keybindings.matches(data, "deleteWordBackward") ||
    keybindings.matches(data, "deleteWordForward") ||
    keybindings.matches(data, "deleteToLineStart") ||
    keybindings.matches(data, "deleteToLineEnd")
  ) {
    return true;
  }

  return isPrintableEditorInput(data);
}

function isPrintableEditorInput(data: string): boolean {
  if (!data) {
    return false;
  }

  if (
    matchesKey(data, Key.backspace) ||
    matchesKey(data, Key.delete) ||
    matchesKey(data, Key.enter) ||
    matchesKey(data, Key.escape) ||
    matchesKey(data, Key.tab)
  ) {
    return false;
  }

  if (data.startsWith("\u001b")) {
    return false;
  }

  for (const character of data) {
    const code = character.charCodeAt(0);
    if ((code >= 0 && code <= 31) || code === 127) {
      return false;
    }
  }

  return true;
}
