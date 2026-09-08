import type { SpaceComposerAuthoredMentionInTextOrder } from "@openmeld/space";
import type { SpaceSessionViewState } from "../view/space-session-view-state";

export type InteractiveSpaceShell = {
  getAuthoredMentions?(
    text: string
  ): readonly SpaceComposerAuthoredMentionInTextOrder[];
  start(): void;
  render(viewState: SpaceSessionViewState): void;
  clearSubmittedInputLine(line: string): void;
  prepareExternalWrite(): void;
  stop(): void;
};
