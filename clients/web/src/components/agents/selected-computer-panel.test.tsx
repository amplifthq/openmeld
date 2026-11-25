import type {
	CurrentLocalRuntimeReplyReadinessResponse,
	LocalRuntimeComputer,
	LocalRuntimeExecutionTarget,
} from "@openmeld/schemas/types";
import { QueryClient } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SelectedComputerPanel } from "./selected-computer-panel";

const readPeopleComputerReadinessSpy = vi.hoisted(() => vi.fn());
vi.mock("#/lib/connect/local-runtimes", async (importOriginal) => ({
	...(await importOriginal<typeof import("#/lib/connect/local-runtimes")>()),
	readPeopleComputerReplyReadiness: readPeopleComputerReadinessSpy,
}));

// Renders the REAL `SelectedComputerPanel` (NOT the recorder stub that
// `computers-section.test.tsx` uses) to genuinely verify the detail
// composition. The child cards are stubbed so we can assert that a Computer's
// detail remains the OpenMeld Service card + local agents card, with the
// device-local file-access control available only for the current Computer.
// Account-level Agent Profiles live under Profiles, not in Computer details.
const openMeldServiceCardSpy = vi.hoisted(() => vi.fn());
const localAgentsCardSpy = vi.hoisted(() => vi.fn());
const computerFileAccessCardSpy = vi.hoisted(() => vi.fn());

vi.mock("./agents-page-openmeld-service", () => ({
	OpenMeldServiceCard: (input: unknown) => {
		openMeldServiceCardSpy(input);
		return <div data-testid="openmeld-service-card" />;
	},
	ComputersLoadingCard: () => <div data-testid="computers-loading-card" />,
	NoComputersCard: () => <div data-testid="no-computers-card" />,
}));

vi.mock("./agents-page-local-agents", () => ({
	LocalAgentsCard: (input: unknown) => {
		localAgentsCardSpy(input);
		return <div data-testid="local-agents-card" />;
	},
}));

vi.mock("./computer-file-access-card", () => ({
	ComputerFileAccessCard: (input: unknown) => {
		computerFileAccessCardSpy(input);
		return <div data-testid="computer-file-access-card" />;
	},
}));

vi.mock("#/components/computers/computer-power-settings", () => ({
	ComputerPowerSettings: () => <div data-testid="computer-power-settings" />,
}));

vi.mock("#/components/computers/computer-token-usage", () => ({
	ComputerTokenUsage: () => <div data-testid="computer-token-usage" />,
}));

function buildComputer(
	executionTargets: LocalRuntimeExecutionTarget[] = [
		buildExecutionTarget("ready"),
	]
): LocalRuntimeComputer {
	return {
		computerFileAccess: { readPolicy: true, updatePolicy: true },
		deviceDisplayName: "Office Mac mini",
		deviceDisplayNameSource: "observed",
		deviceId: "device-office",
		deviceType: "desktop",
		executionTargets,
		firstSeenAtMs: 1_700_000_000_000,
		isCurrent: true,
		lastObservedAtMs: 1_700_000_020_000,
		localFolderPicker: { selectFolders: true },
		osVersion: "15.4",
		platformFamily: "macOS",
	} as unknown as LocalRuntimeComputer;
}

// Minimal recovery slice the panel's own helpers read (all defensive: they
// return null/false when the data is absent). The cards are stubbed, so their
// own controller reads never run.
function buildRecoveryStub(
	input: {
		computer?: LocalRuntimeComputer;
		readiness?: CurrentLocalRuntimeReplyReadinessResponse;
	} = {}
) {
	const computer = input.computer ?? buildComputer();
	return {
		agentExecutionReadinessByProfileId: new Map(),
		agentExecutionReadinessPendingProfileIds: new Set<string>(),
		agentProfiles: [],
		agentProfilesQuery: { isPending: false },
		currentDeviceTargetQuery: {
			data: {
				availability: "resolved",
				deviceId: computer.deviceId,
				runtimeLane: "dev-local",
			},
		},
		currentLocalRuntimeReplyReadinessQuery: {
			data: input.readiness,
			isFetching: false,
			isPending: false,
		},
		expectedServiceVersion: null,
		localRuntimesQuery: {
			data: {
				peopleComputers: {
					generatedAt: "2026-09-07T00:00:00.000Z",
					computers: [
						{
							...computer,
							identityStatus: "unconfirmed",
							connection: {
								status: "connected",
								reasonCodes: [],
								sessions: computer.executionTargets.map((target) => ({
									deviceId: target.deviceId,
									runtimeLane: target.runtimeLane,
									controls: {
										computerFileAccess: computer.computerFileAccess,
										localFolderPicker: computer.localFolderPicker,
										localProjectControl: { discoverProjects: true },
									},
								})),
							},
						},
					],
				},
				currentDeviceId: computer.deviceId,
				currentRuntimeLane: "dev-local",
				localRuntimes: [computer],
			},
		},
		selectedExecutionTarget: computer.executionTargets[0] ?? null,
		storageScope: "owner-user-1",
	} as unknown as Parameters<typeof SelectedComputerPanel>[0]["recovery"];
}

const queryClientStub = new QueryClient({
	defaultOptions: { queries: { retry: false } },
});

function renderPanel(
	input: {
		computer?: LocalRuntimeComputer;
		focusFileAccess?: boolean;
		isReconcilingStatus?: boolean;
		recovery?: ReturnType<typeof buildRecoveryStub>;
	} = {}
) {
	const computer = input.computer ?? buildComputer();
	return render(
		<SelectedComputerPanel
			computer={computer}
			focusFileAccess={input.focusFileAccess ?? false}
			focusService={false}
			isReconcilingStatus={input.isReconcilingStatus ?? false}
			organizationId="org-acme"
			queryClient={queryClientStub}
			recovery={input.recovery ?? buildRecoveryStub({ computer })}
			setupCompleteRefreshPending={false}
		/>
	);
}

describe("SelectedComputerPanel detail composition", () => {
	beforeEach(() => {
		queryClientStub.clear();
		readPeopleComputerReadinessSpy.mockReset();
		readPeopleComputerReadinessSpy.mockImplementation(
			(target: { deviceId: string; runtimeLane: string }) =>
				Promise.resolve({
					...buildConnectedReadiness(target.deviceId),
					currentTarget: { availability: "resolved", ...target },
				})
		);
		openMeldServiceCardSpy.mockReset();
		localAgentsCardSpy.mockReset();
		computerFileAccessCardSpy.mockReset();
	});

	afterEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it("prioritizes local agents before token usage and file access for the current Computer", () => {
		renderPanel();

		expect(openMeldServiceCardSpy).toHaveBeenCalled();
		expect(localAgentsCardSpy).toHaveBeenCalled();
		expect(computerFileAccessCardSpy).toHaveBeenCalledWith({
			canChooseFolders: true,
			canChooseProjects: true,
			deviceId: "device-office",
			runtimeLane: "dev-local",
			focusFileAccess: false,
			onFocusConsumed: undefined,
			storageScope: expect.any(String),
		});
		expect(screen.getByTestId("local-agents-card").nextElementSibling).toBe(
			screen.getByTestId("computer-token-usage")
		);
		expect(screen.getByTestId("computer-token-usage").nextElementSibling).toBe(
			screen.getByTestId("computer-file-access-card")
		);
		expect(screen.queryByText("Available for Wake")).toBeNull();
	});

	it("reconciles the viewed Computer independently of a slow account routing target", async () => {
		const recovery = buildRecoveryStub({
			readiness: buildConnectedReadiness("other-device"),
		});
		recovery.currentLocalRuntimeReplyReadinessQuery.isFetching = true;
		recovery.currentLocalRuntimeReplyReadinessQuery.isFetchedAfterMount = false;
		renderPanel({ recovery });
		await waitFor(() =>
			expect(openMeldServiceCardSpy).toHaveBeenLastCalledWith(
				expect.objectContaining({
					isReconcilingStatus: false,
					currentLocalRuntimeReplyReadiness: expect.objectContaining({
						currentTarget: expect.objectContaining({
							deviceId: "device-office",
							runtimeLane: "dev-local",
						}),
					}),
				})
			)
		);
		expect(localAgentsCardSpy).toHaveBeenLastCalledWith(
			expect.objectContaining({ isReconcilingStatus: false })
		);
	});

	it("requires an environment choice instead of using the default Binding when two environments exist", async () => {
		const development = buildExecutionTarget("ready");
		const production = {
			...development,
			runtimeLane: "prod" as const,
			isCurrent: true,
		};
		renderPanel({ computer: buildComputer([development, production]) });
		expect(screen.queryByTestId("computer-file-access-card")).toBeNull();
		expect(readPeopleComputerReadinessSpy).not.toHaveBeenCalled();
		expect(localAgentsCardSpy).toHaveBeenLastCalledWith(
			expect.objectContaining({
				hasSelectedEnvironment: false,
				controlTarget: null,
			})
		);
		fireEvent.click(
			screen.getByRole("combobox", { name: "Service connection" })
		);
		fireEvent.click(await screen.findByRole("option", { name: "Production" }));
		await waitFor(() =>
			expect(readPeopleComputerReadinessSpy).toHaveBeenCalledWith({
				deviceId: "device-office",
				runtimeLane: "prod",
			})
		);
		expect(localAgentsCardSpy).toHaveBeenLastCalledWith(
			expect.objectContaining({
				hasSelectedEnvironment: true,
				controlTarget: { deviceId: "device-office", runtimeLane: "prod" },
			})
		);
		expect(computerFileAccessCardSpy).toHaveBeenLastCalledWith(
			expect.objectContaining({
				deviceId: "device-office",
				runtimeLane: "prod",
				canChooseFolders: true,
				canChooseProjects: true,
			})
		);
	});

	it("automatically selects the only live connection instead of making old reports compete with it", async () => {
		const live = buildExecutionTarget("ready");
		const historical = {
			...live,
			deviceId: "old-device",
			isCurrent: false,
			status: "stale" as const,
		};
		renderPanel({
			computer: buildComputer([historical, live]),
			recovery: buildRecoveryStub({ computer: buildComputer([live]) }),
		});
		await waitFor(() =>
			expect(readPeopleComputerReadinessSpy).toHaveBeenCalledWith({
				deviceId: "device-office",
				runtimeLane: "dev-local",
			})
		);
		expect(localAgentsCardSpy).toHaveBeenLastCalledWith(
			expect.objectContaining({
				hasSelectedEnvironment: true,
				controlTarget: { deviceId: "device-office", runtimeLane: "dev-local" },
			})
		);
	});

	it("forwards a Settings deep-link focus to file access", () => {
		const onFocusConsumed = vi.fn();
		const computer = buildComputer();
		render(
			<SelectedComputerPanel
				computer={computer}
				focusFileAccess={true}
				focusService={false}
				isReconcilingStatus={false}
				onFocusConsumed={onFocusConsumed}
				organizationId="org-acme"
				queryClient={queryClientStub}
				recovery={buildRecoveryStub({ computer })}
				setupCompleteRefreshPending={false}
			/>
		);

		expect(computerFileAccessCardSpy).toHaveBeenCalledWith({
			canChooseFolders: true,
			canChooseProjects: true,
			deviceId: "device-office",
			runtimeLane: "dev-local",
			focusFileAccess: true,
			onFocusConsumed,
			storageScope: "owner-user-1",
		});
	});

	it("keeps manual file access controls when this Service cannot open a picker", () => {
		const currentComputer = {
			...buildComputer(),
			localFolderPicker: undefined,
		};
		renderPanel({
			computer: currentComputer,
			recovery: buildRecoveryStub({ computer: currentComputer }),
		});

		expect(computerFileAccessCardSpy).toHaveBeenCalledWith(
			expect.objectContaining({ canChooseFolders: false })
		);
	});

	it("does not expose current-device file access controls on another Computer", () => {
		const otherComputer = {
			...buildComputer(),
			deviceId: "device-away",
			isCurrent: false,
		};
		renderPanel({
			computer: otherComputer,
			recovery: buildRecoveryStub(),
		});

		expect(computerFileAccessCardSpy).not.toHaveBeenCalled();
		expect(screen.queryByTestId("computer-file-access-card")).toBeNull();
	});

	it("keeps the optional control hidden until the current Service advertises it", () => {
		const currentComputer = {
			...buildComputer(),
			computerFileAccess: undefined,
		};
		renderPanel({
			computer: currentComputer,
			recovery: buildRecoveryStub({ computer: currentComputer }),
		});

		expect(computerFileAccessCardSpy).not.toHaveBeenCalled();
		expect(screen.queryByTestId("computer-file-access-card")).toBeNull();
	});

	it("does not mask a historical local-agent issue during an unrelated readiness refresh", () => {
		const brokenTarget = buildExecutionTarget("needs_repair");
		const brokenComputer = buildComputer([brokenTarget]);
		const readiness = buildConnectedReadiness(brokenComputer.deviceId);
		renderPanel({
			computer: brokenComputer,
			isReconcilingStatus: true,
			recovery: buildRecoveryStub({
				computer: brokenComputer,
				readiness,
			}),
		});

		expect(lastLocalAgentsCardProps()).not.toHaveProperty(
			"isReconcilingCatalog"
		);
	});
});

function lastLocalAgentsCardProps(): object {
	const call = localAgentsCardSpy.mock.calls.at(-1)?.[0];
	if (!call || typeof call !== "object") {
		throw new Error("LocalAgentsCard was not rendered.");
	}
	return call;
}

function buildExecutionTarget(
	launchStatus: "needs_repair" | "ready"
): LocalRuntimeExecutionTarget {
	return {
		capabilities: [],
		deviceId: "device-office",
		isCurrent: true,
		lastObservedAtMs: 1_700_000_020_000,
		localAgentCatalog: {
			detectedNotSupportedYet: 0,
			detectedSupported: 1,
			entries: [
				{
					agentId: "cursor",
					detected: true,
					displayName: "Cursor",
					enabled: true,
					launchStatus,
					lifecycleStatus: "active",
					selectable: true,
					selectableReason: launchStatus === "ready" ? null : "needs_repair",
					targetKind: "builtin",
				},
			],
			needsChoice: 0,
			needsRepair: launchStatus === "needs_repair" ? 1 : 0,
			notDetected: 0,
			totalBuiltins: 1,
		},
		localAgentControl: { refreshCatalog: true, setEnabled: true },
		reasonCodes: [],
		runtimeLane: "dev-local",
		status: launchStatus === "ready" ? "ready" : "partial",
		userFacingCommand: "openmeld-dev",
		openMeldServiceRuntimeId: null,
	};
}

function buildConnectedReadiness(
	deviceId: string
): CurrentLocalRuntimeReplyReadinessResponse {
	return {
		canReplyFromThisComputer: true,
		currentTarget: {
			availability: "resolved",
			deviceId,
			runtimeLane: "dev-local",
		},
		generatedAt: "2026-08-07T16:00:00.000Z",
		localComponents: {
			agentSetupCommand: "openmeld-dev setup --view agent",
			cli: {
				commandContractVersion: null,
				installedPackageVersion: "0.3.24",
				latestPackageVersion: "0.3.24",
				reasonCodes: [],
				requiredCommandContractVersion: null,
				status: "current",
				updatePolicy: "ok",
				wakeBlocked: false,
			},
			generatedAt: "2026-08-07T16:00:00.000Z",
			humanSetupCommand: "openmeld-dev setup",
			schemaVersion: 1,
			service: {
				installedVersion: "0.3.24",
				latestVersion: "0.3.24",
				reasonCodes: [],
				requiredVersion: "0.3.24",
				status: "current",
				updatePolicy: "ok",
				wakeBlocked: false,
			},
			setupAction: "none",
			setupActionDescription: "OpenMeld local components are aligned.",
			setupActionLabel: "Everything is up to date",
			skills: {
				expectedBundleHash: null,
				expectedTargetCount: 1,
				installedBundleHash: null,
				reasonCodes: [],
				skillContractVersion: null,
				status: "current",
				targetCount: 1,
				updatePolicy: "ok",
				wakeBlocked: false,
			},
		},
		message: "OpenMeld Service is connected.",
		nextAction: "none",
		primaryBlocker: "none",
		runtime: {
			deviceDisplayName: "Office Mac mini",
			deviceId,
			executionTargetStatus: "ready",
			lastObservedAtMs: 1_700_000_020_000,
			reasonCodes: [],
			runtimeLane: "dev-local",
			signInOnlyBlockers: false,
			openMeldServiceRuntimeId: null,
		},
		service: {
			connected: true,
			executionCompatibility: null,
			matchingCurrentRuntime: true,
			reasonCodes: [],
			sessionDeviceId: deviceId,
			sessionLane: "dev-local",
		},
		status: "ready",
	};
}
