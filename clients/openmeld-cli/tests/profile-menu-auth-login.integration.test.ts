import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const COMMAND_AUTH_LOGIN = "__command_auth_login__";
const COMMAND_AUTH_CANCEL = "__command_auth_cancel__";

const {
  cancelMock,
  confirmMock,
  createOpenMeldAgentProfileMock,
  createOpenMeldHumanProfileMock,
  deleteOpenMeldProfileMock,
  getOpenMeldProfileCapabilitiesMock,
  getAuthSessionStateMock,
  listAgentTargetStatesMock,
  listOpenMeldProfilesMock,
  multiselectMock,
  promptSearchMultiselectMock,
  promptSearchSelectMock,
  promptTextEntryMock,
  resolveOpenMeldProfileMock,
  runAuthLoginMock,
  selectMock,
  textMock,
  updateOpenMeldProfileMock,
} = vi.hoisted(() => ({
  cancelMock: vi.fn(),
  confirmMock: vi.fn(),
  createOpenMeldAgentProfileMock: vi.fn(),
  createOpenMeldHumanProfileMock: vi.fn(),
  deleteOpenMeldProfileMock: vi.fn(),
  getOpenMeldProfileCapabilitiesMock: vi.fn(),
  getAuthSessionStateMock: vi.fn(),
  listAgentTargetStatesMock: vi.fn(),
  listOpenMeldProfilesMock: vi.fn(),
  multiselectMock: vi.fn(),
  promptSearchMultiselectMock: vi.fn(),
  promptSearchSelectMock: vi.fn(),
  promptTextEntryMock: vi.fn(),
  resolveOpenMeldProfileMock: vi.fn(),
  runAuthLoginMock: vi.fn(),
  selectMock: vi.fn(),
  textMock: vi.fn(),
  updateOpenMeldProfileMock: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
  cancel: cancelMock,
  confirm: confirmMock,
  isCancel: vi.fn((value: unknown) => value === "__cancel__"),
  multiselect: multiselectMock,
  select: selectMock,
  text: textMock,
}));

vi.mock("../src/runtime/interaction", () => ({
  canUseInteractivePrompts: vi.fn(() => true),
}));

vi.mock("../src/config/auth-session", async () => {
  const actual = await vi.importActual<
    typeof import("../src/config/auth-session")
  >("../src/config/auth-session");
  return {
    ...actual,
    getAuthSessionState: getAuthSessionStateMock,
  };
});

vi.mock("../src/commands/auth", () => ({
  runAuthLogin: runAuthLoginMock,
}));

vi.mock("../src/ui/search-select", () => ({
  promptSearchMultiselect: (
    ...args: Parameters<typeof promptSearchMultiselectMock>
  ) => promptSearchMultiselectMock(...args),
  promptSearchMultiselectWorkbench: vi.fn(),
  promptSearchSelect: (...args: Parameters<typeof promptSearchSelectMock>) =>
    promptSearchSelectMock(...args),
}));

vi.mock("../src/ui/text-entry", () => ({
  promptTextEntry: (...args: Parameters<typeof promptTextEntryMock>) =>
    promptTextEntryMock(...args),
}));

vi.mock("../src/agents/registry", async () => {
  const actual = await vi.importActual<typeof import("../src/agents/registry")>(
    "../src/agents/registry"
  );
  return {
    ...actual,
    listAgentTargetStates: listAgentTargetStatesMock,
  };
});

vi.mock("../src/config/openmeld-profiles-api", async () => {
  const actual = await vi.importActual<
    typeof import("../src/config/openmeld-profiles-api")
  >("../src/config/openmeld-profiles-api");
  return {
    ...actual,
    createOpenMeldAgentProfile: createOpenMeldAgentProfileMock,
    createOpenMeldHumanProfile: createOpenMeldHumanProfileMock,
    deleteOpenMeldProfile: deleteOpenMeldProfileMock,
    getOpenMeldProfileCapabilities: getOpenMeldProfileCapabilitiesMock,
    listOpenMeldProfiles: listOpenMeldProfilesMock,
    resolveOpenMeldProfile: resolveOpenMeldProfileMock,
    updateOpenMeldProfile: updateOpenMeldProfileMock,
  };
});

import {
  runProfileList,
  runProfileMenu,
  runProfileUpdate,
} from "../src/commands/profile";
import { readProfileWorkspaceConfig } from "../src/profile-workspace/service";
import { withTempHome } from "./helpers/fs";

describe("profile menu auth login UX", () => {
  beforeEach(() => {
    selectMock.mockReset();
    textMock.mockReset();
    cancelMock.mockReset();
    confirmMock.mockReset();
    multiselectMock.mockReset();
    promptSearchMultiselectMock.mockReset();
    promptSearchSelectMock.mockReset();
    promptTextEntryMock.mockReset();
    runAuthLoginMock.mockReset();
    getAuthSessionStateMock.mockReset();
    createOpenMeldAgentProfileMock.mockReset();
    createOpenMeldHumanProfileMock.mockReset();
    deleteOpenMeldProfileMock.mockReset();
    getOpenMeldProfileCapabilitiesMock.mockReset().mockResolvedValue({
      ok: true,
      additionalHumanProfileCreationEnabled: true,
    });
    listAgentTargetStatesMock.mockReset();
    listAgentTargetStatesMock.mockResolvedValue([]);
    listOpenMeldProfilesMock.mockReset();
    resolveOpenMeldProfileMock.mockReset();
    updateOpenMeldProfileMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("prompts sign-in and continues profile create after login", async () => {
    await withTempHome(async () => {
      const selectResponses = new Map<string, unknown>([
        ["What do you want to do?", COMMAND_AUTH_LOGIN],
        ["Profile action", "create"],
        ["Profile kind", "agent"],
      ]);
      selectMock.mockImplementation((input: { message?: string }) => {
        const message = String(input.message ?? "");
        if (!selectResponses.has(message)) {
          throw new Error(`unexpected select prompt: ${message}`);
        }
        const response = selectResponses.get(message);
        selectResponses.delete(message);
        return Promise.resolve(response);
      });
      promptTextEntryMock.mockResolvedValueOnce({
        status: "submitted",
        value: "researcher",
      });
      getAuthSessionStateMock.mockResolvedValue({
        state: "valid",
        session: {
          v: 1,
          accessToken: "token",
          tokenType: "Bearer",
          authBaseUrl: "http://localhost:8788",
          clientId: "openmeld-cli-dev",
          createdAt: "2026-02-20T00:00:00.000Z",
        },
      });
      getAuthSessionStateMock.mockResolvedValueOnce({
        state: "missing",
        session: null,
      });
      runAuthLoginMock.mockResolvedValue(undefined);
      createOpenMeldAgentProfileMock.mockResolvedValue({
        openMeldProfileId: "agt_researcher",
        profileName: "researcher",
        profileKind: "agent",
        isDefault: false,
        status: "active",
        ownerUserId: "user-1",
        source: "cli_create",
        createdByUserId: "user-1",
        lastUsedAt: null,
        createdAt: "2026-02-20T00:00:00.000Z",
        updatedAt: "2026-02-20T00:00:00.000Z",
      });

      await runProfileMenu({
        view: "human",
      });

      expect(runAuthLoginMock).toHaveBeenCalledTimes(1);
      expect(runAuthLoginMock).toHaveBeenCalledWith({
        view: "human",
      });
      expect(createOpenMeldAgentProfileMock).toHaveBeenCalledTimes(1);
      expect(createOpenMeldAgentProfileMock).toHaveBeenCalledWith({
        profileName: "researcher",
      });
      expect(createOpenMeldHumanProfileMock).not.toHaveBeenCalled();
    });
  });

  it("supports creating human profile from human view menu", async () => {
    await withTempHome(async () => {
      const selectResponses = new Map<string, unknown>([
        ["Profile action", "create"],
        ["Profile kind", "human"],
      ]);
      selectMock.mockImplementation((input: { message?: string }) => {
        const message = String(input.message ?? "");
        if (!selectResponses.has(message)) {
          throw new Error(`unexpected select prompt: ${message}`);
        }
        const response = selectResponses.get(message);
        selectResponses.delete(message);
        return Promise.resolve(response);
      });
      promptTextEntryMock.mockResolvedValueOnce({
        status: "submitted",
        value: "Felix Secondary",
      });
      getAuthSessionStateMock.mockResolvedValue({
        state: "valid",
        session: {
          v: 1,
          accessToken: "token",
          tokenType: "Bearer",
          authBaseUrl: "http://localhost:8788",
          clientId: "openmeld-cli-dev",
          createdAt: "2026-02-20T00:00:00.000Z",
        },
      });
      createOpenMeldHumanProfileMock.mockResolvedValue({
        openMeldProfileId: "hum_felix_2",
        profileName: "Felix Secondary",
        profileKind: "human",
        isDefault: false,
        status: "active",
        ownerUserId: "user-1",
        source: "cli_create",
        createdByUserId: "user-1",
        lastUsedAt: null,
        createdAt: "2026-02-20T00:00:00.000Z",
        updatedAt: "2026-02-20T00:00:00.000Z",
      });

      await runProfileMenu({
        view: "human",
      });

      expect(createOpenMeldHumanProfileMock).toHaveBeenCalledTimes(1);
      expect(promptTextEntryMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Profile name",
          placeholder: "openmeld-ceo",
        })
      );
      expect(createOpenMeldHumanProfileMock).toHaveBeenCalledWith({
        profileName: "Felix Secondary",
      });
      expect(createOpenMeldAgentProfileMock).not.toHaveBeenCalled();
    });
  });

  it("allows cancelling sign-in prompt without throwing", async () => {
    await withTempHome(async () => {
      selectMock.mockResolvedValueOnce(COMMAND_AUTH_CANCEL);
      getAuthSessionStateMock.mockResolvedValueOnce({
        state: "missing",
        session: null,
      });

      await runProfileMenu({
        view: "human",
      });

      expect(runAuthLoginMock).not.toHaveBeenCalled();
      expect(createOpenMeldAgentProfileMock).not.toHaveBeenCalled();
      expect(textMock).not.toHaveBeenCalled();
      expect(cancelMock).toHaveBeenCalledWith("Cancelled.");
    });
  });

  it("applies the same sign-in gate to direct profile list", async () => {
    await withTempHome(async () => {
      selectMock.mockResolvedValueOnce(COMMAND_AUTH_LOGIN);
      getAuthSessionStateMock.mockResolvedValue({
        state: "valid",
        session: {
          v: 1,
          accessToken: "token",
          tokenType: "Bearer",
          authBaseUrl: "http://localhost:8788",
          clientId: "openmeld-cli-dev",
          createdAt: "2026-02-20T00:00:00.000Z",
        },
      });
      getAuthSessionStateMock.mockResolvedValueOnce({
        state: "missing",
        session: null,
      });
      runAuthLoginMock.mockResolvedValue(undefined);
      listOpenMeldProfilesMock.mockResolvedValue([
        {
          openMeldProfileId: "agt_research",
          profileName: "Research Bot",
          profileKind: "agent",
          isDefault: false,
          status: "active",
          ownerUserId: "user-1",
          source: "cli_create",
          createdByUserId: "user-1",
          lastUsedAt: null,
          createdAt: "2026-02-20T00:00:00.000Z",
          updatedAt: "2026-02-20T00:00:00.000Z",
        },
      ]);

      await runProfileList({
        view: "human",
      });

      expect(runAuthLoginMock).toHaveBeenCalledWith({
        view: "human",
      });
      expect(listOpenMeldProfilesMock).toHaveBeenCalledTimes(1);
    });
  });

  it("applies the same sign-in gate to set action", async () => {
    await withTempHome(async () => {
      selectMock.mockResolvedValueOnce(COMMAND_AUTH_CANCEL);
      getAuthSessionStateMock.mockResolvedValueOnce({
        state: "missing",
        session: null,
      });

      await runProfileMenu({
        view: "human",
      });

      expect(runAuthLoginMock).not.toHaveBeenCalled();
      expect(resolveOpenMeldProfileMock).not.toHaveBeenCalled();
      expect(cancelMock).toHaveBeenCalledWith("Cancelled.");
    });
  });

  it("uses searchable profile selection when setting from menu", async () => {
    await withTempHome(async () => {
      selectMock.mockResolvedValueOnce("set");
      promptSearchSelectMock.mockResolvedValueOnce({
        status: "submitted",
        value: "agt_research",
      });
      getAuthSessionStateMock.mockResolvedValue({
        state: "valid",
        session: {
          v: 1,
          accessToken: "token",
          tokenType: "Bearer",
          authBaseUrl: "http://localhost:8788",
          clientId: "openmeld-cli-dev",
          createdAt: "2026-02-20T00:00:00.000Z",
        },
      });
      listOpenMeldProfilesMock.mockResolvedValue([
        {
          openMeldProfileId: "user_felix",
          profileName: "felix",
          profileKind: "human",
          isDefault: true,
          status: "active",
          ownerUserId: "user-1",
          source: "cli_create",
          createdByUserId: "user-1",
          lastUsedAt: null,
          createdAt: "2026-02-20T00:00:00.000Z",
          updatedAt: "2026-02-20T00:00:00.000Z",
        },
        {
          openMeldProfileId: "agt_research",
          profileName: "Research Bot",
          profileKind: "agent",
          isDefault: false,
          status: "active",
          ownerUserId: "user-1",
          source: "cli_create",
          createdByUserId: "user-1",
          lastUsedAt: null,
          createdAt: "2026-02-20T00:00:00.000Z",
          updatedAt: "2026-02-20T00:00:00.000Z",
        },
      ]);
      resolveOpenMeldProfileMock.mockResolvedValue({
        openMeldProfileId: "agt_research",
        profileName: "Research Bot",
        profileKind: "agent",
        isDefault: false,
        status: "active",
        ownerUserId: "user-1",
        source: "cli_create",
        createdByUserId: "user-1",
        lastUsedAt: null,
        createdAt: "2026-02-20T00:00:00.000Z",
        updatedAt: "2026-02-20T00:00:00.000Z",
      });

      await runProfileMenu({
        view: "human",
      });

      expect(promptSearchSelectMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Choose a profile to set",
          maxVisible: 8,
          allowBack: true,
          backLabel: "Exit",
        })
      );
      const prompt = promptSearchSelectMock.mock.calls[0]?.[0] as {
        items: Array<{ value: string; label: string; detail: string }>;
      };
      expect(prompt.items[0]).toEqual(
        expect.objectContaining({
          value: "user_felix",
          label: "felix (selected)",
          detail: "human · user_felix",
        })
      );
      expect(prompt.items[1]).toEqual(
        expect.objectContaining({
          value: "agt_research",
          label: "Research Bot",
          detail: "agent · agt_research",
        })
      );
      expect(resolveOpenMeldProfileMock).toHaveBeenCalledWith({
        openMeldProfileId: "agt_research",
      });
    });
  });

  it("uses searchable multi-select when deleting from menu", async () => {
    await withTempHome(async () => {
      selectMock.mockResolvedValueOnce("delete");
      promptSearchMultiselectMock.mockResolvedValueOnce({
        status: "submitted",
        value: ["agt_delete_me"],
      });
      confirmMock.mockResolvedValueOnce(true);
      getAuthSessionStateMock.mockResolvedValue({
        state: "valid",
        session: {
          v: 1,
          accessToken: "token",
          tokenType: "Bearer",
          authBaseUrl: "http://localhost:8788",
          clientId: "openmeld-cli-dev",
          createdAt: "2026-02-20T00:00:00.000Z",
        },
      });
      listOpenMeldProfilesMock.mockResolvedValue([
        {
          openMeldProfileId: "user_felix",
          profileName: "felix",
          profileKind: "human",
          isDefault: true,
          status: "active",
          ownerUserId: "user-1",
          source: "cli_create",
          createdByUserId: "user-1",
          lastUsedAt: null,
          createdAt: "2026-02-20T00:00:00.000Z",
          updatedAt: "2026-02-20T00:00:00.000Z",
        },
        {
          openMeldProfileId: "agt_delete_me",
          profileName: "Delete Me",
          profileKind: "agent",
          isDefault: false,
          status: "active",
          ownerUserId: "user-1",
          source: "cli_create",
          createdByUserId: "user-1",
          lastUsedAt: null,
          createdAt: "2026-02-20T00:00:00.000Z",
          updatedAt: "2026-02-20T00:00:00.000Z",
        },
      ]);
      resolveOpenMeldProfileMock.mockResolvedValue({
        openMeldProfileId: "agt_delete_me",
        profileName: "Delete Me",
        profileKind: "agent",
        isDefault: false,
        status: "active",
        ownerUserId: "user-1",
        source: "cli_create",
        createdByUserId: "user-1",
        lastUsedAt: null,
        createdAt: "2026-02-20T00:00:00.000Z",
        updatedAt: "2026-02-20T00:00:00.000Z",
      });
      deleteOpenMeldProfileMock.mockResolvedValue(undefined);

      await runProfileMenu({
        view: "human",
      });

      expect(promptSearchMultiselectMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Choose profile(s) to delete",
          required: true,
          maxVisible: 8,
          allowBack: true,
          backLabel: "Exit",
        })
      );
      const prompt = promptSearchMultiselectMock.mock.calls[0]?.[0] as {
        items: Array<{ value: string; label: string; detail: string }>;
      };
      expect(prompt.items).toHaveLength(1);
      expect(prompt.items[0]).toEqual(
        expect.objectContaining({
          value: "agt_delete_me",
          label: "Delete Me",
          detail: "agent · agt_delete_me",
        })
      );
      expect(deleteOpenMeldProfileMock).toHaveBeenCalledWith({
        openMeldProfileId: "agt_delete_me",
      });
    });
  });

  it("applies the same sign-in gate to update action", async () => {
    await withTempHome(async () => {
      selectMock.mockResolvedValueOnce(COMMAND_AUTH_CANCEL);
      getAuthSessionStateMock.mockResolvedValue({
        state: "missing",
        session: null,
      });

      await runProfileMenu({
        view: "human",
      });

      expect(runAuthLoginMock).not.toHaveBeenCalled();
      expect(updateOpenMeldProfileMock).not.toHaveBeenCalled();
      expect(cancelMock).toHaveBeenCalledWith("Cancelled.");
    });
  });

  it("continues set action after successful sign-in", async () => {
    await withTempHome(async () => {
      selectMock
        .mockResolvedValueOnce(COMMAND_AUTH_LOGIN)
        .mockResolvedValueOnce("set");
      promptSearchSelectMock.mockResolvedValueOnce({
        status: "submitted",
        value: "agt_bot_1",
      });
      getAuthSessionStateMock.mockResolvedValue({
        state: "valid",
        session: {
          v: 1,
          accessToken: "token",
          tokenType: "Bearer",
          authBaseUrl: "http://localhost:8788",
          clientId: "openmeld-cli-dev",
          createdAt: "2026-02-20T00:00:00.000Z",
        },
      });
      getAuthSessionStateMock.mockResolvedValueOnce({
        state: "missing",
        session: null,
      });
      runAuthLoginMock.mockResolvedValue(undefined);
      listOpenMeldProfilesMock.mockResolvedValue([
        {
          openMeldProfileId: "agt_bot_1",
          profileName: "agent-one",
          profileKind: "agent",
          isDefault: false,
          status: "active",
          ownerUserId: "user-1",
          source: "cli_create",
          createdByUserId: "user-1",
          lastUsedAt: null,
          createdAt: "2026-02-20T00:00:00.000Z",
          updatedAt: "2026-02-20T00:00:00.000Z",
        },
      ]);
      resolveOpenMeldProfileMock.mockResolvedValue({
        openMeldProfileId: "agt_bot_1",
        profileName: "agent-one",
        profileKind: "agent",
        isDefault: false,
        status: "active",
        ownerUserId: "user-1",
        source: "cli_create",
        createdByUserId: "user-1",
        lastUsedAt: null,
        createdAt: "2026-02-20T00:00:00.000Z",
        updatedAt: "2026-02-20T00:00:00.000Z",
      });

      await runProfileMenu({
        view: "human",
      });

      expect(runAuthLoginMock).toHaveBeenCalledTimes(1);
    });
  });

  it("shows profile name first in human set picker", async () => {
    await withTempHome(async () => {
      selectMock.mockResolvedValueOnce("set");
      promptSearchSelectMock.mockResolvedValueOnce({
        status: "back",
      });
      getAuthSessionStateMock.mockResolvedValue({
        state: "valid",
        session: {
          v: 1,
          accessToken: "token",
          tokenType: "Bearer",
          authBaseUrl: "http://localhost:8788",
          clientId: "openmeld-cli-dev",
          createdAt: "2026-02-20T00:00:00.000Z",
        },
      });
      listOpenMeldProfilesMock.mockResolvedValue([
        {
          openMeldProfileId: "4e11e3a3-2f84-4d19-a3a4-9e9206b15dea",
          profileName: "felix",
          profileKind: "human",
          isDefault: true,
          status: "active",
          ownerUserId: "user-1",
          source: "auth_bootstrap",
          createdByUserId: "user-1",
          lastUsedAt: null,
          createdAt: "2026-02-20T00:00:00.000Z",
          updatedAt: "2026-02-20T00:00:00.000Z",
        },
        {
          openMeldProfileId: "agt_bot_2",
          profileName: "planner",
          profileKind: "agent",
          isDefault: false,
          status: "active",
          ownerUserId: "user-1",
          source: "cli_create",
          createdByUserId: "user-1",
          lastUsedAt: null,
          createdAt: "2026-02-20T00:00:00.000Z",
          updatedAt: "2026-02-20T00:00:00.000Z",
        },
      ]);

      await runProfileMenu({
        view: "human",
      });

      const pickerCall = promptSearchSelectMock.mock.calls[0]?.[0] as
        | {
            items?: Array<{
              value: string;
              label: string;
              detail?: string;
            }>;
          }
        | undefined;
      const options = pickerCall?.items ?? [];
      const humanOption = options.find(
        (option) => option.value === "4e11e3a3-2f84-4d19-a3a4-9e9206b15dea"
      );
      expect(humanOption?.label).toBe("felix (selected)");
      expect(humanOption?.detail).toBe(
        "human · 4e11e3a3-2f84-4d19-a3a4-9e9206b15dea"
      );
    });
  });

  it("supports update flow from profile menu", async () => {
    await withTempHome(async () => {
      selectMock.mockResolvedValueOnce("update").mockResolvedValueOnce("name");
      promptSearchSelectMock.mockResolvedValueOnce({
        status: "submitted",
        value: "agt_bot_2",
      });
      promptTextEntryMock.mockResolvedValueOnce({
        status: "submitted",
        value: "planner-v2",
      });

      getAuthSessionStateMock.mockResolvedValue({
        state: "valid",
        session: {
          v: 1,
          accessToken: "token",
          tokenType: "Bearer",
          authBaseUrl: "http://localhost:8788",
          clientId: "openmeld-cli-dev",
          createdAt: "2026-02-20T00:00:00.000Z",
        },
      });

      listOpenMeldProfilesMock.mockResolvedValue([
        {
          openMeldProfileId: "agt_bot_2",
          profileName: "planner",
          profileKind: "agent",
          isDefault: false,
          status: "active",
          ownerUserId: "user-1",
          source: "cli_create",
          createdByUserId: "user-1",
          lastUsedAt: null,
          createdAt: "2026-02-20T00:00:00.000Z",
          updatedAt: "2026-02-20T00:00:00.000Z",
        },
      ]);
      resolveOpenMeldProfileMock.mockResolvedValue({
        openMeldProfileId: "agt_bot_2",
        profileName: "planner",
        profileKind: "agent",
        isDefault: false,
        status: "active",
        ownerUserId: "user-1",
        source: "cli_create",
        createdByUserId: "user-1",
        lastUsedAt: null,
        createdAt: "2026-02-20T00:00:00.000Z",
        updatedAt: "2026-02-20T00:00:00.000Z",
      });
      updateOpenMeldProfileMock.mockResolvedValue({
        openMeldProfileId: "agt_bot_2",
        profileName: "planner-v2",
        profileKind: "agent",
        isDefault: false,
        status: "active",
        ownerUserId: "user-1",
        source: "cli_create",
        createdByUserId: "user-1",
        lastUsedAt: null,
        createdAt: "2026-02-20T00:00:00.000Z",
        updatedAt: "2026-02-20T00:00:00.000Z",
      });

      await runProfileMenu({
        view: "human",
      });

      expect(updateOpenMeldProfileMock).toHaveBeenCalledTimes(1);
      expect(updateOpenMeldProfileMock).toHaveBeenCalledWith({
        openMeldProfileId: "agt_bot_2",
        profileName: "planner-v2",
      });
      expect(promptTextEntryMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "New profile name",
          allowBack: true,
          backLabel: "Back",
        })
      );
    });
  });

  it("returns to profile menu when update backs out level by level", async () => {
    await withTempHome(async () => {
      let profileActionPromptCount = 0;
      let updateFieldPromptCount = 0;
      selectMock.mockImplementation(
        (input: {
          message?: string;
          options?: Array<{ label: string; value: string }>;
        }) => {
          const message = String(input.message ?? "");
          if (message === "Profile action") {
            profileActionPromptCount += 1;
            return Promise.resolve(
              profileActionPromptCount === 1 ? "update" : "exit"
            );
          }
          if (message === "What do you want to update?") {
            updateFieldPromptCount += 1;
            return Promise.resolve(
              updateFieldPromptCount === 1
                ? "name"
                : resolveOptionValueByLabel(input.options, "Back")
            );
          }
          throw new Error(`unexpected select prompt: ${message}`);
        }
      );
      promptSearchSelectMock
        .mockResolvedValueOnce({
          status: "submitted",
          value: "agt_bot_2",
        })
        .mockResolvedValueOnce({
          status: "back",
        });
      promptTextEntryMock.mockResolvedValueOnce({
        status: "back",
      });
      getAuthSessionStateMock.mockResolvedValue(createValidAuthSessionState());
      listOpenMeldProfilesMock.mockResolvedValue([
        createMockAgentProfile({
          openMeldProfileId: "agt_bot_2",
          profileName: "planner",
        }),
      ]);
      resolveOpenMeldProfileMock.mockResolvedValue(
        createMockAgentProfile({
          openMeldProfileId: "agt_bot_2",
          profileName: "planner",
        })
      );

      await runProfileMenu({
        view: "human",
      });

      expect(promptSearchSelectMock).toHaveBeenCalledTimes(2);
      expect(promptTextEntryMock).toHaveBeenCalledTimes(1);
      expect(updateOpenMeldProfileMock).not.toHaveBeenCalled();
      expect(
        selectMock.mock.calls.filter(
          ([payload]) =>
            payload &&
            typeof payload === "object" &&
            "message" in payload &&
            payload.message === "Profile action"
        )
      ).toHaveLength(2);
      expect(cancelMock).toHaveBeenCalledTimes(1);
      expect(cancelMock).toHaveBeenCalledWith("Cancelled.");
    });
  });

  it("keeps name editor back inside update flow until the outermost exit", async () => {
    await withTempHome(async () => {
      let updateFieldPromptCount = 0;
      selectMock.mockImplementation(
        (input: {
          message?: string;
          options?: Array<{ label: string; value: string }>;
        }) => {
          const message = String(input.message ?? "");
          if (message === "What do you want to update?") {
            updateFieldPromptCount += 1;
            return Promise.resolve(
              updateFieldPromptCount === 1
                ? "name"
                : resolveOptionValueByLabel(input.options, "Back")
            );
          }
          throw new Error(`unexpected select prompt: ${message}`);
        }
      );
      promptTextEntryMock.mockResolvedValueOnce({
        status: "back",
      });
      getAuthSessionStateMock.mockResolvedValue(createValidAuthSessionState());
      resolveOpenMeldProfileMock.mockResolvedValue(
        createMockAgentProfile({
          openMeldProfileId: "agt_bot_2",
          profileName: "planner",
        })
      );

      await runProfileUpdate({
        view: "human",
        profile: "agt_bot_2",
      });

      expect(promptTextEntryMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "New profile name",
          allowBack: true,
          backLabel: "Back",
        })
      );
      expect(updateOpenMeldProfileMock).not.toHaveBeenCalled();
      expect(cancelMock).toHaveBeenCalledTimes(1);
      expect(cancelMock).toHaveBeenCalledWith("Cancelled.");
    });
  });

  it("updates profile workspace to a custom folder from the interactive update flow", async () => {
    await withTempHome(async () => {
      const customWorkspacePath = await mkdtemp(
        join(tmpdir(), "openmeld-profile-workspace-interactive-")
      );
      selectMock.mockImplementation(
        (input: {
          message?: string;
          options?: Array<{ label: string; value: string }>;
        }) => {
          const message = String(input.message ?? "");
          if (message === "What do you want to update?") {
            return Promise.resolve("workspace");
          }
          if (message === "Workspace") {
            return Promise.resolve("custom");
          }
          throw new Error(`unexpected select prompt: ${message}`);
        }
      );
      promptTextEntryMock.mockResolvedValueOnce({
        status: "submitted",
        value: customWorkspacePath,
      });
      getAuthSessionStateMock.mockResolvedValue(createValidAuthSessionState());
      resolveOpenMeldProfileMock.mockResolvedValue(
        createMockAgentProfile({
          openMeldProfileId: "agt_bot_workspace_custom",
          profileName: "planner",
        })
      );

      await runProfileUpdate({
        view: "human",
        profile: "agt_bot_workspace_custom",
      });

      await expect(
        readProfileWorkspaceConfig({
          openMeldProfileId: "agt_bot_workspace_custom",
        })
      ).resolves.toMatchObject({
        status: "valid",
        value: {
          mode: "custom",
          customWorkspacePath,
        },
      });
      expect(promptTextEntryMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Custom workspace path",
          allowBack: true,
          backLabel: "Back",
        })
      );
      expect(updateOpenMeldProfileMock).not.toHaveBeenCalled();
    });
  });

  it("fails clearly when the interactive workspace path is invalid", async () => {
    await withTempHome(async () => {
      selectMock.mockImplementation(
        (input: {
          message?: string;
          options?: Array<{ label: string; value: string }>;
        }) => {
          const message = String(input.message ?? "");
          if (message === "What do you want to update?") {
            return Promise.resolve("workspace");
          }
          if (message === "Workspace") {
            return Promise.resolve("custom");
          }
          throw new Error(`unexpected select prompt: ${message}`);
        }
      );
      promptTextEntryMock.mockResolvedValueOnce({
        status: "submitted",
        value: "relative/path",
      });
      getAuthSessionStateMock.mockResolvedValue(createValidAuthSessionState());
      resolveOpenMeldProfileMock.mockResolvedValue(
        createMockAgentProfile({
          openMeldProfileId: "agt_bot_workspace_invalid",
          profileName: "planner",
        })
      );

      await expect(
        runProfileUpdate({
          view: "human",
          profile: "agt_bot_workspace_invalid",
        })
      ).rejects.toThrow(
        "Workspace path 'relative/path' must be an absolute path or start with '~/'"
      );

      expect(updateOpenMeldProfileMock).not.toHaveBeenCalled();
      await expect(
        readProfileWorkspaceConfig({
          openMeldProfileId: "agt_bot_workspace_invalid",
        })
      ).resolves.toMatchObject({
        status: "missing",
      });
    });
  });

  it("supports multi-select delete flow from profile menu", async () => {
    await withTempHome(async () => {
      selectMock.mockResolvedValueOnce("delete");
      promptSearchMultiselectMock.mockResolvedValueOnce({
        status: "submitted",
        value: ["agt_bot_1", "agt_bot_2"],
      });
      confirmMock.mockResolvedValueOnce(true);

      getAuthSessionStateMock.mockResolvedValue({
        state: "valid",
        session: {
          v: 1,
          accessToken: "token",
          tokenType: "Bearer",
          authBaseUrl: "http://localhost:8788",
          clientId: "openmeld-cli-dev",
          createdAt: "2026-02-20T00:00:00.000Z",
        },
      });

      listOpenMeldProfilesMock
        .mockResolvedValueOnce([
          {
            openMeldProfileId: "agt_bot_1",
            profileName: "agent-one",
            profileKind: "agent",
            isDefault: false,
            status: "active",
            ownerUserId: "user-1",
            source: "cli_create",
            createdByUserId: "user-1",
            lastUsedAt: null,
            createdAt: "2026-02-20T00:00:00.000Z",
            updatedAt: "2026-02-20T00:00:00.000Z",
          },
          {
            openMeldProfileId: "agt_bot_2",
            profileName: "agent-two",
            profileKind: "agent",
            isDefault: false,
            status: "active",
            ownerUserId: "user-1",
            source: "cli_create",
            createdByUserId: "user-1",
            lastUsedAt: null,
            createdAt: "2026-02-20T00:00:00.000Z",
            updatedAt: "2026-02-20T00:00:00.000Z",
          },
        ])
        .mockResolvedValueOnce([]);

      resolveOpenMeldProfileMock
        .mockResolvedValueOnce({
          openMeldProfileId: "agt_bot_1",
          profileName: "agent-one",
          profileKind: "agent",
          isDefault: false,
          status: "active",
          ownerUserId: "user-1",
          source: "cli_create",
          createdByUserId: "user-1",
          lastUsedAt: null,
          createdAt: "2026-02-20T00:00:00.000Z",
          updatedAt: "2026-02-20T00:00:00.000Z",
        })
        .mockResolvedValueOnce({
          openMeldProfileId: "agt_bot_2",
          profileName: "agent-two",
          profileKind: "agent",
          isDefault: false,
          status: "active",
          ownerUserId: "user-1",
          source: "cli_create",
          createdByUserId: "user-1",
          lastUsedAt: null,
          createdAt: "2026-02-20T00:00:00.000Z",
          updatedAt: "2026-02-20T00:00:00.000Z",
        });

      await runProfileMenu({
        view: "human",
      });

      expect(promptSearchMultiselectMock).toHaveBeenCalledTimes(1);
      expect(confirmMock).toHaveBeenCalledWith({
        message: "Delete 2 profiles?",
        initialValue: false,
      });
      expect(deleteOpenMeldProfileMock).toHaveBeenCalledTimes(2);
      expect(deleteOpenMeldProfileMock).toHaveBeenNthCalledWith(1, {
        openMeldProfileId: "agt_bot_1",
      });
      expect(deleteOpenMeldProfileMock).toHaveBeenNthCalledWith(2, {
        openMeldProfileId: "agt_bot_2",
      });
    });
  });

  it("excludes default human profile from delete picker options", async () => {
    await withTempHome(async () => {
      selectMock.mockResolvedValueOnce("delete");
      promptSearchMultiselectMock.mockResolvedValueOnce({
        status: "cancelled",
      });

      getAuthSessionStateMock.mockResolvedValue({
        state: "valid",
        session: {
          v: 1,
          accessToken: "token",
          tokenType: "Bearer",
          authBaseUrl: "http://localhost:8788",
          clientId: "openmeld-cli-dev",
          createdAt: "2026-02-20T00:00:00.000Z",
        },
      });

      listOpenMeldProfilesMock.mockResolvedValue([
        {
          openMeldProfileId: "8dffd816-d276-44ae-be53-d44401a1f5ce",
          profileName: "felix",
          profileKind: "human",
          isDefault: true,
          status: "active",
          ownerUserId: "user-1",
          source: "auth_bootstrap",
          createdByUserId: "user-1",
          lastUsedAt: null,
          createdAt: "2026-02-20T00:00:00.000Z",
          updatedAt: "2026-02-20T00:00:00.000Z",
        },
        {
          openMeldProfileId: "agt_bot_2",
          profileName: "refactor-codex-agent",
          profileKind: "agent",
          isDefault: false,
          status: "active",
          ownerUserId: "user-1",
          source: "cli_create",
          createdByUserId: "user-1",
          lastUsedAt: null,
          createdAt: "2026-02-20T00:00:00.000Z",
          updatedAt: "2026-02-20T00:00:00.000Z",
        },
      ]);

      await runProfileMenu({
        view: "human",
      });

      const pickerCall = promptSearchMultiselectMock.mock.calls[0]?.[0] as
        | {
            items?: Array<{
              value: string;
              label: string;
              detail?: string;
            }>;
          }
        | undefined;
      const options = pickerCall?.items ?? [];
      const defaultHumanOption = options.find(
        (option) => option.value === "8dffd816-d276-44ae-be53-d44401a1f5ce"
      );
      const agentOption = options.find(
        (option) => option.value === "agt_bot_2"
      );

      expect(defaultHumanOption).toBeUndefined();
      expect(agentOption).toBeDefined();
      expect(deleteOpenMeldProfileMock).not.toHaveBeenCalled();
    });
  });

  it("rejects delete when protected default profile id is returned", async () => {
    await withTempHome(async () => {
      selectMock.mockResolvedValueOnce("delete");
      promptSearchMultiselectMock.mockResolvedValueOnce({
        status: "submitted",
        value: ["8dffd816-d276-44ae-be53-d44401a1f5ce"],
      });

      getAuthSessionStateMock.mockResolvedValue({
        state: "valid",
        session: {
          v: 1,
          accessToken: "token",
          tokenType: "Bearer",
          authBaseUrl: "http://localhost:8788",
          clientId: "openmeld-cli-dev",
          createdAt: "2026-02-20T00:00:00.000Z",
        },
      });

      listOpenMeldProfilesMock.mockResolvedValue([
        {
          openMeldProfileId: "8dffd816-d276-44ae-be53-d44401a1f5ce",
          profileName: "felix",
          profileKind: "human",
          isDefault: true,
          status: "active",
          ownerUserId: "user-1",
          source: "auth_bootstrap",
          createdByUserId: "user-1",
          lastUsedAt: null,
          createdAt: "2026-02-20T00:00:00.000Z",
          updatedAt: "2026-02-20T00:00:00.000Z",
        },
      ]);
      resolveOpenMeldProfileMock.mockResolvedValue({
        openMeldProfileId: "8dffd816-d276-44ae-be53-d44401a1f5ce",
        profileName: "felix",
        profileKind: "human",
        isDefault: true,
        status: "active",
        ownerUserId: "user-1",
        source: "auth_bootstrap",
        createdByUserId: "user-1",
        lastUsedAt: null,
        createdAt: "2026-02-20T00:00:00.000Z",
        updatedAt: "2026-02-20T00:00:00.000Z",
      });

      await expect(
        runProfileMenu({
          view: "human",
        })
      ).rejects.toThrow(
        "no deletable profiles: default human profile is protected"
      );

      expect(confirmMock).not.toHaveBeenCalled();
      expect(resolveOpenMeldProfileMock).not.toHaveBeenCalled();
      expect(deleteOpenMeldProfileMock).not.toHaveBeenCalled();
    });
  });
});

function createValidAuthSessionState() {
  return {
    state: "valid" as const,
    session: {
      v: 1,
      accessToken: "token",
      tokenType: "Bearer",
      authBaseUrl: "http://localhost:8788",
      clientId: "openmeld-cli-dev",
      createdAt: "2026-02-20T00:00:00.000Z",
    },
  };
}

function createMockAgentProfile(input: {
  openMeldProfileId: string;
  profileName: string;
}) {
  return {
    openMeldProfileId: input.openMeldProfileId,
    profileName: input.profileName,
    profileKind: "agent" as const,
    isDefault: false,
    status: "active" as const,
    ownerUserId: "user-1",
    source: "cli_create" as const,
    createdByUserId: "user-1",
    lastUsedAt: null,
    createdAt: "2026-02-20T00:00:00.000Z",
    updatedAt: "2026-02-20T00:00:00.000Z",
  };
}

function resolveOptionValueByLabel(
  options: Array<{ label: string; value: string }> | undefined,
  label: string
): string {
  const matched = options?.find((option) => option.label === label)?.value;
  if (!matched) {
    throw new Error(`missing option with label: ${label}`);
  }
  return matched;
}
