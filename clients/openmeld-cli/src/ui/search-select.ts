import type { Key } from "node:readline";
import pc from "picocolors";
import { buildTextInfoCardLines, type InfoCardRow } from "./info-card";
import {
  type InteractivePromptKeypressResult,
  type InteractivePromptStatus,
  type InteractivePromptStreams,
  isReturnKeypress,
  measureRenderedTerminalLinesHeight,
  runInteractivePrompt,
} from "./interactive-prompt";
import { sanitizeTerminalDisplayText } from "./terminal-safe-text";
import { clampNumber, resolveAnchoredVisibleWindow } from "./visible-window";

const PROMPT_SYMBOL_ACTIVE = pc.green("◇");
const PROMPT_SYMBOL_CANCELLED = pc.red("■");
const CURSOR_SYMBOL = pc.cyan("❯");
const BAR_SYMBOL = pc.dim("│");
const SINGLE_SELECTED_SYMBOL = pc.green("●");
const SINGLE_UNSELECTED_SYMBOL = pc.dim("○");
const MULTI_SELECTED_SYMBOL = pc.green("■");
const MULTI_UNSELECTED_SYMBOL = pc.dim("□");
const EMPTY_MATCH_LABEL = "No matches found";
const DEFAULT_MAX_VISIBLE = 8;
const PRINTABLE_SEARCH_INPUT_REGEX = /^[\x20-\x7E]+$/;

type SearchPromptMode = "single" | "multiple";
type SearchPromptStatus = InteractivePromptStatus;

type SearchPromptRow =
  | {
      kind: "item";
      filteredIndex: number;
      itemIndex: number;
    }
  | {
      kind: "action";
      actionIndex: number;
    }
  | {
      kind: "back";
    };

type SearchPromptItemWithSearchKey<T> = SearchSelectItem<T> & {
  readonly searchKey: string;
};

type SearchPromptSummaryCard = {
  title: string;
  rows: InfoCardRow[];
  compact?: boolean;
  minContentWidth?: number;
  horizontalPadding?: number;
};

type SearchPromptBaseInput<T> = {
  message: string;
  items: SearchSelectItem<T>[];
  noticeLines?: string[];
  maxVisible?: number;
  allowBack?: boolean;
  backLabel?: string;
  emptyLabel?: string;
  readOnly?: boolean;
  summaryCard?: SearchPromptSummaryCard;
  footerActions?: SearchPromptFooterAction[];
  footerActionsResolver?: SearchPromptFooterActionResolver<T>;
  workbench?: boolean;
};

type CreateSearchPromptStateInput<T> = SearchPromptBaseInput<T> & {
  mode: SearchPromptMode;
  initialSelectedValues?: T[];
  required?: boolean;
};

export type SearchSelectItem<T> = {
  value: T;
  label: string;
  detail?: string;
  hint?: string;
  searchText?: string;
  disabled?: boolean;
};

export type SearchPromptFooterAction = {
  value: string;
  label: string;
  icon?: string;
  accent?: boolean;
  hint?: string;
  disabled?: boolean;
  separatorBefore?: boolean;
};

export type SearchPromptFooterActionResolver<T> = (input: {
  selectedValues: T[];
}) => SearchPromptFooterAction[];

export type SearchSelectResult<T> =
  | { status: "submitted"; value: T }
  | { status: "back" }
  | { status: "cancelled" };

export type SearchMultiselectResult<T> =
  | { status: "submitted"; value: T[] }
  | { status: "back" }
  | { status: "cancelled" };

export type SearchMultiselectWorkbenchResult<T> =
  | {
      status: "action";
      action: string;
      selectedValues: T[];
    }
  | {
      status: "back";
      selectedValues: T[];
    }
  | {
      status: "cancelled";
      selectedValues: T[];
    };

export type SearchPromptState<T> = {
  readonly mode: SearchPromptMode;
  readonly message: string;
  readonly noticeLines: string[];
  readonly items: SearchPromptItemWithSearchKey<T>[];
  readonly footerActions: SearchPromptFooterAction[];
  readonly footerActionsResolver: SearchPromptFooterActionResolver<T> | null;
  readonly workbench: boolean;
  readonly allowBack: boolean;
  readonly backLabel: string;
  readonly emptyLabel: string;
  readonly maxVisible: number;
  readonly required: boolean;
  readonly readOnly: boolean;
  readonly summaryCard: SearchPromptSummaryCard | null;
  readonly selectedValues: T[];
  readonly query: string;
  readonly activeRowIndex: number;
};

export type SearchPromptVisibleItem<T> = {
  kind: "item";
  filteredIndex: number;
  itemIndex: number;
  item: SearchSelectItem<T>;
  active: boolean;
  selected: boolean;
};

export type SearchPromptVisibleRow<T> =
  | SearchPromptVisibleItem<T>
  | {
      kind: "action";
      action: SearchPromptFooterAction;
      actionIndex: number;
      active: boolean;
    }
  | { kind: "back"; active: boolean; label: string };

export type SearchPromptViewModel<T> = {
  readonly filteredIndexes: number[];
  readonly rows: SearchPromptRow[];
  readonly activeRow: SearchPromptRow | null;
  readonly activeItemFilteredIndex: number | null;
  readonly visibleRows: SearchPromptVisibleRow<T>[];
  readonly hiddenBefore: number;
  readonly hiddenAfter: number;
};

type SearchPromptResolvedResult<T> =
  | SearchSelectResult<T>
  | SearchMultiselectResult<T>
  | SearchMultiselectWorkbenchResult<T>;

export type SearchPromptKeypressResult<T> = InteractivePromptKeypressResult<
  SearchPromptState<T>,
  SearchPromptResolvedResult<T>
>;

type SearchPromptAction<T> =
  | { type: "move"; delta: number }
  | { type: "query-append"; text: string }
  | { type: "query-backspace" }
  | { type: "query-clear" }
  | { type: "toggle-active" }
  | { type: "set-query"; query: string }
  | { type: "set-selected"; selectedValues: T[] };

export function createSearchPromptState<T>(
  input: CreateSearchPromptStateInput<T>
): SearchPromptState<T> {
  const items = input.items.map(sanitizeSearchPromptItem);
  const baseState: SearchPromptState<T> = {
    mode: input.mode,
    message: sanitizeTerminalDisplayText(input.message, "single-line"),
    noticeLines: (input.noticeLines ?? []).map((line) =>
      sanitizeTerminalDisplayText(line, "single-line")
    ),
    items,
    footerActions: (input.footerActions ?? []).map(
      sanitizeSearchPromptFooterAction
    ),
    footerActionsResolver: input.footerActionsResolver ?? null,
    workbench: input.workbench === true,
    allowBack: input.allowBack === true,
    backLabel: sanitizeTerminalDisplayText(
      input.backLabel ?? "Back",
      "single-line"
    ),
    emptyLabel: sanitizeTerminalDisplayText(
      input.emptyLabel ?? EMPTY_MATCH_LABEL,
      "single-line"
    ),
    maxVisible: normalizeMaxVisible(input.maxVisible),
    required: input.required === true,
    readOnly: input.readOnly === true,
    summaryCard:
      input.summaryCard === undefined
        ? null
        : sanitizeSearchPromptSummaryCard(input.summaryCard),
    selectedValues: dedupeValues(input.initialSelectedValues ?? []),
    query: "",
    activeRowIndex: 0,
  };
  const nextState = {
    ...baseState,
    activeRowIndex: resolveInitialSearchPromptActiveRowIndex(baseState),
  };
  return syncSearchPromptState(nextState);
}

function sanitizeSearchPromptFooterAction(
  action: SearchPromptFooterAction
): SearchPromptFooterAction {
  return {
    ...action,
    label: sanitizeTerminalDisplayText(action.label, "single-line"),
    ...(typeof action.icon === "string"
      ? {
          icon: sanitizeTerminalDisplayText(action.icon, "single-line"),
        }
      : {}),
    ...(typeof action.hint === "string"
      ? {
          hint: sanitizeTerminalDisplayText(action.hint, "single-line"),
        }
      : {}),
  };
}

function sanitizeSearchPromptItem<T>(
  item: SearchSelectItem<T>
): SearchPromptItemWithSearchKey<T> {
  const normalizedItem: SearchSelectItem<T> = {
    ...item,
    label: sanitizeTerminalDisplayText(item.label, "single-line"),
    ...(typeof item.detail === "string"
      ? {
          detail: sanitizeTerminalDisplayText(item.detail, "single-line"),
        }
      : {}),
    ...(typeof item.hint === "string"
      ? {
          hint: sanitizeTerminalDisplayText(item.hint, "single-line"),
        }
      : {}),
    ...(typeof item.searchText === "string"
      ? {
          searchText: sanitizeTerminalDisplayText(
            item.searchText,
            "multi-line"
          ),
        }
      : {}),
  };

  return {
    ...normalizedItem,
    searchKey: buildSearchKey(normalizedItem),
  };
}

function sanitizeSearchPromptSummaryCard(
  card: SearchPromptSummaryCard
): SearchPromptSummaryCard {
  return {
    ...card,
    title: sanitizeTerminalDisplayText(card.title, "single-line"),
    rows: card.rows.map((row) => ({
      label: sanitizeTerminalDisplayText(row.label, "single-line"),
      value: sanitizeTerminalDisplayText(row.value, "single-line"),
    })),
  };
}

export function getSearchPromptViewModel<T>(
  state: SearchPromptState<T>
): SearchPromptViewModel<T> {
  const filteredIndexes = getFilteredItemIndexes(state);
  const footerActions = resolveSearchPromptFooterActions(state);
  const rows = buildSearchPromptRows({
    allowBack: state.allowBack,
    filteredIndexes,
    footerActions,
    workbench: state.workbench,
  });

  const activeRow = rows[state.activeRowIndex] ?? null;
  const activeItemFilteredIndex = resolveSearchPromptActiveItemFilteredIndex({
    activeRow,
    filteredIndexes,
    workbench: state.workbench,
  });
  const visibleWindow = resolveAnchoredVisibleWindow({
    itemCount: filteredIndexes.length,
    anchorIndex: activeItemFilteredIndex,
    maxVisible: state.maxVisible,
  });

  const visibleRows = buildSearchPromptVisibleRows({
    activeRow,
    filteredIndexes,
    footerActions,
    state,
    visibleWindow,
  });

  return {
    filteredIndexes,
    rows,
    activeRow,
    activeItemFilteredIndex,
    visibleRows,
    hiddenBefore: visibleWindow.start,
    hiddenAfter: Math.max(0, filteredIndexes.length - visibleWindow.end),
  };
}

function resolveSearchPromptActiveItemFilteredIndex(input: {
  activeRow: SearchPromptRow | null;
  filteredIndexes: number[];
  workbench: boolean;
}): number | null {
  if (input.activeRow?.kind === "item") {
    return input.activeRow.filteredIndex;
  }
  if (input.filteredIndexes.length === 0) {
    return null;
  }
  return input.filteredIndexes.length - 1;
}

export function updateSearchPromptState<T>(
  state: SearchPromptState<T>,
  action: SearchPromptAction<T>
): SearchPromptState<T> {
  switch (action.type) {
    case "move":
      return moveSearchPromptCursor(state, action.delta);
    case "query-append":
      if (action.text.length === 0) {
        return state;
      }
      return syncSearchPromptState({
        ...state,
        query: `${state.query}${action.text}`,
      });
    case "query-backspace":
      if (state.query.length === 0) {
        return state;
      }
      return syncSearchPromptState({
        ...state,
        query: state.query.slice(0, -1),
      });
    case "query-clear":
      if (state.query.length === 0) {
        return state;
      }
      return syncSearchPromptState({
        ...state,
        query: "",
      });
    case "set-query":
      return syncSearchPromptState({
        ...state,
        query: action.query,
      });
    case "toggle-active":
      return toggleSearchPromptActiveSelection(state);
    case "set-selected":
      return syncSearchPromptState({
        ...state,
        selectedValues: dedupeValues(action.selectedValues),
      });
    default:
      return state;
  }
}

export function getSearchPromptSelection<T>(
  state: SearchPromptState<T>
):
  | SearchSelectResult<T>
  | SearchMultiselectResult<T>
  | SearchMultiselectWorkbenchResult<T>
  | null {
  const viewModel = getSearchPromptViewModel(state);
  if (viewModel.activeRow?.kind === "back") {
    return state.workbench
      ? {
          status: "back",
          selectedValues: state.selectedValues,
        }
      : { status: "back" };
  }
  if (viewModel.activeRow?.kind === "action") {
    const action =
      resolveSearchPromptFooterActions(state)[viewModel.activeRow.actionIndex];
    if (!action || action.disabled === true) {
      return null;
    }
    return {
      status: "action",
      action: action.value,
      selectedValues: state.selectedValues,
    };
  }
  if (state.readOnly) {
    return null;
  }
  if (state.workbench) {
    return null;
  }

  if (state.mode === "single") {
    const activeItem = getActiveItem(state);
    if (!activeItem || activeItem.disabled === true) {
      return null;
    }
    return {
      status: "submitted",
      value: activeItem.value,
    };
  }

  if (state.required && state.selectedValues.length === 0) {
    return null;
  }
  return {
    status: "submitted",
    value: state.selectedValues,
  };
}

export function renderSearchPromptLines<T>(
  state: SearchPromptState<T>,
  status: SearchPromptStatus = "active"
): string[] {
  const symbol =
    status === "cancelled" ? PROMPT_SYMBOL_CANCELLED : PROMPT_SYMBOL_ACTIVE;
  const lines = [`${symbol}  ${pc.bold(state.message)}`];

  if (status === "submitted") {
    lines.push(
      `${BAR_SYMBOL}  ${pc.dim(buildSubmittedSearchPromptSummary(state) ?? "Done")}`
    );
    return lines;
  }

  if (status === "cancelled") {
    lines.push(`${BAR_SYMBOL}  ${pc.strikethrough(pc.dim("Cancelled"))}`);
    return lines;
  }

  lines.push(...renderActiveSearchPromptLines(state));
  lines.push(pc.dim("└"));
  return lines;
}

export function measureRenderedSearchPromptHeight(
  lines: string[],
  columns: number | undefined
): number {
  return measureRenderedTerminalLinesHeight(lines, columns);
}

function renderActiveSearchPromptLines<T>(
  state: SearchPromptState<T>
): string[] {
  const viewModel = getSearchPromptViewModel(state);
  const lines: string[] = [];

  if (state.summaryCard) {
    lines.push(`${BAR_SYMBOL}`);
    lines.push(...renderSearchPromptSummaryCardLines(state.summaryCard));
    lines.push(`${BAR_SYMBOL}`);
  }

  if (state.noticeLines.length > 0) {
    lines.push(`${BAR_SYMBOL}`);
    lines.push(...renderSearchPromptNoticeCardLines(state.noticeLines));
    lines.push(`${BAR_SYMBOL}`);
  }

  lines.push(
    `${BAR_SYMBOL}  ${pc.dim("Search:")} ${state.query}${pc.inverse(" ")}`,
    renderSearchPromptHintLine({
      mode: state.mode,
      allowBack: state.allowBack,
      readOnly: state.readOnly,
      workbench: state.workbench,
    })
  );

  lines.push(`${BAR_SYMBOL}`);

  lines.push(...renderSearchPromptBodyLines(state, viewModel));
  lines.push(...renderSearchPromptOverflowLines(viewModel));
  if (state.workbench) {
    lines.push(...renderSearchPromptSelectionSummaryLines(state));
    lines.push(...renderSearchPromptWorkbenchMenuLines(viewModel));
  } else {
    lines.push(...renderSearchPromptActionLines(viewModel));
    lines.push(...renderSearchPromptBackLines(state, viewModel));
    lines.push(...renderSearchPromptSelectionSummaryLines(state));
  }
  return lines;
}

function renderSearchPromptBodyLines<T>(
  state: SearchPromptState<T>,
  viewModel: SearchPromptViewModel<T>
): string[] {
  const itemRows = viewModel.visibleRows.filter(
    (row): row is SearchPromptVisibleItem<T> => row.kind === "item"
  );
  if (itemRows.length === 0) {
    return [`${BAR_SYMBOL}  ${pc.dim(state.emptyLabel)}`];
  }

  return itemRows.flatMap((row) => {
    const lines = [
      renderSearchPromptItemLine(row, {
        mode: state.mode,
        readOnly: state.readOnly,
      }),
    ];
    if (row.item.detail) {
      lines.push(`${BAR_SYMBOL}    ${pc.dim(row.item.detail)}`);
    }
    return lines;
  });
}

function renderSearchPromptOverflowLines<T>(
  viewModel: SearchPromptViewModel<T>
): string[] {
  if (viewModel.hiddenBefore === 0 && viewModel.hiddenAfter === 0) {
    return [];
  }

  const hiddenLabels: string[] = [];
  if (viewModel.hiddenBefore > 0) {
    hiddenLabels.push(`↑ ${String(viewModel.hiddenBefore)} more`);
  }
  if (viewModel.hiddenAfter > 0) {
    hiddenLabels.push(`↓ ${String(viewModel.hiddenAfter)} more`);
  }
  return [`${BAR_SYMBOL}  ${pc.dim(hiddenLabels.join("  "))}`];
}

function renderSearchPromptActionLines<T>(
  viewModel: SearchPromptViewModel<T>
): string[] {
  const actionRows = viewModel.visibleRows.filter(
    (row): row is Extract<SearchPromptVisibleRow<T>, { kind: "action" }> =>
      row.kind === "action"
  );
  if (actionRows.length === 0) {
    return [];
  }

  return renderSearchPromptActionBlockLines(actionRows);
}

function renderSearchPromptWorkbenchMenuLines<T>(
  viewModel: SearchPromptViewModel<T>
): string[] {
  const actionRows = viewModel.visibleRows.filter(
    (row): row is Extract<SearchPromptVisibleRow<T>, { kind: "action" }> =>
      row.kind === "action"
  );
  const backRow = viewModel.visibleRows.find(
    (row): row is Extract<SearchPromptVisibleRow<T>, { kind: "back" }> =>
      row.kind === "back"
  );
  if (actionRows.length === 0 && !backRow) {
    return [];
  }

  const lines = renderSearchPromptActionBlockLines(actionRows);
  if (backRow) {
    if (actionRows.length > 0) {
      lines.push(`${BAR_SYMBOL}`);
    }
    lines.push(renderSearchPromptBackLine(backRow, { workbench: true }));
  }
  return lines;
}

function renderSearchPromptBackLines<T>(
  state: SearchPromptState<T>,
  viewModel: SearchPromptViewModel<T>
): string[] {
  if (!state.allowBack || state.workbench) {
    return [];
  }

  const backRow = viewModel.visibleRows.find(
    (row): row is Extract<SearchPromptVisibleRow<T>, { kind: "back" }> =>
      row.kind === "back"
  );
  if (!backRow) {
    return [];
  }
  return [`${BAR_SYMBOL}`, renderSearchPromptBackLine(backRow)];
}

function renderSearchPromptSelectionSummaryLines<T>(
  state: SearchPromptState<T>
): string[] {
  if (state.mode !== "multiple" || state.readOnly) {
    return [];
  }

  const lines = [
    `${BAR_SYMBOL}`,
    `${BAR_SYMBOL}  ${pc.green("Selected:")} ${buildMultiselectSummary(state)}`,
  ];
  if (
    !state.workbench &&
    (!state.required || state.selectedValues.length > 0)
  ) {
    lines.push(
      `${BAR_SYMBOL}  ${pc.dim("Press ")}${pc.green("`Enter`")}${pc.dim(
        " to continue."
      )}`
    );
  }
  return lines;
}

export function handleSearchPromptKeypress<T>(input: {
  state: SearchPromptState<T>;
  str: string | undefined;
  key: Key;
}): SearchPromptKeypressResult<T> {
  const { state, str, key } = input;
  if (!key) {
    return { type: "ignore" };
  }

  if (key.ctrl === true && key.name === "c") {
    return {
      type: "result",
      result: buildSearchPromptDismissResult({
        state,
        status: "cancelled",
      }),
      status: "cancelled",
    };
  }

  if (key.name === "escape") {
    return handleSearchPromptEscapeKeypress(state);
  }

  if (isReturnKeypress({ key, str })) {
    return handleSearchPromptReturnKeypress(state);
  }

  const moveDelta = resolveSearchPromptMoveDelta(key.name);
  if (moveDelta !== null) {
    return {
      type: "state",
      state: updateSearchPromptState(state, {
        type: "move",
        delta: moveDelta,
      }),
    };
  }

  if (key.name === "space" && state.mode === "multiple") {
    return {
      type: "state",
      state: updateSearchPromptState(state, {
        type: "toggle-active",
      }),
    };
  }

  if (key.name === "backspace") {
    return {
      type: "state",
      state: updateSearchPromptState(state, {
        type: "query-backspace",
      }),
    };
  }

  if (key.ctrl === true && key.name === "u") {
    return {
      type: "state",
      state: updateSearchPromptState(state, {
        type: "query-clear",
      }),
    };
  }

  const printableInput = normalizePrintableSearchInput(str, state.mode);
  if (printableInput !== null) {
    return {
      type: "state",
      state: updateSearchPromptState(state, {
        type: "query-append",
        text: printableInput,
      }),
    };
  }

  return { type: "ignore" };
}

function buildSearchPromptDismissResult<T>(input: {
  state: SearchPromptState<T>;
  status: "back" | "cancelled";
}): SearchPromptResolvedResult<T> {
  if (input.state.workbench) {
    if (input.status === "back") {
      return {
        status: "back",
        selectedValues: input.state.selectedValues,
      };
    }
    return {
      status: "cancelled",
      selectedValues: input.state.selectedValues,
    };
  }
  if (input.status === "back") {
    return {
      status: "back",
    };
  }
  return {
    status: "cancelled",
  };
}

function handleSearchPromptEscapeKeypress<T>(
  state: SearchPromptState<T>
): SearchPromptKeypressResult<T> {
  const dismissalStatus = state.allowBack ? "back" : "cancelled";
  return {
    type: "result",
    result: buildSearchPromptDismissResult({
      state,
      status: dismissalStatus,
    }),
    status: state.allowBack ? "submitted" : "cancelled",
    state: state.allowBack ? focusSearchPromptBackRow(state) : state,
  };
}

function handleSearchPromptReturnKeypress<T>(
  state: SearchPromptState<T>
): SearchPromptKeypressResult<T> {
  if (
    state.workbench &&
    getSearchPromptViewModel(state).activeRow?.kind === "item"
  ) {
    return {
      type: "state",
      state: updateSearchPromptState(state, {
        type: "toggle-active",
      }),
    };
  }

  const result = getSearchPromptSelection(state);
  if (!result) {
    return { type: "ignore" };
  }
  return {
    type: "result",
    result,
    status: "submitted",
  };
}

export function promptSearchSelect<T>(
  input: SearchPromptBaseInput<T>,
  streams?: InteractivePromptStreams
): Promise<SearchSelectResult<T>> {
  const state = createSearchPromptState({
    ...input,
    mode: "single",
  });
  return runInteractiveSearchPrompt(state, streams).then(
    (result) => result as SearchSelectResult<T>
  );
}

export function promptSearchMultiselect<T>(
  input: SearchPromptBaseInput<T> & {
    initialSelectedValues?: T[];
    required?: boolean;
  },
  streams?: InteractivePromptStreams
): Promise<SearchMultiselectResult<T>> {
  const state = createSearchPromptState({
    ...input,
    mode: "multiple",
  });
  return runInteractiveSearchPrompt(state, streams).then(
    (result) => result as SearchMultiselectResult<T>
  );
}

export function promptSearchMultiselectWorkbench<T>(
  input: SearchPromptBaseInput<T> & {
    footerActions: SearchPromptFooterAction[];
    footerActionsResolver?: SearchPromptFooterActionResolver<T>;
    initialSelectedValues?: T[];
  }
): Promise<SearchMultiselectWorkbenchResult<T>> {
  const state = createSearchPromptState({
    ...input,
    mode: "multiple",
    workbench: true,
  });
  return runInteractiveSearchPrompt(state).then(
    (result) => result as SearchMultiselectWorkbenchResult<T>
  );
}

function buildSearchKey<T>(item: SearchSelectItem<T>): string {
  const raw = [
    item.searchText,
    item.label,
    item.detail,
    item.hint,
    String(item.value),
  ]
    .filter((value): value is string => typeof value === "string")
    .join("\n")
    .trim()
    .toLowerCase();
  return raw;
}

function getFilteredItemIndexes<T>(state: SearchPromptState<T>): number[] {
  const query = state.query.trim().toLowerCase();
  if (query.length === 0) {
    return state.items.map((_item, index) => index);
  }
  return state.items.flatMap((item, index) =>
    item.searchKey.includes(query) ? [index] : []
  );
}

function syncSearchPromptState<T>(
  state: SearchPromptState<T>
): SearchPromptState<T> {
  const viewModel = getSearchPromptViewModelInternal(state);
  const activeRowIndex =
    viewModel.rows.length === 0
      ? 0
      : clampNumber(state.activeRowIndex, 0, viewModel.rows.length - 1);
  return {
    ...state,
    activeRowIndex,
  };
}

function getSearchPromptViewModelInternal<T>(state: SearchPromptState<T>) {
  const filteredIndexes = getFilteredItemIndexes(state);
  const footerActions = resolveSearchPromptFooterActions(state);
  const rows = buildSearchPromptRows({
    allowBack: state.allowBack,
    filteredIndexes,
    footerActions,
    workbench: state.workbench,
  });
  return {
    filteredIndexes,
    rows,
  };
}

function buildSearchPromptRows(input: {
  allowBack: boolean;
  filteredIndexes: number[];
  footerActions: SearchPromptFooterAction[];
  workbench: boolean;
}): SearchPromptRow[] {
  const itemRows = input.filteredIndexes.map<SearchPromptRow>(
    (itemIndex, filteredIndex) => ({
      kind: "item",
      filteredIndex,
      itemIndex,
    })
  );
  const actionRows = input.footerActions.map<SearchPromptRow>(
    (_action, actionIndex) => ({
      kind: "action",
      actionIndex,
    })
  );
  const rows = input.workbench
    ? [...itemRows, ...actionRows]
    : [...itemRows, ...actionRows];
  if (input.allowBack) {
    rows.push({ kind: "back" });
  }
  return rows;
}

function buildSearchPromptVisibleRows<T>(input: {
  activeRow: SearchPromptRow | null;
  filteredIndexes: number[];
  footerActions: SearchPromptFooterAction[];
  state: SearchPromptState<T>;
  visibleWindow: { start: number; end: number };
}): SearchPromptVisibleRow<T>[] {
  const itemRows: SearchPromptVisibleRow<T>[] = input.filteredIndexes
    .slice(input.visibleWindow.start, input.visibleWindow.end)
    .map((itemIndex, offset) => {
      const filteredIndex = input.visibleWindow.start + offset;
      const item = input.state.items[itemIndex];
      if (!item) {
        throw new Error("search prompt item is missing");
      }
      return {
        kind: "item",
        filteredIndex,
        itemIndex,
        item,
        active:
          input.activeRow?.kind === "item" &&
          input.activeRow.filteredIndex === filteredIndex,
        selected: isItemSelected(input.state, item.value),
      };
    });
  const actionRows: SearchPromptVisibleRow<T>[] = input.footerActions.map(
    (action, actionIndex) => ({
      kind: "action",
      action,
      actionIndex,
      active:
        input.activeRow?.kind === "action" &&
        input.activeRow.actionIndex === actionIndex,
    })
  );
  const rows: SearchPromptVisibleRow<T>[] = [...itemRows, ...actionRows];
  if (input.state.allowBack) {
    rows.push({
      kind: "back",
      active: input.activeRow?.kind === "back",
      label: input.state.backLabel,
    });
  }
  return rows;
}

function resolveInitialSearchPromptActiveRowIndex<T>(
  state: SearchPromptState<T>
): number {
  if (!state.workbench) {
    return 0;
  }

  const filteredIndexes = getFilteredItemIndexes(state);
  if (filteredIndexes.length > 0) {
    return 0;
  }
  return 0;
}

function moveSearchPromptCursor<T>(
  state: SearchPromptState<T>,
  delta: number
): SearchPromptState<T> {
  const viewModel = getSearchPromptViewModelInternal(state);
  if (viewModel.rows.length === 0 || delta === 0) {
    return state;
  }
  return {
    ...state,
    activeRowIndex: wrapNumber(
      state.activeRowIndex + delta,
      0,
      viewModel.rows.length - 1
    ),
  };
}

function toggleSearchPromptActiveSelection<T>(
  state: SearchPromptState<T>
): SearchPromptState<T> {
  if (state.mode !== "multiple") {
    return state;
  }
  const activeItem = getActiveItem(state);
  if (!activeItem || activeItem.disabled === true) {
    return state;
  }

  const selectedValues = new Set(state.selectedValues);
  if (selectedValues.has(activeItem.value)) {
    selectedValues.delete(activeItem.value);
  } else {
    selectedValues.add(activeItem.value);
  }

  return {
    ...state,
    selectedValues: Array.from(selectedValues),
  };
}

function getActiveItem<T>(
  state: SearchPromptState<T>
): SearchSelectItem<T> | null {
  const viewModel = getSearchPromptViewModel(state);
  if (viewModel.activeRow?.kind !== "item") {
    return null;
  }
  return state.items[viewModel.activeRow.itemIndex] ?? null;
}

function isItemSelected<T>(state: SearchPromptState<T>, value: T): boolean {
  return state.selectedValues.includes(value);
}

function renderSearchPromptItemLine<T>(
  row: SearchPromptVisibleItem<T>,
  input: {
    mode: SearchPromptMode;
    readOnly: boolean;
  }
): string {
  const prefix = row.active ? CURSOR_SYMBOL : " ";
  if (input.readOnly) {
    const hint = row.item.hint ? pc.dim(` (${row.item.hint})`) : "";
    return `${BAR_SYMBOL} ${prefix} ${row.item.label}${hint}`;
  }
  const marker = resolveSearchPromptItemMarker({
    mode: input.mode,
    active: row.active,
    selected: row.selected,
  });
  const label = row.item.label;
  const hint = row.item.hint ? pc.dim(` (${row.item.hint})`) : "";
  const disabled = row.item.disabled === true;
  const renderedLabel = disabled ? pc.dim(label) : label;
  return `${BAR_SYMBOL} ${prefix} ${marker} ${renderedLabel}${hint}`;
}

function renderSearchPromptActionLine<T>(
  row: Extract<SearchPromptVisibleRow<T>, { kind: "action" }>
): string {
  const prefix = row.active ? CURSOR_SYMBOL : " ";
  const icon =
    typeof row.action.icon === "string" && row.action.icon.length > 0
      ? `${
          row.action.disabled === true || row.action.icon === "·"
            ? pc.dim(row.action.icon)
            : pc.cyan(row.action.icon)
        } `
      : "";
  let label = pc.bold(row.action.label);
  if (row.action.accent === true) {
    label = pc.green(row.action.label);
  }
  if (row.action.disabled === true) {
    label = pc.dim(row.action.label);
  }
  const hint = row.action.hint ? pc.dim(` (${row.action.hint})`) : "";
  return `${BAR_SYMBOL} ${prefix} ${icon}${label}${hint}`;
}

function renderSearchPromptActionBlockLines<T>(
  actionRows: Extract<SearchPromptVisibleRow<T>, { kind: "action" }>[]
): string[] {
  const lines = [`${BAR_SYMBOL}`];
  for (const row of actionRows) {
    if (row.action.separatorBefore === true) {
      lines.push(`${BAR_SYMBOL}`);
    }
    lines.push(renderSearchPromptActionLine(row));
  }
  return lines;
}

function resolveSearchPromptItemMarker(input: {
  mode: SearchPromptMode;
  active: boolean;
  selected: boolean;
}): string {
  if (input.mode === "multiple") {
    return input.selected ? MULTI_SELECTED_SYMBOL : MULTI_UNSELECTED_SYMBOL;
  }
  return input.active ? SINGLE_SELECTED_SYMBOL : SINGLE_UNSELECTED_SYMBOL;
}

function renderSearchPromptBackLine<T>(
  row: Extract<SearchPromptVisibleRow<T>, { kind: "back" }>,
  input?: {
    workbench?: boolean;
  }
): string {
  const prefix = row.active ? CURSOR_SYMBOL : " ";
  if (input?.workbench === true) {
    return `${BAR_SYMBOL} ${prefix} ${row.label}`;
  }
  return `${BAR_SYMBOL} ${prefix} ${row.label}`;
}

function buildSubmittedSearchPromptSummary<T>(
  state: SearchPromptState<T>
): string | null {
  const viewModel = getSearchPromptViewModel(state);
  if (viewModel.activeRow?.kind === "back") {
    return state.backLabel;
  }
  if (viewModel.activeRow?.kind === "action") {
    return (
      resolveSearchPromptFooterActions(state)[viewModel.activeRow.actionIndex]
        ?.label ?? null
    );
  }
  if (state.mode === "single") {
    const item = getActiveItem(state);
    return item?.label ?? null;
  }
  return buildMultiselectSummary(state);
}

function buildMultiselectSummary<T>(state: SearchPromptState<T>): string {
  const labels = state.items
    .filter((item) => isItemSelected(state, item.value))
    .map((item) => item.label);
  if (labels.length === 0) {
    return "(none)";
  }
  if (labels.length <= 3) {
    return labels.join(", ");
  }
  return `${labels.slice(0, 3).join(", ")} +${String(labels.length - 3)} more`;
}

function focusSearchPromptBackRow<T>(
  state: SearchPromptState<T>
): SearchPromptState<T> {
  const backRowIndex = getSearchPromptViewModel(state).rows.findIndex(
    (row) => row.kind === "back"
  );
  if (backRowIndex < 0) {
    return state;
  }
  return {
    ...state,
    activeRowIndex: backRowIndex,
  };
}

function resolveSearchPromptMoveDelta(name: string | undefined): number | null {
  if (name === "up") {
    return -1;
  }
  if (name === "down") {
    return 1;
  }
  return null;
}

function renderSearchPromptHintLine(input: {
  mode: SearchPromptMode;
  allowBack: boolean;
  readOnly: boolean;
  workbench: boolean;
}): string {
  if (input.readOnly) {
    return `${BAR_SYMBOL}  ${pc.dim(
      input.allowBack
        ? "↑↓ browse, type to filter, Esc back"
        : "↑↓ browse, type to filter"
    )}`;
  }
  if (input.workbench) {
    return `${BAR_SYMBOL}  ${pc.dim("↑↓ move, Press ")}${pc.green("`Space`")}${pc.dim(" or ")}${pc.green("`Enter`")}${pc.dim(
      input.allowBack
        ? " to select, choose an action to continue, Esc back"
        : " to select, choose an action to continue"
    )}`;
  }
  if (input.mode === "multiple") {
    return `${BAR_SYMBOL}  ${pc.dim("↑↓ move, Press ")}${pc.green("`Space`")}${pc.dim(" to select, Press ")}${pc.green("`Enter`")}${pc.dim(
      input.allowBack ? " to confirm, Esc back" : " to confirm"
    )}`;
  }
  return `${BAR_SYMBOL}  ${pc.dim("↑↓ move, Press ")}${pc.green("`Enter`")}${pc.dim(
    input.allowBack ? " to select, Esc back" : " to select"
  )}`;
}

function renderSearchPromptSummaryCardLines(
  card: SearchPromptSummaryCard
): string[] {
  return buildTextInfoCardLines({
    ...card,
    sanitize: true,
  }).map((line) => `${BAR_SYMBOL}  ${line}`);
}

function renderSearchPromptNoticeCardLines(noticeLines: string[]): string[] {
  if (noticeLines.length === 0) {
    return [];
  }

  return buildTextInfoCardLines({
    title: pc.yellow("⚠️ Notification"),
    rows: noticeLines.map((line) => ({
      label: "",
      value: pc.yellow(`⚠️ ${line}`),
    })),
    compact: true,
    minContentWidth: 48,
  }).map((line) => `${BAR_SYMBOL}  ${line}`);
}

function normalizeMaxVisible(value: number | undefined): number {
  const normalized = typeof value === "number" ? Math.trunc(value) : Number.NaN;
  return Number.isFinite(normalized) && normalized > 0
    ? normalized
    : DEFAULT_MAX_VISIBLE;
}

function wrapNumber(value: number, min: number, max: number): number {
  if (value < min) {
    return max;
  }
  if (value > max) {
    return min;
  }
  return value;
}

function dedupeValues<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function runInteractiveSearchPrompt<T>(
  initialState: SearchPromptState<T>,
  streams?: InteractivePromptStreams
): Promise<SearchPromptResolvedResult<T>> {
  return runInteractivePrompt(
    {
      initialState,
      fallbackResult: buildSearchPromptFallbackResult(initialState),
      renderLines: (state, status) => renderSearchPromptLines(state, status),
      handleKeypress: ({ state, str, key }) =>
        handleSearchPromptKeypress({
          state,
          str,
          key,
        }),
    },
    streams
  );
}

function buildSearchPromptFallbackResult<T>(
  state: SearchPromptState<T>
): SearchPromptResolvedResult<T> {
  return buildSearchPromptDismissResult({
    state,
    status: state.allowBack ? "back" : "cancelled",
  });
}

function resolveSearchPromptFooterActions<T>(
  state: SearchPromptState<T>
): SearchPromptFooterAction[] {
  if (state.footerActionsResolver === null) {
    return state.footerActions;
  }

  return state
    .footerActionsResolver({
      selectedValues: state.selectedValues,
    })
    .map(sanitizeSearchPromptFooterAction);
}

function isPrintableSearchInput(
  value: string | undefined,
  mode: SearchPromptMode
): boolean {
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }
  if (mode === "multiple" && value === " ") {
    return false;
  }
  return PRINTABLE_SEARCH_INPUT_REGEX.test(value);
}

function normalizePrintableSearchInput(
  value: string | undefined,
  mode: SearchPromptMode
): string | null {
  return typeof value === "string" && isPrintableSearchInput(value, mode)
    ? value
    : null;
}
