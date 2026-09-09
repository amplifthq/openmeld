import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LarkPlatformChannelDialog } from "./lark-platform-channel-dialog";

const DID_NOT_ACCEPT_PATTERN = /did not accept/;

afterEach(cleanup);

describe("LarkPlatformChannelDialog", () => {
	it.each([
		true,
		false,
	])("preserves a setup read error and gates restart by management permission (%s)", (canManage) => {
		const onStartOver = vi.fn();
		render(
			<LarkPlatformChannelDialog
				canManage={canManage}
				connection={null}
				disconnectPending={false}
				errorMessage="Saved setup could not be read."
				onDisconnect={vi.fn()}
				onOpenChange={vi.fn()}
				onReauthorize={vi.fn()}
				onRepair={vi.fn()}
				onRetryPoll={vi.fn()}
				onStartOver={onStartOver}
				open
				pollPending={false}
				provider="lark"
				registration={null}
				repairPending={false}
				startOverPending={false}
			/>
		);
		expect(screen.getByRole("alert").textContent).toContain(
			"Saved setup could not be read."
		);
		const restart = screen.queryByRole("button", { name: "Start over" });
		if (canManage) {
			expect(restart).not.toBeNull();
			fireEvent.click(restart as HTMLElement);
			expect(onStartOver).toHaveBeenCalledOnce();
		} else {
			expect(restart).toBeNull();
		}
	});

	it.each([
		["lark", "Lark", "Feishu"],
		["feishu", "Feishu", "Lark"],
	] as const)("explains a %s brand mismatch and restarts the selected provider", (provider, label, otherLabel) => {
		const onStartOver = vi.fn();
		render(
			<LarkPlatformChannelDialog
				canManage
				connection={null}
				disconnectPending={false}
				errorMessage={null}
				onDisconnect={vi.fn()}
				onOpenChange={vi.fn()}
				onReauthorize={vi.fn()}
				onRepair={vi.fn()}
				onRetryPoll={vi.fn()}
				onStartOver={onStartOver}
				open
				pollPending={false}
				provider={provider}
				registration={{
					organizationId: "org_1",
					connection: null,
					attempt: {
						id: "attempt_wrong_brand",
						provider,
						status: "repair_required",
						reasonCode: `${provider}.registration_provider_brand_mismatch`,
						registrationUrl: null,
						expiresAt: "2026-09-08T09:00:00Z",
						nextPollAt: "2026-09-08T08:00:00Z",
					},
				}}
				repairPending={false}
				startOverPending={false}
			/>
		);
		expect(
			screen.getByText(
				`You selected ${label}, but the platform returned a ${otherLabel} account. Switch to a ${label} account before starting over.`
			)
		).toBeTruthy();
		expect(screen.queryByText("Waiting for approval")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Start over" }));
		expect(onStartOver).toHaveBeenCalledOnce();
	});

	it.each([
		["lark", "Lark"],
		["feishu", "Feishu"],
	] as const)("shows the %s permission recovery action instead of indefinite verification", (provider, label) => {
		const onRetryPoll = vi.fn();
		const onReauthorize = vi.fn();
		render(
			<LarkPlatformChannelDialog
				canManage
				connection={null}
				disconnectPending={false}
				errorMessage={null}
				onDisconnect={vi.fn()}
				onOpenChange={vi.fn()}
				onReauthorize={onReauthorize}
				onRepair={vi.fn()}
				onRetryPoll={onRetryPoll}
				onStartOver={vi.fn()}
				open
				pollPending={false}
				provider={provider}
				registration={{
					organizationId: "org_1",
					connection: null,
					attempt: {
						id: "attempt_configuring",
						provider,
						status: "configuring",
						reasonCode: `${provider}.application_config_permission_required`,
						registrationUrl: null,
						expiresAt: "2026-09-14T00:00:00.000Z",
						nextPollAt: "2026-09-07T00:05:00.000Z",
					},
				}}
				repairPending={false}
				startOverPending={false}
			/>
		);
		expect(screen.getByText("Authorization required")).toBeTruthy();
		fireEvent.click(
			screen.getByRole("button", { name: `Reauthorize ${label}` })
		);
		expect(onReauthorize).toHaveBeenCalledOnce();
		expect(
			screen.queryByText("Verifying permissions and Webhook delivery")
		).toBeNull();
		fireEvent.click(
			screen.getByRole("button", { name: "I've authorized, check again" })
		);
		expect(onRetryPoll).toHaveBeenCalledOnce();
	});

	it.each([
		["lark", "Lark", "open.feishu.cn", "open.larksuite.com"],
		["lark", "Lark", "open.larksuite.com", "open.larksuite.com"],
		["feishu", "Feishu", "open.feishu.cn", "open.feishu.cn"],
	] as const)("opens %s setup from a compatible response and can start over", (provider, label, host, destination) => {
		const onStartOver = vi.fn();
		const props = {
			canManage: true,
			connection: null,
			disconnectPending: false,
			errorMessage: null,
			onDisconnect: vi.fn(),
			onOpenChange: vi.fn(),
			onReauthorize: vi.fn(),
			onRepair: vi.fn(),
			onRetryPoll: vi.fn(),
			onStartOver,
			open: true,
			pollPending: false,
			provider,
			registration: {
				attempt: {
					expiresAt: "2026-07-18T01:00:00.000Z",
					id: "attempt_1",
					nextPollAt: "2026-07-18T00:00:05.000Z",
					provider,
					reasonCode: null,
					registrationUrl: `https://${host}/page/launcher?user_code=redacted&name=Existing+app`,
					status: "pending_registration" as const,
				},
				connection: null,
				organizationId: "org_1",
			},
			repairPending: false,
			startOverPending: false,
		};
		render(<LarkPlatformChannelDialog {...props} />);

		const setupLink = screen.getByRole("link", {
			name: `Open ${label} setup`,
		});
		expect(setupLink.getAttribute("href")).toBe(
			`https://${destination}/page/launcher?user_code=redacted&name=Existing+app`
		);
		expect(
			screen.getByText(`Sign in with your ${label} account.`, { exact: false })
		).toBeTruthy();
		expect(screen.getByText("Waiting for approval")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Start over" }));
		expect(onStartOver).toHaveBeenCalledOnce();
	});

	it("requires a second explicit action before disconnecting", () => {
		const onDisconnect = vi.fn();
		render(
			<LarkPlatformChannelDialog
				canManage
				connection={{
					externalAccountId: "tenant_1",
					externalAccountName: "Acme Lark",
					grantedCapabilityGroups: ["conversation.text"],
					id: "connection_1",
					lastVerifiedAt: "2026-07-18T00:00:00.000Z",
					permissionBundleVersion: "channel-only-2026-07-18",
					provider: "lark",
					reasonCode: null,
					status: "connected",
					transport: "webhook",
				}}
				disconnectPending={false}
				errorMessage={null}
				onDisconnect={onDisconnect}
				onOpenChange={vi.fn()}
				onReauthorize={vi.fn()}
				onRepair={vi.fn()}
				onRetryPoll={vi.fn()}
				onStartOver={vi.fn()}
				open
				pollPending={false}
				provider="lark"
				registration={null}
				repairPending={false}
				startOverPending={false}
			/>
		);

		fireEvent.click(screen.getByRole("button", { name: "Disconnect Lark" }));
		expect(onDisconnect).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
		expect(onDisconnect).toHaveBeenCalledOnce();
	});

	it("explains and repairs the existing app without hiding the recovery action", () => {
		const onRepair = vi.fn();
		render(
			<LarkPlatformChannelDialog
				canManage
				connection={{
					externalAccountId: "cli_existing_app",
					externalAccountName: null,
					grantedCapabilityGroups: [],
					id: "connection_1",
					lastVerifiedAt: null,
					permissionBundleVersion: "channel-only-2026-07-18",
					provider: "lark",
					reasonCode: "lark.registration_expired",
					status: "repair_required",
					transport: "webhook",
				}}
				disconnectPending={false}
				errorMessage={null}
				onDisconnect={vi.fn()}
				onOpenChange={vi.fn()}
				onReauthorize={vi.fn()}
				onRepair={onRepair}
				onRetryPoll={vi.fn()}
				onStartOver={vi.fn()}
				open
				pollPending={false}
				provider="lark"
				registration={null}
				repairPending={false}
				startOverPending={false}
			/>
		);

		expect(screen.getByRole("heading", { name: "Repair Lark" })).toBeTruthy();
		expect(
			screen.getByText(
				"Setup expired before OpenMeld could verify this app’s permissions and Webhook delivery. Repair retries the existing app; it does not create another one."
			)
		).toBeTruthy();
		const badge = screen.getByText("Needs Attention");
		expect(badge.className).toContain("h-8");
		fireEvent.click(screen.getByRole("button", { name: "Repair Lark" }));
		expect(onRepair).toHaveBeenCalledOnce();
	});

	it("keeps repair available when an open registration becomes repair required", () => {
		const onRepair = vi.fn();
		const repairRequiredConnection = {
			externalAccountId: "cli_existing_app",
			externalAccountName: "OpenMeld Center Agent",
			grantedCapabilityGroups: [],
			id: "connection_1",
			lastVerifiedAt: null,
			permissionBundleVersion: "channel-only-2026-07-18",
			provider: "lark" as const,
			reasonCode: "lark.registration_expired",
			status: "repair_required" as const,
			transport: "webhook" as const,
		};
		render(
			<LarkPlatformChannelDialog
				canManage
				connection={repairRequiredConnection}
				disconnectPending={false}
				errorMessage={null}
				onDisconnect={vi.fn()}
				onOpenChange={vi.fn()}
				onReauthorize={vi.fn()}
				onRepair={onRepair}
				onRetryPoll={vi.fn()}
				onStartOver={vi.fn()}
				open
				pollPending={false}
				provider="lark"
				registration={{
					attempt: {
						expiresAt: "2026-07-28T00:00:00.000Z",
						id: "attempt_repair_failed",
						nextPollAt: "2026-07-28T00:00:00.000Z",
						provider: "lark",
						reasonCode: "lark.registration_expired",
						registrationUrl: null,
						status: "repair_required",
					},
					connection: repairRequiredConnection,
					organizationId: "org_1",
				}}
				repairPending={false}
				startOverPending={false}
			/>
		);

		expect(screen.getByRole("heading", { name: "Repair Lark" })).toBeTruthy();
		expect(screen.queryByText("Setup did not finish")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Repair Lark" }));
		expect(onRepair).toHaveBeenCalledOnce();
	});

	it.each([
		"lark",
		"feishu",
	] as const)("does not blame %s for a configuration failure and preserves database diagnostics", (provider) => {
		const label = provider === "lark" ? "Lark" : "Feishu";
		const errorMessage =
			"D1_ERROR: D1 DB is overloaded. Requests queued for too long.";
		const onRetryPoll = vi.fn();
		render(
			<LarkPlatformChannelDialog
				canManage
				connection={null}
				disconnectPending={false}
				errorMessage={errorMessage}
				onDisconnect={vi.fn()}
				onOpenChange={vi.fn()}
				onReauthorize={vi.fn()}
				onRepair={vi.fn()}
				onRetryPoll={onRetryPoll}
				onStartOver={vi.fn()}
				open
				pollPending={false}
				provider={provider}
				registration={{
					attempt: {
						expiresAt: "2026-07-28T00:00:00.000Z",
						id: "attempt_configuring",
						nextPollAt: "2026-07-21T00:05:00.000Z",
						provider,
						reasonCode: `${provider}.application_config_failed`,
						registrationUrl: null,
						status: "configuring",
					},
					connection: { ...repairConnection("configuring"), provider },
					organizationId: "org_1",
				}}
				repairPending={false}
				startOverPending={false}
			/>
		);

		expect(
			screen.getByText(
				`OpenMeld could not finish configuring the ${label} app. It will retry automatically.`
			)
		).toBeTruthy();
		expect(screen.getByRole("alert").textContent).toBe(errorMessage);
		expect(screen.queryByText(DID_NOT_ACCEPT_PATTERN)).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Check again" }));
		expect(onRetryPoll).toHaveBeenCalledOnce();
	});
});

function repairConnection(status: "configuring" | "repair_required") {
	return {
		externalAccountId: "cli_existing_app",
		externalAccountName: null,
		grantedCapabilityGroups: [],
		id: "connection_1",
		lastVerifiedAt: null,
		permissionBundleVersion: "channel-only-2026-07-18",
		provider: "lark" as const,
		reasonCode:
			status === "repair_required" ? "lark.registration_expired" : null,
		status,
		transport: "webhook" as const,
	};
}
