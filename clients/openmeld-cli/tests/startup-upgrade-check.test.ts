import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import packageJson from "../package.json";

const {
  confirmMock,
  ensureVersionStateReadyMock,
  fetchPackageVersionMetadataMock,
  fetchLatestPackageVersionMock,
  isCancelMock,
  resolveRuntimeContextMock,
  runUpgradeMock,
} = vi.hoisted(() => ({
  confirmMock: vi.fn(),
  ensureVersionStateReadyMock: vi.fn(),
  fetchPackageVersionMetadataMock: vi.fn(),
  fetchLatestPackageVersionMock: vi.fn(),
  isCancelMock: vi.fn((value: unknown) => value === "__cancel__"),
  resolveRuntimeContextMock: vi.fn(),
  runUpgradeMock: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
  confirm: (...args: unknown[]) => confirmMock(...args),
  isCancel: (value: unknown) => isCancelMock(value),
}));

vi.mock("../src/runtime/context", async () => {
  const actual = await vi.importActual<typeof import("../src/runtime/context")>(
    "../src/runtime/context"
  );
  return {
    ...actual,
    resolveRuntimeContext: (...args: unknown[]) =>
      resolveRuntimeContextMock(...args),
  };
});

vi.mock("../src/commands/upgrade", () => ({
  runUpgrade: (...args: unknown[]) => runUpgradeMock(...args),
}));

vi.mock("../src/config/version-state", async () => {
  const actual = await vi.importActual<
    typeof import("../src/config/version-state")
  >("../src/config/version-state");
  return {
    ...actual,
    fetchPackageVersionMetadata: (...args: unknown[]) =>
      fetchPackageVersionMetadataMock(...args),
    fetchLatestPackageVersion: (...args: unknown[]) =>
      fetchLatestPackageVersionMock(...args),
    ensureVersionStateReady: (...args: unknown[]) =>
      ensureVersionStateReadyMock(...args),
  };
});

import { maybeRunStartupUpgradeCheck } from "../src/system/startup-upgrade-check";

const operationalArgv = ["node", "openmeld", "space"] as const;
const isOperationalCommand = (token: string) => token === "space";

describe("startup upgrade check", () => {
  beforeEach(() => {
    process.env.OPENMELD_STARTUP_AUTO_UPGRADE = undefined;
    process.env.OPENMELD_INTERNAL_SKIP_STARTUP_UPGRADE = undefined;
    confirmMock.mockReset().mockResolvedValue(true);
    fetchPackageVersionMetadataMock.mockReset().mockResolvedValue({
      version: packageJson.version,
      deprecated: null,
    });
    fetchLatestPackageVersionMock.mockReset().mockResolvedValue("9.9.9");
    ensureVersionStateReadyMock.mockReset().mockResolvedValue({
      v: 1,
      last_version: packageJson.version,
      latest_version: packageJson.version,
      last_checked_at: "2026-03-11T00:00:00.000Z",
      dismissed_version: null,
      updated_at: "2026-03-11T00:00:00.000Z",
    });
    isCancelMock.mockReset().mockImplementation((value: unknown) => {
      return value === "__cancel__";
    });
    resolveRuntimeContextMock.mockReset().mockResolvedValue({
      resolvedView: "human",
      interactive: true,
    });
    runUpgradeMock.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("prompts and upgrades when latest version is newer", async () => {
    const result = await maybeRunStartupUpgradeCheck({
      argv: [...operationalArgv],
      isKnownTopLevelCommand: isOperationalCommand,
    });

    expect(result).toEqual({
      upgraded: true,
      resolvedView: "human",
      deprecatedWarning: null,
      trigger: "interactive_prompt",
      latestVersion: "9.9.9",
    });
    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(runUpgradeMock).toHaveBeenCalledWith({
      yes: true,
      view: "human",
    });
  });

  it("skips when user declines upgrade prompt", async () => {
    confirmMock.mockResolvedValueOnce(false);

    const result = await maybeRunStartupUpgradeCheck({
      argv: [...operationalArgv],
      isKnownTopLevelCommand: isOperationalCommand,
    });

    expect(result).toEqual({
      upgraded: false,
      resolvedView: "human",
      deprecatedWarning: null,
      trigger: null,
      latestVersion: "9.9.9",
    });
    expect(runUpgradeMock).not.toHaveBeenCalled();
  });

  it("auto upgrades in non-interactive runtime when startup auto-upgrade is enabled", async () => {
    resolveRuntimeContextMock.mockResolvedValueOnce({
      resolvedView: "agent",
      interactive: false,
    });

    const result = await maybeRunStartupUpgradeCheck({
      argv: [...operationalArgv],
      isKnownTopLevelCommand: isOperationalCommand,
    });

    expect(result).toEqual({
      upgraded: true,
      resolvedView: "agent",
      deprecatedWarning: null,
      trigger: "non_interactive_auto",
      latestVersion: "9.9.9",
    });
    expect(confirmMock).not.toHaveBeenCalled();
    expect(runUpgradeMock).toHaveBeenCalledWith({
      yes: true,
      view: "agent",
    });
  });

  it("skips non-interactive auto-upgrade when OPENMELD_STARTUP_AUTO_UPGRADE=0", async () => {
    process.env.OPENMELD_STARTUP_AUTO_UPGRADE = "0";
    resolveRuntimeContextMock.mockResolvedValueOnce({
      resolvedView: "agent",
      interactive: false,
    });

    const result = await maybeRunStartupUpgradeCheck({
      argv: [...operationalArgv],
      isKnownTopLevelCommand: isOperationalCommand,
    });

    expect(result).toEqual({
      upgraded: false,
      resolvedView: "agent",
      deprecatedWarning: null,
      trigger: null,
      latestVersion: null,
    });
    expect(runUpgradeMock).not.toHaveBeenCalled();
  });

  it("skips startup check for maintenance-exempt commands", async () => {
    const result = await maybeRunStartupUpgradeCheck({
      argv: ["node", "openmeld", "doctor"],
      isKnownTopLevelCommand: (token) => token === "doctor",
    });

    expect(result).toEqual({
      upgraded: false,
      resolvedView: null,
      deprecatedWarning: null,
      trigger: null,
      latestVersion: null,
    });
    expect(fetchLatestPackageVersionMock).not.toHaveBeenCalled();
    expect(fetchPackageVersionMetadataMock).not.toHaveBeenCalled();
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it("initializes version state before upgrade when state is missing", async () => {
    const result = await maybeRunStartupUpgradeCheck({
      argv: [...operationalArgv],
      isKnownTopLevelCommand: isOperationalCommand,
    });

    expect(result).toEqual({
      upgraded: true,
      resolvedView: "human",
      deprecatedWarning: null,
      trigger: "interactive_prompt",
      latestVersion: "9.9.9",
    });
    expect(ensureVersionStateReadyMock).toHaveBeenCalledWith({
      currentVersion: packageJson.version,
    });
  });

  it("returns deprecated warning when current version is deprecated", async () => {
    fetchPackageVersionMetadataMock.mockResolvedValueOnce({
      version: packageJson.version,
      deprecated: "Critical bug in this release.",
    });
    confirmMock.mockResolvedValueOnce(false);

    const result = await maybeRunStartupUpgradeCheck({
      argv: [...operationalArgv],
      isKnownTopLevelCommand: isOperationalCommand,
    });

    expect(result).toEqual({
      upgraded: false,
      resolvedView: "human",
      deprecatedWarning: {
        currentVersion: packageJson.version,
        deprecatedMessage: "Critical bug in this release.",
        upgradeCommand: "openmeld upgrade",
      },
      trigger: null,
      latestVersion: "9.9.9",
    });
  });

  it("keeps startup upgrade check enabled for start so CLI updates are not missed", async () => {
    confirmMock.mockResolvedValueOnce(false);

    const result = await maybeRunStartupUpgradeCheck({
      argv: ["node", "openmeld", "start"],
      isKnownTopLevelCommand: (token) => token === "start",
    });

    expect(result).toEqual({
      upgraded: false,
      resolvedView: "human",
      deprecatedWarning: null,
      trigger: null,
      latestVersion: "9.9.9",
    });
    expect(fetchPackageVersionMetadataMock).toHaveBeenCalledTimes(1);
    expect(fetchLatestPackageVersionMock).toHaveBeenCalledTimes(1);
    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(runUpgradeMock).not.toHaveBeenCalled();
  });

  it("skips startup check when OPENMELD_INTERNAL_SKIP_STARTUP_UPGRADE=1", async () => {
    process.env.OPENMELD_INTERNAL_SKIP_STARTUP_UPGRADE = "1";

    const result = await maybeRunStartupUpgradeCheck({
      argv: [...operationalArgv],
      isKnownTopLevelCommand: isOperationalCommand,
    });

    expect(result).toEqual({
      upgraded: false,
      resolvedView: null,
      deprecatedWarning: null,
      trigger: null,
      latestVersion: null,
    });
    expect(fetchLatestPackageVersionMock).not.toHaveBeenCalled();
    expect(fetchPackageVersionMetadataMock).not.toHaveBeenCalled();
  });

  it("throws when non-interactive auto-upgrade install fails", async () => {
    resolveRuntimeContextMock.mockResolvedValueOnce({
      resolvedView: "agent",
      interactive: false,
    });
    runUpgradeMock.mockRejectedValueOnce(new Error("install failed"));

    await expect(
      maybeRunStartupUpgradeCheck({
        argv: [...operationalArgv],
        isKnownTopLevelCommand: isOperationalCommand,
      })
    ).rejects.toThrow("install failed");
  });
});
