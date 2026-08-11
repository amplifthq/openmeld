import { describe, expect, it, vi } from "vitest";
import {
  createDesktopHandlers,
  type DesktopCommandSet,
} from "../src/main/ipc-handlers";
import type { CliCommandResult } from "../src/shared/types";
import { LOCAL_AGENTS_GUIDE_PATH } from "../src/shared/web-paths";

function success(
  type: string,
  data: Record<string, unknown>
): CliCommandResult {
  return {
    ok: true,
    type,
    data,
    exitCode: 0,
  };
}

function failure(code: string, message: string): CliCommandResult {
  return {
    ok: false,
    kind: "cli_error",
    error: { code, message },
    exitCode: 1,
    rawStdout: "",
  };
}

function serviceStatus(status: string, enabled = true): CliCommandResult {
  return success("daemon.status", {
    localResult: {
      serviceManagerStatus: {
        installed: true,
        running: status === "running",
        enabled,
      },
    },
    result: {
      installed: true,
      runtime: { status },
    },
    runtimeProjection: { status: "ok" },
  });
}

function detectAgents(): CliCommandResult {
  return success("agents.detect", {
    detectedAgents: [
      {
        id: "codex",
        displayName: "Codex",
        selectable: true,
        blockerReasonCodes: [],
        launchStatus: "available",
      },
    ],
    count: 1,
  });
}

function listAgents(enabled: boolean): CliCommandResult {
  return success("agents.list", {
    registrations: [
      {
        agentId: "codex",
        displayName: "Codex",
        enabled,
      },
    ],
    count: 1,
  });
}

function showAgent(): CliCommandResult {
  return success("agents.show", {
    agent: {
      agentId: "codex",
      displayName: "Codex",
    },
    agentControllerInterface: {
      agentControllerRef: "builtin:codex",
      auth: {
        email: "felix@example.com",
        label: "OpenAI",
        status: "authenticated",
        type: "chatgpt",
      },
      capabilities: {
        approvals: true,
        cancel: true,
        interrupt: false,
        modelSelection: true,
        nativeEventStream: true,
        permissionModes: true,
        structuredUserInput: false,
      },
      checkedAt: "2026-06-28T12:00:00.000Z",
      controllerId: "codex",
      displayName: "Codex",
      launch: {
        argsPrefix: [],
        commandPath: "/opt/homebrew/bin/codex",
        installChoiceCount: 1,
        status: "ready",
      },
      message: null,
      models: [{ displayName: "GPT-5.5", id: "gpt-5.5" }],
      nativeInterface: "codex-app-server",
      schemaVersion: 1,
      skills: [],
      status: "ready",
      version: "0.38.0",
    },
    installChoices: [],
    launchStatus: "available",
    launchStatusDetail: null,
    effectiveConfig: {},
  });
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function makeCommands(
  overrides: Partial<DesktopCommandSet> = {}
): DesktopCommandSet {
  return {
    serviceStatus: vi.fn(() => Promise.resolve(serviceStatus("running"))),
    installService: vi.fn(() => Promise.resolve(success("daemon.install", {}))),
    installCli: vi.fn(() =>
      Promise.resolve(success("desktop.openmeld_cli_install", {}))
    ),
    startService: vi.fn(() => Promise.resolve(success("daemon.start", {}))),
    stopService: vi.fn(() => Promise.resolve(success("daemon.stop", {}))),
    upgradeCli: vi.fn(() => Promise.resolve(success("upgrade.completed", {}))),
    enableServiceAutoStart: vi.fn(() =>
      Promise.resolve(success("daemon.autostart", {}))
    ),
    disableServiceAutoStart: vi.fn(() =>
      Promise.resolve(success("daemon.autostart", {}))
    ),
    cliVersionStatus: vi.fn(() =>
      Promise.resolve({
        checked: true,
        currentVersion: "0.7.78",
        latestVersion: "0.7.81",
        requiredVersion: "0.7.80",
        updateAvailable: true,
      })
    ),
    detectAgents: vi.fn(() => Promise.resolve(detectAgents())),
    listAgents: vi.fn(() => Promise.resolve(listAgents(false))),
    showAgent: vi.fn(() => Promise.resolve(showAgent())),
    enableAgents: vi.fn(() => Promise.resolve(success("agents.enable", {}))),
    disableAgents: vi.fn(() => Promise.resolve(success("agents.disable", {}))),
    ...overrides,
  };
}

describe("createDesktopHandlers", () => {
  it("returns the current service view from the service status projection", async () => {
    const commands = makeCommands({
      serviceStatus: vi.fn(async () => serviceStatus("not_running")),
    });
    const handlers = createDesktopHandlers({ commands });

    await expect(handlers.getServiceStatus()).resolves.toMatchObject({
      lifecycle: "stopped",
      installed: true,
      running: false,
      problem: null,
    });
  });

  it("backfills CLI version when service status uses the older status contract", async () => {
    const cliVersionStatus = vi.fn(async () => ({
      checked: true,
      currentVersion: "0.7.78",
      latestVersion: "0.7.81",
      requiredVersion: "0.7.80",
      updateAvailable: true,
    }));
    const commands = makeCommands({ cliVersionStatus });
    const handlers = createDesktopHandlers({ commands });

    await expect(handlers.getServiceStatus()).resolves.toMatchObject({
      cliVersion: {
        checked: true,
        currentVersion: "0.7.78",
        latestVersion: "0.7.81",
        requiredVersion: "0.7.80",
        updateAvailable: true,
      },
    });
    expect(cliVersionStatus).toHaveBeenCalledTimes(1);
  });

  it("re-reads service status after installing the service", async () => {
    const calls: string[] = [];
    const commands = makeCommands({
      installService: vi.fn(() => {
        calls.push("install");
        return Promise.resolve(success("daemon.install", {}));
      }),
      serviceStatus: vi.fn(() => {
        calls.push("status");
        return Promise.resolve(serviceStatus("running"));
      }),
    });
    const handlers = createDesktopHandlers({ commands });

    await expect(handlers.installService()).resolves.toMatchObject({
      lifecycle: "running",
      problem: null,
    });
    expect(calls).toEqual(["install", "status"]);
  });

  it("re-reads service status after installing OpenMeld CLI", async () => {
    const calls: string[] = [];
    const commands = makeCommands({
      installCli: vi.fn(() => {
        calls.push("install-cli");
        return Promise.resolve(success("desktop.openmeld_cli_install", {}));
      }),
      serviceStatus: vi.fn(() => {
        calls.push("status");
        return Promise.resolve(serviceStatus("running"));
      }),
    });
    const handlers = createDesktopHandlers({ commands });

    await expect(handlers.installCli()).resolves.toMatchObject({
      lifecycle: "running",
      problem: null,
    });
    expect(calls).toEqual(["install-cli", "status"]);
  });

  it("runs setup reconcile and re-reads service status after updating OpenMeld Service", async () => {
    const calls: string[] = [];
    const commands = makeCommands({
      serviceStatus: vi.fn(() => {
        calls.push("status");
        return Promise.resolve(serviceStatus("running"));
      }),
    });
    const runSetup = vi.fn(() => {
      calls.push("setup");
      return Promise.resolve({
        completed: true,
        problem: null,
        serviceGuidance: null,
      });
    });
    const handlers = createDesktopHandlers({ commands, setup: { runSetup } });

    await expect(handlers.updateService()).resolves.toMatchObject({
      lifecycle: "running",
      problem: null,
    });
    expect(calls).toEqual(["setup", "status"]);
  });

  it("re-reads service status after updating OpenMeld CLI", async () => {
    const calls: string[] = [];
    const commands = makeCommands({
      upgradeCli: vi.fn(() => {
        calls.push("update-cli");
        return Promise.resolve(success("upgrade.completed", {}));
      }),
      serviceStatus: vi.fn(() => {
        calls.push("status");
        return Promise.resolve(serviceStatus("running"));
      }),
    });
    const handlers = createDesktopHandlers({ commands });

    await expect(handlers.upgradeCli()).resolves.toMatchObject({
      lifecycle: "running",
      problem: null,
    });
    expect(calls).toEqual(["update-cli", "status"]);
  });

  it("re-reads service status after setting up this computer", async () => {
    const calls: string[] = [];
    const commands = makeCommands({
      serviceStatus: vi.fn(() => {
        calls.push("status");
        return Promise.resolve(serviceStatus("running"));
      }),
    });
    const runSetup = vi.fn(() => {
      calls.push("setup");
      return Promise.resolve({
        completed: true,
        problem: null,
        serviceGuidance: {
          autoStartDescription:
            "OpenMeld Service is set to start automatically when you sign in.",
          disableAutoStartCommand: "openmeld service autostart disable",
          statusDescription: "OpenMeld Service is running in the background.",
          stopCommand: "openmeld service stop",
          stoppedLocalAgentsDescription:
            "Local agents cannot be activated until OpenMeld Service starts again.",
        },
      });
    });
    const handlers = createDesktopHandlers({ commands, setup: { runSetup } });

    await expect(handlers.setupComputer()).resolves.toMatchObject({
      lifecycle: "running",
      problem: null,
      setupGuidance: {
        disableAutoStartCommand: "openmeld service autostart disable",
        stopCommand: "openmeld service stop",
      },
    });
    expect(calls).toEqual(["setup", "status"]);
  });

  it("re-reads service status after a failed service mutation and preserves the mutation problem", async () => {
    const commands = makeCommands({
      startService: vi.fn(async () =>
        failure("daemon.start_failed", "Could not start the service")
      ),
      serviceStatus: vi.fn(async () => serviceStatus("not_running")),
    });
    const handlers = createDesktopHandlers({ commands });

    await expect(handlers.startService()).resolves.toMatchObject({
      lifecycle: "stopped",
      problem: {
        code: "daemon.start_failed",
        message: "Could not start the service",
      },
    });
    expect(commands.serviceStatus).toHaveBeenCalledTimes(1);
  });

  it("updates service autostart through the CLI writer and then re-reads service status", async () => {
    const calls: string[] = [];
    const commands = makeCommands({
      enableServiceAutoStart: vi.fn(() => {
        calls.push("enable-autostart");
        return Promise.resolve(success("daemon.autostart", {}));
      }),
      serviceStatus: vi.fn(() => {
        calls.push("status");
        return Promise.resolve(serviceStatus("running", true));
      }),
    });
    const handlers = createDesktopHandlers({ commands });

    await expect(handlers.setServiceAutoStart(true)).resolves.toMatchObject({
      service: {
        autoStart: true,
        lifecycle: "running",
        problem: null,
      },
      problem: null,
    });
    expect(calls).toEqual(["enable-autostart", "status"]);
    expect(commands.disableServiceAutoStart).not.toHaveBeenCalled();
  });

  it("runs local sign-out and then re-reads auth status and service status", async () => {
    const calls: string[] = [];
    const commands = makeCommands({
      serviceStatus: vi.fn(() => {
        calls.push("service-status");
        return Promise.resolve(serviceStatus("not_running"));
      }),
    });
    const readAuthStatus = vi.fn(() => {
      calls.push("auth-status");
      return Promise.resolve({
        email: null,
        problem: null,
        signedIn: false,
      });
    });
    const runSignOut = vi.fn(() => {
      calls.push("logout");
      return Promise.resolve({
        cleanup: {
          message: "Local sign-out cleanup finished for your local OpenMeld.",
          status: "finished" as const,
        },
        localSession: "cleared" as const,
        problem: null,
      });
    });
    const handlers = createDesktopHandlers({
      auth: {
        readAuthStatus,
        runSignIn: vi.fn(),
        runSignOut,
      },
      commands,
    });

    await expect(handlers.signOutOnThisMac()).resolves.toMatchObject({
      auth: { signedIn: false },
      logout: { localSession: "cleared" },
      service: { lifecycle: "stopped" },
    });
    expect(calls).toEqual(["logout", "auth-status", "service-status"]);
  });

  it("uses the disable autostart writer when disabling service autostart", async () => {
    const commands = makeCommands({
      serviceStatus: vi.fn(async () => serviceStatus("running", false)),
    });
    const handlers = createDesktopHandlers({ commands });

    await expect(handlers.setServiceAutoStart(false)).resolves.toMatchObject({
      service: { autoStart: false },
      problem: null,
    });

    expect(commands.disableServiceAutoStart).toHaveBeenCalledWith(undefined);
    expect(commands.enableServiceAutoStart).not.toHaveBeenCalled();
  });

  it("keeps service autostart write failures separate from service status problems", async () => {
    const commands = makeCommands({
      disableServiceAutoStart: vi.fn(async () =>
        failure(
          "cli.error",
          "missing command entry mapping for route: service autostart disable"
        )
      ),
      serviceStatus: vi.fn(async () => serviceStatus("running", true)),
    });
    const handlers = createDesktopHandlers({ commands });

    await expect(handlers.setServiceAutoStart(false)).resolves.toMatchObject({
      service: {
        lifecycle: "running",
        problem: null,
      },
      problem: {
        code: "cli.error",
        message:
          "missing command entry mapping for route: service autostart disable",
      },
    });
  });

  it("serializes service mutations so later actions wait for the earlier reread", async () => {
    const started = deferred<CliCommandResult>();
    const calls: string[] = [];
    const commands = makeCommands({
      startService: vi.fn(() => {
        calls.push("start");
        return started.promise;
      }),
      stopService: vi.fn(() => {
        calls.push("stop");
        return Promise.resolve(success("daemon.stop", {}));
      }),
      serviceStatus: vi.fn(() => {
        calls.push("status");
        return Promise.resolve(serviceStatus("running"));
      }),
    });
    const handlers = createDesktopHandlers({ commands });

    const start = handlers.startService();
    const stop = handlers.stopService();

    await Promise.resolve();
    expect(calls).toEqual(["start"]);

    started.resolve(success("daemon.start", {}));
    await Promise.all([start, stop]);

    expect(calls).toEqual(["start", "status", "stop", "status"]);
  });

  it("reads detect and list projections for the agent view", async () => {
    const commands = makeCommands({
      listAgents: vi.fn(async () => listAgents(true)),
    });
    const handlers = createDesktopHandlers({ commands });

    await expect(handlers.getAgents()).resolves.toMatchObject({
      agents: [{ id: "codex", enabled: true }],
      problem: null,
    });
    expect(commands.detectAgents).toHaveBeenCalledTimes(1);
    expect(commands.listAgents).toHaveBeenCalledTimes(1);
    expect(commands.showAgent).toHaveBeenCalledWith("codex", undefined);
  });

  it("includes local agent controller details from show", async () => {
    const commands = makeCommands({
      listAgents: vi.fn(async () => listAgents(true)),
      showAgent: vi.fn(async () => showAgent()),
    });
    const handlers = createDesktopHandlers({ commands });

    await expect(handlers.getAgents()).resolves.toMatchObject({
      agents: [
        {
          id: "codex",
          agentControllerInterface: {
            agentControllerRef: "builtin:codex",
            nativeInterface: "codex-app-server",
            models: [{ id: "gpt-5.5", displayName: "GPT-5.5" }],
          },
        },
      ],
      problem: null,
    });
  });

  it("keeps detect/list usable when show cannot read details", async () => {
    const commands = makeCommands({
      listAgents: vi.fn(async () => listAgents(true)),
      showAgent: vi.fn(async () =>
        failure("agents.not_registered", "agent is not registered: codex")
      ),
    });
    const handlers = createDesktopHandlers({ commands });

    await expect(handlers.getAgents()).resolves.toMatchObject({
      agents: [{ id: "codex", enabled: true, agentControllerInterface: null }],
      problem: null,
    });
  });

  it("updates an agent through the CLI writer and then re-reads detect and list", async () => {
    const calls: string[] = [];
    const commands = makeCommands({
      enableAgents: vi.fn((input) => {
        calls.push(`enable:${input.agentIds.join(",")}`);
        return Promise.resolve(success("agents.enable", {}));
      }),
      detectAgents: vi.fn(() => {
        calls.push("detect");
        return Promise.resolve(detectAgents());
      }),
      listAgents: vi.fn(() => {
        calls.push("list");
        return Promise.resolve(listAgents(true));
      }),
      showAgent: vi.fn((agentId) => {
        calls.push(`show:${agentId}`);
        return Promise.resolve(showAgent());
      }),
    });
    const handlers = createDesktopHandlers({ commands });

    await expect(
      handlers.setAgentEnabled("codex", true)
    ).resolves.toMatchObject({
      agents: [{ id: "codex", enabled: true }],
      problem: null,
    });
    expect(calls).toEqual(["enable:codex", "detect", "list", "show:codex"]);
  });

  it("uses the disable writer for disabling an agent", async () => {
    const commands = makeCommands();
    const handlers = createDesktopHandlers({ commands });

    await handlers.setAgentEnabled("codex", false);

    expect(commands.disableAgents).toHaveBeenCalledWith(
      { agentIds: ["codex"] },
      undefined
    );
    expect(commands.enableAgents).not.toHaveBeenCalled();
  });

  it("opens OpenMeld Web through the injected external opener", async () => {
    const openExternal = vi.fn(async () => undefined);
    const handlers = createDesktopHandlers({
      commands: makeCommands(),
      openExternal,
    });

    await handlers.openWeb();

    expect(openExternal).toHaveBeenCalledWith("https://openmeld.ai");
  });

  it("opens the local agent install guide through the injected external opener", async () => {
    const openExternal = vi.fn(async () => undefined);
    const handlers = createDesktopHandlers({
      commands: makeCommands(),
      openExternal,
    });

    await handlers.openWeb(LOCAL_AGENTS_GUIDE_PATH);

    expect(openExternal).toHaveBeenCalledWith(
      "https://openmeld.ai/guides/local-agents"
    );
  });

  it("opens the local Web app for the dev-local Desktop lane", async () => {
    const openExternal = vi.fn(async () => undefined);
    const handlers = createDesktopHandlers({
      commandDeps: { env: { OPENMELD_ENV_PRESET: "dev-local" } },
      commands: makeCommands(),
      openExternal,
    });

    await handlers.openWeb();

    expect(openExternal).toHaveBeenCalledWith("http://localhost:3000");
  });

  it("opens the local Web app for the canary Desktop lane", async () => {
    const openExternal = vi.fn(async () => undefined);
    const handlers = createDesktopHandlers({
      commandDeps: { env: { OPENMELD_ENV_PRESET: "canary" } },
      commands: makeCommands(),
      openExternal,
    });

    await handlers.openWeb();

    expect(openExternal).toHaveBeenCalledWith("http://localhost:3000");
  });

  it("opens the Node.js download page through the injected external opener", async () => {
    const openExternal = vi.fn(async () => undefined);
    const handlers = createDesktopHandlers({
      commands: makeCommands(),
      openExternal,
    });

    await handlers.openNodeDownloadPage();

    expect(openExternal).toHaveBeenCalledWith("https://nodejs.org/en/download");
  });

  it("honors WEB_APP_URL when opening OpenMeld Web", async () => {
    const openExternal = vi.fn(async () => undefined);
    const handlers = createDesktopHandlers({
      commandDeps: {
        env: {
          OPENMELD_ENV_PRESET: "dev-local",
          WEB_APP_URL: "http://127.0.0.1:3434",
        },
      },
      commands: makeCommands(),
      openExternal,
    });

    await handlers.openWeb();

    expect(openExternal).toHaveBeenCalledWith("http://127.0.0.1:3434");
  });

  it("honors WEB_APP_URL when opening a Web app path", async () => {
    const openExternal = vi.fn(async () => undefined);
    const handlers = createDesktopHandlers({
      commandDeps: {
        env: {
          OPENMELD_ENV_PRESET: "dev-local",
          WEB_APP_URL: "http://127.0.0.1:3434",
        },
      },
      commands: makeCommands(),
      openExternal,
    });

    await handlers.openWeb(LOCAL_AGENTS_GUIDE_PATH);

    expect(openExternal).toHaveBeenCalledWith(
      "http://127.0.0.1:3434/guides/local-agents"
    );
  });

  it("fails closed when WEB_APP_URL is not an HTTP URL", async () => {
    const openExternal = vi.fn(async () => undefined);
    const handlers = createDesktopHandlers({
      commandDeps: {
        env: {
          OPENMELD_ENV_PRESET: "dev-local",
          WEB_APP_URL: "file:///tmp/openmeld.html",
        },
      },
      commands: makeCommands(),
      openExternal,
    });

    await expect(handlers.openWeb()).rejects.toThrow(
      "WEB_APP_URL must use http or https."
    );
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("reads and updates the Desktop open-at-login setting through the injected adapter", async () => {
    let openAtLogin = false;
    const desktopSettings = {
      getOpenAtLogin: vi.fn(() => openAtLogin),
      setOpenAtLogin: vi.fn((enabled: boolean) => {
        openAtLogin = enabled;
      }),
    };
    const handlers = createDesktopHandlers({
      commands: makeCommands(),
      desktopSettings,
    });

    await expect(handlers.getDesktopSettings()).resolves.toEqual({
      openAtLogin: false,
      problem: null,
    });
    await expect(handlers.setOpenAtLogin(true)).resolves.toEqual({
      openAtLogin: true,
      problem: null,
    });

    expect(desktopSettings.setOpenAtLogin).toHaveBeenCalledWith(true);
  });

  it("returns a read-failed Desktop settings problem when login item settings cannot be read", async () => {
    const handlers = createDesktopHandlers({
      commands: makeCommands(),
      desktopSettings: {
        getOpenAtLogin: vi.fn(() => {
          throw new Error("Electron could not read login item settings.");
        }),
        setOpenAtLogin: vi.fn(),
      },
    });

    await expect(handlers.getDesktopSettings()).resolves.toEqual({
      openAtLogin: null,
      problem: {
        code: "desktop_settings.read_failed",
        message: "Electron could not read login item settings.",
      },
    });
  });

  it("returns an update-failed Desktop settings problem when login item settings cannot be changed", async () => {
    const handlers = createDesktopHandlers({
      commands: makeCommands(),
      desktopSettings: {
        getOpenAtLogin: vi.fn(() => false),
        setOpenAtLogin: vi.fn(() => {
          throw new Error("Electron could not update login item settings.");
        }),
      },
    });

    await expect(handlers.setOpenAtLogin(true)).resolves.toEqual({
      openAtLogin: null,
      problem: {
        code: "desktop_settings.update_failed",
        message: "Electron could not update login item settings.",
      },
    });
  });

  it("returns an explicit unavailable Desktop settings view when no adapter is wired", async () => {
    const handlers = createDesktopHandlers({ commands: makeCommands() });

    await expect(handlers.getDesktopSettings()).resolves.toMatchObject({
      openAtLogin: null,
      problem: { code: "desktop_settings.unavailable" },
    });
  });

  it("reads Desktop update status through the injected Desktop update adapter", async () => {
    const desktopUpdate = {
      getStatus: vi.fn(async () => ({
        status: "available" as const,
        checked: true,
        currentVersion: "0.1.0-preview.0",
        latestVersion: "0.1.1-preview.0",
        minimumSupportedVersion: "0.1.0-preview.0",
        downloadPageUrl: "https://openmeld.invalid/desktop",
        message: null,
        macosArm64: null,
        problem: null,
      })),
      openDownloadPage: vi.fn(async () => undefined),
    };
    const handlers = createDesktopHandlers({
      commands: makeCommands(),
      desktopUpdate,
    });

    await expect(handlers.getDesktopUpdateStatus()).resolves.toMatchObject({
      status: "available",
      latestVersion: "0.1.1-preview.0",
    });
    await handlers.openDesktopDownloadPage();

    expect(desktopUpdate.getStatus).toHaveBeenCalledTimes(1);
    expect(desktopUpdate.openDownloadPage).toHaveBeenCalledTimes(1);
  });
});
