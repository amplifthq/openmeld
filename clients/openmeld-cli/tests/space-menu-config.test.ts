import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSpaceMenu } from "../src/space/menu";

const selectMock = vi.hoisted(() => vi.fn());
const isCancelMock = vi.hoisted(() => vi.fn((_value: unknown) => false));
const resolveRuntimeContextMock = vi.hoisted(() => vi.fn());
const getAuthSessionStateMock = vi.hoisted(() => vi.fn());
const runSpaceJoinMock = vi.hoisted(() => vi.fn());
const runSpaceCreateMock = vi.hoisted(() => vi.fn());
const runSpaceDeleteMock = vi.hoisted(() => vi.fn());
const runSpaceAddMembersMock = vi.hoisted(() => vi.fn());
const runSpaceRemoveMembersMock = vi.hoisted(() => vi.fn());
const runSpaceLeaveMock = vi.hoisted(() => vi.fn());
const runSpacePasswordMock = vi.hoisted(() => vi.fn());
const promptTextEntryMock = vi.hoisted(() => vi.fn());
const promptAndConfirmSpacePasswordMock = vi.hoisted(() => vi.fn());

const VALID_AUTH_STATE = {
  state: "valid" as const,
  session: {
    v: 1 as const,
    accessToken: "token-123",
    tokenType: "Bearer",
    authBaseUrl: "https://auth.openmeld.invalid",
    clientId: "openmeld-cli",
    createdAt: "2026-03-01T00:00:00.000Z",
    user: {
      id: "user-1",
      email: "felix@example.com",
    },
  },
};

vi.mock("@clack/prompts", () => {
  return {
    cancel: vi.fn(),
    isCancel: (value: unknown) => isCancelMock(value),
    outro: vi.fn(),
    select: (input: unknown) => selectMock(input),
  };
});

vi.mock("../src/runtime/context", () => {
  return {
    parseCliViewMode: vi.fn(),
    resolveRuntimeContext: (...args: unknown[]) =>
      resolveRuntimeContextMock(...args),
  };
});

vi.mock("../src/config/auth-session", async () => {
  const actual = await vi.importActual<
    typeof import("../src/config/auth-session")
  >("../src/config/auth-session");
  return {
    ...actual,
    getAuthSessionState: (
      ...args: Parameters<typeof getAuthSessionStateMock>
    ) => getAuthSessionStateMock(...args),
  };
});

vi.mock("../src/space/command", () => {
  return {
    buildCreateSpacePasswordPromptConfig: vi.fn(() => ({
      message: "Require a password to join?",
      setPasswordLabel: "Yes, require a password",
      skipPasswordLabel: "No, anyone with the link can join",
    })),
    promptAndConfirmSpacePassword: (...args: unknown[]) =>
      promptAndConfirmSpacePasswordMock(...args),
    runSpaceJoin: (...args: unknown[]) => runSpaceJoinMock(...args),
    runSpaceCreate: (...args: unknown[]) => runSpaceCreateMock(...args),
    runSpaceDelete: (...args: unknown[]) => runSpaceDeleteMock(...args),
    runSpaceAddMembers: (...args: unknown[]) => runSpaceAddMembersMock(...args),
    runSpaceRemoveMembers: (...args: unknown[]) =>
      runSpaceRemoveMembersMock(...args),
    runSpaceLeave: (...args: unknown[]) => runSpaceLeaveMock(...args),
    runSpacePassword: (...args: unknown[]) => runSpacePasswordMock(...args),
  };
});

vi.mock("../src/ui/text-entry", () => {
  return {
    promptTextEntry: (...args: unknown[]) => promptTextEntryMock(...args),
  };
});

describe("space menu config password", () => {
  beforeEach(() => {
    getAuthSessionStateMock.mockReset().mockResolvedValue(VALID_AUTH_STATE);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    selectMock.mockReset();
    isCancelMock.mockReset();
    isCancelMock.mockImplementation((_value: unknown) => false);
    resolveRuntimeContextMock.mockReset();
    getAuthSessionStateMock.mockReset();
    runSpaceJoinMock.mockReset();
    runSpaceCreateMock.mockReset();
    runSpaceDeleteMock.mockReset();
    runSpaceAddMembersMock.mockReset();
    runSpaceRemoveMembersMock.mockReset();
    runSpaceLeaveMock.mockReset();
    runSpacePasswordMock.mockReset();
    promptTextEntryMock.mockReset();
    promptAndConfirmSpacePasswordMock.mockReset();
  });

  it("shows add-members entry and routes to add-members flow", async () => {
    resolveRuntimeContextMock.mockResolvedValue({
      viewMode: "human",
      resolvedView: "human",
      interactive: true,
    });
    selectMock.mockResolvedValueOnce("add_members");

    await runSpaceMenu({
      profile: "hum-profile",
      baseUrl: "https://gateway.openmeld.invalid",
      view: "human",
    });

    const firstSelectInput = selectMock.mock.calls[0]?.[0] as
      | { options?: Array<{ value?: string; label?: string }> }
      | undefined;
    const firstOptions = firstSelectInput?.options ?? [];
    expect(
      firstOptions.some(
        (option) =>
          option.value === "add_members" && option.label === "Add members"
      )
    ).toBe(true);
    expect(runSpaceAddMembersMock).toHaveBeenCalledWith({
      profile: "hum-profile",
      baseUrl: "https://gateway.openmeld.invalid",
      view: "human",
      entryChecksHandled: true,
      allowBackToCaller: true,
      membershipSource: "organization_directory",
    });
    expect(runSpaceJoinMock).not.toHaveBeenCalled();
    expect(runSpaceCreateMock).not.toHaveBeenCalled();
    expect(runSpaceDeleteMock).not.toHaveBeenCalled();
    expect(runSpacePasswordMock).not.toHaveBeenCalled();
    expect(promptTextEntryMock).not.toHaveBeenCalled();
  });

  it("shows remove-members entry and routes to remove-members flow", async () => {
    resolveRuntimeContextMock.mockResolvedValue({
      viewMode: "human",
      resolvedView: "human",
      interactive: true,
    });
    selectMock.mockResolvedValueOnce("remove_members");

    await runSpaceMenu({
      profile: "hum-profile",
      baseUrl: "https://gateway.openmeld.invalid",
      view: "human",
    });

    const firstSelectInput = selectMock.mock.calls[0]?.[0] as
      | { options?: Array<{ value?: string; label?: string }> }
      | undefined;
    const firstOptions = firstSelectInput?.options ?? [];
    expect(
      firstOptions.some(
        (option) =>
          option.value === "remove_members" && option.label === "Remove members"
      )
    ).toBe(true);
    expect(runSpaceRemoveMembersMock).toHaveBeenCalledWith({
      profile: "hum-profile",
      baseUrl: "https://gateway.openmeld.invalid",
      view: "human",
      entryChecksHandled: true,
      allowBackToCaller: true,
    });
    expect(runSpaceAddMembersMock).not.toHaveBeenCalled();
  });

  it("shows leave entry and routes to leave flow", async () => {
    resolveRuntimeContextMock.mockResolvedValue({
      viewMode: "human",
      resolvedView: "human",
      interactive: true,
    });
    selectMock.mockResolvedValueOnce("leave");

    await runSpaceMenu({
      profile: "hum-profile",
      baseUrl: "https://gateway.openmeld.invalid",
      view: "human",
    });

    const firstSelectInput = selectMock.mock.calls[0]?.[0] as
      | { options?: Array<{ value?: string; label?: string }> }
      | undefined;
    const firstOptions = firstSelectInput?.options ?? [];
    expect(
      firstOptions.some(
        (option) => option.value === "leave" && option.label === "Leave a space"
      )
    ).toBe(true);
    expect(runSpaceLeaveMock).toHaveBeenCalledWith({
      profile: "hum-profile",
      baseUrl: "https://gateway.openmeld.invalid",
      view: "human",
      entryChecksHandled: true,
      allowBackToCaller: true,
    });
    expect(runSpaceAddMembersMock).not.toHaveBeenCalled();
    expect(runSpaceRemoveMembersMock).not.toHaveBeenCalled();
  });

  it("shows configure entry and routes to password flow", async () => {
    resolveRuntimeContextMock.mockResolvedValue({
      viewMode: "human",
      resolvedView: "human",
      interactive: true,
    });
    selectMock
      .mockResolvedValueOnce("configure")
      .mockResolvedValueOnce("password");

    await runSpaceMenu({
      profile: "hum-profile",
      baseUrl: "https://gateway.openmeld.invalid",
      view: "human",
    });

    const firstSelectInput = selectMock.mock.calls[0]?.[0] as
      | { options?: Array<{ value?: string; label?: string }> }
      | undefined;
    const firstOptions = firstSelectInput?.options ?? [];
    expect(firstOptions.some((option) => option.value === "configure")).toBe(
      true
    );
    expect(firstOptions.some((option) => option.value === "add_members")).toBe(
      true
    );
    expect(firstOptions.some((option) => option.value === "list")).toBe(false);
    expect(
      firstOptions.some(
        (option) =>
          option.value === "delete" && option.label === "Delete spaces"
      )
    ).toBe(true);
    expect(runSpacePasswordMock).toHaveBeenCalledWith({
      profile: "hum-profile",
      baseUrl: "https://gateway.openmeld.invalid",
      view: "human",
      entryChecksHandled: true,
      allowBackToCaller: true,
    });
    expect(promptTextEntryMock).not.toHaveBeenCalled();
    expect(runSpaceJoinMock).not.toHaveBeenCalled();
    expect(runSpaceCreateMock).not.toHaveBeenCalled();
    expect(runSpaceDeleteMock).not.toHaveBeenCalled();
    expect(runSpaceAddMembersMock).not.toHaveBeenCalled();
  });

  it("returns to the top-level menu when join backs out", async () => {
    resolveRuntimeContextMock.mockResolvedValue({
      viewMode: "human",
      resolvedView: "human",
      interactive: true,
    });
    selectMock.mockResolvedValueOnce("join").mockResolvedValueOnce("exit");
    runSpaceJoinMock.mockResolvedValueOnce("back");

    await runSpaceMenu({
      profile: "hum-profile",
      baseUrl: "https://gateway.openmeld.invalid",
      view: "human",
    });

    expect(selectMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        message: "What do you want to do?",
      })
    );
    expect(selectMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        message: "What do you want to do?",
      })
    );
    expect(runSpaceJoinMock).toHaveBeenCalledWith({
      profile: "hum-profile",
      baseUrl: "https://gateway.openmeld.invalid",
      output: "text",
      view: "human",
      entryChecksHandled: true,
    });
    expect(runSpaceCreateMock).not.toHaveBeenCalled();
    expect(runSpaceDeleteMock).not.toHaveBeenCalled();
    expect(runSpaceAddMembersMock).not.toHaveBeenCalled();
    expect(runSpacePasswordMock).not.toHaveBeenCalled();
  });

  it("returns to the top-level menu when add-members backs out", async () => {
    resolveRuntimeContextMock.mockResolvedValue({
      viewMode: "human",
      resolvedView: "human",
      interactive: true,
    });
    selectMock
      .mockResolvedValueOnce("add_members")
      .mockResolvedValueOnce("exit");
    runSpaceAddMembersMock.mockResolvedValueOnce("back");

    await runSpaceMenu({
      profile: "hum-profile",
      baseUrl: "https://gateway.openmeld.invalid",
      view: "human",
    });

    expect(runSpaceAddMembersMock).toHaveBeenCalledWith({
      profile: "hum-profile",
      baseUrl: "https://gateway.openmeld.invalid",
      view: "human",
      entryChecksHandled: true,
      allowBackToCaller: true,
      membershipSource: "organization_directory",
    });
    expect(selectMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        message: "What do you want to do?",
      })
    );
  });

  it("returns to the top-level menu when delete backs out", async () => {
    resolveRuntimeContextMock.mockResolvedValue({
      viewMode: "human",
      resolvedView: "human",
      interactive: true,
    });
    selectMock.mockResolvedValueOnce("delete").mockResolvedValueOnce("exit");
    runSpaceDeleteMock.mockResolvedValueOnce("back");

    await runSpaceMenu({
      profile: "hum-profile",
      baseUrl: "https://gateway.openmeld.invalid",
      view: "human",
    });

    expect(runSpaceDeleteMock).toHaveBeenCalledWith({
      profile: "hum-profile",
      baseUrl: "https://gateway.openmeld.invalid",
      view: "human",
      entryChecksHandled: true,
      allowBackToCaller: true,
    });
    expect(selectMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        message: "What do you want to do?",
      })
    );
  });

  it("returns to configure first, then the top-level menu, when password backs out", async () => {
    resolveRuntimeContextMock.mockResolvedValue({
      viewMode: "human",
      resolvedView: "human",
      interactive: true,
    });
    selectMock
      .mockResolvedValueOnce("configure")
      .mockResolvedValueOnce("password")
      .mockResolvedValueOnce("back")
      .mockResolvedValueOnce("exit");
    runSpacePasswordMock.mockResolvedValueOnce("back");

    await runSpaceMenu({
      profile: "hum-profile",
      baseUrl: "https://gateway.openmeld.invalid",
      view: "human",
    });

    expect(selectMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        message: "What do you want to configure?",
      })
    );
    expect(selectMock).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        message: "What do you want to configure?",
      })
    );
    expect(selectMock).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        message: "What do you want to do?",
      })
    );
  });

  it("lets create back from guide to name before submitting", async () => {
    resolveRuntimeContextMock.mockResolvedValue({
      viewMode: "human",
      resolvedView: "human",
      interactive: true,
    });
    selectMock
      .mockResolvedValueOnce("create")
      .mockResolvedValueOnce("private")
      .mockResolvedValueOnce("private")
      .mockResolvedValueOnce("skip")
      .mockResolvedValueOnce("join");
    promptTextEntryMock
      .mockResolvedValueOnce({
        status: "submitted",
        value: "first-space",
      })
      .mockResolvedValueOnce({
        status: "back",
      })
      .mockResolvedValueOnce({
        status: "submitted",
        value: "final-space",
      })
      .mockResolvedValueOnce({
        status: "submitted",
        value: "Keep it concise",
      });

    await runSpaceMenu({
      profile: "hum-profile",
      baseUrl: "https://gateway.openmeld.invalid",
      view: "human",
    });

    expect(runSpaceCreateMock).toHaveBeenCalledWith({
      profile: "hum-profile",
      baseUrl: "https://gateway.openmeld.invalid",
      name: "final-space",
      visibility: "private",
      guide: "Keep it concise",
      password: undefined,
      join: true,
      output: "text",
      view: "human",
      entryChecksHandled: true,
    });
  });

  it("returns to the top-level menu when create returns back", async () => {
    resolveRuntimeContextMock.mockResolvedValue({
      viewMode: "human",
      resolvedView: "human",
      interactive: true,
    });
    selectMock
      .mockResolvedValueOnce("create")
      .mockResolvedValueOnce("private")
      .mockResolvedValueOnce("skip")
      .mockResolvedValueOnce("join")
      .mockResolvedValueOnce("exit");
    promptTextEntryMock
      .mockResolvedValueOnce({
        status: "submitted",
        value: "ops-room",
      })
      .mockResolvedValueOnce({
        status: "submitted",
        value: "Keep it concise",
      });
    runSpaceCreateMock.mockResolvedValueOnce("back");

    await runSpaceMenu({
      profile: "hum-profile",
      baseUrl: "https://gateway.openmeld.invalid",
      view: "human",
    });

    expect(selectMock).toHaveBeenNthCalledWith(
      5,
      expect.objectContaining({
        message: "What do you want to do?",
      })
    );
  });
});
