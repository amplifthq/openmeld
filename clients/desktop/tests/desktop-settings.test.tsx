import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DesktopSettings,
  type LocalAgentsLoadState,
} from "../src/renderer/components/desktop-settings";
import type {
  AgentsView,
  AuthView,
  CliProblem,
  DesktopSettingsView,
  ServiceView,
} from "../src/shared/view-types";

afterEach(cleanup);

function authView(): AuthView {
  return {
    email: "felix@openmeld.invalid",
    problem: null,
    signedIn: true,
  };
}

function serviceView(): ServiceView {
  return {
    autoStart: true,
    cliVersion: {
      checked: true,
      currentVersion: "1.2.3",
      latestVersion: "1.2.3",
      requiredVersion: null,
      updateAvailable: false,
    },
    installed: true,
    lifecycle: "running",
    problem: null,
    running: true,
    runtimeProjection: null,
  };
}

function agentsView(enabled = false): AgentsView {
  return {
    agents: [
      {
        blockerReasonCodes: [],
        detected: true,
        displayName: "Codex",
        enabled,
        id: "codex",
        launchStatus: "ready",
        lifecycleStatus: "active",
        selectable: true,
        agentControllerInterface: null,
      },
    ],
    problem: null,
  };
}

function zeroAgentsView(problem: CliProblem | null = null): AgentsView {
  return {
    agents: [],
    problem,
  };
}

function undetectedAgentsView(): AgentsView {
  return {
    agents: [
      {
        blockerReasonCodes: ["install.not_installed"],
        detected: false,
        displayName: "Codex",
        enabled: null,
        id: "codex",
        launchStatus: null,
        lifecycleStatus: "active",
        selectable: false,
        agentControllerInterface: null,
      },
    ],
    problem: null,
  };
}

function suspendedOpenClawAgentsView(enabled: boolean): AgentsView {
  return {
    agents: [
      {
        blockerReasonCodes: [],
        detected: true,
        displayName: "OpenClaw",
        enabled,
        id: "openclaw",
        launchStatus: "ready",
        lifecycleStatus: "suspended",
        selectable: true,
        agentControllerInterface: null,
      },
    ],
    problem: null,
  };
}

function desktopSettingsView(): DesktopSettingsView {
  return {
    openAtLogin: true,
    problem: null,
  };
}

function readyAgentsLoad(enabled = false): LocalAgentsLoadState {
  return readyAgentsLoadFromView(agentsView(enabled));
}

function readyAgentsLoadFromView(view: AgentsView): LocalAgentsLoadState {
  return {
    errorMessage: null,
    status: "ready",
    view,
  };
}

function renderSettings(
  overrides: Partial<Parameters<typeof DesktopSettings>[0]> = {}
) {
  const props = {
    activeSectionId: "account",
    agentsLoad: readyAgentsLoad(),
    auth: authView(),
    busyAgentId: null,
    desktopSettings: desktopSettingsView(),
    desktopSettingsBusy: false,
    onOpenLocalAgentsGuide: vi.fn(),
    onOpenWeb: vi.fn(),
    onQuitDesktop: vi.fn(),
    onReconnectComputer: vi.fn(),
    onRetry: vi.fn(),
    onSelectSection: vi.fn(),
    onSetOpenAtLogin: vi.fn(),
    onSetServiceAutoStart: vi.fn(),
    onSignIn: vi.fn(),
    onSignOut: vi.fn(),
    onStartService: vi.fn(),
    onStopService: vi.fn(),
    onToggleAgent: vi.fn(),
    service: serviceView(),
    serviceActionBusy: null,
    serviceAutoStartBusy: false,
    serviceAutoStartProblem: null,
    signInBusy: false,
    signOutBusy: false,
    signOutProblem: null,
    ...overrides,
  };

  render(<DesktopSettings {...props} />);
  return props;
}

describe("DesktopSettings", () => {
  it("keeps General as a routing overview instead of duplicating leaf controls", () => {
    const onSelectSection = vi.fn();
    const onSetOpenAtLogin = vi.fn();
    renderSettings({
      activeSectionId: "general",
      onSelectSection,
      onSetOpenAtLogin,
    });

    expect(screen.getByText("Service and local agents")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open Computers" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open Account" })).toBeTruthy();
    expect(
      screen.getByRole("switch", {
        name: "Disable Open OpenMeld Desktop at login",
      })
    ).toBeTruthy();
    expect(
      screen.queryByRole("switch", {
        name: "Disable Start OpenMeld Service automatically",
      })
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Sign out on this Mac" })
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Stop OpenMeld Service" })
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Reconnect This Computer" })
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Open Computers" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Account" }));
    fireEvent.click(
      screen.getByRole("switch", {
        name: "Disable Open OpenMeld Desktop at login",
      })
    );

    expect(onSelectSection).toHaveBeenNthCalledWith(1, "computers");
    expect(onSelectSection).toHaveBeenNthCalledWith(2, "account");
    expect(onSetOpenAtLogin).toHaveBeenCalledWith(false);
  });

  it("shows the signed-in account and opens OpenMeld Web for account management", () => {
    const props = renderSettings({ activeSectionId: "account" });

    expect(screen.getByText("felix")).toBeTruthy();
    expect(screen.getByText("felix@openmeld.invalid")).toBeTruthy();

    const [openWebButton] = screen.getAllByRole("button", {
      name: "Open OpenMeld Web",
    });
    if (!openWebButton) {
      throw new Error("Expected an Open OpenMeld Web button.");
    }
    fireEvent.click(openWebButton);

    expect(props.onOpenWeb).toHaveBeenCalledTimes(1);
  });

  it("renders This Mac local agents and toggles an agent through Desktop IPC", () => {
    const onToggleAgent = vi.fn();
    renderSettings({
      activeSectionId: "computers",
      onToggleAgent,
    });

    expect(screen.getByText("This Mac")).toBeTruthy();
    expect(screen.getByText("Running")).toBeTruthy();
    const setupLabel = screen.getByText("Turn on");
    expect(setupLabel.getAttribute("data-slot")).not.toBe("badge");
    expect(setupLabel.className).toContain("text-amber");
    expect(screen.queryByText("Connect local agent")).toBeNull();
    expect(
      screen.getByText("Turn on Codex to let OpenMeld launch it on this Mac.")
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("switch", { name: "Enable Codex" }));

    expect(onToggleAgent).toHaveBeenCalledWith("codex", true);
  });

  it("shows the install guide link when no local agent entries exist", () => {
    const onOpenLocalAgentsGuide = vi.fn();
    renderSettings({
      activeSectionId: "computers",
      agentsLoad: readyAgentsLoadFromView(zeroAgentsView()),
      onOpenLocalAgentsGuide,
    });

    expect(screen.getByText("No agent CLIs installed yet.")).toBeTruthy();
    expect(
      screen.getByText("No agent CLIs installed yet? See the install guide.")
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "See the install guide" })
    );

    expect(onOpenLocalAgentsGuide).toHaveBeenCalledTimes(1);
  });

  it("shows the install guide link when every local agent is undetected", () => {
    renderSettings({
      activeSectionId: "computers",
      agentsLoad: readyAgentsLoadFromView(undetectedAgentsView()),
    });

    expect(
      screen.getByText("No agent CLIs installed yet? See the install guide.")
    ).toBeTruthy();
  });

  it("keeps local agent CLI failures in the error state instead of showing install guidance", () => {
    renderSettings({
      activeSectionId: "computers",
      agentsLoad: readyAgentsLoadFromView(
        zeroAgentsView({
          code: "desktop.agents_unavailable",
          kind: "cli_error",
          message: "Could not read local agents.",
          requestId: null,
        })
      ),
    });

    expect(screen.getByText("Could not read local agents.")).toBeTruthy();
    expect(
      screen.queryByText("No agent CLIs installed yet? See the install guide.")
    ).toBeNull();
  });

  it("confirms before disabling a local agent", () => {
    const onToggleAgent = vi.fn();
    renderSettings({
      activeSectionId: "computers",
      agentsLoad: readyAgentsLoad(true),
      onToggleAgent,
    });

    fireEvent.click(screen.getByRole("switch", { name: "Disable Codex" }));

    expect(onToggleAgent).not.toHaveBeenCalled();
    expect(screen.getByText("Disable Codex?")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Disable Codex" }));

    expect(onToggleAgent).toHaveBeenCalledWith("codex", false);
  });

  it("hides suspended local agents that are not enabled on this Mac", () => {
    renderSettings({
      activeSectionId: "computers",
      agentsLoad: {
        errorMessage: null,
        status: "ready",
        view: suspendedOpenClawAgentsView(false),
      },
    });

    expect(screen.queryByText("OpenClaw")).toBeNull();
    expect(screen.queryByText("Suspended")).toBeNull();
    expect(screen.queryByText("Connect local agent")).toBeNull();
  });

  it("keeps enabled suspended local agents visible on this Mac", () => {
    const onToggleAgent = vi.fn();
    renderSettings({
      activeSectionId: "computers",
      agentsLoad: {
        errorMessage: null,
        status: "ready",
        view: suspendedOpenClawAgentsView(true),
      },
      onToggleAgent,
    });

    expect(screen.getAllByText("OpenClaw").length).toBeGreaterThan(0);
    expect(screen.getByText("Suspended")).toBeTruthy();
    expect(
      screen.getByText("OpenMeld can launch this controller on this Mac.")
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("switch", { name: "Disable OpenClaw" }));
    fireEvent.click(screen.getByRole("button", { name: "Disable OpenClaw" }));

    expect(onToggleAgent).toHaveBeenCalledWith("openclaw", false);
  });

  it("lets users manually check local agents", () => {
    const onRetry = vi.fn();
    renderSettings({
      activeSectionId: "computers",
      onRetry,
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Local agents options" })
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Check agents" }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
