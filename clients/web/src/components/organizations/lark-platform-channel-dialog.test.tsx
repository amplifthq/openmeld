import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LarkPlatformChannelDialog } from "./lark-platform-channel-dialog";

const CREATE_APP_COPY_PATTERN = /create a new Lark app/i;

afterEach(cleanup);

describe("LarkPlatformChannelDialog", () => {
	it("hands the user to the official setup page and can start over", () => {
		const onStartOver = vi.fn();
		const props = {
			canManage: true,
			connection: null,
			disconnectPending: false,
			errorMessage: null,
			onDisconnect: vi.fn(),
			onOpenChange: vi.fn(),
			onRepair: vi.fn(),
			onRetryPoll: vi.fn(),
			onStartOver,
			open: true,
			pollPending: false,
			provider: "lark" as const,
			registration: {
				attempt: {
					expiresAt: "2026-07-18T01:00:00.000Z",
					id: "attempt_1",
					nextPollAt: "2026-07-18T00:00:05.000Z",
					provider: "lark" as const,
					reasonCode: null,
					registrationUrl:
						"https://open.feishu.cn/page/launcher?device_code=redacted",
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
			name: "Open Lark setup",
		});
		expect(setupLink.getAttribute("href")).toBe(
			"https://open.feishu.cn/page/launcher?device_code=redacted"
		);
		expect(screen.getByText(CREATE_APP_COPY_PATTERN)).toBeTruthy();
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

	it("explains a failed configuration check while automatic retries continue", () => {
		render(
			<LarkPlatformChannelDialog
				canManage
				connection={null}
				disconnectPending={false}
				errorMessage={null}
				onDisconnect={vi.fn()}
				onOpenChange={vi.fn()}
				onRepair={vi.fn()}
				onRetryPoll={vi.fn()}
				onStartOver={vi.fn()}
				open
				pollPending={false}
				provider="lark"
				registration={{
					attempt: {
						expiresAt: "2026-07-28T00:00:00.000Z",
						id: "attempt_configuring",
						nextPollAt: "2026-07-21T00:05:00.000Z",
						provider: "lark",
						reasonCode: "lark.application_config_failed",
						registrationUrl: null,
						status: "configuring",
					},
					connection: repairConnection("configuring"),
					organizationId: "org_1",
				}}
				repairPending={false}
				startOverPending={false}
			/>
		);

		expect(
			screen.getByText(
				"Lark did not accept the latest app configuration. OpenMeld will retry automatically."
			)
		).toBeTruthy();
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
