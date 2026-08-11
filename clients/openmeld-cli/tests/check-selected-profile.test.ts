import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  cancelMock,
  clearSelectedOpenMeldProfileIdMock,
  createProfileByKindMock,
  isCancelMock,
  listOpenMeldProfilesMock,
  promptSearchSelectMock,
  resolveOpenMeldProfileMock,
  resolveOpenMeldProfileOrNullMock,
  resolveCreateProfileKindMock,
  resolveCreateProfileNameMock,
  selectMock,
  setSelectedOpenMeldProfileIdMock,
  showHumanCheckCardMock,
} = vi.hoisted(() => ({
  cancelMock: vi.fn(),
  clearSelectedOpenMeldProfileIdMock: vi.fn(),
  createProfileByKindMock: vi.fn(),
  isCancelMock: vi.fn(),
  listOpenMeldProfilesMock: vi.fn(),
  promptSearchSelectMock: vi.fn(),
  resolveOpenMeldProfileMock: vi.fn(),
  resolveOpenMeldProfileOrNullMock: vi.fn(),
  resolveCreateProfileKindMock: vi.fn(),
  resolveCreateProfileNameMock: vi.fn(),
  selectMock: vi.fn(),
  setSelectedOpenMeldProfileIdMock: vi.fn(),
  showHumanCheckCardMock: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
  cancel: (...args: Parameters<typeof cancelMock>) => cancelMock(...args),
  isCancel: (...args: Parameters<typeof isCancelMock>) => isCancelMock(...args),
  select: (...args: Parameters<typeof selectMock>) => selectMock(...args),
}));

vi.mock("../src/config/openmeld-profile-selection", () => ({
  clearSelectedOpenMeldProfileId: (
    ...args: Parameters<typeof clearSelectedOpenMeldProfileIdMock>
  ) => clearSelectedOpenMeldProfileIdMock(...args),
  setSelectedOpenMeldProfileId: (
    ...args: Parameters<typeof setSelectedOpenMeldProfileIdMock>
  ) => setSelectedOpenMeldProfileIdMock(...args),
}));

vi.mock("../src/config/openmeld-profiles-api", () => ({
  listOpenMeldProfiles: (
    ...args: Parameters<typeof listOpenMeldProfilesMock>
  ) => listOpenMeldProfilesMock(...args),
  resolveOpenMeldProfile: (
    ...args: Parameters<typeof resolveOpenMeldProfileMock>
  ) => resolveOpenMeldProfileMock(...args),
}));

vi.mock("../src/config/resolve-openmeld-profile", () => ({
  resolveOpenMeldProfileOrNull: (
    ...args: Parameters<typeof resolveOpenMeldProfileOrNullMock>
  ) => resolveOpenMeldProfileOrNullMock(...args),
}));

vi.mock("../src/profile/create-flow", () => ({
  createProfileByKind: (...args: Parameters<typeof createProfileByKindMock>) =>
    createProfileByKindMock(...args),
  resolveCreateProfileKind: (
    ...args: Parameters<typeof resolveCreateProfileKindMock>
  ) => resolveCreateProfileKindMock(...args),
  resolveCreateProfileName: (
    ...args: Parameters<typeof resolveCreateProfileNameMock>
  ) => resolveCreateProfileNameMock(...args),
}));

vi.mock("../src/ui/search-select", () => ({
  promptSearchMultiselectWorkbench: vi.fn(),
  promptSearchSelect: (...args: Parameters<typeof promptSearchSelectMock>) =>
    promptSearchSelectMock(...args),
}));

vi.mock("../src/command-entry-checks/show-human-check-card", () => ({
  showHumanCheckCard: (...args: Parameters<typeof showHumanCheckCardMock>) =>
    showHumanCheckCardMock(...args),
}));

import { runSelectedProfileCheck } from "../src/command-entry-checks/check-selected-profile";
import { resetCurrentCommandCheckState } from "../src/command-entry-checks/current-command-check-state";
import { applyEntryCheckResult } from "../src/command-entry-checks/entry-check-blocked-json";
import type {
  CommandCheckRequirement,
  CommandEntryContext,
} from "../src/command-entry-checks/types";
import type { OpenMeldProfile } from "../src/config/openmeld-profiles-api";
import { withCapturedStdio } from "./helpers/fs";
import { createTestOpenMeldProfile } from "./helpers/openmeld-profile-fixture";

describe("selected profile entry check", () => {
  beforeEach(() => {
    resetCurrentCommandCheckState();
    cancelMock.mockReset();
    clearSelectedOpenMeldProfileIdMock.mockReset().mockResolvedValue(undefined);
    createProfileByKindMock.mockReset();
    isCancelMock.mockReset().mockReturnValue(false);
    listOpenMeldProfilesMock.mockReset();
    promptSearchSelectMock.mockReset();
    resolveOpenMeldProfileMock.mockReset();
    resolveOpenMeldProfileOrNullMock.mockReset();
    resolveCreateProfileKindMock.mockReset();
    resolveCreateProfileNameMock.mockReset();
    selectMock.mockReset();
    setSelectedOpenMeldProfileIdMock.mockReset().mockResolvedValue(undefined);
    showHumanCheckCardMock.mockReset();
  });

  it("re-prompts join/watch in human interactive mode and moves the current profile to the top", async () => {
    const currentProfile = createProfile({
      openMeldProfileId: "human-current",
      profileName: "Felix",
    });
    const otherProfile = createProfile({
      openMeldProfileId: "agent-helper",
      profileName: "Helper",
      profileKind: "agent",
    });

    resolveOpenMeldProfileOrNullMock.mockResolvedValue(currentProfile);
    listOpenMeldProfilesMock.mockResolvedValue([otherProfile, currentProfile]);
    promptSearchSelectMock.mockResolvedValue({
      status: "submitted",
      value: currentProfile.openMeldProfileId,
    });
    resolveOpenMeldProfileMock.mockResolvedValue(currentProfile);

    const result = await runSelectedProfileCheck({
      context: createContext("space.join"),
      requirement: createRequirement("confirm"),
    });

    expect(result).toEqual({ status: "continue" });
    expect(promptSearchSelectMock).toHaveBeenCalledTimes(1);
    const promptInput = promptSearchSelectMock.mock.calls[0]?.[0] as {
      items: Array<{ value: string; label: string; detail: string }>;
      message: string;
    };
    expect(promptInput.message).toBe("Which profile should this join use?");
    expect(promptInput.items.map((item) => item.value)).toEqual([
      currentProfile.openMeldProfileId,
      otherProfile.openMeldProfileId,
    ]);
    expect(promptInput.items[0]?.label).toBe("Felix (current)");
    expect(promptInput.items[0]?.detail).toBe("human-current · human");
    expect(setSelectedOpenMeldProfileIdMock).toHaveBeenCalledWith(
      "human-current"
    );
  });

  it("keeps the current profile without prompting when confirmation cannot be shown", async () => {
    const currentProfile = createProfile({
      openMeldProfileId: "human-current",
      profileName: "Felix",
    });
    resolveOpenMeldProfileOrNullMock.mockResolvedValue(currentProfile);

    const result = await runSelectedProfileCheck({
      context: {
        ...createContext("space.watch"),
        allowPrompt: false,
      },
      requirement: createRequirement("confirm"),
    });

    expect(result).toEqual({ status: "continue" });
    expect(promptSearchSelectMock).not.toHaveBeenCalled();
    expect(setSelectedOpenMeldProfileIdMock).not.toHaveBeenCalled();
  });

  it("re-prompts join/watch when only the fallback current profile is available", async () => {
    const currentProfile = createProfile({
      openMeldProfileId: "human-current",
      profileName: "Felix",
    });
    const otherProfile = createProfile({
      openMeldProfileId: "human-other",
      profileName: "Nova",
    });

    resolveOpenMeldProfileOrNullMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(currentProfile);
    listOpenMeldProfilesMock.mockResolvedValue([otherProfile, currentProfile]);
    promptSearchSelectMock.mockResolvedValue({
      status: "submitted",
      value: otherProfile.openMeldProfileId,
    });
    resolveOpenMeldProfileMock.mockResolvedValue(otherProfile);

    const result = await runSelectedProfileCheck({
      context: createContext("space.watch"),
      requirement: createRequirement("confirm"),
    });

    expect(result).toEqual({ status: "continue" });
    expect(promptSearchSelectMock).toHaveBeenCalledTimes(1);
    const promptInput = promptSearchSelectMock.mock.calls[0]?.[0] as {
      items: Array<{ value: string; label: string }>;
    };
    expect(promptInput.items.map((item) => item.value)).toEqual([
      currentProfile.openMeldProfileId,
      otherProfile.openMeldProfileId,
    ]);
    expect(promptInput.items[0]?.label).toBe("Felix (current)");
    expect(setSelectedOpenMeldProfileIdMock).toHaveBeenCalledWith(
      otherProfile.openMeldProfileId
    );
  });

  it("treats an explicit --profile as already confirmed", async () => {
    const explicitProfile = createProfile({
      openMeldProfileId: "agent-explicit",
      profileName: "Explicit Agent",
      profileKind: "agent",
    });
    resolveOpenMeldProfileOrNullMock.mockResolvedValue(explicitProfile);

    const result = await runSelectedProfileCheck({
      context: {
        ...createContext("space.join"),
        profileArg: explicitProfile.openMeldProfileId,
      },
      requirement: createRequirement("confirm"),
    });

    expect(result).toEqual({ status: "continue" });
    expect(promptSearchSelectMock).not.toHaveBeenCalled();
    expect(resolveOpenMeldProfileOrNullMock).toHaveBeenCalledWith({
      openMeldProfileId: explicitProfile.openMeldProfileId,
      allowDefaultFallback: false,
      persistSelection: false,
      allowUnauthenticated: false,
    });
    expect(resolveOpenMeldProfileMock).not.toHaveBeenCalled();
    expect(setSelectedOpenMeldProfileIdMock).not.toHaveBeenCalled();
  });

  it("blocks with a json error result under --json without presenter output", async () => {
    resolveOpenMeldProfileOrNullMock.mockResolvedValue(null);
    const context: CommandEntryContext = {
      ...createContext("space.join"),
      runtime: {
        viewMode: "agent",
        resolvedView: "agent",
        interactive: false,
      },
      allowPrompt: false,
      jsonOutput: true,
    };

    const result = await runSelectedProfileCheck({
      context,
      requirement: createRequirement("required"),
    });

    expect(result).toEqual({
      status: "blocked",
      exitCode: 1,
      jsonError: {
        code: "profile.required",
        message: "an OpenMeld profile is required for this command",
      },
    });
    expect(context.presenter.data).not.toHaveBeenCalled();
    expect(selectMock).not.toHaveBeenCalled();
    expect(promptSearchSelectMock).not.toHaveBeenCalled();
  });

  it("routes its empty-account creation prompt through the shared kind capability guard", async () => {
    const createdAgent = createProfile({
      openMeldProfileId: "agent-created",
      profileName: "Created Agent",
      profileKind: "agent",
    });
    resolveOpenMeldProfileOrNullMock.mockResolvedValue(null);
    listOpenMeldProfilesMock.mockResolvedValue([]);
    selectMock.mockResolvedValue("__command_entry_create_profile__");
    resolveCreateProfileKindMock.mockResolvedValue({
      status: "submitted",
      value: "agent",
    });
    resolveCreateProfileNameMock.mockResolvedValue({
      status: "submitted",
      value: "Created Agent",
    });
    createProfileByKindMock.mockResolvedValue(createdAgent);

    await expect(
      runSelectedProfileCheck({
        context: createContext("space.join"),
        requirement: createRequirement("required"),
      })
    ).resolves.toEqual({ status: "continue" });

    expect(resolveCreateProfileKindMock).toHaveBeenCalledWith({
      explicitKind: undefined,
      allowPrompt: true,
      resolvedView: "human",
      promptMessage: "Profile type",
      exitLabel: "Cancel",
    });
    expect(createProfileByKindMock).toHaveBeenCalledWith({
      profileKind: "agent",
      profileName: "Created Agent",
    });
  });

  it("emits exactly one canonical error envelope and exit code 1 when applied under --json", async () => {
    resolveOpenMeldProfileOrNullMock.mockResolvedValue(null);
    const context: CommandEntryContext = {
      ...createContext("space.join"),
      runtime: {
        viewMode: "agent",
        resolvedView: "agent",
        interactive: false,
      },
      allowPrompt: false,
      jsonOutput: true,
    };
    const previousExitCode = process.exitCode;

    try {
      const { stdout, result: shouldRun } = await withCapturedStdio(
        async () => {
          const result = await runSelectedProfileCheck({
            context,
            requirement: createRequirement("required"),
          });
          return applyEntryCheckResult({ result, jsonOutput: true });
        }
      );

      expect(shouldRun).toBe(false);
      expect(process.exitCode).toBe(1);
      const lines = stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0] ?? "")).toEqual({
        schemaVersion: 1,
        type: "error",
        error: {
          code: "profile.required",
          message: "an OpenMeld profile is required for this command",
        },
      });
    } finally {
      process.exitCode = previousExitCode;
    }
  });
});

function createContext(
  entryName: CommandEntryContext["entryName"]
): CommandEntryContext {
  return {
    entryName,
    argv: ["node", "openmeld"],
    runtime: {
      viewMode: "human",
      resolvedView: "human",
      interactive: true,
    },
    presenter: {
      view: "human",
      event: vi.fn(),
      line: vi.fn(),
      data: vi.fn(),
    },
    allowPrompt: true,
    environmentTarget: {
      authBaseUrl: "https://auth.openmeld.invalid",
      gatewayUrl: "https://gateway.openmeld.invalid",
      preset: "prod",
      userFacingCommand: "openmeld",
    },
    gatewayUrl: null,
    profileArg: null,
    jsonOutput: false,
  };
}

function createRequirement(
  mode: CommandCheckRequirement["mode"]
): CommandCheckRequirement {
  return {
    mode,
    stage: "after-sign-in",
  };
}

function createProfile(
  overrides: Partial<OpenMeldProfile> &
    Pick<OpenMeldProfile, "openMeldProfileId" | "profileName">
): OpenMeldProfile {
  return createTestOpenMeldProfile({
    openMeldProfileId: overrides.openMeldProfileId,
    profileName: overrides.profileName,
    profileKind: overrides.profileKind ?? "human",
    status: overrides.status ?? "active",
    ownerUserId: overrides.ownerUserId ?? "usr_1",
    ownerName: overrides.ownerName ?? "Felix",
    source: overrides.source ?? "cloud",
    createdByUserId: overrides.createdByUserId ?? "usr_1",
    lastUsedAt: overrides.lastUsedAt ?? null,
    createdAt: overrides.createdAt ?? "2026-03-11T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-03-11T00:00:00.000Z",
    ...(overrides.isDefault === undefined
      ? {}
      : { isDefault: overrides.isDefault }),
    ...(overrides.profileHandle
      ? { profileHandle: overrides.profileHandle }
      : {}),
  });
}
