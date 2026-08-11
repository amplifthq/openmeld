import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDaemonServiceAlignmentProgressUi } from "../src/system/local-service-alignment-progress-ui";

const {
  spinnerClearMock,
  spinnerMessageMock,
  spinnerStartMock,
  spinnerStopMock,
} = vi.hoisted(() => ({
  spinnerClearMock: vi.fn(),
  spinnerMessageMock: vi.fn(),
  spinnerStartMock: vi.fn(),
  spinnerStopMock: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
  spinner: () => ({
    start: spinnerStartMock,
    stop: spinnerStopMock,
    message: spinnerMessageMock,
    cancel: vi.fn(),
    error: vi.fn(),
    clear: spinnerClearMock,
    isCancelled: false,
  }),
}));

describe("local service alignment progress UI", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    spinnerClearMock.mockReset();
    spinnerMessageMock.mockReset();
    spinnerStartMock.mockReset();
    spinnerStopMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stays silent when alignment finishes before the spinner delay", () => {
    const progressUi = createDaemonServiceAlignmentProgressUi({
      view: "human",
      isTTY: true,
      delayMs: 250,
    });

    progressUi.onProgress("inspecting_local_service");
    progressUi.complete(
      "OpenMeld repaired and aligned the local background service."
    );
    vi.advanceTimersByTime(250);

    expect(spinnerStartMock).not.toHaveBeenCalled();
    expect(spinnerStopMock).not.toHaveBeenCalled();
    expect(spinnerClearMock).not.toHaveBeenCalled();
  });

  it("shows rolling step copy and a completion message after the delay", () => {
    const progressUi = createDaemonServiceAlignmentProgressUi({
      view: "human",
      isTTY: true,
      delayMs: 250,
    });

    progressUi.onProgress("inspecting_local_service");
    vi.advanceTimersByTime(250);
    progressUi.onProgress("stopping_old_service_processes");
    progressUi.complete(
      "OpenMeld repaired and aligned the local background service."
    );

    expect(spinnerStartMock).toHaveBeenCalledWith(
      "Inspecting local OpenMeld service..."
    );
    expect(spinnerMessageMock).toHaveBeenCalledWith(
      "Stopping old OpenMeld service processes..."
    );
    expect(spinnerStopMock).toHaveBeenCalledWith(
      "OpenMeld repaired and aligned the local background service."
    );
  });

  it("clears the visible spinner when alignment fails", () => {
    const progressUi = createDaemonServiceAlignmentProgressUi({
      view: "human",
      isTTY: true,
      delayMs: 250,
    });

    progressUi.onProgress("inspecting_local_service");
    vi.advanceTimersByTime(250);
    progressUi.fail();

    expect(spinnerStartMock).toHaveBeenCalledWith(
      "Inspecting local OpenMeld service..."
    );
    expect(spinnerClearMock).toHaveBeenCalledTimes(1);
    expect(spinnerStopMock).not.toHaveBeenCalled();
  });
});
