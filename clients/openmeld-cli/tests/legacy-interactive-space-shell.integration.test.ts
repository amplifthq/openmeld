import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LegacyInteractiveSpaceShell } from "../src/space/shell/legacy-interactive-space-shell";
import { createInitialSpaceScreenState } from "../src/space/state/space-screen-state";
import { buildSpaceSessionViewState } from "../src/space/view/build-space-session-view-state";
import type { SpaceSessionContext } from "../src/space/view/space-session-view-state";

const clearLineMock = vi.fn();
const createInterfaceMock = vi.fn();
const cursorToMock = vi.fn();
const moveCursorMock = vi.fn();

vi.mock("node:readline", () => {
  return {
    clearLine: (...args: unknown[]) => clearLineMock(...args),
    createInterface: (...args: unknown[]) => createInterfaceMock(...args),
    cursorTo: (...args: unknown[]) => cursorToMock(...args),
    moveCursor: (...args: unknown[]) => moveCursorMock(...args),
  };
});

describe("LegacyInteractiveSpaceShell", () => {
  const originalIsTTY = process.stdout.isTTY;
  const originalColumns = process.stdout.columns;
  let writeSpy: {
    mock: {
      calls: unknown[][];
    };
    mockRestore(): void;
  };
  const noop = (): void => undefined;

  beforeEach(() => {
    clearLineMock.mockReset();
    createInterfaceMock.mockReset();
    cursorToMock.mockReset();
    moveCursorMock.mockReset();
    writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    createInterfaceMock.mockReturnValue(createReadlineStub());
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      value: 80,
    });
  });

  afterEach(() => {
    writeSpy.mockRestore();
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: originalIsTTY,
    });
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      value: originalColumns,
    });
  });

  it("switches prompt prefix when a draft exists", () => {
    const readline = createReadlineStub();
    createInterfaceMock.mockReturnValue(readline);
    const shell = new LegacyInteractiveSpaceShell({
      composePromptPrefix: "[draft] ",
      onLine: noop,
      onClose: noop,
    });

    shell.start();
    shell.render(createViewState(createInitialSpaceScreenState()));
    shell.render({
      ...createViewState(createInitialSpaceScreenState()),
      composer: {
        ...createViewState(createInitialSpaceScreenState()).composer,
        bufferText: "line-1",
        hasDraft: true,
      },
    });

    expect(readline.setPrompt).toHaveBeenCalledWith("- Felix (human): ");
    expect(readline.setPrompt).toHaveBeenLastCalledWith(
      "[draft] - Felix (human): "
    );
  });

  it("does not redraw the same overlay line twice", () => {
    const shell = new LegacyInteractiveSpaceShell({
      onLine: noop,
      onClose: noop,
    });

    shell.start();
    const overlayState = createViewState({
      ...createInitialSpaceScreenState(),
      status: {
        overlayLine: "system busy",
      },
    });
    shell.render(overlayState);
    shell.render(overlayState);

    const overlayWrites = writeSpy.mock.calls.filter(([value]) =>
      String(value).includes("system busy")
    );
    expect(overlayWrites).toHaveLength(1);
  });

  it("keeps non-tty interactive clearing as a no-op", () => {
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: false,
    });
    const shell = new LegacyInteractiveSpaceShell({
      onLine: noop,
      onClose: noop,
    });

    shell.clearSubmittedInputLine("hello");
    shell.prepareExternalWrite();

    expect(clearLineMock).not.toHaveBeenCalled();
    expect(cursorToMock).not.toHaveBeenCalled();
    expect(moveCursorMock).not.toHaveBeenCalled();
  });

  it("stops refreshing the prompt after readline closes itself", () => {
    const readline = createReadlineStub();
    const onClose = vi.fn();
    createInterfaceMock.mockReturnValue(readline);
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: false,
    });

    const shell = new LegacyInteractiveSpaceShell({
      onLine: noop,
      onClose,
    });

    shell.start();
    readline.emit("close");
    shell.render(createViewState(createInitialSpaceScreenState()));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(readline.prompt).toHaveBeenCalledTimes(1);
  });

  it("stays promptless in readonly watch mode", () => {
    const readline = createReadlineStub();
    createInterfaceMock.mockReturnValue(readline);
    const shell = new LegacyInteractiveSpaceShell({
      onLine: noop,
      onClose: noop,
    });

    shell.start();
    shell.render(
      createViewState(createInitialSpaceScreenState(), {
        connectionMode: "watch",
      })
    );

    expect(readline.setPrompt).not.toHaveBeenCalledWith("- Felix (human): ");
  });
});

function createReadlineStub() {
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>();

  return {
    close: vi.fn(),
    emit(event: string, ...args: unknown[]) {
      for (const listener of listeners.get(event) ?? []) {
        listener(...args);
      }
    },
    getCursorPos: vi.fn(() => ({
      cols: 0,
      rows: 0,
    })),
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return undefined;
    }),
    prompt: vi.fn(),
    removeAllListeners: vi.fn((event?: string) => {
      if (event) {
        listeners.delete(event);
        return undefined;
      }
      listeners.clear();
      return undefined;
    }),
    setPrompt: vi.fn(),
  };
}

const DEFAULT_SESSION_CONTEXT: SpaceSessionContext = {
  surface: "active-session",
  connectionMode: "join",
  gatewayUrl: "http://localhost:8080",
  profile: {
    kind: "human",
    profileId: "hum_felix",
    profileName: "Felix",
  },
  session: {
    passwordProtected: false,
    spaceId: "space-1",
    spaceName: "Ops Room",
  },
};

function createViewState(
  screenState = createInitialSpaceScreenState(),
  contextOverrides?: Partial<SpaceSessionContext>
) {
  return buildSpaceSessionViewState({
    context: {
      ...DEFAULT_SESSION_CONTEXT,
      ...contextOverrides,
    },
    screenState,
  });
}
