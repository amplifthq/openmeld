import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  runDisclaimerCheckMock,
  runCliUpdateCheckMock,
  runLocalRuntimeStateCheckMock,
  runSelectedProfileCheckMock,
  runServiceCheckMock,
  runSignInCheckMock,
  runSkillsCheckMock,
} = vi.hoisted(() => ({
  runDisclaimerCheckMock: vi.fn(),
  runCliUpdateCheckMock: vi.fn(),
  runLocalRuntimeStateCheckMock: vi.fn(),
  runSelectedProfileCheckMock: vi.fn(),
  runServiceCheckMock: vi.fn(),
  runSignInCheckMock: vi.fn(),
  runSkillsCheckMock: vi.fn(),
}));

vi.mock("../src/command-entry-checks/check-disclaimer", () => ({
  runDisclaimerCheck: (...args: Parameters<typeof runDisclaimerCheckMock>) =>
    runDisclaimerCheckMock(...args),
}));

vi.mock("../src/command-entry-checks/check-cli-update", () => ({
  runCliUpdateCheck: (...args: Parameters<typeof runCliUpdateCheckMock>) =>
    runCliUpdateCheckMock(...args),
}));

vi.mock("../src/command-entry-checks/check-local-runtime-state", () => ({
  runLocalRuntimeStateCheck: (
    ...args: Parameters<typeof runLocalRuntimeStateCheckMock>
  ) => runLocalRuntimeStateCheckMock(...args),
}));

vi.mock("../src/command-entry-checks/check-selected-profile", () => ({
  runSelectedProfileCheck: (
    ...args: Parameters<typeof runSelectedProfileCheckMock>
  ) => runSelectedProfileCheckMock(...args),
}));

vi.mock("../src/command-entry-checks/check-service", () => ({
  runServiceCheck: (...args: Parameters<typeof runServiceCheckMock>) =>
    runServiceCheckMock(...args),
}));

vi.mock("../src/command-entry-checks/check-sign-in", () => ({
  runSignInCheck: (...args: Parameters<typeof runSignInCheckMock>) =>
    runSignInCheckMock(...args),
}));

vi.mock("../src/command-entry-checks/check-skills", () => ({
  runSkillsCheck: (...args: Parameters<typeof runSkillsCheckMock>) =>
    runSkillsCheckMock(...args),
}));

import { runCommandEntryFlow } from "../src/command-entry-checks/run-command-entry-flow";
import type {
  CommandEntryContext,
  CommandEntryName,
} from "../src/command-entry-checks/types";

describe("run command entry flow", () => {
  beforeEach(() => {
    runDisclaimerCheckMock
      .mockReset()
      .mockResolvedValue({ status: "continue" });
    runCliUpdateCheckMock.mockReset().mockResolvedValue({ status: "continue" });
    runLocalRuntimeStateCheckMock
      .mockReset()
      .mockResolvedValue({ status: "continue" });
    runSelectedProfileCheckMock
      .mockReset()
      .mockResolvedValue({ status: "continue" });
    runServiceCheckMock.mockReset().mockResolvedValue({ status: "continue" });
    runSignInCheckMock.mockReset().mockResolvedValue({ status: "continue" });
    runSkillsCheckMock.mockReset().mockResolvedValue({ status: "continue" });
  });

  it.each([
    "space.join",
    "space.watch",
  ] as const)("runs local-state checks in stage order for %s", async (entryName) => {
    const callOrder: string[] = [];
    runCliUpdateCheckMock.mockImplementation(() => {
      callOrder.push("cliUpdate");
      return { status: "continue" };
    });
    runDisclaimerCheckMock.mockImplementation(() => {
      callOrder.push("disclaimer");
      return { status: "continue" };
    });
    runLocalRuntimeStateCheckMock.mockImplementation(() => {
      callOrder.push("localRuntimeState");
      return { status: "continue" };
    });
    runSignInCheckMock.mockImplementation(() => {
      callOrder.push("signIn");
      return { status: "continue" };
    });
    runSelectedProfileCheckMock.mockImplementation(() => {
      callOrder.push("selectedProfile");
      return { status: "continue" };
    });
    runServiceCheckMock.mockImplementation(() => {
      callOrder.push("service");
      return { status: "continue" };
    });

    const result = await runCommandEntryFlow(createContext(entryName));

    expect(result).toEqual({ status: "continue" });
    expect(callOrder).toEqual([
      "disclaimer",
      "cliUpdate",
      "localRuntimeState",
      "signIn",
      "selectedProfile",
    ]);
  });

  it("keeps cloud-only space creation entry checks lightweight", async () => {
    const callOrder: string[] = [];
    runCliUpdateCheckMock.mockImplementation(() => {
      callOrder.push("cliUpdate");
      return { status: "continue" };
    });
    runDisclaimerCheckMock.mockImplementation(() => {
      callOrder.push("disclaimer");
      return { status: "continue" };
    });
    runLocalRuntimeStateCheckMock.mockImplementation(() => {
      callOrder.push("localRuntimeState");
      return { status: "continue" };
    });
    runSignInCheckMock.mockImplementation(() => {
      callOrder.push("signIn");
      return { status: "continue" };
    });
    runSelectedProfileCheckMock.mockImplementation(() => {
      callOrder.push("selectedProfile");
      return { status: "continue" };
    });
    runServiceCheckMock.mockImplementation(() => {
      callOrder.push("service");
      return { status: "continue" };
    });

    const result = await runCommandEntryFlow(createContext("space.create"));

    expect(result).toEqual({ status: "continue" });
    expect(callOrder).toEqual([
      "disclaimer",
      "cliUpdate",
      "signIn",
      "selectedProfile",
    ]);
  });

  it("keeps setup available without running the CLI update gate", async () => {
    const callOrder: string[] = [];
    runDisclaimerCheckMock.mockImplementation(() => {
      callOrder.push("disclaimer");
      return { status: "continue" };
    });
    runLocalRuntimeStateCheckMock.mockImplementation(() => {
      callOrder.push("localRuntimeState");
      return { status: "continue" };
    });

    const result = await runCommandEntryFlow(createContext("setup"));

    expect(result).toEqual({ status: "continue" });
    expect(callOrder).toEqual(["disclaimer", "localRuntimeState"]);
    expect(runCliUpdateCheckMock).not.toHaveBeenCalled();
    expect(runSignInCheckMock).not.toHaveBeenCalled();
    expect(runSelectedProfileCheckMock).not.toHaveBeenCalled();
    expect(runServiceCheckMock).not.toHaveBeenCalled();
  });

  it("stops after the first blocking check result", async () => {
    const callOrder: string[] = [];
    runCliUpdateCheckMock.mockImplementation(() => {
      callOrder.push("cliUpdate");
      return { status: "continue" };
    });
    runDisclaimerCheckMock.mockImplementation(() => {
      callOrder.push("disclaimer");
      return { status: "continue" };
    });
    runLocalRuntimeStateCheckMock.mockImplementation(() => {
      callOrder.push("localRuntimeState");
      return { status: "continue" };
    });
    runSignInCheckMock.mockImplementation(() => {
      callOrder.push("signIn");
      return { status: "blocked", exitCode: 1 };
    });

    const result = await runCommandEntryFlow(createContext("space.join"));

    expect(result).toEqual({ status: "blocked", exitCode: 1 });
    expect(callOrder).toEqual([
      "disclaimer",
      "cliUpdate",
      "localRuntimeState",
      "signIn",
    ]);
    expect(runSelectedProfileCheckMock).not.toHaveBeenCalled();
    expect(runServiceCheckMock).not.toHaveBeenCalled();
  });

  it("runs status-only checks after blocking stages", async () => {
    const callOrder: string[] = [];
    runCliUpdateCheckMock.mockImplementation(() => {
      callOrder.push("cliUpdate");
      return { status: "continue" };
    });
    runDisclaimerCheckMock.mockImplementation(() => {
      callOrder.push("disclaimer");
      return { status: "continue" };
    });
    runSignInCheckMock.mockImplementation(() => {
      callOrder.push("signIn");
      return { status: "continue" };
    });
    runSelectedProfileCheckMock.mockImplementation(() => {
      callOrder.push("selectedProfile");
      return { status: "continue" };
    });
    runServiceCheckMock.mockImplementation(() => {
      callOrder.push("service");
      return { status: "continue" };
    });

    const result = await runCommandEntryFlow(createContext("doctor"));

    expect(result).toEqual({ status: "continue" });
    expect(callOrder).toEqual(["disclaimer", "cliUpdate", "signIn", "service"]);
    expect(runLocalRuntimeStateCheckMock).not.toHaveBeenCalled();
    expect(runSelectedProfileCheckMock).not.toHaveBeenCalled();
  });

  it("skips sign-in and selected-profile entry checks for whoami", async () => {
    const callOrder: string[] = [];
    runCliUpdateCheckMock.mockImplementation(() => {
      callOrder.push("cliUpdate");
      return { status: "continue" };
    });

    const result = await runCommandEntryFlow(createContext("whoami"));

    expect(result).toEqual({ status: "continue" });
    expect(callOrder).toEqual(["cliUpdate"]);
    expect(runDisclaimerCheckMock).toHaveBeenCalled();
    expect(runLocalRuntimeStateCheckMock).not.toHaveBeenCalled();
    expect(runSignInCheckMock).not.toHaveBeenCalled();
    expect(runSelectedProfileCheckMock).not.toHaveBeenCalled();
    expect(runServiceCheckMock).not.toHaveBeenCalled();
  });

  it("skips all checks for auth login", async () => {
    const result = await runCommandEntryFlow(createContext("auth.login"));

    expect(result).toEqual({ status: "continue" });
    expect(runDisclaimerCheckMock).toHaveBeenCalled();
    expect(runCliUpdateCheckMock).not.toHaveBeenCalled();
    expect(runSignInCheckMock).not.toHaveBeenCalled();
    expect(runSelectedProfileCheckMock).not.toHaveBeenCalled();
    expect(runServiceCheckMock).not.toHaveBeenCalled();
    expect(runSkillsCheckMock).not.toHaveBeenCalled();
  });

  it("runs service run without the selected profile check", async () => {
    const callOrder: string[] = [];
    runCliUpdateCheckMock.mockImplementation(() => {
      callOrder.push("cliUpdate");
      return { status: "continue" };
    });
    runDisclaimerCheckMock.mockImplementation(() => {
      callOrder.push("disclaimer");
      return { status: "continue" };
    });
    runLocalRuntimeStateCheckMock.mockImplementation(() => {
      callOrder.push("localRuntimeState");
      return { status: "continue" };
    });
    runSignInCheckMock.mockImplementation(() => {
      callOrder.push("signIn");
      return { status: "continue" };
    });

    const result = await runCommandEntryFlow(createContext("service.run"));

    expect(result).toEqual({ status: "continue" });
    expect(callOrder).toEqual([
      "disclaimer",
      "cliUpdate",
      "localRuntimeState",
      "signIn",
    ]);
    expect(runSelectedProfileCheckMock).not.toHaveBeenCalled();
    expect(runServiceCheckMock).not.toHaveBeenCalled();
  });
});

function createContext(entryName: CommandEntryName): CommandEntryContext {
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
