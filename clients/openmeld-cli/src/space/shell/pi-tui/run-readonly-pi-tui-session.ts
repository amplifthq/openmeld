import type { SpacePanelKind } from "../../panel/space-panel-definition";
import type { SpaceScreenStore } from "../../state/space-screen-store";
import type {
  SpaceSessionContext,
  SpaceSessionDiagnosticsViewState,
} from "../../view/space-session-view-state";
import { mountPiTuiSessionShell } from "./mount-pi-tui-session-shell";
import { PiTuiInteractiveSpaceShell } from "./pi-tui-interactive-space-shell";

type ReadonlyPiTuiSessionResources = {
  sessionDiagnostics?: SpaceSessionDiagnosticsViewState;
};

export async function runReadonlyPiTuiSession(input: {
  context: SpaceSessionContext;
  getResources?: () => ReadonlyPiTuiSessionResources;
  store: SpaceScreenStore;
  syncOverlayInteraction?: (kind: SpacePanelKind) => void;
}): Promise<void> {
  let resolveClosed: (() => void) | null = null;
  const closedPromise = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });
  const shell = new PiTuiInteractiveSpaceShell({
    onBufferChange: () => undefined,
    onClose: () => {
      resolveClosed?.();
    },
    onOpenOverlay: (kind) => {
      input.store.dispatch({
        type: "overlay.interaction.reset",
      });
      input.store.dispatch({
        type: "overlay.opened",
        kind,
        openedAtMs: Date.now(),
      });
      input.syncOverlayInteraction?.(kind);
    },
    onOverlayActiveItemChange: (activeItemId) => {
      input.store.dispatch({
        type: "overlay.active-item.updated",
        activeItemId,
      });
    },
    onOverlayClose: () => {
      input.store.dispatch({
        type: "overlay.closed",
      });
    },
    onOverlayQueryChange: (query) => {
      input.store.dispatch({
        type: "overlay.query.updated",
        query,
      });
      input.syncOverlayInteraction?.("members");
    },
    onSubmit: () => undefined,
  });
  const { removeStoreListener } = mountPiTuiSessionShell({
    context: input.context,
    getResources: input.getResources,
    shell,
    store: input.store,
  });

  try {
    shell.start();
    await closedPromise;
  } finally {
    removeStoreListener();
    shell.stop();
  }
}
