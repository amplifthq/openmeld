import type {
	CurrentLocalRuntimeReplyReadinessResponse,
	LocalRuntimeComputer,
	LocalRuntimeExecutionTarget,
	OrganizationComputersResponse,
	OrganizationDirectoryResponse,
} from "@openmeld/schemas/types";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import { createContext, type ReactNode, use } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ComputersPage, type ComputersRouteState } from "./computers-page";

// The leaf reuses `useLocalAgentRecoveryController` and `useQueryClient`, so
// both are mocked. The reused detail panel (`SelectedComputerPanel`) is stubbed
// to a recorder so this test asserts the picker render + URL-driven detail
// state without re-exercising the detail/Service/local-agents rendering.
const useLocalAgentRecoveryControllerMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const useQueryClientMock = vi.hoisted(() => vi.fn());
const selectedComputerPanelPropsSpy = vi.hoisted(() => vi.fn());
const useRefreshComputersAfterSetupCompleteMock = vi.hoisted(() => vi.fn());

const DEFAULT_COMPUTERS_ROUTE_STATE: ComputersRouteState = {
	computersFocusFileAccess: false,
	computersFocusService: false,
	computersSelectedDeviceId: null,
	computersSetupCompleteRefresh: false,
};
const COMPUTER_OPTIONS_NAME_PATTERN = /Computer options/;
let organizationComputersQueryData: OrganizationComputersResponse;
let organizationDirectoryQueryData: OrganizationDirectoryResponse;
const TestComputersRouteStateContext = createContext<ComputersRouteState>(
	DEFAULT_COMPUTERS_ROUTE_STATE
);

function TestComputersRouteStateProvider(input: {
	children: ReactNode;
	value: Partial<ComputersRouteState>;
}) {
	return (
		<TestComputersRouteStateContext.Provider
			value={{ ...DEFAULT_COMPUTERS_ROUTE_STATE, ...input.value }}
		>
			{input.children}
		</TestComputersRouteStateContext.Provider>
	);
}

function TestComputersPage() {
	return <ComputersPage routeState={use(TestComputersRouteStateContext)} />;
}

vi.mock("@tanstack/react-router", () => ({
	Link: ({ children, to, ...props }: { children: ReactNode; to: string }) => (
		<a href={to} {...props}>
			{children}
		</a>
	),
}));

const currentOrganizationMock = vi.hoisted(() => ({
	id: "org-acme",
	isPersonal: false,
	name: "Acme",
	slug: "acme",
}));

vi.mock("#/lib/organizations/organization-context", () => ({
	useAppOrganization: () => ({
		currentOrganization: currentOrganizationMock,
		currentUserId: "user-felix",
	}),
	useCurrentOrganizationSlug: () => currentOrganizationMock.slug,
}));

vi.mock("@tanstack/react-query", async () => {
	const actual = await vi.importActual<typeof import("@tanstack/react-query")>(
		"@tanstack/react-query"
	);
	return {
		...actual,
		useQuery: useQueryMock,
		useQueryClient: useQueryClientMock,
	};
});

vi.mock("#/components/agents/use-local-agent-recovery-controller", () => ({
	useLocalAgentRecoveryController: useLocalAgentRecoveryControllerMock,
}));

vi.mock("#/components/agents/selected-computer-panel", () => ({
	SelectedComputerPanel: (props: {
		computer: { deviceDisplayName: string; deviceId: string };
		focusFileAccess: boolean;
		focusService: boolean;
		isCurrentComputer?: boolean;
		onFocusConsumed?: () => void;
		setupCompleteRefreshPending: boolean;
	}) => {
		selectedComputerPanelPropsSpy(props);
		return (
			<div
				data-device-id={props.computer.deviceId}
				data-testid="selected-computer-panel"
			>
				{props.computer.deviceDisplayName}
			</div>
		);
	},
	useRefreshComputersAfterSetupComplete:
		useRefreshComputersAfterSetupCompleteMock,
}));

const queryClientStub = {
	fetchQuery: vi.fn(),
	invalidateQueries: vi.fn(),
};

function buildExecutionTarget(input: {
	deviceId: string;
	isCurrent: boolean;
	status?: LocalRuntimeExecutionTarget["status"];
}): LocalRuntimeExecutionTarget {
	const status = input.status ?? "ready";
	return {
		capabilities: [
			{
				agentControllerRef: "builtin:codex",
				enabled: true,
				reasonCodes: [],
				status: "ready",
			},
		],
		deviceId: input.deviceId,
		isCurrent: input.isCurrent,
		lastObservedAtMs: 1_700_000_020_000,
		localAgentControl: {
			refreshCatalog: input.isCurrent,
			setEnabled: input.isCurrent,
		},
		localAgentCatalog: {
			entries: [
				{
					agentId: "claude-code",
					detected: true,
					displayName: "Claude Code",
					enabled: true,
					launchStatus: "ready",
					selectable: true,
					selectableReason: null,
					targetKind: "builtin",
				},
				{
					agentId: "codex",
					detected: true,
					displayName: "Codex",
					enabled: true,
					launchStatus: "ready",
					selectable: true,
					selectableReason: null,
					targetKind: "builtin",
				},
				{
					agentId: "opencode",
					detected: true,
					displayName: "OpenCode",
					enabled: true,
					launchStatus: "ready",
					selectable: true,
					selectableReason: null,
					targetKind: "builtin",
				},
				{
					agentId: "openclaw",
					detected: true,
					displayName: "OpenClaw",
					enabled: true,
					launchStatus: "ready",
					selectable: true,
					selectableReason: null,
					targetKind: "builtin",
				},
			],
		},
		reasonCodes: [],
		openMeldServiceRuntimeId: {
			source: "runtime_registry_authority",
			value: `runtime-${input.deviceId}`,
		},
		runtimeLane: "dev-local",
		status,
		userFacingCommand: "openmeld",
	} as unknown as LocalRuntimeExecutionTarget;
}

function buildComputer(input: {
	deviceDisplayName: string;
	deviceId: string;
	isCurrent: boolean;
	targetStatus?: LocalRuntimeExecutionTarget["status"];
}): LocalRuntimeComputer {
	return {
		deviceDisplayName: input.deviceDisplayName,
		deviceDisplayNameSource: "observed",
		deviceId: input.deviceId,
		deviceType: "laptop",
		executionTargets: [
			buildExecutionTarget({
				deviceId: input.deviceId,
				isCurrent: input.isCurrent,
				status: input.targetStatus,
			}),
		],
		firstSeenAtMs: 1_700_000_000_000,
		isCurrent: input.isCurrent,
		lastObservedAtMs: 1_700_000_020_000,
		osVersion: "15.4",
		platformFamily: "macOS",
	} as unknown as LocalRuntimeComputer;
}

// Controller stub carrying just the slices the leaf reads: the device list, the
// liveness-first connected-runtime sources (`currentDeviceTargetQuery` +
// `currentLocalRuntimeReplyReadinessQuery`), and a couple of fields the detail
// panel would consume (the panel is stubbed, so a thin object is enough).
function buildRecoveryControllerStub(input: {
	devices: readonly LocalRuntimeComputer[];
	isPending?: boolean;
	connectedDeviceId?: string | null;
	currentReadiness?: CurrentLocalRuntimeReplyReadinessResponse | null;
	isCurrentReadinessFetching?: boolean;
	isCurrentReadinessFetchedAfterMount?: boolean;
}) {
	const connectedDeviceId =
		input.connectedDeviceId === undefined
			? (input.devices[0]?.deviceId ?? null)
			: input.connectedDeviceId;
	return {
		localRuntimesQuery: {
			data: {
				currentDeviceId: connectedDeviceId,
				currentRuntimeLane: "dev-local",
				localRuntimes: input.devices,
			},
			isPending: input.isPending ?? false,
		},
		currentDeviceTargetQuery: {
			data: connectedDeviceId
				? {
						availability: "resolved",
						deviceId: connectedDeviceId,
						runtimeLane: "dev-local",
					}
				: { availability: "missing" },
			isPending: false,
		},
		currentLocalRuntimeReplyReadinessQuery: {
			data: input.currentReadiness ?? undefined,
			isFetchedAfterMount: input.isCurrentReadinessFetchedAfterMount ?? true,
			isFetching: input.isCurrentReadinessFetching ?? false,
			isPending: false,
		},
	};
}

function buildCurrentRuntimeReadiness(input: {
	deviceId: string;
	localComponents?: CurrentLocalRuntimeReplyReadinessResponse["localComponents"];
	nextAction?: CurrentLocalRuntimeReplyReadinessResponse["nextAction"];
	primaryBlocker?: CurrentLocalRuntimeReplyReadinessResponse["primaryBlocker"];
	runtimeReasonCodes?: readonly string[];
	serviceConnected?: boolean;
	status?: CurrentLocalRuntimeReplyReadinessResponse["status"];
}): CurrentLocalRuntimeReplyReadinessResponse {
	const serviceConnected = input.serviceConnected ?? true;
	const primaryBlocker = input.primaryBlocker ?? "none";
	return {
		canReplyFromThisComputer: primaryBlocker === "none",
		currentTarget: {
			availability: "resolved",
			deviceId: input.deviceId,
			runtimeLane: "dev-local",
		},
		generatedAt: "2026-07-06T00:00:00.000Z",
		localComponents: input.localComponents ?? buildLocalComponents(),
		message:
			primaryBlocker === "service_not_connected"
				? "OpenMeld Service is not connected for this account on this computer."
				: "This computer is ready.",
		nextAction: input.nextAction ?? "none",
		primaryBlocker,
		runtime: {
			deviceDisplayName: "This MacBook",
			deviceId: input.deviceId,
			executionTargetStatus: "ready",
			lastObservedAtMs: 1_700_000_020_000,
			reasonCodes: [...(input.runtimeReasonCodes ?? [])],
			runtimeLane: "dev-local",
			openMeldServiceRuntimeId: {
				source: "runtime_registry_authority",
				value: `runtime-${input.deviceId}`,
			},
		},
		service: {
			connected: serviceConnected,
			executionCompatibility: null,
			matchingCurrentRuntime: serviceConnected,
			reasonCodes: serviceConnected ? [] : ["daemon.session.missing"],
			sessionDeviceId: serviceConnected ? input.deviceId : null,
			sessionLane: serviceConnected ? "dev-local" : null,
		},
		status: input.status ?? (primaryBlocker === "none" ? "ready" : "blocked"),
	} as unknown as CurrentLocalRuntimeReplyReadinessResponse;
}

function buildLocalComponents(
	input: {
		cliStatus?: CurrentLocalRuntimeReplyReadinessResponse["localComponents"]["cli"]["status"];
		serviceStatus?: CurrentLocalRuntimeReplyReadinessResponse["localComponents"]["service"]["status"];
		skillsStatus?: CurrentLocalRuntimeReplyReadinessResponse["localComponents"]["skills"]["status"];
	} = {}
): CurrentLocalRuntimeReplyReadinessResponse["localComponents"] {
	const cliStatus = input.cliStatus ?? "current";
	const serviceStatus = input.serviceStatus ?? "current";
	const skillsStatus = input.skillsStatus ?? "current";
	return {
		agentSetupCommand: "openmeld setup --view agent",
		cli: {
			commandContractVersion: null,
			installedPackageVersion: null,
			latestPackageVersion: null,
			reasonCodes: [],
			requiredCommandContractVersion: null,
			status: cliStatus,
			updatePolicy: resolveLocalComponentUpdatePolicy(cliStatus),
			wakeBlocked: false,
		},
		generatedAt: "2026-07-06T00:00:00.000Z",
		humanSetupCommand: "openmeld setup",
		schemaVersion: 1,
		service: {
			installedVersion: null,
			latestVersion: null,
			reasonCodes: [],
			requiredVersion: null,
			status: serviceStatus,
			updatePolicy: resolveLocalComponentUpdatePolicy(serviceStatus),
			wakeBlocked: false,
		},
		setupAction: "none",
		setupActionDescription:
			"OpenMeld local components are aligned for this computer.",
		setupActionLabel: "Everything is up to date",
		skills: {
			expectedBundleHash: null,
			expectedTargetCount: 0,
			installedBundleHash: null,
			reasonCodes: [],
			skillContractVersion: null,
			status: skillsStatus,
			targetCount: null,
			updatePolicy: resolveLocalComponentUpdatePolicy(skillsStatus),
			wakeBlocked: false,
		},
	};
}

function resolveLocalComponentUpdatePolicy(
	status:
		| CurrentLocalRuntimeReplyReadinessResponse["localComponents"]["cli"]["status"]
		| CurrentLocalRuntimeReplyReadinessResponse["localComponents"]["service"]["status"]
		| CurrentLocalRuntimeReplyReadinessResponse["localComponents"]["skills"]["status"]
): CurrentLocalRuntimeReplyReadinessResponse["localComponents"]["cli"]["updatePolicy"] {
	switch (status) {
		case "update_required":
			return "required";
		case "update_available":
			return "available";
		default:
			return "ok";
	}
}

const CURRENT_COMPUTER = buildComputer({
	deviceDisplayName: "This MacBook",
	deviceId: "device-current",
	isCurrent: true,
});
const OTHER_COMPUTER = buildComputer({
	deviceDisplayName: "Office Mac mini",
	deviceId: "device-office",
	isCurrent: false,
});
const STALE_COMPUTER = buildComputer({
	deviceDisplayName: "Old MacBook",
	deviceId: "device-stale",
	isCurrent: false,
	targetStatus: "stale",
});

function buildOrganizationDirectory(input: {
	includeOtherMemberComputers?: boolean;
}): OrganizationDirectoryResponse {
	return {
		organizationId: "org-acme",
		generatedAt: "2026-08-08T00:00:00.000Z",
		members: [
			{ userId: "user-felix", user: { name: "Felix" } },
			{ userId: "user-ashley", user: { name: "Ashley" } },
		],
		agentProfiles: input.includeOtherMemberComputers
			? [
					{
						managedRole: null,
						ownerUserId: "user-ashley",
						profileId: "agent-scout",
						profileName: "Scout",
						readiness: {
							routeDeviceId: "device-ashley",
							runtimeDeviceDisplayName: "Ashley's Mac Studio",
						},
						status: "active",
					},
					{
						managedRole: null,
						ownerUserId: "user-ashley",
						profileId: "agent-researcher",
						profileName: "Researcher",
						readiness: {
							routeDeviceId: "device-ashley",
							runtimeDeviceDisplayName: "Ashley's Mac Studio",
						},
						status: "active",
					},
				]
			: [],
	} as unknown as OrganizationDirectoryResponse;
}

function buildOrganizationComputers(input: {
	includeOtherMemberComputer?: boolean;
}): OrganizationComputersResponse {
	return {
		computers: input.includeOtherMemberComputer
			? [
					{
						computerId: "device-ashley",
						deviceDisplayName: "Ashley's Mac Studio",
						deviceType: "desktop",
						lastSeenAtMs: 1_775_952_000_000,
						localAgents: [
							{
								agentControllerRef: "builtin:claude-code",
								details: {
									capabilities: {
										approvals: true,
										cancel: false,
										interrupt: true,
										modelSelection: true,
										nativeEventStream: true,
										permissionModes: true,
										structuredUserInput: false,
									},
									checkedAt: "2026-08-18T05:00:00.000Z",
									launch: { installChoiceCount: 2, status: "ready" },
									models: [{ displayName: "Claude Sonnet" }],
									nativeInterface: "claude-cli",
									status: "ready",
									version: "2.1.234",
									versionAdvisory: {
										checkedAt: "2026-08-18T05:00:00.000Z",
										currentVersion: "2.1.234",
										latestVersion: "2.1.234",
										status: "current",
									},
								},
								enabled: true,
								status: "ready",
							},
							{
								agentControllerRef: "builtin:codex",
								enabled: true,
								status: "ready",
							},
						],
						osVersion: "25.5.0",
						openMeldTools: {
							cli: {
								installedPackageVersion: "0.3.66",
								latestPackageVersion: "0.3.66",
								reasonCodes: [],
								status: "current",
								updatePolicy: "ok",
								wakeBlocked: false,
							},
							service: {
								installedVersion: "0.3.65",
								latestVersion: "0.3.66",
								reasonCodes: ["service.update_available"],
								requiredVersion: "0.3.65",
								status: "update_available",
								updatePolicy: "available",
								wakeBlocked: false,
							},
							skills: {
								reasonCodes: [],
								status: "current",
								targetCount: 2,
								updatePolicy: "ok",
								wakeBlocked: false,
							},
						},
						ownerUserId: "user-ashley",
						platformFamily: "macOS",
						serviceState: "needs_attention",
					},
				]
			: [],
		generatedAt: "2026-08-18T00:00:00.000Z",
		organizationId: "org-acme",
	};
}

describe("ComputersPage", () => {
	beforeEach(() => {
		selectedComputerPanelPropsSpy.mockReset();
		useRefreshComputersAfterSetupCompleteMock
			.mockReset()
			.mockReturnValue("idle");
		useQueryClientMock.mockReset().mockReturnValue(queryClientStub);
		organizationDirectoryQueryData = buildOrganizationDirectory({});
		organizationComputersQueryData = buildOrganizationComputers({});
		useQueryMock.mockReset().mockImplementation((options) => ({
			data:
				options.queryKey.at(-1) === "computers"
					? organizationComputersQueryData
					: organizationDirectoryQueryData,
			error: null,
			isError: false,
			isPending: false,
		}));
		useLocalAgentRecoveryControllerMock.mockReset().mockReturnValue(
			buildRecoveryControllerStub({
				devices: [CURRENT_COMPUTER, OTHER_COMPUTER],
			})
		);
	});

	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it("keeps the visible Computer status reconciled with Core", () => {
		render(<TestComputersPage />);
		expect(useLocalAgentRecoveryControllerMock).toHaveBeenCalledWith({
			agentExecutionReadinessScope: "bound_runtime",
			currentLocalRuntimeReplyReadinessRefetchIntervalMs: 10_000,
			loadSetupState: false,
		});
	});

	it("renders the picker pre-state with one selectable card per computer", () => {
		render(<TestComputersPage />);

		expect(screen.getByRole("heading", { name: "Computers" })).toBeTruthy();
		const pickerList = screen.getByTestId("computers-picker-list");
		expect(pickerList).toBeTruthy();
		expect(pickerList.className).toContain("grid");
		expect(pickerList.className).toContain("lg:grid-cols-2");
		expect(within(pickerList).getAllByRole("listitem")).toHaveLength(3);
		const officeComputerLink = screen.getByRole("link", {
			name: "Open Office Mac mini details",
		});
		expect(officeComputerLink.className).toContain("h-full");
		expect(officeComputerLink.className).toContain("min-h-40");
		expect(officeComputerLink.className).toContain("flex-col");
		expect(officeComputerLink.getAttribute("href")).toBe(
			"/o/acme/computers/device-office"
		);
		expect(
			screen.getByTestId("computer-picker-card-device-current")
		).toBeTruthy();
		expect(
			screen.getByTestId("computer-picker-card-device-office")
		).toBeTruthy();
		expect(
			screen.getByRole("button", {
				name: "Computer options for This MacBook",
			})
		).toBeTruthy();
		expect(
			screen.getByRole("button", {
				name: "Computer options for Office Mac mini",
			})
		).toBeTruthy();
		const currentComputerCard = screen.getByTestId(
			"computer-picker-card-device-current"
		);
		expect(
			within(currentComputerCard).getByTestId("local-agent-logo-claude-code")
		).toBeTruthy();
		expect(
			within(currentComputerCard).getByTestId("local-agent-logo-codex")
		).toBeTruthy();
		expect(
			within(currentComputerCard).getByTestId("local-agent-logo-opencode")
		).toBeTruthy();
		expect(
			within(currentComputerCard).getByTestId("local-agent-logo-openclaw")
		).toBeTruthy();
		expect(
			screen.getByRole("heading", { level: 1, name: "Computers" })
		).toBeTruthy();
		expect(screen.getByText("Run agents locally")).toBeTruthy();
		expect(screen.queryByText("1 local agent")).toBeNull();
		expect(screen.getByTestId("add-computer-picker-card")).toBeTruthy();
		expect(
			screen.getByRole("link", { name: "Add a Computer" }).getAttribute("href")
		).toBe("/o/acme/connect?session=fresh");
		expect(
			screen.getByText("Set up OpenMeld Service and local agents.")
		).toBeTruthy();
		expect(screen.queryByText("Available for Wake")).toBeNull();
		expect(screen.queryByText("Organization Wake Access")).toBeNull();
		// The picker route stays on the picker; the detail route supplies deviceId.
		expect(screen.queryByTestId("selected-computer-panel")).toBeNull();
	});

	it("groups personal and organization-visible computers by owner", () => {
		organizationDirectoryQueryData = buildOrganizationDirectory({
			includeOtherMemberComputers: true,
		});
		organizationComputersQueryData = buildOrganizationComputers({
			includeOtherMemberComputer: true,
		});

		render(<TestComputersPage />);

		expect(
			screen.getByRole("heading", { level: 2, name: "Felix" })
		).toBeTruthy();
		expect(
			screen.getByRole("heading", { level: 2, name: "Ashley" })
		).toBeTruthy();
		expect(
			screen
				.getByRole("link", {
					name: "Open Ashley's Mac Studio details",
				})
				.getAttribute("href")
		).toBe("/o/acme/computers/computer%3Adevice-ashley");
		const ashleyComputer = screen.getByTestId(
			"organization-computer-card-computer:device-ashley"
		);
		expect(
			within(ashleyComputer).getByText(
				"Desktop · macOS 25.5.0 · Owned by Ashley"
			)
		).toBeTruthy();
		expect(within(ashleyComputer).queryByText("Claude Code, Codex")).toBeNull();
		expect(within(ashleyComputer).queryByText("2 Local agents")).toBeNull();
		expect(
			within(ashleyComputer).getByText("OpenMeld Tools need an update")
		).toBeTruthy();
		expect(
			within(ashleyComputer).getByTestId(
				"computer-status-dot-computer:device-ashley"
			).className
		).toContain("bg-amber");
		expect(
			within(ashleyComputer).getByTestId("local-agent-logo-claude-code")
		).toBeTruthy();
		expect(
			within(ashleyComputer).getByTestId("local-agent-logo-codex")
		).toBeTruthy();
		expect(
			within(ashleyComputer).queryByRole("button", {
				name: COMPUTER_OPTIONS_NAME_PATTERN,
			})
		).toBeNull();
	});

	it("shows a read-only detail for another member's computer", () => {
		organizationDirectoryQueryData = buildOrganizationDirectory({
			includeOtherMemberComputers: true,
		});
		organizationComputersQueryData = buildOrganizationComputers({
			includeOtherMemberComputer: true,
		});

		render(
			<TestComputersRouteStateProvider
				value={{ computersSelectedDeviceId: "computer:device-ashley" }}
			>
				<TestComputersPage />
			</TestComputersRouteStateProvider>
		);

		expect(screen.queryByTestId("selected-computer-panel")).toBeNull();
		expect(
			screen.getByRole("heading", { level: 1, name: "Ashley's Mac Studio" })
		).toBeTruthy();
		expect(
			screen.getByText("Desktop · macOS 25.5.0 · Owned by Ashley")
		).toBeTruthy();
		expect(screen.getAllByText("Ashley's Mac Studio")).toHaveLength(1);
		expect(screen.getByText("OpenMeld Tools")).toBeTruthy();
		expect(screen.getByText("OpenMeld Tools need an update")).toBeTruthy();
		expect(screen.getByText("Installed v0.3.65")).toBeTruthy();
		expect(screen.getByText("Installed v0.3.66")).toBeTruthy();
		expect(screen.getByText("Installed")).toBeTruthy();
		expect(screen.getByText("Local agents")).toBeTruthy();
		const claudeCodeSwitch = screen.getByRole("switch", {
			name: "Claude Code local agent",
		});
		const codexSwitch = screen.getByRole("switch", {
			name: "Codex local agent",
		});
		expect(claudeCodeSwitch.getAttribute("aria-checked")).toBe("true");
		expect(claudeCodeSwitch.hasAttribute("data-disabled")).toBe(true);
		expect(codexSwitch.getAttribute("aria-checked")).toBe("true");
		expect(codexSwitch.hasAttribute("data-disabled")).toBe(true);

		fireEvent.click(
			screen.getByRole("button", { name: "Claude Code details" })
		);
		expect(screen.getByText("Controller")).toBeTruthy();
		expect(screen.getByText("Enabled")).toBeTruthy();
		expect(screen.getByText("Native interface")).toBeTruthy();
		expect(screen.getByText("Claude CLI")).toBeTruthy();
		expect(screen.getByText("Version")).toBeTruthy();
		expect(screen.getAllByText("v2.1.234")).toHaveLength(2);
		expect(screen.getByText("Version status")).toBeTruthy();
		expect(screen.getByText("Up to date · v2.1.234")).toBeTruthy();
		expect(screen.getByText("Launch check")).toBeTruthy();
		expect(
			screen.getByText("Can launch · 2 local installs found")
		).toBeTruthy();
		expect(screen.getByText("Models")).toBeTruthy();
		expect(screen.getByText("Claude Sonnet")).toBeTruthy();
		expect(screen.getByText("Capabilities")).toBeTruthy();
		expect(
			screen.getByText(
				"Approvals, Interrupt, Model selection, Native event stream, Permission modes"
			)
		).toBeTruthy();
		expect(screen.getByText("Last checked")).toBeTruthy();
		expect(
			screen.getAllByText("Available on this computer").length
		).toBeGreaterThan(0);
		expect(screen.queryByText("Account")).toBeNull();
		expect(screen.queryByText("Installation")).toBeNull();
		expect(screen.queryByText("Agent Profiles")).toBeNull();
		expect(screen.queryByText("Researcher")).toBeNull();
		expect(screen.queryByText("Scout")).toBeNull();
		expect(
			screen.queryByText(
				"Ashley owns this computer. Ask them to update its connection or settings."
			)
		).toBeNull();
		expect(
			screen.queryByRole("button", { name: COMPUTER_OPTIONS_NAME_PATTERN })
		).toBeNull();
	});

	it("marks the current computer card when OpenMeld tools updates are available", () => {
		useLocalAgentRecoveryControllerMock.mockReturnValue(
			buildRecoveryControllerStub({
				currentReadiness: buildCurrentRuntimeReadiness({
					deviceId: "device-current",
					localComponents: buildLocalComponents({
						cliStatus: "update_available",
					}),
				}),
				devices: [CURRENT_COMPUTER, OTHER_COMPUTER],
			})
		);

		render(<TestComputersPage />);

		const currentComputerCard = screen.getByTestId(
			"computer-picker-card-device-current"
		);
		const updateLabel =
			within(currentComputerCard).getByText("Update available");
		expect(updateLabel.className).toContain("text-amber");
		expect(
			within(currentComputerCard).getByTestId(
				"computer-status-dot-device-current"
			).className
		).toContain("bg-amber");
		expect(
			within(
				screen.getByTestId("computer-picker-card-device-office")
			).queryByText("Update available")
		).toBeNull();
	});

	it("does not mark a cached tools update while current status is reconciling", () => {
		useLocalAgentRecoveryControllerMock.mockReturnValue(
			buildRecoveryControllerStub({
				currentReadiness: buildCurrentRuntimeReadiness({
					deviceId: "device-current",
					localComponents: buildLocalComponents({
						cliStatus: "update_available",
					}),
				}),
				devices: [CURRENT_COMPUTER, OTHER_COMPUTER],
				isCurrentReadinessFetchedAfterMount: false,
				isCurrentReadinessFetching: true,
			})
		);

		render(<TestComputersPage />);

		const currentComputerCard = screen.getByTestId(
			"computer-picker-card-device-current"
		);
		expect(
			within(currentComputerCard).queryByText("Update available")
		).toBeNull();
		expect(
			within(currentComputerCard).getByTestId(
				"computer-status-dot-device-current"
			).className
		).toContain("bg-sky");
	});

	it("marks the current computer card when OpenMeld Service is not connected", () => {
		useLocalAgentRecoveryControllerMock.mockReturnValue(
			buildRecoveryControllerStub({
				currentReadiness: buildCurrentRuntimeReadiness({
					deviceId: "device-current",
					localComponents: buildLocalComponents({
						cliStatus: "update_available",
					}),
					nextAction: "reconnect_service",
					primaryBlocker: "service_not_connected",
					serviceConnected: false,
				}),
				devices: [CURRENT_COMPUTER, OTHER_COMPUTER],
			})
		);

		render(<TestComputersPage />);

		const currentComputerCard = screen.getByTestId(
			"computer-picker-card-device-current"
		);
		expect(
			within(currentComputerCard).getAllByText(
				"OpenMeld Service is not connected"
			).length
		).toBeGreaterThan(0);
		expect(
			within(currentComputerCard).getByTestId(
				"computer-status-dot-device-current"
			).className
		).toContain("bg-destructive");
		expect(
			within(currentComputerCard).queryByText("Update available")
		).toBeNull();
		expect(
			within(
				screen.getByTestId("computer-picker-card-device-office")
			).queryByText("OpenMeld Service is not connected")
		).toBeNull();
	});

	it("marks the current computer card when an agent needs setup", () => {
		useLocalAgentRecoveryControllerMock.mockReturnValue(
			buildRecoveryControllerStub({
				currentReadiness: buildCurrentRuntimeReadiness({
					deviceId: "device-current",
					nextAction: "run_setup",
					primaryBlocker: "agent_controller_report_not_ready",
					status: "blocked",
				}),
				devices: [CURRENT_COMPUTER, OTHER_COMPUTER],
			})
		);

		render(<TestComputersPage />);

		const currentComputerCard = screen.getByTestId(
			"computer-picker-card-device-current"
		);
		const setupLabel = within(currentComputerCard).getByText(
			"Local agents need repair"
		);
		expect(setupLabel.className).toContain("text-destructive");
		expect(
			within(currentComputerCard).getByTestId(
				"computer-status-dot-device-current"
			).className
		).toContain("bg-destructive");
		expect(
			within(currentComputerCard).queryByText(
				"OpenMeld Service is not connected"
			)
		).toBeNull();
	});

	it("shows a warning while a connected computer retries a local agent check", () => {
		useLocalAgentRecoveryControllerMock.mockReturnValue(
			buildRecoveryControllerStub({
				currentReadiness: buildCurrentRuntimeReadiness({
					deviceId: "device-current",
					nextAction: "check_status",
					primaryBlocker: "agent_controller_report_not_ready",
					runtimeReasonCodes: ["controller.interface.check_failed"],
					status: "blocked",
				}),
				devices: [CURRENT_COMPUTER, OTHER_COMPUTER],
			})
		);

		render(<TestComputersPage />);

		const currentComputerCard = screen.getByTestId(
			"computer-picker-card-device-current"
		);
		expect(
			within(currentComputerCard).queryByText("Checking local agents")
		).toBeNull();
		expect(
			within(currentComputerCard).queryByText("Local agents need repair")
		).toBeNull();
		expect(
			within(currentComputerCard).getByText("Couldn't check").className
		).toContain("text-amber");
		expect(
			within(currentComputerCard).getByTestId(
				"computer-status-dot-device-current"
			).className
		).toContain("bg-amber");
	});

	it("opens the reused computer actions dialog from the picker card", () => {
		render(<TestComputersPage />);

		fireEvent.click(
			screen.getByRole("button", {
				name: "Computer options for Office Mac mini",
			})
		);

		expect(
			screen.getByRole("heading", { name: "Computer details" })
		).toBeTruthy();
		expect(
			screen.getByText(
				"Review this computer, rename it, or remove it from this OpenMeld account."
			)
		).toBeTruthy();
	});

	it("renders a loading state while the device list is pending", () => {
		useLocalAgentRecoveryControllerMock.mockReturnValue(
			buildRecoveryControllerStub({ devices: [], isPending: true })
		);

		render(<TestComputersPage />);

		expect(screen.getByTestId("computers-picker-loading")).toBeTruthy();
		expect(screen.queryByTestId("computers-picker-list")).toBeNull();
	});

	it("renders the add-computer card when there are no computers", () => {
		useLocalAgentRecoveryControllerMock.mockReturnValue(
			buildRecoveryControllerStub({ devices: [], connectedDeviceId: null })
		);

		render(<TestComputersPage />);

		const pickerList = screen.getByTestId("computers-picker-list");
		expect(within(pickerList).getAllByRole("listitem")).toHaveLength(1);
		expect(screen.getByTestId("add-computer-picker-card")).toBeTruthy();
		expect(
			screen.getByRole("link", { name: "Add a Computer" }).getAttribute("href")
		).toBe("/o/acme/connect?session=fresh");
		expect(
			screen.queryByTestId("computer-picker-card-device-current")
		).toBeNull();
	});

	it("renders a computer detail from the selected device route state", () => {
		render(
			<TestComputersRouteStateProvider
				value={{ computersSelectedDeviceId: "device-office" }}
			>
				<TestComputersPage />
			</TestComputersRouteStateProvider>
		);

		const panel = screen.getByTestId("selected-computer-panel");
		expect(panel.getAttribute("data-device-id")).toBe("device-office");
		expect(selectedComputerPanelPropsSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				computer: expect.objectContaining({ deviceId: "device-office" }),
			})
		);
		expect(screen.queryByTestId("computers-picker-list")).toBeNull();
		expect(
			screen.getByRole("heading", { name: "Office Mac mini" })
		).toBeTruthy();
		expect(screen.getByText("Laptop · macOS 15.4 · Dev")).toBeTruthy();
		expect(
			screen.queryByRole("button", { name: "Use this computer" })
		).toBeNull();
		expect(screen.getByTestId("all-computers-link").getAttribute("href")).toBe(
			"/o/acme/computers"
		);
		const backLink = screen.getByTestId("all-computers-link");
		expect(backLink.className).toContain("touch-manipulation");
		expect(backLink.className).toContain("max-lg:min-h-11");
		expect(backLink.className).not.toContain("px-");
		expect(backLink.className).not.toContain("bg-");
		expect(backLink.querySelector("svg")?.className.baseVal).toContain(
			"size-4"
		);
		expect(
			screen.getByRole("heading", { level: 1, name: "Office Mac mini" })
		).toBeTruthy();
	});

	it("drives the detail panel with the connected computer as the current one", () => {
		render(
			<TestComputersRouteStateProvider
				value={{ computersSelectedDeviceId: "device-current" }}
			>
				<TestComputersPage />
			</TestComputersRouteStateProvider>
		);

		expect(selectedComputerPanelPropsSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				computer: expect.objectContaining({ deviceId: "device-current" }),
				focusService: false,
				queryClient: queryClientStub,
			})
		);
		expect(
			screen.queryByRole("button", { name: "Use this computer" })
		).toBeNull();
	});

	it("does not show a use-this-computer action for stale computer records", () => {
		useLocalAgentRecoveryControllerMock.mockReturnValue(
			buildRecoveryControllerStub({
				devices: [CURRENT_COMPUTER, STALE_COMPUTER],
			})
		);

		render(
			<TestComputersRouteStateProvider
				value={{ computersSelectedDeviceId: "device-stale" }}
			>
				<TestComputersPage />
			</TestComputersRouteStateProvider>
		);

		expect(screen.getByTestId("selected-computer-panel")).toBeTruthy();
		expect(screen.getByRole("heading", { name: "Old MacBook" })).toBeTruthy();
		expect(
			screen.queryByRole("button", { name: "Use this computer" })
		).toBeNull();
	});

	it("resolves the connected computer detail route for OpenMeld Service focus", () => {
		const onComputerRouteResolved = vi.fn();

		render(
			<TestComputersRouteStateProvider
				value={{
					computersFocusService: true,
					onComputerRouteResolved,
				}}
			>
				<TestComputersPage />
			</TestComputersRouteStateProvider>
		);

		expect(onComputerRouteResolved).toHaveBeenCalledWith("device-current");
		expect(screen.queryByTestId("selected-computer-panel")).toBeNull();
	});

	it("resolves the connected computer detail route for file access focus", () => {
		const onComputerRouteResolved = vi.fn();

		render(
			<TestComputersRouteStateProvider
				value={{
					computersFocusFileAccess: true,
					onComputerRouteResolved,
				}}
			>
				<TestComputersPage />
			</TestComputersRouteStateProvider>
		);

		expect(onComputerRouteResolved).toHaveBeenCalledWith("device-current");
		expect(screen.queryByTestId("selected-computer-panel")).toBeNull();
	});

	it("focuses the OpenMeld Service card on the selected computer detail route", () => {
		const onFocusConsumed = vi.fn();
		useRefreshComputersAfterSetupCompleteMock.mockReturnValue("pending");

		render(
			<TestComputersRouteStateProvider
				value={{
					computersFocusService: true,
					computersSelectedDeviceId: "device-current",
					computersSetupCompleteRefresh: true,
					onFocusConsumed,
				}}
			>
				<TestComputersPage />
			</TestComputersRouteStateProvider>
		);

		expect(screen.getByTestId("selected-computer-panel")).toBeTruthy();
		expect(selectedComputerPanelPropsSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				computer: expect.objectContaining({ deviceId: "device-current" }),
				focusService: true,
				onFocusConsumed,
				setupCompleteRefreshPending: true,
			})
		);
		expect(useRefreshComputersAfterSetupCompleteMock).toHaveBeenCalledWith({
			enabled: true,
			queryClient: queryClientStub,
			recovery: expect.any(Object),
		});
	});

	it("focuses file access on the selected computer detail route", () => {
		const onFocusConsumed = vi.fn();

		render(
			<TestComputersRouteStateProvider
				value={{
					computersFocusFileAccess: true,
					computersSelectedDeviceId: "device-current",
					onFocusConsumed,
				}}
			>
				<TestComputersPage />
			</TestComputersRouteStateProvider>
		);

		expect(selectedComputerPanelPropsSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				computer: expect.objectContaining({ deviceId: "device-current" }),
				focusFileAccess: true,
				onFocusConsumed,
			})
		);
	});

	it("scopes the detail to Service + local agents without profile-list state", () => {
		render(
			<TestComputersRouteStateProvider
				value={{ computersSelectedDeviceId: "device-office" }}
			>
				<TestComputersPage />
			</TestComputersRouteStateProvider>
		);

		expect(selectedComputerPanelPropsSpy).toHaveBeenCalledWith(
			expect.not.objectContaining({
				focusProfileId: expect.anything(),
				includeAgentProfiles: expect.anything(),
			})
		);
	});

	it("shows a not-found state when the selected route device vanishes", () => {
		const { rerender } = render(<TestComputersPage />);

		rerender(
			<TestComputersRouteStateProvider
				value={{ computersSelectedDeviceId: "device-office" }}
			>
				<TestComputersPage />
			</TestComputersRouteStateProvider>
		);
		expect(screen.getByTestId("selected-computer-panel")).toBeTruthy();

		// The office computer drops out of the refetched list → the URL remains the
		// source of truth, so show an explicit not-found state instead of silently
		// falling back to another computer or the picker.
		useLocalAgentRecoveryControllerMock.mockReturnValue(
			buildRecoveryControllerStub({ devices: [CURRENT_COMPUTER] })
		);
		rerender(
			<TestComputersRouteStateProvider
				value={{ computersSelectedDeviceId: "device-office" }}
			>
				<TestComputersPage />
			</TestComputersRouteStateProvider>
		);

		expect(screen.queryByTestId("selected-computer-panel")).toBeNull();
		expect(screen.queryByTestId("computers-picker-list")).toBeNull();
		expect(
			screen.getByRole("heading", { name: "Computer not found" })
		).toBeTruthy();
		expect(
			within(screen.getByTestId("computer-not-found-state")).getByText(
				"This computer is no longer available. Return to all computers to choose another machine."
			)
		).toBeTruthy();

		// If that same URL becomes valid again later, the detail renders again.
		useLocalAgentRecoveryControllerMock.mockReturnValue(
			buildRecoveryControllerStub({
				devices: [CURRENT_COMPUTER, OTHER_COMPUTER],
			})
		);
		rerender(
			<TestComputersRouteStateProvider
				value={{ computersSelectedDeviceId: "device-office" }}
			>
				<TestComputersPage />
			</TestComputersRouteStateProvider>
		);

		expect(screen.getByTestId("selected-computer-panel")).toBeTruthy();
	});
});
