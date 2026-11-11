import type {
	AgentControllerInterfaceSnapshot,
	LocalRuntimeComputer,
	LocalRuntimeExecutionTarget,
	OrganizationComputerLocalAgentDetails,
} from "@openmeld/schemas/types";
import type { ComputerReplyReadiness } from "@openmeld/start";
import { TooltipProvider } from "@openmeld/ui/components/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isLocalAgentControlStillRunningError } from "./agents-page-formatters";
import {
	LocalAgentsCard,
	type LocalAgentsCardOwnerProps,
} from "./agents-page-local-agents";

const CHATGPT_APP_INSTALLATION_NAME = /ChatGPT app/;
const CHATGPT_APP_INSTALLATION_SUMMARY =
	/Authenticated.*v0\.38\.0.*ChatGPT app/u;
const NVM_INSTALLATION_SUMMARY = /Authenticated.*v0\.38\.0.*nvm install/u;
const LOW_CODEX_USAGE_GAUGE_NAME = /Codex 5-hour usage, 16% left, Low/u;
const OWNED_USAGE_SUMMARY_ORDER = /16%.*v0\.38\.0/u;
const TEAM_USAGE_SUMMARY_ORDER = /16%.*v0\.148\.0/u;
const LOW_CODEX_USAGE_SUMMARY_NAME = /Codex usage limits, 16% left, Low/u;
const LOCAL_AGENT_ROW_TEST_ID =
	/^settings-local-agent-row-(?:codex|claude-code|grok-build|cursor|opencode)$/u;

const toastMock = vi.hoisted(() =>
	Object.assign(vi.fn(), {
		error: vi.fn(),
		info: vi.fn(),
		success: vi.fn(),
		warning: vi.fn(),
	})
);

const {
	readCurrentLocalAgentInstallationsMock,
	selectCurrentLocalAgentInstallationMock,
} = vi.hoisted(() => ({
	readCurrentLocalAgentInstallationsMock: vi.fn(),
	selectCurrentLocalAgentInstallationMock: vi.fn(),
}));

vi.mock("#/lib/connect/local-runtimes", async () => {
	const actual = await vi.importActual<
		typeof import("#/lib/connect/local-runtimes")
	>("#/lib/connect/local-runtimes");
	return {
		...actual,
		readPeopleComputerLocalAgentInstallations:
			readCurrentLocalAgentInstallationsMock,
		selectPeopleComputerLocalAgentInstallation:
			selectCurrentLocalAgentInstallationMock,
	};
});

vi.mock("sonner", () => ({
	toast: toastMock,
}));

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		className,
		to,
	}: {
		children: ReactNode;
		className?: string;
		to: string;
	}) => (
		<a className={className} href={to}>
			{children}
		</a>
	),
}));

vi.mock("#/lib/organizations/organization-context", () => ({
	useCurrentOrganizationSlug: () => "acme",
}));

const READY_REPLY_READINESS: ComputerReplyReadiness = {
	detailReasonCode: null,
	executionTargetStatus: "ready",
	reasonCode: "ready",
	service: null,
	status: "ready",
};
const NEEDS_LOCAL_AGENT_REPLY_READINESS: ComputerReplyReadiness = {
	detailReasonCode: null,
	executionTargetStatus: "ready",
	reasonCode: "local_agent_preparation.not_enabled",
	service: null,
	status: "needs_setup",
};
const SERVICE_UPDATE_REPLY_READINESS: ComputerReplyReadiness = {
	detailReasonCode: null,
	executionTargetStatus: "ready",
	reasonCode: "background_helper.update_required",
	service: null,
	status: "needs_repair",
};
const SERVICE_NOT_CONNECTED_REPLY_READINESS: ComputerReplyReadiness = {
	detailReasonCode: null,
	executionTargetStatus: "unknown",
	reasonCode: "background_helper.not_running",
	service: null,
	status: "needs_repair",
};
const PARTIAL_TARGET_REPLY_READINESS: ComputerReplyReadiness = {
	detailReasonCode: null,
	executionTargetStatus: "partial",
	reasonCode: "execution_target.partial",
	service: null,
	status: "needs_repair",
};
const UNKNOWN_TARGET_REPLY_READINESS: ComputerReplyReadiness = {
	detailReasonCode: null,
	executionTargetStatus: "unknown",
	reasonCode: "execution_target.unknown",
	service: null,
	status: "unknown",
};

describe("LocalAgentsCard", () => {
	afterEach(() => {
		cleanup();
		vi.useRealTimers();
		vi.clearAllMocks();
	});

	it("uses the shared product order for owned and teammate local agents", () => {
		const localAgentCatalogEntries: LocalRuntimeExecutionTarget["localAgentCatalog"]["entries"] =
			[
				["opencode", "OpenCode"],
				["cursor", "Cursor"],
				["grok-build", "Grok Build"],
				["claude-code", "Claude Code"],
				["codex", "Codex"],
			].map(([agentId, displayName]) => ({
				agentId,
				detected: true,
				displayName,
				enabled: true,
				lifecycleStatus: "active",
				launchStatus: "ready",
				selectable: true,
				selectableReason: null,
				targetKind: "builtin",
			}));
		const expectedOrder = [
			"settings-local-agent-row-codex",
			"settings-local-agent-row-claude-code",
			"settings-local-agent-row-grok-build",
			"settings-local-agent-row-opencode",
			"settings-local-agent-row-cursor",
		];
		renderLocalAgentsCard({
			localAgentCatalogEntries,
			setEnabledSupported: true,
		});
		expect(
			screen
				.getAllByTestId(LOCAL_AGENT_ROW_TEST_ID)
				.map((row) => row.getAttribute("data-testid"))
		).toEqual(expectedOrder);
		cleanup();

		render(
			<TooltipProvider>
				<LocalAgentsCard
					computer={{
						deviceDisplayName: "Maya's Mac",
						localAgents: localAgentCatalogEntries.map((entry) => ({
							agentId: entry.agentId,
							displayName: entry.displayName,
							enabled: entry.enabled,
							status: "ready" as const,
						})),
					}}
					view="team"
				/>
			</TooltipProvider>
		);
		expect(
			screen
				.getAllByTestId(LOCAL_AGENT_ROW_TEST_ID)
				.map((row) => row.getAttribute("data-testid"))
		).toEqual(expectedOrder);
	});

	it("keeps usage in existing owned and teammate agent rows", () => {
		const usageLimits: NonNullable<
			AgentControllerInterfaceSnapshot["usageLimits"]
		> = [
			{
				key: "codex:primary",
				label: "5-hour usage",
				observedAt: "2026-08-20T07:55:00.000Z",
				resetsAt: "2026-08-20T12:00:00.000Z",
				status: "available",
				usedPercent: 84,
			},
		];
		renderLocalAgentsCard({
			includeAgentControllerInterface: true,
			setEnabledSupported: true,
			usageLimits,
		});

		const ownedRow = screen.getByTestId("settings-local-agent-row-codex");
		const ownedSummary = within(ownedRow).getByRole("progressbar", {
			name: LOW_CODEX_USAGE_SUMMARY_NAME,
		});
		expect(ownedSummary.textContent).toBe("16%");
		expect(ownedSummary.getAttribute("aria-valuenow")).toBe("16");
		expect(ownedSummary.getAttribute("aria-valuetext")).toBe("16% left");
		expect(ownedRow.textContent).toMatch(OWNED_USAGE_SUMMARY_ORDER);
		fireEvent.click(
			within(ownedRow).getByRole("button", { name: "Codex details" })
		);
		expect(
			screen.getByRole("progressbar", {
				name: LOW_CODEX_USAGE_GAUGE_NAME,
			})
		).toBeTruthy();
		cleanup();

		const details: OrganizationComputerLocalAgentDetails = {
			capabilities: {
				approvals: true,
				cancel: true,
				interrupt: true,
				modelSelection: true,
				nativeEventStream: true,
				permissionModes: true,
				structuredUserInput: false,
			},
			checkedAt: "2026-08-20T08:00:00.000Z",
			launch: { installChoiceCount: 1, status: "ready" },
			models: [{ displayName: "GPT-5.5" }],
			nativeInterface: "codex-app-server",
			status: "ready",
			usageLimits,
			version: "0.148.0",
		};
		render(
			<TooltipProvider>
				<LocalAgentsCard
					computer={{
						deviceDisplayName: "Maya's Mac",
						localAgents: [
							{
								agentId: "codex",
								details,
								displayName: "Codex",
								enabled: true,
								status: "ready",
							},
						],
					}}
					view="team"
				/>
			</TooltipProvider>
		);

		const teammateRow = screen.getByTestId("settings-local-agent-row-codex");
		const teammateSummary = within(teammateRow).getByRole("progressbar", {
			name: LOW_CODEX_USAGE_SUMMARY_NAME,
		});
		expect(teammateSummary.textContent).toBe("16%");
		expect(teammateSummary.getAttribute("aria-valuenow")).toBe("16");
		expect(teammateSummary.getAttribute("aria-valuetext")).toBe("16% left");
		expect(teammateRow.textContent).toMatch(TEAM_USAGE_SUMMARY_ORDER);
		expect(
			screen
				.getByRole("switch", { name: "Codex local agent" })
				.hasAttribute("data-disabled")
		).toBe(true);
		fireEvent.click(
			within(teammateRow).getByRole("button", { name: "Codex details" })
		);
		expect(
			screen.getByRole("progressbar", {
				name: LOW_CODEX_USAGE_GAUGE_NAME,
			})
		).toBeTruthy();
	});

	it("does not advertise unsupported usage in collapsed agent rows", () => {
		renderLocalAgentsCard({
			includeAgentControllerInterface: true,
			setEnabledSupported: true,
			usageLimits: [
				{
					key: "codex:usage-limits",
					label: "Usage limits",
					observedAt: "2026-08-20T07:55:00.000Z",
					resetsAt: null,
					status: "unsupported",
					usedPercent: null,
				},
			],
		});

		const ownedRow = screen.getByTestId("settings-local-agent-row-codex");
		expect(
			within(ownedRow).queryByTestId("local-agent-usage-summary")
		).toBeNull();
		expect(ownedRow.textContent).not.toContain("Usage unsupported");
	});

	it("confirms before disabling a supported installed local agent", async () => {
		const setLocalAgentEnabled = vi.fn().mockResolvedValue(undefined);

		renderLocalAgentsCard({
			setEnabledSupported: true,
			setLocalAgentEnabled,
		});

		expect(screen.getAllByText("Codex").length).toBeGreaterThan(0);
		expect(
			screen.getByText(
				"OpenMeld can use the local agents that are turned on for this computer. Turning an agent off stops OpenMeld from launching it."
			)
		).toBeTruthy();
		expect(screen.queryByText("Installed")).toBeNull();
		expect(screen.queryByText("OpenClaw")).toBeNull();

		fireEvent.click(screen.getByRole("switch", { name: "Codex local agent" }));

		expect(setLocalAgentEnabled).not.toHaveBeenCalled();
		expect(screen.getByText("Disable Codex?")).toBeTruthy();
		expect(
			screen.getByText(
				"OpenMeld will stop launching Codex on this computer. Agent Profiles that use Codex may not wake until you enable it again."
			)
		).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Disable Codex" }));

		await waitFor(() => {
			expect(setLocalAgentEnabled).toHaveBeenCalledWith({
				agentId: "codex",
				deviceId: "device-macbook-pro",
				runtimeLane: "dev-local",
				enabled: false,
			});
		});
	});

	it("enables a supported local agent without confirmation", async () => {
		const setLocalAgentEnabled = vi.fn(
			() => new Promise<void>(() => undefined)
		);

		renderLocalAgentsCard({
			codexEnabled: false,
			setEnabledSupported: true,
			setLocalAgentEnabled,
		});

		const switchControl = screen.getByRole("switch", {
			name: "Codex local agent",
		});
		expect(switchControl.getAttribute("aria-checked")).toBe("false");

		fireEvent.click(switchControl);

		expect(
			screen
				.getByRole("switch", { name: "Codex local agent" })
				.getAttribute("aria-checked")
		).toBe("true");

		await waitFor(() => {
			expect(setLocalAgentEnabled).toHaveBeenCalledWith({
				agentId: "codex",
				deviceId: "device-macbook-pro",
				runtimeLane: "dev-local",
				enabled: true,
			});
		});
		expect(screen.queryByText("Disable Codex?")).toBeNull();
	});

	it.each([
		1, 2,
	])("lets the owner switch installations when inventory reports %i choices", async (installChoiceCount) => {
		const refreshAll = vi.fn().mockResolvedValue(undefined);
		readCurrentLocalAgentInstallationsMock.mockResolvedValue({
			agentId: "codex",
			installations: [
				{
					details: "v0.38.0 · Signed in · Node 24.14.0",
					installationId: "install-nvm",
					name: "nvm install",
					selected: true,
				},
				{
					details: "v0.37.0 · Signed in · ChatGPT",
					installationId: "install-chatgpt",
					name: "ChatGPT app",
					selected: false,
				},
			],
			selectionStatus: "available",
			selectedInstallationId: "install-nvm",
		});
		selectCurrentLocalAgentInstallationMock.mockResolvedValue({
			agentId: "codex",
			changed: true,
			installations: [
				{
					details: "v0.38.0 · Signed in · Node 24.14.0",
					installationId: "install-nvm",
					name: "nvm install",
					selected: false,
				},
				{
					details: "v0.37.0 · Signed in · ChatGPT",
					installationId: "install-chatgpt",
					name: "ChatGPT app",
					selected: true,
				},
			],
			localRuntimes: {
				currentDeviceId: "device-macbook-pro",
				currentRuntimeLane: "dev-local",
				localRuntimes: [],
			},
			reportSyncStatus: "submitted",
			selectionStatus: "available",
			selectedInstallationId: "install-chatgpt",
			status: "updated",
		});

		renderLocalAgentsCard({
			includeAgentControllerInterface: true,
			installChoiceCount,
			manageInstallationsSupported: true,
			refreshAll,
			setEnabledSupported: true,
			usageLimits: [
				{
					key: "codex:primary",
					label: "5-hour usage",
					observedAt: "2026-08-20T07:55:00.000Z",
					resetsAt: "2026-08-20T12:00:00.000Z",
					status: "available",
					usedPercent: 84,
				},
			],
		});
		const row = screen.getByTestId("settings-local-agent-row-codex");
		await waitFor(() => {
			expect(row.textContent).toMatch(NVM_INSTALLATION_SUMMARY);
		});
		fireEvent.click(within(row).getByRole("button", { name: "Codex details" }));
		const agentDialog = screen.getByRole("dialog");
		expect(
			Array.from(
				agentDialog.querySelectorAll("dt"),
				(element) => element.textContent
			).slice(0, 2)
		).toEqual(["Controller", "Launch check"]);

		const launchCheckLabel = within(agentDialog).getByText("Launch check");
		const launchCheckValue = launchCheckLabel.nextElementSibling;
		expect(launchCheckValue).toBeTruthy();
		expect(launchCheckValue?.textContent).toContain("Can launch");
		expect(
			within(launchCheckValue as HTMLElement).queryByRole("button")
		).toBeNull();

		const installationHeading = within(agentDialog).getByRole("heading", {
			name: "Installation",
		});
		const usageHeading = within(agentDialog).getByText("Usage limits");
		const dialogElements = Array.from(agentDialog.querySelectorAll("*"));
		expect(dialogElements.indexOf(installationHeading)).toBeLessThan(
			dialogElements.indexOf(usageHeading)
		);
		expect(
			within(agentDialog).getByText("Used for new Codex work on this computer.")
		).toBeTruthy();
		const installationSelect = within(agentDialog).getByRole("combobox", {
			name: "Codex installation",
		});
		expect(installationSelect.textContent).toContain("nvm install · v0.38.0");
		fireEvent.click(installationSelect);
		fireEvent.click(
			await screen.findByRole("option", {
				name: CHATGPT_APP_INSTALLATION_NAME,
			})
		);
		expect(selectCurrentLocalAgentInstallationMock).not.toHaveBeenCalled();
		expect(
			within(agentDialog).getByText("Switch Codex to ChatGPT app?")
		).toBeTruthy();
		fireEvent.click(
			within(agentDialog).getByRole("button", { name: "Cancel" })
		);
		expect(
			within(agentDialog).queryByText("Switch Codex to ChatGPT app?")
		).toBeNull();

		fireEvent.click(installationSelect);
		fireEvent.click(
			await screen.findByRole("option", {
				name: CHATGPT_APP_INSTALLATION_NAME,
			})
		);
		fireEvent.click(
			within(agentDialog).getByRole("button", {
				name: "Switch installation",
			})
		);

		await waitFor(() => {
			expect(selectCurrentLocalAgentInstallationMock).toHaveBeenCalledWith({
				agentId: "codex",
				deviceId: "device-macbook-pro",
				runtimeLane: "dev-local",
				installationId: "install-chatgpt",
			});
			expect(refreshAll).toHaveBeenCalledTimes(1);
		});
		expect(toastMock.success).toHaveBeenCalledWith(
			"Codex now uses ChatGPT app."
		);
	});

	it("offers the sole verified replacement when the saved installation is gone", async () => {
		readCurrentLocalAgentInstallationsMock.mockResolvedValue({
			agentId: "codex",
			installations: [
				{
					installationId: "install-nvm",
					name: "nvm install",
					details: "v0.150.1 · Signed in",
					selected: false,
				},
			],
			selectionStatus: "available",
			selectedInstallationId: null,
		});
		renderLocalAgentsCard({
			includeAgentControllerInterface: true,
			installChoiceCount: 1,
			manageInstallationsSupported: true,
			setEnabledSupported: true,
		});
		fireEvent.click(screen.getByRole("button", { name: "Codex details" }));
		const dialog = screen.getByRole("dialog");
		fireEvent.click(
			await within(dialog).findByRole("combobox", {
				name: "Codex installation",
			})
		);
		fireEvent.click(await screen.findByRole("option"));
		expect(
			within(dialog).getByText("Switch Codex to nvm install?")
		).toBeTruthy();
		expect(
			within(dialog).getByRole("button", { name: "Switch installation" })
		).toBeTruthy();
	});

	it("prevents installation changes while the agent has work in progress", async () => {
		readCurrentLocalAgentInstallationsMock.mockResolvedValue({
			agentId: "codex",
			installations: [
				{
					details: "v0.38.0 · Signed in · Node 24.14.0",
					installationId: "install-nvm",
					name: "nvm install",
					selected: true,
				},
				{
					details: "v0.37.0 · Signed in · ChatGPT",
					installationId: "install-chatgpt",
					name: "ChatGPT app",
					selected: false,
				},
			],
			selectionStatus: "blocked_by_work",
			selectedInstallationId: "install-nvm",
		});

		renderLocalAgentsCard({
			includeAgentControllerInterface: true,
			installChoiceCount: 2,
			manageInstallationsSupported: true,
			setEnabledSupported: true,
		});
		fireEvent.click(
			screen.getByRole("button", {
				name: "Codex details",
			})
		);
		const dialog = screen.getByRole("dialog");
		const installationSelect = await within(dialog).findByRole("combobox", {
			name: "Codex installation",
		});
		expect(installationSelect.getAttribute("disabled")).not.toBeNull();
		expect(
			within(dialog).getByText(
				"Codex has work in progress. Wait until it finishes before changing installations."
			)
		).toBeTruthy();
		expect(selectCurrentLocalAgentInstallationMock).not.toHaveBeenCalled();
	});

	it("reconciles a slow installation switch instead of showing a timeout", async () => {
		const nvmInstallation = {
			details: "v0.38.0 · Signed in · Node 24.14.0",
			installationId: "install-nvm",
			name: "nvm install",
			selected: true,
		};
		const chatGptInstallation = {
			details: "v0.37.0 · Signed in · ChatGPT",
			installationId: "install-chatgpt",
			name: "ChatGPT app",
			selected: false,
		};
		readCurrentLocalAgentInstallationsMock.mockReset();
		readCurrentLocalAgentInstallationsMock
			.mockResolvedValueOnce({
				agentId: "codex",
				installations: [nvmInstallation, chatGptInstallation],
				selectionStatus: "available",
				selectedInstallationId: "install-nvm",
			})
			.mockResolvedValueOnce({
				agentId: "codex",
				installations: [nvmInstallation, chatGptInstallation],
				selectionStatus: "available",
				selectedInstallationId: "install-nvm",
			})
			.mockResolvedValue({
				agentId: "codex",
				installations: [
					{ ...nvmInstallation, selected: false },
					{ ...chatGptInstallation, selected: true },
				],
				selectionStatus: "available",
				selectedInstallationId: "install-chatgpt",
			});
		selectCurrentLocalAgentInstallationMock.mockReset();
		selectCurrentLocalAgentInstallationMock.mockRejectedValue({
			code: "local_agent_control.timeout",
			status: 504,
		});

		renderLocalAgentsCard({
			includeAgentControllerInterface: true,
			installChoiceCount: 2,
			manageInstallationsSupported: true,
			refreshAll: vi.fn().mockResolvedValue(undefined),
			setEnabledSupported: true,
		});
		const row = screen.getByTestId("settings-local-agent-row-codex");
		await waitFor(() => {
			expect(row.textContent).toMatch(NVM_INSTALLATION_SUMMARY);
		});
		fireEvent.click(screen.getByRole("button", { name: "Codex details" }));
		fireEvent.click(
			screen.getByRole("combobox", { name: "Codex installation" })
		);
		fireEvent.click(
			await screen.findByRole("option", {
				name: CHATGPT_APP_INSTALLATION_NAME,
			})
		);
		fireEvent.click(
			screen.getByRole("button", { name: "Switch installation" })
		);

		await waitFor(() => {
			expect(toastMock.success).toHaveBeenCalledWith(
				"Codex now uses ChatGPT app."
			);
		});
		expect(
			screen.queryByText(
				"Timed out waiting for the local OpenMeld Service response."
			)
		).toBeNull();
		expect(row.textContent).toMatch(CHATGPT_APP_INSTALLATION_SUMMARY);
	});

	it("presents a disabled runnable agent as quiet without setup guidance", () => {
		renderLocalAgentsCard({
			agentControllerAuth: {
				status: "unauthenticated",
				type: "none",
			},
			agentControllerStatus: "error",
			codexEnabled: false,
			includeAgentControllerInterface: true,
			replyReadiness: NEEDS_LOCAL_AGENT_REPLY_READINESS,
			setEnabledSupported: true,
		});

		expect(
			screen.queryByText(
				"Connect a local agent so OpenMeld can refresh the local agents on this computer."
			)
		).toBeNull();
		const row = screen.getByTestId("settings-local-agent-row-codex");
		expect(row.getAttribute("data-muted")).toBe("true");
		expect(within(row).queryByText("Turn on")).toBeNull();
		expect(within(row).queryByText("Sign in required")).toBeNull();
		expect(within(row).queryByText("Not authenticated · v0.38.0")).toBeNull();
		expect(within(row).queryByText("Error")).toBeNull();
		expect(within(row).queryByText("Connect local agent")).toBeNull();
		expect(
			within(row)
				.getByTestId("local-agent-logo-codex")
				.parentElement?.classList.contains("text-muted-foreground")
		).toBe(true);
		expect(
			within(row)
				.getByTestId("settings-local-agent-row-trigger")
				.querySelector("p")
				?.classList.contains("text-muted-foreground")
		).toBe(true);
		fireEvent.click(within(row).getByRole("button", { name: "Codex details" }));
		expect(
			within(screen.getByRole("dialog"))
				.getByText("Built-in local agent found on this computer.")
				.classList.contains("text-muted-foreground")
		).toBe(true);
	});

	it("reconciles a slow local agent change before reporting a failure", async () => {
		const setLocalAgentEnabled = vi.fn().mockRejectedValue({
			code: "local_agent_control.timeout",
			status: 504,
		});
		const refreshAll = vi.fn().mockResolvedValue(undefined);
		const { executionTarget } = renderLocalAgentsCard({
			refreshAll,
			setEnabledSupported: true,
			setLocalAgentEnabled,
		});
		refreshAll.mockImplementation(() => {
			const codex = executionTarget.localAgentCatalog.entries.find(
				(entry) => entry.agentId === "codex"
			);
			if (codex) {
				codex.enabled = false;
			}
			return Promise.resolve();
		});

		fireEvent.click(screen.getByRole("switch", { name: "Codex local agent" }));
		fireEvent.click(screen.getByRole("button", { name: "Disable Codex" }));

		await waitFor(() => {
			expect(refreshAll).toHaveBeenCalled();
		});
		expect(
			screen.queryByText("OpenMeld could not change this local agent.")
		).toBeNull();
		expect(
			screen
				.getByRole("switch", { name: "Codex local agent" })
				.getAttribute("aria-checked")
		).toBe("false");
	});

	it("hides suspended local agents that have not been enabled on this computer", () => {
		renderLocalAgentsCard({
			openClawEnabled: false,
			openClawLaunchStatus: "ready",
			openClawLifecycleStatus: "suspended",
			openClawSelectable: true,
			setEnabledSupported: true,
		});

		expect(screen.queryByText("OpenClaw")).toBeNull();
		expect(screen.queryByText("Suspended")).toBeNull();
	});

	it("keeps enabled suspended local agents visible for existing users", () => {
		renderLocalAgentsCard({
			openClawEnabled: true,
			openClawLaunchStatus: "needs_repair",
			openClawLifecycleStatus: "suspended",
			openClawSelectable: true,
			replyReadiness: NEEDS_LOCAL_AGENT_REPLY_READINESS,
			setEnabledSupported: true,
		});

		const row = screen.getByTestId("settings-local-agent-row-openclaw");
		expect(within(row).getAllByText("OpenClaw").length).toBeGreaterThan(0);
		const suspendedLabel = within(row).getByText("Suspended");
		expect(suspendedLabel.getAttribute("data-slot")).not.toBe("badge");
		expect(suspendedLabel.className).toContain("text-amber");
		expect(within(row).queryByText("Needs setup")).toBeNull();
		expect(screen.queryByText("Connect local agent")).toBeNull();
		expect(
			within(row)
				.getByRole("switch", { name: "OpenClaw local agent" })
				.getAttribute("aria-checked")
		).toBe("true");
		fireEvent.click(
			within(row).getByRole("button", { name: "OpenClaw details" })
		);
		expect(
			within(screen.getByRole("dialog")).getByText(
				"OpenMeld keeps this existing controller setting on this computer."
			)
		).toBeTruthy();
	});

	it("shows active setup repair inline without a service-level connect prompt", () => {
		renderLocalAgentsCard({
			openClawEnabled: true,
			openClawLaunchStatus: "needs_repair",
			openClawLifecycleStatus: "active",
			openClawSelectable: true,
			replyReadiness: NEEDS_LOCAL_AGENT_REPLY_READINESS,
			setEnabledSupported: true,
		});

		expect(
			screen.queryByText(
				"Connect a local agent so OpenMeld can refresh the local agents on this computer."
			)
		).toBeNull();
		expect(screen.queryByText("Connect local agent")).toBeNull();
		const row = screen.getByTestId("settings-local-agent-row-openclaw");
		const setupLabel = within(row).getByText("Can’t start");
		expect(setupLabel.getAttribute("data-slot")).not.toBe("badge");
		expect(setupLabel.className).toContain("text-destructive");
		fireEvent.click(
			within(row).getByRole("button", { name: "OpenClaw details" })
		);
		expect(
			within(screen.getByRole("dialog")).getByText(
				"The selected OpenClaw installation can’t start. Check the installation or choose another one."
			)
		).toBeTruthy();
	});

	it("keeps per-agent issues inline when a partially ready target reports rows", () => {
		renderLocalAgentsCard({
			openClawEnabled: true,
			openClawLaunchStatus: "needs_repair",
			openClawLifecycleStatus: "active",
			openClawSelectable: true,
			replyReadiness: PARTIAL_TARGET_REPLY_READINESS,
			setEnabledSupported: true,
			targetStatus: "partial",
		});

		// One broken agent must not hoist a generic connect banner above the
		// healthy rows; the broken row carries its own issue text.
		expect(
			screen.queryByText(
				"Connect a local agent so OpenMeld can refresh the local agents on this computer."
			)
		).toBeNull();
		expect(screen.queryByText("Connect local agent")).toBeNull();
		const row = screen.getByTestId("settings-local-agent-row-openclaw");
		expect(within(row).getByText("Can’t start")).toBeTruthy();
		fireEvent.click(
			within(row).getByRole("button", { name: "OpenClaw details" })
		);
		expect(
			within(screen.getByRole("dialog")).getByText(
				"The selected OpenClaw installation can’t start. Check the installation or choose another one."
			)
		).toBeTruthy();
	});

	it("uses the empty state without a duplicate connect banner when no local agents are reported", () => {
		renderLocalAgentsCard({
			localAgentCatalogEntries: [],
			replyReadiness: UNKNOWN_TARGET_REPLY_READINESS,
			setEnabledSupported: true,
			targetStatus: "unknown",
		});

		expect(screen.queryByText("Connect local agent")).toBeNull();
		expect(
			screen.queryByText(
				"Connect a local agent so OpenMeld can refresh the local agents on this computer."
			)
		).toBeNull();
		expect(screen.getByTestId("local-agent-catalog-empty")).toBeTruthy();
		expect(screen.queryByText("No supported agents detected")).toBeNull();
		expect(screen.queryByLabelText("Supported agents")).toBeNull();
		expect(
			screen.getByRole("link", { name: "See the install guide" })
		).toBeTruthy();
	});

	it("shows service update dependency as a quiet Local agents note", () => {
		renderLocalAgentsCard({
			replyReadiness: SERVICE_UPDATE_REPLY_READINESS,
			setEnabledSupported: true,
		});

		const note = screen.getByText(
			"Local agents will refresh after OpenMeld Service is updated."
		);
		expect(note.className).toContain("text-foreground");
		expect(
			screen.queryByRole("link", { name: "Update OpenMeld Service" })
		).toBeNull();
		expect(
			screen.queryByRole("button", { name: "Local agents options" })
		).toBeNull();
		expect(
			screen
				.getByRole("switch", { name: "Codex local agent" })
				.hasAttribute("data-disabled")
		).toBe(true);
		const row = screen.getByTestId("settings-local-agent-row-codex");
		expect(row.getAttribute("data-muted")).toBe("true");
		expect(row.querySelector("p")?.textContent).toBe("Codex");
		// Keep the saved preference, but do not present old agent facts as live.
		expect(within(row).getByText("Waiting for computer update")).toBeTruthy();
		expect(row.querySelector("p")?.className).toContain(
			"text-muted-foreground"
		);
		expect(
			within(row).getByTestId("local-agent-logo-codex").parentElement?.className
		).toContain("opacity-50");
	});

	it("shows service reconnect dependency as a quiet Local agents note", () => {
		renderLocalAgentsCard({
			replyReadiness: SERVICE_NOT_CONNECTED_REPLY_READINESS,
			setEnabledSupported: true,
		});

		const note = screen.getByText(
			"Local agents will refresh after this computer reconnects."
		);
		expect(note.className).toContain("text-foreground");
		expect(
			screen.queryByRole("link", { name: "Reconnect Computer" })
		).toBeNull();
		expect(
			screen.queryByRole("button", { name: "Local agents options" })
		).toBeNull();
		expect(
			screen
				.getByRole("switch", { name: "Codex local agent" })
				.hasAttribute("data-disabled")
		).toBe(true);
		const row = screen.getByTestId("settings-local-agent-row-codex");
		expect(row.getAttribute("data-muted")).toBe("true");
		expect(row.querySelector("p")?.textContent).toBe("Codex");
		expect(within(row).getByText("Disconnected")).toBeTruthy();
		expect(within(row).queryByText("Can’t start")).toBeNull();
		expect(row.querySelector("p")?.className).toContain(
			"text-muted-foreground"
		);
		expect(
			within(row).getByTestId("local-agent-logo-codex").parentElement?.className
		).toContain("opacity-50");
	});

	it("does not show historical agent readiness as live on a non-current computer", () => {
		renderLocalAgentsCard({
			hasSelectedEnvironment: false,
			setEnabledSupported: true,
		});
		const row = screen.getByTestId("settings-local-agent-row-codex");
		expect(within(row).getByText("Status unavailable")).toBeTruthy();
		expect(within(row).queryByText("Ready")).toBeNull();
		expect(row.getAttribute("data-muted")).toBe("true");
		expect(
			screen
				.getByRole("switch", { name: "Codex local agent" })
				.hasAttribute("data-disabled")
		).toBe(true);
	});

	it("does not reuse a ready agent report when the current connection query fails", () => {
		renderLocalAgentsCard({
			setEnabledSupported: true,
			replyReadiness: {
				status: "unknown",
				reasonCode: "device_reply_readiness.unknown",
				detailReasonCode: null,
				executionTargetStatus: null,
				service: null,
			},
		});
		const row = screen.getByTestId("settings-local-agent-row-codex");
		expect(within(row).getByText("Status unavailable")).toBeTruthy();
		expect(within(row).queryByText("Ready")).toBeNull();
		expect(within(row).queryByText("Disconnected")).toBeNull();
		expect(
			screen
				.getByRole("switch", { name: "Codex local agent" })
				.hasAttribute("data-disabled")
		).toBe(true);
	});

	it("shows checking instead of old failures while computer status is reconciling", () => {
		renderLocalAgentsCard({
			isReconcilingStatus: true,
			setEnabledSupported: true,
			replyReadiness: SERVICE_NOT_CONNECTED_REPLY_READINESS,
		});
		const row = screen.getByTestId("settings-local-agent-row-codex");
		expect(within(row).getByText("Checking")).toBeTruthy();
		expect(within(row).queryByText("Can’t start")).toBeNull();
		expect(
			screen.queryByRole("link", { name: "Reconnect Computer" })
		).toBeNull();
	});

	it("lets users manually check local agents", async () => {
		const refreshLocalAgentCatalog = vi.fn().mockResolvedValue(undefined);

		renderLocalAgentsCard({
			refreshLocalAgentCatalog,
			refreshCatalogSupported: true,
			setEnabledSupported: true,
		});

		fireEvent.click(
			screen.getByRole("button", { name: "Local agents options" })
		);
		fireEvent.click(screen.getByRole("menuitem", { name: "Check agents" }));

		await waitFor(() => {
			expect(refreshLocalAgentCatalog).toHaveBeenCalledTimes(1);
		});
		expect(toastMock.success).toHaveBeenCalledWith(
			"Local agent check complete."
		);
	});

	it("keeps checking canonical status after the control request times out", async () => {
		vi.useFakeTimers();
		const refreshLocalAgentCatalog = vi.fn().mockRejectedValue({
			code: "local_agent_control.timeout",
			message: "The current local OpenMeld Service did not respond in time.",
			status: 504,
		});
		const refreshAll = vi.fn().mockResolvedValue(undefined);

		renderLocalAgentsCard({
			refreshAll,
			refreshCatalogSupported: true,
			refreshLocalAgentCatalog,
			setEnabledSupported: true,
		});

		fireEvent.click(
			screen.getByRole("button", { name: "Local agents options" })
		);
		fireEvent.click(screen.getByRole("menuitem", { name: "Check agents" }));

		await vi.waitFor(() => {
			expect(refreshAll).toHaveBeenCalled();
		});
		expect(refreshLocalAgentCatalog).toHaveBeenCalledTimes(1);

		fireEvent.click(
			screen.getByRole("button", { name: "Local agents options" })
		);
		expect(screen.getByRole("menuitem", { name: "Checking..." })).toBeTruthy();
		expect(toastMock.error).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(12_000);
		expect(refreshAll.mock.calls.length).toBeGreaterThan(1);
		expect(toastMock.error).not.toHaveBeenCalled();
		expect(toastMock.info).toHaveBeenCalledWith(
			"Some agent checks have not returned yet. Check their status in a moment."
		);
	});

	it("reports refreshed status when enabled observations advance while disabled agents have no check", async () => {
		const refreshLocalAgentCatalog = vi.fn().mockRejectedValue({
			code: "local_agent_control.timeout",
			message: "The current local OpenMeld Service did not respond in time.",
			status: 504,
		});
		const refreshAll = vi.fn().mockResolvedValue(undefined);
		const { executionTarget } = renderLocalAgentsCard({
			includeAgentControllerInterface: true,
			refreshAll,
			refreshCatalogSupported: true,
			refreshLocalAgentCatalog,
			setEnabledSupported: true,
		});
		executionTarget.capabilities.push({
			agentControllerRef: "builtin:claude-code",
			agentControllerInterface: null,
			enabled: false,
			reasonCodes: ["local_agent_preparation.not_enabled"],
			status: "not_ready",
		});
		refreshAll.mockImplementation(() => {
			const controller =
				executionTarget.capabilities[0]?.agentControllerInterface;
			if (controller) {
				controller.checkedAt = "2026-06-28T12:00:01.000Z";
			}
			return Promise.resolve();
		});

		fireEvent.click(
			screen.getByRole("button", { name: "Local agents options" })
		);
		fireEvent.click(screen.getByRole("menuitem", { name: "Check agents" }));

		await waitFor(() => {
			expect(toastMock.success).toHaveBeenCalledWith(
				"Local agent status refreshed."
			);
		});
		expect(toastMock.error).not.toHaveBeenCalled();
	});

	it.each([
		"partial",
		"different_device",
		"different_lane",
	])("does not complete a slow check from %s observations", async (scenario) => {
		vi.useFakeTimers();
		const refreshAll = vi.fn().mockResolvedValue(undefined);
		const { executionTarget } = renderLocalAgentsCard({
			includeAgentControllerInterface: true,
			refreshAll,
			refreshCatalogSupported: true,
			refreshLocalAgentCatalog: vi.fn().mockRejectedValue({
				code: "local_agent_control.timeout",
				status: 504,
			}),
			setEnabledSupported: true,
		});
		const first = executionTarget.capabilities[0];
		const second = structuredClone(first);
		second.agentControllerRef = "builtin:claude-code";
		if (second.agentControllerInterface) {
			second.agentControllerInterface.agentControllerRef =
				"builtin:claude-code";
		}
		executionTarget.capabilities.push(second);
		refreshAll.mockImplementation(() => {
			if (first.agentControllerInterface) {
				first.agentControllerInterface.checkedAt = "2026-06-28T12:00:01.000Z";
			}
			if (scenario !== "partial" && second.agentControllerInterface) {
				second.agentControllerInterface.checkedAt = "2026-06-28T12:00:01.000Z";
			}
			if (scenario === "different_device") {
				executionTarget.deviceId = "another-device";
			}
			if (scenario === "different_lane") {
				executionTarget.runtimeLane = "canary";
			}
			return Promise.resolve();
		});
		fireEvent.click(
			screen.getByRole("button", { name: "Local agents options" })
		);
		fireEvent.click(screen.getByRole("menuitem", { name: "Check agents" }));
		await vi.waitFor(() => expect(refreshAll).toHaveBeenCalled());
		await vi.advanceTimersByTimeAsync(12_000);
		expect(toastMock.success).not.toHaveBeenCalled();
	});

	it("reports a definitive check failure with a toast", async () => {
		const refreshLocalAgentCatalog = vi.fn().mockRejectedValue({
			code: "local_agent_control.refresh_catalog_rejected",
			message:
				"The current local OpenMeld Service could not check local agents.",
			status: 409,
		});
		const refreshAll = vi.fn().mockResolvedValue(undefined);

		renderLocalAgentsCard({
			refreshAll,
			refreshCatalogSupported: true,
			refreshLocalAgentCatalog,
			setEnabledSupported: true,
		});

		fireEvent.click(
			screen.getByRole("button", { name: "Local agents options" })
		);
		fireEvent.click(screen.getByRole("menuitem", { name: "Check agents" }));

		await waitFor(() => {
			expect(toastMock.error).toHaveBeenCalledWith(
				"The current local OpenMeld Service could not check local agents."
			);
		});
		expect(refreshAll).not.toHaveBeenCalled();
	});

	it("links to the install guide when no local agents are reported", () => {
		renderLocalAgentsCard({
			localAgentCatalogEntries: [],
			setEnabledSupported: true,
		});

		const guideLink = screen.getByRole("link", {
			name: "See the install guide",
		});
		expect(guideLink.getAttribute("href")).toBe("/guides/local-agents");
		expect(guideLink.className).toContain("touch-manipulation");
		expect(guideLink.className).toContain("max-lg:min-h-11");
		expect(guideLink.className).toContain("max-lg:inline-flex");
		expect(guideLink.classList.contains("inline-flex")).toBe(false);
	});

	it("links to the install guide when every reported local agent is undetected", () => {
		renderLocalAgentsCard({
			localAgentCatalogEntries: [
				{
					agentId: "codex",
					detected: false,
					displayName: "Codex",
					enabled: false,
					lifecycleStatus: "active",
					launchStatus: "not_available",
					selectable: false,
					selectableReason: "not_detected",
					targetKind: "builtin",
				},
			],
			setEnabledSupported: true,
		});
		expect(screen.getByText("No supported agents detected")).toBeTruthy();
		expect(screen.getByLabelText("Supported agents")).toBeTruthy();
		expect(
			screen.queryByText("Connect this computer to check", { exact: false })
		).toBeNull();

		expect(
			screen
				.getByRole("link", { name: "See the install guide" })
				.getAttribute("href")
		).toBe("/guides/local-agents");
	});

	it("hides local agent check actions when catalog refresh is unsupported", () => {
		const refreshLocalAgentCatalog = vi.fn().mockResolvedValue(undefined);

		renderLocalAgentsCard({
			agentControllerMessage:
				"Codex CLI is installed, but OpenMeld could not confirm controller readiness.",
			agentControllerStatus: "error",
			includeAgentControllerInterface: true,
			refreshCatalogSupported: false,
			refreshLocalAgentCatalog,
			setEnabledSupported: true,
		});

		expect(
			screen.queryByRole("button", { name: "Local agents options" })
		).toBeNull();
		expect(screen.queryByRole("menuitem", { name: "Check agents" })).toBeNull();
		const row = screen.getByTestId("settings-local-agent-row-codex");
		fireEvent.click(within(row).getByRole("button", { name: "Codex details" }));
		const agentDialog = screen.getByRole("dialog");
		expect(within(agentDialog).getByText("Issue")).toBeTruthy();
		expect(
			within(agentDialog).queryByRole("button", { name: "Check again" })
		).toBeNull();
		expect(refreshLocalAgentCatalog).not.toHaveBeenCalled();
	});

	it("keeps the switch disabled when Core has not reported current-service support", () => {
		renderLocalAgentsCard({ setEnabledSupported: false });

		const switchControl = screen.getByRole("switch", {
			name: "Codex local agent",
		});
		expect(switchControl.hasAttribute("data-disabled")).toBe(true);
	});

	it("surfaces local agent update failures without flipping to optimistic success", async () => {
		let rejectSetEnabled: (error: Error) => void = () => undefined;
		const setLocalAgentEnabled = vi.fn(
			() =>
				new Promise<void>((_resolve, reject) => {
					rejectSetEnabled = reject;
				})
		);

		renderLocalAgentsCard({
			setEnabledSupported: true,
			setLocalAgentEnabled,
		});

		fireEvent.click(screen.getByRole("switch", { name: "Codex local agent" }));
		fireEvent.click(screen.getByRole("button", { name: "Disable Codex" }));

		expect(
			screen
				.getByRole("switch", { name: "Codex local agent" })
				.getAttribute("aria-checked")
		).toBe("false");

		rejectSetEnabled(new Error("The local OpenMeld Service rejected Codex."));

		await waitFor(() => {
			expect(
				screen.getByText("The local OpenMeld Service rejected Codex.")
			).toBeTruthy();
		});
		expect(
			screen
				.getByRole("switch", { name: "Codex local agent" })
				.getAttribute("aria-checked")
		).toBe("true");
	});

	it("shows Agent Controller Interface details when Core projected them", () => {
		renderLocalAgentsCard({
			includeAgentControllerInterface: true,
			setEnabledSupported: true,
		});

		const summaryEmail = screen.getByTestId(
			"agent-controller-account-email-codex-summary"
		);
		expect(summaryEmail.getAttribute("data-revealed")).toBe("false");
		expect(screen.getByText("Authenticated", { exact: false })).toBeTruthy();
		expect(screen.getByText("· v0.38.0", { exact: false })).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Codex details" }));

		expect(screen.getByText("Codex App Server")).toBeTruthy();
		expect(screen.getByText("GPT-5.5")).toBeTruthy();
		expect(
			screen.getByText(
				"Approvals, Cancel, Model selection, Native event stream, Permission modes"
			)
		).toBeTruthy();
	});

	it("shows controller readiness failures inline without adding a badge", () => {
		const refreshLocalAgentCatalog = vi.fn().mockResolvedValue(undefined);

		renderLocalAgentsCard({
			agentControllerMessage:
				"Codex CLI is installed, but OpenMeld could not confirm controller readiness.",
			agentControllerStatus: "error",
			includeAgentControllerInterface: true,
			refreshCatalogSupported: true,
			refreshLocalAgentCatalog,
			setEnabledSupported: true,
		});

		const row = screen.getByTestId("settings-local-agent-row-codex");
		const setupLabel = within(row).getByText("Needs attention");
		expect(setupLabel.getAttribute("data-slot")).not.toBe("badge");
		expect(setupLabel.className).toContain("text-destructive");
		fireEvent.click(within(row).getByRole("button", { name: "Codex details" }));
		const agentDialog = screen.getByRole("dialog");
		expect(
			within(agentDialog).getAllByText(
				"Codex CLI is installed, but OpenMeld could not confirm controller readiness."
			).length
		).toBeGreaterThan(0);
		expect(within(agentDialog).getByText("Issue")).toBeTruthy();

		fireEvent.click(
			within(agentDialog).getByRole("button", { name: "Check again" })
		);

		expect(refreshLocalAgentCatalog).toHaveBeenCalledTimes(1);
	});

	it("shows a failed controller check without claiming setup needs repair", () => {
		vi.useFakeTimers();
		vi.setSystemTime("2026-06-28T12:00:00.000Z");
		renderLocalAgentsCard({
			agentControllerAuth: { status: "unknown" },
			agentControllerCheck: {
				lastSucceededAt: "2026-06-28T11:55:00.000Z",
				status: "failed",
			},
			agentControllerStatus: "error",
			includeAgentControllerInterface: true,
			setEnabledSupported: true,
		});

		const row = screen.getByTestId("settings-local-agent-row-codex");
		const checkLabel = within(row).getByText("Check delayed");
		expect(checkLabel.className).toContain("text-sky");
		expect(within(row).getByText("Checked 5 minutes ago")).toBeTruthy();
		expect(
			within(row).getByTestId("settings-local-agent-footer").className
		).toContain("justify-between");
		expect(within(row).queryByText("Error")).toBeNull();
		expect(within(row).queryByText("Needs setup")).toBeNull();
		fireEvent.click(within(row).getByRole("button", { name: "Codex details" }));
		const agentDialog = screen.getByRole("dialog");
		expect(
			within(agentDialog).getAllByText(
				"Codex check is delayed. OpenMeld will retry automatically."
			).length
		).toBeGreaterThan(0);
		expect(within(agentDialog).getByText("Checked 5 minutes ago")).toBeTruthy();
		expect(within(agentDialog).queryByText("Last successful check")).toBeNull();
		expect(
			within(agentDialog).getByRole("button", { name: "Check again" })
		).toBeTruthy();
	});

	it("shows an expired controller report as a neutral delay, never as unable to start", () => {
		// Core's projection of a ready report whose native check passed the
		// two-minute freshness window before the next check landed.
		vi.useFakeTimers();
		vi.setSystemTime("2026-10-21T13:10:10.000Z");
		renderLocalAgentsCard({
			agentControllerAuth: { status: "unknown" },
			agentControllerCheck: {
				lastSucceededAt: "2026-10-21T13:08:00.000Z",
				status: "failed",
			},
			agentControllerMessage:
				"Local agent status is out of date. Check the agent again.",
			agentControllerStatus: "warning",
			includeAgentControllerInterface: true,
			setEnabledSupported: true,
		});

		const row = screen.getByTestId("settings-local-agent-row-codex");
		const checkLabel = within(row).getByText("Check delayed");
		expect(checkLabel.className).toContain("text-sky");
		expect(checkLabel.className).not.toContain("text-destructive");
		expect(within(row).queryByText("Can’t start")).toBeNull();
		expect(within(row).queryByText("Needs attention")).toBeNull();
		expect(row.getAttribute("data-muted")).not.toBe("true");
	});

	it("shows a teammate failed controller check as a neutral delay even if the raw snapshot says error", () => {
		const details: OrganizationComputerLocalAgentDetails = {
			capabilities: {
				approvals: true,
				cancel: true,
				interrupt: true,
				modelSelection: true,
				nativeEventStream: true,
				permissionModes: true,
				structuredUserInput: false,
			},
			check: {
				lastSucceededAt: "2026-08-20T07:55:00.000Z",
				status: "failed",
			},
			checkedAt: "2026-08-20T08:00:00.000Z",
			launch: { installChoiceCount: 1, status: "ready" },
			models: [],
			nativeInterface: "local-cli",
			status: "error",
			version: "1.0.0",
		};
		render(
			<TooltipProvider>
				<LocalAgentsCard
					computer={{
						deviceDisplayName: "Maya's Mac",
						localAgents: [
							{
								agentId: "openclaw",
								details,
								displayName: "OpenClaw",
								enabled: true,
								status: "not_ready",
							},
						],
					}}
					view="team"
				/>
			</TooltipProvider>
		);

		const row = screen.getByTestId("settings-local-agent-row-openclaw");
		const checkLabel = within(row).getByText("Check delayed");
		expect(checkLabel.className).toContain("text-sky");
		expect(within(row).queryByText("Error")).toBeNull();
	});

	it("shows the controller-specific not-signed-in guidance for an unauthenticated Codex controller", () => {
		renderLocalAgentsCard({
			agentControllerAuth: { status: "unauthenticated" },
			agentControllerMessage:
				"Codex CLI is installed, but this computer is not signed in to Codex.",
			agentControllerStatus: "unavailable",
			includeAgentControllerInterface: true,
			setEnabledSupported: true,
		});

		const row = screen.getByTestId("settings-local-agent-row-codex");
		expect(within(row).getByText("Not signed in")).toBeTruthy();
		expect(within(row).getByText("v0.38.0")).toBeTruthy();
		expect(
			within(row).queryByText("Not authenticated", { exact: false })
		).toBeNull();
		expect(within(row).queryByText("Error")).toBeNull();
		expect(
			within(row)
				.getByTestId("local-agent-logo-codex")
				.parentElement?.classList.contains("text-muted-foreground")
		).toBe(true);
		expect(
			within(row)
				.getByTestId("settings-local-agent-row-trigger")
				.querySelector("p")
				?.classList.contains("text-muted-foreground")
		).toBe(true);
		fireEvent.click(within(row).getByRole("button", { name: "Codex details" }));
		expect(
			within(screen.getByRole("dialog")).getAllByText(
				"Codex CLI is installed, but this computer is not signed in to Codex."
			).length
		).toBeGreaterThan(0);
	});

	it("explains how to copy and run a local agent update command", () => {
		renderLocalAgentsCard({
			agentControllerVersionAdvisory: {
				checkedAt: "2026-06-28T12:01:00.000Z",
				currentVersion: "0.38.0",
				latestVersion: "0.39.0",
				message: "Update available.",
				status: "behind_latest",
				updateCommand: "codex update",
			},
			includeAgentControllerInterface: true,
			setEnabledSupported: true,
		});

		const row = screen.getByTestId("settings-local-agent-row-codex");
		expect(within(row).getByText("Update available")).toBeTruthy();
		fireEvent.click(within(row).getByRole("button", { name: "Codex details" }));
		const dialog = screen.getByRole("dialog");
		expect(
			within(dialog).getByText(
				"A newer version of Codex is available: v0.39.0."
			)
		).toBeTruthy();
		expect(
			within(dialog).getByText(
				"Copy this command. Then open a terminal on this computer, paste the command, and press Enter."
			)
		).toBeTruthy();
		expect(within(dialog).getAllByText("codex update").length).toBeGreaterThan(
			0
		);
		expect(
			within(dialog).getByRole("button", { name: "Copy command" })
		).toBeTruthy();
	});

	it("tells a beginner what installation choice is required", () => {
		renderLocalAgentsCard({
			openClawEnabled: true,
			openClawLaunchStatus: "needs_choice",
			openClawSelectable: true,
			setEnabledSupported: true,
		});

		const row = screen.getByTestId("settings-local-agent-row-openclaw");
		expect(within(row).getByText("Choose installation")).toBeTruthy();
		fireEvent.click(
			within(row).getByRole("button", { name: "OpenClaw details" })
		);
		expect(
			within(screen.getByRole("dialog")).getByText(
				"OpenMeld found more than one OpenClaw installation. Choose which one to use."
			)
		).toBeTruthy();
	});

	it("shows a teammate provider blocker as unavailable with a muted identity", () => {
		const details: OrganizationComputerLocalAgentDetails = {
			capabilities: {
				approvals: true,
				cancel: true,
				interrupt: true,
				modelSelection: true,
				nativeEventStream: true,
				permissionModes: true,
				structuredUserInput: false,
			},
			checkedAt: "2026-08-20T08:00:00.000Z",
			launch: { installChoiceCount: 1, status: "ready" },
			models: [],
			nativeInterface: "local-cli",
			status: "unavailable",
			version: "1.0.0",
		};
		render(
			<TooltipProvider>
				<LocalAgentsCard
					computer={{
						deviceDisplayName: "Maya's Mac",
						localAgents: [
							{
								agentId: "opencode",
								details,
								displayName: "OpenCode",
								enabled: true,
								status: "not_ready",
							},
						],
					}}
					view="team"
				/>
			</TooltipProvider>
		);

		const row = screen.getByTestId("settings-local-agent-row-opencode");
		expect(within(row).getByText("Unavailable")).toBeTruthy();
		expect(within(row).queryByText("Error")).toBeNull();
		expect(
			within(row)
				.getByTestId("local-agent-logo-opencode")
				.parentElement?.classList.contains("text-muted-foreground")
		).toBe(true);
		expect(
			within(row)
				.getByTestId("settings-local-agent-row-trigger")
				.querySelector("p")
				?.classList.contains("text-muted-foreground")
		).toBe(true);
	});

	it("hides a signed-in account email reported as the controller auth label", () => {
		renderLocalAgentsCard({
			agentControllerAuth: {
				label: "you@example.com",
				status: "authenticated",
				type: "claude",
			},
			includeAgentControllerInterface: true,
			setEnabledSupported: true,
		});

		const summaryEmail = screen.getByTestId(
			"agent-controller-account-email-codex-summary"
		);
		expect(summaryEmail.textContent).toBe("you@example.com");
		expect(summaryEmail.getAttribute("data-revealed")).toBe("false");
		expect(summaryEmail.className).not.toContain("inline-block");
		expect(screen.getByText("Authenticated", { exact: false })).toBeTruthy();
	});

	it("does not repeat generic authenticated controller labels", () => {
		renderLocalAgentsCard({
			agentControllerAuth: {
				label: "Signed in",
				status: "authenticated",
				type: "opencode",
			},
			includeAgentControllerInterface: true,
			setEnabledSupported: true,
		});

		const row = screen.getByTestId("settings-local-agent-row-codex");
		expect(
			within(row).getByText("Authenticated · v0.38.0", { exact: false })
		).toBeTruthy();
		expect(within(row).queryByText("Signed in")).toBeNull();
	});

	it("reveals the Agent Controller account email across summary and details together", () => {
		renderLocalAgentsCard({
			includeAgentControllerInterface: true,
			setEnabledSupported: true,
		});

		fireEvent.click(screen.getByRole("button", { name: "Codex details" }));

		const summaryEmail = screen.getByTestId(
			"agent-controller-account-email-codex-summary"
		);
		const detailEmail = screen.getByTestId(
			"agent-controller-account-email-codex-detail"
		);
		expect(summaryEmail.getAttribute("data-revealed")).toBe("false");
		expect(detailEmail.getAttribute("data-revealed")).toBe("false");

		fireEvent.click(detailEmail);

		expect(summaryEmail.getAttribute("data-revealed")).toBe("true");
		expect(detailEmail.getAttribute("data-revealed")).toBe("true");
	});

	it("keeps the details account email revealed after revealing it from the summary", () => {
		renderLocalAgentsCard({
			includeAgentControllerInterface: true,
			setEnabledSupported: true,
		});

		fireEvent.click(
			screen.getByTestId("agent-controller-account-email-codex-summary")
		);
		fireEvent.click(screen.getByRole("button", { name: "Codex details" }));

		expect(
			screen
				.getByTestId("agent-controller-account-email-codex-summary")
				.getAttribute("data-revealed")
		).toBe("true");
		expect(
			screen
				.getByTestId("agent-controller-account-email-codex-detail")
				.getAttribute("data-revealed")
		).toBe("true");
	});

	it("keeps stale detected local agents off a repeated Last seen badge", () => {
		renderLocalAgentsCard({
			setEnabledSupported: true,
			targetStatus: "stale",
		});

		const row = screen.getByTestId("settings-local-agent-row-codex");
		expect(within(row).queryByText("Last seen")).toBeNull();
		fireEvent.click(within(row).getByRole("button", { name: "Codex details" }));
		expect(
			within(screen.getByRole("dialog")).getByText(
				"Last check found this local agent. Connect this computer to refresh its status."
			)
		).toBeTruthy();
	});
});

describe("isLocalAgentControlStillRunningError", () => {
	it("treats gateway timeouts as still running", () => {
		expect(isLocalAgentControlStillRunningError({ status: 504 })).toBe(true);
		expect(
			isLocalAgentControlStillRunningError({
				code: "local_agent_control.timeout",
			})
		).toBe(true);
		expect(
			isLocalAgentControlStillRunningError({ code: "network.timeout" })
		).toBe(true);
	});

	it("treats explicit rejections and other errors as failures", () => {
		expect(
			isLocalAgentControlStillRunningError({
				code: "local_agent_control.refresh_catalog_rejected",
				status: 409,
			})
		).toBe(false);
		expect(isLocalAgentControlStillRunningError(new Error("boom"))).toBe(false);
		expect(isLocalAgentControlStillRunningError(null)).toBe(false);
		expect(isLocalAgentControlStillRunningError(undefined)).toBe(false);
	});
});

function renderLocalAgentsCard(input: {
	hasSelectedEnvironment?: boolean;
	isReconcilingStatus?: boolean;
	agentControllerAuth?: AgentControllerInterfaceSnapshot["auth"];
	agentControllerCheck?: AgentControllerInterfaceSnapshot["check"];
	agentControllerMessage?: string | null;
	agentControllerStatus?: AgentControllerInterfaceSnapshot["status"];
	agentControllerVersionAdvisory?: AgentControllerInterfaceSnapshot["versionAdvisory"];
	usageLimits?: AgentControllerInterfaceSnapshot["usageLimits"];
	codexEnabled?: boolean;
	includeAgentControllerInterface?: boolean;
	installChoiceCount?: number;
	openClawEnabled?: boolean;
	openClawLaunchStatus?:
		| "ready"
		| "needs_choice"
		| "needs_repair"
		| "not_available";
	openClawLifecycleStatus?: "active" | "suspended";
	openClawSelectable?: boolean;
	localAgentCatalogEntries?: LocalRuntimeExecutionTarget["localAgentCatalog"]["entries"];
	manageInstallationsSupported?: boolean;
	refreshAll?: () => Promise<void>;
	refreshCatalogSupported?: boolean;
	refreshLocalAgentCatalog?: () => Promise<void>;
	replyReadiness?: ComputerReplyReadiness;
	setEnabledSupported: boolean;
	setLocalAgentEnabled?: (target: {
		agentId: string;
		enabled: boolean;
	}) => Promise<void>;
	targetStatus?: LocalRuntimeExecutionTarget["status"];
}) {
	const executionTarget = buildExecutionTarget({
		agentControllerAuth: input.agentControllerAuth,
		agentControllerCheck: input.agentControllerCheck,
		agentControllerMessage: input.agentControllerMessage,
		agentControllerStatus: input.agentControllerStatus,
		agentControllerVersionAdvisory: input.agentControllerVersionAdvisory,
		usageLimits: input.usageLimits,
		codexEnabled: input.codexEnabled ?? true,
		includeAgentControllerInterface: input.includeAgentControllerInterface,
		installChoiceCount: input.installChoiceCount,
		localAgentCatalogEntries: input.localAgentCatalogEntries,
		manageInstallationsSupported: input.manageInstallationsSupported,
		openClawEnabled: input.openClawEnabled ?? false,
		openClawLaunchStatus: input.openClawLaunchStatus ?? "not_available",
		openClawLifecycleStatus: input.openClawLifecycleStatus ?? "active",
		openClawSelectable: input.openClawSelectable ?? false,
		refreshCatalogSupported:
			input.refreshCatalogSupported ?? input.setEnabledSupported,
		setEnabledSupported: input.setEnabledSupported,
		status: input.targetStatus ?? "ready",
	});

	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	render(
		<TooltipProvider>
			<QueryClientProvider client={queryClient}>
				<LocalAgentsCard
					computer={buildComputer(executionTarget)}
					hasSelectedEnvironment={input.hasSelectedEnvironment ?? true}
					isReconcilingStatus={input.isReconcilingStatus}
					recovery={
						{
							agentProfiles: [],
							refreshAll:
								input.refreshAll ?? vi.fn().mockResolvedValue(undefined),
							refreshLocalAgentCatalog:
								input.refreshLocalAgentCatalog ??
								vi.fn().mockResolvedValue(undefined),
							selectedExecutionTarget: executionTarget,
							setLocalAgentEnabled:
								input.setLocalAgentEnabled ??
								vi.fn().mockResolvedValue(undefined),
						} as unknown as LocalAgentsCardOwnerProps["recovery"]
					}
					replyReadiness={input.replyReadiness ?? READY_REPLY_READINESS}
				/>
			</QueryClientProvider>
		</TooltipProvider>
	);

	return { executionTarget };
}

function buildComputer(
	executionTarget: LocalRuntimeExecutionTarget
): LocalRuntimeComputer {
	return {
		deviceDisplayName: "Felix's MacBook Pro",
		deviceDisplayNameSource: "observed",
		deviceId: "device-macbook-pro",
		deviceType: "laptop",
		executionTargets: [executionTarget],
		firstSeenAtMs: 1_712_699_000_000,
		isCurrent: true,
		lastObservedAtMs: 1_712_700_000_000,
		osVersion: "15.4",
		platformFamily: "macOS",
	};
}

function buildExecutionTarget(input: {
	agentControllerAuth?: AgentControllerInterfaceSnapshot["auth"];
	agentControllerCheck?: AgentControllerInterfaceSnapshot["check"];
	agentControllerMessage?: string | null;
	agentControllerStatus?: AgentControllerInterfaceSnapshot["status"];
	agentControllerVersionAdvisory?: AgentControllerInterfaceSnapshot["versionAdvisory"];
	usageLimits?: AgentControllerInterfaceSnapshot["usageLimits"];
	codexEnabled: boolean;
	includeAgentControllerInterface?: boolean;
	installChoiceCount?: number;
	localAgentCatalogEntries?: LocalRuntimeExecutionTarget["localAgentCatalog"]["entries"];
	manageInstallationsSupported?: boolean;
	openClawEnabled?: boolean;
	openClawLaunchStatus?:
		| "ready"
		| "needs_choice"
		| "needs_repair"
		| "not_available";
	openClawLifecycleStatus?: "active" | "suspended";
	openClawSelectable?: boolean;
	refreshCatalogSupported?: boolean;
	setEnabledSupported: boolean;
	status?: LocalRuntimeExecutionTarget["status"];
}): LocalRuntimeExecutionTarget {
	const openClawLaunchStatus = input.openClawLaunchStatus ?? "not_available";
	const openClawSelectable = input.openClawSelectable ?? false;
	const localAgentCatalogEntries = input.localAgentCatalogEntries ?? [
		{
			agentId: "codex",
			detected: true,
			displayName: "Codex",
			enabled: input.codexEnabled,
			lifecycleStatus: "active",
			launchStatus: "ready",
			selectable: true,
			selectableReason: null,
			targetKind: "builtin",
		},
		{
			agentId: "openclaw",
			detected: true,
			displayName: "OpenClaw",
			enabled: input.openClawEnabled ?? false,
			lifecycleStatus: input.openClawLifecycleStatus ?? "active",
			launchStatus: openClawLaunchStatus,
			selectable: openClawSelectable,
			selectableReason: openClawSelectable ? null : "not_supported_yet",
			targetKind: "builtin",
		},
	];

	return {
		openMeldServiceRuntimeId: {
			source: "runtime_registry_authority",
			value: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
		},
		capabilities: [
			{
				agentControllerRef: "builtin:codex",
				agentControllerInterface: input.includeAgentControllerInterface
					? {
							agentControllerRef: "builtin:codex",
							auth: input.agentControllerAuth ?? {
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
							...(input.agentControllerCheck
								? { check: input.agentControllerCheck }
								: {}),
							checkedAt: "2026-06-28T12:00:00.000Z",
							controllerId: "codex",
							displayName: "Codex",
							launch: {
								argsPrefix: [],
								commandPath: "/opt/homebrew/bin/codex",
								installChoiceCount: input.installChoiceCount ?? 1,
								status: "ready",
							},
							message: input.agentControllerMessage ?? null,
							models: [{ displayName: "GPT-5.5", id: "gpt-5.5" }],
							nativeInterface: "codex-app-server",
							schemaVersion: 1,
							skills: [],
							status: input.agentControllerStatus ?? "ready",
							...(input.agentControllerVersionAdvisory
								? { versionAdvisory: input.agentControllerVersionAdvisory }
								: {}),
							...(input.usageLimits ? { usageLimits: input.usageLimits } : {}),
							version: "0.38.0",
						}
					: null,
				enabled: input.codexEnabled,
				reasonCodes: [],
				status: "ready",
			},
		],
		deviceId: "device-macbook-pro",
		isCurrent: true,
		lastObservedAtMs: 1_712_700_000_000,
		localAgentCatalog: {
			detectedNotSupportedYet: 1,
			detectedSupported: localAgentCatalogEntries.filter(
				(entry) => entry.detected && entry.lifecycleStatus === "active"
			).length,
			entries: localAgentCatalogEntries,
			needsChoice: 0,
			needsRepair: 0,
			notDetected: 0,
			totalBuiltins: 2,
		},
		localAgentControl: {
			...(input.manageInstallationsSupported
				? {
						manageInstallations: true as const,
						manageInstallationsSafely: true as const,
					}
				: {}),
			refreshCatalog:
				input.refreshCatalogSupported ?? input.setEnabledSupported,
			setEnabled: input.setEnabledSupported,
		},
		reasonCodes: [],
		runtimeLane: "dev-local",
		status: input.status ?? "ready",
		userFacingCommand: "openmeld-dev",
	};
}
