import pc from "picocolors";
import { errLine, outJsonLine, outLine } from "../../ui/io";
import { sanitizeTerminalDisplayText } from "../../ui/terminal-safe-text";
import { formatMessage, type MessageKey } from "../messages";
import type {
  Presenter,
  PresenterEventKind,
  PresenterFactoryInput,
} from "./types";

export function createHumanPresenter(input: PresenterFactoryInput): Presenter {
  const messageOverrides = input.context.viewCustomization?.messages?.human;
  const dataMode = input.context.viewCustomization?.render?.human?.dataMode;

  return {
    view: "human",
    event: (
      kind: PresenterEventKind,
      key: MessageKey,
      params?: Record<string, unknown>
    ) => {
      const message = sanitizeTerminalDisplayText(
        formatMessage("human", key, params, messageOverrides),
        "single-line"
      );
      errLine(formatHumanEventForTerminal({ kind, key, message }));
    },
    line: ({ text }: { code: string; text: string }) => {
      outLine(text);
    },
    data: (inputData: { code: string; payload: unknown }) => {
      if (dataMode === "envelope") {
        outJsonLine({
          type: "result",
          code: inputData.code,
          payload: inputData.payload,
        });
        return;
      }
      outJsonLine(inputData.payload);
    },
  };
}

type TerminalEventTone = "neutral" | "warning" | "error";

function formatHumanEventForTerminal(input: {
  kind: PresenterEventKind;
  key: MessageKey;
  message: string;
}): string {
  if (process.stderr.isTTY !== true) {
    return input.message;
  }
  const tone = resolveTerminalEventTone(input);
  if (tone === "neutral") {
    return input.message;
  }
  const highlightedMessage = colorizeEventMessage({
    message: input.message,
    tone,
  });
  if (shouldInsertTopSpacing({ key: input.key, tone })) {
    return `\n${highlightedMessage}`;
  }
  return highlightedMessage;
}

function resolveTerminalEventTone(input: {
  kind: PresenterEventKind;
  key: MessageKey;
  message: string;
}): TerminalEventTone {
  if (input.kind === "error") {
    return "error";
  }
  if (input.key.startsWith("connect.warn.")) {
    return "warning";
  }
  if (input.key === "connect.closed_with_code_reason") {
    return "warning";
  }
  const normalized = input.message.trim().toLowerCase();
  if (normalized.startsWith("warn:")) {
    return "warning";
  }
  return "neutral";
}

function colorizeEventMessage(input: {
  tone: TerminalEventTone;
  message: string;
}): string {
  if (input.tone === "error") {
    return pc.bold(pc.red(input.message));
  }
  return pc.bold(pc.yellow(input.message));
}

function shouldInsertTopSpacing(input: {
  key: MessageKey;
  tone: TerminalEventTone;
}): boolean {
  if (input.tone === "error") {
    return true;
  }
  return input.key === "connect.closed_with_code_reason";
}
