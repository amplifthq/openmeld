import {
	currentLocalRuntimeReplyReadinessResponseSchema,
	peopleComputersResponseSchema,
} from "@openmeld/schemas";
import type {
	CurrentLocalRuntimeReplyReadinessResponse,
	LocalRuntimeExecutionTarget,
	OrganizationComputersResponse,
	PeopleComputersResponse,
} from "@openmeld/schemas/types";
import { isLocalFixtureHost } from "./fixture-manifest";

type Configuration = {
	organizationSlug: string;
	anchorDeviceId: string;
	anchorComputerId: string;
};
const configurations = import.meta.env.DEV
	? import.meta.glob<Configuration>(
			"../../../scripts/sidebar-preview/computer-preview.generated.json",
			{ eager: true, import: "default" }
		)
	: {};
const PREFIX = "local-computer-preview-";
const scenarios = [
	["current", "MacBook Air"],
	["disconnected", "Home iMac"],
	["available", "Office Mac"],
	["reconnect", "Travel Mac"],
	["required", "Mac mini"],
	["unknown", "Studio Mac"],
	["empty", "New MacBook"],
] as const;
type Scenario = (typeof scenarios)[number][0];
const serviceStates = {
	current: "connected",
	disconnected: "not_connected",
	available: "connected",
	reconnect: "not_connected",
	required: "needs_attention",
	unknown: "unknown",
	empty: "connected",
} as const;
const automaticUpdates = new Map<string, boolean>();

function connectionStatus(scenario: Scenario) {
	if (scenario === "unknown") {
		return "unknown" as const;
	}
	return serviceStates[scenario] === "not_connected"
		? ("disconnected" as const)
		: ("connected" as const);
}

function previewCatalog(
	catalog: LocalRuntimeExecutionTarget["localAgentCatalog"],
	empty: boolean
) {
	const entries = catalog.entries
		.filter((entry) => entry.targetKind === "builtin")
		.map((entry) => {
			const detected = !empty && entry.detected;
			return {
				...entry,
				detected,
				enabled: detected,
				selectable: detected,
				selectableReason: detected ? null : ("not_detected" as const),
				launchStatus: detected
					? ("ready" as const)
					: ("not_available" as const),
			};
		});
	const detectedSupported = entries.filter((entry) => entry.detected).length;
	return {
		totalBuiltins: entries.length,
		detectedSupported,
		needsChoice: 0,
		needsRepair: 0,
		detectedNotSupportedYet: 0,
		notDetected: entries.length - detectedSupported,
		entries,
	};
}

function previewCapabilities(
	capabilities: LocalRuntimeExecutionTarget["capabilities"],
	observedAt: number
): LocalRuntimeExecutionTarget["capabilities"] {
	return capabilities.map((capability) => {
		const snapshot = capability.agentControllerInterface;
		return {
			...capability,
			enabled: true,
			status: "ready",
			reasonCodes: [],
			agentControllerInterface: snapshot
				? {
						...snapshot,
						checkedAt: new Date(observedAt).toISOString(),
						check: {
							status: "succeeded",
							lastSucceededAt: new Date(observedAt).toISOString(),
						},
						auth: { status: "authenticated", label: "Preview account" },
						launch: {
							...snapshot.launch,
							status: "ready",
							commandPath: `/usr/local/bin/${snapshot.controllerId}`,
							argsPrefix: [],
						},
						status: "ready",
						message: null,
						skills: [],
						usageLimits: undefined,
						usageLimitsSupportMatrixVersion: undefined,
						versionAdvisory: undefined,
					}
				: null,
		};
	});
}

function configuration() {
	if (!(import.meta.env.DEV && isLocalFixtureHost())) {
		return null;
	}
	const config = Object.values(configurations)[0];
	return config &&
		window.location.pathname.startsWith(`/o/${config.organizationSlug}/`)
		? config
		: null;
}

export function isComputerStateFixture(deviceId: string) {
	return (
		configuration() !== null &&
		scenarios.some(([id]) => deviceId === `${PREFIX}${id}`)
	);
}

/** A view-only protocol simulation. Never enrolls a device or writes Service truth. */
export function withComputerStateFixtures(
	response: PeopleComputersResponse
): PeopleComputersResponse {
	const config = configuration();
	const anchor =
		config &&
		response.computers.find(
			(computer) => computer.deviceId === config.anchorDeviceId
		);
	if (!anchor) {
		return response;
	}
	return peopleComputersResponseSchema.parse({
		...response,
		computers: [...response.computers, ...buildComputerStateFixtures(anchor)],
	});
}

export function buildComputerStateFixtures(
	anchor: PeopleComputersResponse["computers"][number]
) {
	const now = Date.now();
	const computers = scenarios.map(([scenario, name]) => {
		const deviceId = `${PREFIX}${scenario}`;
		const connected = !["disconnected", "reconnect", "unknown"].includes(
			scenario
		);
		const observedAt = connected ? now : now - 86_400_000;
		// Use the authenticated inventory's real report shape; strip machine-specific
		// controls and identities. These reports remain supporting catalog evidence.
		const executionTargets = anchor.executionTargets
			.slice(0, 1)
			.map((target) => ({
				...target,
				deviceId,
				runtimeLane: "dev-local" as const,
				openMeldServiceRuntimeId: {
					source: "runtime_registry_authority" as const,
					value: `${PREFIX}runtime-${scenario}`,
				},
				lastObservedAtMs: observedAt,
				localAgentControl: {
					refreshCatalog: false,
					setEnabled: false,
					setProfileWorkspace: false,
				},
				localProjectControl: undefined,
				status:
					scenario === "empty" ? ("not_ready" as const) : ("ready" as const),
				capabilities:
					scenario === "empty"
						? []
						: previewCapabilities(target.capabilities, observedAt),
				localAgentCatalog: previewCatalog(
					target.localAgentCatalog,
					scenario === "empty"
				),
			}));
		return {
			...anchor,
			deviceId,
			connectedComputerId: `${PREFIX}identity-${scenario}`,
			deviceDisplayName: `Preview · ${name}`,
			legacyDeviceIds: [],
			computerFileAccess: undefined,
			localFolderPicker: undefined,
			lastObservedAtMs: observedAt,
			connection: {
				status: connectionStatus(scenario),
				reasonCodes:
					scenario === "unknown" ? ["daemon.status.unavailable"] : [],
				sessions: connected
					? [
							{
								deviceId,
								runtimeLane: "dev-local",
								lastHeartbeatMs: now,
								serviceVersion:
									scenario === "required" || scenario === "available"
										? "0.3.164"
										: "0.3.165",
								executionCompatibility: {
									status: "compatible",
									expectedEpoch:
										"runtime-transport-epoch-2026-07-default-project",
									observedEpoch:
										"runtime-transport-epoch-2026-07-default-project",
									reasonCode: "daemon.runtime_contract.compatible",
								},
								serviceUpdate: {
									wakeBlocked: scenario === "required",
									reasonCodes:
										scenario === "required" ? ["service.update_required"] : [],
								},
							},
						]
					: [],
			},
			executionTargets,
		};
	});
	return peopleComputersResponseSchema.parse({
		generatedAt: new Date(now).toISOString(),
		computers,
	}).computers;
}

export function withOrganizationComputerStateFixtures(
	response: OrganizationComputersResponse
): OrganizationComputersResponse {
	const config = configuration();
	const anchor =
		config &&
		response.computers.find(
			(computer) =>
				computer.computerId === config.anchorDeviceId ||
				computer.computerId === config.anchorComputerId
		);
	if (!anchor) {
		return response;
	}
	return {
		...response,
		computers: [
			...response.computers,
			...scenarios.map(([id, name]) => ({
				...anchor,
				computerId: `${PREFIX}${id}`,
				deviceDisplayName: `Preview · ${name}`,
				serviceState: serviceStates[id],
				lastSeenAtMs:
					Date.now() -
					(id === "disconnected" || id === "reconnect" ? 86_400_000 : 0),
				localAgents: [],
				openMeldTools: null,
			})),
		],
	};
}

export function computerStateFixtureReadiness(
	deviceId: string
): CurrentLocalRuntimeReplyReadinessResponse {
	const scenario = scenarios.find(([id]) => deviceId === `${PREFIX}${id}`)?.[0];
	if (!scenario) {
		throw new Error("Unknown computer preview.");
	}
	if (scenario === "unknown") {
		throw new Error(
			"Simulated connection check failed. No real computer was contacted."
		);
	}
	const connected = scenario !== "disconnected" && scenario !== "reconnect";
	const available = scenario === "available";
	const now = new Date().toISOString();
	const primaryBlockers = {
		current: "none",
		available: "none",
		required: "service_update_required",
		empty: "agent_controller_report_not_ready",
		disconnected: "service_not_connected",
		reconnect: "service_not_connected",
	} as const;
	const nextActions = {
		current: "none",
		available: "none",
		required: "update_service",
		empty: "run_setup",
		disconnected: "reconnect_service",
		reconnect: "reconnect_service",
	} as const;
	const disconnectedReason =
		scenario === "reconnect"
			? "daemon.session.reject_conflict"
			: "daemon.session.not_found";
	return currentLocalRuntimeReplyReadinessResponseSchema.parse({
		generatedAt: now,
		canReplyFromThisComputer: scenario === "current" || available,
		currentTarget: {
			availability: "resolved",
			deviceId,
			runtimeLane: "dev-local",
		},
		status: scenario === "current" || available ? "ready" : "blocked",
		primaryBlocker: primaryBlockers[scenario],
		nextAction: nextActions[scenario],
		message:
			scenario === "reconnect"
				? "This computer is currently attached to another OpenMeld account. Reconnect this account to take control."
				: "Local UI preview only. This is not a running computer or a Wake-ready Agent.",
		runtime: {
			deviceId,
			deviceDisplayName: `Preview · ${scenario}`,
			runtimeLane: "dev-local",
			executionTargetStatus:
				scenario === "current" || available ? "ready" : "not_ready",
			lastObservedAtMs: connected ? Date.now() : Date.now() - 86_400_000,
			reasonCodes: [],
			signInOnlyBlockers: false,
			openMeldServiceRuntimeId: {
				source: "runtime_registry_authority",
				value: `${PREFIX}runtime-${scenario}`,
			},
		},
		service: {
			connected,
			matchingCurrentRuntime: connected,
			reasonCodes: connected ? [] : [disconnectedReason],
			sessionDeviceId: connected ? deviceId : null,
			sessionLane: connected ? "dev-local" : null,
			executionCompatibility: null,
		},
		localComponents: fixtureComponents(deviceId, scenario, now),
	});
}

function fixtureComponents(
	deviceId: string,
	scenario: Exclude<Scenario, "unknown">,
	now: string
) {
	const connected = connectionStatus(scenario) === "connected";
	const required = scenario === "required";
	const hasUpdate = required || scenario === "available";
	const updateStates = {
		required: "update_required",
		available: "update_available",
	} as const;
	const updatePolicies = {
		required: "required",
		available: "available",
	} as const;
	const status = hasUpdate
		? updateStates[scenario as keyof typeof updateStates]
		: "current";
	const updatePolicy = hasUpdate
		? updatePolicies[scenario as keyof typeof updatePolicies]
		: "ok";
	const installedVersion = hasUpdate ? "0.3.164" : "0.3.165";
	const setupAction = hasUpdate ? "update_service" : "none";
	const setupActionLabel = hasUpdate ? "Update" : "Everything is up to date";
	return {
		schemaVersion: 1,
		generatedAt: now,
		humanSetupCommand: "echo 'Local UI preview only'",
		agentSetupCommand: "echo 'Local UI preview only'",
		setupAction: connected ? setupAction : "reconnect_service",
		setupActionLabel: connected ? setupActionLabel : "Reconnect Computer",
		setupActionDescription: "Local UI preview only.",
		...(connected
			? {
					maintenance: {
						automaticUpdatesEnabled: automaticUpdates.get(deviceId) ?? true,
						status: "ready",
					},
				}
			: {}),
		cli: {
			commandContractVersion: null,
			installedPackageVersion: connected ? "0.3.165" : null,
			latestPackageVersion: "0.3.165",
			requiredCommandContractVersion: null,
			reasonCodes: [],
			status: connected ? "current" : "unknown",
			updatePolicy: "ok",
			wakeBlocked: false,
		},
		service: {
			installedVersion: connected ? installedVersion : null,
			latestVersion: "0.3.165",
			requiredVersion: required ? "0.3.165" : null,
			reasonCodes: required ? ["service.update_required"] : [],
			status: connected ? status : "unknown",
			updatePolicy,
			wakeBlocked: required,
		},
		skills: {
			expectedBundleHash: "preview-bundle",
			expectedTargetCount: 1,
			installedBundleHash: connected ? "preview-bundle" : null,
			skillContractVersion: "preview-contract",
			status: connected ? "current" : "unknown",
			targetCount: connected ? 1 : null,
			reasonCodes: [],
			updatePolicy: "ok",
			wakeBlocked: false,
		},
	};
}

export function setComputerStateFixtureAutomaticUpdates(
	deviceId: string,
	enabled: boolean
) {
	automaticUpdates.set(deviceId, enabled);
	return { automaticUpdatesEnabled: enabled, status: "updated" as const };
}
