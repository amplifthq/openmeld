import {
  formatOpenMeldCliLine,
  formatOpenMeldCliTextBlock,
} from "./cli-entry-command";
import type { DualViewGuideInput } from "./dual-view-guide";

export function formatDualViewGuideForDisplay(
  input: DualViewGuideInput
): DualViewGuideInput {
  return {
    summary: formatOpenMeldCliTextBlock(input.summary),
    humanSteps: input.humanSteps.map((item) => formatOpenMeldCliLine(item)),
    ...(input.agentRequiredArgs
      ? {
          agentRequiredArgs: input.agentRequiredArgs.map((item) =>
            formatOpenMeldCliLine(item)
          ),
        }
      : {}),
    ...(input.agentOptionalArgs
      ? {
          agentOptionalArgs: input.agentOptionalArgs.map((item) =>
            formatOpenMeldCliLine(item)
          ),
        }
      : {}),
    ...(input.agentCommands
      ? {
          agentCommands: input.agentCommands.map((item) =>
            formatOpenMeldCliLine(item)
          ),
        }
      : {}),
    ...(input.notes
      ? {
          notes: input.notes.map((item) => formatOpenMeldCliTextBlock(item)),
        }
      : {}),
  };
}
