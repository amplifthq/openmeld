import type { SpaceScreenStore } from "../../state/space-screen-store";
import type { ComposerActivitySource } from "../../view/build-composer-activity-view-state";
import { buildSpaceSessionViewState } from "../../view/build-space-session-view-state";
import type {
  SpaceSessionContext,
  SpaceSessionDiagnosticsViewState,
} from "../../view/space-session-view-state";
import type { PiTuiInteractiveSpaceShell } from "./pi-tui-interactive-space-shell";

type PiTuiSessionResources = {
  composerActivity?: ComposerActivitySource;
  sessionDiagnostics?: SpaceSessionDiagnosticsViewState;
};

export function mountPiTuiSessionShell(input: {
  context: SpaceSessionContext;
  getResources?: () => PiTuiSessionResources;
  shell: PiTuiInteractiveSpaceShell;
  store: SpaceScreenStore;
}): {
  removeStoreListener: () => void;
  refreshViewState: () => void;
} {
  const refreshViewState = (): void => {
    input.shell.render(
      buildSpaceSessionViewState({
        context: input.context,
        resources: input.getResources?.(),
        screenState: input.store.getState(),
      })
    );
  };

  const removeStoreListener = input.store.subscribe(() => {
    refreshViewState();
  });
  refreshViewState();

  return {
    removeStoreListener,
    refreshViewState,
  };
}
