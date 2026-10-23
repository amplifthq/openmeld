import type {
	CurrentLocalRuntimeReplyReadinessResponse,
	LocalRuntimeComputer,
} from "@openmeld/schemas/types";
import type { ComputerReplyReadiness } from "@openmeld/start";
import { TooltipProvider } from "@openmeld/ui/components/tooltip";
import type { QueryClient } from "@tanstack/react-query";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TestQueryClientProvider } from "#/test-support/query-client";
import { createDesktopHandlers } from "../../../../desktop/src/main/ipc-handlers";
import {
	OpenMeldServiceCard,
	type OpenMeldServiceCardOwnerProps,
} from "./agents-page-openmeld-service";

const copyCliEntryCommandMock = vi.hoisted(() => vi.fn());
const refreshSharedCachesMock = vi.hoisted(() => vi.fn(async () => undefined));
const requestCurrentOpenMeldToolsUpdateMock = vi.hoisted(() => vi.fn());
const setCurrentOpenMeldToolsMaintenanceMock = vi.hoisted(() => vi.fn());
const setQueryDataMock = vi.hoisted(() => vi.fn());
const toastErrorMock = vi.hoisted(() => vi.fn());
const toastSuccessMock = vi.hoisted(() => vi.fn());
const desktop = vi.hoisted(() => ({
	enabled: false,
	openWeb: vi.fn(),
	native: false,
}));
const copyTextMock = vi.hoisted(() => vi.fn(async () => true));
vi.mock("#/lib/clipboard", () => ({ copyTextToClipboard: copyTextMock }));
vi.mock("#/env", () => ({
	env: {
		VITE_OPENMELD_HOME: "/tmp/openmeld-disconnect-test",
		VITE_OPENMELD_SETUP_USER_FACING_COMMAND: "openmeld-dev",
	},
}));
vi.mock("#/hooks/auth.hooks", () => ({
	useAuthSession: () => ({ data: { user: { id: "owner-account" } } }),
}));

vi.mock("#/desktop/platform", () => ({
	canConfigureLocalComputer: (eligible = true) => eligible && !desktop.enabled,
	getDesktopPlatform: () => {
		if (!desktop.enabled) {
			return null;
		}
		return desktop.native
			? { updateComputer: vi.fn(), connectComputer: vi.fn() }
			: {};
	},
	openDesktopWeb: desktop.openWeb,
}));
vi.mock("#/desktop/use-computer-connection", () => ({
	useDesktopComputerConnection: () => ({
		data: desktop.native
			? {
					status: "available",
					accountId: "owner-account",
					target: { deviceId: "device-macbook-pro", runtimeLane: "dev-local" },
				}
			: undefined,
	}),
}));

vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => vi.fn().mockResolvedValue(undefined),
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
	requestPeopleComputerOpenMeldToolsUpdate:
		requestCurrentOpenMeldToolsUpdateMock,
	setPeopleComputerOpenMeldToolsMaintenance:
		setCurrentOpenMeldToolsMaintenanceMock,
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
	it("offers a target-bound disconnect command from the owner menu without executing it", async () => {
		renderOpenMeldServiceCard({
			currentLocalRuntimeReplyReadiness:
				buildCurrentLocalRuntimeReplyReadiness(),
			replyReadiness: READY_REPLY_READINESS,
		});
		fireEvent.click(screen.getByRole("button", { name: "OpenMeld options" }));
		fireEvent.click(
			screen.getByRole("menuitem", { name: "Disconnect Computer…" })
		);
		expect(await screen.findByRole("dialog")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Copy command" }));
		await waitFor(() =>
			expect(copyTextMock).toHaveBeenCalledWith(
				"OPENMELD_HOME=/tmp/openmeld-disconnect-test openmeld-dev computer disconnect --expected-account owner-account --device device-macbook-pro --runtime-lane dev-local"
			)
		);
		expect(requestCurrentOpenMeldToolsUpdateMock).not.toHaveBeenCalled();
	});
	afterEach(() => {
		desktop.enabled = false;
		desktop.native = false;
		desktop.openWeb.mockReset();
		cleanup();
		vi.useRealTimers();
		vi.clearAllMocks();
		vi.restoreAllMocks();
	});

	it.each([
		false,
		true,
	])("opens the selected owner's recovery in a browser (update=%s) without a lifecycle write", async (update) => {
		desktop.enabled = true;
		const openExternal = vi.fn(async () => undefined);
		const handlers = createDesktopHandlers({
			commandDeps: {
				env: { ...process.env, WEB_APP_URL: "http://localhost:3000" },
			},
			openExternal,
		});
		desktop.openWeb.mockImplementation(handlers.openWeb);
		const readiness = buildCurrentLocalRuntimeReplyReadiness();
		if (update) {
			readiness.localComponents.service.status = "update_required";
		} else {
			readiness.service.connected = false;
		}
		renderOpenMeldServiceCard({
			currentLocalRuntimeReplyReadiness: readiness,
			replyReadiness: update
				? SERVICE_UPDATE_REQUIRED_REPLY_READINESS
				: SERVICE_NOT_CONNECTED_REPLY_READINESS,
			computer: buildComputer({ isCurrent: false }),
		});
		expect(desktop.openWeb).not.toHaveBeenCalled();
		fireEvent.click(
			screen.getByRole("button", {
				name: update ? "Update in browser" : "Reconnect in browser",
			})
		);
		await waitFor(() => expect(desktop.openWeb).toHaveBeenCalledOnce());
		expect(desktop.openWeb).toHaveBeenCalledWith(
			update
				? "/o/acme/connect?connectedComputerId=computer-macbook-pro&serviceAction=update_service&session=fresh"
				: "/o/acme/connect?connectedComputerId=computer-macbook-pro&session=fresh"
		);
		expect(openExternal).toHaveBeenCalledExactlyOnceWith(
			update
				? "http://localhost:3000/o/acme/connect?connectedComputerId=computer-macbook-pro&serviceAction=update_service&session=fresh"
				: "http://localhost:3000/o/acme/connect?connectedComputerId=computer-macbook-pro&session=fresh"
		);
		expect(
			screen.getByText(
				"Run any setup command on Felix's MacBook Pro, the computer shown on this card. Sign in to its owner's account in the browser."
			)
		).toBeTruthy();
		expect(requestCurrentOpenMeldToolsUpdateMock).not.toHaveBeenCalled();
		expect(setCurrentOpenMeldToolsMaintenanceMock).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "OpenMeld options" }));
		fireEvent.click(screen.getByText("Check status"));
		await waitFor(() => expect(refreshSharedCachesMock).toHaveBeenCalledOnce());
		expect(requestCurrentOpenMeldToolsUpdateMock).not.toHaveBeenCalled();
		expect(setCurrentOpenMeldToolsMaintenanceMock).not.toHaveBeenCalled();
	});

	it.each([
		false,
		true,
	])("routes a verified local Desktop action through native setup (update=%s)", (update) => {
		desktop.enabled = true;
		desktop.native = true;
		const readiness = buildCurrentLocalRuntimeReplyReadiness();
		if (update) {
			readiness.localComponents.service.status = "update_required";
		} else {
			readiness.service.connected = false;
		}
		renderOpenMeldServiceCard({
			currentLocalRuntimeReplyReadiness: readiness,
			replyReadiness: update
				? SERVICE_UPDATE_REQUIRED_REPLY_READINESS
				: SERVICE_NOT_CONNECTED_REPLY_READINESS,
		});
		const link = screen.getByRole("link", {
			name: update ? "Update OpenMeld" : "Reconnect computer",
		});
		expect(link.getAttribute("href")).toBe(
			update
				? "/o/acme/connect?connectedComputerId=computer-macbook-pro&serviceAction=update_service&session=fresh"
				: "/o/acme/connect?connectedComputerId=computer-macbook-pro&session=fresh"
		);
		expect(desktop.openWeb).not.toHaveBeenCalled();
	});

	it("bounds browser opening and shows a retry after failure", async () => {
		desktop.enabled = true;
		let rejectOpen!: (error: Error) => void;
		desktop.openWeb.mockImplementation(
			() =>
				new Promise<void>((_resolve, reject) => {
					rejectOpen = reject;
				})
		);
		renderOpenMeldServiceCard({
			currentLocalRuntimeReplyReadiness:
				buildCurrentLocalRuntimeReplyReadiness(),
			replyReadiness: SERVICE_NOT_CONNECTED_REPLY_READINESS,
		});
		fireEvent.click(
			screen.getByRole("button", { name: "Reconnect in browser" })
		);
		fireEvent.click(screen.getByRole("button", { name: "Opening browser…" }));
		expect(desktop.openWeb).toHaveBeenCalledOnce();
		await act(async () => rejectOpen(new Error("offline")));
		expect(
			screen.getByText("Could not open the browser. Try again.")
		).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Reconnect in browser" })
		).toBeTruthy();
	});

	it.each([
		"needs_help",
		"restored",
	] as const)("keeps %s history separate from a newer connection report", (phase) => {
		const readiness = buildCurrentLocalRuntimeReplyReadiness({
			maintenance: { automaticUpdatesEnabled: true, status: "ready" },
			updateOperation: buildUpdateOperation({ phase }),
		});
		readiness.runtime.lastObservedAtMs = Date.parse("2026-08-25T10:01:00Z");
		renderOpenMeldServiceCard({
			currentLocalRuntimeReplyReadiness: readiness,
			replyReadiness: READY_REPLY_READINESS,
		});
		expect(screen.getByText("Connected")).toBeTruthy();
		expect(screen.getByText("Last update failed.")).toBeTruthy();
		expect(
			screen.getByText(
				"Service has connected since that attempt. This does not confirm that the update target was installed."
			)
		).toBeTruthy();
		expect(readiness.localComponents.updateOperation?.phase).toBe(phase);
		expect(requestCurrentOpenMeldToolsUpdateMock).not.toHaveBeenCalled();
	});

	it.each([
		"unselected",
		"missing",
		"wrong-device",
		"reconciling",
	])("does not guess a Desktop recovery target when %s", (kind) => {
		desktop.enabled = true;
		const readiness = buildCurrentLocalRuntimeReplyReadiness();
		if (kind === "missing") {
			readiness.currentTarget = { availability: "missing" };
		}
		if (kind === "wrong-device") {
			readiness.currentTarget = {
				availability: "resolved",
				deviceId: "another-device",
				runtimeLane: "prod",
			};
		}
		const computer = buildComputer();
		if (kind === "unselected" && computer.executionTargets[0]) {
			computer.executionTargets.push({
				...computer.executionTargets[0],
				runtimeLane: "canary",
			});
		}
		renderOpenMeldServiceCard({
			computer,
			currentLocalRuntimeReplyReadiness: readiness,
			replyReadiness: SERVICE_NOT_CONNECTED_REPLY_READINESS,
			hasSelectedEnvironment: kind !== "unselected",
			isReconcilingStatus: kind === "reconciling",
		});
		expect(
			screen.queryByRole("button", { name: "Reconnect in browser" })
		).toBeNull();
		expect(desktop.openWeb).not.toHaveBeenCalled();
		if (kind === "unselected") {
			expect(
				screen.getByText(
					"This computer has multiple Service connections. Open Advanced connection details below to choose one."
				)
			).toBeTruthy();
		}
	});

	it.each([
		"computer",
		"account",
		"organization",
		"lane",
	])("does not apply an old browser result after the %s changes", async (scope) => {
		desktop.enabled = true;
		let resolveOpen!: () => void;
		desktop.openWeb.mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					resolveOpen = resolve;
				})
		);
		const input = {
			currentLocalRuntimeReplyReadiness:
				buildCurrentLocalRuntimeReplyReadiness(),
			replyReadiness: SERVICE_NOT_CONNECTED_REPLY_READINESS,
		};
		const view = renderOpenMeldServiceCard(input);
		fireEvent.click(
			screen.getByRole("button", { name: "Reconnect in browser" })
		);
		const next = {
			...input,
			computer: buildComputer(),
			organizationId: "org-acme",
			storageScope: "test",
		};
		if (scope === "computer") {
			next.computer.connectedComputerId = "another-computer";
		}
		if (scope === "account") {
			next.storageScope = "another-account";
		}
		if (scope === "organization") {
			next.organizationId = "another-org";
		}
		if (scope === "lane") {
			next.currentLocalRuntimeReplyReadiness =
				buildCurrentLocalRuntimeReplyReadiness({ runtimeLane: "canary" });
		}
		view.rerender(buildOpenMeldServiceCard(next));
		await act(async () => resolveOpen());
		expect(screen.queryByText("Continue in your browser.")).toBeNull();
	});

	it("keeps team cards read-only on Desktop", () => {
		desktop.enabled = true;
		render(
			<OpenMeldServiceCard
				computer={{
					deviceDisplayName: "Other Mac",
					ownerLabel: "Other owner",
					serviceState: "needs_attention",
				}}
				view="team"
			/>
		);
		expect(screen.queryByRole("button")).toBeNull();
		expect(desktop.openWeb).not.toHaveBeenCalled();
	});

	it.each([
		"offline",
		"stale",
		"lane",
		"device",
		"account",
	])("does not infer recovery from a %s observation", (kind) => {
		const readiness = buildCurrentLocalRuntimeReplyReadiness({
			updateOperation: buildUpdateOperation({ phase: "needs_help" }),
		});
		readiness.runtime.lastObservedAtMs = Date.parse("2026-08-25T10:01:00Z");
		if (kind === "offline") {
			readiness.service.connected = false;
		}
		if (kind === "stale") {
			readiness.runtime.lastObservedAtMs = Date.parse("2026-08-25T09:59:00Z");
		}
		if (kind === "lane") {
			readiness.service.sessionLane = "prod";
		}
		if (kind === "device") {
			readiness.service.sessionDeviceId = "another-device";
		}
		if (kind === "account") {
			readiness.service.matchingCurrentRuntime = false;
		}
		renderOpenMeldServiceCard({
			currentLocalRuntimeReplyReadiness: readiness,
			replyReadiness: READY_REPLY_READINESS,
		});
		expect(screen.getByText("Last update failed.")).toBeTruthy();
		expect(
			screen.getByText(
				"Waiting for a current connection report after that attempt."
			)
		).toBeTruthy();
		expect(screen.getByText("Last update details")).toBeTruthy();
	});

	it.each([
		"service",
		"skills",
	] as const)("keeps current %s updates separate from split-target failed history", (component) => {
		const readiness = buildCurrentLocalRuntimeReplyReadiness({
			updateOperation: {
				...buildUpdateOperation({ phase: "restored" }),
				targetCliVersion: "0.8.0",
				targetServiceVersion: "0.7.92",
			},
		});
		readiness.runtime.lastObservedAtMs = Date.parse("2026-08-25T10:01:00Z");
		readiness.localComponents[component].status = "update_required";
		readiness.localComponents[component].wakeBlocked = true;
		renderOpenMeldServiceCard({
			currentLocalRuntimeReplyReadiness: readiness,
			replyReadiness: READY_REPLY_READINESS,
		});
		expect(screen.getAllByText("Update required").length).toBeGreaterThan(0);
		expect(
			screen.getByText("Requested CLI: 0.8.0; Service: 0.7.92")
		).toBeTruthy();
		expect(
			screen.getByText(
				"The previous installation was restored; the requested update did not complete."
			)
		).toBeTruthy();
		expect(screen.queryByText("Disconnected")).toBeNull();
		expect(requestCurrentOpenMeldToolsUpdateMock).not.toHaveBeenCalled();
	});

	it("summarizes a healthy installation as one ready OpenMeld Tools outcome", () => {
		renderOpenMeldServiceCard({
			currentLocalRuntimeReplyReadiness: null,
			replyReadiness: READY_REPLY_READINESS,
		});

		expect(screen.getByText("Connected")).toBeTruthy();
		expect(
			screen.queryByLabelText("OpenMeld Service connection: Connected")
		).toBeNull();
	});

	it("shows an execution Host blocker without claiming the connected computer is disconnected", () => {
		const readiness = buildCurrentLocalRuntimeReplyReadiness();
		readiness.canReplyFromThisComputer = false;
		readiness.message =
			"OpenMeld cannot confirm that work from the previous local execution host has ended. Restart this computer only if OpenMeld does not recover after the previous task ends.";
		readiness.nextAction = "none";
		readiness.primaryBlocker = "execution_host_unavailable";
		readiness.service.executionHost = {
			activeCount: null,
			admission: null,
			hostInstanceId: "775cb4ce-60fd-4581-b2b7-03a0381711c3",
			observedAtMs: null,
			pendingCount: null,
			responsive: false,
			startupReplayPending: null,
			unacknowledgedResultCount: null,
			unavailableReason: {
				code: "host.previous_work_unconfirmed",
				message:
					"OpenMeld cannot confirm that work from the previous local execution host has ended.",
				recoveryAction: "restart_computer",
			},
		};
		readiness.service.reasonCodes = ["host.previous_work_unconfirmed"];
		readiness.status = "blocked";

		renderOpenMeldServiceCard({
			currentLocalRuntimeReplyReadiness: readiness,
			replyReadiness: {
				detailReasonCode: "host.previous_work_unconfirmed",
				executionTargetStatus: "ready",
				reasonCode: "execution_host.unavailable",
				service: null,
				status: "needs_repair",
			},
		});

		expect(screen.getByText("Local execution paused")).toBeTruthy();
		expect(screen.getByText(readiness.message)).toBeTruthy();
		expect(screen.queryByText("Disconnected")).toBeNull();
		expect(
			screen.queryByRole("link", { name: "Reconnect Computer" })
		).toBeNull();
	});

	it("shows OpenMeld tools as one card with a component list", () => {
		renderOpenMeldServiceCard({
			currentLocalRuntimeReplyReadiness:
				buildCurrentLocalRuntimeReplyReadiness(),
			replyReadiness: READY_REPLY_READINESS,
		});

		expect(screen.getByText("Computer Connection")).toBeTruthy();
		expect(screen.getByText("Connected")).toBeTruthy();
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

	it("shows only the manual update path when an older Service cannot manage its own update", () => {
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
			name: "Update manually",
		});

		expect(screen.getAllByText("Update required").length).toBeGreaterThan(0);
		expect(updateLink).toHaveProperty("pathname", "/o/acme/connect");
		expect(updateLink).toHaveProperty(
			"search",
			"?connectedComputerId=computer-macbook-pro&serviceAction=update_service&session=fresh"
		);
		expect(
			screen.getAllByRole("link", { name: "Update manually" })
		).toHaveLength(1);
		expect(screen.queryByRole("button", { name: "Update" })).toBeNull();
		expect(screen.queryByText("Update OpenMeld Service")).toBeNull();
	});

	it("shows the current installable release as the single required update target", () => {
		renderOpenMeldServiceCard({
			currentLocalRuntimeReplyReadiness: buildCurrentLocalRuntimeReplyReadiness(
				{
					maintenance: {
						automaticUpdatesEnabled: true,
						status: "ready",
					},
					service: {
						installedVersion: "0.3.125",
						latestVersion: "0.3.127",
						reasonCodes: ["service.version_outdated"],
						requiredVersion: "0.3.127",
						status: "update_required",
						updatePolicy: "required",
						wakeBlocked: true,
					},
				}
			),
			replyReadiness: SERVICE_UPDATE_REQUIRED_REPLY_READINESS,
		});

		expect(screen.getAllByText("Update required").length).toBeGreaterThan(0);
		expect(screen.getByText("Update to v0.3.127.")).toBeTruthy();
		const updateButton = screen.getByRole("button", { name: "Update" });
		const manualUpdateLink = screen.getByRole("link", {
			name: "Update manually",
		});
		expect(updateButton).toBeTruthy();
		expect(
			screen.getAllByRole("link", { name: "Update manually" })
		).toHaveLength(1);
		expect(manualUpdateLink.className).toContain("text-muted-foreground");
		expect(manualUpdateLink.className).toContain("text-xs");
		expect(manualUpdateLink.className).toContain("hover:underline");
		expect(manualUpdateLink.className).toContain("focus-visible:ring-2");
		expect(manualUpdateLink.nextElementSibling).toBe(updateButton);
		expect(screen.queryByText("Required: v0.3.126.")).toBeNull();
	});

	it("does not offer an update when Core has no actionable release", () => {
		renderOpenMeldServiceCard({
			currentLocalRuntimeReplyReadiness: buildCurrentLocalRuntimeReplyReadiness(
				{
					maintenance: {
						automaticUpdatesEnabled: true,
						status: "ready",
					},
					service: {
						installedVersion: "0.3.152",
						latestVersion: null,
						reasonCodes: ["local_components.release_manifest_invalid"],
						requiredVersion: null,
						status: "unknown",
						updatePolicy: "required",
						wakeBlocked: true,
					},
				}
			),
			replyReadiness: SERVICE_UPDATE_REQUIRED_REPLY_READINESS,
		});

		expect(screen.getAllByText("Update required").length).toBeGreaterThan(0);
		expect(screen.queryByRole("button", { name: "Update" })).toBeNull();
		expect(screen.queryByRole("link", { name: "Update manually" })).toBeNull();
		expect(screen.queryByText("Required:", { exact: false })).toBeNull();
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
			name: "Update manually",
		});

		expect(screen.getAllByText("Update available").length).toBeGreaterThan(0);
		const serviceUpdateText = screen.getByText(
			"A newer version of OpenMeld is available."
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
			screen.getAllByRole("link", { name: "Update manually" })
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
		const manualUpdateLink = screen.getByRole("link", {
			name: "Update manually",
		});
		expect(manualUpdateLink).toHaveProperty("pathname", "/o/acme/connect");
		expect(manualUpdateLink).toHaveProperty(
			"search",
			"?connectedComputerId=computer-macbook-pro&serviceAction=update_service&session=fresh"
		);
		const updatingButton = screen.getByRole("button", { name: "Updating…" });
		expect((updatingButton as HTMLButtonElement).disabled).toBe(true);
		expect(updatingButton.querySelector(".shimmer-text")?.textContent).toBe(
			"Updating…"
		);
		const checkingStatus = screen.getByText("Checking…");
		expect(checkingStatus.getAttribute("aria-live")).toBe("polite");

		finishRequest(result);

		await waitFor(() => {
			expect(setQueryDataMock).toHaveBeenCalledTimes(1);
		});
		expect(
			(screen.getByRole("button", { name: "Updating…" }) as HTMLButtonElement)
				.disabled
		).toBe(true);
		expect(toastSuccessMock).not.toHaveBeenCalled();
	});

	it("waits for observed component truth before reporting an update as complete", async () => {
		requestCurrentOpenMeldToolsUpdateMock.mockResolvedValueOnce({
			currentVersion: "0.8.0",
			status: "current",
		});
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
			expect(refreshSharedCachesMock).toHaveBeenCalled();
		});
		expect(toastSuccessMock).not.toHaveBeenCalled();
		expect(screen.getByText("Verifying…")).toBeTruthy();
		expect(
			(screen.getByRole("button", { name: "Updating…" }) as HTMLButtonElement)
				.disabled
		).toBe(true);
	});

	it("keeps an in-progress update visible after a fresh mount", () => {
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
					updateOperation: buildUpdateOperation({ phase: "updating" }),
				}
			),
			replyReadiness: READY_REPLY_READINESS,
		});

		expect(
			screen.getByText("Updating…", { selector: "[aria-live]" })
		).toBeTruthy();
		expect(
			(screen.getByRole("button", { name: "Updating…" }) as HTMLButtonElement)
				.disabled
		).toBe(true);
	});

	it("verifies an updated operation after a fresh mount until both installed versions match", () => {
		renderOpenMeldServiceCard({
			currentLocalRuntimeReplyReadiness: buildCurrentLocalRuntimeReplyReadiness(
				{
					cli: {
						commandContractVersion:
							"openmeld-cli-command-contract-2026-05-local-components-v1",
						installedPackageVersion: "0.7.99",
						latestPackageVersion: "0.8.0",
						reasonCodes: ["cli.package_update_available"],
						requiredCommandContractVersion: null,
						status: "update_available",
						updatePolicy: "available",
						wakeBlocked: false,
					},
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
					updateOperation: buildUpdateOperation({ phase: "updated" }),
				}
			),
			replyReadiness: READY_REPLY_READINESS,
		});

		expect(screen.getByText("Verifying…")).toBeTruthy();
		expect(screen.queryByText("Up to date")).toBeNull();
	});

	it("hides completed update feedback while keeping software version details", () => {
		renderOpenMeldServiceCard({
			currentLocalRuntimeReplyReadiness: buildCurrentLocalRuntimeReplyReadiness(
				{
					cli: {
						commandContractVersion:
							"openmeld-cli-command-contract-2026-05-local-components-v1",
						installedPackageVersion: "0.8.0",
						latestPackageVersion: "0.8.0",
						reasonCodes: [],
						requiredCommandContractVersion: null,
						status: "current",
						updatePolicy: "ok",
						wakeBlocked: false,
					},
					maintenance: {
						automaticUpdatesEnabled: true,
						status: "ready",
					},
					service: {
						installedVersion: "0.8.0",
						latestVersion: "0.8.0",
						reasonCodes: [],
						requiredVersion: null,
						status: "current",
						updatePolicy: "ok",
						wakeBlocked: false,
					},
					updateOperation: buildUpdateOperation({ phase: "updated" }),
				}
			),
			replyReadiness: READY_REPLY_READINESS,
		});

		expect(screen.queryByText("Up to date")).toBeNull();
		expect(screen.getByText("Software versions")).toBeTruthy();
		expect(screen.queryByText("Verifying…")).toBeNull();
		expect(screen.getByText("Connected")).toBeTruthy();
	});

	it.each([
		"restored",
		"needs_help",
	] as const)("keeps the authoritative %s failure visible after both installed versions converge", (phase) => {
		renderOpenMeldServiceCard({
			currentLocalRuntimeReplyReadiness: buildCurrentLocalRuntimeReplyReadiness(
				{
					cli: {
						commandContractVersion:
							"openmeld-cli-command-contract-2026-05-local-components-v1",
						installedPackageVersion: "0.8.0",
						latestPackageVersion: "0.8.0",
						reasonCodes: [],
						requiredCommandContractVersion: null,
						status: "current",
						updatePolicy: "ok",
						wakeBlocked: false,
					},
					maintenance: {
						automaticUpdatesEnabled: true,
						status: "ready",
					},
					service: {
						installedVersion: "0.8.0",
						latestVersion: "0.8.0",
						reasonCodes: [],
						requiredVersion: null,
						status: "current",
						updatePolicy: "ok",
						wakeBlocked: false,
					},
					updateOperation: buildUpdateOperation({ phase }),
				}
			),
			replyReadiness: READY_REPLY_READINESS,
		});

		expect(screen.getByText("Last update failed.")).toBeTruthy();
		expect(screen.queryByText("Up to date")).toBeNull();
		expect(screen.getByText("Connected")).toBeTruthy();
	});

	it("keeps updating while the owner is still updating even when the target versions are visible", () => {
		renderOpenMeldServiceCard({
			currentLocalRuntimeReplyReadiness: buildCurrentLocalRuntimeReplyReadiness(
				{
					cli: {
						commandContractVersion:
							"openmeld-cli-command-contract-2026-05-local-components-v1",
						installedPackageVersion: "0.8.0",
						latestPackageVersion: "0.8.0",
						reasonCodes: [],
						requiredCommandContractVersion: null,
						status: "current",
						updatePolicy: "ok",
						wakeBlocked: false,
					},
					maintenance: {
						automaticUpdatesEnabled: true,
						status: "ready",
					},
					service: {
						installedVersion: "0.8.0",
						latestVersion: "0.8.0",
						reasonCodes: [],
						requiredVersion: null,
						status: "current",
						updatePolicy: "ok",
						wakeBlocked: false,
					},
					updateOperation: buildUpdateOperation({ phase: "updating" }),
				}
			),
			replyReadiness: READY_REPLY_READINESS,
		});

		expect(
			screen.getByText("Updating…", { selector: "[aria-live]" })
		).toBeTruthy();
		expect(screen.queryByText("Up to date")).toBeNull();
	});

	it("settles an exact update target when a newer release is already available", () => {
		renderOpenMeldServiceCard({
			currentLocalRuntimeReplyReadiness: buildCurrentLocalRuntimeReplyReadiness(
				{
					cli: {
						commandContractVersion:
							"openmeld-cli-command-contract-2026-05-local-components-v1",
						installedPackageVersion: "0.8.0",
						latestPackageVersion: "0.9.0",
						reasonCodes: ["cli.package_update_available"],
						requiredCommandContractVersion: null,
						status: "update_available",
						updatePolicy: "available",
						wakeBlocked: false,
					},
					maintenance: {
						automaticUpdatesEnabled: true,
						status: "ready",
					},
					service: {
						installedVersion: "0.8.0",
						latestVersion: "0.9.0",
						reasonCodes: ["service.update_available"],
						requiredVersion: null,
						status: "update_available",
						updatePolicy: "available",
						wakeBlocked: false,
					},
					updateOperation: buildUpdateOperation({ phase: "updated" }),
				}
			),
			replyReadiness: READY_REPLY_READINESS,
		});

		expect(screen.getAllByText("Update available").length).toBeGreaterThan(0);
		expect(screen.getByRole("button", { name: "Update" })).toBeTruthy();
		expect(screen.queryByText("Verifying…")).toBeNull();
		expect(screen.queryByText("Up to date")).toBeNull();
	});

	it("settles the clicked update when its exact target is installed and a newer release is available", async () => {
		requestCurrentOpenMeldToolsUpdateMock.mockResolvedValueOnce({
			operation: buildUpdateOperation({ phase: "updating" }),
			status: "started",
		});
		const view = renderOpenMeldServiceCard({
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
			expect(screen.getByRole("button", { name: "Updating…" })).toBeTruthy();
		});

		view.rerender(
			buildOpenMeldServiceCard({
				currentLocalRuntimeReplyReadiness:
					buildCurrentLocalRuntimeReplyReadiness({
						cli: {
							commandContractVersion:
								"openmeld-cli-command-contract-2026-05-local-components-v1",
							installedPackageVersion: "0.8.0",
							latestPackageVersion: "0.9.0",
							reasonCodes: ["cli.package_update_available"],
							requiredCommandContractVersion: null,
							status: "update_available",
							updatePolicy: "available",
							wakeBlocked: false,
						},
						maintenance: {
							automaticUpdatesEnabled: true,
							status: "ready",
						},
						service: {
							installedVersion: "0.8.0",
							latestVersion: "0.9.0",
							reasonCodes: ["service.update_available"],
							requiredVersion: null,
							status: "update_available",
							updatePolicy: "available",
							wakeBlocked: false,
						},
						updateOperation: buildUpdateOperation({ phase: "updated" }),
					}),
				replyReadiness: READY_REPLY_READINESS,
			})
		);

		await waitFor(() => {
			expect(
				(screen.getByRole("button", { name: "Update" }) as HTMLButtonElement)
					.disabled
			).toBe(false);
		});
		expect(screen.getAllByText("Update available").length).toBeGreaterThan(0);
		expect(screen.queryByText("Updating…")).toBeNull();
		expect(screen.queryByText("Verifying…")).toBeNull();
		expect(screen.queryByText("Up to date")).toBeNull();
	});

	it("does not let a stale refetch move the same update operation backward", async () => {
		requestCurrentOpenMeldToolsUpdateMock.mockResolvedValueOnce({
			operation: {
				operationId: "update-1",
				phase: "updating",
				requestSource: "web",
				requestedAt: "2026-08-25T10:00:00.000Z",
				targetVersion: "0.8.0",
				updatedAt: "2026-08-25T10:00:02.000Z",
				urgency: "available",
			},
			status: "started",
		});
		const view = renderOpenMeldServiceCard({
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
			expect(screen.getByRole("button", { name: "Updating…" })).toBeTruthy();
		});

		view.rerender(
			buildOpenMeldServiceCard({
				currentLocalRuntimeReplyReadiness:
					buildCurrentLocalRuntimeReplyReadiness({
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
						updateOperation: {
							operationId: "update-1",
							phase: "waiting_for_work",
							requestSource: "web",
							requestedAt: "2026-08-25T10:00:00.000Z",
							targetVersion: "0.8.0",
							updatedAt: "2026-08-25T10:00:01.000Z",
							urgency: "available",
						},
					}),
				replyReadiness: READY_REPLY_READINESS,
			})
		);

		expect(screen.queryByText("Finishing…")).toBeNull();
		expect(
			screen.getByText("Updating…", { selector: "[aria-live]" })
		).toBeTruthy();
	});

	it("keeps polling after installation ends until both installed versions catch up", async () => {
		requestCurrentOpenMeldToolsUpdateMock.mockResolvedValueOnce({
			operation: {
				operationId: "update-1",
				phase: "updating",
				requestSource: "web",
				requestedAt: "2026-08-25T10:00:00.000Z",
				targetVersion: "0.8.0",
				updatedAt: "2026-08-25T10:00:01.000Z",
				urgency: "available",
			},
			status: "started",
		});
		const view = renderOpenMeldServiceCard({
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
			expect(screen.getByRole("button", { name: "Updating…" })).toBeTruthy();
		});
		view.rerender(
			buildOpenMeldServiceCard({
				currentLocalRuntimeReplyReadiness:
					buildCurrentLocalRuntimeReplyReadiness({
						cli: {
							commandContractVersion:
								"openmeld-cli-command-contract-2026-05-local-components-v1",
							installedPackageVersion: "0.7.99",
							latestPackageVersion: "0.8.0",
							reasonCodes: ["cli.package_update_available"],
							requiredCommandContractVersion: null,
							status: "update_available",
							updatePolicy: "available",
							wakeBlocked: false,
						},
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
						updateOperation: {
							operationId: "update-1",
							phase: "updated",
							requestSource: "web",
							requestedAt: "2026-08-25T10:00:00.000Z",
							targetVersion: "0.8.0",
							updatedAt: "2026-08-25T10:00:02.000Z",
							urgency: "available",
						},
					}),
				replyReadiness: READY_REPLY_READINESS,
			})
		);

		expect(screen.queryByText("Up to date")).toBeNull();
		expect(screen.getByText("Verifying…")).toBeTruthy();
		expect(
			(screen.getByRole("button", { name: "Updating…" }) as HTMLButtonElement)
				.disabled
		).toBe(true);
		await waitFor(
			() => {
				expect(refreshSharedCachesMock).toHaveBeenCalled();
			},
			{ timeout: 3000 }
		);
	});

	it("settles an update after its separate CLI and Service targets are observed", () => {
		const operation = {
			...buildUpdateOperation({ phase: "updated" }),
			targetCliVersion: "0.9.0",
			targetServiceVersion: "0.8.0",
		};
		renderOpenMeldServiceCard({
			currentLocalRuntimeReplyReadiness: buildCurrentLocalRuntimeReplyReadiness(
				{
					cli: {
						commandContractVersion:
							"openmeld-cli-command-contract-2026-05-local-components-v1",
						installedPackageVersion: "0.9.0",
						latestPackageVersion: "0.9.0",
						reasonCodes: [],
						requiredCommandContractVersion: null,
						status: "current",
						updatePolicy: "ok",
						wakeBlocked: false,
					},
					service: {
						installedVersion: "0.8.0",
						latestVersion: "0.8.0",
						reasonCodes: [],
						requiredVersion: null,
						status: "current",
						updatePolicy: "ok",
						wakeBlocked: false,
					},
					updateOperation: operation,
				}
			),
			replyReadiness: READY_REPLY_READINESS,
		});

		expect(screen.queryByText("Verifying…")).toBeNull();
		expect(screen.queryByRole("button", { name: "Updating…" })).toBeNull();
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

	it.each([
		"restored",
		"needs_help",
	] as const)("shows an honest retryable outcome when the update owner reports %s", (phase) => {
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
					updateOperation: buildUpdateOperation({ phase }),
				}
			),
			replyReadiness: READY_REPLY_READINESS,
		});

		expect(screen.getByText("Last update failed.")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Update" })).toBeTruthy();
		expect(screen.getByRole("link", { name: "Update manually" })).toBeTruthy();
	});

	it.each([
		"restored",
		"needs_help",
	] as const)("shows the fixed safe message for the terminal %s failure reason", (phase) => {
		const failureMessage =
			"The update download stopped making progress. Check this computer's connection and try again.";
		renderOpenMeldServiceCard({
			currentLocalRuntimeReplyReadiness: buildCurrentLocalRuntimeReplyReadiness(
				{
					cli: {
						commandContractVersion:
							"openmeld-cli-command-contract-2026-05-local-components-v1",
						installedPackageVersion: "0.7.99",
						latestPackageVersion: "0.8.0",
						reasonCodes: [
							"cli.package_update_available",
							"cli.update.download_stalled",
							"cli.update.failed",
						],
						requiredCommandContractVersion: null,
						status: "update_available",
						updatePolicy: "available",
						wakeBlocked: false,
					},
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
					updateOperation: buildUpdateOperation({ phase }),
				}
			),
			replyReadiness: READY_REPLY_READINESS,
		});

		expect(screen.getByText(failureMessage)).toBeTruthy();
		expect(screen.queryByText("Update failed. Try again.")).toBeNull();
		expect(screen.getByRole("button", { name: "Update" })).toBeTruthy();
		expect(screen.getByRole("link", { name: "Update manually" })).toBeTruthy();
	});

	it("does not surface an update failure reason before the operation is terminal", () => {
		const readiness = buildCurrentLocalRuntimeReplyReadiness({
			maintenance: {
				automaticUpdatesEnabled: true,
				status: "ready",
			},
			updateOperation: buildUpdateOperation({ phase: "updating" }),
		});
		readiness.localComponents.cli.reasonCodes = ["cli.update.download_stalled"];

		renderOpenMeldServiceCard({
			currentLocalRuntimeReplyReadiness: readiness,
			replyReadiness: READY_REPLY_READINESS,
		});

		expect(screen.getByText("Updating…")).toBeTruthy();
		expect(
			screen.queryByText(
				"The update download stopped making progress. Check this computer's connection and try again."
			)
		).toBeNull();
	});

	it("stops polling after repeated refresh failures and keeps both recovery actions", async () => {
		vi.useFakeTimers();
		const consoleErrorMock = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		refreshSharedCachesMock.mockRejectedValue(new Error("refresh unavailable"));
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
					updateOperation: buildUpdateOperation({ phase: "updated" }),
				}
			),
			replyReadiness: READY_REPLY_READINESS,
		});

		await act(async () => {
			await vi.advanceTimersByTimeAsync(6000);
		});
		expect(
			screen.getByText(
				"Couldn't verify the update. Try again or update manually."
			)
		).toBeTruthy();
		const callsAfterBudget = refreshSharedCachesMock.mock.calls.length;
		await act(async () => {
			await vi.advanceTimersByTimeAsync(20_000);
		});
		expect(refreshSharedCachesMock).toHaveBeenCalledTimes(callsAfterBudget);
		expect(screen.getByRole("button", { name: "Update" })).toBeTruthy();
		expect(screen.getByRole("link", { name: "Update manually" })).toBeTruthy();
		expect(consoleErrorMock).toHaveBeenCalled();
	});

	it("stops polling when successful refreshes never produce the target projection", async () => {
		vi.useFakeTimers();
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
					updateOperation: buildUpdateOperation({ phase: "updated" }),
				}
			),
			replyReadiness: READY_REPLY_READINESS,
		});

		await act(async () => {
			await vi.advanceTimersByTimeAsync(120_000);
		});
		expect(
			screen.getByText(
				"Couldn't verify the update. Try again or update manually."
			)
		).toBeTruthy();
		const callsAfterBudget = refreshSharedCachesMock.mock.calls.length;
		await act(async () => {
			await vi.advanceTimersByTimeAsync(20_000);
		});
		expect(refreshSharedCachesMock).toHaveBeenCalledTimes(callsAfterBudget);
	});

	it("keeps reading through a short Service replacement and converges without a refresh", async () => {
		vi.useFakeTimers();
		requestCurrentOpenMeldToolsUpdateMock.mockResolvedValueOnce({
			operation: buildUpdateOperation({ phase: "updating" }),
			status: "started",
		});
		const view = renderOpenMeldServiceCard({
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
		await act(async () => await Promise.resolve());
		view.rerender(
			buildOpenMeldServiceCard({
				currentLocalRuntimeReplyReadiness: null,
				replyReadiness: SERVICE_NOT_CONNECTED_REPLY_READINESS,
			})
		);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(2000);
		});
		expect(refreshSharedCachesMock).toHaveBeenCalled();

		view.rerender(
			buildOpenMeldServiceCard({
				currentLocalRuntimeReplyReadiness:
					buildCurrentLocalRuntimeReplyReadiness({
						cli: {
							commandContractVersion:
								"openmeld-cli-command-contract-2026-05-local-components-v1",
							installedPackageVersion: "0.8.0",
							latestPackageVersion: "0.8.0",
							reasonCodes: [],
							requiredCommandContractVersion: null,
							status: "current",
							updatePolicy: "ok",
							wakeBlocked: false,
						},
						maintenance: {
							automaticUpdatesEnabled: true,
							status: "ready",
						},
						service: {
							installedVersion: "0.8.0",
							latestVersion: "0.8.0",
							reasonCodes: [],
							requiredVersion: null,
							status: "current",
							updatePolicy: "ok",
							wakeBlocked: false,
						},
						updateOperation: buildUpdateOperation({ phase: "updated" }),
					}),
				replyReadiness: READY_REPLY_READINESS,
			})
		);

		expect(screen.queryByText("Up to date")).toBeNull();
		expect(screen.getByText("Connected")).toBeTruthy();
	});

	it("clears update verification timers when the card unmounts", async () => {
		vi.useFakeTimers();
		const view = renderOpenMeldServiceCard({
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
					updateOperation: buildUpdateOperation({ phase: "updated" }),
				}
			),
			replyReadiness: READY_REPLY_READINESS,
		});

		view.unmount();
		await act(async () => {
			await vi.advanceTimersByTimeAsync(20_000);
		});
		expect(refreshSharedCachesMock).not.toHaveBeenCalled();
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

		expect(screen.getAllByText("Update available").length).toBeGreaterThan(0);
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

		fireEvent.click(screen.getByRole("button", { name: "OpenMeld options" }));
		const toggle = await screen.findByRole("menuitemcheckbox", {
			name: "Automatic updates",
		});
		expect(toggle.getAttribute("aria-checked")).toBe("true");
		expect(screen.getByText("Finishing…")).toBeTruthy();
		fireEvent.click(toggle);

		await waitFor(() => {
			expect(setCurrentOpenMeldToolsMaintenanceMock).toHaveBeenCalledWith({
				deviceId: "device-macbook-pro",
				runtimeLane: "dev-local",
				automaticUpdatesEnabled: false,
			});
		});
	});

	it("uses only the manual update path for a CLI-only update when the Service cannot manage it", () => {
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

		expect(screen.getAllByText("Update available").length).toBeGreaterThan(0);
		expect(
			screen
				.getAllByText("Update available")
				.some((element) => element.className.includes("text-amber"))
		).toBe(true);
		expect(screen.getByText("Latest available: v0.7.92.")).toBeTruthy();
		const manualUpdateLink = screen.getByRole("link", {
			name: "Update manually",
		});
		expect(
			decodeURIComponent(manualUpdateLink.getAttribute("href") ?? "")
		).toContain("serviceAction=update_service");
		expect(
			screen.queryByRole("button", { name: "Update OpenMeld Tools" })
		).toBeNull();
		expect(screen.queryByRole("button", { name: "Update" })).toBeNull();
		expect(
			screen.getAllByRole("link", { name: "Update manually" })
		).toHaveLength(1);
	});

	it("uses managed OpenMeld Tools control for a CLI-only update when the Service supports it", () => {
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
					maintenance: {
						automaticUpdatesEnabled: true,
						status: "ready",
					},
					runtimeLane: "prod",
				}
			),
			replyReadiness: READY_REPLY_READINESS,
		});

		expect(screen.getByRole("button", { name: "Update" })).toBeTruthy();
		expect(screen.getByRole("link", { name: "Update manually" })).toBeTruthy();
		expect(
			screen.queryByRole("button", { name: "Update OpenMeld Tools" })
		).toBeNull();
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

	it("uses the manual aggregate action for a required CLI update without managed capability", () => {
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

		expect(screen.getAllByText("Update required").length).toBeGreaterThan(0);
		expect(screen.getAllByText("Update required").length).toBeGreaterThan(0);
		expect(
			screen.getByText((content) =>
				content.includes("Required CLI contract update.")
			)
		).toBeTruthy();
		expect(screen.getByRole("link", { name: "Update manually" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Update" })).toBeNull();
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

		expect(screen.getAllByText("Update required").length).toBeGreaterThan(0);
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

		expect(screen.getAllByText("Update available").length).toBeGreaterThan(0);
		expect(
			screen
				.getAllByText("Update available")
				.some((element) => element.className.includes("text-amber"))
		).toBe(true);
		expect(
			screen.getByText("A newer OpenMeld skill is available.")
		).toBeTruthy();
		const updateLink = screen.getByRole("link", {
			name: "Update manually",
		});
		expect(updateLink).toHaveProperty("pathname", "/o/acme/connect");
		expect(updateLink).toHaveProperty(
			"search",
			"?connectedComputerId=computer-macbook-pro&serviceAction=update_service&session=fresh"
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

		expect(screen.getByText("Checking OpenMeld status...")).toBeTruthy();
		expect(screen.queryByText("Update available")).toBeNull();
		expect(screen.queryByRole("link", { name: "Update manually" })).toBeNull();
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

		expect(screen.getAllByText("Update required").length).toBeGreaterThan(0);
		expect(screen.getAllByText("Update required").length).toBeGreaterThan(0);
		expect(screen.getByRole("link", { name: "Update manually" })).toBeTruthy();
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
			screen.getAllByRole("link", { name: "Update manually" })
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
			screen.getByRole("link", { name: "Reconnect Computer" }).className
		).toContain("text-destructive");
		fireEvent.click(screen.getByRole("button", { name: "OpenMeld options" }));
		expect(
			screen.getAllByRole("link", { name: "Reconnect Computer" })
		).toHaveLength(1);
		expect(
			screen.getByRole("menuitem", { name: "Reconnect Computer" })
		).toBeTruthy();
		expect(
			screen.queryByRole("link", { name: "Reconnect OpenMeld Service" })
		).toBeNull();
		expect(
			screen.queryByLabelText("OpenMeld Service connection: Not connected")
		).toBeNull();
	});

	it("describes an inconclusive Service observation as delayed instead of unavailable", () => {
		renderOpenMeldServiceCard({
			currentLocalRuntimeReplyReadiness: null,
			replyReadiness: {
				detailReasonCode: null,
				executionTargetStatus: "unknown",
				reasonCode: "background_helper.unknown",
				service: null,
				status: "unknown",
			},
		});

		expect(screen.getByText("Connection status delayed")).toBeTruthy();
		expect(screen.queryByText("Status unavailable")).toBeNull();
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

		expect(screen.getByText("Disconnected")).toBeTruthy();
		expect(
			screen.getByRole("link", { name: "Reconnect Computer" })
		).toBeTruthy();
		expect(screen.queryByText("OpenMeld Service is connected")).toBeNull();
	});

	it("explains an account conflict instead of reporting ordinary disconnection", () => {
		const readiness = buildCurrentLocalRuntimeReplyReadiness();
		renderOpenMeldServiceCard({
			replyReadiness: READY_REPLY_READINESS,
			currentLocalRuntimeReplyReadiness: {
				...readiness,
				service: {
					...readiness.service,
					connected: false,
					matchingCurrentRuntime: false,
					reasonCodes: ["daemon.session.reject_conflict"],
				},
			},
		});
		expect(screen.getByText("Reconnect required")).toBeTruthy();
		expect(
			screen.getByText(
				"This computer is connected to another OpenMeld account. Reconnect it to use it with this account."
			)
		).toBeTruthy();
		expect(screen.queryByText("Disconnected")).toBeNull();
	});

	it("guides stale non-current computers back through setup", () => {
		renderOpenMeldServiceCard({
			computer: buildComputer({ isCurrent: false, targetStatus: "stale" }),
			currentLocalRuntimeReplyReadiness: null,
			hasSelectedEnvironment: false,
			replyReadiness: SERVICE_NOT_CONNECTED_REPLY_READINESS,
		});

		expect(screen.queryByText("Needs a fresh check")).toBeNull();
		expect(
			screen.getByText(
				"Connect this computer to view its tools and manage updates."
			)
		).toBeTruthy();
		expect(screen.getByRole("link", { name: "Set up" })).toHaveProperty(
			"pathname",
			"/o/acme/connect"
		);
		expect(screen.getByRole("link", { name: "Set up" })).toHaveProperty(
			"search",
			"?connectedComputerId=computer-macbook-pro&session=fresh"
		);

		fireEvent.click(screen.getByRole("button", { name: "OpenMeld options" }));

		expect(screen.queryByText("Check status")).toBeNull();
		expect(
			screen.getAllByRole("link", { name: "Set up" }).length
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
			signInOnlyBlockers: false,
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

function buildUpdateOperation(input: {
	phase: NonNullable<
		CurrentLocalRuntimeReplyReadinessResponse["localComponents"]["updateOperation"]
	>["phase"];
}) {
	return {
		operationId: "update-1",
		phase: input.phase,
		requestSource: "web" as const,
		requestedAt: "2026-08-25T10:00:00.000Z",
		targetVersion: "0.8.0",
		updatedAt: "2026-08-25T10:00:02.000Z",
		urgency: "available" as const,
	};
}

function renderOpenMeldServiceCard(input: {
	computer?: LocalRuntimeComputer;
	currentLocalRuntimeReplyReadiness: CurrentLocalRuntimeReplyReadinessResponse | null;
	hasSelectedEnvironment?: boolean;
	isReconcilingStatus?: boolean;
	replyReadiness: ComputerReplyReadiness;
}) {
	return render(buildOpenMeldServiceCard(input), {
		wrapper: TestQueryClientProvider,
	});
}

function buildOpenMeldServiceCard(input: {
	organizationId?: string;
	storageScope?: string;
	computer?: LocalRuntimeComputer;
	currentLocalRuntimeReplyReadiness: CurrentLocalRuntimeReplyReadinessResponse | null;
	hasSelectedEnvironment?: boolean;
	isReconcilingStatus?: boolean;
	replyReadiness: ComputerReplyReadiness;
}) {
	return (
		<TooltipProvider>
			<OpenMeldServiceCard
				computer={input.computer ?? buildComputer()}
				currentExpectedServiceVersion={null}
				currentLocalRuntimeReplyReadiness={
					input.currentLocalRuntimeReplyReadiness
				}
				focusService={false}
				hasSelectedEnvironment={input.hasSelectedEnvironment ?? true}
				isReconcilingStatus={input.isReconcilingStatus ?? false}
				organizationId={input.organizationId ?? "org-acme"}
				queryClient={queryClientStub}
				recovery={{
					...buildRecoveryStub(),
					storageScope: input.storageScope ?? "test",
				}}
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
