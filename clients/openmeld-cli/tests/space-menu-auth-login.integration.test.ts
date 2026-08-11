import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSpaceMenu } from "../src/space/menu";
import { withTempHome } from "./helpers/fs";

const COMMAND_AUTH_LOGIN = "__command_auth_login__";
const COMMAND_AUTH_CANCEL = "__command_auth_cancel__";

const cancelMock = vi.hoisted(() => vi.fn());
const getAuthSessionStateMock = vi.hoisted(() => vi.fn());
const outroMock = vi.hoisted(() => vi.fn());
const runAuthLoginMock = vi.hoisted(() => vi.fn());
const selectMock = vi.hoisted(() => vi.fn());

vi.mock("@clack/prompts", () => ({
  cancel: cancelMock,
  isCancel: vi.fn((value: unknown) => value === "__cancel__"),
  outro: outroMock,
  select: selectMock,
  text: vi.fn(),
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

describe("space menu auth login UX", () => {
  beforeEach(() => {
    cancelMock.mockReset();
    getAuthSessionStateMock.mockReset();
    outroMock.mockReset();
    runAuthLoginMock.mockReset();
    selectMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("prompts sign-in before showing the menu and then continues", async () => {
    await withTempHome(async () => {
      selectMock
        .mockResolvedValueOnce(COMMAND_AUTH_LOGIN)
        .mockResolvedValueOnce("exit");
      getAuthSessionStateMock
        .mockResolvedValueOnce({
          state: "missing",
          session: null,
        })
        .mockResolvedValueOnce({
          state: "valid",
          session: {
            v: 1,
            accessToken: "token",
            tokenType: "Bearer",
            authBaseUrl: "https://auth.testing.example",
            clientId: "openmeld-cli",
            createdAt: "2026-03-08T00:00:00.000Z",
          },
        });
      runAuthLoginMock.mockResolvedValue(undefined);

      await runSpaceMenu({
        baseUrl: "https://gateway.testing.example",
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
      expect(runAuthLoginMock).toHaveBeenCalledWith({
        view: "human",
      });
      expect(outroMock).toHaveBeenCalledWith("Done.");
    });
  });

  it("stops cleanly when sign-in is cancelled", async () => {
    await withTempHome(async () => {
      selectMock.mockResolvedValueOnce(COMMAND_AUTH_CANCEL);
      getAuthSessionStateMock.mockResolvedValueOnce({
        state: "missing",
        session: null,
      });

      await runSpaceMenu({
        baseUrl: "https://gateway.testing.example",
        view: "human",
      });

      expect(runAuthLoginMock).not.toHaveBeenCalled();
      expect(selectMock).toHaveBeenCalledTimes(1);
      expect(cancelMock).toHaveBeenCalledWith("Cancelled.");
    });
  });
});
