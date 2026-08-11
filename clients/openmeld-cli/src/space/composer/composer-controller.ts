import { sanitizeText } from "../../protocol/wire";
import type { ComposeDraftState } from "../compose-input";
import { consumeComposeInputLine } from "../compose-input";
import { isSpaceQuitCommand } from "../quit-command";
import type { ComposerIntent } from "./composer-contract";
import { resolveSpaceSlashCommand } from "./slash-command-registry";

export class ComposerController {
  consumeLine(input: {
    line: string;
    draft: ComposeDraftState;
  }): ComposerIntent {
    const action = consumeComposeInputLine(input);

    switch (action.kind) {
      case "quit":
        return { kind: "quit" };

      case "continue":
        return {
          kind: "buffer.updated",
          nextBufferText: composeDraftToBufferText(action.nextDraft),
        };

      case "send":
        return this.consumeEditorSubmit({
          text: action.text,
          nextBufferText: composeDraftToBufferText(action.nextDraft),
        });

      default:
        return assertUnreachable(action);
    }
  }

  consumeLegacyLine(input: {
    line: string;
    bufferText: string;
  }): ComposerIntent {
    return this.consumeLine({
      line: input.line,
      draft: bufferTextToComposeDraft(input.bufferText),
    });
  }

  consumeEditorSubmit(input: {
    text: string;
    nextBufferText?: string;
  }): ComposerIntent {
    // PI-TUI editor submit treats "\" as a literal character. Legacy
    // backslash-continuation only exists on line-based shells.
    const commandIntent = resolveLocalSlashCommandIntent({
      text: input.text,
      nextBufferText: input.nextBufferText ?? "",
    });
    if (commandIntent) {
      return commandIntent;
    }

    const sanitized = sanitizeText(input.text);
    if (!sanitized.ok) {
      return {
        kind: "submit.rejected",
        nextBufferText: input.nextBufferText ?? "",
        reason: sanitized.reason,
      };
    }
    return {
      kind: "submit",
      nextBufferText: input.nextBufferText ?? "",
      text: sanitized.value,
    };
  }
}

function assertUnreachable(value: never): never {
  throw new Error(`Unhandled compose action: ${JSON.stringify(value)}`);
}

function bufferTextToComposeDraft(bufferText: string): ComposeDraftState {
  if (!bufferText) {
    return { lines: [] };
  }
  return {
    lines: bufferText.split("\n"),
  };
}

function composeDraftToBufferText(draft: ComposeDraftState): string {
  return draft.lines.join("\n");
}

function resolveLocalSlashCommandIntent(input: {
  text: string;
  nextBufferText: string;
}): ComposerIntent | null {
  if (isSpaceQuitCommand(input.text)) {
    return {
      kind: "quit",
    };
  }

  const command = resolveSpaceSlashCommand(input.text);
  if (command?.kind === "panel") {
    return {
      kind: "command.panel.open",
      panelKind: command.panelKind,
      nextBufferText: input.nextBufferText,
    };
  }

  switch (command?.action) {
    case "quit":
      return {
        kind: "quit",
      };
    default:
      return null;
  }
}
