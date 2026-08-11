import {
  Container,
  Key,
  matchesKey,
  type OverlayOptions,
  ProcessTerminal,
  type Terminal,
  TUI,
} from "@mariozechner/pi-tui";
import pc from "picocolors";
import { renderOpenMeldBrandAccent } from "../../../ui/brand";
import type { SpacePanelKind } from "../../panel/space-panel-definition";
import {
  resolveReadonlyOverlayShortcut,
  resolveReadonlySessionFooterText,
} from "../../readonly-session-shortcuts";
import type {
  PanelViewState,
  SpaceSessionViewState,
} from "../../view/space-session-view-state";
import type { InteractiveSpaceShell } from "../interactive-space-shell";
import { ComposerActivityStrip } from "./components/composer-activity-strip";
import { ComposerPanel } from "./components/composer-panel";
import {
  ReadonlyOverlayPanel,
  SearchableOverlayPanel,
} from "./components/overlay-host";
import { SessionDocumentPanel } from "./components/session-document-panel";
import { StatusBar } from "./components/status-bar";
import { TranscriptReaderOverlay } from "./components/transcript-reader-overlay";
import { PiTuiComposerAutocompleteProvider } from "./pi-tui-composer-autocomplete-provider";
import { spacePiTuiEditorTheme } from "./theme";

const OVERLAY_MODAL_WIDTH = "78%" as const;
const OVERLAY_MODAL_MAX_HEIGHT_PERCENT = 70;
const OVERLAY_MODAL_MAX_HEIGHT = "70%" as const;
const CTRL_C_EXIT_CONFIRMATION_WINDOW_MS = 1500;
const CTRL_C_EXIT_CONFIRMATION_TEXT = renderOpenMeldBrandAccent(
  "Press Ctrl+C again to leave this Space."
);

type PiTuiInteractiveSpaceShellInput = {
  getRecentMentionProfileIds?: () => readonly string[];
  onBufferChange: (bufferText: string) => void;
  onClose: () => void;
  onOverlayClose: () => void;
  onOverlayActiveItemChange: (activeItemId: string | null) => void;
  onOverlayQueryChange: (query: string) => void;
  onOpenOverlay?: (kind: SpacePanelKind) => void;
  onSubmit: (text: string) => void;
  terminal?: Terminal;
};

export class PiTuiInteractiveSpaceShell implements InteractiveSpaceShell {
  readonly #input: PiTuiInteractiveSpaceShellInput;
  readonly #terminal: Terminal;
  readonly #tui: TUI;
  readonly #root = new Container();
  readonly #sessionDocumentPanel = new SessionDocumentPanel();
  readonly #composerActivityStrip: ComposerActivityStrip;
  readonly #composerPanel: ComposerPanel;
  readonly #statusBar = new StatusBar();

  #latestViewState: SpaceSessionViewState | null = null;
  #started = false;
  #syncingEditorText = false;
  #overlayHandle: ReturnType<TUI["showOverlay"]> | null = null;
  #overlayPanel:
    | ReadonlyOverlayPanel
    | SearchableOverlayPanel
    | TranscriptReaderOverlay
    | null = null;
  #overlayKind: SpaceSessionViewState["overlay"]["kind"] | "transcript-reader" =
    "none";
  #removeInputListener: (() => void) | null = null;
  #composerVisible = false;
  #ctrlCExitTimeout: ReturnType<typeof setTimeout> | null = null;
  #ctrlCExitDeadlineMs: number | null = null;

  constructor(input: PiTuiInteractiveSpaceShellInput) {
    this.#input = input;
    this.#terminal = input.terminal ?? new ProcessTerminal();
    this.#tui = new TUI(this.#terminal, true);
    this.#composerActivityStrip = new ComposerActivityStrip(this.#tui);
    this.#composerPanel = new ComposerPanel(this.#tui, spacePiTuiEditorTheme);
    this.#composerPanel.editor.setAutocompleteProvider(
      new PiTuiComposerAutocompleteProvider({
        getMembersSnapshot: () =>
          this.#latestViewState?.resources.membersSnapshot ?? null,
        getRecentMentionProfileIds: () =>
          this.#input.getRecentMentionProfileIds?.() ?? [],
      })
    );
    this.#composerPanel.editor.onChange = (text) => {
      if (this.#syncingEditorText) {
        return;
      }
      this.#input.onBufferChange(text);
    };
    this.#composerPanel.editor.onSubmit = (text) => {
      this.#input.onSubmit(text);
    };

    this.#root.addChild(this.#sessionDocumentPanel);
    this.#root.addChild(this.#composerActivityStrip);
    this.#root.addChild(this.#composerPanel);
    this.#root.addChild(this.#statusBar);
    this.#tui.addChild(this.#root);
    this.#composerPanel.setVisible(false);
    this.#tui.setFocus(this.#composerPanel.editor);
  }

  start(): void {
    if (this.#started) {
      return;
    }
    this.#started = true;
    if (this.#latestViewState) {
      this.#applyViewState(this.#latestViewState);
    }
    this.#removeInputListener = this.#tui.addInputListener((data) =>
      this.#handleInput(data)
    );
    this.#tui.start();
  }

  render(viewState: SpaceSessionViewState): void {
    this.#latestViewState = viewState;
    if (!this.#started) {
      return;
    }
    this.#applyViewState(viewState);
    this.#requestUiRender();
  }

  #applyViewState(viewState: SpaceSessionViewState): void {
    this.#sessionDocumentPanel.setBlocks(viewState.sessionDocument.blocks);
    this.#composerActivityStrip.setActivity(viewState.composerActivity);
    this.#composerVisible = viewState.composer.visible;
    this.#composerPanel.setVisible(viewState.composer.visible);
    this.#composerPanel.setLeadingBlankLines(
      viewState.composerActivity.visible ? 0 : 1
    );
    this.#composerPanel.setHelperText(viewState.composer.helperText);
    this.#composerPanel.setSummarySegments(
      viewState.spaceSummary.composerFooterSegments
    );
    this.#composerPanel.setPlaceholderText(viewState.composer.placeholderText);
    this.#composerPanel.setShowPlaceholder(viewState.composer.showPlaceholder);
    this.#syncStatusBar();
    this.#syncEditorText(viewState.composer.bufferText);
    this.#syncOverlay(viewState);
    if (this.#composerVisible && !this.#overlayHandle) {
      this.#tui.setFocus(this.#composerPanel.editor);
    }
  }

  clearSubmittedInputLine(_line: string): void {
    // The editor clears its own submitted buffer during submit handling.
  }

  prepareExternalWrite(): void {
    if (!this.#started) {
      return;
    }
    this.#tui.invalidate();
    setImmediate(() => {
      this.#requestHardResetRender();
    });
  }

  stop(): void {
    if (!this.#started) {
      return;
    }
    this.#started = false;
    this.#overlayHandle?.hide();
    this.#overlayHandle = null;
    this.#overlayPanel = null;
    this.#overlayKind = "none";
    this.#clearCtrlCExitConfirmation();
    this.#removeInputListener?.();
    this.#removeInputListener = null;
    this.#composerActivityStrip.stop();
    this.#tui.stop();
  }

  #syncStatusBar(): void {
    this.#statusBar.setText(this.#resolveStatusBarText());
  }

  #resolveStatusBarText(): string {
    if (this.#ctrlCExitDeadlineMs !== null) {
      return CTRL_C_EXIT_CONFIRMATION_TEXT;
    }
    if (!this.#latestViewState) {
      return "";
    }
    return resolveReadonlyFooterText(this.#latestViewState);
  }

  #shouldConfirmCtrlCExitNow(): boolean {
    return (
      this.#ctrlCExitDeadlineMs !== null &&
      Date.now() <= this.#ctrlCExitDeadlineMs
    );
  }

  #handleInput(data: string): { consume: true } | undefined {
    const isCtrlC = matchesKey(data, Key.ctrl("c")) || data === "\u0003";
    if (this.#ctrlCExitDeadlineMs !== null && !isCtrlC) {
      this.#clearCtrlCExitConfirmation();
    }
    if (isCtrlC) {
      return this.#handleCtrlCInput();
    }
    if (matchesKey(data, Key.ctrl("d"))) {
      return this.#handleCtrlDInput();
    }
    if (this.#isTranscriptReaderOpen() && !this.#composerVisible) {
      const overlayKind = resolveReadonlyOverlayShortcut(data);
      if (overlayKind) {
        this.#closeTranscriptReader({
          restoreComposerFocus: false,
        });
        this.#input.onOpenOverlay?.(overlayKind);
        return { consume: true };
      }
    }
    if (isTranscriptNavigationInput(data)) {
      if (this.#overlayHandle) {
        return undefined;
      }
      if (this.#openTranscriptReader(data)) {
        return { consume: true };
      }
    }
    if (this.#composerVisible || this.#overlayHandle) {
      return undefined;
    }
    return this.#handleReadonlyInput(data);
  }

  #handleCtrlCInput(): { consume: true } {
    if (!this.#composerVisible) {
      this.#input.onClose();
      return { consume: true };
    }
    if (this.#shouldConfirmCtrlCExitNow()) {
      this.#clearCtrlCExitConfirmation();
      this.#input.onClose();
      return { consume: true };
    }
    this.#armCtrlCExitConfirmation();
    return { consume: true };
  }

  #handleCtrlDInput(): { consume: true } | undefined {
    if (this.#overlayHandle) {
      return undefined;
    }
    this.#input.onClose();
    return { consume: true };
  }

  #handleReadonlyInput(data: string): { consume: true } {
    const overlayKind = resolveReadonlyOverlayShortcut(data);
    if (overlayKind) {
      this.#input.onOpenOverlay?.(overlayKind);
      return { consume: true };
    }
    if (data === "q") {
      this.#input.onClose();
      return { consume: true };
    }
    return { consume: true };
  }

  #armCtrlCExitConfirmation(): void {
    this.#clearCtrlCExitConfirmationTimer();
    this.#ctrlCExitDeadlineMs = Date.now() + CTRL_C_EXIT_CONFIRMATION_WINDOW_MS;
    this.#syncStatusBar();
    this.#requestUiRender();
    this.#ctrlCExitTimeout = setTimeout(() => {
      this.#ctrlCExitTimeout = null;
      this.#ctrlCExitDeadlineMs = null;
      this.#syncStatusBar();
      this.#requestUiRender();
    }, CTRL_C_EXIT_CONFIRMATION_WINDOW_MS);
  }

  #clearCtrlCExitConfirmation(): void {
    if (this.#ctrlCExitDeadlineMs === null && this.#ctrlCExitTimeout === null) {
      return;
    }
    this.#clearCtrlCExitConfirmationTimer();
    this.#ctrlCExitDeadlineMs = null;
    this.#syncStatusBar();
    this.#requestUiRender();
  }

  #clearCtrlCExitConfirmationTimer(): void {
    if (this.#ctrlCExitTimeout === null) {
      return;
    }
    clearTimeout(this.#ctrlCExitTimeout);
    this.#ctrlCExitTimeout = null;
  }

  #syncEditorText(nextBufferText: string): void {
    if (this.#composerPanel.editor.getText() === nextBufferText) {
      return;
    }
    this.#syncingEditorText = true;
    try {
      this.#composerPanel.editor.setText(nextBufferText);
    } finally {
      this.#syncingEditorText = false;
    }
  }

  #syncOverlay(viewState: SpaceSessionViewState): void {
    const panel = viewState.overlay.panel;
    if (!panel) {
      if (this.#isTranscriptReaderOpen()) {
        this.#syncTranscriptReader(viewState);
        return;
      }
      if (this.#overlayHandle) {
        this.#overlayHandle.hide();
        this.#overlayHandle = null;
        this.#overlayPanel = null;
        this.#overlayKind = "none";
        if (this.#composerVisible) {
          this.#tui.setFocus(this.#composerPanel.editor);
        }
      }
      return;
    }

    if (this.#isTranscriptReaderOpen()) {
      this.#closeTranscriptReader({
        restoreComposerFocus: false,
      });
    }

    if (!(this.#overlayHandle && this.#overlayKind === panel.kind)) {
      this.#overlayHandle?.hide();
      const overlayPanel = this.#createOverlayPanel(panel);
      this.#overlayPanel = overlayPanel;
      this.#overlayHandle = this.#tui.showOverlay(
        overlayPanel,
        this.#resolveOverlayLayout(panel)
      );
      this.#overlayKind = panel.kind;
      return;
    }

    if (
      this.#overlayPanel instanceof ReadonlyOverlayPanel ||
      this.#overlayPanel instanceof SearchableOverlayPanel
    ) {
      this.#overlayPanel.setPanel(panel);
    }
    this.#overlayHandle.focus();
    this.#requestUiRender();
  }

  #createOverlayPanel(
    panel: PanelViewState
  ): ReadonlyOverlayPanel | SearchableOverlayPanel {
    switch (panel.mode) {
      case "readonly":
        return new ReadonlyOverlayPanel({
          getMaxPanelRows: () =>
            resolveOverlayMaxPanelRows(this.#terminal.rows),
          panel,
          onClose: this.#input.onOverlayClose,
        });
      case "searchable_list":
        return new SearchableOverlayPanel({
          getMaxPanelRows: () =>
            resolveOverlayMaxPanelRows(this.#terminal.rows),
          onActiveItemChange: this.#input.onOverlayActiveItemChange,
          onClose: this.#input.onOverlayClose,
          onQueryChange: this.#input.onOverlayQueryChange,
          panel,
        });
      default:
        return assertUnreachable(panel.mode);
    }
  }

  #openTranscriptReader(initialInput?: string): boolean {
    if (this.#overlayHandle || !this.#latestViewState) {
      return false;
    }

    const overlayPanel = new TranscriptReaderOverlay({
      blocks: this.#latestViewState.transcript.blocks,
      getMaxPanelRows: () => resolveOverlayMaxPanelRows(this.#terminal.rows),
      onClose: () => {
        this.#closeTranscriptReader();
      },
    });
    this.#overlayPanel = overlayPanel;
    this.#overlayHandle = this.#tui.showOverlay(
      overlayPanel,
      this.#resolveCenteredOverlayLayout()
    );
    this.#overlayKind = "transcript-reader";
    if (initialInput) {
      overlayPanel.handleInput(initialInput);
    }
    this.#requestUiRender();
    return true;
  }

  #closeTranscriptReader(input?: { restoreComposerFocus?: boolean }): void {
    if (!this.#isTranscriptReaderOpen()) {
      return;
    }

    this.#overlayHandle?.hide();
    this.#overlayHandle = null;
    this.#overlayPanel = null;
    this.#overlayKind = "none";
    if ((input?.restoreComposerFocus ?? true) && this.#composerVisible) {
      this.#tui.setFocus(this.#composerPanel.editor);
    }
    this.#requestUiRender();
  }

  #syncTranscriptReader(viewState: SpaceSessionViewState): void {
    if (!(this.#overlayPanel instanceof TranscriptReaderOverlay)) {
      return;
    }

    this.#overlayPanel.setBlocks(viewState.transcript.blocks);
    this.#overlayHandle?.focus();
    this.#requestUiRender();
  }

  #isTranscriptReaderOpen(): boolean {
    return this.#overlayKind === "transcript-reader";
  }

  #resolveCenteredOverlayLayout(): OverlayOptions {
    return {
      anchor: "center",
      width: OVERLAY_MODAL_WIDTH,
      maxHeight: OVERLAY_MODAL_MAX_HEIGHT,
    };
  }

  #resolveOverlayLayout(panel: PanelViewState): OverlayOptions {
    switch (panel.layout) {
      case "centered_modal":
        return this.#resolveCenteredOverlayLayout();
      default:
        return assertUnreachable(panel.layout);
    }
  }

  #requestUiRender(): void {
    if (!this.#started) {
      return;
    }
    this.#tui.requestRender();
  }

  #requestHardResetRender(): void {
    if (!this.#started) {
      return;
    }
    this.#tui.requestRender(true);
  }
}

function resolveReadonlyFooterText(viewState: SpaceSessionViewState): string {
  if (viewState.surface !== "active-session" || viewState.composer.visible) {
    return "";
  }
  if (viewState.context.connectionMode === "watch") {
    return pc.dim(resolveReadonlySessionFooterText("watch"));
  }
  if (viewState.context.connectionMode === "history") {
    return pc.dim(resolveReadonlySessionFooterText("history"));
  }
  return "";
}

function resolveOverlayMaxPanelRows(rows: number): number {
  if (!(Number.isFinite(rows) && rows > 0)) {
    return 1;
  }
  return Math.max(
    1,
    Math.floor((rows * OVERLAY_MODAL_MAX_HEIGHT_PERCENT) / 100)
  );
}

function isTranscriptNavigationInput(data: string): boolean {
  return (
    matchesKey(data, Key.pageUp) ||
    matchesKey(data, Key.pageDown) ||
    matchesKey(data, Key.home) ||
    matchesKey(data, Key.end)
  );
}

function assertUnreachable(value: never): never {
  throw new Error(`Unsupported PI-TUI overlay state: ${String(value)}`);
}
