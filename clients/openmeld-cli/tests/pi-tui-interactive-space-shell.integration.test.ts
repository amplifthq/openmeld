import { stripVTControlCharacters } from "node:util";
import type { Terminal } from "@mariozechner/pi-tui";
import {
  createSpaceMemberAgentSnapshot,
  createSpaceMemberHumanSnapshot,
  createSpaceMembersSnapshot,
} from "@openmeld/schemas/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getCliVersionInfo } from "../src/runtime/cli-version";
import { PiTuiInteractiveSpaceShell } from "../src/space/shell/pi-tui/pi-tui-interactive-space-shell";
import {
  createInitialSpaceScreenState,
  type SpaceScreenState,
} from "../src/space/state/space-screen-state";
import type { ComposerActivitySource } from "../src/space/view/build-composer-activity-view-state";
import { buildSpaceSessionViewState } from "../src/space/view/build-space-session-view-state";
import type { SpaceSessionContext } from "../src/space/view/space-session-view-state";
import {
  OPENMELD_COMPOSER_SURFACE_BG_RGB,
  renderOpenMeldBrandAccent,
} from "../src/ui/brand";
import { resolveAgentSurfaceRgb } from "../src/ui/profile-label-color";

const COMPOSER_HELPER_RENDER_REGEX =
  /connected as Felix · Enter sends · Shift\+Enter newline · \/ commands · @ mentions[^\n]*\n[^\n]*\n › /u;
const COMPOSER_HELPER_TEXT =
  "connected as Felix · Enter sends · Shift+Enter newline · / commands · @ mentions";
const SPACE_HEADER_PRODUCT_LABEL = "OPENMELD • https://openmeld.ai";
const SPACE_HEADER_TAGLINE = "Connect with any agents and humans in real time";
const HARD_RESET_RENDER_SEQUENCE = "\u001B[3J\u001B[2J\u001B[H";
const OPS_AGENT_PROFILE_ID = "agt_22222222-2222-4222-8222-222222222222";

describe("PiTuiInteractiveSpaceShell", () => {
  const originalColumns = process.stdout.columns;
  const originalIsTTY = process.stdout.isTTY;

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      value: originalColumns,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: originalIsTTY,
    });
  });

  it("submits editor text through the shell callback", async () => {
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      value: 120,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });

    let state = createInitialSpaceScreenState();
    const fakeTerminal = createFakeTerminal();
    const onSubmit = vi.fn();
    const onBufferChange = vi.fn((bufferText: string) => {
      state = {
        ...state,
        composer: {
          bufferText,
        },
      };
    });
    const shell = new PiTuiInteractiveSpaceShell({
      onBufferChange,
      onClose: vi.fn(),
      onOverlayActiveItemChange: vi.fn(),
      onOverlayClose: vi.fn(),
      onOverlayQueryChange: vi.fn(),
      onSubmit,
      terminal: fakeTerminal,
    });

    shell.start();
    shell.render(createViewState(state));
    fakeTerminal.emit("h");
    fakeTerminal.emit("i");
    fakeTerminal.emit("\r");
    await waitForPiTuiRender();

    expect(onBufferChange).toHaveBeenCalledWith("h");
    expect(onBufferChange).toHaveBeenCalledWith("hi");
    expect(onSubmit).toHaveBeenCalledWith("hi");
    shell.stop();
  });

  it("does not render a visible composer frame before the first session view arrives", async () => {
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      value: 120,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });

    const fakeTerminal = createFakeTerminal();
    const shell = new PiTuiInteractiveSpaceShell({
      onBufferChange: vi.fn(),
      onClose: vi.fn(),
      onOverlayActiveItemChange: vi.fn(),
      onOverlayClose: vi.fn(),
      onOverlayQueryChange: vi.fn(),
      onSubmit: vi.fn(),
      terminal: fakeTerminal,
    });

    shell.start();
    await waitForPiTuiRender();

    const output = stripVTControlCharacters(
      fakeTerminal.getOutput()
    ).replaceAll("\r", "");
    expect(output).not.toContain(COMPOSER_HELPER_TEXT);
    expect(output).not.toContain("Message the space...");
    expect(output).not.toContain(SPACE_HEADER_PRODUCT_LABEL);
    shell.stop();
  });

  it("renders the cached latest session view as the first visible frame on start", async () => {
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      value: 120,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });

    const fakeTerminal = createFakeTerminal();
    const shell = new PiTuiInteractiveSpaceShell({
      onBufferChange: vi.fn(),
      onClose: vi.fn(),
      onOverlayActiveItemChange: vi.fn(),
      onOverlayClose: vi.fn(),
      onOverlayQueryChange: vi.fn(),
      onSubmit: vi.fn(),
      terminal: fakeTerminal,
    });

    shell.render(createViewState(createStateWithTranscriptMessages(8)));
    shell.start();
    await waitForPiTuiRender();

    const output = stripVTControlCharacters(
      fakeTerminal.getOutput()
    ).replaceAll("\r", "");
    expect(output).toContain(SPACE_HEADER_PRODUCT_LABEL);
    expect(output).toContain("20260314 15:00:00");
    expect(countOccurrences(output, COMPOSER_HELPER_TEXT)).toBe(1);
    expect(countOccurrences(output, "Message the space...")).toBe(1);
    shell.stop();
  });

  it("treats a lone trailing backslash as literal text on submit", async () => {
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      value: 120,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });

    let state = createInitialSpaceScreenState();
    const fakeTerminal = createFakeTerminal();
    const onSubmit = vi.fn();
    const onBufferChange = vi.fn((bufferText: string) => {
      state = {
        ...state,
        composer: {
          bufferText,
        },
      };
    });
    const shell = new PiTuiInteractiveSpaceShell({
      onBufferChange,
      onClose: vi.fn(),
      onOverlayActiveItemChange: vi.fn(),
      onOverlayClose: vi.fn(),
      onOverlayQueryChange: vi.fn(),
      onSubmit,
      terminal: fakeTerminal,
    });

    shell.start();
    shell.render(createViewState(state));
    fakeTerminal.emit("\\");
    fakeTerminal.emit("\r");
    await waitForPiTuiRender();

    expect(onBufferChange).toHaveBeenCalledWith("\\");
    expect(onSubmit).toHaveBeenCalledWith("\\");
    shell.stop();
  });

  it("keeps editor newline input working after disabling backslash continuation", async () => {
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      value: 120,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });

    let state = createInitialSpaceScreenState();
    const fakeTerminal = createFakeTerminal();
    const onSubmit = vi.fn();
    const onBufferChange = vi.fn((bufferText: string) => {
      state = {
        ...state,
        composer: {
          bufferText,
        },
      };
    });
    const shell = new PiTuiInteractiveSpaceShell({
      onBufferChange,
      onClose: vi.fn(),
      onOverlayActiveItemChange: vi.fn(),
      onOverlayClose: vi.fn(),
      onOverlayQueryChange: vi.fn(),
      onSubmit,
      terminal: fakeTerminal,
    });

    shell.start();
    shell.render(createViewState(state));
    fakeTerminal.emit("a");
    fakeTerminal.emit("\n");
    fakeTerminal.emit("b");
    fakeTerminal.emit("\r");
    await waitForPiTuiRender();

    expect(onBufferChange).toHaveBeenCalledWith("a\n");
    expect(onBufferChange).toHaveBeenCalledWith("a\nb");
    expect(onSubmit).toHaveBeenCalledWith("a\nb");
    shell.stop();
  });

  it("opens a nested mention picker and inserts a canonical literal after relation selection", async () => {
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      value: 120,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });

    let state = createStateWithMentionAuthoringMembers();
    const fakeTerminal = createFakeTerminal();
    const onBufferChange = vi.fn((bufferText: string) => {
      state = {
        ...state,
        composer: {
          ...state.composer,
          bufferText,
        },
      };
      shell.render(createViewState(state));
    });
    const shell = new PiTuiInteractiveSpaceShell({
      onBufferChange,
      onClose: vi.fn(),
      onOverlayActiveItemChange: vi.fn(),
      onOverlayClose: vi.fn(),
      onOverlayQueryChange: vi.fn(),
      onSubmit: vi.fn(),
      terminal: fakeTerminal,
    });

    shell.start();
    shell.render(createViewState(state));
    fakeTerminal.emit("@");
    await waitForPiTuiRender();

    let output = stripVTControlCharacters(fakeTerminal.getOutput()).replaceAll(
      "\r",
      ""
    );
    expect(output).toContain("→ Ops Bot");
    expect(output).not.toContain("@Ops Bot(wake)");

    fakeTerminal.emit("\r");
    await waitForPiTuiRender();

    output = stripVTControlCharacters(fakeTerminal.getOutput()).replaceAll(
      "\r",
      ""
    );
    expect(output).toContain("  Ops Bot");
    expect(output).toContain("Wake");
    expect(output).toContain("Reference");
    expect(output).not.toContain("CC");
    expect(output).toContain("Back");

    fakeTerminal.emit("\r");
    await waitForPiTuiRender();

    expect(state.composer.bufferText).toBe("@Ops Bot(wake) ");
    shell.stop();
  });

  it("returns from the relation menu back to the target list on left arrow and escape", async () => {
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      value: 120,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });

    let state = createStateWithMentionAuthoringMembers();
    const fakeTerminal = createFakeTerminal();
    const onBufferChange = vi.fn((bufferText: string) => {
      state = {
        ...state,
        composer: {
          ...state.composer,
          bufferText,
        },
      };
      shell.render(createViewState(state));
    });
    const shell = new PiTuiInteractiveSpaceShell({
      onBufferChange,
      onClose: vi.fn(),
      onOverlayActiveItemChange: vi.fn(),
      onOverlayClose: vi.fn(),
      onOverlayQueryChange: vi.fn(),
      onSubmit: vi.fn(),
      terminal: fakeTerminal,
    });

    shell.start();
    shell.render(createViewState(state));
    fakeTerminal.emit("@");
    fakeTerminal.emit("\r");
    await waitForPiTuiRender();

    let output = stripVTControlCharacters(fakeTerminal.getOutput()).replaceAll(
      "\r",
      ""
    );
    expect(output).toContain("Wake");
    expect(output).toContain("Back");

    fakeTerminal.emit("\u001B[D");
    await waitForPiTuiRender();

    output = stripVTControlCharacters(fakeTerminal.getOutput()).replaceAll(
      "\r",
      ""
    );
    expect(output).toContain("→ Ops Bot");
    expect(state.composer.bufferText).toBe("@");

    fakeTerminal.emit("\r");
    await waitForPiTuiRender();
    fakeTerminal.emit("\u001B");
    await waitForPiTuiRender();

    output = stripVTControlCharacters(fakeTerminal.getOutput()).replaceAll(
      "\r",
      ""
    );
    expect(output).toContain("→ Ops Bot");
    expect(state.composer.bufferText).toBe("@");
    shell.stop();
  });

  it("returns from the relation menu when Back is confirmed", async () => {
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      value: 120,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });

    let state = createStateWithMentionAuthoringMembers();
    const fakeTerminal = createFakeTerminal();
    const onBufferChange = vi.fn((bufferText: string) => {
      state = {
        ...state,
        composer: {
          ...state.composer,
          bufferText,
        },
      };
      shell.render(createViewState(state));
    });
    const shell = new PiTuiInteractiveSpaceShell({
      onBufferChange,
      onClose: vi.fn(),
      onOverlayActiveItemChange: vi.fn(),
      onOverlayClose: vi.fn(),
      onOverlayQueryChange: vi.fn(),
      onSubmit: vi.fn(),
      terminal: fakeTerminal,
    });

    shell.start();
    shell.render(createViewState(state));
    fakeTerminal.emit("@");
    fakeTerminal.emit("\r");
    await waitForPiTuiRender();

    fakeTerminal.emit("\u001B[B");
    fakeTerminal.emit("\u001B[B");
    await waitForPiTuiRender();

    let output = stripVTControlCharacters(fakeTerminal.getOutput()).replaceAll(
      "\r",
      ""
    );
    expect(output).toContain("→ Back");

    fakeTerminal.emit("\r");
    await waitForPiTuiRender();

    output = stripVTControlCharacters(fakeTerminal.getOutput()).replaceAll(
      "\r",
      ""
    );
    expect(output).toContain("→ Ops Bot");
    expect(output).toContain("Felix");
    expect(state.composer.bufferText).toBe("@");
    shell.stop();
  });

  it("returns to target search when typing or deleting inside the relation menu", async () => {
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      value: 120,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });

    let state = createStateWithMentionAuthoringMembers();
    const fakeTerminal = createFakeTerminal();
    const onBufferChange = vi.fn((bufferText: string) => {
      state = {
        ...state,
        composer: {
          ...state.composer,
          bufferText,
        },
      };
      shell.render(createViewState(state));
    });
    const shell = new PiTuiInteractiveSpaceShell({
      onBufferChange,
      onClose: vi.fn(),
      onOverlayActiveItemChange: vi.fn(),
      onOverlayClose: vi.fn(),
      onOverlayQueryChange: vi.fn(),
      onSubmit: vi.fn(),
      terminal: fakeTerminal,
    });

    shell.start();
    shell.render(createViewState(state));
    fakeTerminal.emit("@");
    fakeTerminal.emit("O");
    fakeTerminal.emit("\r");
    await waitForPiTuiRender();

    fakeTerminal.emit("p");
    await waitForPiTuiRender();

    let output = stripVTControlCharacters(fakeTerminal.getOutput()).replaceAll(
      "\r",
      ""
    );
    expect(output).toContain("→ Ops Bot");
    expect(output.lastIndexOf("→ Ops Bot")).toBeGreaterThan(
      output.lastIndexOf("→ Wake")
    );
    expect(state.composer.bufferText).toBe("@Op");

    fakeTerminal.emit("\r");
    await waitForPiTuiRender();
    fakeTerminal.emit("\u007f");
    await waitForPiTuiRender();

    output = stripVTControlCharacters(fakeTerminal.getOutput()).replaceAll(
      "\r",
      ""
    );
    expect(output).toContain("→ Ops Bot");
    expect(output.lastIndexOf("→ Ops Bot")).toBeGreaterThan(
      output.lastIndexOf("→ Wake")
    );
    expect(state.composer.bufferText).toBe("@O");
    shell.stop();
  });

  it("ignores ctrl+d for open overlays and closes them on Esc", async () => {
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      value: 120,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });

    const fakeTerminal = createFakeTerminal();
    const onClose = vi.fn();
    const onOverlayClose = vi.fn();
    const shell = new PiTuiInteractiveSpaceShell({
      onBufferChange: vi.fn(),
      onClose,
      onOverlayActiveItemChange: vi.fn(),
      onOverlayClose,
      onOverlayQueryChange: vi.fn(),
      onSubmit: vi.fn(),
      terminal: fakeTerminal,
    });

    shell.start();
    shell.render(
      createViewState({
        ...createInitialSpaceScreenState(),
        overlay: {
          kind: "help",
          openedAtMs: null,
          interaction: {
            activeItemId: null,
            query: "",
          },
        },
      })
    );
    await waitForPiTuiRender();
    fakeTerminal.emit("\u0004");
    await waitForPiTuiRender();

    expect(fakeTerminal.getOutput()).toContain("Space Commands");
    expect(fakeTerminal.getOutput()).toContain("Press Esc to close.");
    expect(onClose).not.toHaveBeenCalled();
    expect(onOverlayClose).not.toHaveBeenCalled();

    fakeTerminal.emit("\u001B");
    await waitForPiTuiRender();

    expect(onOverlayClose).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    shell.stop();
  });

  it("renders the Space info overlay with a fixed dark panel surface", async () => {
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      value: 120,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });

    const fakeTerminal = createFakeTerminal();
    const shell = new PiTuiInteractiveSpaceShell({
      onBufferChange: vi.fn(),
      onClose: vi.fn(),
      onOverlayActiveItemChange: vi.fn(),
      onOverlayClose: vi.fn(),
      onOverlayQueryChange: vi.fn(),
      onSubmit: vi.fn(),
      terminal: fakeTerminal,
    });

    shell.start();
    shell.render(
      createViewState({
        ...createInitialSpaceScreenState(),
        overlay: {
          kind: "space",
          openedAtMs: null,
          interaction: {
            activeItemId: null,
            query: "",
          },
        },
      })
    );
    await waitForPiTuiRender();

    const output = fakeTerminal.getOutput();
    expect(output).toContain("\u001B[48;2;38;38;38m");
    expect(output).toContain("\u001B[38;2;245;245;245m");
    expect(stripVTControlCharacters(output)).toContain("🛰️ Space Info");
    shell.stop();
  });

  it("refreshes overlay content when the same overlay kind stays open", async () => {
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      value: 120,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });

    const fakeTerminal = createFakeTerminal();
    const shell = new PiTuiInteractiveSpaceShell({
      onBufferChange: vi.fn(),
      onClose: vi.fn(),
      onOverlayActiveItemChange: vi.fn(),
      onOverlayClose: vi.fn(),
      onOverlayQueryChange: vi.fn(),
      onSubmit: vi.fn(),
      terminal: fakeTerminal,
    });

    shell.start();
    shell.render(
      createViewState(
        {
          ...createInitialSpaceScreenState(),
          connection: {
            ...createInitialSpaceScreenState().connection,
            status: "connecting",
          },
          overlay: {
            kind: "space",
            openedAtMs: null,
            interaction: {
              activeItemId: null,
              query: "",
            },
          },
        },
        {},
        createSessionDiagnostics()
      )
    );
    await waitForPiTuiRender();

    shell.render(
      createViewState(
        {
          ...createInitialSpaceScreenState(),
          connection: {
            ...createInitialSpaceScreenState().connection,
            status: "connected",
          },
          overlay: {
            kind: "space",
            openedAtMs: null,
            interaction: {
              activeItemId: null,
              query: "",
            },
          },
        },
        {},
        createSessionDiagnostics()
      )
    );
    await waitForPiTuiRender();

    expect(fakeTerminal.getOutput()).toContain("🛰️ Space Info");
    expect(fakeTerminal.getOutput()).toContain("Space Name  Ops Room");
    shell.stop();
  });

  it("uses overlay.panel as the canonical modal content", async () => {
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      value: 120,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });

    const fakeTerminal = createFakeTerminal();
    const shell = new PiTuiInteractiveSpaceShell({
      onBufferChange: vi.fn(),
      onClose: vi.fn(),
      onOverlayActiveItemChange: vi.fn(),
      onOverlayClose: vi.fn(),
      onOverlayQueryChange: vi.fn(),
      onSubmit: vi.fn(),
      terminal: fakeTerminal,
    });
    const baseViewState = createViewState({
      ...createInitialSpaceScreenState(),
      overlay: {
        kind: "help",
        openedAtMs: null,
        interaction: {
          activeItemId: null,
          query: "",
        },
      },
    });
    const panel = baseViewState.overlay.panel;
    if (!panel) {
      throw new Error("missing overlay panel test fixture");
    }

    shell.start();
    shell.render({
      ...baseViewState,
      overlay: {
        ...baseViewState.overlay,
        panel: {
          ...panel,
          body: {
            blocks: [
              {
                kind: "lines",
                lines: ["panel sentinel"],
              },
            ],
          },
          instructions: panel.instructions,
          mode: "readonly",
          layout: "centered_modal",
          title: "custom overlay",
        },
      },
    });
    await waitForPiTuiRender();

    expect(fakeTerminal.getOutput()).toContain("panel sentinel");
    expect(fakeTerminal.getOutput()).not.toContain(
      "Available Space composer commands"
    );
    shell.stop();
  });

  it("renders the OpenMeld brand and space summary before the interactive composer", async () => {
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      value: 120,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });

    const fakeTerminal = createFakeTerminal();
    const shell = new PiTuiInteractiveSpaceShell({
      onBufferChange: vi.fn(),
      onClose: vi.fn(),
      onOverlayActiveItemChange: vi.fn(),
      onOverlayClose: vi.fn(),
      onOverlayQueryChange: vi.fn(),
      onSubmit: vi.fn(),
      terminal: fakeTerminal,
    });

    shell.start();
    shell.render(
      createViewState(createStateWithMembers(), {
        session: {
          passwordProtected: false,
          spaceId:
            "ab1c3286d92926cc07e70b4023d24a359387d250f670619af138c3a767f92efd",
          spaceName: "pi-tui-ref",
        },
      })
    );
    await waitForPiTuiRender();

    const output = stripVTControlCharacters(
      fakeTerminal.getOutput()
    ).replaceAll("\r", "");
    const spaceId =
      "ab1c3286d92926cc07e70b4023d24a359387d250f670619af138c3a767f92efd";
    expect(output.indexOf(SPACE_HEADER_PRODUCT_LABEL)).toBeLessThan(
      output.indexOf(spaceId)
    );
    expect(output.indexOf(spaceId)).toBeLessThan(
      output.indexOf(COMPOSER_HELPER_TEXT)
    );
    expect(output).toContain(SPACE_HEADER_PRODUCT_LABEL);
    expect(output).toContain(SPACE_HEADER_TAGLINE);
    expect(output).toContain(`v ${getCliVersionInfo().version}`);
    expect(output).toContain("Current Space ›");
    expect(output).toContain("pi-tui-ref");
    expect(output).toContain(spaceId);
    expect(output).toContain("👥 2 · 1 live human · type /members to check");
    expect(output).toContain("⚠️ Public");
    expect(output).toContain(
      "Untrusted space. Anyone with this Space ID can join."
    );
    expect(output).not.toContain("- Felix (human):");
    shell.stop();
  });

  it("renders exactly one live composer region after bootstrap with loaded transcript history", async () => {
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      value: 120,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });

    const fakeTerminal = createFakeTerminal();
    const shell = new PiTuiInteractiveSpaceShell({
      onBufferChange: vi.fn(),
      onClose: vi.fn(),
      onOverlayActiveItemChange: vi.fn(),
      onOverlayClose: vi.fn(),
      onOverlayQueryChange: vi.fn(),
      onSubmit: vi.fn(),
      terminal: fakeTerminal,
    });

    shell.start();
    await waitForPiTuiRender();
    shell.render(createViewState(createStateWithTranscriptMessages(8)));
    await waitForPiTuiRender();

    const output = stripVTControlCharacters(
      fakeTerminal.getOutput()
    ).replaceAll("\r", "");
    expect(output).toContain(SPACE_HEADER_PRODUCT_LABEL);
    expect(output).toContain("20260314 15:00:00");
    expect(countOccurrences(output, COMPOSER_HELPER_TEXT)).toBe(1);
    expect(countOccurrences(output, "Message the space...")).toBe(1);
    shell.stop();
  });

  it("uses only the latest cached pre-start session view for the first visible frame", async () => {
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      value: 120,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });

    const fakeTerminal = createFakeTerminal();
    const shell = new PiTuiInteractiveSpaceShell({
      onBufferChange: vi.fn(),
      onClose: vi.fn(),
      onOverlayActiveItemChange: vi.fn(),
      onOverlayClose: vi.fn(),
      onOverlayQueryChange: vi.fn(),
      onSubmit: vi.fn(),
      terminal: fakeTerminal,
    });

    shell.render(createViewState(createStateWithMembers()));
    shell.render(createViewState(createStateWithTranscriptMessages(8)));
    shell.start();
    await waitForPiTuiRender();

    const output = stripVTControlCharacters(
      fakeTerminal.getOutput()
    ).replaceAll("\r", "");
    const firstTranscriptIndex = output.indexOf("20260314 15:00:00");
    const composerIndex = output.indexOf(COMPOSER_HELPER_TEXT);

    expect(firstTranscriptIndex).toBeGreaterThan(-1);
    expect(composerIndex).toBeGreaterThan(firstTranscriptIndex);
    expect(countOccurrences(output, COMPOSER_HELPER_TEXT)).toBe(1);
    expect(countOccurrences(output, "Message the space...")).toBe(1);
    shell.stop();
  });

  it("keeps the OpenMeld brand and space summary in the document flow instead of legacy cards", async () => {
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      value: 84,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });

    const fakeTerminal = createFakeTerminal({
      columns: 84,
      rows: 24,
    });
    const shell = new PiTuiInteractiveSpaceShell({
      onBufferChange: vi.fn(),
      onClose: vi.fn(),
      onOverlayActiveItemChange: vi.fn(),
      onOverlayClose: vi.fn(),
      onOverlayQueryChange: vi.fn(),
      onSubmit: vi.fn(),
      terminal: fakeTerminal,
    });

    shell.start();
    shell.render(
      createViewState(createStateWithMembers(), {
        session: {
          passwordProtected: false,
          spaceId:
            "ab1c3286d92926cc07e70b4023d24a359387d250f670619af138c3a767f92efd",
          spaceName: "pi-tui-ref",
        },
      })
    );
    await waitForPiTuiRender();

    const output = stripVTControlCharacters(
      fakeTerminal.getOutput()
    ).replaceAll("\r", "");
    expect(output).toContain(SPACE_HEADER_PRODUCT_LABEL);
    expect(output).toContain("Current Space ›");
    expect(output).toContain("pi-tui-ref");
    expect(output).toContain(
      "ab1c3286d92926cc07e70b4023d24a359387d250f670619af138c3a767f92efd"
    );
    expect(output).toContain("👥 2 · 1 live human · type /members to check");
    expect(output).toContain("⚠️ Public");
    expect(output).toContain(
      "Untrusted space. Anyone with this Space ID can join."
    );
    expect(output).not.toContain("🛰️ Space Info");
    expect(output).not.toContain("👥 Space Members");
    shell.stop();
  });

  it("renders transcript bubbles after the summary while keeping system lines plain", async () => {
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      value: 120,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });

    const fakeTerminal = createFakeTerminal();
    const shell = new PiTuiInteractiveSpaceShell({
      onBufferChange: vi.fn(),
      onClose: vi.fn(),
      onOverlayActiveItemChange: vi.fn(),
      onOverlayClose: vi.fn(),
      onOverlayQueryChange: vi.fn(),
      onSubmit: vi.fn(),
      terminal: fakeTerminal,
    });

    shell.start();
    shell.render(
      createViewState({
        ...createStateWithMembers(),
        transcript: {
          items: [
            {
              groupKey: "profile-id:11111111-1111-4111-8111-111111111111",
              kind: "message",
              line: "- 👤 Felix 20260313 03:04: @ops-bot hey\nhuman · space creator · seen now",
              ts: new Date(2026, 2, 14, 15, 40).getTime(),
            },
            {
              groupKey: "profile-id:hum_amy",
              kind: "message",
              line: "- 👤 Amy 20260313 03:04: hello from amy",
              ts: new Date(2026, 2, 14, 15, 41).getTime(),
            },
            {
              groupKey: "system",
              kind: "presence",
              line: "* 📣 system: 👤 Mengyao Li left the space.",
              ts: new Date(2026, 2, 14, 15, 42).getTime(),
              presenceAction: "left",
              actorProfileId: "hum_mengyao",
              actorKind: "human",
              actorLabel: "Mengyao Li",
              actorAvatar: "👤",
            },
            {
              groupKey: "system",
              kind: "membership_notice",
              line: "Felix added 🤖 Ops Bot to this space. · Mention as `@Ops Bot(wake)`",
              ts: new Date(2026, 2, 14, 15, 42, 30).getTime(),
              membershipNotice: {
                action: "member_added",
                actorProfileId: "11111111-1111-4111-8111-111111111111",
                actorKind: "human",
                actorLabel: "Felix",
                targetProfileId: OPS_AGENT_PROFILE_ID,
                targetProfileKind: "agent",
                targetProfileLabel: "Ops Bot",
                mentionLabel: "Ops Bot",
                ts: new Date(2026, 2, 14, 15, 42, 30).getTime(),
              },
            },
            {
              groupKey: "system",
              kind: "membership_notice",
              line: "Felix added Amy Helper to this space.",
              ts: new Date(2026, 2, 14, 15, 43).getTime(),
              membershipNotice: {
                action: "member_added",
                actorProfileId: "11111111-1111-4111-8111-111111111111",
                actorKind: "human",
                actorLabel: "Felix",
                targetProfileId: "hum_helper",
                targetProfileKind: "human",
                targetProfileLabel: "Amy Helper",
                mentionLabel: null,
                ts: new Date(2026, 2, 14, 15, 43).getTime(),
              },
            },
            {
              groupKey: `profile-id:${OPS_AGENT_PROFILE_ID}`,
              kind: "message",
              line: "- 🤖 Ops Bot 20260313 03:05: I’m here.",
              ts: new Date(2026, 2, 14, 15, 43).getTime(),
            },
          ],
        },
      })
    );
    await waitForPiTuiRender();

    const output = fakeTerminal.getOutput();
    const plainOutput = stripVTControlCharacters(output).replaceAll("\r", "");
    const firstTranscriptIndex = plainOutput.indexOf("20260314 15:40:00");
    expect(
      plainOutput.indexOf(
        "Untrusted space. Anyone with this Space ID can join."
      )
    ).toBeLessThan(firstTranscriptIndex);
    expect(plainOutput).not.toContain("📣 System");
    expect(plainOutput).not.toContain("15:42 · 👤 Mengyao Li · left");
    expect(plainOutput).toContain("15:42–15:43 · 👤 Felix · added 2 members");
    expect(plainOutput).toContain("@Ops Bot(wake) · Amy Helper");
    expect(output).not.toContain("* 📣 system: 👤 Mengyao Li left the space.");
    expect(output).not.toContain("Wake with `@ops-bot`");
    expect(output).not.toContain("added 🤖 Ops Bot to this space.");
    expect(output).toContain("🤖 Ops Bot");
    expect(output).toContain("20260314 15:43:00");
    expect(output).toContain("I’m here.");
    expect(output).not.toContain("- 👤 Felix 20260313 03:04: @ops-bot hey");
    expect(output).toContain("👤 Felix · live now");
    expect(output).toContain("👤 Amy");
    expect(output).toContain("20260314 15:40:00");
    expect(output).toContain("@ops-bot hey");
    expect(output).not.toContain("╌╌╌╌");
    const membersSnapshot = createStateWithMembers().members.snapshot;
    const opsSurface = resolveAgentSurfaceRgb(
      "Ops Bot",
      {
        agentControllerRef: "builtin:codex",
        profileId: OPS_AGENT_PROFILE_ID,
        profileName: "Ops Bot",
      },
      {
        spaceMembersSnapshot: membersSnapshot,
      }
    );
    expect(output).toContain(
      `\u001B[48;2;${opsSurface.r};${opsSurface.g};${opsSurface.b}m`
    );
    const felixHeaderLine = output
      .split("\n")
      .find((line) => line.includes("👤 Felix"));
    expect(felixHeaderLine).toBeDefined();
    expect(felixHeaderLine).toContain(
      `\u001B[48;2;${String(OPENMELD_COMPOSER_SURFACE_BG_RGB[0])};${String(OPENMELD_COMPOSER_SURFACE_BG_RGB[1])};${String(OPENMELD_COMPOSER_SURFACE_BG_RGB[2])}m`
    );
    expect(felixHeaderLine).toContain("\u001B[49m");
    expect(output).toContain("human · space creator · seen now");
    expect(output).toContain("🤖 Ops Bot · codex · by Felix · live now");
    shell.stop();
  });

  it("does not inject transient status lines into the session document", async () => {
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      value: 120,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });

    const fakeTerminal = createFakeTerminal();
    const shell = new PiTuiInteractiveSpaceShell({
      onBufferChange: vi.fn(),
      onClose: vi.fn(),
      onOverlayActiveItemChange: vi.fn(),
      onOverlayClose: vi.fn(),
      onOverlayQueryChange: vi.fn(),
      onSubmit: vi.fn(),
      terminal: fakeTerminal,
    });

    shell.start();
    shell.render(createViewState(createStateWithMembers()));
    await waitForPiTuiRender();
    const withoutStatusOutput = fakeTerminal.getOutput();

    shell.render(
      createViewState({
        ...createStateWithMembers(),
        status: {
          overlayLine: "* 📣 system · sending: hello",
        },
      })
    );
    await waitForPiTuiRender();
    const withStatusOutput = fakeTerminal.getOutput();

    expect(withoutStatusOutput).not.toContain("* 📣 system · sending: hello");
    expect(withStatusOutput).not.toContain("* 📣 system · sending: hello");
    expect(withStatusOutput).toContain(SPACE_HEADER_PRODUCT_LABEL);
    expect(withStatusOutput).toContain("Ops Room");
    expect(withStatusOutput).toContain(
      "👥 2 · 1 live human · type /members to check"
    );
    expect(withStatusOutput).toContain("⚠️ Public");
    expect(withStatusOutput).toContain(
      "Untrusted space. Anyone with this Space ID can join."
    );
    expect(withStatusOutput).toContain(COMPOSER_HELPER_TEXT);
    shell.stop();
  });

  it("does not render the legacy-style profile prompt above the composer", async () => {
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      value: 120,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });

    const fakeTerminal = createFakeTerminal();
    const shell = new PiTuiInteractiveSpaceShell({
      onBufferChange: vi.fn(),
      onClose: vi.fn(),
      onOverlayActiveItemChange: vi.fn(),
      onOverlayClose: vi.fn(),
      onOverlayQueryChange: vi.fn(),
      onSubmit: vi.fn(),
      terminal: fakeTerminal,
    });

    shell.start();
    shell.render(createViewState(createStateWithMembers()));
    await waitForPiTuiRender();

    const output = fakeTerminal.getOutput();
    expect(output).not.toContain("- Felix (human):");
    shell.stop();
  });

  it("opens the transcript reader from PageUp while the composer is focused", async () => {
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      value: 80,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });

    const fakeTerminal = createFakeTerminal({
      columns: 80,
      rows: 18,
    });
    const onBufferChange = vi.fn();
    const shell = new PiTuiInteractiveSpaceShell({
      onBufferChange,
      onClose: vi.fn(),
      onOverlayActiveItemChange: vi.fn(),
      onOverlayClose: vi.fn(),
      onOverlayQueryChange: vi.fn(),
      onSubmit: vi.fn(),
      terminal: fakeTerminal,
    });

    shell.start();
    shell.render(createViewState(createStateWithTranscriptMessages(16)));
    await waitForPiTuiRender();

    fakeTerminal.emit("\u001B[5~");
    await waitForPiTuiRender();

    const output = stripVTControlCharacters(
      fakeTerminal.getOutput()
    ).replaceAll("\r", "");
    expect(output).toContain("📜 Transcript History");
    expect(output).toContain("Read older messages without leaving the live");
    expect(onBufferChange).not.toHaveBeenCalled();
    shell.stop();
  });

  it("restores composer input after closing the transcript reader", async () => {
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      value: 80,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });

    let state = createStateWithTranscriptMessages(16);
    const fakeTerminal = createFakeTerminal({
      columns: 80,
      rows: 18,
    });
    const onBufferChange = vi.fn((bufferText: string) => {
      state = {
        ...state,
        composer: {
          bufferText,
        },
      };
    });
    const shell = new PiTuiInteractiveSpaceShell({
      onBufferChange,
      onClose: vi.fn(),
      onOverlayActiveItemChange: vi.fn(),
      onOverlayClose: vi.fn(),
      onOverlayQueryChange: vi.fn(),
      onSubmit: vi.fn(),
      terminal: fakeTerminal,
    });

    shell.start();
    shell.render(createViewState(state));
    await waitForPiTuiRender();

    fakeTerminal.emit("\u001B[5~");
    await waitForPiTuiRender();
    fakeTerminal.emit("\u001B");
    await waitForPiTuiRender();
    fakeTerminal.emit("h");
    await waitForPiTuiRender();

    expect(onBufferChange).toHaveBeenCalledWith("h");
    shell.stop();
  });

  it("keeps the transcript reader open and surfaces a new-updates hint while new transcript rows arrive", async () => {
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      value: 80,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });

    const fakeTerminal = createFakeTerminal({
      columns: 80,
      rows: 18,
    });
    const shell = new PiTuiInteractiveSpaceShell({
      onBufferChange: vi.fn(),
      onClose: vi.fn(),
      onOverlayActiveItemChange: vi.fn(),
      onOverlayClose: vi.fn(),
      onOverlayQueryChange: vi.fn(),
      onSubmit: vi.fn(),
      terminal: fakeTerminal,
    });

    shell.start();
    shell.render(createViewState(createStateWithTranscriptMessages(16)));
    await waitForPiTuiRender();

    fakeTerminal.emit("\u001B[5~");
    await waitForPiTuiRender();
    fakeTerminal.emit("\u001B[H");
    await waitForPiTuiRender();

    shell.render(createViewState(createStateWithTranscriptMessages(18)));
    await waitForPiTuiRender();

    const output = stripVTControlCharacters(
      fakeTerminal.getOutput()
    ).replaceAll("\r", "");
    expect(output).toContain("📜 Transcript History");
    expect(output).toContain("New updates below · End to jump");
    shell.stop();
  });

  it("replaces the transcript reader with store-driven overlays", async () => {
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      value: 80,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });

    const fakeTerminal = createFakeTerminal({
      columns: 80,
      rows: 18,
    });
    const shell = new PiTuiInteractiveSpaceShell({
      onBufferChange: vi.fn(),
      onClose: vi.fn(),
      onOverlayActiveItemChange: vi.fn(),
      onOverlayClose: vi.fn(),
      onOverlayQueryChange: vi.fn(),
      onSubmit: vi.fn(),
      terminal: fakeTerminal,
    });

    shell.start();
    shell.render(createViewState(createStateWithTranscriptMessages(16)));
    await waitForPiTuiRender();

    fakeTerminal.emit("\u001B[5~");
    await waitForPiTuiRender();
    shell.render(
      createViewState({
        ...createStateWithTranscriptMessages(16),
        overlay: {
          kind: "space",
          interaction: {
            activeItemId: null,
            query: "",
          },
          openedAtMs: null,
        },
      })
    );
    await waitForPiTuiRender();

    const output = stripVTControlCharacters(
      fakeTerminal.getOutput()
    ).replaceAll("\r", "");
    expect(output).toContain("🛰️ Space Info");
    shell.stop();
  });

  it("uses differential renders for ordinary live transcript updates", async () => {
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      value: 80,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });

    const fakeTerminal = createFakeTerminal({
      columns: 80,
      rows: 18,
    });
    const shell = new PiTuiInteractiveSpaceShell({
      onBufferChange: vi.fn(),
      onClose: vi.fn(),
      onOverlayActiveItemChange: vi.fn(),
      onOverlayClose: vi.fn(),
      onOverlayQueryChange: vi.fn(),
      onSubmit: vi.fn(),
      terminal: fakeTerminal,
    });

    shell.start();
    shell.render(createViewState(createStateWithTranscriptMessages(8)));
    await waitForPiTuiRender();
    shell.render(createViewState(createStateWithTranscriptMessages(10)));
    await waitForPiTuiRender();

    expect(fakeTerminal.getOutput()).not.toContain(HARD_RESET_RENDER_SEQUENCE);
    shell.stop();
  });

  it("uses differential renders for Ctrl+C confirmation status updates", async () => {
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      value: 80,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });

    const fakeTerminal = createFakeTerminal({
      columns: 80,
      rows: 18,
    });
    const shell = new PiTuiInteractiveSpaceShell({
      onBufferChange: vi.fn(),
      onClose: vi.fn(),
      onOverlayActiveItemChange: vi.fn(),
      onOverlayClose: vi.fn(),
      onOverlayQueryChange: vi.fn(),
      onSubmit: vi.fn(),
      terminal: fakeTerminal,
    });

    shell.start();
    shell.render(createViewState(createStateWithMembers()));
    await waitForPiTuiRender();
    fakeTerminal.emit("\u0003");
    await waitForPiTuiRender();

    expect(fakeTerminal.getOutput()).not.toContain(HARD_RESET_RENDER_SEQUENCE);
    shell.stop();
  });

  it("uses differential renders for overlay refreshes and transcript reader lifecycle updates", async () => {
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      value: 80,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });

    const fakeTerminal = createFakeTerminal({
      columns: 80,
      rows: 18,
    });
    const shell = new PiTuiInteractiveSpaceShell({
      onBufferChange: vi.fn(),
      onClose: vi.fn(),
      onOverlayActiveItemChange: vi.fn(),
      onOverlayClose: vi.fn(),
      onOverlayQueryChange: vi.fn(),
      onSubmit: vi.fn(),
      terminal: fakeTerminal,
    });

    shell.start();
    shell.render(
      createViewState({
        ...createStateWithTranscriptMessages(16),
        overlay: {
          kind: "space",
          openedAtMs: null,
          interaction: {
            activeItemId: null,
            query: "",
          },
        },
      })
    );
    await waitForPiTuiRender();

    shell.render(
      createViewState({
        ...createStateWithTranscriptMessages(16),
        connection: {
          ...createStateWithTranscriptMessages(16).connection,
          status: "connecting",
        },
        overlay: {
          kind: "space",
          openedAtMs: null,
          interaction: {
            activeItemId: null,
            query: "",
          },
        },
      })
    );
    await waitForPiTuiRender();

    shell.render(createViewState(createStateWithTranscriptMessages(16)));
    await waitForPiTuiRender();
    fakeTerminal.emit("\u001B[5~");
    await waitForPiTuiRender();
    shell.render(createViewState(createStateWithTranscriptMessages(18)));
    await waitForPiTuiRender();
    fakeTerminal.emit("\u001B");
    await waitForPiTuiRender();

    expect(fakeTerminal.getOutput()).not.toContain(HARD_RESET_RENDER_SEQUENCE);
    shell.stop();
  });

  it("keeps hard reset renders only for external terminal writes", async () => {
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      value: 80,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });

    const fakeTerminal = createFakeTerminal({
      columns: 80,
      rows: 18,
    });
    const shell = new PiTuiInteractiveSpaceShell({
      onBufferChange: vi.fn(),
      onClose: vi.fn(),
      onOverlayActiveItemChange: vi.fn(),
      onOverlayClose: vi.fn(),
      onOverlayQueryChange: vi.fn(),
      onSubmit: vi.fn(),
      terminal: fakeTerminal,
    });

    shell.start();
    shell.render(createViewState(createStateWithMembers()));
    await waitForPiTuiRender();

    shell.prepareExternalWrite();
    await waitForPiTuiRender();
    await waitForPiTuiRender();

    expect(fakeTerminal.getOutput()).toContain(HARD_RESET_RENDER_SEQUENCE);
    shell.stop();
  });

  it("closes readonly watch sessions on Ctrl+C", async () => {
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      value: 120,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });

    const fakeTerminal = createFakeTerminal();
    const onClose = vi.fn();
    const shell = new PiTuiInteractiveSpaceShell({
      onBufferChange: vi.fn(),
      onClose,
      onOverlayActiveItemChange: vi.fn(),
      onOverlayClose: vi.fn(),
      onOverlayQueryChange: vi.fn(),
      onSubmit: vi.fn(),
      terminal: fakeTerminal,
    });

    shell.start();
    shell.render(
      createViewState(createStateWithMembers(), {
        connectionMode: "watch",
      })
    );
    await waitForPiTuiRender();

    fakeTerminal.emit("\u0003");
    await waitForPiTuiRender();

    expect(onClose).toHaveBeenCalledTimes(1);
    shell.stop();
  });

  it("requires Ctrl+C twice to leave interactive composer sessions", async () => {
    vi.useFakeTimers({
      toFake: ["Date", "setTimeout", "clearTimeout"],
    });
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      value: 120,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });

    const fakeTerminal = createFakeTerminal();
    const onClose = vi.fn();
    const shell = new PiTuiInteractiveSpaceShell({
      onBufferChange: vi.fn(),
      onClose,
      onOverlayActiveItemChange: vi.fn(),
      onOverlayClose: vi.fn(),
      onOverlayQueryChange: vi.fn(),
      onSubmit: vi.fn(),
      terminal: fakeTerminal,
    });

    shell.start();
    shell.render(createViewState(createStateWithMembers()));
    await waitForPiTuiRender();

    fakeTerminal.emit("\u0003");
    await waitForPiTuiRender();

    const outputAfterFirstCtrlC = stripVTControlCharacters(
      fakeTerminal.getOutput()
    ).replaceAll("\r", "");
    expect(onClose).not.toHaveBeenCalled();
    expect(fakeTerminal.getOutput()).toContain(
      renderOpenMeldBrandAccent("Press Ctrl+C again to leave this Space.")
    );
    expect(outputAfterFirstCtrlC).toContain(
      "Press Ctrl+C again to leave this Space."
    );
    expect(outputAfterFirstCtrlC).not.toContain(
      "\n Press Ctrl+C again to leave this Space."
    );

    fakeTerminal.emit("\u0003");
    await waitForPiTuiRender();

    expect(onClose).toHaveBeenCalledTimes(1);
    shell.stop();
  });

  it("resets the Ctrl+C exit confirmation after the timeout window", async () => {
    vi.useFakeTimers({
      toFake: ["Date", "setTimeout", "clearTimeout"],
    });
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      value: 120,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });

    const fakeTerminal = createFakeTerminal();
    const onClose = vi.fn();
    const shell = new PiTuiInteractiveSpaceShell({
      onBufferChange: vi.fn(),
      onClose,
      onOverlayActiveItemChange: vi.fn(),
      onOverlayClose: vi.fn(),
      onOverlayQueryChange: vi.fn(),
      onSubmit: vi.fn(),
      terminal: fakeTerminal,
    });

    shell.start();
    shell.render(createViewState(createStateWithMembers()));
    await waitForPiTuiRender();

    fakeTerminal.emit("\u0003");
    await waitForPiTuiRender();

    await vi.advanceTimersByTimeAsync(1600);
    await waitForPiTuiRender();

    fakeTerminal.emit("\u0003");
    await waitForPiTuiRender();

    expect(onClose).not.toHaveBeenCalled();
    shell.stop();
  });

  it("renders a readonly watch footer with explicit exit guidance", async () => {
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      value: 120,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });

    const fakeTerminal = createFakeTerminal();
    const shell = new PiTuiInteractiveSpaceShell({
      onBufferChange: vi.fn(),
      onClose: vi.fn(),
      onOverlayActiveItemChange: vi.fn(),
      onOverlayClose: vi.fn(),
      onOverlayQueryChange: vi.fn(),
      onSubmit: vi.fn(),
      terminal: fakeTerminal,
    });

    shell.start();
    shell.render(
      createViewState(createStateWithMembers(), {
        connectionMode: "watch",
      })
    );
    await waitForPiTuiRender();

    const output = stripVTControlCharacters(
      fakeTerminal.getOutput()
    ).replaceAll("\r", "");
    expect(output).toContain(
      "Watch-only mode · m members · l logs · s space · Ctrl+D/Ctrl+C/q quit."
    );
    shell.stop();
  });

  it("shows read-only panel shortcuts in the session summary for watch mode", async () => {
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      value: 120,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });

    const fakeTerminal = createFakeTerminal();
    const shell = new PiTuiInteractiveSpaceShell({
      onBufferChange: vi.fn(),
      onClose: vi.fn(),
      onOverlayActiveItemChange: vi.fn(),
      onOverlayClose: vi.fn(),
      onOverlayQueryChange: vi.fn(),
      onSubmit: vi.fn(),
      terminal: fakeTerminal,
    });

    shell.start();
    shell.render(
      createViewState(createStateWithMembers(), {
        connectionMode: "watch",
      })
    );
    await waitForPiTuiRender();

    const output = stripVTControlCharacters(
      fakeTerminal.getOutput()
    ).replaceAll("\r", "");
    expect(output).toContain(
      "👥 2 · 1 live human · press m for members · l for logs · s for space"
    );
    expect(output).not.toContain("type /members to check");
    shell.stop();
  });

  it("moves the connected notice into the composer helper line instead of the transcript", async () => {
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      value: 120,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });

    const fakeTerminal = createFakeTerminal();
    const shell = new PiTuiInteractiveSpaceShell({
      onBufferChange: vi.fn(),
      onClose: vi.fn(),
      onOverlayActiveItemChange: vi.fn(),
      onOverlayClose: vi.fn(),
      onOverlayQueryChange: vi.fn(),
      onSubmit: vi.fn(),
      terminal: fakeTerminal,
    });

    shell.start();
    shell.render(
      createViewState({
        ...createStateWithMembers(),
        transcript: {
          items: [
            {
              groupKey: "system",
              kind: "system_notice",
              line: "* 📣 system: connected as Felix.",
              ts: new Date(2026, 2, 14, 18, 0).getTime(),
            },
          ],
        },
      })
    );
    await waitForPiTuiRender();

    const plainOutput = stripVTControlCharacters(
      fakeTerminal.getOutput()
    ).replaceAll("\r", "");
    const rawOutput = fakeTerminal.getOutput();
    expect(plainOutput).toContain(COMPOSER_HELPER_TEXT);
    expect(plainOutput).not.toContain("📣 System");
    expect(plainOutput).not.toContain("* 📣 system: connected as Felix.");
    expect(plainOutput).toMatch(COMPOSER_HELPER_RENDER_REGEX);
    expect(rawOutput).toContain("\u001B[48;2;38;38;38m");
    shell.stop();
  });

  it("renders the compact space summary directly below the composer input", async () => {
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      value: 120,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });

    const fakeTerminal = createFakeTerminal();
    const shell = new PiTuiInteractiveSpaceShell({
      onBufferChange: vi.fn(),
      onClose: vi.fn(),
      onOverlayActiveItemChange: vi.fn(),
      onOverlayClose: vi.fn(),
      onOverlayQueryChange: vi.fn(),
      onSubmit: vi.fn(),
      terminal: fakeTerminal,
    });

    shell.start();
    shell.render(createViewState(createStateWithMembers()));
    await waitForPiTuiRender();

    const plainOutput = stripVTControlCharacters(
      fakeTerminal.getOutput()
    ).replaceAll("\r", "");
    expect(plainOutput).toContain(
      "Ops Room · Public · 2 members · 1 live human · 1 live agent"
    );
    expect(plainOutput.indexOf(COMPOSER_HELPER_TEXT)).toBeLessThan(
      plainOutput.lastIndexOf(
        "Ops Room · Public · 2 members · 1 live human · 1 live agent"
      )
    );
    shell.stop();
  });

  it("renders storage usage only in the composer footer summary", async () => {
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      value: 120,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });

    const fakeTerminal = createFakeTerminal();
    const shell = new PiTuiInteractiveSpaceShell({
      onBufferChange: vi.fn(),
      onClose: vi.fn(),
      onOverlayActiveItemChange: vi.fn(),
      onOverlayClose: vi.fn(),
      onOverlayQueryChange: vi.fn(),
      onSubmit: vi.fn(),
      terminal: fakeTerminal,
    });

    shell.start();
    shell.render(
      createViewState(createStateWithMembers(), {
        session: {
          storageUsedBytes: 2_100_000,
          storageSoftLimitBytes: 9_000_000,
          storageUsagePercent: 24,
        },
      })
    );
    await waitForPiTuiRender();

    const plainOutput = stripVTControlCharacters(
      fakeTerminal.getOutput()
    ).replaceAll("\r", "");
    const helperIndex = plainOutput.indexOf(COMPOSER_HELPER_TEXT);
    const storageIndex = plainOutput.indexOf("2.1 MB ( 24% used )");
    const summaryWithStorage =
      "Ops Room · Public · 2 members · 1 live human · 1 live agent · 2.1 MB ( 24% used )";

    expect(storageIndex).toBeGreaterThan(helperIndex);
    expect(plainOutput.indexOf(summaryWithStorage)).toBe(
      plainOutput.lastIndexOf(summaryWithStorage)
    );
    shell.stop();
  });

  it("renders a composer activity strip above the helper text when one agent is replying", async () => {
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      value: 120,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });

    const fakeTerminal = createFakeTerminal();
    const shell = new PiTuiInteractiveSpaceShell({
      onBufferChange: vi.fn(),
      onClose: vi.fn(),
      onOverlayActiveItemChange: vi.fn(),
      onOverlayClose: vi.fn(),
      onOverlayQueryChange: vi.fn(),
      onSubmit: vi.fn(),
      terminal: fakeTerminal,
    });

    shell.start();
    shell.render(
      createViewState(createStateWithMembers(), undefined, undefined, {
        nowMs: 10_000,
        rows: [
          {
            rowId: "dispatch:dispatch-claude",
            dispatchId: "dispatch-claude",
            sourceEventId: null,
            sourceClientMessageId: null,
            targetProfileId: "agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            targetMentionLabel: null,
            targetLabel: "oh-my-claude",
            stage: "replying",
            createdAtMs: 6000,
            updatedAtMs: 9000,
            latestPreviewText: "Working on your request right now.",
            latestPreviewUpdatedAtMs: 9000,
            expiresAtMs: 100_000,
            statusText: "",
            warningText: "",
          },
        ],
      })
    );
    await waitForPiTuiRender();

    const plainOutput = stripVTControlCharacters(
      fakeTerminal.getOutput()
    ).replaceAll("\r", "");
    expect(plainOutput).toContain("oh-my-claude is streaming");
    expect(plainOutput).toContain("Working on your request right now.");
    expect(plainOutput).not.toContain("Preview:");
    expect(plainOutput.indexOf("oh-my-claude is streaming")).toBeLessThan(
      plainOutput.indexOf(COMPOSER_HELPER_TEXT)
    );
    expect(plainOutput).toContain(
      `oh-my-claude is streaming · Working on your request right now.\n${COMPOSER_HELPER_TEXT}`
    );
    shell.stop();
  });

  it("rotates the composer activity label when an agent is replying without preview text", async () => {
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      value: 120,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });

    const fakeTerminal = createFakeTerminal();
    const shell = new PiTuiInteractiveSpaceShell({
      onBufferChange: vi.fn(),
      onClose: vi.fn(),
      onOverlayActiveItemChange: vi.fn(),
      onOverlayClose: vi.fn(),
      onOverlayQueryChange: vi.fn(),
      onSubmit: vi.fn(),
      terminal: fakeTerminal,
    });

    shell.start();
    shell.render(
      createViewState(createStateWithMembers(), undefined, undefined, {
        nowMs: 16_000,
        rows: [
          {
            rowId: "dispatch:dispatch-codex",
            dispatchId: "dispatch-codex",
            sourceEventId: null,
            sourceClientMessageId: null,
            targetProfileId: "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            targetMentionLabel: null,
            targetLabel: "hi-agent",
            stage: "replying",
            createdAtMs: 10_000,
            updatedAtMs: 15_000,
            latestPreviewText: "",
            latestPreviewUpdatedAtMs: null,
            expiresAtMs: 100_000,
            statusText: "",
            warningText: "",
          },
        ],
      })
    );
    await waitForPiTuiRender();

    const plainOutput = stripVTControlCharacters(
      fakeTerminal.getOutput()
    ).replaceAll("\r", "");
    expect(plainOutput).toContain("hi-agent is working");
    expect(plainOutput).not.toContain("Preview:");
    shell.stop();
  });

  it("shows overflow when more than two replying agents are active", async () => {
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      value: 120,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });

    const fakeTerminal = createFakeTerminal();
    const shell = new PiTuiInteractiveSpaceShell({
      onBufferChange: vi.fn(),
      onClose: vi.fn(),
      onOverlayActiveItemChange: vi.fn(),
      onOverlayClose: vi.fn(),
      onOverlayQueryChange: vi.fn(),
      onSubmit: vi.fn(),
      terminal: fakeTerminal,
    });

    shell.start();
    shell.render(
      createViewState(createStateWithMembers(), undefined, undefined, {
        nowMs: 20_000,
        rows: [
          {
            rowId: "dispatch:dispatch-a",
            dispatchId: "dispatch-a",
            sourceEventId: null,
            sourceClientMessageId: null,
            targetProfileId: "agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            targetMentionLabel: null,
            targetLabel: "oh-my-claude",
            stage: "replying",
            createdAtMs: 10_000,
            updatedAtMs: 19_000,
            latestPreviewText: "one",
            latestPreviewUpdatedAtMs: 19_000,
            expiresAtMs: 100_000,
            statusText: "",
            warningText: "",
          },
          {
            rowId: "dispatch:dispatch-b",
            dispatchId: "dispatch-b",
            sourceEventId: null,
            sourceClientMessageId: null,
            targetProfileId: "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            targetMentionLabel: null,
            targetLabel: "hi-agent",
            stage: "replying",
            createdAtMs: 11_000,
            updatedAtMs: 18_000,
            latestPreviewText: "",
            latestPreviewUpdatedAtMs: null,
            expiresAtMs: 100_000,
            statusText: "",
            warningText: "",
          },
          {
            rowId: "dispatch:dispatch-c",
            dispatchId: "dispatch-c",
            sourceEventId: null,
            sourceClientMessageId: null,
            targetProfileId: "agt_openresearch",
            targetMentionLabel: null,
            targetLabel: "openresearch-agent",
            stage: "replying",
            createdAtMs: 12_000,
            updatedAtMs: 17_000,
            latestPreviewText: "",
            latestPreviewUpdatedAtMs: null,
            expiresAtMs: 100_000,
            statusText: "",
            warningText: "",
          },
        ],
      })
    );
    await waitForPiTuiRender();

    const plainOutput = stripVTControlCharacters(
      fakeTerminal.getOutput()
    ).replaceAll("\r", "");
    expect(plainOutput).toContain("+1 more active");
    expect(plainOutput).toContain("hi-agent is replying");
    expect(plainOutput).toContain("oh-my-claude is streaming");
    expect(plainOutput).not.toContain("openresearch-agent is");
    shell.stop();
  });

  it("adds one blank padding line above and below the actual composer input area", async () => {
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      value: 120,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });

    const fakeTerminal = createFakeTerminal();
    const shell = new PiTuiInteractiveSpaceShell({
      onBufferChange: vi.fn(),
      onClose: vi.fn(),
      onOverlayActiveItemChange: vi.fn(),
      onOverlayClose: vi.fn(),
      onOverlayQueryChange: vi.fn(),
      onSubmit: vi.fn(),
      terminal: fakeTerminal,
    });

    shell.start();
    shell.render(createViewState(createStateWithMembers()));
    await waitForPiTuiRender();

    const plainLines = stripVTControlCharacters(fakeTerminal.getOutput())
      .replaceAll("\r", "")
      .split("\n");
    const promptLineIndex = plainLines.findIndex((line) =>
      line.startsWith(" › ")
    );
    expect(promptLineIndex).toBeGreaterThan(0);
    expect(plainLines[promptLineIndex]).toContain(" › █ Message the space...");
    expect(plainLines[promptLineIndex - 1]?.trim()).toBe("");
    expect(plainLines[promptLineIndex + 1]?.trim()).toBe("");
    shell.stop();
  });

  it("hides the placeholder as soon as the composer has real input", async () => {
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      value: 120,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });

    const fakeTerminal = createFakeTerminal();
    const shell = new PiTuiInteractiveSpaceShell({
      onBufferChange: vi.fn(),
      onClose: vi.fn(),
      onOverlayActiveItemChange: vi.fn(),
      onOverlayClose: vi.fn(),
      onOverlayQueryChange: vi.fn(),
      onSubmit: vi.fn(),
      terminal: fakeTerminal,
    });

    shell.start();
    shell.render(
      createViewState({
        ...createStateWithMembers(),
        composer: {
          bufferText: "hello",
        },
      })
    );
    await waitForPiTuiRender();

    const plainOutput = stripVTControlCharacters(
      fakeTerminal.getOutput()
    ).replaceAll("\r", "");
    expect(plainOutput).toContain(" › hello");
    expect(plainOutput).not.toContain("Message the space...");
    shell.stop();
  });

  it("renders the /members overlay with the original members card content", async () => {
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      value: 120,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });

    const fakeTerminal = createFakeTerminal();
    const shell = new PiTuiInteractiveSpaceShell({
      onBufferChange: vi.fn(),
      onClose: vi.fn(),
      onOverlayActiveItemChange: vi.fn(),
      onOverlayClose: vi.fn(),
      onOverlayQueryChange: vi.fn(),
      onSubmit: vi.fn(),
      terminal: fakeTerminal,
    });

    shell.start();
    shell.render(
      createViewState({
        ...createStateWithMembers(),
        overlay: {
          kind: "members",
          openedAtMs: new Date(2026, 2, 14, 22, 25).getTime(),
          interaction: {
            activeItemId: null,
            query: "",
          },
        },
      })
    );
    await waitForPiTuiRender();

    const output = stripVTControlCharacters(
      fakeTerminal.getOutput()
    ).replaceAll("\r", "");
    const agentsHeaderIndex = output.indexOf("🤖 Agents");
    const humansHeaderIndex = output.indexOf("👤 Humans");
    expect(output).toContain("👥 Space Members");
    expect(output).toContain("UpdatedAt 20260314 22:25");
    expect(output).toContain("Humans");
    expect(output).toContain("Agents");
    expect(agentsHeaderIndex).toBeGreaterThanOrEqual(0);
    expect(humansHeaderIndex).toBeGreaterThanOrEqual(0);
    expect(agentsHeaderIndex).toBeLessThan(humansHeaderIndex);
    expect(output).toContain("owner: Felix");
    expect(output).toContain("mention: @Ops Bot(wake)");
    shell.stop();
  });

  it("scrolls long /members overlays while keeping UpdatedAt fixed", async () => {
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      value: 120,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });

    const fakeTerminal = createFakeTerminal({
      rows: 20,
    });
    let state: SpaceScreenState = {
      ...createStateWithManyMembers(),
      overlay: {
        kind: "members" as const,
        openedAtMs: new Date(2026, 2, 14, 22, 25).getTime(),
        interaction: {
          activeItemId: null,
          query: "",
        },
      },
    };
    const shell = new PiTuiInteractiveSpaceShell({
      onBufferChange: vi.fn(),
      onClose: vi.fn(),
      onOverlayActiveItemChange: (activeItemId) => {
        state = {
          ...state,
          overlay: {
            ...state.overlay,
            interaction: {
              ...state.overlay.interaction,
              activeItemId,
            },
          },
        };
        shell.render(createViewState(state));
      },
      onOverlayClose: vi.fn(),
      onOverlayQueryChange: (query) => {
        state = {
          ...state,
          overlay: {
            ...state.overlay,
            interaction: {
              ...state.overlay.interaction,
              query,
            },
          },
        };
        shell.render(createViewState(state));
      },
      onSubmit: vi.fn(),
      terminal: fakeTerminal,
    });

    shell.start();
    shell.render(createViewState(state));
    await waitForPiTuiRender();

    let output = stripVTControlCharacters(fakeTerminal.getOutput()).replaceAll(
      "\r",
      ""
    );
    expect(output).toContain("UpdatedAt 20260314 22:25");
    expect(output).toContain("Agent 01");
    expect(output).not.toContain("Human 01");

    fakeTerminal.emit("\u001B[6~");
    await waitForPiTuiRender();

    output = stripVTControlCharacters(fakeTerminal.getOutput()).replaceAll(
      "\r",
      ""
    );
    expect(output).toContain("UpdatedAt 20260314 22:25");
    expect(output).toContain("↑↓ scroll · PgUp/PgDn page · Home/End jump");
    expect(output).toContain(
      "Type to search  █ Filter members by name, @wake, ID, or owner"
    );
    expect(output).toContain("❯ Agent 03");
    expect(output.lastIndexOf("❯ Agent 03")).toBeGreaterThan(
      output.lastIndexOf("❯ Agent 01")
    );

    fakeTerminal.emit("\u001B[F");
    await waitForPiTuiRender();

    output = stripVTControlCharacters(fakeTerminal.getOutput()).replaceAll(
      "\r",
      ""
    );
    expect(output).toContain("Human 08");
    expect(output).toContain("↑ 39 more");

    shell.stop();
  });

  it("treats q as search input in searchable /members panels instead of closing", async () => {
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      value: 120,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });

    const fakeTerminal = createFakeTerminal({
      rows: 20,
    });
    const onOverlayClose = vi.fn();
    let state: SpaceScreenState = {
      ...createStateWithManyMembers(),
      overlay: {
        kind: "members" as const,
        openedAtMs: new Date(2026, 2, 14, 22, 25).getTime(),
        interaction: {
          activeItemId: null,
          query: "",
        },
      },
    };
    const shell = new PiTuiInteractiveSpaceShell({
      onBufferChange: vi.fn(),
      onClose: vi.fn(),
      onOverlayActiveItemChange: (activeItemId) => {
        state = {
          ...state,
          overlay: {
            ...state.overlay,
            interaction: {
              ...state.overlay.interaction,
              activeItemId,
            },
          },
        };
        shell.render(createViewState(state));
      },
      onOverlayClose,
      onOverlayQueryChange: (query) => {
        state = {
          ...state,
          overlay: {
            ...state.overlay,
            interaction: {
              ...state.overlay.interaction,
              query,
            },
          },
        };
        shell.render(createViewState(state));
      },
      onSubmit: vi.fn(),
      terminal: fakeTerminal,
    });

    shell.start();
    shell.render(createViewState(state));
    await waitForPiTuiRender();

    fakeTerminal.emit("q");
    await waitForPiTuiRender();

    const output = stripVTControlCharacters(
      fakeTerminal.getOutput()
    ).replaceAll("\r", "");
    expect(output).toContain("Type to search  q█");
    expect(onOverlayClose).not.toHaveBeenCalled();
    shell.stop();
  });
});

function createFakeTerminal(input?: {
  columns?: number;
  rows?: number;
}): Terminal & {
  emit: (data: string) => void;
  getOutput: () => string;
} {
  let onInput: ((data: string) => void) | null = null;
  const writes: string[] = [];
  const columns = input?.columns ?? 120;
  const rows = input?.rows ?? 40;

  return {
    clearFromCursor() {
      return undefined;
    },
    clearLine() {
      return undefined;
    },
    clearScreen() {
      return undefined;
    },
    drainInput: async () => undefined,
    emit(data: string) {
      onInput?.(data);
    },
    get columns() {
      return columns;
    },
    get kittyProtocolActive() {
      return false;
    },
    get rows() {
      return rows;
    },
    getOutput() {
      return writes.join("");
    },
    hideCursor() {
      return undefined;
    },
    moveBy() {
      return undefined;
    },
    setTitle() {
      return undefined;
    },
    showCursor() {
      return undefined;
    },
    start(nextOnInput) {
      onInput = nextOnInput;
    },
    stop() {
      onInput = null;
    },
    write(data: string) {
      writes.push(data);
    },
  };
}

function createStateWithMembers(): SpaceScreenState {
  return {
    ...createInitialSpaceScreenState(),
    members: {
      refreshError: null,
      updatedAtMs: new Date(2026, 2, 14, 22, 25).getTime(),
      snapshot: createSpaceMembersSnapshot({
        agents: [
          createSpaceMemberAgentSnapshot({
            addedAt: "2026-03-13T00:00:00.000Z",
            addedByDisplayName: "Felix",
            addedByOwnerUserId: "user_felix",
            addedByProfileId: "11111111-1111-4111-8111-111111111111",
            createdAt: "2026-03-13T00:00:00.000Z",
            liveNow: true,
            ownerName: "Felix",
            ownerUserId: "user_felix",
            profileId: OPS_AGENT_PROFILE_ID,
            profileName: "Ops Bot",
            updatedAt: "2026-03-13T00:00:00.000Z",
          }),
        ],
        generatedAt: "2026-03-13T00:00:00.000Z",
        humans: [
          createSpaceMemberHumanSnapshot({
            addedAt: "2026-03-13T00:00:00.000Z",
            createdAt: "2026-03-13T00:00:00.000Z",
            firstEnteredAt: "2026-03-13T00:00:00.000Z",
            lastEnteredAt: "2026-03-13T00:00:00.000Z",
            lastSeenAt: "2026-03-13T00:00:00.000Z",
            lastSeenLabel: "Seen now",
            liveNow: true,
            ownerName: null,
            ownerUserId: null,
            profileId: "11111111-1111-4111-8111-111111111111",
            profileName: "Felix",
            updatedAt: "2026-03-13T00:00:00.000Z",
          }),
        ],
        spaceId: "space-1",
      }),
    },
  };
}

function createStateWithMentionAuthoringMembers(): SpaceScreenState {
  return createStateWithMembers();
}

function createStateWithManyMembers(): SpaceScreenState {
  const baseState = createStateWithMembers();
  const baseHuman = baseState.members.snapshot?.humans[0];
  const baseAgent = baseState.members.snapshot?.agents[0];
  if (!(baseState.members.snapshot && baseHuman && baseAgent)) {
    return baseState;
  }

  return {
    ...baseState,
    members: {
      ...baseState.members,
      snapshot: {
        ...baseState.members.snapshot,
        agents: Array.from({ length: 8 }, (_, index) => ({
          ...baseAgent,
          liveNow: index < 2,
          ownerName: "Felix",
          profileId: `agt_${String(index + 1).padStart(8, "0")}-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
          profileName: `Agent ${String(index + 1).padStart(2, "0")}`,
        })),
        humans: Array.from({ length: 8 }, (_, index) => ({
          ...baseHuman,
          liveNow: index < 2,
          profileId: `${String(index + 1).padStart(8, "0")}-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
          profileName: `Human ${String(index + 1).padStart(2, "0")}`,
        })),
        summary: {
          agentCount: 8,
          humanCount: 8,
          liveNowCount: 4,
          totalCount: 16,
        },
      },
    },
  };
}

function createStateWithTranscriptMessages(count: number): SpaceScreenState {
  const baseState = createStateWithMembers();

  return {
    ...baseState,
    transcript: {
      ...baseState.transcript,
      items: Array.from({ length: count }, (_, index) => {
        const label = `Reader ${String(index + 1).padStart(2, "0")}`;
        const minute = String(index % 60).padStart(2, "0");
        return {
          groupKey: `profile-id:hum_reader_${String(index + 1).padStart(2, "0")}`,
          kind: "message" as const,
          line: `- 👤 ${label} 20260313 03:${minute}: message ${String(index + 1).padStart(2, "0")}`,
          ts: new Date(2026, 2, 14, 15, index).getTime(),
        };
      }),
    },
  };
}

const DEFAULT_SESSION_CONTEXT: SpaceSessionContext = {
  surface: "active-session",
  connectionMode: "join",
  gatewayUrl: "http://localhost:8080",
  profile: {
    kind: "human",
    profileId: "11111111-1111-4111-8111-111111111111",
    profileName: "Felix",
    ownerUserId: "user_felix",
    ownerName: "Felix",
  },
  session: {
    spaceCreatedAt: "2026-03-13T00:00:00.000Z",
    spaceCreatorId: "11111111-1111-4111-8111-111111111111",
    spaceCreatorName: "Felix",
    passwordProtected: false,
    spaceId: "space-1",
    spaceName: "Ops Room",
  },
};

function createViewState(
  screenState = createInitialSpaceScreenState(),
  overrides:
    | (Omit<Partial<SpaceSessionContext>, "profile" | "session"> & {
        profile?: Partial<SpaceSessionContext["profile"]>;
        session?: Partial<SpaceSessionContext["session"]>;
      })
    | undefined = undefined,
  sessionDiagnostics = createSessionDiagnostics(),
  composerActivity?: ComposerActivitySource
) {
  const contextOverrides = overrides ?? {};
  return buildSpaceSessionViewState({
    context: {
      ...DEFAULT_SESSION_CONTEXT,
      ...contextOverrides,
      profile: {
        ...DEFAULT_SESSION_CONTEXT.profile,
        ...contextOverrides.profile,
      },
      session: {
        ...DEFAULT_SESSION_CONTEXT.session,
        ...contextOverrides.session,
      },
    },
    resources: {
      composerActivity,
      sessionDiagnostics,
    },
    screenState,
  });
}

function countOccurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

function createSessionDiagnostics() {
  return {
    openMeldServiceLabel: "running",
    canWakeLocalAgentsLabel: "likely available",
  };
}

async function waitForPiTuiRender(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}
