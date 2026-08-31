import type { Key } from "node:readline";
import pc from "picocolors";
import {
  type InteractivePromptKeypressResult,
  type InteractivePromptStatus,
  type InteractivePromptStreams,
  isReturnKeypress,
  runInteractivePrompt,
} from "./interactive-prompt";

const PROMPT_SYMBOL_ACTIVE = pc.green("◇");
const PROMPT_SYMBOL_CANCELLED = pc.red("■");
const BAR_SYMBOL = pc.dim("│");
const SELECTED_SYMBOL = pc.green("●");
const UNSELECTED_SYMBOL = pc.dim("○");

export type ConfirmPromptResult = "confirmed" | "declined" | "cancelled";

type ConfirmPromptState = {
  activeLabel: string;
  inactiveLabel: string;
  message: string;
  value: boolean;
};

export function promptConfirm(
  input: {
    activeLabel?: string;
    inactiveLabel?: string;
    initialValue?: boolean;
    message: string;
  },
  streams?: InteractivePromptStreams
): Promise<ConfirmPromptResult> {
  return runInteractivePrompt<ConfirmPromptState, ConfirmPromptResult>(
    {
      initialState: {
        activeLabel: input.activeLabel ?? "Yes",
        inactiveLabel: input.inactiveLabel ?? "No",
        message: input.message,
        value: input.initialValue ?? true,
      },
      fallbackResult: "cancelled",
      renderLines: renderConfirmPromptLines,
      handleKeypress: handleConfirmPromptKeypress,
    },
    streams
  );
}

export function renderConfirmPromptLines(
  state: ConfirmPromptState,
  status: InteractivePromptStatus
): string[] {
  const promptSymbol =
    status === "cancelled" ? PROMPT_SYMBOL_CANCELLED : PROMPT_SYMBOL_ACTIVE;
  const lines = [`${promptSymbol}  ${pc.bold(state.message)}`];
  if (status === "cancelled") {
    lines.push(`${BAR_SYMBOL}  ${pc.strikethrough(pc.dim("Cancelled"))}`);
    return lines;
  }
  if (status === "submitted") {
    lines.push(
      `${BAR_SYMBOL}  ${pc.dim(state.value ? state.activeLabel : state.inactiveLabel)}`
    );
    return lines;
  }
  lines.push(
    `${BAR_SYMBOL}  ${renderConfirmOption(state.activeLabel, state.value)} / ${renderConfirmOption(state.inactiveLabel, !state.value)}`,
    pc.dim("└")
  );
  return lines;
}

export function handleConfirmPromptKeypress(input: {
  key: Key;
  state: ConfirmPromptState;
  str: string | undefined;
}): InteractivePromptKeypressResult<ConfirmPromptState, ConfirmPromptResult> {
  if (isReturnKeypress({ key: input.key, str: input.str })) {
    return {
      type: "result",
      result: input.state.value ? "confirmed" : "declined",
      status: "submitted",
      state: input.state,
    };
  }
  if (
    input.key.name === "escape" ||
    (input.key.ctrl === true && input.key.name === "c")
  ) {
    return {
      type: "result",
      result: "cancelled",
      status: "cancelled",
      state: input.state,
    };
  }
  if (
    input.key.name === "up" ||
    input.key.name === "down" ||
    input.key.name === "left" ||
    input.key.name === "right" ||
    input.key.name === "tab" ||
    input.key.name === "space"
  ) {
    return {
      type: "state",
      state: { ...input.state, value: !input.state.value },
    };
  }

  const normalized = String(input.str ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "y") {
    return {
      type: "result",
      result: "confirmed",
      status: "submitted",
      state: { ...input.state, value: true },
    };
  }
  if (normalized === "n") {
    return {
      type: "result",
      result: "declined",
      status: "submitted",
      state: { ...input.state, value: false },
    };
  }
  return { type: "ignore" };
}

function renderConfirmOption(label: string, selected: boolean): string {
  return `${selected ? SELECTED_SYMBOL : UNSELECTED_SYMBOL} ${label}`;
}
