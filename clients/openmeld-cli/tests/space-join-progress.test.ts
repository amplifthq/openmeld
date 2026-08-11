import { beforeEach, describe, expect, it, vi } from "vitest";

const { createDelayedSpinnerMock } = vi.hoisted(() => ({
  createDelayedSpinnerMock: vi.fn(),
}));

vi.mock("../src/ui/delayed-spinner", () => ({
  createDelayedSpinner: (
    ...args: Parameters<typeof createDelayedSpinnerMock>
  ) => createDelayedSpinnerMock(...args),
}));

import {
  SPACE_JOIN_SPACE_READINESS_SPINNER_MESSAGE,
  shouldShowSpaceJoinProgress,
  withSpaceJoinProgress,
} from "../src/space/join-progress";

describe("space join progress", () => {
  beforeEach(() => {
    createDelayedSpinnerMock.mockReset();
  });

  it("shows progress only for interactive human terminal output", () => {
    expect(
      shouldShowSpaceJoinProgress({
        resolvedView: "human",
        interactive: true,
        output: "text",
      })
    ).toBe(true);
    expect(
      shouldShowSpaceJoinProgress({
        resolvedView: "agent",
        interactive: true,
        output: "text",
      })
    ).toBe(false);
    expect(
      shouldShowSpaceJoinProgress({
        resolvedView: "human",
        interactive: false,
        output: "text",
      })
    ).toBe(false);
    expect(
      shouldShowSpaceJoinProgress({
        resolvedView: "human",
        interactive: true,
        output: "ndjson",
      })
    ).toBe(false);
    expect(
      shouldShowSpaceJoinProgress({
        resolvedView: "human",
        interactive: true,
        rawStream: true,
      })
    ).toBe(false);
  });

  it("starts and completes the delayed spinner around async work", async () => {
    const spinner = {
      start: vi.fn(),
      complete: vi.fn(),
      fail: vi.fn(),
    };
    createDelayedSpinnerMock.mockReturnValue(spinner);

    const result = await withSpaceJoinProgress({
      enabled: true,
      message: SPACE_JOIN_SPACE_READINESS_SPINNER_MESSAGE,
      run: () => Promise.resolve("ready"),
    });

    expect(result).toBe("ready");
    expect(createDelayedSpinnerMock).toHaveBeenCalledWith({
      enabled: true,
      message: SPACE_JOIN_SPACE_READINESS_SPINNER_MESSAGE,
    });
    expect(spinner.start).toHaveBeenCalledTimes(1);
    expect(spinner.complete).toHaveBeenCalledTimes(1);
    expect(spinner.fail).not.toHaveBeenCalled();
  });

  it("clears the delayed spinner when async work fails", async () => {
    const spinner = {
      start: vi.fn(),
      complete: vi.fn(),
      fail: vi.fn(),
    };
    createDelayedSpinnerMock.mockReturnValue(spinner);
    const error = new Error("preflight failed");

    await expect(
      withSpaceJoinProgress({
        enabled: true,
        message: SPACE_JOIN_SPACE_READINESS_SPINNER_MESSAGE,
        run: () => Promise.reject(error),
      })
    ).rejects.toBe(error);

    expect(spinner.start).toHaveBeenCalledTimes(1);
    expect(spinner.complete).not.toHaveBeenCalled();
    expect(spinner.fail).toHaveBeenCalledTimes(1);
  });
});
