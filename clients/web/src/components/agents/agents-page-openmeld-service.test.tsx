import type {
	CurrentLocalRuntimeReplyReadinessResponse,
	LocalRuntimeComputer,
} from "@openmeld/schemas/types";
import type { ComputerReplyReadiness } from "@openmeld/start";
import { TooltipProvider } from "@openmeld/ui/components/tooltip";
import type { QueryClient } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	OpenMeldServiceCard,
	type OpenMeldServiceCardOwnerProps,
} from "./agents-page-openmeld-service";

const copyCliEntryCommandMock = vi.hoisted(() => vi.fn());
const refreshSharedCachesMock = vi.hoisted(() => vi.fn());
const requestCurrentOpenMeldToolsUpdateMock = vi.hoisted(() => vi.fn());
const setCurrentOpenMeldToolsMaintenanceMock = vi.hoisted(() => vi.fn());
const setQueryDataMock = vi.hoisted(() => vi.fn());
const toastErrorMock = vi.hoisted(() => vi.fn());
const toastSuccessMock = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", () => ({
	Link: ({ children, to, ...props }: { children: ReactNode; to: string }) => (
		<a href={to} {...props}>
			{children}
		</a>
	),
}));

vi.mock("#/lib/organizations/organization-context", () => ({
	useCurrentOrganizationSlug: () => "acme",
}));

vi.mock("#/lib/cli-entry-command", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("#/lib/cli-entry-command")>();
	return {
		...actual,
		copyCliEntryCommand: copyCliEntryCommandMock,
	};
});

vi.mock("#/lib/connect/local-runtimes", () => ({
	requestCurrentOpenMeldToolsUpdate: requestCurrentOpenMeldToolsUpdateMock,
	setCurrentOpenMeldToolsMaintenance: setCurrentOpenMeldToolsMaintenanceMock,
}));

vi.mock("#/query/agents/execution-readiness", () => ({
	refreshWebAgentReadinessSharedCaches: refreshSharedCachesMock,
}));

vi.mock("sonner", () => ({
	toast: {
		error: toastErrorMock,
		success: toastSuccessMock,
	},
}));

const READY_REPLY_READINESS: ComputerReplyReadiness = {
	detailReasonCode: null,
	executionTargetStatus: "ready",
	reasonCode: "ready",
	service: null,
	status: "ready",
};

const SERVICE_NOT_CONNECTED_REPLY_READINESS: ComputerReplyReadiness = {
	detailReasonCode: null,
	executionTargetStatus: "unknown",
	reasonCode: "background_helper.not_running",
	service: null,
	status: "needs_repair",
};

const SERVICE_UPDATE_REQUIRED_REPLY_READINESS: ComputerReplyReadiness = {
	detailReasonCode: "service.version_not_reported",
	executionTargetStatus: "ready",
	reasonCode: "background_helper.update_required",
	service: null,
	status: "needs_repair",
};

const queryClientStub = {
	setQueryData: setQueryDataMock,
} as unknown as QueryClient;

describe("OpenMeldServiceCard", () => {
	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
		vi.restoreAllMocks();
		refreshSharedCachesMock.mockResolvedValue(undefined);
	});

	it("summarizes a healthy installation as one ready OpenMeld Tools outcome", () => {
		renderOpenMeldServiceCard({
			currentLocalRuntimeReplyReadiness: null,
			replyReadiness: READY_REPLY_READINESS,
		});

		expect(screen.getByText("OpenMeld Tools are ready")).toBeTruthy();
		expect(
			screen.queryByLabelText("OpenMeld Service connection: Connected")
		).toBeNull();
	});

	it("shows OpenMeld tools as one card with a component list", () => {
		renderOpenMeldServiceCard({
			currentLocalRuntimeReplyReadiness:
				buildCurrentLocalRuntimeReplyReadiness(),
			replyReadiness: READY_REPLY_READINESS,
		});

		expect(screen.getByText("OpenMeld Tools")).toBeTruthy();
		expect(screen.getByText("OpenMeld Tools are ready")).toBeTruthy();
		expect(
			screen.queryByRole("button", { name: "Update OpenMeld Tools" })
		).toBeNull();
		expect(
			screen.queryByRole("link", { name: "Update OpenMeld Tools" })
		).toBeNull();
		expect(screen.getByText("OpenMeld Service")).toBeTruthy();
		expect(screen.getByText("OpenMeld CLI")).toBeTruthy();
		expect(screen.getAllByText("Installed v0.7.92")).toHaveLength(2);
		expect(screen.getByText("OpenMeld skill")).toBeTruthy();
		expect(screen.getByText("Installed")).toBeTruthy();
		expect(
			screen.getByText(
				"The OpenMeld skill is installed and up to date for local agents."
			).className
		).not.toContain("lg:truncate");
		expect(screen.queryByText("Installed · 1 skill")).toBeNull();
		const skillHelp = screen.getByRole("button", {
			name: "OpenMeld skill help",
		});
		expect(skillHelp.className).toContain("touch-manipulation");
		expect(skillHelp.className).toContain("max-lg:size-11");
	});

	it("uses one OpenMeld Tools action for a required service update", () => {
		renderOpenMeldServiceCard({
			currentLocalRuntimeReplyReadiness: buildCurrentLocalRuntimeReplyReadiness(
				{
					service: {
						installedVersion: null,
						latestVersion: "0.7.92",
						reasonCodes: ["service.version_not_reported"],
						requiredVersion: "0.7.92",
						status: "update_required",
						updatePolicy: "required",
						wakeBlocked: true,
					},
				}
			),
			replyReadiness: SERVICE_UPDATE_REQUIRED_REPLY_READINESS,
		});

		const updateLink = screen.getByRole("link", {
			name: "Update OpenMeld Tools",
		});

		expect(screen.getByText("OpenMeld Tools need an update")).toBeTruthy();
		expect(updateLink).toHaveProperty("pathname", "/o/acme/connect");
		expect(updateLink).toHaveProperty(
			"search",
			"?connectedComputerId=computer-macbook-pro&serviceAction=update_service&session=fresh"
		);
		expect(
			screen.getAllByRole("link", { name: "Update OpenMeld Tools" })
		).toHaveLength(1);
		expect(screen.queryByText("Update OpenMeld Service")).toBeNull();
	});

	it("uses one OpenMeld Tools action for an available service update", () => {
		renderOpenMeldServiceCard({
			currentLocalRuntimeReplyReadiness: buildCurrentLocalRuntimeReplyReadiness(
				{
					service: {
						installedVersion: "0.7.99",
						latestVersion: "0.8.0",
						reasonCodes: ["service.update_available"],
						requiredVersion: null,
						status: "update_available",
						updatePolicy: "available",
						wakeBlocked: false,
					},
				}
			),
			replyReadiness: READY_REPLY_READINESS,
		});

		const updateLink = screen.getByRole("link", {
			name: "Update OpenMeld Tools",
		});

		expect(screen.getByText("OpenMeld Tools update available")).toBeTruthy();
		const serviceUpdateText = screen.getByText(
			"A newer version of OpenMeld Tools is available."
		);
		expect(serviceUpdateText.className).toContain("text-amber");
		expect(screen.getByText("Installed v0.7.99")).toBeTruthy();
		expect(screen.getByText("Latest available: v0.8.0.")).toBeTruthy();
		expect(updateLink).toHaveProperty("pathname", "/o/acme/connect");
		expect(updateLink).toHaveProperty(
			"search",
			"?connectedComputerId=computer-macbook-pro&serviceAction=update_service&session=fresh"
		);
		expect(
			screen.getAllByRole("link", { name: "Update OpenMeld Tools" })
		).toHaveLength(1);
	});

	it("updates OpenMeld Tools without sending the user to Terminal", async () => {
		const result = {
			operation: {
				operationId: "update-1",
				phase: "updating",
				requestSource: "web",
				requestedAt: "2026-08-25T10:00:00.000Z",
				targetVersion: "0.8.0",
				updatedAt: "2026-08-25T10:00:00.000Z",
				urgency: "available",
			},
			status: "started",
		} as const;
		let finishRequest!: (value: typeof result) => void;
		requestCurrentOpenMeldToolsUpdateMock.mockReturnValueOnce(
			new Promise((resolve) => {
				finishRequest = resolve;
			})
		);
		renderOpenMeldServiceCard({
			currentLocalRuntimeReplyReadiness: buildCurrentLocalRuntimeReplyReadiness(
				{
					maintenance: {
						automaticUpdatesEnabled: true,
						status: "ready",
					},
					service: {
						installedVersion: "0.7.99",
						latestVersion: "0.8.0",
						reasonCodes: ["service.update_available"],
						requiredVersion: null,
						status: "update_available",
						updatePolicy: "available",
						wakeBlocked: false,
					},
				}
			),
			replyReadiness: READY_REPLY_READINESS,
		});

		fireEvent.click(screen.getByRole("button", { name: "Update" }));
		expect(
			(screen.getByRole("button", { name: "Updating" }) as HTMLButtonElement)
				.disabled
		).toBe(true);
		expect(screen.getAllByText("Updating")).toHaveLength(2);

		finishRequest(result);

		await waitFor(() => {
			expect(setQueryDataMock).toHaveBeenCalledTimes(1);
		});
		expect(toastSuccessMock).not.toHaveBeenCalled();
	});

	it("keeps a failed update visible and lets the user try again", async () => {
		const consoleErrorMock = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		requestCurrentOpenMeldToolsUpdateMock.mockRejectedValueOnce(
			new Error("request failed")
		);
		renderOpenMeldServiceCard({
			currentLocalRuntimeReplyReadiness: buildCurrentLocalRuntimeReplyReadiness(
				{
					maintenance: {
						automaticUpdatesEnabled: true,
						status: "ready",
					},
					service: {
						installedVersion: "0.7.99",
						latestVersion: "0.8.0",
						reasonCodes: ["service.update_available"],
						requiredVersion: null,
						status: "update_available",
						updatePolicy: "available",
						wakeBlocked: false,
					},
				}
			),
			replyReadiness: READY_REPLY_READINESS,
		});

		fireEvent.click(screen.getByRole("button", { name: "Update" }));

		await waitFor(() => {
			expect(screen.getByText("Update failed. Try again.")).toBeTruthy();
		});
		expect(
			(screen.getByRole("button", { name: "Update" }) as HTMLButtonElement)
				.disabled
		).toBe(false);
		expect(consoleErrorMock).toHaveBeenCalledWith(
			"OpenMeld Tools update request failed.",
			expect.any(Error)
		);
	});

	it("keeps Update available when a local agent also needs repair", () => {
		const readiness = buildCurrentLocalRuntimeReplyReadiness({
			maintenance: {
				automaticUpdatesEnabled: false,
				status: "ready",
			},
			service: {
				installedVersion: "0.7.99",
				latestVersion: "0.8.0",
				reasonCodes: ["service.update_available"],
				requiredVersion: null,
				status: "update_available",
				updatePolicy: "available",
				wakeBlocked: false,
			},
		});
		renderOpenMeldServiceCard({
			currentLocalRuntimeReplyReadiness: {
				...readiness,
				canReplyFromThisComputer: false,
				message: "Set up local agents on this computer.",
				nextAction: "run_setup",
				primaryBlocker: "agent_controller_report_not_ready",
				status: "blocked",
			},
			replyReadiness: READY_REPLY_READINESS,
		});

		expect(screen.getByText("OpenMeld Tools update available")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Update" })).toBeTruthy();
	});

	it("shows the saved automatic update setting and operation state", async () => {
		setCurrentOpenMeldToolsMaintenanceMock.mockResolvedValueOnce({
			automaticUpdatesEnabled: false,
			status: "updated",
		});
		renderOpenMeldServiceCard({
			currentLocalRuntimeReplyReadiness: buildCurrentLocalRuntimeReplyReadiness(
				{
					maintenance: {
						automaticUpdatesEnabled: true,
						status: "ready",
					},
					updateOperation: {
						operationId: "update-1",
						phase: "waiting_for_work",
						requestSource: "automatic",
						requestedAt: "2026-08-25T10:00:00.000Z",
						targetVersion: "0.8.0",
						updatedAt: "2026-08-25T10:00:00.000Z",
						urgency: "available",
					},
				}
			),
			replyReadiness: READY_REPLY_READINESS,
		});

		const toggle = screen.getByRole("switch", {
			name: "Keep OpenMeld Tools up to date",
		});
		expect(toggle.getAttribute("aria-checked")).toBe("true");
		expect(screen.getByText("Finishing current work")).toBeTruthy();
		fireEvent.click(toggle);

		await waitFor(() => {
			expect(setCurrentOpenMeldToolsMaintenanceMock).toHaveBeenCalledWith({
				automaticUpdatesEnabled: false,
			});
		});
	});

	it("uses one OpenMeld Tools command action for a CLI-only update", () => {
		renderOpenMeldServiceCard({
			currentLocalRuntimeReplyReadiness: buildCurrentLocalRuntimeReplyReadiness(
				{
					cli: {
						commandContractVersion:
							"openmeld-cli-command-contract-2026-05-local-components-v1",
						installedPackageVersion: "0.7.91",
						latestPackageVersion: "0.7.92",
						reasonCodes: ["cli.package_update_available"],
						requiredCommandContractVersion: null,
						status: "update_available",
						updatePolicy: "available",
						wakeBlocked: false,
					},
					runtimeLane: "prod",
				}
			),
			replyReadiness: READY_REPLY_READINESS,
		});

		expect(screen.getByText("OpenMeld Tools update available")).toBeTruthy();
		const updateValue = screen.getByText("Update available");
		expect(updateValue.className).toContain("text-amber");
		expect(screen.getByText("Latest available: v0.7.92.")).toBeTruthy();
		expect(screen.queryByText("Update OpenMeld CLI")).toBeNull();
		fireEvent.click(
			screen.getByRole("button", { name: "Update OpenMeld Tools" })
		);
		expect(screen.getByText("openmeld upgrade --yes")).toBeTruthy();
	});

	it("confirms when the CLI update command is copied", async () => {
		copyCliEntryCommandMock.mockResolvedValueOnce(true);
		renderOpenMeldServiceCard({
			currentLocalRuntimeReplyReadiness: buildCurrentLocalRuntimeReplyReadiness(
				{
					cli: {
						commandContractVersion:
							"openmeld-cli-command-contract-2026-05-local-components-v1",
						installedPackageVersion: "0.7.91",
						latestPackageVersion: "0.7.92",
						reasonCodes: ["cli.package_update_available"],
						requiredCommandContractVersion: null,
						status: "update_available",
						updatePolicy: "available",
						wakeBlocked: false,
					},
					runtimeLane: "prod",
				}
			),
			replyReadiness: READY_REPLY_READINESS,
		});

		fireEvent.click(
			screen.getByRole("button", { name: "Update OpenMeld Tools" })
		);
		fireEvent.click(screen.getByRole("button", { name: "Copy command" }));

		await waitFor(() => {
			expect(copyCliEntryCommandMock).toHaveBeenCalledWith(
				"openmeld upgrade --yes"
			);
		});
		const copiedButton = screen.getByRole("button", { name: "Copied" });
		expect(
			copiedButton.querySelector('[data-icon="inline-start"]')
		).toBeTruthy();
		expect(toastSuccessMock).toHaveBeenCalledWith("Command copied.");
	});

	it("does not label package-only CLI drift as a required contract update", () => {
		renderOpenMeldServiceCard({
			currentLocalRuntimeReplyReadiness: buildCurrentLocalRuntimeReplyReadiness(
				{
					cli: {
						commandContractVersion:
							"openmeld-cli-command-contract-2026-05-local-components-v1",
						installedPackageVersion: "0.7.91",
						latestPackageVersion: "0.7.92",
						reasonCodes: ["cli.package_update_available"],
						requiredCommandContractVersion:
							"openmeld-cli-command-contract-2026-05-local-components-v1",
						status: "update_available",
						updatePolicy: "available",
						wakeBlocked: false,
					},
				}
			),
			replyReadiness: READY_REPLY_READINESS,
		});

		expect(screen.queryByText("Required CLI contract update.")).toBeNull();
		expect(screen.getByText("Latest available: v0.7.92.")).toBeTruthy();
	});

	it("uses the aggregate action for a required CLI update", () => {
		renderOpenMeldServiceCard({
			currentLocalRuntimeReplyReadiness: buildCurrentLocalRuntimeReplyReadiness(
				{
					cli: {
						commandContractVersion: "old-cli-contract",
						installedPackageVersion: "0.7.91",
						latestPackageVersion: "0.7.92",
						reasonCodes: ["cli.command_contract_mismatch"],
						requiredCommandContractVersion:
							"openmeld-cli-command-contract-2026-05-local-components-v1",
						status: "update_required",
						updatePolicy: "required",
						wakeBlocked: false,
					},
				}
			),
			replyReadiness: READY_REPLY_READINESS,
		});

		expect(screen.getByText("OpenMeld Tools need an update")).toBeTruthy();
		expect(screen.getByText("Update required")).toBeTruthy();
		expect(
			screen.getByText((content) =>
				content.includes("Required CLI contract update.")
			)
		).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Update OpenMeld Tools" })
		).toBeTruthy();
	});

	it("labels a required version-only CLI update without claiming a contract change", () => {
		renderOpenMeldServiceCard({
			currentLocalRuntimeReplyReadiness: buildCurrentLocalRuntimeReplyReadiness(
				{
					cli: {
						commandContractVersion:
							"openmeld-cli-command-contract-2026-05-local-components-v1",
						installedPackageVersion: "0.2.20",
						latestPackageVersion: "0.2.21",
						reasonCodes: ["cli.package_update_available"],
						requiredCommandContractVersion:
							"openmeld-cli-command-contract-2026-05-local-components-v1",
						status: "update_required",
						updatePolicy: "required",
						wakeBlocked: false,
					},
				}
			),
			replyReadiness: READY_REPLY_READINESS,
		});

		expect(screen.getByText("Update required")).toBeTruthy();
		expect(
			screen.getByText((content) => content.includes("CLI update required."))
		).toBeTruthy();
		expect(
			screen.getByText((content) =>
				content.includes("Latest available: v0.2.21.")
			)
		).toBeTruthy();
		expect(screen.queryByText("Required CLI contract update.")).toBeNull();
	});

	it("uses one OpenMeld Tools setup action for a skills-only update", () => {
		renderOpenMeldServiceCard({
			currentLocalRuntimeReplyReadiness: buildCurrentLocalRuntimeReplyReadiness(
				{
					skills: {
						expectedBundleHash: "hash-next",
						expectedTargetCount: 1,
						installedBundleHash: "hash-prev",
						reasonCodes: ["skills.bundle_mismatch"],
						skillContractVersion:
							"openmeld-skills-contract-2026-05-required-v1",
						status: "update_available",
						targetCount: 1,
						updatePolicy: "available",
						wakeBlocked: false,
					},
					runtimeLane: "prod",
				}
			),
			replyReadiness: READY_REPLY_READINESS,
		});

		expect(screen.getByText("OpenMeld Tools update available")).toBeTruthy();
		const updateValue = screen.getByText("Update available");
		expect(updateValue.className).toContain("text-amber");
		expect(
			screen.getByText("A newer OpenMeld skill is available.")
		).toBeTruthy();
		const updateLink = screen.getByRole("link", {
			name: "Update OpenMeld Tools",
		});
		expect(updateLink).toHaveProperty("pathname", "/o/acme/connect");
		expect(updateLink).toHaveProperty(
			"search",
			"?connectedComputerId=computer-macbook-pro&session=fresh"
		);
		expect(screen.queryByText("Update OpenMeld skills")).toBeNull();
		expect(screen.queryByText("hash-prev")).toBeNull();
		expect(screen.queryByText("hash-next")).toBeNull();
	});

	it("does not present cached component updates as current while status is reconciling", () => {
		renderOpenMeldServiceCard({
			currentLocalRuntimeReplyReadiness: buildCurrentLocalRuntimeReplyReadiness(
				{
					skills: {
						expectedBundleHash: "hash-next",
						expectedTargetCount: 1,
						installedBundleHash: "hash-prev",
						reasonCodes: ["skills.bundle_mismatch"],
						skillContractVersion:
							"openmeld-skills-contract-2026-05-required-v1",
						status: "update_available",
						targetCount: 1,
						updatePolicy: "available",
						wakeBlocked: false,
					},
				}
			),
			isReconcilingStatus: true,
			replyReadiness: READY_REPLY_READINESS,
		});

		expect(screen.getByText("Checking OpenMeld tools status...")).toBeTruthy();
		expect(screen.queryByText("Update available")).toBeNull();
		expect(
			screen.queryByRole("link", { name: "Update OpenMeld Tools" })
		).toBeNull();
	});

	it("uses the aggregate setup action for required OpenMeld skills", () => {
		renderOpenMeldServiceCard({
			currentLocalRuntimeReplyReadiness: buildCurrentLocalRuntimeReplyReadiness(
				{
					skills: {
						expectedBundleHash: "hash-next",
						expectedTargetCount: 1,
						installedBundleHash: "hash-prev",
						reasonCodes: ["skills.bundle_mismatch"],
						skillContractVersion:
							"openmeld-skills-contract-2026-05-required-v1",
						status: "update_required",
						targetCount: 1,
						updatePolicy: "required",
						wakeBlocked: false,
					},
				}
			),
			replyReadiness: READY_REPLY_READINESS,
		});

		expect(screen.getByText("OpenMeld Tools need an update")).toBeTruthy();
		expect(screen.getByText("Update required")).toBeTruthy();
		expect(
			screen.getByRole("link", { name: "Update OpenMeld Tools" })
		).toBeTruthy();
	});

	it("shows one setup action when CLI and skills updates overlap", () => {
		renderOpenMeldServiceCard({
			currentLocalRuntimeReplyReadiness: buildCurrentLocalRuntimeReplyReadiness(
				{
					cli: {
						commandContractVersion:
							"openmeld-cli-command-contract-2026-05-local-components-v1",
						installedPackageVersion: "0.7.91",
						latestPackageVersion: "0.7.92",
						reasonCodes: ["cli.package_update_available"],
						requiredCommandContractVersion: null,
						status: "update_available",
						updatePolicy: "available",
						wakeBlocked: false,
					},
					skills: {
						expectedBundleHash: "hash-next",
						expectedTargetCount: 1,
						installedBundleHash: "hash-prev",
						reasonCodes: ["skills.bundle_mismatch"],
						skillContractVersion:
							"openmeld-skills-contract-2026-05-required-v1",
						status: "update_available",
						targetCount: 1,
						updatePolicy: "available",
						wakeBlocked: false,
					},
				}
			),
			replyReadiness: READY_REPLY_READINESS,
		});

		expect(
			screen.getAllByRole("link", { name: "Update OpenMeld Tools" })
		).toHaveLength(1);
		expect(
			screen.queryByRole("button", { name: "Update OpenMeld Tools" })
		).toBeNull();
		expect(screen.queryByText("Update OpenMeld CLI")).toBeNull();
		expect(screen.queryByText("Update OpenMeld skills")).toBeNull();
	});

	it("fails closed when an older Core response has not sent CLI or skills facts", () => {
		const readiness = buildCurrentLocalRuntimeReplyReadiness();
		const oldLocalComponents = {
			agentSetupCommand: readiness.localComponents.agentSetupCommand,
			generatedAt: readiness.localComponents.generatedAt,
			humanSetupCommand: readiness.localComponents.humanSetupCommand,
			schemaVersion: readiness.localComponents.schemaVersion,
			service: readiness.localComponents.service,
			setupAction: readiness.localComponents.setupAction,
			setupActionDescription: readiness.localComponents.setupActionDescription,
			setupActionLabel: readiness.localComponents.setupActionLabel,
		} as CurrentLocalRuntimeReplyReadinessResponse["localComponents"];

		renderOpenMeldServiceCard({
			currentLocalRuntimeReplyReadiness: {
				...readiness,
				localComponents: oldLocalComponents,
			},
			replyReadiness: READY_REPLY_READINESS,
		});

		expect(screen.getAllByText("Not checked")).toHaveLength(2);
		expect(
			screen.getByText(
				"OpenMeld has not received CLI version facts from this computer."
			)
		).toBeTruthy();
		expect(
			screen.getByText(
				"OpenMeld has not received OpenMeld skill facts from this computer."
			)
		).toBeTruthy();
	});

	it("does not duplicate the repair state with a secondary connection badge", () => {
		renderOpenMeldServiceCard({
			currentLocalRuntimeReplyReadiness: null,
			replyReadiness: SERVICE_NOT_CONNECTED_REPLY_READINESS,
		});

		expect(
			screen.getByText("OpenMeld Service is not connected").className
		).toContain("text-destructive");
		expect(
			screen.getByRole("link", { name: "Reconnect OpenMeld Service" }).className
		).toContain("text-destructive");
		expect(
			screen.queryByLabelText("OpenMeld Service connection: Not connected")
		).toBeNull();
	});

	it("uses the current Service observation when an older computer projection still says ready", () => {
		const currentReadiness = buildCurrentLocalRuntimeReplyReadiness();
		renderOpenMeldServiceCard({
			currentLocalRuntimeReplyReadiness: {
				...currentReadiness,
				canReplyFromThisComputer: false,
				message: "OpenMeld Service is not connected on this computer.",
				service: {
					...currentReadiness.service,
					connected: false,
					matchingCurrentRuntime: false,
				},
				status: "blocked",
			},
			replyReadiness: READY_REPLY_READINESS,
		});

		expect(screen.getByText("OpenMeld Service is not connected")).toBeTruthy();
		expect(
			screen.getByRole("link", { name: "Reconnect OpenMeld Service" })
		).toBeTruthy();
		expect(screen.queryByText("OpenMeld Service is connected")).toBeNull();
	});

	it("guides stale non-current computers back through setup", () => {
		renderOpenMeldServiceCard({
			computer: buildComputer({ isCurrent: false, targetStatus: "stale" }),
			currentLocalRuntimeReplyReadiness: null,
			isCurrentComputer: false,
			replyReadiness: SERVICE_NOT_CONNECTED_REPLY_READINESS,
		});

		expect(screen.getAllByText("Needs a fresh check").length).toBeGreaterThan(
			0
		);
		expect(
			screen.getByText(
				"This is the last OpenMeld tools report from that computer. Run setup again to refresh this record."
			)
		).toBeTruthy();
		expect(screen.getByRole("link", { name: "Set up again" })).toHaveProperty(
			"pathname",
			"/o/acme/connect"
		);
		expect(screen.getByRole("link", { name: "Set up again" })).toHaveProperty(
			"search",
			"?connectedComputerId=computer-macbook-pro&session=fresh"
		);

		fireEvent.click(
			screen.getByRole("button", { name: "OpenMeld tools options" })
		);

		expect(screen.queryByText("Check status")).toBeNull();
		expect(
			screen.getAllByRole("link", { name: "Set up again" }).length
		).toBeGreaterThan(0);
	});
});

function buildCurrentLocalRuntimeReplyReadiness(input?: {
	cli?: CurrentLocalRuntimeReplyReadinessResponse["localComponents"]["cli"];
	maintenance?: CurrentLocalRuntimeReplyReadinessResponse["localComponents"]["maintenance"];
	runtimeLane?: "prod" | "dev-local" | "canary";
	service?: CurrentLocalRuntimeReplyReadinessResponse["localComponents"]["service"];
	skills?: CurrentLocalRuntimeReplyReadinessResponse["localComponents"]["skills"];
	updateOperation?: CurrentLocalRuntimeReplyReadinessResponse["localComponents"]["updateOperation"];
}): CurrentLocalRuntimeReplyReadinessResponse {
	const runtimeLane = input?.runtimeLane ?? "dev-local";
	return {
		canReplyFromThisComputer: true,
		currentTarget: {
			availability: "resolved",
			deviceId: "device-macbook-pro",
			runtimeLane,
		},
		generatedAt: "2026-07-01T00:00:00.000Z",
		localComponents: {
			agentSetupCommand:
				"npm install -g openmeld@latest && openmeld setup --view agent",
			generatedAt: "2026-07-01T00:00:00.000Z",
			humanSetupCommand: "npm install -g openmeld@latest && openmeld setup",
			schemaVersion: 1,
			...(input?.maintenance ? { maintenance: input.maintenance } : {}),
			...(input?.updateOperation
				? { updateOperation: input.updateOperation }
				: {}),
			cli: input?.cli ?? {
				commandContractVersion:
					"openmeld-cli-command-contract-2026-05-local-components-v1",
				installedPackageVersion: "0.7.92",
				latestPackageVersion: "0.7.92",
				reasonCodes: [],
				requiredCommandContractVersion: null,
				status: "current",
				updatePolicy: "ok",
				wakeBlocked: false,
			},
			service: input?.service ?? {
				installedVersion: "0.7.92",
				latestVersion: "0.7.92",
				reasonCodes: [],
				requiredVersion: "0.7.91",
				status: "current",
				updatePolicy: "ok",
				wakeBlocked: false,
			},
			skills: input?.skills ?? {
				expectedBundleHash: "hash-current",
				expectedTargetCount: 1,
				installedBundleHash: "hash-current",
				reasonCodes: [],
				skillContractVersion: "openmeld-skills-contract-2026-05-required-v1",
				status: "current",
				targetCount: 1,
				updatePolicy: "ok",
				wakeBlocked: false,
			},
			setupAction: "none",
			setupActionDescription:
				"OpenMeld local components are aligned for this computer.",
			setupActionLabel: "Everything is up to date",
		},
		message: "OpenMeld Service is connected on this computer.",
		nextAction: "none",
		primaryBlocker: "none",
		runtime: {
			openMeldServiceRuntimeId: {
				source: "runtime_registry_authority",
				value: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
			},
			deviceDisplayName: "Felix's MacBook Pro",
			deviceId: "device-macbook-pro",
			executionTargetStatus: "ready",
			lastObservedAtMs: 1_712_700_000_000,
			reasonCodes: [],
			runtimeLane,
		},
		service: {
			connected: true,
			executionCompatibility: null,
			matchingCurrentRuntime: true,
			reasonCodes: [],
			sessionDeviceId: "device-macbook-pro",
			sessionLane: "dev-local",
		},
		status: "ready",
	};
}

function renderOpenMeldServiceCard(input: {
	computer?: LocalRuntimeComputer;
	currentLocalRuntimeReplyReadiness: CurrentLocalRuntimeReplyReadinessResponse | null;
	isCurrentComputer?: boolean;
	isReconcilingStatus?: boolean;
	replyReadiness: ComputerReplyReadiness;
}) {
	render(
		<TooltipProvider>
			<OpenMeldServiceCard
				computer={input.computer ?? buildComputer()}
				currentExpectedServiceVersion={null}
				currentLocalRuntimeReplyReadiness={
					input.currentLocalRuntimeReplyReadiness
				}
				focusService={false}
				isCurrentComputer={input.isCurrentComputer ?? true}
				isReconcilingStatus={input.isReconcilingStatus ?? false}
				queryClient={queryClientStub}
				recovery={buildRecoveryStub()}
				replyReadiness={input.replyReadiness}
				setupCompleteRefreshPending={false}
			/>
		</TooltipProvider>
	);
}

function buildComputer(input?: {
	isCurrent?: boolean;
	targetStatus?: "ready" | "partial" | "not_ready" | "stale" | "unknown";
}): LocalRuntimeComputer {
	const isCurrent = input?.isCurrent ?? true;
	const targetStatus = input?.targetStatus ?? "ready";
	return {
		connectedComputerId: "computer-macbook-pro",
		deviceDisplayName: "Felix's MacBook Pro",
		deviceDisplayNameSource: "observed",
		deviceId: "device-macbook-pro",
		deviceType: "laptop",
		executionTargets: [
			{
				openMeldServiceRuntimeId: {
					source: "runtime_registry_authority",
					value: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
				},
				capabilities: [],
				deviceId: "device-macbook-pro",
				isCurrent,
				lastObservedAtMs: 1_712_700_000_000,
				localAgentCatalog: {
					detectedNotSupportedYet: 0,
					detectedSupported: 0,
					entries: [],
					needsChoice: 0,
					needsRepair: 0,
					notDetected: 0,
					totalBuiltins: 0,
				},
				localAgentControl: { refreshCatalog: false, setEnabled: false },
				reasonCodes: [],
				runtimeLane: "dev-local",
				status: targetStatus,
				userFacingCommand: "openmeld",
			},
		],
		firstSeenAtMs: 1_712_699_000_000,
		isCurrent,
		lastObservedAtMs: 1_712_700_000_000,
		osVersion: "15.4",
		platformFamily: "macOS",
	};
}

function buildRecoveryStub(): OpenMeldServiceCardOwnerProps["recovery"] {
	return {
		refreshAll: vi.fn().mockResolvedValue(undefined),
		storageScope: "test",
	} as unknown as OpenMeldServiceCardOwnerProps["recovery"];
}
