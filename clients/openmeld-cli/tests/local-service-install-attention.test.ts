import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { isCancelMock, selectMock } = vi.hoisted(() => ({
  isCancelMock: vi.fn((value: unknown) => value === "__cancel__"),
  selectMock: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
  isCancel: (value: unknown) => isCancelMock(value),
  select: selectMock,
}));

import {
  buildDaemonInstallDecisionPromptConfig,
  formatDaemonInstallDeferredMessage,
  formatDaemonInstallFailedMessage,
  formatDaemonServiceDowngradeBlockedRecommendation,
  formatDaemonServiceInstallRecommendationNextStep,
  formatDaemonServiceMissingAction,
  formatDaemonServiceMissingMeaning,
  formatDaemonServiceMissingRecommendation,
  formatDaemonServiceMissingStatus,
  formatDaemonServiceOutdatedRecommendation,
  formatDaemonServiceOutdatedStatus,
  getDaemonDowngradeBlockedTitle,
  promptForDaemonInstallDecision,
  runDaemonInstallDecisionPrompt,
} from "../src/system/local-service-install-attention";

describe("local service install attention", () => {
  beforeEach(() => {
    isCancelMock.mockReset().mockImplementation((value: unknown) => {
      return value === "__cancel__";
    });
    selectMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("builds the canonical missing-install prompt copy", () => {
    expect(
      buildDaemonInstallDecisionPromptConfig({
        kind: "missing",
      })
    ).toEqual({
      message:
        "OpenMeld Service is missing. Install it now?\nWithout it, this computer can't receive local Wake work.",
      initialValue: "install",
      options: [
        {
          value: "install",
          label: "Yes, install it for me",
          hint: "Recommended",
        },
        {
          value: "not_now",
          label: "Not now",
        },
      ],
    });
  });

  it("builds the canonical explicit update-required prompt copy", () => {
    expect(
      buildDaemonInstallDecisionPromptConfig({
        kind: "outdated",
        installedVersion: "0.1.5",
        expectedVersion: "0.1.9",
      })
    ).toEqual({
      message:
        "OpenMeld Service update required. Update it now?\nThis service artifact is not compatible with current local Wake execution.\nInstalled v0.1.5, expected v0.1.9.",
      initialValue: "install",
      options: [
        {
          value: "install",
          label: "Yes, update it for me",
          hint: "Recommended",
        },
        {
          value: "not_now",
          label: "Not now",
        },
      ],
    });
  });

  it("returns the selected install decision", async () => {
    selectMock.mockResolvedValueOnce("install");

    await expect(
      promptForDaemonInstallDecision({
        kind: "missing",
      })
    ).resolves.toBe("install");
  });

  it("emits the canonical deferred message when user skips install", async () => {
    selectMock.mockResolvedValueOnce("not_now");
    const emitLine = vi.fn();

    const result = await runDaemonInstallDecisionPrompt({
      kind: "missing",
      emitLine,
      installService: vi.fn(),
    });

    expect(result).toBe("not_now");
    expect(emitLine).toHaveBeenCalledWith(
      formatDaemonInstallDeferredMessage("missing")
    );
  });

  it("stays silent when install prompt is cancelled", async () => {
    selectMock.mockResolvedValueOnce("__cancel__");
    const emitLine = vi.fn();

    const result = await runDaemonInstallDecisionPrompt({
      kind: "outdated",
      emitLine,
      installService: vi.fn(),
    });

    expect(result).toBe("cancelled");
    expect(emitLine).not.toHaveBeenCalled();
  });

  it("emits the canonical failed message when install throws", async () => {
    selectMock.mockResolvedValueOnce("install");
    const emitLine = vi.fn();

    const result = await runDaemonInstallDecisionPrompt({
      kind: "outdated",
      emitLine,
      installService: vi.fn(() => {
        throw new Error("boom");
      }),
    });

    expect(result).toBe("failed");
    expect(emitLine).toHaveBeenCalledWith(
      formatDaemonInstallFailedMessage("outdated")
    );
  });

  it("exposes canonical missing, outdated, and blocked copy", () => {
    expect(formatDaemonServiceMissingRecommendation()).toBe(
      "OpenMeld Service is not installed yet. Install it so this computer can receive local Wake work."
    );
    expect(formatDaemonServiceInstallRecommendationNextStep()).toBe(
      "Run `openmeld service install` now, or re-run command with `--service-auto-install always`."
    );
    expect(formatDaemonServiceMissingStatus()).toBe("Not installed yet.");
    expect(formatDaemonServiceMissingMeaning()).toBe(
      "Missing — install OpenMeld Service before this computer can receive local Wake work."
    );
    expect(formatDaemonServiceMissingAction()).toBe(
      "Run `openmeld service install` to set it up."
    );
    expect(
      formatDaemonServiceOutdatedRecommendation({
        installedVersion: "0.1.5",
        expectedVersion: "0.1.9",
      })
    ).toBe(
      "OpenMeld Service version differs from this CLI (installed v0.1.5, CLI v0.1.9). This is diagnostic unless service compatibility fails."
    );
    expect(
      formatDaemonServiceOutdatedStatus({
        installedVersion: "0.1.5",
        expectedVersion: "0.1.9",
      })
    ).toBe("Version differs from this CLI (installed v0.1.5, CLI v0.1.9).");
    expect(
      formatDaemonServiceDowngradeBlockedRecommendation({
        installedVersion: "0.2.0",
        expectedVersion: "0.1.9",
      })
    ).toBe(
      "OpenMeld Service is already newer (installed v0.2.0, current CLI v0.1.9). OpenMeld will not downgrade it automatically. Run `openmeld upgrade`."
    );
    expect(
      formatDaemonServiceDowngradeBlockedRecommendation({
        expectedVersion: "0.1.9",
      })
    ).toBe(
      "OpenMeld Service is already newer than this CLI. OpenMeld will not downgrade it automatically. Run `openmeld upgrade`."
    );
    expect(getDaemonDowngradeBlockedTitle()).toBe(
      "⛔ OpenMeld Service Downgrade Blocked"
    );
  });

  it("renders service commands through the active openmeld-dev entry", () => {
    vi.stubEnv("OPENMELD_USER_FACING_CLI_COMMAND", "openmeld-dev");

    expect(formatDaemonServiceInstallRecommendationNextStep()).toBe(
      "Run `openmeld-dev service install` now, or re-run command with `--service-auto-install always`."
    );
    expect(formatDaemonServiceMissingAction()).toBe(
      "Run `openmeld-dev service install` to set it up."
    );
    expect(formatDaemonInstallDeferredMessage("missing")).toContain(
      "`openmeld-dev service install`"
    );
    expect(
      formatDaemonServiceDowngradeBlockedRecommendation({
        installedVersion: "0.2.0",
        expectedVersion: "0.1.9",
      })
    ).toContain("`openmeld-dev upgrade`");
  });
});
