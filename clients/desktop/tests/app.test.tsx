import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/renderer/app";
import type {
  DesktopWindowDestination,
  OpenMeldBridge,
} from "../src/shared/ipc-contract";
import type {
  AgentsView,
  AuthView,
  CliProblem,
  DesktopSettingsView,
  DesktopUpdateView,
  ServiceAutoStartUpdateView,
  ServiceLifecycle,
  ServiceView,
} from "../src/shared/view-types";
import { LOCAL_AGENTS_GUIDE_PATH } from "../src/shared/web-paths";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const ENABLE_CODEX = /Enable Codex/i;
const DISABLE_CODEX = /Disable Codex/i;
const DESKTOP_UPDATE_VERSION_LINE = /Current v0\.1\.0-preview\.0/;
const GENERAL_RUNNING_STATUS_COPY = /Current status: Running\./;
const INTERNAL_LANE_COPY = /lane/i;
const NOT_CHECKED_COPY = /not checked/i;
const SIGNED_IN_ACCOUNT = /Signed in ·/i;

function svc(
  lifecycle: ServiceLifecycle,
  autoStart: boolean | null = lifecycle === "running" || lifecycle === "stopped"
    ? true
    : null
): ServiceView {
  const installed = resolveInstalledFixtureState(lifecycle);
  const running = resolveRunningFixtureState(lifecycle);

  return {
    lifecycle,
    installed,
    running,
    autoStart,
    cliVersion: {
      checked: true,
      currentVersion: "1.2.3",
      latestVersion: "1.2.4",
      requiredVersion: null,
      updateAvailable: true,
    },
    runtimeProjection: null,
    problem: null,
  };
}

function resolveInstalledFixtureState(
  lifecycle: ServiceLifecycle
): boolean | null {
  if (lifecycle === "not_installed") {
    return false;
  }
  if (lifecycle === "unknown") {
    return null;
  }
  return true;
}

function resolveRunningFixtureState(
  lifecycle: ServiceLifecycle
): boolean | null {
  if (lifecycle === "running") {
    return true;
  }
  if (lifecycle === "stopped" || lifecycle === "not_installed") {
    return false;
  }
  return null;
}

function authView(signedIn: boolean | null): AuthView {
  return {
    signedIn,
    email: signedIn ? "felix@openmeld.invalid" : null,
    problem: null,
  };
}

function agents(enabled: boolean): AgentsView {
  return {
    agents: [
      {
        id: "codex",
        displayName: "Codex",
        detected: true,
        lifecycleStatus: "active",
        selectable: true,
        enabled,
        blockerReasonCodes: [],
        launchStatus: null,
        agentControllerInterface: null,
      },
    ],
    problem: null,
  };
}

function zeroAgents(): AgentsView {
  return {
    agents: [],
    problem: null,
  };
}

function agentsWithControllerDetails(): AgentsView {
  return {
    agents: [
      {
        id: "codex",
        displayName: "Codex",
        detected: true,
        lifecycleStatus: "active",
        selectable: true,
        enabled: true,
        blockerReasonCodes: [],
        launchStatus: "ready",
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
      },
    ],
    problem: null,
  };
}

function desktopSettings(openAtLogin = false): DesktopSettingsView {
  return {
    openAtLogin,
    problem: null,
  };
}

function desktopUpdate(
  status: DesktopUpdateView["status"] = "idle"
): DesktopUpdateView {
  return {
    status,
    checked: true,
    currentVersion: "0.1.0-preview.0",
    latestVersion: status === "idle" ? "0.1.0-preview.0" : "0.1.1-preview.0",
    minimumSupportedVersion:
      status === "required" ? "0.1.1-preview.0" : "0.1.0-preview.0",
    downloadPageUrl: "https://openmeld.invalid/desktop",
    message: null,
    macosArm64: null,
    problem: null,
  };
}

function cliProblem(message: string, code = "cli.error"): CliProblem {
  return {
    kind: "cli_error",
    code,
    message,
    requestId: null,
  };
}

function serviceAutoStartUpdate(
  service: ServiceView,
  problem: CliProblem | null = null
): ServiceAutoStartUpdateView {
  return { service, problem };
}

function setupGuidance() {
  return {
    autoStartDescription:
      "OpenMeld Service is set to start automatically when you sign in.",
    disableAutoStartCommand: "openmeld service autostart disable",
    statusDescription: "OpenMeld Service is running in the background.",
    stopCommand: "openmeld service stop",
    stoppedLocalAgentsDescription:
      "Local agents cannot be activated until OpenMeld Service starts again.",
  };
}

function signOutView(service: ServiceView = svc("stopped")) {
  return {
    auth: authView(false),
    service,
    logout: {
      localSession: "cleared" as const,
      cleanup: {
        status: "finished" as const,
        message: "Local sign-out cleanup finished for your local OpenMeld.",
      },
      problem: null,
    },
  };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function makeBridge(overrides: Partial<OpenMeldBridge> = {}): OpenMeldBridge {
  return {
    getAuthStatus: () => Promise.resolve(authView(true)),
    signIn: () => Promise.resolve(authView(true)),
    signOutOnThisMac: () => Promise.resolve(signOutView()),
    getServiceStatus: () => Promise.resolve(svc("running")),
    installCli: () => Promise.resolve(svc("running")),
    setupComputer: () => Promise.resolve(svc("running")),
    installService: () => Promise.resolve(svc("running")),
    updateService: () => Promise.resolve(svc("running")),
    startService: () => Promise.resolve(svc("running")),
    stopService: () => Promise.resolve(svc("stopped")),
    updateCli: () => Promise.resolve(svc("running")),
    setServiceAutoStart: () =>
      Promise.resolve(serviceAutoStartUpdate(svc("running", true))),
    getAgents: () => Promise.resolve(agents(false)),
    setAgentEnabled: () => Promise.resolve(agents(true)),
    openWeb: () => Promise.resolve(),
    getDesktopSettings: () => Promise.resolve(desktopSettings(false)),
    setOpenAtLogin: () => Promise.resolve(desktopSettings(true)),
    getDesktopUpdateStatus: () => Promise.resolve(desktopUpdate()),
    openDesktopDownloadPage: () => Promise.resolve(),
    openNodeDownloadPage: () => Promise.resolve(),
    enterApp: () => Promise.resolve(),
    quitDesktop: () => Promise.resolve(),
    onWindowDestinationChange: () => () => undefined,
    ...overrides,
  };
}

describe("App", () => {
  it("shows a manual home entry on the splash screen", () => {
    render(<App bridge={makeBridge()} />);

    expect(screen.getByRole("button", { name: "Go Home" })).toBeTruthy();
  });

  it("enters Home through the splash button without double enterApp calls", async () => {
    vi.useFakeTimers();
    const enterApp = vi.fn(() => Promise.resolve());
    render(<App bridge={makeBridge({ enterApp })} />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => {
      vi.advanceTimersByTime(1500);
    });

    fireEvent.click(screen.getByRole("button", { name: "Go Home" }));

    expect(screen.getByRole("button", { name: "Home" })).toBeTruthy();
    expect(enterApp).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(enterApp).toHaveBeenCalledTimes(1);
  });

  it("opens Settings when the main process requests the Settings destination", async () => {
    let navigate: ((destination: DesktopWindowDestination) => void) | null =
      null;
    const enterApp = vi.fn(() => Promise.resolve());
    const unsubscribe = vi.fn();
    const onWindowDestinationChange = vi.fn((handler) => {
      navigate = handler;
      return unsubscribe;
    });

    render(
      <App bridge={makeBridge({ enterApp, onWindowDestinationChange })} />
    );

    await waitFor(() =>
      expect(onWindowDestinationChange).toHaveBeenCalledTimes(1)
    );

    act(() => {
      navigate?.("settings");
    });

    expect(enterApp).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByRole("heading", { name: "Desktop app" })
    ).toBeTruthy();
  });

  it("lands on the connected dashboard for a signed-in, running machine", async () => {
    render(<App bridge={makeBridge()} skipSplash />);
    expect(
      await screen.findByRole("heading", { name: "Hello, Felix" })
    ).toBeTruthy();
    expect(screen.queryByText("Connected")).toBeNull();
    const serviceCard = screen.getByTestId("settings-computer-status-card");
    expect(within(serviceCard).getByText("This Mac")).toBeTruthy();
    expect(within(serviceCard).getByText("Running")).toBeTruthy();
    expect(within(serviceCard).getByText("OpenMeld CLI")).toBeTruthy();
    expect(
      within(serviceCard).getByText("Update available v1.2.4")
    ).toBeTruthy();
    expect(
      within(serviceCard).getByText("Start OpenMeld Service automatically")
    ).toBeTruthy();
    expect(
      within(serviceCard).getByRole("button", {
        name: "Start OpenMeld Service",
      })
    ).toHaveProperty("disabled", true);
    expect(
      within(serviceCard).getByRole("button", { name: "Stop OpenMeld Service" })
    ).toBeTruthy();
    expect(
      within(serviceCard).getByRole("button", {
        name: "Reconnect This Computer",
      })
    ).toBeTruthy();
    expect(
      within(serviceCard).getByRole("switch", {
        name: "Disable Start OpenMeld Service automatically",
      })
    ).toBeTruthy();

    const localAgentsPanel = screen.getByTestId("settings-local-agents-card");
    expect(within(localAgentsPanel).getByText("Local agents")).toBeTruthy();
    expect(screen.queryByText("1 local agent")).toBeNull();
    expect(screen.queryByText("0 enabled")).toBeNull();
    expect(
      within(localAgentsPanel).getByText("Codex", { selector: "p" })
    ).toBeTruthy();
    expect(
      within(localAgentsPanel).getByTestId("local-agent-logo-codex")
    ).toBeTruthy();
    expect(
      within(localAgentsPanel).getByText("Available to enable on this Mac.")
    ).toBeTruthy();
    expect(within(localAgentsPanel).getByText("Off")).toBeTruthy();
    expect(
      within(localAgentsPanel).getByRole("switch", { name: ENABLE_CODEX })
    ).toBeTruthy();
  });

  it("expands local agent controller details in the Desktop agents card", async () => {
    render(
      <App
        bridge={makeBridge({
          getAgents: () => Promise.resolve(agentsWithControllerDetails()),
        })}
        skipSplash
      />
    );

    const localAgentsPanel = await screen.findByTestId(
      "settings-local-agents-card"
    );
    expect(
      within(localAgentsPanel).getByText(
        "Authenticated · felix@example.com · v0.38.0"
      )
    ).toBeTruthy();

    fireEvent.click(
      within(localAgentsPanel).getByRole("button", { name: "Codex details" })
    );

    expect(within(localAgentsPanel).getByText("Codex App Server")).toBeTruthy();
    expect(within(localAgentsPanel).getByText("GPT-5.5")).toBeTruthy();
    expect(
      within(localAgentsPanel).getByText(
        "Approvals, Cancel, Model selection, Native event stream, Permission modes"
      )
    ).toBeTruthy();
  });

  it("shows an OpenMeld Desktop update prompt that opens the download page", async () => {
    const openDesktopDownloadPage = vi.fn(() => Promise.resolve());
    render(
      <App
        bridge={makeBridge({
          getDesktopUpdateStatus: () =>
            Promise.resolve(desktopUpdate("available")),
          openDesktopDownloadPage,
        })}
        skipSplash
      />
    );

    expect(
      await screen.findByText("OpenMeld Desktop update available")
    ).toBeTruthy();
    expect(screen.getByText(DESKTOP_UPDATE_VERSION_LINE)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Download Update" }));

    expect(openDesktopDownloadPage).toHaveBeenCalledTimes(1);
  });

  it("toggles an agent from Home", async () => {
    const agentUpdate = deferred<AgentsView>();
    const setAgentEnabled = vi.fn(() => agentUpdate.promise);
    render(<App bridge={makeBridge({ setAgentEnabled })} skipSplash />);

    fireEvent.click(await screen.findByRole("switch", { name: ENABLE_CODEX }));

    expect(screen.getByRole("switch", { name: DISABLE_CODEX })).toBeTruthy();

    await waitFor(() =>
      expect(setAgentEnabled).toHaveBeenCalledWith("codex", true)
    );
    agentUpdate.resolve(agents(true));
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: DISABLE_CODEX })).toBeTruthy()
    );
  });

  it("toggles OpenMeld Service autostart from Home", async () => {
    const setServiceAutoStart = vi.fn(() =>
      Promise.resolve(serviceAutoStartUpdate(svc("running", true)))
    );
    render(
      <App
        bridge={makeBridge({
          getServiceStatus: () => Promise.resolve(svc("running", false)),
          setServiceAutoStart,
        })}
        skipSplash
      />
    );

    fireEvent.click(
      await screen.findByRole("switch", {
        name: "Enable Start OpenMeld Service automatically",
      })
    );

    await waitFor(() => expect(setServiceAutoStart).toHaveBeenCalledWith(true));
  });

  it("keeps live Desktop state refreshed while the Desktop app is visible", async () => {
    vi.useFakeTimers();
    const getAuthStatus = vi.fn(() => Promise.resolve(authView(true)));
    const getServiceStatus = vi
      .fn()
      .mockResolvedValueOnce(svc("running", false))
      .mockResolvedValue(svc("running", true));
    const getAgents = vi
      .fn()
      .mockResolvedValueOnce(agents(false))
      .mockResolvedValue(agents(true));
    const getDesktopSettings = vi
      .fn()
      .mockResolvedValueOnce(desktopSettings(false))
      .mockResolvedValue(desktopSettings(true));
    const getDesktopUpdateStatus = vi.fn(() =>
      Promise.resolve(desktopUpdate("idle"))
    );
    render(
      <App
        bridge={makeBridge({
          getAuthStatus,
          getServiceStatus,
          getAgents,
          getDesktopSettings,
          getDesktopUpdateStatus,
        })}
        skipSplash
      />
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(
      screen.getByRole("switch", {
        name: "Enable Start OpenMeld Service automatically",
      })
    ).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(getAuthStatus).toHaveBeenCalledTimes(2);
    expect(getServiceStatus).toHaveBeenCalledTimes(2);
    expect(getAgents).toHaveBeenCalledTimes(2);
    expect(getDesktopSettings).toHaveBeenCalledTimes(2);
    expect(getDesktopUpdateStatus).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("switch", {
        name: "Disable Start OpenMeld Service automatically",
      })
    ).toBeTruthy();
    expect(screen.getByRole("switch", { name: DISABLE_CODEX })).toBeTruthy();
  });

  it("refreshes the Desktop update prompt on the slower update cadence", async () => {
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(window, "setInterval");
    const getDesktopUpdateStatus = vi
      .fn()
      .mockResolvedValueOnce(desktopUpdate("idle"))
      .mockResolvedValue(desktopUpdate("available"));
    render(<App bridge={makeBridge({ getDesktopUpdateStatus })} skipSplash />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.queryByText("OpenMeld Desktop update available")).toBeNull();

    const liveStateRefresh = setIntervalSpy.mock.calls.find(
      (call) => call[1] === 30_000
    )?.[0];
    if (typeof liveStateRefresh !== "function") {
      throw new Error("Expected App to register its live-state refresh timer.");
    }
    const desktopUpdateRefresh = setIntervalSpy.mock.calls.find(
      (call) => call[1] === 15 * 60_000
    )?.[0];
    if (typeof desktopUpdateRefresh !== "function") {
      throw new Error(
        "Expected App to register its Desktop update refresh timer."
      );
    }
    expect(getDesktopUpdateStatus).toHaveBeenCalledTimes(1);

    await act(async () => {
      desktopUpdateRefresh();
      await Promise.resolve();
    });

    expect(getDesktopUpdateStatus).toHaveBeenCalledTimes(2);
    expect(screen.getByText("OpenMeld Desktop update available")).toBeTruthy();
  });

  it("confirms Stop OpenMeld Service from Home before calling the bridge", async () => {
    const stopService = vi.fn(() => Promise.resolve(svc("stopped")));
    render(<App bridge={makeBridge({ stopService })} skipSplash />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Stop OpenMeld Service" })
    );

    expect(stopService).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(
        "This stops OpenMeld Service on this Mac. This Mac cannot receive local Wake work until OpenMeld Service is started again."
      )
    ).toBeTruthy();

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Stop OpenMeld Service" })
    );

    await waitFor(() => expect(stopService).toHaveBeenCalledTimes(1));
  });

  it("places local-agent CLI update failures under OpenMeld CLI with a CTA", async () => {
    const updateCli = vi.fn(() => Promise.resolve(svc("running")));
    const longCliMessage =
      "A required OpenMeld CLI update is available. Update OpenMeld CLI from 0.7.78 to at least 0.7.80 before using OpenMeld CLI.";
    render(
      <App
        bridge={makeBridge({
          getAgents: () =>
            Promise.resolve({
              agents: [],
              problem: cliProblem(longCliMessage, "upgrade.required"),
            }),
          updateCli,
        })}
        skipSplash
      />
    );

    expect(
      await screen.findByText("OpenMeld CLI update required.")
    ).toBeTruthy();
    expect(screen.queryByText(longCliMessage)).toBeNull();
    expect(screen.getByText("Local agents could not refresh.")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Update OpenMeld CLI" })
    );

    expect(updateCli).toHaveBeenCalledTimes(1);
  });

  it("places service update attention under OpenMeld Service with a CTA", async () => {
    const updateService = vi.fn(() => Promise.resolve(svc("running")));
    render(
      <App
        bridge={makeBridge({
          getServiceStatus: () =>
            Promise.resolve({
              ...svc("running"),
              attention: {
                code: "service_update_available",
                level: "info",
                message: "A newer service bundle is available.",
                nextStep: "Update OpenMeld Service",
                anomalyCodes: ["bundle_content_drift"],
              },
            }),
          updateService,
        })}
        skipSplash
      />
    );

    expect(
      await screen.findByText("OpenMeld Service update available.")
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Update OpenMeld Service" })
    );

    expect(updateService).toHaveBeenCalledTimes(1);
  });

  it("treats required service update attention as required by code", async () => {
    const updateService = vi.fn(() => Promise.resolve(svc("running")));
    render(
      <App
        bridge={makeBridge({
          getServiceStatus: () =>
            Promise.resolve({
              ...svc("running"),
              attention: {
                code: "service_update_required",
                level: "info",
                message: "The local service must be updated.",
                nextStep: "Update OpenMeld Service",
                anomalyCodes: [],
              },
            }),
          updateService,
        })}
        skipSplash
      />
    );

    expect(
      await screen.findByText("OpenMeld Service update required.")
    ).toBeTruthy();
    expect(screen.queryByText("OpenMeld Service update available.")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Update OpenMeld Service" })
    );

    expect(updateService).toHaveBeenCalledTimes(1);
  });

  it("offers one-click CLI update from the needs-attention state", async () => {
    const updateCli = vi.fn(() => Promise.resolve(svc("running")));
    render(
      <App
        bridge={makeBridge({
          getServiceStatus: () =>
            Promise.resolve({
              ...svc("unknown"),
              problem: cliProblem("Update required", "upgrade.required"),
            }),
          updateCli,
        })}
        skipSplash
      />
    );

    expect(
      await screen.findByText("OpenMeld CLI update required.")
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Update OpenMeld CLI" })
    );

    expect(updateCli).toHaveBeenCalledTimes(1);
  });

  it("opens the Node.js download page when Node.js is missing", async () => {
    const openNodeDownloadPage = vi.fn(() => Promise.resolve());
    render(
      <App
        bridge={makeBridge({
          getServiceStatus: () =>
            Promise.resolve({
              ...svc("unknown"),
              problem: {
                kind: "spawn_failed",
                code: "desktop.node_missing",
                message:
                  "Node.js is required before OpenMeld Desktop can install OpenMeld CLI.",
                requestId: null,
              },
            }),
          openNodeDownloadPage,
        })}
        skipSplash
      />
    );

    expect(await screen.findByText("Node.js is required.")).toBeTruthy();
    expect(
      screen.getByText(
        "Install Node.js LTS, return to OpenMeld Desktop, then choose Try again. After Node.js and npm are available, OpenMeld Desktop will continue CLI and Service setup from this app."
      )
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Install Node.js LTS" })
    );

    expect(openNodeDownloadPage).toHaveBeenCalledTimes(1);
  });

  it("opens the Node.js download page when npm is missing", async () => {
    const openNodeDownloadPage = vi.fn(() => Promise.resolve());
    render(
      <App
        bridge={makeBridge({
          getServiceStatus: () =>
            Promise.resolve({
              ...svc("unknown"),
              problem: {
                kind: "spawn_failed",
                code: "desktop.npm_missing",
                message:
                  "npm is required before OpenMeld Desktop can install OpenMeld CLI.",
                requestId: null,
              },
            }),
          openNodeDownloadPage,
        })}
        skipSplash
      />
    );

    expect(await screen.findByText("npm is required.")).toBeTruthy();
    expect(
      screen.getByText(
        "npm is required for OpenMeld Desktop to install OpenMeld CLI. The current Node.js LTS installer includes npm; install it, return here, then choose Try again."
      )
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Install Node.js LTS" })
    );

    expect(openNodeDownloadPage).toHaveBeenCalledTimes(1);
  });

  it("offers OpenMeld CLI install when Node.js and npm are available", async () => {
    const installCli = vi.fn(() => Promise.resolve(svc("not_installed")));
    render(
      <App
        bridge={makeBridge({
          getServiceStatus: () =>
            Promise.resolve({
              ...svc("unknown"),
              problem: {
                kind: "spawn_failed",
                code: "desktop.openmeld_cli_missing",
                message:
                  "OpenMeld Desktop could not find OpenMeld CLI on this Mac.",
                requestId: null,
              },
            }),
          installCli,
        })}
        skipSplash
      />
    );

    expect(
      await screen.findByText("OpenMeld CLI is not installed.")
    ).toBeTruthy();
    expect(
      screen.getByText(
        "OpenMeld Desktop will install the official OpenMeld CLI for you with npm. You do not need to run Terminal commands; after the install finishes, continue setup from this app."
      )
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Install OpenMeld CLI" })
    );

    expect(installCli).toHaveBeenCalledTimes(1);
  });

  it("uses user-facing copy when the latest CLI version is unavailable", async () => {
    render(
      <App
        bridge={makeBridge({
          getServiceStatus: () =>
            Promise.resolve({
              ...svc("running"),
              cliVersion: {
                checked: false,
                currentVersion: "1.2.3",
                latestVersion: null,
                requiredVersion: null,
                updateAvailable: false,
              },
            }),
        })}
        skipSplash
      />
    );

    expect(
      await screen.findByRole("heading", { name: "Hello, Felix" })
    ).toBeTruthy();
    expect(screen.getByText("Current v1.2.3")).toBeTruthy();
    expect(screen.queryByText("Latest version unavailable")).toBeNull();
    expect(screen.queryByText(INTERNAL_LANE_COPY)).toBeNull();
    expect(screen.queryByText(NOT_CHECKED_COPY)).toBeNull();
  });

  it("enters the setup flow from Home and starts setup automatically", async () => {
    const setup = deferred<ServiceView>();
    const setupComputer = vi.fn(() => setup.promise);
    render(
      <App
        bridge={makeBridge({
          getServiceStatus: () => Promise.resolve(svc("not_installed")),
          setupComputer,
        })}
        skipSplash
      />
    );

    await screen.findByRole("heading", { name: "Hello, there" });
    const serviceCard = screen.getByTestId("settings-computer-status-card");
    expect(within(serviceCard).getByText("This Mac")).toBeTruthy();
    expect(within(serviceCard).getByText("Not installed")).toBeTruthy();
    expect(
      within(serviceCard).getByText(
        "OpenMeld Desktop will install or update OpenMeld CLI, prepare OpenMeld Service, and connect local agents from this app."
      )
    ).toBeTruthy();
    expect(
      within(screen.getByTestId("settings-local-agents-card")).getByText(
        "Local agents"
      )
    ).toBeTruthy();

    fireEvent.click(
      within(serviceCard).getByRole("button", { name: "Start Setup" })
    );

    await waitFor(() => expect(setupComputer).toHaveBeenCalledTimes(1));
    expect(within(serviceCard).getByText("Check requirements")).toBeTruthy();
    expect(within(serviceCard).getByText("Set up this Mac")).toBeTruthy();
    expect(within(serviceCard).getByText("Ready for Spaces")).toBeTruthy();
    expect(
      within(serviceCard).getByText(
        "Keep OpenMeld Desktop open while setup runs. No terminal commands are needed."
      )
    ).toBeTruthy();
    expect(
      within(serviceCard).queryByRole("button", {
        name: "Set Up This Computer",
      })
    ).toBeNull();

    await act(async () => {
      setup.resolve(svc("running"));
      await Promise.resolve();
    });
  });

  it("shows the start action when the service is stopped", async () => {
    const startService = vi.fn(() => Promise.resolve(svc("running")));
    render(
      <App
        bridge={makeBridge({
          getServiceStatus: () => Promise.resolve(svc("stopped")),
          startService,
        })}
        skipSplash
      />
    );
    const serviceCard = await screen.findByTestId(
      "settings-computer-status-card"
    );
    expect(within(serviceCard).getByText("This Mac")).toBeTruthy();
    expect(within(serviceCard).getByText("Stopped")).toBeTruthy();
    expect(
      within(screen.getByTestId("settings-local-agents-card")).getByText(
        "Local agents"
      )
    ).toBeTruthy();
    fireEvent.click(
      within(serviceCard).getByRole("button", {
        name: "Start OpenMeld Service",
      })
    );
    expect(startService).toHaveBeenCalledTimes(1);
  });

  it("routes to sign-in when signed out and wires Sign In", async () => {
    const signIn = vi.fn(() => Promise.resolve(authView(true)));
    render(
      <App
        bridge={makeBridge({
          getAuthStatus: () => Promise.resolve(authView(false)),
          signIn,
        })}
        skipSplash
      />
    );
    fireEvent.click(await screen.findByRole("button", { name: "Sign In" }));
    expect(signIn).toHaveBeenCalledTimes(1);
  });

  it("toggles an agent from Settings Computers", async () => {
    const setAgentEnabled = vi.fn(() => Promise.resolve(agents(true)));
    render(<App bridge={makeBridge({ setAgentEnabled })} skipSplash />);

    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    fireEvent.click(await screen.findByRole("button", { name: "Computers" }));
    fireEvent.click(await screen.findByRole("switch", { name: ENABLE_CODEX }));
    await waitFor(() =>
      expect(setAgentEnabled).toHaveBeenCalledWith("codex", true)
    );
  });

  it("opens the local agent install guide from the zero-agent empty state", async () => {
    const openWeb = vi.fn(() => Promise.resolve());
    render(
      <App
        bridge={makeBridge({
          getAgents: () => Promise.resolve(zeroAgents()),
          openWeb,
        })}
        skipSplash
      />
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "See the install guide" })
    );

    expect(openWeb).toHaveBeenCalledWith(LOCAL_AGENTS_GUIDE_PATH);
  });

  it("confirms before reconnecting from the Home actions menu", async () => {
    const setupComputer = vi.fn(() => Promise.resolve(svc("running")));
    render(<App bridge={makeBridge({ setupComputer })} skipSplash />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Home actions" })
    );
    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: "Reconnect Computer",
      })
    );

    expect(setupComputer).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Reconnect this computer?")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Reconnect" }));
    expect(setupComputer).toHaveBeenCalledTimes(1);
  });

  it("keeps the home dashboard as the default destination", async () => {
    render(<App bridge={makeBridge()} skipSplash />);

    expect(
      await screen.findByRole("heading", { name: "Hello, Felix" })
    ).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Settings" })
        .getAttribute("aria-current")
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Home" }).getAttribute("aria-current")
    ).toBe("page");
  });

  it("opens OpenMeld Web from the Home actions menu", async () => {
    const openWeb = vi.fn(() => Promise.resolve());
    render(<App bridge={makeBridge({ openWeb })} skipSplash />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Home actions" })
    );
    expect(
      (await screen.findByRole("menu")).classList.contains("no-drag")
    ).toBe(true);
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Open OpenMeld Web" })
    );

    expect(openWeb).toHaveBeenCalledTimes(1);
  });

  it("toggles the outer sidebar while keeping root destinations accessible", async () => {
    const { container } = render(<App bridge={makeBridge()} skipSplash />);

    await screen.findByRole("button", { name: "Home" });
    const rail = container.querySelector('[data-slot="app-frame-rail"]');
    expect(rail).toBeTruthy();
    if (!(rail instanceof HTMLElement)) {
      return;
    }
    expect(rail.getAttribute("data-state")).toBe("collapsed");
    expect(within(rail).queryByText("Home")).toBeNull();
    expect(within(rail).queryByText("Directory")).toBeNull();
    expect(within(rail).queryByText("Settings")).toBeNull();
    expect(within(rail).getByRole("button", { name: "Home" })).toBeTruthy();
    expect(
      within(rail).getByRole("button", { name: "Directory" })
    ).toBeTruthy();
    expect(within(rail).getByRole("button", { name: "Settings" })).toBeTruthy();

    fireEvent.click(
      within(rail).getByRole("button", { name: "Toggle Sidebar" })
    );

    expect(rail.getAttribute("data-state")).toBe("expanded");
    expect(within(rail).getByText("Home")).toBeTruthy();
    expect(within(rail).getByText("Directory")).toBeTruthy();
    expect(within(rail).getByText("Settings")).toBeTruthy();
    expect(within(rail).getByText("felix@openmeld.invalid")).toBeTruthy();
  });

  it("opens Desktop Settings on General, links to leaf pages, and toggles open-at-login", async () => {
    const setOpenAtLogin = vi.fn(() => Promise.resolve(desktopSettings(true)));
    render(<App bridge={makeBridge({ setOpenAtLogin })} skipSplash />);

    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));

    const serviceHeading = await screen.findByRole("heading", {
      name: "OpenMeld Service",
    });
    const desktopHeading = screen.getByRole("heading", {
      name: "Desktop app",
    });
    const accountHeading = screen.getByRole("heading", {
      name: "Account",
    });
    const appActionsHeading = screen.getByRole("heading", {
      name: "App actions",
    });
    const generalHeadings = screen
      .getAllByRole("heading")
      .map((heading) => heading.textContent);
    expect(
      screen.getByText(
        "OpenMeld Service lets Spaces members wake agents on this Mac."
      )
    ).toBeTruthy();
    expect(generalHeadings.indexOf(serviceHeading.textContent)).toBeLessThan(
      generalHeadings.indexOf(desktopHeading.textContent)
    );
    expect(generalHeadings.indexOf(accountHeading.textContent)).toBeLessThan(
      generalHeadings.indexOf(appActionsHeading.textContent)
    );
    expect(
      screen.queryByRole("heading", { name: "Current status" })
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Open Computers" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open Account" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Quit OpenMeld Desktop" })
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Sign out on this Mac" })
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Stop OpenMeld Service" })
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Reconnect This Computer" })
    ).toBeNull();
    expect(
      screen.queryByRole("switch", {
        name: "Disable Start OpenMeld Service automatically",
      })
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("switch", {
        name: "Enable Open OpenMeld Desktop at login",
      })
    );

    await waitFor(() => expect(setOpenAtLogin).toHaveBeenCalledWith(true));

    fireEvent.click(screen.getByRole("button", { name: "Open Computers" }));
    expect(
      await screen.findByRole("heading", { name: "Computers" })
    ).toBeTruthy();
    expect(
      screen.getByRole("switch", {
        name: "Disable Start OpenMeld Service automatically",
      })
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "General" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Open Account" })
    );
    expect(
      await screen.findByRole("heading", { name: "Profile" })
    ).toBeTruthy();
  });

  it("quits OpenMeld Desktop from General without a confirmation dialog", async () => {
    const quitDesktop = vi.fn(() => Promise.resolve());
    render(<App bridge={makeBridge({ quitDesktop })} skipSplash />);

    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Quit OpenMeld Desktop" })
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(quitDesktop).toHaveBeenCalledTimes(1);
  });

  it("confirms Sign out on this Mac from Account and uses reread auth and service state", async () => {
    const signOutOnThisMac = vi.fn(() =>
      Promise.resolve(signOutView(svc("stopped")))
    );
    render(<App bridge={makeBridge({ signOutOnThisMac })} skipSplash />);

    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    fireEvent.click(await screen.findByRole("button", { name: "Account" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Sign out on this Mac" })
    );

    expect(signOutOnThisMac).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(
        "Sign out applies only to OpenMeld on this Mac. It clears the local CLI session and profile selection. OpenMeld Web in your browser will stay signed in. OpenMeld Service may be stopped as part of local sign-out cleanup."
      )
    ).toBeTruthy();

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Sign out on this Mac" })
    );

    await waitFor(() => expect(signOutOnThisMac).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Not signed in on this Mac.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Computers" }));
    expect(await screen.findByText("Stopped")).toBeTruthy();
  });

  it("hides Sign out on this Mac on Account when the local account is signed out", async () => {
    render(
      <App
        bridge={makeBridge({
          getAuthStatus: () => Promise.resolve(authView(false)),
        })}
        skipSplash
      />
    );

    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    fireEvent.click(await screen.findByRole("button", { name: "Account" }));

    expect(await screen.findByText("Not signed in on this Mac.")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Sign out on this Mac" })
    ).toBeNull();
    expect(
      screen.getAllByRole("button", { name: "Sign in" }).length
    ).toBeGreaterThan(0);
  });

  it("confirms Stop OpenMeld Service from Computers before calling the bridge", async () => {
    const stopService = vi.fn(() => Promise.resolve(svc("stopped")));
    render(<App bridge={makeBridge({ stopService })} skipSplash />);

    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    fireEvent.click(await screen.findByRole("button", { name: "Computers" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Stop OpenMeld Service" })
    );

    expect(stopService).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(
        "This stops OpenMeld Service on this Mac. This Mac cannot receive local Wake work until OpenMeld Service is started again."
      )
    ).toBeTruthy();

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Stop OpenMeld Service" })
    );

    await waitFor(() => expect(stopService).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Computers" }));
    expect(await screen.findByText("Stopped")).toBeTruthy();
  });

  it("confirms Reconnect This Computer from Computers before setup runs", async () => {
    const setupComputer = vi.fn(() =>
      Promise.resolve({ ...svc("running"), setupGuidance: setupGuidance() })
    );
    render(<App bridge={makeBridge({ setupComputer })} skipSplash />);

    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    fireEvent.click(await screen.findByRole("button", { name: "Computers" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Reconnect This Computer" })
    );

    expect(setupComputer).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(
        "This reruns setup for this Mac and may restart OpenMeld Service. It will not sign you out."
      )
    ).toBeTruthy();

    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "Reconnect This Computer",
      })
    );

    await waitFor(() => expect(setupComputer).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Setup complete")).toBeTruthy();
    expect(
      screen.getByText("OpenMeld Service is running in the background.")
    ).toBeTruthy();
    expect(
      screen.getByText(
        "OpenMeld Service is set to start automatically when you sign in. Use the switch above to change this setting."
      )
    ).toBeTruthy();
    expect(screen.queryByText("openmeld service autostart disable")).toBeNull();
    expect(screen.queryByText("openmeld service stop")).toBeNull();
  });

  it("keeps setup guidance visible across background service refreshes while the service stays running", async () => {
    vi.useFakeTimers();
    const setupComputer = vi.fn(() =>
      Promise.resolve({ ...svc("running"), setupGuidance: setupGuidance() })
    );
    const getServiceStatus = vi.fn(() => Promise.resolve(svc("running")));
    render(
      <App
        bridge={makeBridge({ getServiceStatus, setupComputer })}
        skipSplash
      />
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Computers" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Reconnect This Computer" })
    );
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Reconnect This Computer",
      })
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText("Setup complete")).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(screen.getByText("Setup complete")).toBeTruthy();
    expect(
      screen.getByText("OpenMeld Service is running in the background.")
    ).toBeTruthy();
    expect(screen.queryByText("openmeld service stop")).toBeNull();
  });

  it("toggles OpenMeld Service autostart from Computers through the bridge", async () => {
    const setServiceAutoStart = vi.fn(() =>
      Promise.resolve(serviceAutoStartUpdate(svc("running", true)))
    );
    render(
      <App
        bridge={makeBridge({
          getServiceStatus: () => Promise.resolve(svc("running", false)),
          setServiceAutoStart,
        })}
        skipSplash
      />
    );

    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    fireEvent.click(await screen.findByRole("button", { name: "Computers" }));

    const computersHeading = await screen.findByRole("heading", {
      name: "Computers",
    });
    expect(computersHeading).toBeTruthy();

    fireEvent.click(
      screen.getByRole("switch", {
        name: "Enable Start OpenMeld Service automatically",
      })
    );

    await waitFor(() => expect(setServiceAutoStart).toHaveBeenCalledWith(true));
  });

  it("does not optimistically update OpenMeld Service autostart while the CLI writer is pending", async () => {
    const serviceAutoStart = deferred<ServiceAutoStartUpdateView>();
    const setServiceAutoStart = vi.fn(() => serviceAutoStart.promise);
    render(
      <App
        bridge={makeBridge({
          getServiceStatus: () => Promise.resolve(svc("running", false)),
          setServiceAutoStart,
        })}
        skipSplash
      />
    );

    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    fireEvent.click(await screen.findByRole("button", { name: "Computers" }));
    const toggle = await screen.findByRole("switch", {
      name: "Enable Start OpenMeld Service automatically",
    });
    fireEvent.click(toggle);

    expect(setServiceAutoStart).toHaveBeenCalledWith(true);
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(toggle.getAttribute("aria-busy")).toBe("true");

    await act(async () => {
      serviceAutoStart.resolve(
        serviceAutoStartUpdate(svc("running", true), null)
      );
      await Promise.resolve();
    });

    await waitFor(() => expect(toggle.getAttribute("aria-busy")).toBe("false"));
    expect(toggle.getAttribute("aria-checked")).toBe("true");
  });

  it("disables OpenMeld Service autostart when service manager status is unavailable", async () => {
    const setServiceAutoStart = vi.fn(() =>
      Promise.resolve(serviceAutoStartUpdate(svc("running", true)))
    );
    render(
      <App
        bridge={makeBridge({
          getServiceStatus: () => Promise.resolve(svc("running", null)),
          setServiceAutoStart,
        })}
        skipSplash
      />
    );

    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    fireEvent.click(await screen.findByRole("button", { name: "Computers" }));

    const toggle = await screen.findByRole("switch", {
      name: "Enable Start OpenMeld Service automatically",
    });
    expect(toggle).toHaveProperty("disabled", true);
    expect(screen.getByText("Autostart status unavailable.")).toBeTruthy();

    fireEvent.click(toggle);

    expect(setServiceAutoStart).not.toHaveBeenCalled();
  });

  it("keeps a failed service autostart save on the Computers setting row only", async () => {
    const setServiceAutoStart = vi.fn(() =>
      Promise.resolve(
        serviceAutoStartUpdate(
          svc("running", true),
          cliProblem(
            "missing command entry mapping for route: service autostart disable"
          )
        )
      )
    );
    render(
      <App
        bridge={makeBridge({
          getServiceStatus: () => Promise.resolve(svc("running", true)),
          setServiceAutoStart,
        })}
        skipSplash
      />
    );

    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    fireEvent.click(await screen.findByRole("button", { name: "Computers" }));
    fireEvent.click(
      await screen.findByRole("switch", {
        name: "Disable Start OpenMeld Service automatically",
      })
    );

    expect(
      await screen.findByText(
        "missing command entry mapping for route: service autostart disable"
      )
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "General" }));

    expect(
      screen.queryByText(
        "missing command entry mapping for route: service autostart disable"
      )
    ).toBeNull();
    expect(await screen.findByText(GENERAL_RUNNING_STATUS_COPY)).toBeTruthy();
  });

  it("shows honest Account and Profiles handoffs instead of fake profile data", async () => {
    const { container } = render(<App bridge={makeBridge()} skipSplash />);

    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    const settingsRail = container.querySelector('nav[aria-label="Settings"]');
    expect(settingsRail).toBeTruthy();
    if (!(settingsRail instanceof HTMLElement)) {
      return;
    }
    fireEvent.click(
      within(settingsRail).getByRole("button", { name: "Account" })
    );
    expect(
      (await screen.findAllByText("felix@openmeld.invalid")).length
    ).toBeGreaterThan(0);
    expect(screen.getByText("Local CLI session on this Mac")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Agents" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Directory" }));
    expect(
      await screen.findByText(
        "Create, rename, and review account-level Agent Profiles in OpenMeld Web."
      )
    ).toBeTruthy();
    expect(
      screen.getAllByRole("button", { name: "Open OpenMeld Web" })
    ).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Human Profiles" }));
    expect(
      await screen.findByText(
        "Create and manage teammate identities in OpenMeld Web."
      )
    ).toBeTruthy();
    expect(
      screen.getAllByRole("button", { name: "Open OpenMeld Web" })
    ).toHaveLength(2);
  });

  it("shows signed-out Account settings without an empty account shell state", async () => {
    const signIn = vi.fn(() => Promise.resolve(authView(true)));
    const { container } = render(
      <App
        bridge={makeBridge({
          getAuthStatus: () => Promise.resolve(authView(false)),
          signIn,
        })}
        skipSplash
      />
    );

    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    const settingsRail = container.querySelector('nav[aria-label="Settings"]');
    expect(settingsRail).toBeTruthy();
    if (!(settingsRail instanceof HTMLElement)) {
      return;
    }
    fireEvent.click(
      within(settingsRail).getByRole("button", { name: "Account" })
    );

    expect(await screen.findByText("Not signed in on this Mac.")).toBeTruthy();
    expect(screen.queryByText(SIGNED_IN_ACCOUNT)).toBeNull();
    const outerRail = container.querySelector('[data-slot="app-frame-rail"]');
    expect(outerRail).toBeTruthy();
    if (!(outerRail instanceof HTMLElement)) {
      return;
    }
    expect(
      within(outerRail).getByRole("button", { name: "Account settings" })
    ).toBeTruthy();

    const [signInButton] = screen.getAllByRole("button", { name: "Sign in" });
    if (!signInButton) {
      throw new Error("Expected a Sign in button.");
    }
    fireEvent.click(signInButton);
    await waitFor(() => expect(signIn).toHaveBeenCalledTimes(1));
  });

  it("keeps the app shell internally scrollable at the Desktop minimum size", async () => {
    const { container } = render(<App bridge={makeBridge()} skipSplash />);

    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    expect(
      await screen.findByRole("heading", { name: "Desktop app" })
    ).toBeTruthy();

    expect(
      container
        .querySelector('[data-slot="window-shell"]')
        ?.className.includes("h-screen")
    ).toBe(true);
    expect(
      container
        .querySelector('[data-slot="window-shell"]')
        ?.className.includes("flex-col")
    ).toBe(true);
    expect(
      container.querySelector('[data-slot="window-shell-titlebar-spacer"]')
    ).toBeNull();
    expect(
      container
        .querySelector('[data-slot="window-shell-main"]')
        ?.className.includes("overflow-hidden")
    ).toBe(true);
    expect(
      container.querySelector('[data-slot="window-shell-header"]')
    ).toBeNull();
    expect(
      container
        .querySelector('[data-slot="app-frame-content"]')
        ?.className.includes("overflow-y-auto")
    ).toBe(true);
  });

  it("keeps Desktop Settings on Web-aligned shell surfaces", async () => {
    const { container } = render(<App bridge={makeBridge()} skipSplash />);

    await screen.findByRole("button", { name: "Home" });
    const homeHeaderTitle = container.querySelector(
      '[data-slot="app-frame-header"] h1'
    );
    expect(homeHeaderTitle?.textContent).toBe("Home");
    expect(homeHeaderTitle?.className).toContain("text-sm");
    expect(homeHeaderTitle?.className).toContain("font-medium");

    fireEvent.click(await screen.findByRole("button", { name: "Directory" }));
    expect(
      await screen.findByRole("heading", { name: "Agent Profiles" })
    ).toBeTruthy();
    expect(
      container.querySelector('nav[aria-label="Profiles"] h2')?.className
    ).toBe(homeHeaderTitle?.className);

    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    expect(
      await screen.findByRole("heading", { name: "Desktop app" })
    ).toBeTruthy();

    const settingsHeaderTitle = container.querySelector(
      '[data-slot="app-frame-header"] h1'
    );
    expect(settingsHeaderTitle?.textContent).toBe("Settings");
    expect(settingsHeaderTitle?.className).toBe(homeHeaderTitle?.className);
    expect(
      container.querySelector('nav[aria-label="Settings"] h2')?.className
    ).toBe(homeHeaderTitle?.className);

    for (const slot of [
      "app-frame-rail",
      "app-frame-rail-list",
      "app-frame-main",
    ]) {
      expect(
        container
          .querySelector(`[data-slot="${slot}"]`)
          ?.className.includes("bg-background")
      ).toBe(true);
    }

    expect(
      container
        .querySelector('[data-slot="app-frame-header"]')
        ?.className.includes("h-[var(--space-conversation-header-height)]")
    ).toBe(true);
    expect(
      container
        .querySelector('[data-slot="app-frame-header"]')
        ?.className.includes("overflow-visible")
    ).toBe(true);
    expect(
      container
        .querySelector('[data-slot="app-frame-header"]')
        ?.className.includes("z-20")
    ).toBe(true);
    expect(
      container
        .querySelector('[data-slot="app-frame-header"]')
        ?.className.includes("border-b")
    ).toBe(true);
    const railHeader = container.querySelector(
      '[data-slot="app-frame-rail"] [data-slot="sidebar-header"]'
    );
    expect(
      railHeader?.className.includes(
        "h-[var(--space-conversation-header-height)]"
      )
    ).toBe(true);
    expect(railHeader?.className.includes("border-b")).toBe(true);
    expect(
      within(
        container.querySelector('[data-slot="app-frame-rail"]') as HTMLElement
      ).getByRole("button", { name: "Go Home" })
    ).toBeTruthy();
    expect(
      container
        .querySelector('[data-slot="app-frame-rail"]')
        ?.getAttribute("data-state")
    ).toBe("collapsed");
    expect(
      container.querySelector('[data-slot="app-frame-rail"]')
    ).toBeTruthy();
    expect(
      container
        .querySelector('[data-slot="settings-nav"]')
        ?.className.includes("p-2")
    ).toBe(false);
    expect(
      container
        .querySelector('nav[aria-label="Settings"]')
        ?.className.includes("w-56")
    ).toBe(true);
  });

  it("shows a retryable local-agents failure in Settings instead of loading forever", async () => {
    const getAgents = vi
      .fn()
      .mockRejectedValueOnce(new Error("agents list failed"))
      .mockResolvedValueOnce(agents(false));
    render(<App bridge={makeBridge({ getAgents })} skipSplash />);

    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    fireEvent.click(await screen.findByRole("button", { name: "Computers" }));

    expect(
      await screen.findByText("Could not load local agents. agents list failed")
    ).toBeTruthy();
    expect(screen.queryByText("Loading agents...")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Local agents options" })
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Check agents" }));

    await waitFor(() => expect(getAgents).toHaveBeenCalledTimes(2));
    expect(
      await screen.findByRole("switch", { name: "Enable Codex" })
    ).toBeTruthy();
  });

  it("starts OpenMeld Service from Computers without confirmation", async () => {
    const startService = vi.fn(() => Promise.resolve(svc("running")));
    render(
      <App
        bridge={makeBridge({
          getServiceStatus: () => Promise.resolve(svc("stopped")),
          startService,
        })}
        skipSplash
      />
    );

    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    fireEvent.click(await screen.findByRole("button", { name: "Computers" }));
    expect(
      await screen.findByRole("heading", { name: "Computers" })
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Start OpenMeld Service" })
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(startService).toHaveBeenCalledTimes(1);
  });

  it("sets up this computer from Computers without confirmation when service is not installed", async () => {
    const setupComputer = vi.fn(() => Promise.resolve(svc("running")));
    render(
      <App
        bridge={makeBridge({
          getServiceStatus: () => Promise.resolve(svc("not_installed")),
          setupComputer,
        })}
        skipSplash
      />
    );

    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    fireEvent.click(await screen.findByRole("button", { name: "Computers" }));
    expect(
      await screen.findByRole("heading", { name: "Computers" })
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Set Up This Computer" })
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(setupComputer).toHaveBeenCalledTimes(1);
  });

  it("shows setup progress from Computers while setup runs", async () => {
    const setup = deferred<ServiceView>();
    const setupComputer = vi.fn(() => setup.promise);
    render(
      <App
        bridge={makeBridge({
          getServiceStatus: () => Promise.resolve(svc("not_installed")),
          setupComputer,
        })}
        skipSplash
      />
    );

    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    fireEvent.click(await screen.findByRole("button", { name: "Computers" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Set Up This Computer" })
    );

    expect(setupComputer).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Check requirements")).toBeTruthy();
    expect(screen.getByText("Set up this Mac")).toBeTruthy();
    expect(screen.getByText("Ready for Spaces")).toBeTruthy();
    expect(
      screen.getByText(
        "Keep OpenMeld Desktop open while setup runs. No terminal commands are needed."
      )
    ).toBeTruthy();

    await act(async () => {
      setup.resolve(svc("running"));
      await Promise.resolve();
    });
  });

  it("keeps a failed Computers setup retryable in the service card", async () => {
    const failedSetupService: ServiceView = {
      ...svc("unknown"),
      problem: {
        kind: "cli_error",
        code: "desktop.setup_incomplete",
        message: "Setup couldn't be completed.",
        requestId: null,
      },
    };
    const setupComputer = vi.fn(() => Promise.resolve(failedSetupService));
    render(
      <App
        bridge={makeBridge({
          getServiceStatus: () => Promise.resolve(svc("not_installed")),
          setupComputer,
        })}
        skipSplash
      />
    );

    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    fireEvent.click(await screen.findByRole("button", { name: "Computers" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Set Up This Computer" })
    );

    await waitFor(() => expect(setupComputer).toHaveBeenCalledTimes(1));
    expect(
      (await screen.findAllByText("Setup couldn't be completed.")).length
    ).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Try Again" }));

    await waitFor(() => expect(setupComputer).toHaveBeenCalledTimes(2));
  });

  it("uses action-specific busy copy while starting service from Computers", async () => {
    const start = deferred<ServiceView>();
    const startService = vi.fn(() => start.promise);
    render(
      <App
        bridge={makeBridge({
          getServiceStatus: () => Promise.resolve(svc("stopped")),
          startService,
        })}
        skipSplash
      />
    );

    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    fireEvent.click(await screen.findByRole("button", { name: "Computers" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Start OpenMeld Service" })
    );

    expect(startService).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByRole("button", {
        name: "Starting OpenMeld Service...",
      })
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Reconnecting this computer..." })
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Stopping OpenMeld Service..." })
    ).toBeNull();

    await act(async () => {
      start.resolve(svc("running"));
      await Promise.resolve();
    });
  });

  it("uses action-specific busy copy while reconnecting from Computers", async () => {
    const setup = deferred<ServiceView>();
    const setupComputer = vi.fn(() => setup.promise);
    render(<App bridge={makeBridge({ setupComputer })} skipSplash />);

    fireEvent.click(await screen.findByRole("button", { name: "Settings" }));
    fireEvent.click(await screen.findByRole("button", { name: "Computers" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Reconnect This Computer" })
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "Reconnect This Computer",
      })
    );

    expect(setupComputer).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByRole("button", {
        name: "Reconnecting this computer...",
      })
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Starting OpenMeld Service..." })
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Stopping OpenMeld Service..." })
    ).toBeNull();

    await act(async () => {
      setup.resolve(svc("running"));
      await Promise.resolve();
    });
  });
});
