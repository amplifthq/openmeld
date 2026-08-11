import type { SpaceSessionViewState } from "../view/space-session-view-state";

export type InteractiveSpaceShell = {
  start(): void;
  render(viewState: SpaceSessionViewState): void;
  clearSubmittedInputLine(line: string): void;
  prepareExternalWrite(): void;
  stop(): void;
};
