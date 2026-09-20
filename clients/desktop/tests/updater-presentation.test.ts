import type { DesktopUpdaterState } from "@openmeld/schemas";
import { describe, expect, it } from "vitest";
import { desktopUpdaterPresentation } from "../src/shared/updater-presentation";

const installed: DesktopUpdaterState = {
  status: "idle",
  currentVersion: "0.1.1",
  version: null,
  percent: null,
  errorStage: null,
};

describe("Desktop updater presentation", () => {
  it.each([
    [
      "idle",
      null,
      "Check for updates",
      "check",
      "Check for updates",
      false,
      "none",
    ],
    [
      "checking",
      null,
      "Checking for updates…",
      undefined,
      undefined,
      true,
      "none",
    ],
    [
      "current",
      null,
      "You're up to date",
      "check",
      "Check for updates",
      false,
      "none",
    ],
    [
      "available",
      null,
      "Update available",
      "download",
      "Download update",
      true,
      "dismissible",
    ],
    [
      "downloading",
      null,
      "Downloading update…",
      undefined,
      undefined,
      true,
      "dismissible",
    ],
    [
      "downloaded",
      null,
      "Ready to restart",
      "restart",
      "Restart to update",
      true,
      "dismissible",
    ],
    [
      "preparing",
      null,
      "Saving before restart…",
      undefined,
      undefined,
      false,
      "required",
    ],
    [
      "installing",
      null,
      "Restarting to update…",
      undefined,
      undefined,
      false,
      "required",
    ],
    [
      "unavailable",
      null,
      "Updates aren't available in this build",
      undefined,
      undefined,
      false,
      "none",
    ],
    [
      "error",
      "check",
      "Couldn't check for updates",
      "check",
      "Try again",
      true,
      "none",
    ],
    [
      "error",
      null,
      "Couldn't check for updates",
      "check",
      "Try again",
      true,
      "none",
    ],
    [
      "error",
      "download",
      "Couldn't download the update",
      "download",
      "Retry download",
      true,
      "dismissible",
    ],
    [
      "error",
      "restart",
      "Couldn't restart",
      "restart",
      "Retry restart",
      true,
      "dismissible",
    ],
    [
      "error",
      "install",
      "Update couldn't finish",
      undefined,
      undefined,
      false,
      "required",
    ],
  ] as const)("maps %s / %s to an honest outcome and allowed action", (status, errorStage, headline, action, label, attention, notice) => {
    const result = desktopUpdaterPresentation({
      ...installed,
      status,
      errorStage,
      version: "0.1.2",
    });
    expect(result).toMatchObject({
      headline,
      action,
      label,
      attention,
      notice,
    });
    // Native menu messages must remain meaningful without a React heading.
    expect(result.message).toContain(headline);
  });

  it.each([
    "checking",
    "error",
  ] as const)("does not invent pending-update attention during %s without a target", (status) => {
    expect(
      desktopUpdaterPresentation({ ...installed, status, errorStage: "check" })
        .attention
    ).toBe(false);
  });

  it.each([
    ["available", "download"],
    ["downloading", undefined],
    ["downloaded", "restart"],
  ] as const)("does not fabricate an unknown target version in %s", (status, action) => {
    const result = desktopUpdaterPresentation({ ...installed, status });
    expect(result.message).not.toContain("null");
    expect(result.message).not.toContain("undefined");
    expect(result.action).toBe(action);
  });

  it("does not mistake an unread initial snapshot for a completed check", () => {
    expect(desktopUpdaterPresentation(null)).toMatchObject({
      headline: "Loading update status…",
      action: undefined,
      attention: false,
      notice: "none",
    });
  });

  it("waits for native verification even at 100 percent", () => {
    const result = desktopUpdaterPresentation({
      ...installed,
      status: "downloading",
      percent: 100,
    });
    expect(result.action).toBeUndefined();
    expect(result.message).toContain("100%");
    expect(result.headline).toBe("Downloading update…");
  });

  it("keeps terminal installation recovery distinct from a retryable restart", () => {
    const result = desktopUpdaterPresentation({
      ...installed,
      status: "error",
      errorStage: "install",
    });
    expect(result.message).toContain("Editing is paused");
    expect(result.message).toContain("Choose Quit from the app menu");
    expect(result.message).toContain("then reopen Desktop");
    expect(result.message).toContain("may finish when you quit");
    expect(result.action).toBeUndefined();
  });
});
