import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CenterAgentMessageChannelsSection } from "./center-agent-message-channels-section";

afterEach(cleanup);

describe("CenterAgentMessageChannelsSection", () => {
	it("puts the Channel explanation on each provider card without a tooltip", () => {
		render(
			<CenterAgentMessageChannelsSection
				availableProviders={["lark", "feishu"]}
				canManage
				disableSlackConnect={false}
				disableSlackDisconnect={false}
				onConnectSlackWorkspace={vi.fn()}
				onDisconnectSlackWorkspace={vi.fn()}
				onManageLarkPlatform={vi.fn()}
				organizationSlug="acme"
			/>
		);

		expect(screen.getByRole("region", { name: "Channels" })).toBeTruthy();
		expect(
			screen.getByRole("heading", { level: 2, name: "Slack" })
		).toBeTruthy();
		expect(
			screen.getByRole("heading", { level: 2, name: "Lark" })
		).toBeTruthy();
		expect(
			screen.getByRole("heading", { level: 2, name: "Feishu" })
		).toBeTruthy();
		for (const provider of ["Slack", "Lark", "Feishu"]) {
			const explanation = screen.getByText(
				`People can message your Center Agent from ${provider} and receive replies in the same conversation.`
			);
			expect(explanation.closest('[data-slot="card-content"]')).toBeTruthy();
			expect(
				screen.getByTestId(`app-logo-${provider.toLowerCase()}`).parentElement
					?.className
			).toContain("size-12");
		}
		expect(document.querySelectorAll("[data-fluid-card-item]")).toHaveLength(3);
		expect(screen.queryByLabelText("About Channels")).toBeNull();
	});

	it("shows the projected Slack workspace without mutation controls to members", () => {
		render(
			<CenterAgentMessageChannelsSection
				canManage={false}
				disableSlackConnect={false}
				disableSlackDisconnect={false}
				managementMode="read-only"
				onConnectSlackWorkspace={vi.fn()}
				onDisconnectSlackWorkspace={vi.fn()}
				organizationSlug="acme"
				slackConnection={{
					connected: true,
					directMessagesReady: true,
					slackTeamId: "T123",
					workspaceName: "Acme HQ",
				}}
			/>
		);

		expect(screen.getByTestId("app-logo-slack")).toBeTruthy();
		expect(screen.queryByText("Connected to Acme HQ")).toBeNull();
		expect(screen.getByText("Connected")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Manage Slack" })).toBeNull();
	});

	it("offers only disconnect cleanup for a legacy Personal Workspace Lark connection", () => {
		const onManageLarkPlatform = vi.fn();
		render(
			<CenterAgentMessageChannelsSection
				availableProviders={["lark", "feishu"]}
				canManage={false}
				connections={[
					{
						externalAccountId: "tenant_lark_1",
						externalAccountName: "Legacy Lark",
						grantedCapabilityGroups: ["conversation.text"],
						id: "connection_lark_1",
						lastVerifiedAt: "2026-07-18T00:00:00.000Z",
						permissionBundleVersion: "channel-only-2026-07-18",
						provider: "lark",
						reasonCode: null,
						status: "connected",
						transport: "webhook",
					},
				]}
				disableSlackConnect
				disableSlackDisconnect
				managementMode="cleanup"
				onConnectSlackWorkspace={vi.fn()}
				onDisconnectSlackWorkspace={vi.fn()}
				onManageLarkPlatform={onManageLarkPlatform}
				organizationRequired
				organizationSlug="acme"
			/>
		);

		expect(screen.getByText("Disconnect required")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Disconnect Lark" }));
		expect(onManageLarkPlatform).toHaveBeenCalledWith("lark");
		expect(screen.queryByRole("button", { name: "Repair Lark" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Connect Lark" })).toBeNull();
	});

	it("keeps the existing Slack connection dialog for workspace managers", () => {
		render(
			<CenterAgentMessageChannelsSection
				canManage
				disableSlackConnect={false}
				disableSlackDisconnect={false}
				onConnectSlackWorkspace={vi.fn()}
				onDisconnectSlackWorkspace={vi.fn()}
				onManageLarkPlatform={vi.fn()}
				organizationSlug="acme"
			/>
		);

		expect(screen.getByRole("button", { name: "Connect Slack" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Connect Lark" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Connect Feishu" })).toBeTruthy();
	});

	it("shows Slack and Lark as independently connected in one organization", () => {
		const onManageLarkPlatform = vi.fn();
		render(
			<CenterAgentMessageChannelsSection
				canManage
				connections={[
					{
						externalAccountId: "T123",
						externalAccountName: "Acme Slack",
						grantedCapabilityGroups: [],
						id: "slack:T123",
						lastVerifiedAt: null,
						permissionBundleVersion: null,
						provider: "slack",
						reasonCode: null,
						status: "connected",
						transport: "webhook",
					},
					{
						externalAccountId: "tenant_lark_1",
						externalAccountName: "Acme Lark",
						grantedCapabilityGroups: ["conversation.text"],
						id: "connection_lark_1",
						lastVerifiedAt: "2026-07-18T00:00:00.000Z",
						permissionBundleVersion: "channel-only-2026-07-18",
						provider: "lark",
						reasonCode: null,
						status: "connected",
						transport: "webhook",
					},
				]}
				disableSlackConnect={false}
				disableSlackDisconnect={false}
				onConnectSlackWorkspace={vi.fn()}
				onDisconnectSlackWorkspace={vi.fn()}
				onManageLarkPlatform={onManageLarkPlatform}
				organizationSlug="acme"
				slackConnection={{
					connected: true,
					directMessagesReady: true,
					slackTeamId: "T123",
					workspaceName: "Acme Slack",
				}}
			/>
		);

		expect(screen.queryByText("Connected to Acme Slack")).toBeNull();
		expect(screen.queryByText("Connected to Acme Lark")).toBeNull();
		expect(screen.getByText("Acme Lark")).toBeTruthy();
		expect(screen.getAllByText("Connected")[0]?.className).toContain("h-7");
		screen.getByRole("button", { name: "Manage Lark" }).click();
		expect(onManageLarkPlatform).toHaveBeenCalledWith("lark");
	});

	it("shows when a connected Slack installation needs DM permissions", () => {
		render(
			<CenterAgentMessageChannelsSection
				canManage
				disableSlackConnect={false}
				disableSlackDisconnect={false}
				onConnectSlackWorkspace={vi.fn()}
				onDisconnectSlackWorkspace={vi.fn()}
				organizationSlug="acme"
				slackConnection={{
					connected: true,
					directMessagesReady: false,
					slackTeamId: "T123",
					workspaceName: "Acme Slack",
				}}
			/>
		);

		expect(screen.getByText("Reconnect required")).toBeTruthy();
		expect(
			screen.getByText(
				"Reconnect Slack once so people can message the Center Agent directly."
			)
		).toBeTruthy();
	});

	it("hides unavailable disconnected providers outside the pilot Organization", () => {
		render(
			<CenterAgentMessageChannelsSection
				availableProviders={[]}
				canManage
				disableSlackConnect={false}
				disableSlackDisconnect={false}
				onConnectSlackWorkspace={vi.fn()}
				onDisconnectSlackWorkspace={vi.fn()}
				onManageLarkPlatform={vi.fn()}
				organizationSlug="acme"
			/>
		);

		expect(screen.queryByText("Lark")).toBeNull();
		expect(screen.queryByText("Feishu")).toBeNull();
	});

	it("keeps an idle disconnected Lark card as concise as Slack", () => {
		render(
			<CenterAgentMessageChannelsSection
				availableProviders={["lark"]}
				canManage
				disableSlackConnect={false}
				disableSlackDisconnect={false}
				onConnectSlackWorkspace={vi.fn()}
				onDisconnectSlackWorkspace={vi.fn()}
				onManageLarkPlatform={vi.fn()}
				organizationSlug="acme"
			/>
		);

		expect(
			screen.queryByText(
				"Webhook · Channel permissions are requested during setup"
			)
		).toBeNull();
		expect(
			screen.queryByText("Select Connect Lark to open the official setup flow.")
		).toBeNull();
		expect(screen.queryByText("Not connected", { exact: true })).toBeNull();
		const larkLogo = screen.getByTestId("app-logo-lark");
		expect(larkLogo.getAttribute("src")).toBe("/app-logos/feishu.svg");
		expect(larkLogo.parentElement?.className).toContain("dark:bg-muted/50");
	});

	it("keeps Lark neutral while its setup progress is still loading", () => {
		render(
			<CenterAgentMessageChannelsSection
				activeRegistrationsChecking
				availableProviders={["lark"]}
				canManage
				disableSlackConnect={false}
				disableSlackDisconnect={false}
				onConnectSlackWorkspace={vi.fn()}
				onDisconnectSlackWorkspace={vi.fn()}
				onManageLarkPlatform={vi.fn()}
				organizationSlug="acme"
			/>
		);

		expect(screen.getByText("Checking")).toBeTruthy();
		expect(screen.queryByText("Checking setup status")).toBeNull();
		expect(
			screen.getByText(
				"OpenMeld is checking whether setup is already in progress."
			)
		).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Connect Lark" })).toBeNull();
	});

	it("keeps Lark visibly connecting until Webhook delivery is verified", () => {
		render(
			<CenterAgentMessageChannelsSection
				availableProviders={["lark"]}
				canManage
				connections={[
					{
						externalAccountId: "ou_bot",
						externalAccountName: "OpenMeld Center Agent",
						grantedCapabilityGroups: ["conversation.text"],
						id: "connection_lark_configuring",
						lastVerifiedAt: null,
						permissionBundleVersion: "channel-only-2026-07-18",
						provider: "lark",
						reasonCode: null,
						status: "configuring",
						transport: "webhook",
					},
				]}
				disableSlackConnect={false}
				disableSlackDisconnect={false}
				onConnectSlackWorkspace={vi.fn()}
				onDisconnectSlackWorkspace={vi.fn()}
				onManageLarkPlatform={vi.fn()}
				organizationSlug="acme"
			/>
		);

		expect(screen.getByText("Connecting")).toBeTruthy();
		expect(screen.queryByText("Setup is still in progress")).toBeNull();
		expect(screen.getByText("OpenMeld Center Agent")).toBeTruthy();
		expect(
			screen.getByText(
				"OpenMeld is verifying Webhook delivery. You can leave this page and return later."
			)
		).toBeTruthy();
		expect(screen.queryByText("Connected to OpenMeld Center Agent")).toBeNull();
	});

	it("keeps stale setup read-only when its latest refresh fails", () => {
		render(
			<CenterAgentMessageChannelsSection
				activeRegistrations={[
					{
						canResume: true,
						expiresAt: "2026-07-18T09:00:00.000Z",
						id: "attempt_lark_pending",
						nextPollAt: "2026-07-18T08:00:05.000Z",
						provider: "lark",
						reasonCode: null,
						status: "pending_registration",
					},
				]}
				activeRegistrationsUnavailable
				availableProviders={["lark"]}
				canManage
				disableSlackConnect={false}
				disableSlackDisconnect={false}
				onConnectSlackWorkspace={vi.fn()}
				onDisconnectSlackWorkspace={vi.fn()}
				onManageLarkPlatform={vi.fn()}
				organizationSlug="acme"
			/>
		);

		expect(screen.getByText("Connecting")).toBeTruthy();
		expect(screen.queryByText("Setup is still in progress")).toBeNull();
		expect(
			screen.getByText(
				"OpenMeld could not refresh this setup. Refresh Channels before taking another action."
			)
		).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Connect Lark" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Continue setup" })).toBeNull();
	});

	it("shows durable Lark setup before a connection row exists", () => {
		const onManageLarkPlatform = vi.fn();
		render(
			<CenterAgentMessageChannelsSection
				activeRegistrations={[
					{
						canResume: true,
						expiresAt: "2026-07-18T09:00:00.000Z",
						id: "attempt_lark_pending",
						nextPollAt: "2026-07-18T08:00:05.000Z",
						provider: "lark",
						reasonCode: null,
						status: "pending_registration",
					},
				]}
				availableProviders={["lark"]}
				canManage
				disableSlackConnect={false}
				disableSlackDisconnect={false}
				onConnectSlackWorkspace={vi.fn()}
				onDisconnectSlackWorkspace={vi.fn()}
				onManageLarkPlatform={onManageLarkPlatform}
				organizationSlug="acme"
			/>
		);

		expect(screen.getByText("Connecting")).toBeTruthy();
		expect(screen.queryByText("Setup is still in progress")).toBeNull();
		expect(screen.queryByRole("button", { name: "Connect Lark" })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Continue setup" }));
		expect(onManageLarkPlatform).toHaveBeenCalledWith("lark");
	});

	it("does not offer another manager an installer-private setup action", () => {
		render(
			<CenterAgentMessageChannelsSection
				activeRegistrations={[
					{
						canResume: false,
						expiresAt: "2026-07-18T09:00:00.000Z",
						id: "attempt_lark_pending",
						nextPollAt: "2026-07-18T08:00:05.000Z",
						provider: "lark",
						reasonCode: null,
						status: "pending_registration",
					},
				]}
				availableProviders={["lark"]}
				canManage
				disableSlackConnect={false}
				disableSlackDisconnect={false}
				onConnectSlackWorkspace={vi.fn()}
				onDisconnectSlackWorkspace={vi.fn()}
				onManageLarkPlatform={vi.fn()}
				organizationSlug="acme"
			/>
		);

		expect(screen.getByText("Connecting")).toBeTruthy();
		expect(
			screen.getByText(
				"Setup is in progress. The person who started it can continue."
			)
		).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Continue setup" })).toBeNull();
	});

	it("offers the real repair action and aligns channel status badges with controls", () => {
		const onManageLarkPlatform = vi.fn();
		render(
			<CenterAgentMessageChannelsSection
				availableProviders={["lark"]}
				canManage
				connections={[
					{
						externalAccountId: "cli_existing_app",
						externalAccountName: null,
						grantedCapabilityGroups: [],
						id: "connection_lark_repair",
						lastVerifiedAt: null,
						permissionBundleVersion: "channel-only-2026-07-18",
						provider: "lark",
						reasonCode: "lark.registration_expired",
						status: "repair_required",
						transport: "webhook",
					},
				]}
				disableSlackConnect={false}
				disableSlackDisconnect={false}
				onConnectSlackWorkspace={vi.fn()}
				onDisconnectSlackWorkspace={vi.fn()}
				onManageLarkPlatform={onManageLarkPlatform}
				organizationSlug="acme"
			/>
		);

		const badge = screen.getByText("Needs Attention");
		expect(badge.className).toContain("h-7");
		expect(
			screen.getByText(
				"Lark setup expired before OpenMeld could verify Webhook delivery."
			)
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Repair Lark" }));
		expect(onManageLarkPlatform).toHaveBeenCalledWith("lark");
	});
});
