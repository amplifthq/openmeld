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
  buildDaemonRepairDecisionPromptConfig,
  buildDaemonStartDecisionPromptConfig,
  buildDaemonStartDeferredCard,
  buildDaemonStartNeedsAttentionCard,
  formatDaemonStartAutoRepairResolvedMessage,
  formatDaemonStartStartedManage,
  formatDaemonStartStartedMeaning,
  formatDaemonStartStartedNextStep,
  getDaemonStartStartedTitle,
  promptForDaemonRepairDecision,
  promptForDaemonStartDecision,
  runDaemonStartDecisionPrompt,
  shouldOfferDaemonStartDecision,
} from "../src/system/local-service-start-decision";

describe("local service start decision", () => {
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

  it("builds the canonical prompt copy", () => {
    expect(buildDaemonStartDecisionPromptConfig()).toEqual({
      message:
        "OpenMeld Service is not running. Start it now?\nWithout it, this computer can't receive local Wake work.",
      initialValue: "start",
      options: [
        {
          value: "start",
          label: "Yes, start it for me",
          hint: "Recommended",
        },
        {
          value: "not_now",
          label: "Not now",
        },
      ],
    });
  });

  it("builds the canonical repair prompt copy", () => {
    expect(buildDaemonRepairDecisionPromptConfig()).toEqual({
      message:
        "Reconnect OpenMeld Service before this computer can receive local Wake work. OpenMeld can reconnect it for you now.\nReconnect it now?",
      initialValue: "repair",
      options: [
        {
          value: "repair",
          label: "Yes, reconnect it for me",
          hint: "Recommended",
        },
        {
          value: "not_now",
          label: "Not now",
        },
      ],
    });
  });

  it("treats not_running and stale as the same user decision", () => {
    expect(shouldOfferDaemonStartDecision("not_running")).toBe(true);
    expect(shouldOfferDaemonStartDecision("stale")).toBe(true);
    expect(shouldOfferDaemonStartDecision("running")).toBe(false);
    expect(shouldOfferDaemonStartDecision("unknown")).toBe(false);
    expect(shouldOfferDaemonStartDecision(null)).toBe(false);
  });

  it("returns the selected start decision", async () => {
    selectMock.mockResolvedValueOnce("start");

    await expect(promptForDaemonStartDecision()).resolves.toBe("start");
    expect(selectMock).toHaveBeenCalledWith(
      buildDaemonStartDecisionPromptConfig()
    );
  });

  it("returns the selected repair decision", async () => {
    selectMock.mockResolvedValueOnce("repair");

    await expect(promptForDaemonRepairDecision()).resolves.toBe("repair");
    expect(selectMock).toHaveBeenCalledWith(
      buildDaemonRepairDecisionPromptConfig()
    );
  });

  it("returns not_now when user chooses not now", async () => {
    selectMock.mockResolvedValueOnce("not_now");

    const result = await runDaemonStartDecisionPrompt({
      startService: vi.fn(),
    });

    expect(result).toBe("not_now");
  });

  it("stays silent when the user cancels the prompt", async () => {
    selectMock.mockResolvedValueOnce("__cancel__");

    const result = await runDaemonStartDecisionPrompt({
      startService: vi.fn(),
    });

    expect(result).toBe("cancelled");
  });

  it("returns failed when start throws", async () => {
    selectMock.mockResolvedValueOnce("start");

    const result = await runDaemonStartDecisionPrompt({
      startService: vi.fn(() => {
        throw new Error("boom");
      }),
    });

    expect(result).toBe("failed");
  });

  it("passes through failed_with_card when start already handled the failure UI", async () => {
    selectMock.mockResolvedValueOnce("start");
    const failure = {
      outcome: "failed_with_card",
      errorMessage: "launchd job: state=not running, runs=0",
    };

    const result = await runDaemonStartDecisionPrompt({
      startService: vi.fn().mockResolvedValue(failure),
    });

    expect(result).toEqual(failure);
  });

  it("passes through deferred_with_card when cleanup guidance already handled the UI", async () => {
    selectMock.mockResolvedValueOnce("start");

    const result = await runDaemonStartDecisionPrompt({
      startService: vi.fn().mockResolvedValue("deferred_with_card"),
    });

    expect(result).toBe("deferred_with_card");
  });

  it("passes through cancelled when nested repair prompt is cancelled", async () => {
    selectMock.mockResolvedValueOnce("start");

    const result = await runDaemonStartDecisionPrompt({
      startService: vi.fn().mockResolvedValue("cancelled"),
    });

    expect(result).toBe("cancelled");
  });

  it("exposes canonical outcome card copy", () => {
    expect(buildDaemonStartDeferredCard()).toEqual({
      title: "OpenMeld Service is off",
      rows: [
        {
          label: "What happened",
          value: "OpenMeld Service isn't running.",
        },
        {
          label: "Next",
          value: "Start later with `openmeld service start`.",
        },
      ],
    });
    expect(
      buildDaemonStartNeedsAttentionCard({
        summary: "OpenMeld could not finish starting the background service.",
        autoRepairAttempted: true,
      })
    ).toEqual({
      title: "OpenMeld Service couldn't start",
      rows: [
        {
          label: "What happened",
          value: "OpenMeld could not finish starting the background service.",
        },
        {
          label: "Next",
          value: "Run `openmeld setup` to repair OpenMeld Service.",
        },
      ],
    });
    expect(getDaemonStartStartedTitle()).toBe("✅ OpenMeld Service Started");
    expect(formatDaemonStartAutoRepairResolvedMessage()).toBe(
      "OpenMeld fixed one local startup issue automatically. No action needed."
    );
    expect(formatDaemonStartStartedMeaning()).toBe(
      "OpenMeld Service is running on this device. Cloud connection may still be reconnecting."
    );
    expect(formatDaemonStartStartedManage()).toBe(
      "Check it any time with `openmeld service status` without stopping it. Stop it any time with `openmeld service stop`."
    );
    expect(formatDaemonStartStartedNextStep()).toBe(
      "Use `openmeld service status` if you want to check the local service link and cloud connection."
    );
    expect(formatDaemonStartStartedMeaning()).not.toContain("Ready —");
  });

  it("renders dev-lane service commands in cards", () => {
    vi.stubEnv("OPENMELD_USER_FACING_CLI_COMMAND", "openmeld-dev");

    expect(buildDaemonStartDeferredCard()).toEqual({
      title: "OpenMeld Service is off",
      rows: [
        {
          label: "What happened",
          value: "OpenMeld Service isn't running.",
        },
        {
          label: "Next",
          value: "Start later with `openmeld-dev service start`.",
        },
      ],
    });
    expect(
      buildDaemonStartNeedsAttentionCard({
        summary: "OpenMeld could not finish starting the background service.",
      }).rows.at(-1)?.value
    ).toBe("Run `openmeld-dev setup` to repair OpenMeld Service.");
    expect(formatDaemonStartStartedManage()).toBe(
      "Check it any time with `openmeld-dev service status` without stopping it. Stop it any time with `openmeld-dev service stop`."
    );
  });
});
