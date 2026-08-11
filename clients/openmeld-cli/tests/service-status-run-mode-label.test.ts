import { describe, expect, it } from "vitest";
import {
  describeDaemonRuntimeStatus,
  formatDaemonRunModeLabel,
} from "../src/commands/service-status-view";
import type { DaemonServiceRuntimeStatus } from "../src/config/daemon-state";

function runningStatus(
  mode: DaemonServiceRuntimeStatus["mode"]
): DaemonServiceRuntimeStatus {
  return {
    status: "running",
    mode,
    pid: 4242,
    startedAt: "2026-07-03T00:00:00.000Z",
    updatedAt: "2026-07-03T00:00:00.000Z",
    managedBySystemService: mode === "background",
    serviceController: "launchd",
    autoStart: true,
  } as unknown as DaemonServiceRuntimeStatus;
}

describe("daemon run-mode status labels", () => {
  it("names a foreground service as terminal-bound", () => {
    expect(formatDaemonRunModeLabel("foreground")).toBe(
      "foreground — stops when the terminal closes"
    );
  });

  it("names a background service as persistent", () => {
    expect(formatDaemonRunModeLabel("background")).toBe("background service");
  });

  it("falls back to unknown for an absent mode", () => {
    expect(formatDaemonRunModeLabel(null)).toBe("unknown");
  });

  it("describes a running foreground service honestly, without a raw mode token", () => {
    const text = describeDaemonRuntimeStatus(runningStatus("foreground"));
    expect(text).toContain("foreground — stops when the terminal closes");
    expect(text).not.toContain("mode=");
  });

  it("describes a running background service as persistent", () => {
    expect(describeDaemonRuntimeStatus(runningStatus("background"))).toContain(
      "background service"
    );
  });
});
