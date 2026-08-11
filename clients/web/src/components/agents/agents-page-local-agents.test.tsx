import type {
	AgentControllerInterfaceSnapshot,
	LocalRuntimeComputer,
	LocalRuntimeExecutionTarget,
} from "@openmeld/schemas/types";
import type { ComputerReplyReadiness } from "@openmeld/start";
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
import { isLocalAgentCheckStillRunningError } from "./agents-page-formatters";
import {
	LocalAgentsCard,
	resolveLocalAgentsCatalogState,
} from "./agents-page-local-agents";

const toastMock = vi.hoisted(() =>
	Object.assign(vi.fn(), {
		error: vi.fn(),
		success: vi.fn(),
		warning: vi.fn(),
	})
);

vi.mock("sonner", () => ({
	toast: toastMock,
}));

vi.mock("@tanstack/react-router", () => ({
	Link: ({ children, to }: { children: ReactNode; to: string }) => (
		<a href={to}>{children}</a>
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
				enabled: true,
			});
		});
		expect(screen.queryByText("Disable Codex?")).toBeNull();
	});

	it("places setup guidance on the disabled runnable agent row", () => {
		renderLocalAgentsCard({
			codexEnabled: false,
			replyReadiness: NEEDS_LOCAL_AGENT_REPLY_READINESS,
			setEnabledSupported: true,
		});

		expect(
			screen.queryByText(
				"Connect a local agent so OpenMeld can refresh the local agents on this computer."
			)
		).toBeNull();
		const row = screen.getByTestId("settings-local-agent-row-codex");
		const setupLabel = within(row).getByText("Turn on");
		expect(setupLabel.getAttribute("data-slot")).not.toBe("badge");
		expect(setupLabel.className).toContain("text-amber");
		expect(within(row).queryByText("Connect local agent")).toBeNull();
		expect(
			within(row).getByText(
				"Turn on Codex to let OpenMeld launch it on this computer."
			)
		).toBeTruthy();
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
			within(row).getByText(
				"OpenMeld keeps this existing controller setting on this computer."
			)
		).toBeTruthy();
		expect(
			within(row)
				.getByRole("switch", { name: "OpenClaw local agent" })
				.getAttribute("aria-checked")
		).toBe("true");
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
		const setupLabel = within(row).getByText("Needs repair");
		expect(setupLabel.getAttribute("data-slot")).not.toBe("badge");
		expect(setupLabel.className).toContain("text-destructive");
		expect(
			within(row).getByText(
				"OpenMeld found OpenClaw, but couldn't confirm a working launch command."
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
		expect(within(row).getByText("Needs repair")).toBeTruthy();
		expect(
			within(row).getByText(
				"OpenMeld found OpenClaw, but couldn't confirm a working launch command."
			)
		).toBeTruthy();
	});

	it("keeps the connect banner when this computer reports no usable local agents", () => {
		renderLocalAgentsCard({
			localAgentCatalogEntries: [],
			replyReadiness: UNKNOWN_TARGET_REPLY_READINESS,
			setEnabledSupported: true,
			targetStatus: "unknown",
		});

		expect(screen.getByText("Connect local agent")).toBeTruthy();
		expect(
			screen.getByText(
				"Connect a local agent so OpenMeld can refresh the local agents on this computer."
			)
		).toBeTruthy();
	});

	it("keeps service update action out of Local agents when a disabled agent also needs connection", () => {
		const executionTarget = buildExecutionTarget({
			codexEnabled: false,
			setEnabledSupported: true,
		});

		const state = resolveLocalAgentsCatalogState({
			computer: buildComputer(executionTarget),
			isCurrentComputer: true,
			recovery: {
				agentProfiles: [],
				selectedExecutionTarget: executionTarget,
			} as unknown as Parameters<typeof LocalAgentsCard>[0]["recovery"],
			replyReadiness: SERVICE_UPDATE_REPLY_READINESS,
		});

		expect(state.notice?.variant).toBe("inline");
		expect(state.notice?.description).toBe(
			"Local agents will refresh after OpenMeld Service is updated."
		);
		expect(state.primaryActionLabel).toBeNull();
		expect(state.canRefreshCatalog).toBe(false);
		expect(state.canSetEnabled).toBe(false);
		expect(state.rowsMuted).toBe(true);
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
		expect(row.querySelector("p")?.className).toContain(
			"text-muted-foreground"
		);
		expect(
			within(row).getByTestId("local-agent-logo-codex").parentElement?.className
		).toContain("opacity-50");
	});

	it("keeps service reconnect action out of Local agents when the service is not connected", () => {
		const executionTarget = buildExecutionTarget({
			codexEnabled: true,
			setEnabledSupported: true,
		});

		const state = resolveLocalAgentsCatalogState({
			computer: buildComputer(executionTarget),
			isCurrentComputer: true,
			recovery: {
				agentProfiles: [],
				selectedExecutionTarget: executionTarget,
			} as unknown as Parameters<typeof LocalAgentsCard>[0]["recovery"],
			replyReadiness: SERVICE_NOT_CONNECTED_REPLY_READINESS,
		});

		expect(state.notice?.variant).toBe("inline");
		expect(state.notice?.description).toBe(
			"Local agents will refresh after OpenMeld Service is reconnected."
		);
		expect(state.primaryActionLabel).toBeNull();
		expect(state.canRefreshCatalog).toBe(false);
		expect(state.canSetEnabled).toBe(false);
		expect(state.rowsMuted).toBe(true);
	});

	it("shows service reconnect dependency as a quiet Local agents note", () => {
		renderLocalAgentsCard({
			replyReadiness: SERVICE_NOT_CONNECTED_REPLY_READINESS,
			setEnabledSupported: true,
		});

		const note = screen.getByText(
			"Local agents will refresh after OpenMeld Service is reconnected."
		);
		expect(note.className).toContain("text-foreground");
		expect(
			screen.queryByRole("link", { name: "Reconnect OpenMeld Service" })
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
		expect(row.querySelector("p")?.className).toContain(
			"text-muted-foreground"
		);
		expect(
			within(row).getByTestId("local-agent-logo-codex").parentElement?.className
		).toContain("opacity-50");
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
		expect(toastMock.error).toHaveBeenCalledWith(
			"OpenMeld is still checking local agents. Check again in a moment."
		);
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

		expect(
			screen
				.getByRole("link", { name: "See the install guide" })
				.getAttribute("href")
		).toBe("/guides/local-agents");
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
		expect(within(row).getByText("Issue")).toBeTruthy();
		expect(
			within(row).queryByRole("button", { name: "Check again" })
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
		const setupLabel = within(row).getByText("Needs repair");
		expect(setupLabel.getAttribute("data-slot")).not.toBe("badge");
		expect(setupLabel.className).toContain("text-destructive");
		expect(
			within(row).getAllByText(
				"Codex CLI is installed, but OpenMeld could not confirm controller readiness."
			).length
		).toBeGreaterThan(0);
		expect(within(row).getByText("Issue")).toBeTruthy();

		fireEvent.click(within(row).getByRole("button", { name: "Check again" }));

		expect(refreshLocalAgentCatalog).toHaveBeenCalledTimes(1);
	});

	it("shows a failed controller check without claiming setup needs repair", () => {
		renderLocalAgentsCard({
			agentControllerAuth: { status: "unknown" },
			agentControllerCheck: {
				lastSucceededAt: "2026-06-28T11:55:00.000Z",
				status: "failed",
			},
			agentControllerStatus: "unknown",
			includeAgentControllerInterface: true,
			setEnabledSupported: true,
		});

		const row = screen.getByTestId("settings-local-agent-row-codex");
		expect(
			within(row)
				.getAllByText("Couldn't check")
				.some((element) => element.className.includes("text-amber"))
		).toBe(true);
		expect(within(row).queryByText("Needs setup")).toBeNull();
		expect(
			within(row).getByText(
				"OpenMeld couldn't finish checking Codex. It will try again automatically."
			)
		).toBeTruthy();
		expect(within(row).getByText("Last successful check")).toBeTruthy();
	});

	it("shows the controller-specific not-signed-in guidance for an unauthenticated Codex controller", () => {
		renderLocalAgentsCard({
			agentControllerAuth: { status: "unauthenticated" },
			agentControllerMessage:
				"Codex CLI is installed, but this computer is not signed in to Codex.",
			agentControllerStatus: "error",
			includeAgentControllerInterface: true,
			setEnabledSupported: true,
		});

		const row = screen.getByTestId("settings-local-agent-row-codex");
		expect(within(row).getByText("Sign in required")).toBeTruthy();
		expect(
			within(row).getAllByText(
				"Codex CLI is installed, but this computer is not signed in to Codex."
			).length
		).toBeGreaterThan(0);
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
		expect(
			within(row).getByText(
				"Last check found this local agent. Connect OpenMeld Service to refresh its status."
			)
		).toBeTruthy();
	});
});

describe("isLocalAgentCheckStillRunningError", () => {
	it("treats gateway timeouts as still running", () => {
		expect(isLocalAgentCheckStillRunningError({ status: 504 })).toBe(true);
		expect(
			isLocalAgentCheckStillRunningError({
				code: "local_agent_control.timeout",
			})
		).toBe(true);
		expect(
			isLocalAgentCheckStillRunningError({ code: "network.timeout" })
		).toBe(true);
	});

	it("treats explicit rejections and other errors as failures", () => {
		expect(
			isLocalAgentCheckStillRunningError({
				code: "local_agent_control.refresh_catalog_rejected",
				status: 409,
			})
		).toBe(false);
		expect(isLocalAgentCheckStillRunningError(new Error("boom"))).toBe(false);
		expect(isLocalAgentCheckStillRunningError(null)).toBe(false);
		expect(isLocalAgentCheckStillRunningError(undefined)).toBe(false);
	});
});

function renderLocalAgentsCard(input: {
	agentControllerAuth?: AgentControllerInterfaceSnapshot["auth"];
	agentControllerCheck?: AgentControllerInterfaceSnapshot["check"];
	agentControllerMessage?: string | null;
	agentControllerStatus?: AgentControllerInterfaceSnapshot["status"];
	codexEnabled?: boolean;
	includeAgentControllerInterface?: boolean;
	openClawEnabled?: boolean;
	openClawLaunchStatus?: "ready" | "needs_repair" | "not_available";
	openClawLifecycleStatus?: "active" | "suspended";
	openClawSelectable?: boolean;
	localAgentCatalogEntries?: LocalRuntimeExecutionTarget["localAgentCatalog"]["entries"];
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
		codexEnabled: input.codexEnabled ?? true,
		includeAgentControllerInterface: input.includeAgentControllerInterface,
		localAgentCatalogEntries: input.localAgentCatalogEntries,
		openClawEnabled: input.openClawEnabled ?? false,
		openClawLaunchStatus: input.openClawLaunchStatus ?? "not_available",
		openClawLifecycleStatus: input.openClawLifecycleStatus ?? "active",
		openClawSelectable: input.openClawSelectable ?? false,
		refreshCatalogSupported:
			input.refreshCatalogSupported ?? input.setEnabledSupported,
		setEnabledSupported: input.setEnabledSupported,
		status: input.targetStatus ?? "ready",
	});

	render(
		<LocalAgentsCard
			computer={buildComputer(executionTarget)}
			isCurrentComputer={true}
			recovery={
				{
					agentProfiles: [],
					refreshAll: input.refreshAll ?? vi.fn().mockResolvedValue(undefined),
					refreshLocalAgentCatalog:
						input.refreshLocalAgentCatalog ??
						vi.fn().mockResolvedValue(undefined),
					selectedExecutionTarget: executionTarget,
					setLocalAgentEnabled:
						input.setLocalAgentEnabled ?? vi.fn().mockResolvedValue(undefined),
				} as unknown as Parameters<typeof LocalAgentsCard>[0]["recovery"]
			}
			replyReadiness={input.replyReadiness ?? READY_REPLY_READINESS}
		/>
	);
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
	codexEnabled: boolean;
	includeAgentControllerInterface?: boolean;
	localAgentCatalogEntries?: LocalRuntimeExecutionTarget["localAgentCatalog"]["entries"];
	openClawEnabled?: boolean;
	openClawLaunchStatus?: "ready" | "needs_repair" | "not_available";
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
								installChoiceCount: 1,
								status: "ready",
							},
							message: input.agentControllerMessage ?? null,
							models: [{ displayName: "GPT-5.5", id: "gpt-5.5" }],
							nativeInterface: "codex-app-server",
							schemaVersion: 1,
							skills: [],
							status: input.agentControllerStatus ?? "ready",
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
