import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  canUseInteractivePromptsMock,
  cancelMock,
  promptTextEntryMock,
  selectMock,
} = vi.hoisted(() => ({
  canUseInteractivePromptsMock: vi.fn(() => true),
  cancelMock: vi.fn(),
  promptTextEntryMock: vi.fn(),
  selectMock: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
  cancel: cancelMock,
  isCancel: vi.fn((value: unknown) => value === "__cancel__"),
  select: selectMock,
  text: vi.fn(),
}));

vi.mock("../src/runtime/interaction", () => ({
  canUseInteractivePrompts: canUseInteractivePromptsMock,
}));

vi.mock("../src/ui/text-entry", () => ({
  promptTextEntry: (...args: Parameters<typeof promptTextEntryMock>) =>
    promptTextEntryMock(...args),
}));

import { runAuthLogin, runAuthMenu } from "../src/commands/auth";
import { getAuthSession, setAuthSession } from "../src/config/auth-session";
import { withCapturedStdio, withTempHome } from "./helpers/fs";

function resolveOptionValueByLabel(
  options: Array<{ label: string; value: string }> | undefined,
  label: string
): string {
  const value = options?.find((option) => option.label === label)?.value;
  if (!value) {
    throw new Error(`Missing option label: ${label}`);
  }
  return value;
}

describe("auth menu", () => {
  beforeEach(() => {
    canUseInteractivePromptsMock.mockReset();
    canUseInteractivePromptsMock.mockReturnValue(true);
    cancelMock.mockReset();
    promptTextEntryMock.mockReset();
    selectMock.mockReset();
    vi.unstubAllGlobals();
    process.exitCode = undefined;
  });

  afterEach(() => {
    Reflect.deleteProperty(
      process.env,
      "OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN"
    );
    vi.unstubAllGlobals();
    process.exitCode = undefined;
  });

  it("shows status/login/logout options and runs status when selected", async () => {
    selectMock.mockResolvedValueOnce("status");

    await withTempHome(async () => {
      const { stdout } = await withCapturedStdio(() =>
        runAuthMenu({ view: "human" })
      );

      const options = (
        selectMock.mock.calls[0]?.[0] as
          | { options?: Array<{ label: string; value: string }> }
          | undefined
      )?.options;

      expect(options).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            label: "Status",
            value: "status",
          }),
          expect.objectContaining({
            label: "Sign in",
            value: "login",
          }),
          expect.objectContaining({
            label: "Sign out",
            value: "logout",
          }),
        ])
      );
      expect(stdout).toContain("Authentication Status");
      expect(stdout).toContain("Status: sign in needed");
      expect(stdout).not.toContain('{"signedIn"');
    });
  });

  it("returns to auth menu when login method exits from the login subflow", async () => {
    selectMock.mockImplementation(
      (input?: {
        message?: string;
        options?: Array<{ label: string; value: string }>;
      }) => {
        if (input?.message === "Sign-in action") {
          return selectMock.mock.calls.length === 1 ? "login" : "status";
        }
        if (input?.message === "Choose a sign-in method") {
          return resolveOptionValueByLabel(input.options, "Back");
        }
        throw new Error(`Unexpected select prompt: ${String(input?.message)}`);
      }
    );
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await withTempHome(async () => {
      const { stdout } = await withCapturedStdio(() =>
        runAuthMenu({ view: "human" })
      );

      expect(stdout).toContain("Authentication Status");
    });

    expect(selectMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(cancelMock).not.toHaveBeenCalled();
  });

  it("supports step-by-step Back from one-time token to login method, then back to auth menu", async () => {
    let authActionPromptCount = 0;
    let loginMethodPromptCount = 0;
    selectMock.mockImplementation(
      (input?: {
        message?: string;
        options?: Array<{ label: string; value: string }>;
      }) => {
        if (input?.message === "Sign-in action") {
          authActionPromptCount += 1;
          return authActionPromptCount === 1 ? "login" : "status";
        }
        if (input?.message === "Choose a sign-in method") {
          loginMethodPromptCount += 1;
          return loginMethodPromptCount === 1
            ? resolveOptionValueByLabel(input.options, "One-time sign-in token")
            : resolveOptionValueByLabel(input.options, "Back");
        }
        throw new Error(`Unexpected select prompt: ${String(input?.message)}`);
      }
    );
    promptTextEntryMock.mockResolvedValueOnce({ status: "back" });

    await withTempHome(async () => {
      const { stdout } = await withCapturedStdio(() =>
        runAuthMenu({ view: "human" })
      );

      expect(stdout).toContain("Authentication Status");
    });

    expect(promptTextEntryMock).toHaveBeenCalledWith({
      message: "Paste your one-time sign-in token",
      placeholder: "token from the sign-in page",
      allowBack: true,
      backLabel: "Back",
      requiredMessage: "Enter a one-time sign-in token.",
      validate: expect.any(Function),
    });
    expect(cancelMock).not.toHaveBeenCalled();
  });

  it("routes to logout flow from menu", async () => {
    selectMock.mockResolvedValueOnce("logout");

    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-menu-logout",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
      });

      const { stdout } = await withCapturedStdio(() =>
        runAuthMenu({ view: "human" })
      );

      expect(stdout).toContain("Signed out on this device.");
      await expect(getAuthSession()).resolves.toBeNull();
    });
  });

  it("falls back to auth status when prompt is unavailable", async () => {
    canUseInteractivePromptsMock.mockReturnValue(false);

    await withTempHome(async () => {
      const { stdout } = await withCapturedStdio(() =>
        runAuthMenu({ view: "human" })
      );

      expect(selectMock).not.toHaveBeenCalled();
      expect(stdout).toContain("Authentication Status");
      expect(stdout).toContain("Status: sign in needed");
      expect(stdout).not.toContain('{"signedIn"');
    });
  });

  it("keeps direct auth login cancellation at the command boundary", async () => {
    let loginMethodPromptCount = 0;
    selectMock.mockImplementation(
      (input?: {
        message?: string;
        options?: Array<{ label: string; value: string }>;
      }) => {
        if (input?.message !== "Choose a sign-in method") {
          throw new Error(
            `Unexpected select prompt: ${String(input?.message)}`
          );
        }
        loginMethodPromptCount += 1;
        return loginMethodPromptCount === 1
          ? resolveOptionValueByLabel(input.options, "One-time sign-in token")
          : resolveOptionValueByLabel(input.options, "Cancel");
      }
    );
    promptTextEntryMock.mockResolvedValueOnce({ status: "back" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await withTempHome(async () => {
      await withCapturedStdio(() => runAuthLogin({ view: "human" }));
    });

    expect(promptTextEntryMock).toHaveBeenCalledTimes(1);
    expect(cancelMock).toHaveBeenCalledWith("Cancelled.");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
