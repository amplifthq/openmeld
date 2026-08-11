import type { Key } from "node:readline";
import pc from "picocolors";
import {
  type InteractivePromptKeypressResult,
  type InteractivePromptStatus,
  isReturnKeypress,
  measureRenderedTerminalLinesHeight,
  runInteractivePrompt,
} from "./interactive-prompt";
import { sanitizeTerminalDisplayText } from "./terminal-safe-text";

const PROMPT_SYMBOL_ACTIVE = pc.green("◇");
const PROMPT_SYMBOL_CANCELLED = pc.red("■");
const CURSOR_SYMBOL = pc.cyan("❯");
const BAR_SYMBOL = pc.dim("│");
const DEFAULT_PLACEHOLDER = "";
const PRINTABLE_TEXT_INPUT_REGEX = /^[\x20-\x7E]+$/;

type TextEntryPromptStatus = InteractivePromptStatus;
export type TextEntryPromptFocus = "input" | "back";

export type TextEntryState = {
  readonly message: string;
  readonly description?: string;
  readonly placeholder: string;
  readonly allowBack: boolean;
  readonly allowEmpty: boolean;
  readonly backLabel: string;
  readonly requiredMessage: string;
  readonly value: string;
  readonly focus: TextEntryPromptFocus;
  readonly errorMessage?: string;
};

type TextEntryKeypressResult = InteractivePromptKeypressResult<
  TextEntryState,
  TextEntryPromptResult
>;

type CreateTextEntryStateInput = {
  message: string;
  description?: string;
  placeholder?: string;
  allowBack?: boolean;
  allowEmpty?: boolean;
  backLabel?: string;
  requiredMessage?: string;
  value?: string;
  focus?: TextEntryPromptFocus;
  errorMessage?: string;
};

export type TextEntryPromptResult =
  | { status: "submitted"; value: string }
  | { status: "back" }
  | { status: "cancelled" };

export function createTextEntryState(
  input: CreateTextEntryStateInput
): TextEntryState {
  return {
    message: sanitizeTerminalDisplayText(input.message, "single-line"),
    description:
      typeof input.description === "string"
        ? sanitizeTerminalDisplayText(input.description, "single-line")
        : undefined,
    placeholder: sanitizeTerminalDisplayText(
      input.placeholder ?? DEFAULT_PLACEHOLDER,
      "single-line"
    ),
    allowBack: input.allowBack === true,
    allowEmpty: input.allowEmpty === true,
    backLabel: sanitizeTerminalDisplayText(
      input.backLabel ?? "Back",
      "single-line"
    ),
    requiredMessage: sanitizeTerminalDisplayText(
      input.requiredMessage ?? "Space ID is required.",
      "single-line"
    ),
    value: input.value ?? "",
    focus: input.focus ?? "input",
    errorMessage: input.errorMessage,
  };
}

export function promptTextEntry(input: {
  message: string;
  description?: string;
  placeholder?: string;
  allowBack?: boolean;
  allowEmpty?: boolean;
  backLabel?: string;
  requiredMessage?: string;
  validate?: (value: string) => string | null;
}): Promise<TextEntryPromptResult> {
  return runInteractivePrompt({
    initialState: createTextEntryState(input),
    fallbackResult: {
      status: input.allowBack === true ? "back" : "cancelled",
    },
    renderLines: (state, status) => renderTextEntryPromptLines(state, status),
    handleKeypress: ({ state, str, key }) =>
      handleTextEntryKeypress({
        state,
        str,
        key,
        validate: input.validate,
      }),
  });
}

export function handleTextEntryKeypress(input: {
  state: TextEntryState;
  str: string | undefined;
  key: Key;
  validate?: (value: string) => string | null;
}): TextEntryKeypressResult {
  const { state, str, key, validate } = input;
  if (!key) {
    return { type: "ignore" };
  }

  if (key.ctrl === true && key.name === "c") {
    return {
      type: "result",
      result: { status: "cancelled" },
      status: "cancelled",
    };
  }

  if (key.name === "escape") {
    return resolveTextEntryEscape(state);
  }

  if (isTextEntryFocusToggleKey(key.name)) {
    return {
      type: "state",
      state: toggleTextEntryFocus(state),
    };
  }

  if (isReturnKeypress({ key, str })) {
    return submitTextEntryValue({
      state,
      validate,
    });
  }

  if (state.focus !== "input") {
    return { type: "ignore" };
  }

  if (key.name === "backspace") {
    return {
      type: "state",
      state: {
        ...state,
        value: state.value.slice(0, -1),
        errorMessage: undefined,
      },
    };
  }

  if (key.ctrl === true && key.name === "u") {
    return {
      type: "state",
      state: {
        ...state,
        value: "",
        errorMessage: undefined,
      },
    };
  }

  if (!isPrintableTextInput(str)) {
    return { type: "ignore" };
  }

  return {
    type: "state",
    state: {
      ...state,
      value: `${state.value}${str}`,
      errorMessage: undefined,
    },
  };
}

function resolveTextEntryEscape(
  state: TextEntryState
): TextEntryKeypressResult {
  if (!state.allowBack) {
    return {
      type: "result",
      result: { status: "cancelled" },
      status: "cancelled",
    };
  }

  return {
    type: "result",
    result: { status: "back" },
    status: "submitted",
    state: {
      ...state,
      focus: "back",
      errorMessage: undefined,
    },
  };
}

function toggleTextEntryFocus(state: TextEntryState): TextEntryState {
  if (!state.allowBack) {
    return state;
  }

  return {
    ...state,
    focus: state.focus === "input" ? "back" : "input",
    errorMessage: undefined,
  };
}

function submitTextEntryValue(input: {
  state: TextEntryState;
  validate?: (value: string) => string | null;
}): TextEntryKeypressResult {
  if (input.state.focus === "back") {
    return {
      type: "result",
      result: { status: "back" },
      status: "submitted",
    };
  }

  const normalized = input.state.value.trim();
  if (!input.state.allowEmpty && normalized.length === 0) {
    return {
      type: "state",
      state: {
        ...input.state,
        errorMessage: input.state.requiredMessage,
      },
    };
  }

  const validationError = input.validate?.(normalized) ?? null;
  if (validationError) {
    return {
      type: "state",
      state: {
        ...input.state,
        errorMessage: validationError,
      },
    };
  }

  return {
    type: "result",
    result: { status: "submitted", value: normalized },
    status: "submitted",
  };
}

function isTextEntryFocusToggleKey(name: string | undefined): boolean {
  return name === "up" || name === "down" || name === "tab";
}

export function renderTextEntryPromptLines(
  state: TextEntryState,
  status: TextEntryPromptStatus
): string[] {
  const symbol =
    status === "cancelled" ? PROMPT_SYMBOL_CANCELLED : PROMPT_SYMBOL_ACTIVE;
  const lines = [`${symbol}  ${pc.bold(state.message)}`];

  if (status === "submitted") {
    if (state.focus === "back") {
      lines.push(`${BAR_SYMBOL}  ${pc.dim(state.backLabel)}`);
      return lines;
    }
    lines.push(`${BAR_SYMBOL}  ${pc.dim(state.value.trim())}`);
    return lines;
  }

  if (status === "cancelled") {
    lines.push(`${BAR_SYMBOL}  ${pc.strikethrough(pc.dim("Cancelled"))}`);
    return lines;
  }

  if (state.description) {
    lines.push(`${BAR_SYMBOL}  ${pc.dim(state.description)}`);
  }
  lines.push(
    `${BAR_SYMBOL}  ${pc.dim(
      state.allowBack ? "enter confirm, esc back" : "enter confirm"
    )}`
  );
  lines.push(`${BAR_SYMBOL}`);
  lines.push(renderTextEntryInputLine(state));

  if (state.errorMessage) {
    lines.push(`${BAR_SYMBOL}  ${pc.red(state.errorMessage)}`);
  }

  if (state.allowBack) {
    lines.push(`${BAR_SYMBOL}`);
    lines.push(renderTextEntryBackLine(state));
  }

  lines.push(pc.dim("└"));
  return lines;
}

export function measureRenderedTextEntryPromptHeight(
  lines: string[],
  columns: number | undefined
): number {
  return measureRenderedTerminalLinesHeight(lines, columns);
}

function renderTextEntryInputLine(state: TextEntryState): string {
  const prefix = state.focus === "input" ? CURSOR_SYMBOL : " ";
  const content =
    state.value.length > 0 ? state.value : pc.dim(state.placeholder || " ");
  const rendered =
    state.focus === "input" ? `${content}${pc.inverse(" ")}` : content;
  return `${BAR_SYMBOL} ${prefix} ${rendered}`;
}

function renderTextEntryBackLine(state: TextEntryState): string {
  const prefix = state.focus === "back" ? CURSOR_SYMBOL : " ";
  const label =
    state.focus === "back" ? pc.underline(state.backLabel) : state.backLabel;
  return `${BAR_SYMBOL} ${prefix} ${label}`;
}

function isPrintableTextInput(value: string | undefined): boolean {
  return typeof value === "string" && value.length > 0
    ? PRINTABLE_TEXT_INPUT_REGEX.test(value)
    : false;
}
