"use client";

import { peopleComputerContainsDevice } from "@openmeld/agent-runtime";
import type {
	LocalProjectControlConnection,
	LocalProjectControlProjectDiscovery,
	LocalRuntimeComputer,
	LocalRuntimeExecutionTarget,
	LocalRuntimesResponse,
	PeopleComputerTarget,
} from "@openmeld/schemas/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useStartFlowState } from "#/components/app/start-flow-state";
import type { PeopleComputerInventory } from "#/lib/connect/local-runtimes";
import {
	LOCAL_PROJECT_CONTROL_UNREACHABLE_MESSAGE,
	resolveLocalProjectControlFailureCode,
} from "#/lib/organizations/local-project-control";
import { localRuntimesQueryOptions } from "#/query/connect/local-runtimes";
import {
	applyProjectDiscoveryConnectionSnapshot,
	claimProjectDiscoveryMutationGeneration,
	type ProjectDiscoveryProjectRef,
	projectDiscoveryQueryKeys,
	projectDiscoveryQueryOptions,
} from "#/query/organizations/project-discovery";

export type ProjectComputerView = {
	connections: readonly LocalProjectControlConnection[];
	discovery: LocalProjectControlProjectDiscovery | null;
	errorMessage: string | null;
	status:
		| "checking"
		| "discovery_failed"
		| "ready"
		| "service_unavailable"
		| "update_required";
};
type ProjectControlServiceState =
	| "checking"
	| "connected"
	| "service_unavailable"
	| "update_required"
	| "discovery_failed";

function resolveExplicitProjectControlServiceState(input: {
	target: PeopleComputerTarget;
	query: {
		isPending: boolean;
		isError: boolean;
		data?: PeopleComputerInventory;
	};
}): ProjectControlServiceState {
	if (input.query.isPending) {
		return "checking";
	}
	if (input.query.isError || !input.query.data) {
		return "discovery_failed";
	}
	const computer = input.query.data.peopleComputers.computers.find((entry) =>
		peopleComputerContainsDevice(entry, input.target.deviceId)
	);
	if (!computer || computer.connection.status === "unknown") {
		return "discovery_failed";
	}
	const session = computer.connection.sessions.find(
		(entry) =>
			entry.deviceId === input.target.deviceId &&
			entry.runtimeLane === input.target.runtimeLane
	);
	if (!session) {
		return "service_unavailable";
	}
	return session.controls?.localProjectControl?.discoverProjects === true
		? "connected"
		: "update_required";
}

export function useProjectDiscovery(input: {
	target?: PeopleComputerTarget;
	enabled?: boolean;
	includeCandidates?: boolean;
	organizationId: string;
	projects: readonly ProjectDiscoveryProjectRef[];
}) {
	const { storageScope } = useStartFlowState();
	const enabled = input.enabled ?? true;
	const queryClient = useQueryClient();
	const localRuntimesQuery = useQuery(
		localRuntimesQueryOptions({ enabled, storageScope })
	);
	const selection = input.target
		? resolveExplicitProjectControlSelection(
				localRuntimesQuery.data,
				input.target
			)
		: resolveProjectControlSelection(localRuntimesQuery.data);
	const computer = selection?.computer ?? null;
	const target = selection?.target ?? null;
	const serviceState = input.target
		? resolveExplicitProjectControlServiceState({
				target: input.target,
				query: localRuntimesQuery,
			})
		: resolveProjectControlServiceState({
				computer,
				isError: localRuntimesQuery.isError,
				isPending: localRuntimesQuery.isPending,
				target,
			});
	const discoveryTarget = input.target ?? {
		deviceId: target?.deviceId ?? "unavailable",
		runtimeLane: target?.runtimeLane ?? "unavailable",
	};
	const discoveryOptions = projectDiscoveryQueryOptions({
		explicitTarget: input.target,
		includeCandidates: input.includeCandidates,
		enabled: enabled && serviceState === "connected",
		organizationId: input.organizationId,
		projects: input.projects,
		storageScope,
		target: discoveryTarget,
	});
	const discoveryQuery = useQuery(discoveryOptions);
	const failure = discoveryQuery.error
		? resolveProjectDiscoveryFailure(discoveryQuery.error)
		: null;
	const status = resolveProjectDiscoveryStatus({
		hasResponse: Boolean(discoveryQuery.data),
		projectCount: input.projects.length,
		queryFailed: discoveryQuery.isError,
		serviceState,
	});

	const claimMutationGeneration = () => {
		queryClient
			.cancelQueries({
				queryKey: projectDiscoveryQueryKeys.target({
					deviceId: discoveryTarget.deviceId,
					organizationId: input.organizationId,
					runtimeLane: discoveryTarget.runtimeLane,
					storageScope,
				}),
			})
			.catch((error: unknown) => {
				console.error("Failed to cancel the current Project check.", error);
			});
		return claimProjectDiscoveryMutationGeneration({
			organizationId: input.organizationId,
			storageScope,
			target: discoveryTarget,
		});
	};

	const applyConnectionSnapshot = (
		projectId: string,
		connections: readonly LocalProjectControlConnection[]
	) => {
		const hadResponse = Boolean(discoveryQuery.data);
		queryClient.setQueriesData<
			import("@openmeld/schemas/types").LocalProjectControlDiscoverProjectsResponse
		>(
			{
				queryKey: projectDiscoveryQueryKeys.target({
					deviceId: discoveryTarget.deviceId,
					organizationId: input.organizationId,
					runtimeLane: discoveryTarget.runtimeLane,
					storageScope,
				}),
			},
			(response) =>
				applyProjectDiscoveryConnectionSnapshot(
					response,
					projectId,
					connections
				)
		);
		// A connection can be saved while the first read is pending. Read back
		// the canonical snapshot instead of fabricating discovery metadata.
		if (!hadResponse) {
			discoveryQuery
				.refetch({ cancelRefetch: true })
				.catch((error: unknown) =>
					console.error("Failed to read the saved Project connection.", error)
				);
		}
	};

	const refresh = () => {
		if (!enabled) {
			return;
		}
		localRuntimesQuery.refetch().catch((error: unknown) => {
			console.error("Failed to refresh current-computer status.", error);
		});
		if (serviceState === "connected" && input.projects.length > 0) {
			discoveryQuery
				.refetch({ cancelRefetch: true })
				.catch((error: unknown) => {
					console.error("Failed to check Projects on this computer.", error);
				});
		}
	};

	const projectView = (projectId: string): ProjectComputerView => {
		const discovery =
			discoveryQuery.data?.projects.find(
				(project) => project.projectId === projectId
			) ?? null;
		return {
			connections: discovery?.connections ?? [],
			discovery,
			errorMessage: resolveProjectDiscoveryErrorMessage({
				failureMessage: failure?.errorMessage ?? null,
				serviceState,
				status,
			}),
			status,
		};
	};

	return {
		applyConnectionSnapshot,
		claimMutationGeneration,
		computer,
		isRefreshing:
			localRuntimesQuery.isRefetching || discoveryQuery.isRefetching,
		projectView,
		refresh,
		refreshErrorMessage:
			discoveryQuery.data && discoveryQuery.isError
				? "Couldn’t check again. Showing the last result."
				: null,
		serviceState,
		target,
	};
}

function resolveProjectDiscoveryErrorMessage(input: {
	failureMessage: string | null;
	serviceState: ProjectControlServiceState;
	status: ProjectComputerView["status"];
}): string | null {
	if (input.status === "ready") {
		return null;
	}
	if (input.serviceState === "discovery_failed") {
		return "OpenMeld couldn’t check this computer. Try again.";
	}
	if (input.serviceState === "update_required") {
		return "Update OpenMeld on this computer before connecting Project folders from the Web.";
	}
	if (input.serviceState === "service_unavailable") {
		return LOCAL_PROJECT_CONTROL_UNREACHABLE_MESSAGE;
	}
	return input.failureMessage;
}

function resolveProjectDiscoveryStatus(input: {
	hasResponse: boolean;
	projectCount: number;
	queryFailed: boolean;
	serviceState: ProjectControlServiceState;
}): ProjectComputerView["status"] {
	if (input.serviceState !== "connected") {
		return input.serviceState;
	}
	if (input.hasResponse || input.projectCount === 0) {
		return "ready";
	}
	return input.queryFailed ? "discovery_failed" : "checking";
}

function resolveExplicitProjectControlSelection(
	localRuntimes: LocalRuntimesResponse | undefined,
	target: PeopleComputerTarget
) {
	const computer = localRuntimes?.localRuntimes.find((entry) =>
		peopleComputerContainsDevice(entry, target.deviceId)
	);
	if (!computer) {
		return null;
	}
	return {
		computer,
		target:
			computer.executionTargets.find(
				(entry) =>
					entry.deviceId === target.deviceId &&
					entry.runtimeLane === target.runtimeLane
			) ?? null,
	};
}

function resolveProjectControlSelection(
	localRuntimes: LocalRuntimesResponse | undefined
): {
	computer: LocalRuntimeComputer;
	target: LocalRuntimeExecutionTarget | null;
} | null {
	if (!localRuntimes) {
		return null;
	}
	if (localRuntimes.currentDeviceId && localRuntimes.currentRuntimeLane) {
		for (const computer of localRuntimes.localRuntimes) {
			const target = computer.executionTargets.find(
				(candidate) =>
					candidate.deviceId === localRuntimes.currentDeviceId &&
					candidate.runtimeLane === localRuntimes.currentRuntimeLane
			);
			if (target) {
				return { computer, target };
			}
		}
	}
	const liveTargets: Array<{
		computer: LocalRuntimeComputer;
		target: LocalRuntimeExecutionTarget;
	}> = [];
	for (const computer of localRuntimes.localRuntimes) {
		if (computer.connectionStatus !== "connected") {
			continue;
		}
		for (const candidate of computer.executionTargets) {
			if (candidate.status === "ready") {
				liveTargets.push({ computer, target: candidate });
			}
		}
	}
	return liveTargets.length === 1 ? (liveTargets[0] ?? null) : null;
}

function resolveProjectControlServiceState(input: {
	computer: LocalRuntimeComputer | null;
	isError: boolean;
	isPending: boolean;
	target: LocalRuntimeExecutionTarget | null;
}): "checking" | "connected" | "service_unavailable" | "update_required" {
	if (input.isPending) {
		return "checking";
	}
	if (input.isError || !(input.computer && input.target)) {
		return "service_unavailable";
	}
	const capabilities = input.target.localProjectControl;
	if (!(capabilities?.discoverProjects && capabilities.connectDeclaredPath)) {
		return "update_required";
	}
	return "connected";
}

function resolveProjectDiscoveryFailure(error: unknown): {
	errorMessage: string;
	status: "discovery_failed" | "service_unavailable" | "update_required";
} {
	const code = resolveLocalProjectControlFailureCode(error);
	if (code === "service_offline") {
		return {
			errorMessage: LOCAL_PROJECT_CONTROL_UNREACHABLE_MESSAGE,
			status: "service_unavailable",
		};
	}
	if (code === "service_update_required" || code === "unsupported") {
		return {
			errorMessage:
				"Update OpenMeld on this computer before connecting Project folders from the Web.",
			status: "update_required",
		};
	}
	return {
		errorMessage:
			"OpenMeld couldn’t check this Project on this computer. Check again or connect a folder manually.",
		status: "discovery_failed",
	};
}
