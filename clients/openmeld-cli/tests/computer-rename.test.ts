import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  runComputerCurrent,
  runComputerList,
  runComputerRename,
} from "../src/commands/computer";

const {
  collectObservedDeviceMetadataMock,
  createCliApiClientFoundationMock,
  createComputerFileAccessApiMock,
  createCurrentDeviceApiMock,
  createPresenterMock,
  readCurrentLocalDeviceIdMock,
  resolveBaseUrlMock,
  resolveRuntimeContextMock,
  listLocalRuntimesMock,
  getCurrentLocalRuntimeReplyReadinessMock,
  readFileAccessPolicyMock,
  setDisplayNameMock,
  writeObservedMetadataMock,
} = vi.hoisted(() => ({
  collectObservedDeviceMetadataMock: vi.fn(),
  createCliApiClientFoundationMock: vi.fn(),
  createComputerFileAccessApiMock: vi.fn(),
  createCurrentDeviceApiMock: vi.fn(),
  createPresenterMock: vi.fn(),
  readCurrentLocalDeviceIdMock: vi.fn(),
  resolveBaseUrlMock: vi.fn(),
  resolveRuntimeContextMock: vi.fn(),
  listLocalRuntimesMock: vi.fn(),
  getCurrentLocalRuntimeReplyReadinessMock: vi.fn(),
  readFileAccessPolicyMock: vi.fn(),
  setDisplayNameMock: vi.fn(),
  writeObservedMetadataMock: vi.fn(),
}));

vi.mock("@openmeld/api-client", () => ({
  createComputerFileAccessApi: createComputerFileAccessApiMock,
  createCurrentDeviceApi: createCurrentDeviceApiMock,
}));

vi.mock("../src/config/base-url", () => ({
  resolveBaseUrl: resolveBaseUrlMock,
}));

vi.mock("../src/runtime/context", () => ({
  resolveRuntimeContext: resolveRuntimeContextMock,
}));

vi.mock("../src/runtime/presenter/index", () => ({
  createPresenter: createPresenterMock,
}));

vi.mock("../src/space/api-client-foundation", () => ({
  createCliApiClientFoundation: createCliApiClientFoundationMock,
}));

vi.mock("../src/local-service/state/current-device-identity", () => ({
  readCurrentLocalDeviceId: readCurrentLocalDeviceIdMock,
}));

vi.mock("../src/system/observed-device-metadata", () => ({
  collectObservedDeviceMetadata: collectObservedDeviceMetadataMock,
}));

describe("openmeld computer rename", () => {
  const presenter = {
    data: vi.fn(),
    event: vi.fn(),
    line: vi.fn(),
    view: "human" as const,
  };

  beforeEach(() => {
    vi.resetAllMocks();
    resolveRuntimeContextMock.mockResolvedValue({
      interactive: false,
      resolvedView: "human",
      viewMode: "human",
    });
    createPresenterMock.mockReturnValue(presenter);
    resolveBaseUrlMock.mockResolvedValue("http://localhost:8080");
    createCliApiClientFoundationMock.mockReturnValue({
      baseUrl: "http://localhost:8080",
    });
    createCurrentDeviceApiMock.mockReturnValue({
      getCurrentLocalRuntimeReplyReadiness:
        getCurrentLocalRuntimeReplyReadinessMock,
      listLocalRuntimes: listLocalRuntimesMock,
      setDisplayName: setDisplayNameMock,
      writeObservedMetadata: writeObservedMetadataMock,
    });
    createComputerFileAccessApiMock.mockReturnValue({
      readPolicy: readFileAccessPolicyMock,
    });
    readCurrentLocalDeviceIdMock.mockResolvedValue("dev_local_123");
    collectObservedDeviceMetadataMock.mockResolvedValue({
      deviceType: "laptop",
      observedAtMs: 1_777_777_777,
      observedDisplayName: "Felix's MacBook Pro",
      osVersion: "25.4.0",
      platformFamily: "macOS",
    });
    setDisplayNameMock.mockResolvedValue({
      currentDeviceId: "dev_local_123",
      currentRuntimeLane: "dev-local",
      localRuntimes: [
        {
          deviceDisplayName: "Office MacBook",
          deviceDisplayNameSource: "user",
          deviceId: "dev_local_123",
          deviceType: "laptop",
          firstSeenAtMs: 1_700_000_000_000,
          isCurrent: true,
          lastObservedAtMs: 1_777_777_777,
          osVersion: "25.4.0",
          platformFamily: "macOS",
        },
      ],
    });
    listLocalRuntimesMock.mockResolvedValue(buildLocalRuntimesResponse());
    getCurrentLocalRuntimeReplyReadinessMock.mockResolvedValue(
      buildCurrentReplyReadiness()
    );
    readFileAccessPolicyMock.mockResolvedValue({
      deviceId: "dev_local_123",
      policy: {
        folders: ["/Users/felix/Code", "/Users/felix/Documents"],
        mode: "only_selected_folders",
        revision: 3,
        updatedAtMs: 1_777_777_777,
      },
    });
  });

  it("renames the current computer after syncing observed metadata", async () => {
    await runComputerRename({
      nameParts: ["Office", "MacBook"],
      view: "human",
    });

    expect(writeObservedMetadataMock).toHaveBeenCalledWith({
      deviceId: "dev_local_123",
      metadata: {
        deviceType: "laptop",
        observedAtMs: 1_777_777_777,
        observedDisplayName: "Felix's MacBook Pro",
        osVersion: "25.4.0",
        platformFamily: "macOS",
      },
    });
    expect(setDisplayNameMock).toHaveBeenCalledWith({
      deviceId: "dev_local_123",
      displayName: "Office MacBook",
    });
    expect(presenter.line).toHaveBeenCalledWith({
      code: "computer.rename.completed",
      text: "Computer renamed to Office MacBook.",
    });
  });

  it("clears the custom computer name with --clear", async () => {
    setDisplayNameMock.mockResolvedValueOnce({
      currentDeviceId: "dev_local_123",
      currentRuntimeLane: "dev-local",
      localRuntimes: [
        {
          deviceDisplayName: "Felix's MacBook Pro",
          deviceDisplayNameSource: "observed",
          deviceId: "dev_local_123",
          deviceType: "laptop",
          firstSeenAtMs: 1_700_000_000_000,
          isCurrent: true,
          lastObservedAtMs: 1_777_777_777,
          osVersion: "25.4.0",
          platformFamily: "macOS",
        },
      ],
    });

    await runComputerRename({
      clear: true,
      view: "human",
    });

    expect(setDisplayNameMock).toHaveBeenCalledWith({
      deviceId: "dev_local_123",
      displayName: null,
    });
    expect(presenter.line).toHaveBeenCalledWith({
      code: "computer.rename.completed",
      text: "OpenMeld will use this computer's system name again.",
    });
  });

  it("fails invalid arguments before sending requests", async () => {
    await expect(
      runComputerRename({
        view: "human",
      })
    ).rejects.toThrow(
      "Provide a computer name, or use `openmeld computer rename --clear`"
    );

    await expect(
      runComputerRename({
        clear: true,
        nameParts: ["Office", "MacBook"],
        view: "human",
      })
    ).rejects.toThrow("Use either a computer name or --clear, not both.");

    expect(writeObservedMetadataMock).not.toHaveBeenCalled();
    expect(setDisplayNameMock).not.toHaveBeenCalled();
  });

  it("emits a stable agent-view payload", async () => {
    const agentPresenter = {
      data: vi.fn(),
      event: vi.fn(),
      line: vi.fn(),
      view: "agent" as const,
    };
    createPresenterMock.mockReturnValueOnce(agentPresenter);
    resolveRuntimeContextMock.mockResolvedValueOnce({
      interactive: false,
      resolvedView: "agent",
      viewMode: "agent",
    });

    await runComputerRename({
      nameParts: ["Office", "MacBook"],
      view: "agent",
    });

    expect(agentPresenter.data).toHaveBeenCalledWith({
      code: "computer.rename.completed",
      payload: {
        deviceDisplayName: "Office MacBook",
        deviceDisplayNameSource: "user",
        deviceId: "dev_local_123",
      },
    });
    expect(agentPresenter.line).not.toHaveBeenCalled();
  });

  it("lists computers in human view without raw device ids", async () => {
    await runComputerList({ view: "human" });

    expect(writeObservedMetadataMock).toHaveBeenCalledWith({
      deviceId: "dev_local_123",
      metadata: {
        deviceType: "laptop",
        observedAtMs: 1_777_777_777,
        observedDisplayName: "Felix's MacBook Pro",
        osVersion: "25.4.0",
        platformFamily: "macOS",
      },
    });
    const output = presenter.line.mock.calls
      .map((call) => String(call[0].text))
      .join("\n");

    expect(output).toContain("Office MacBook");
    expect(output).toContain("This computer");
    expect(output).toContain("macOS 25.4.0");
    expect(output).toContain("Last seen");
    expect(output).not.toContain("dev_local_123");
  });

  it("lists computers in agent view with structured device ids", async () => {
    const agentPresenter = {
      data: vi.fn(),
      event: vi.fn(),
      line: vi.fn(),
      view: "agent" as const,
    };
    createPresenterMock.mockReturnValueOnce(agentPresenter);
    resolveRuntimeContextMock.mockResolvedValueOnce({
      interactive: false,
      resolvedView: "agent",
      viewMode: "agent",
    });

    await runComputerList({ view: "agent" });

    expect(listLocalRuntimesMock).toHaveBeenCalledWith({
      includeUsageLimits: "true",
    });
    expect(agentPresenter.data).toHaveBeenCalledWith({
      code: "computer.list.completed",
      payload: buildLocalRuntimesResponse(),
    });
  });

  it("lists account computers without local observation sync when this computer is not identified", async () => {
    readCurrentLocalDeviceIdMock.mockResolvedValueOnce(null);

    await runComputerList({ view: "human" });

    expect(writeObservedMetadataMock).not.toHaveBeenCalled();
    expect(presenter.line).toHaveBeenCalledWith({
      code: "computer.list.completed",
      text: "Computers on your account:",
    });
  });

  it("shows the current computer in human view", async () => {
    await runComputerCurrent({ view: "human" });

    const output = presenter.line.mock.calls
      .map((call) => String(call[0].text))
      .join("\n");

    expect(writeObservedMetadataMock).toHaveBeenCalled();
    expect(output).toContain("Office MacBook");
    expect(output).toContain("This computer");
    expect(output).not.toContain("dev_local_123");
  });

  it("returns owner diagnostics without local folder paths in Agent View", async () => {
    const agentPresenter = {
      data: vi.fn(),
      event: vi.fn(),
      line: vi.fn(),
      view: "agent" as const,
    };
    createPresenterMock.mockReturnValueOnce(agentPresenter);
    resolveRuntimeContextMock.mockResolvedValueOnce({
      interactive: false,
      resolvedView: "agent",
      viewMode: "agent",
    });

    await runComputerCurrent({ view: "agent" });

    expect(readFileAccessPolicyMock).toHaveBeenCalledWith({
      expectedDeviceId: "dev_local_123",
    });
    const output = agentPresenter.data.mock.calls[0]?.[0];
    expect(output).toMatchObject({
      code: "computer.current.completed",
      payload: {
        currentDeviceId: "dev_local_123",
        diagnostics: {
          currentComputerFileAccess: {
            deviceId: "dev_local_123",
            folderCount: 2,
            mode: "only_selected_folders",
            revision: 3,
            status: "available",
          },
          currentLocalRuntimeReplyReadiness: {
            canReplyFromThisComputer: true,
          },
        },
      },
    });
    expect(JSON.stringify(output)).not.toContain("/Users/felix");
  });

  it("fails current when the CLI cannot identify this computer", async () => {
    readCurrentLocalDeviceIdMock.mockResolvedValueOnce(null);

    await expect(runComputerCurrent({ view: "human" })).rejects.toThrow(
      "OpenMeld could not identify this computer"
    );
  });
});

function buildLocalRuntimesResponse(): LocalRuntimesResponseFixture {
  return {
    currentDeviceId: "dev_local_123",
    currentRuntimeLane: "dev-local",
    localRuntimes: [
      {
        computerFileAccess: { readPolicy: true, updatePolicy: true },
        deviceDisplayName: "Office MacBook",
        deviceDisplayNameSource: "user",
        deviceId: "dev_local_123",
        deviceType: "laptop",
        firstSeenAtMs: 1_700_000_000_000,
        isCurrent: true,
        executionTargets: [],
        lastObservedAtMs: 1_777_777_777,
        osVersion: "25.4.0",
        platformFamily: "macOS",
      },
      {
        computerFileAccess: { readPolicy: false, updatePolicy: false },
        deviceDisplayName: "Home PC",
        deviceDisplayNameSource: "observed",
        deviceId: "dev_home_456",
        deviceType: "desktop",
        firstSeenAtMs: 1_700_000_000_100,
        isCurrent: false,
        executionTargets: [],
        lastObservedAtMs: 1_777_777_000,
        osVersion: "11",
        platformFamily: "Windows",
      },
    ],
  };
}

type LocalRuntimesResponseFixture = {
  currentDeviceId: string;
  currentRuntimeLane: "dev-local";
  localRuntimes: Array<{
    computerFileAccess: { readPolicy: boolean; updatePolicy: boolean };
    deviceDisplayName: string;
    deviceDisplayNameSource: "observed" | "placeholder" | "user";
    deviceId: string;
    deviceType: "desktop" | "laptop" | "server" | "unknown";
    firstSeenAtMs: number;
    isCurrent: boolean;
    executionTargets: [];
    lastObservedAtMs: number;
    osVersion: string | null;
    platformFamily: "Linux" | "macOS" | "Unknown" | "Windows";
  }>;
};

function buildCurrentReplyReadiness() {
  return {
    canReplyFromThisComputer: true,
    currentTarget: {
      availability: "resolved" as const,
      deviceId: "dev_local_123",
      runtimeLane: "dev-local" as const,
    },
    generatedAt: "2026-08-19T00:00:00.000Z",
    localComponents: {
      agentSetupCommand: "openmeld setup --view agent",
      cli: {
        commandContractVersion: "contract-v1",
        installedPackageVersion: "1.0.0",
        latestPackageVersion: "1.0.0",
        reasonCodes: [],
        requiredCommandContractVersion: null,
        status: "current" as const,
        updatePolicy: "ok" as const,
        wakeBlocked: false,
      },
      generatedAt: "2026-08-19T00:00:00.000Z",
      humanSetupCommand: "openmeld setup",
      schemaVersion: 1 as const,
      service: {
        installedVersion: "1.0.0",
        latestVersion: "1.0.0",
        reasonCodes: [],
        requiredVersion: null,
        status: "current" as const,
        updatePolicy: "ok" as const,
        wakeBlocked: false,
      },
      setupAction: "none" as const,
      setupActionDescription: "OpenMeld local components are aligned.",
      setupActionLabel: "Everything is up to date",
      skills: {
        expectedBundleHash: null,
        expectedTargetCount: 1,
        installedBundleHash: null,
        reasonCodes: [],
        skillContractVersion: "skills-v1",
        status: "current" as const,
        targetCount: 1,
        updatePolicy: "ok" as const,
        wakeBlocked: false,
      },
    },
    message: "This computer can reply in Spaces.",
    nextAction: "none" as const,
    primaryBlocker: "none" as const,
    runtime: {
      deviceDisplayName: "Office MacBook",
      deviceId: "dev_local_123",
      executionTargetStatus: "ready" as const,
      lastObservedAtMs: 1_777_777_777,
      openMeldServiceRuntimeId: {
        source: "runtime_registry_authority" as const,
        value: "runtime_123",
      },
      reasonCodes: [],
      runtimeLane: "dev-local" as const,
    },
    service: {
      connected: true,
      executionCompatibility: null,
      matchingCurrentRuntime: true,
      reasonCodes: [],
      sessionDeviceId: "dev_local_123",
      sessionLane: "dev-local" as const,
    },
    status: "ready" as const,
  };
}
