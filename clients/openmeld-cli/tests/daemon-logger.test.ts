import { afterEach, describe, expect, it, vi } from "vitest";

import { warnDaemonEvent } from "../src/local-service/core/logger";

describe("daemon logger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("writes timestamped daemon events as one physical line", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-10T08:00:00.000Z"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
      // Keep test output focused on the log-line assertion.
    });

    warnDaemonEvent("[openmeld.runtime_reporting.write_failed]", {
      error: "first line\nsecond line",
      event: "cli.runtime_reporting.write_failed",
      omitted: undefined,
    });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      '2026-07-10T08:00:00.000Z [openmeld.runtime_reporting.write_failed] {"error":"first line\\nsecond line","event":"cli.runtime_reporting.write_failed"}'
    );
    const [line] = warnSpy.mock.calls[0] ?? [];
    expect(String(line).split("\n")).toHaveLength(1);
  });
});
