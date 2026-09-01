import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Badge } from "#components/badge";
import { Button } from "#components/button";
import {
  SettingsAccountActionCard,
  SettingsAccountCliAccessSection,
  SettingsAccountProfileCard,
  SettingsAccountProfileSection,
  SettingsAccountRoot,
  SettingsAccountSecuritySection,
  SettingsAccountSessionsSection,
} from "#components/settings-account";
import {
  SettingsAddComputerCardContent,
  SettingsComputerStatusCard,
  SettingsComputerSummaryCardContent,
  SettingsLocalAgentAdvisoryBadge,
  SettingsLocalAgentsCard,
} from "#components/settings-computers";
import { TooltipProvider } from "#components/tooltip";
import {
  ADD_CARD_PICKER_CLASS_NAME,
  CARD_PICKER_GRID_CLASS_NAME,
  cardPickerCardClassName,
} from "#lib/card-picker-contract";

const ADD_COMPUTER_NAME_PATTERN = /Add a Computer/i;
const UPDATE_AVAILABLE_PATTERN = /Update available/u;

afterEach(() => {
  cleanup();
});

describe("Settings Account shared components", () => {
  it("renders the canonical Account sections with stable ids and copy", () => {
    render(
      <SettingsAccountRoot>
        <SettingsAccountProfileSection>
          <div>profile cards</div>
        </SettingsAccountProfileSection>
        <SettingsAccountCliAccessSection>
          <div>token card</div>
        </SettingsAccountCliAccessSection>
        <SettingsAccountSecuritySection>
          <div>security cards</div>
        </SettingsAccountSecuritySection>
        <SettingsAccountSessionsSection>
          <div>sessions card</div>
        </SettingsAccountSessionsSection>
      </SettingsAccountRoot>
    );

    expect(document.getElementById("account-profile")).toBeTruthy();
    expect(document.getElementById("account-cli-access")).toBeTruthy();
    expect(document.getElementById("account-sign-in")).toBeTruthy();
    expect(document.getElementById("account-sessions")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Profile" })).toBeTruthy();
    expect(
      screen.getByText("How you appear to others in your spaces.")
    ).toBeTruthy();
  });

  it("renders an account profile card with avatar, badge, and footer action", () => {
    const { container } = render(
      <SettingsAccountProfileCard
        avatarAlt="Felix"
        badge={<Badge variant="outline">Verified</Badge>}
        displayName="Felix"
        email="felix@openmeld.invalid"
        footerAction={<Button size="sm">Open OpenMeld Web</Button>}
        footerMeta="Joined May 7, 2026"
        initials="F"
        profileAction={<Button size="sm">Change photo</Button>}
      />
    );

    expect(screen.getByText("User Profile")).toBeTruthy();
    expect(
      container.querySelector('[data-slot="card-title"] svg')
    ).toBeTruthy();
    expect(screen.getByText("Felix")).toBeTruthy();
    expect(screen.getByText("felix@openmeld.invalid")).toBeTruthy();
    expect(
      container.querySelector(
        '[data-slot="settings-account-profile-email"] svg'
      )
    ).toBeTruthy();
    expect(screen.getByText("Verified")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Change photo" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Open OpenMeld Web" })
    ).toBeTruthy();
    const footer = container.querySelector('[data-slot="card-footer"]');
    expect(footer?.className).not.toContain("rounded-md");
  });

  it("renders a neutral action card for host-specific Account handoffs", () => {
    render(
      <SettingsAccountActionCard
        action={<Button size="sm">Open OpenMeld Web</Button>}
        description="Manage cloud account details on OpenMeld Web."
        title="Manage Account"
      >
        <p>Display name, providers, password, and sessions stay on Web.</p>
      </SettingsAccountActionCard>
    );

    expect(screen.getByText("Manage Account")).toBeTruthy();
    expect(
      screen.getByText(
        "Display name, providers, password, and sessions stay on Web."
      )
    ).toBeTruthy();
  });
});

describe("Settings Computers shared components", () => {
  it("exports the picker grid and card class contracts used by hosts", () => {
    expect(CARD_PICKER_GRID_CLASS_NAME).toContain("grid");
    expect(CARD_PICKER_GRID_CLASS_NAME).toContain("repeat(auto-fit");
    expect(cardPickerCardClassName()).toContain("min-h-40");
    expect(cardPickerCardClassName()).toContain("rounded-md");
    expect(cardPickerCardClassName({ muted: true })).toContain("border-dashed");
    expect(ADD_CARD_PICKER_CLASS_NAME).toContain("border-dashed");
    expect(ADD_CARD_PICKER_CLASS_NAME).toContain("rounded-md");
  });

  it("rounds the shared add-card icon container with the active shape token", () => {
    const { container } = render(<SettingsAddComputerCardContent />);

    expect(container.querySelector(".rounded-md")).toBeTruthy();
  });

  it("renders one warning status consistently in the computer summary", () => {
    render(
      <div className="group">
        <SettingsComputerSummaryCardContent
          lastSeenLabel="Last seen Jun 23, 2:37 PM"
          localAgents={[
            { agentId: "claude-code", displayName: "Claude Code" },
            { agentId: "codex", displayName: "Codex" },
            { agentId: "cursor", displayName: "Cursor" },
            { agentId: "opencode", displayName: "OpenCode" },
          ]}
          name="Felix's MacBook Pro"
          platformLabel="Laptop · macOS 15.5.0 · Dev"
          recordBadgeLabel="Older record"
          status={{
            label: "Update available",
            showLabel: true,
            tone: "warning",
          }}
          statusIndicatorTestId="computer-status-dot"
        />
      </div>
    );

    const computerName = screen.getByText("Felix's MacBook Pro");
    expect(computerName.className).toContain("max-sm:basis-full");
    expect(computerName.className).toContain("max-sm:break-words");
    expect(screen.getByText("Laptop · macOS 15.5.0 · Dev")).toBeTruthy();
    expect(screen.getByText("Older record")).toBeTruthy();
    expect(screen.getByText("Update available").className).toContain(
      "text-amber"
    );
    expect(screen.getByTestId("computer-status-dot")).toBeTruthy();
    expect(screen.getByTestId("computer-status-dot").className).toContain(
      "bg-amber"
    );
    expect(screen.getByTestId("local-agent-logo-claude-code")).toBeTruthy();
    expect(screen.getByTestId("local-agent-logo-codex")).toBeTruthy();
    expect(screen.getByTestId("local-agent-logo-cursor")).toBeTruthy();
    expect(screen.getByTestId("local-agent-logo-opencode")).toBeTruthy();
  });

  it("renders the computer status dot as destructive when OpenMeld Service is not connected", () => {
    render(
      <SettingsComputerSummaryCardContent
        lastSeenLabel="Last seen Jun 23, 2:37 PM"
        name="Felix's MacBook Pro"
        platformLabel="Laptop · macOS 15.5.0"
        status={{
          label: "OpenMeld Service is not connected",
          showLabel: true,
          tone: "danger",
        }}
        statusIndicatorTestId="computer-status-dot"
      />
    );

    expect(
      screen.getAllByText("OpenMeld Service is not connected").length
    ).toBeGreaterThan(0);
    expect(screen.getByTestId("computer-status-dot").className).toContain(
      "bg-destructive"
    );
  });

  it("pairs a named local-agent status with its logo and keeps the full text accessible", () => {
    render(
      <SettingsComputerSummaryCardContent
        lastSeenLabel="Last seen just now"
        name="Felix's MacBook Pro"
        platformLabel="Laptop · macOS 25.5.0"
        status={{
          label: "Sign in to Claude Code",
          localAgent: { agentId: "claude-code", displayName: "Claude Code" },
          showLabel: true,
          tone: "muted",
        }}
      />
    );

    expect(screen.getByTestId("local-agent-logo-claude-code")).toBeTruthy();
    expect(screen.getByText("Sign in to Claude Code")).toBeTruthy();
  });

  it("renders the add-computer card contents without owning navigation", () => {
    const { container } = render(
      <a className={ADD_CARD_PICKER_CLASS_NAME} href="/connect">
        <SettingsAddComputerCardContent
          iconContainerClassName="custom-icon-hook"
          titleClassName="custom-title-hook"
        />
      </a>
    );

    const link = screen.getByRole("link", { name: ADD_COMPUTER_NAME_PATTERN });
    expect(link.getAttribute("href")).toBe("/connect");
    expect(container.querySelector(".custom-icon-hook svg")).toBeTruthy();
    expect(screen.getByText("Add a Computer").className).toContain(
      "custom-title-hook"
    );
    expect(
      screen.getByText("Set up OpenMeld Service and local agents.")
    ).toBeTruthy();
  });

  it("renders the service status card with an explicit injected action", () => {
    render(
      <SettingsComputerStatusCard
        action={<Button size="sm">Check status</Button>}
        description="Keeps local agents available in the background on This Mac."
        statusDescription="OpenMeld Service is running on this computer."
        statusLabel="Connected"
        tone="connected"
      />
    );

    expect(screen.getByText("OpenMeld Service")).toBeTruthy();
    expect(screen.getByText("Connected")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Check status" })).toBeTruthy();
  });

  it("renders local agent rows with caller-owned controls", async () => {
    const updateCommand = "npm install -g @anthropic-ai/claude-code@latest";

    render(
      <TooltipProvider>
        <SettingsLocalAgentsCard
          description="Local agents reported by This Mac."
          rows={[
            {
              control: <button type="button">Disable Claude Code</button>,
              description: "Built-in local agent found on this computer.",
              descriptionTone: "warning",
              displayName: "Claude Code",
              id: "claude-code",
              summaryMeta: "Enabled",
              summaryStatuses: [
                { label: "Needs setup", tone: "danger" },
                { label: "Suspended", tone: "warning" },
              ],
              summaryAccessory: (
                <SettingsLocalAgentAdvisoryBadge
                  detail="Update available."
                  label="Update available"
                  updateCommand={updateCommand}
                />
              ),
            },
          ]}
        />
      </TooltipProvider>
    );

    const card = screen.getByTestId("settings-local-agents-card");
    const row = screen.getByTestId("settings-local-agent-row-claude-code");
    expect(within(card).getByText("Local agents")).toBeTruthy();
    expect(row).toBeTruthy();
    expect(row.className).toContain("grid-cols-[minmax(0,1fr)_auto]");
    expect(
      screen.getByRole("button", { name: "Disable Claude Code" })
    ).toBeTruthy();
    expect(
      within(row).getByText("Built-in local agent found on this computer.")
        .className
    ).toContain("text-amber-200");
    const setupLabel = within(row).getByText("Needs setup");
    expect(setupLabel.getAttribute("data-slot")).not.toBe("badge");
    expect(setupLabel.className).toContain("text-destructive");
    expect(within(row).getByText("Suspended").className).toContain(
      "text-amber"
    );
    expect(within(row).getByText("Enabled").className).toContain(
      "text-muted-foreground"
    );
    expect(within(row).getByText("Update available")).toBeTruthy();
    expect(within(row).queryByTitle(UPDATE_AVAILABLE_PATTERN)).toBeNull();
    expect(
      row.querySelector('[data-slot="tooltip-trigger"]')?.textContent
    ).toContain("Update available");
    const tooltipTrigger = row.querySelector('[data-slot="tooltip-trigger"]');
    expect(tooltipTrigger).toBeTruthy();
    fireEvent.pointerEnter(tooltipTrigger as HTMLElement, {
      pointerType: "mouse",
    });
    fireEvent.mouseEnter(tooltipTrigger as HTMLElement);
    expect(
      await screen.findByText(
        "Update available. Open Details to copy the update command and see how to run it."
      )
    ).toBeTruthy();
    expect(screen.queryByText(updateCommand)).toBeNull();
    expect(
      within(row).getByTestId("settings-local-agent-row-control").className
    ).toContain("ml-auto");
  });

  it("renders local agent row icons without row chrome", () => {
    render(
      <SettingsLocalAgentsCard
        description="Local agents reported by This Mac."
        rows={[
          {
            control: <button type="button">Disable OpenCode</button>,
            description: "Ready to run local Wake work.",
            displayName: "OpenCode",
            id: "opencode",
            summaryMeta: "Signed in",
          },
          {
            description: "Ready to run local Wake work.",
            displayName: "Custom Agent",
            id: "custom-agent",
          },
        ]}
      />
    );

    const openCodeRow = screen.getByTestId("settings-local-agent-row-opencode");
    const openCodeLogo = within(openCodeRow).getByTestId(
      "local-agent-logo-opencode"
    );
    const openCodeIconSlot = openCodeLogo.parentElement;
    expect(openCodeIconSlot?.className).not.toContain("border");
    expect(openCodeIconSlot?.className).not.toContain("bg-");
    expect(openCodeLogo.firstElementChild?.tagName.toLowerCase()).toBe("svg");

    const customAgentRow = screen.getByTestId(
      "settings-local-agent-row-custom-agent"
    );
    const customAgentIconSlot =
      customAgentRow.querySelector("svg")?.parentElement;
    expect(customAgentIconSlot?.className).not.toContain("border");
    expect(customAgentIconSlot?.className).not.toContain("bg-");
  });

  it("renders expandable local agent details without swallowing row controls", () => {
    render(
      <SettingsLocalAgentsCard
        description="Local agents reported by This Mac."
        rows={[
          {
            control: <button type="button">Disable Codex</button>,
            description: "Ready to run local Wake work.",
            detail: <div>Native interface: Codex App Server</div>,
            displayName: "Codex",
            id: "codex",
            summaryMeta: "Signed in",
          },
        ]}
      />
    );

    expect(screen.getByText("Signed in")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Disable Codex" })).toBeTruthy();
    expect(
      within(screen.getByTestId("settings-local-agent-row-codex")).getByTestId(
        "settings-local-agent-row-trigger"
      ).className
    ).toContain("min-w-0");

    fireEvent.click(
      within(screen.getByTestId("settings-local-agent-row-codex")).getByText(
        "Codex",
        { selector: "p" }
      )
    );

    expect(screen.getByText("Native interface: Codex App Server")).toBeTruthy();
  });
});
