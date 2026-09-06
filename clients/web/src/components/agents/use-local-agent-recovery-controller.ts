"use client";

import { parseAgentControllerRef } from "@openmeld/agent-runtime";
import type {
	AgentExecutionReadinessTargetRuntime,
	AuthProfileView,
	CurrentDeviceTargetResponse,
	DaemonServiceLane,
	GetAgentExecutionReadinessResponse,
	LocalRuntimeComputer,
	LocalRuntimesResponse,
	PeopleComputerTarget,
	PrepareSessionSnapshot,
} from "@openmeld/schemas/types";
import {
	type QueryClient,
	useQueries,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useStartFlowState } from "#/components/app/start-flow-state";
import {
	completedPointerMatchesCurrentComputerPrepareContext,
	pointerMatchesCurrentComputerPrepareContext,
	readCompletedPrepareSessionPointer,
	readPrepareSessionPointer,
} from "#/components/connect/prepare-session-pointer";
import {
	AGENT_EXECUTION_READINESS_UI_BATCH_SIZE,
	chunkAgentExecutionReadinessProfileIds,
} from "#/lib/agents/agent-execution-readiness";
import {
	type BringAgentsSetupState,
	resolveBringAgentsSetupState,
} from "#/lib/connect/bring-agents-setup-mode";
import {
	forgetCurrentComputer,
	forgetComputer as forgetLocalRuntime,
} from "#/lib/connect/current-device-target";
import { resolveCurrentLocalRuntime } from "#/lib/connect/current-local-runtime";
import {
	refreshPeopleComputerLocalAgentCatalog,
	setLocalRuntimeDisplayName,
	setPeopleComputerLocalAgentEnabled,
} from "#/lib/connect/local-runtimes";
import { readStartGatewayUrl } from "#/lib/connect/start-gateway-url";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";
import { useSelectedHumanProfile } from "#/lib/profiles/use-selected-human-profile";
import { readBundledOpenMeldCliRelease } from "#/lib/release/openmeld-cli-release";
import {
	isSessionExpiredError,
	toSessionExpiredState,
} from "#/lib/session-expired";
import {
	agentExecutionReadinessBatchQueryOptions,
	refreshWebAgentReadinessSharedCaches,
} from "#/query/agents/execution-readiness";
import { currentDeviceTargetQueryOptions } from "#/query/connect/current-device-target";
import {
	currentLocalRuntimeReplyReadinessQueryOptions,
	localRuntimesQueryOptions,
} from "#/query/connect/local-runtimes";
import { prepareSessionQueryOptions } from "#/query/connect/prepare-session";
import { startProfilesQueryOptions } from "#/query/profiles/profiles";
import { isQueryCancellationError } from "#/query/query-cancellation";
import { startQueryKeys } from "#/query/query-keys";
import { openMeldCliLatestReleaseQueryOptions } from "#/query/release/openmeld-cli-version";
import { useLocalRuntimeQueries } from "./use-local-runtime-queries";

type GatewayLoadState =
	| {
			errorMessage: null;
			status: "idle" | "loading";
			value: null;
	  }
	| {
			errorMessage: string;
			status: "error";
			value: null;
	  }
	| {
			errorMessage: null;
			status: "ready";
			value: string;
	  };

type LocalAgentRecoveryControllerOptions = {
	agentExecutionReadinessScope?: AgentExecutionReadinessScope;
	currentLocalRuntimeReplyReadinessRefetchIntervalMs?: false | number;
	loadAgentExecutionReadiness?: boolean;
	loadAgentProfiles?: boolean;
	// Setup-only state means Prepare Session progress. Agents and Spaces must
	// leave this off and read canonical local runtime / Agent execution readiness
	// instead.
	loadSetupState?: boolean;
};

export type AgentExecutionReadinessScope =
	| "bound_runtime"
	| "current_local_runtime";

export function isOrdinaryActiveAgentProfile(
	profile: AuthProfileView
): boolean {
	return (
		profile.profileKind === "agent" &&
		profile.status === "active" &&
		profile.managedRole !== "center_agent"
	);
}

function resolveCurrentLocalRuntimeTargetRuntime(
	currentDeviceTarget: CurrentDeviceTargetResponse | undefined
): AgentExecutionReadinessTargetRuntime | undefined {
	if (currentDeviceTarget?.availability !== "resolved") {
		return undefined;
	}
	return { kind: "current_local_runtime" };
}

export function useLocalAgentRecoveryController(
	options: LocalAgentRecoveryControllerOptions = {}
) {
	// TODO(2026-05-15): Split this controller into focused hooks after Start
	// setup state is fully quarantined: Local Runtime inventory/readiness,
	// AgentExecutionReadiness, Prepare Session setup state, and UI recovery
	// actions should not live in one mixed hook.
	const queryClient = useQueryClient();
	const organizationId =
		useOptionalAppOrganization()?.currentOrganization.id ?? null;
	const {
		shouldLoadAgentExecutionReadiness: shouldLoadAgentExecutionReadinessBase,
		shouldLoadAgentProfiles,
		shouldLoadSetupState,
	} = resolveLocalAgentRecoveryOptions(options);
	const { storageScope } = useStartFlowState();
	const { selectedHumanProfile, selectedHumanProfileId } =
		useSelectedHumanProfile({
			selectDefaultWhenMissing: true,
			syncMissingSelectionToStartFlow: false,
		});
	const { gatewayLoadState, loadGatewayUrl } = useGatewayLoadController();
	const [sessionExpiredError, setSessionExpiredError] = useState<
		unknown | null
	>(null);
	const {
		currentDeviceTargetQuery,
		currentLocalRuntimeReplyReadinessQuery,
		deviceId,
		localRuntimesQuery,
		runtimeLane,
	} = useLocalRuntimeQueries({
		selectedHumanProfileId,
		currentLocalRuntimeReplyReadinessRefetchIntervalMs:
			options.currentLocalRuntimeReplyReadinessRefetchIntervalMs,
		storageScope,
	});
	const currentLocalRuntimeCanReply =
		currentLocalRuntimeReplyReadinessQuery.data?.canReplyFromThisComputer ??
		null;
	const shouldLoadAgentExecutionReadiness =
		resolveShouldLoadAgentExecutionReadiness({
			activeOrganizationId: organizationId,
			currentLocalRuntimeCanReply: currentLocalRuntimeCanReply ?? undefined,
			scope: options.agentExecutionReadinessScope,
			shouldLoadAgentExecutionReadinessBase,
		});
	const agentProfilesQuery = useQuery(
		startProfilesQueryOptions({
			enabled: shouldLoadAgentProfiles,
			storageScope,
		})
	);
	const agentProfiles = useMemo(
		() =>
			resolveActiveAgentProfiles({
				profiles: agentProfilesQuery.data,
				shouldLoadAgentProfiles,
			}),
		[agentProfilesQuery.data, shouldLoadAgentProfiles]
	);
	const agentProfileIds = useMemo(
		() => agentProfiles.map((profile) => profile.openMeldProfileId),
		[agentProfiles]
	);
	const agentExecutionReadinessBatchProfileIds = useMemo(
		() =>
			chunkAgentExecutionReadinessProfileIds(
				agentProfileIds,
				AGENT_EXECUTION_READINESS_UI_BATCH_SIZE
			),
		[agentProfileIds]
	);
	const agentExecutionReadinessBatchQueries = useQueries({
		queries: agentExecutionReadinessBatchProfileIds.map((batchProfileIds) =>
			agentExecutionReadinessBatchQueryOptions({
				agentProfileIds: batchProfileIds,
				enabled:
					shouldLoadAgentExecutionReadiness && agentProfilesQuery.isSuccess,
				organizationId: organizationId ?? "organization-unavailable",
				storageScope,
				targetRuntime: resolveAgentExecutionReadinessTargetRuntime({
					currentDeviceTarget: currentDeviceTargetQuery.data,
					scope: options.agentExecutionReadinessScope,
				}),
			})
		),
	});
	const agentExecutionReadinessQueryBatches = useMemo(
		() =>
			agentExecutionReadinessBatchProfileIds.map((batchProfileIds, index) => ({
				profileIds: batchProfileIds,
				query: agentExecutionReadinessBatchQueries[index],
			})),
		[
			agentExecutionReadinessBatchProfileIds,
			agentExecutionReadinessBatchQueries,
		]
	);
	const agentExecutionReadinessState = useMemo(
		() =>
			resolveAgentExecutionReadinessState({
				agentProfiles,
				queryBatches: agentExecutionReadinessQueryBatches,
			}),
		[agentExecutionReadinessQueryBatches, agentProfiles]
	);
	const prepareSessionPointer = readPrepareSessionPointer();
	const completedPrepareSessionPointer = readCompletedPrepareSessionPointer();
	const {
		currentCompletedPrepareSessionPointer,
		currentPrepareSessionPointer,
	} = resolveCurrentPrepareSessionPointers({
		completedPrepareSessionPointer,
		deviceId,
		prepareSessionPointer,
		runtimeLane,
		selectedHumanProfileId,
	});
	const prepareSessionQuery = useQuery(
		prepareSessionQueryOptions({
			enabled: shouldLoadSetupState && currentPrepareSessionPointer !== null,
			prepareSessionId:
				currentPrepareSessionPointer?.prepareSessionId ?? "no-prepare-session",
			storageScope,
		})
	);
	const completedPrepareSessionQuery = useQuery(
		prepareSessionQueryOptions({
			enabled:
				shouldLoadSetupState && currentCompletedPrepareSessionPointer !== null,
			prepareSessionId:
				currentCompletedPrepareSessionPointer?.prepareSessionId ??
				"no-completed-prepare-session",
			storageScope,
		})
	);
	const completedPrepareSessionSnapshot = useMemo(() => {
		if (!shouldLoadSetupState) {
			return null;
		}
		const currentSnapshot = resolveCompletedPrepareSessionSnapshot({
			deviceId,
			runtimeLane,
			selectedHumanProfileId,
			snapshot: prepareSessionQuery.data?.snapshot ?? null,
		});
		if (currentSnapshot !== null) {
			return currentSnapshot;
		}
		return resolveCompletedPrepareSessionSnapshot({
			deviceId,
			runtimeLane,
			selectedHumanProfileId,
			snapshot: completedPrepareSessionQuery.data?.snapshot ?? null,
		});
	}, [
		completedPrepareSessionQuery.data?.snapshot,
		deviceId,
		prepareSessionQuery.data?.snapshot,
		runtimeLane,
		selectedHumanProfileId,
		shouldLoadSetupState,
	]);
	const isCheckingCompletedPrepareSession =
		resolveIsCheckingCompletedPrepareSession({
			completedPrepareSessionQueryIsPending:
				completedPrepareSessionQuery.isPending,
			currentCompletedPrepareSessionPointer,
			currentPrepareSessionPointer,
			prepareSessionQueryIsPending: prepareSessionQuery.isPending,
		});

	const currentComputer = useMemo(
		() => resolveCurrentLocalRuntime(localRuntimesQuery.data),
		[localRuntimesQuery.data]
	);
	const selectedTargetDevice = useMemo(() => {
		const currentDeviceTarget = currentDeviceTargetQuery.data;
		if (
			currentDeviceTarget?.availability !== "resolved" ||
			!localRuntimesQuery.data
		) {
			return null;
		}

		return (
			localRuntimesQuery.data.localRuntimes.find(
				(device) => device.deviceId === currentDeviceTarget.deviceId
			) ?? null
		);
	}, [currentDeviceTargetQuery.data, localRuntimesQuery.data]);
	const selectedExecutionTarget = useMemo(() => {
		const currentDeviceTarget = currentDeviceTargetQuery.data;
		if (
			currentDeviceTarget?.availability !== "resolved" ||
			selectedTargetDevice === null
		) {
			return null;
		}

		const currentDeviceId = currentDeviceTarget.deviceId;
		const currentRuntimeLane = currentDeviceTarget.runtimeLane;
		return (
			selectedTargetDevice.executionTargets.find(
				(target) =>
					target.deviceId === currentDeviceId &&
					target.runtimeLane === currentRuntimeLane
			) ?? null
		);
	}, [currentDeviceTargetQuery.data, selectedTargetDevice]);
	const shouldLoadProductionCliRelease =
		selectedExecutionTarget?.userFacingCommand === "openmeld";
	const openMeldCliLatestReleaseQuery = useQuery(
		openMeldCliLatestReleaseQueryOptions({
			enabled: shouldLoadProductionCliRelease,
		})
	);
	const expectedServiceVersion = useMemo(
		() =>
			resolveExpectedServiceVersion({
				latestProductionVersion:
					openMeldCliLatestReleaseQuery.data?.version ?? null,
				selectedExecutionTarget,
			}),
		[openMeldCliLatestReleaseQuery.data?.version, selectedExecutionTarget]
	);
	const otherLocalRuntimes = useMemo(
		() =>
			resolveOtherLocalRuntimes({
				currentComputer,
				localRuntimes: localRuntimesQuery.data,
			}),
		[currentComputer, localRuntimesQuery.data]
	);
	const runContext = useMemo(() => {
		if (completedPrepareSessionSnapshot !== null) {
			const localAgentIds = [
				...completedPrepareSessionSnapshot.selectedLocalAgentIds,
			];
			return {
				isActive: true,
				localPreparationMode:
					localAgentIds.length > 0
						? ("prepare_local_agents" as const)
						: ("skip_local_agents" as const),
				localAgentIds,
				sessionProfileId: selectedHumanProfileId,
			};
		}

		const runtimeLocalAgentIds =
			resolveReadyBuiltinLocalAgentIdsFromExecutionTarget(
				selectedExecutionTarget
			);
		if (runtimeLocalAgentIds.length > 0) {
			return {
				isActive: true,
				localPreparationMode: "prepare_local_agents" as const,
				localAgentIds: runtimeLocalAgentIds,
				sessionProfileId: selectedHumanProfileId,
			};
		}

		return {
			isActive: false,
			localAgentIds: [],
			localPreparationMode: "unresolved" as const,
			sessionProfileId: null,
		};
	}, [
		completedPrepareSessionSnapshot,
		selectedHumanProfileId,
		selectedExecutionTarget,
	]);
	const startLocalPreparationState = useMemo<BringAgentsSetupState>(
		() =>
			resolveStartLocalPreparationState({
				currentDeviceTarget: currentDeviceTargetQuery.data,
				localAgentCatalogEntries:
					selectedExecutionTarget?.localAgentCatalog.entries ?? null,
				shouldLoadSetupState,
			}),
		[
			currentDeviceTargetQuery.data,
			selectedExecutionTarget,
			shouldLoadSetupState,
		]
	);
	const localPreparationState = useMemo<BringAgentsSetupState>(() => {
		if (completedPrepareSessionSnapshot !== null) {
			return { kind: "none" };
		}
		return startLocalPreparationState;
	}, [completedPrepareSessionSnapshot, startLocalPreparationState]);
	const completedPrepareSessionLocalAgentCatalogEntries =
		completedPrepareSessionSnapshot?.localAgentCatalog?.entries ?? null;
	const localAgentCatalogEntries =
		completedPrepareSessionLocalAgentCatalogEntries ??
		selectedExecutionTarget?.localAgentCatalog.entries ??
		null;
	const observedSessionExpiredError = useMemo(
		() =>
			findSessionExpiredError([
				currentDeviceTargetQuery.error,
				localRuntimesQuery.error,
				shouldLoadAgentProfiles ? agentProfilesQuery.error : null,
			]),
		[
			agentProfilesQuery.error,
			currentDeviceTargetQuery.error,
			localRuntimesQuery.error,
			shouldLoadAgentProfiles,
		]
	);
	const activeSessionExpiredError =
		sessionExpiredError ?? observedSessionExpiredError;
	const sessionExpiredState = useMemo(
		() => toSessionExpiredState(activeSessionExpiredError),
		[activeSessionExpiredError]
	);
	const blockingErrorMessage = useMemo(
		() =>
			resolveBlockingErrorMessage({
				agentProfilesError: agentProfilesQuery.error,
				agentProfilesIsError: agentProfilesQuery.isError,
				currentDeviceTargetError: currentDeviceTargetQuery.error,
				currentDeviceTargetIsError: currentDeviceTargetQuery.isError,
				localRuntimesError: localRuntimesQuery.error,
				localRuntimesIsError: localRuntimesQuery.isError,
				sessionExpiredState,
				shouldLoadAgentProfiles,
			}),
		[
			agentProfilesQuery.error,
			agentProfilesQuery.isError,
			currentDeviceTargetQuery.error,
			currentDeviceTargetQuery.isError,
			localRuntimesQuery.error,
			localRuntimesQuery.isError,
			sessionExpiredState,
			shouldLoadAgentProfiles,
		]
	);

	useEffect(() => {
		if (sessionExpiredError !== null || observedSessionExpiredError === null) {
			return;
		}

		setSessionExpiredError(observedSessionExpiredError);
	}, [observedSessionExpiredError, sessionExpiredError]);

	const localRuntimeActions = useLocalRuntimeActions({
		currentCompletedPrepareSessionPointer,
		currentPrepareSessionPointer,
		deviceId,
		queryClient,
		organizationId,
		sessionExpiredError,
		setSessionExpiredError,
		agentExecutionReadinessScope: options.agentExecutionReadinessScope,
		shouldLoadAgentExecutionReadiness,
		shouldLoadAgentProfiles,
		shouldLoadProductionCliRelease,
		shouldLoadSetupState,
		storageScope,
	});
	const {
		forgetComputer,
		forgetThisComputer,
		refreshAll,
		refreshLocalAgentCatalog,
		setLocalAgentEnabled,
		setComputerDisplayName,
	} = localRuntimeActions;
	const refreshAllRef = useRef(refreshAll);
	const previousLocalRuntimeCanReplyRef = useRef<boolean | null>(null);

	useEffect(() => {
		refreshAllRef.current = refreshAll;
	}, [refreshAll]);

	useEffect(() => {
		const previousLocalRuntimeCanReply =
			previousLocalRuntimeCanReplyRef.current;
		previousLocalRuntimeCanReplyRef.current = currentLocalRuntimeCanReply;

		if (
			!shouldRefreshLocalRuntimeAfterServiceReconnect({
				currentLocalRuntimeCanReply,
				previousLocalRuntimeCanReply,
			})
		) {
			return;
		}
		if (sessionExpiredError !== null) {
			return;
		}

		refreshAgentReadinessSharedCachesForOrganization({
			organizationId,
			queryClient,
			storageScope,
		})
			.then(async () => {
				await refreshAllRef.current();
			})
			.catch((error: unknown) => {
				if (isQueryCancellationError(error)) {
					return;
				}
				console.error(
					"Failed to refresh local controller state after OpenMeld Service reconnected.",
					error
				);
			});
	}, [
		currentLocalRuntimeCanReply,
		queryClient,
		organizationId,
		sessionExpiredError,
		storageScope,
	]);

	return {
		agentExecutionReadinessByProfileId:
			agentExecutionReadinessState.byProfileId,
		agentExecutionReadinessErrorByProfileId:
			agentExecutionReadinessState.errorByProfileId,
		agentExecutionReadinessPendingProfileIds:
			agentExecutionReadinessState.pendingProfileIds,
		agentProfiles,
		agentProfilesQuery,
		openMeldCliLatestReleaseQuery,
		blockingErrorMessage,
		currentComputer,
		currentDeviceTargetQuery,
		currentLocalRuntimeReplyReadinessQuery,
		deviceId,
		completedPrepareSessionLocalAgentCatalogEntries,
		completedPrepareSessionSnapshot,
		expectedServiceVersion,
		forgetThisComputer,
		forgetComputer,
		gatewayLoadState,
		isCheckingCompletedPrepareSession,
		loadGatewayUrl,
		localPreparationState,
		localAgentCatalogEntries,
		localRuntimesQuery,
		otherLocalRuntimes,
		refreshAll,
		refreshLocalAgentCatalog,
		runContext,
		runtimeLane,
		selectedExecutionTarget,
		selectedTargetDevice,
		sessionExpiredState,
		selectedHumanProfile,
		selectedHumanProfileId,
		prepareSessionQuery,
		storageScope,
		setLocalAgentEnabled,
		setComputerDisplayName,
	};
}

type PrepareSessionPointer = ReturnType<typeof readPrepareSessionPointer>;

function resolveLocalAgentRecoveryOptions(
	options: LocalAgentRecoveryControllerOptions
): {
	shouldLoadAgentExecutionReadiness: boolean;
	shouldLoadAgentProfiles: boolean;
	shouldLoadSetupState: boolean;
} {
	const shouldLoadAgentProfiles = options.loadAgentProfiles ?? true;
	return {
		shouldLoadAgentExecutionReadiness:
			(options.loadAgentExecutionReadiness ?? shouldLoadAgentProfiles) &&
			shouldLoadAgentProfiles,
		shouldLoadAgentProfiles,
		shouldLoadSetupState: options.loadSetupState ?? true,
	};
}

export function resolveShouldLoadAgentExecutionReadiness(input: {
	activeOrganizationId?: string | null;
	currentLocalRuntimeCanReply: boolean | undefined;
	scope: AgentExecutionReadinessScope | undefined;
	shouldLoadAgentExecutionReadinessBase: boolean;
}): boolean {
	if (
		!(
			input.shouldLoadAgentExecutionReadinessBase &&
			input.activeOrganizationId?.trim()
		)
	) {
		return false;
	}
	if (input.scope === "bound_runtime") {
		return true;
	}
	return input.currentLocalRuntimeCanReply === true;
}

export function shouldRefreshLocalRuntimeAfterServiceReconnect(input: {
	currentLocalRuntimeCanReply: boolean | null;
	previousLocalRuntimeCanReply: boolean | null;
}): boolean {
	return (
		input.previousLocalRuntimeCanReply === false &&
		input.currentLocalRuntimeCanReply === true
	);
}

function resolveActiveAgentProfiles(input: {
	profiles: readonly AuthProfileView[] | undefined;
	shouldLoadAgentProfiles: boolean;
}): AuthProfileView[] {
	if (!input.shouldLoadAgentProfiles) {
		return [];
	}
	return (input.profiles ?? []).filter(isOrdinaryActiveAgentProfile);
}

function resolveCurrentPrepareSessionPointers(input: {
	completedPrepareSessionPointer: PrepareSessionPointer;
	deviceId: string | null;
	prepareSessionPointer: PrepareSessionPointer;
	runtimeLane: DaemonServiceLane | null;
	selectedHumanProfileId: string | null;
}): {
	currentCompletedPrepareSessionPointer: PrepareSessionPointer | null;
	currentPrepareSessionPointer: PrepareSessionPointer | null;
} {
	const currentPrepareSessionPointer =
		pointerMatchesCurrentComputerPrepareContext(input.prepareSessionPointer, {
			deviceId: input.deviceId,
			humanProfileId: input.selectedHumanProfileId,
			runtimeLane: input.runtimeLane,
		})
			? input.prepareSessionPointer
			: null;
	const currentCompletedPrepareSessionPointer =
		completedPointerMatchesCurrentComputerPrepareContext(
			input.completedPrepareSessionPointer,
			{
				deviceId: input.deviceId,
				humanProfileId: input.selectedHumanProfileId,
				runtimeLane: input.runtimeLane,
			}
		) &&
		input.completedPrepareSessionPointer.prepareSessionId !==
			currentPrepareSessionPointer?.prepareSessionId
			? input.completedPrepareSessionPointer
			: null;

	return {
		currentCompletedPrepareSessionPointer,
		currentPrepareSessionPointer,
	};
}

function resolveIsCheckingCompletedPrepareSession(input: {
	completedPrepareSessionQueryIsPending: boolean;
	currentCompletedPrepareSessionPointer: PrepareSessionPointer | null;
	currentPrepareSessionPointer: PrepareSessionPointer | null;
	prepareSessionQueryIsPending: boolean;
}): boolean {
	return (
		(input.currentPrepareSessionPointer !== null &&
			input.prepareSessionQueryIsPending) ||
		(input.currentCompletedPrepareSessionPointer !== null &&
			input.completedPrepareSessionQueryIsPending)
	);
}

function resolveExpectedServiceVersion(input: {
	latestProductionVersion: string | null;
	selectedExecutionTarget:
		| LocalRuntimesResponse["localRuntimes"][number]["executionTargets"][number]
		| null;
}): string | null {
	if (input.selectedExecutionTarget === null) {
		return null;
	}
	if (input.selectedExecutionTarget.userFacingCommand === "openmeld") {
		return input.latestProductionVersion;
	}
	if (
		input.selectedExecutionTarget.userFacingCommand === "openmeld-dev" ||
		input.selectedExecutionTarget.userFacingCommand === "openmeld-canary"
	) {
		return readBundledOpenMeldCliRelease().version;
	}
	return null;
}

function resolveOtherLocalRuntimes(input: {
	currentComputer: LocalRuntimeComputer | null;
	localRuntimes: LocalRuntimesResponse | undefined;
}): LocalRuntimeComputer[] {
	if (!input.localRuntimes) {
		return [];
	}
	return input.localRuntimes.localRuntimes.filter(
		(device) => device.deviceId !== input.currentComputer?.deviceId
	);
}

function useGatewayLoadController(): {
	gatewayLoadState: GatewayLoadState;
	loadGatewayUrl: () => Promise<string>;
} {
	const [gatewayLoadState, setGatewayLoadState] = useState<GatewayLoadState>({
		errorMessage: null,
		status: "idle",
		value: null,
	});
	const gatewayLoadPromiseRef = useRef<Promise<string> | null>(null);

	const loadGatewayUrl = async (): Promise<string> => {
		if (gatewayLoadState.status === "ready") {
			return gatewayLoadState.value;
		}
		if (gatewayLoadPromiseRef.current) {
			return await gatewayLoadPromiseRef.current;
		}

		setGatewayLoadState({
			errorMessage: null,
			status: "loading",
			value: null,
		});
		const loadPromise = readStartGatewayUrl()
			.then((gatewayUrl) => {
				setGatewayLoadState({
					errorMessage: null,
					status: "ready",
					value: gatewayUrl,
				});
				return gatewayUrl;
			})
			.catch((error) => {
				const errorMessage =
					error instanceof Error
						? error.message
						: "OpenMeld could not load the current gateway URL.";
				setGatewayLoadState({
					errorMessage,
					status: "error",
					value: null,
				});
				throw error;
			})
			.finally(() => {
				gatewayLoadPromiseRef.current = null;
			});

		gatewayLoadPromiseRef.current = loadPromise;
		return await loadPromise;
	};

	return { gatewayLoadState, loadGatewayUrl };
}

function resolveAgentExecutionReadinessTargetRuntime(input: {
	currentDeviceTarget: CurrentDeviceTargetResponse | undefined;
	scope: AgentExecutionReadinessScope | undefined;
}): AgentExecutionReadinessTargetRuntime | undefined {
	if (input.scope === "bound_runtime") {
		return undefined;
	}
	return resolveCurrentLocalRuntimeTargetRuntime(input.currentDeviceTarget);
}

function refreshAgentReadinessSharedCachesForOrganization(input: {
	organizationId: string | null;
	queryClient: QueryClient;
	storageScope: string;
}): Promise<void> {
	if (!input.organizationId) {
		return Promise.resolve();
	}
	return refreshWebAgentReadinessSharedCaches({
		organizationId: input.organizationId,
		queryClient: input.queryClient,
		storageScope: input.storageScope,
	});
}

function useLocalRuntimeActions(input: {
	agentExecutionReadinessScope: AgentExecutionReadinessScope | undefined;
	currentCompletedPrepareSessionPointer: PrepareSessionPointer | null;
	currentPrepareSessionPointer: PrepareSessionPointer | null;
	deviceId: string | null;
	queryClient: QueryClient;
	organizationId: string | null;
	sessionExpiredError: unknown | null;
	setSessionExpiredError: (error: unknown) => void;
	shouldLoadAgentExecutionReadiness: boolean;
	shouldLoadAgentProfiles: boolean;
	shouldLoadProductionCliRelease: boolean;
	shouldLoadSetupState: boolean;
	storageScope: string;
}) {
	const forgetThisComputer = async () => {
		const response = await forgetCurrentComputer();
		input.queryClient.setQueryData(
			startQueryKeys.currentDeviceTarget(input.storageScope),
			response.currentDeviceTarget
		);
		await input.queryClient.invalidateQueries({
			queryKey: startQueryKeys.localRuntimes(input.storageScope),
		});
		if (input.deviceId !== null) {
			await invalidateSetupStateQueries({
				currentCompletedPrepareSessionPointer:
					input.currentCompletedPrepareSessionPointer,
				currentPrepareSessionPointer: input.currentPrepareSessionPointer,
				queryClient: input.queryClient,
				storageScope: input.storageScope,
			});
		}
	};

	const forgetComputer = async (target: { deviceId: string }) => {
		const response = await forgetLocalRuntime(target);
		input.queryClient.setQueryData(
			startQueryKeys.currentDeviceTarget(input.storageScope),
			response.currentDeviceTarget
		);
		await input.queryClient.invalidateQueries({
			queryKey: startQueryKeys.localRuntimes(input.storageScope),
		});
		await invalidateSetupStateQueries({
			currentCompletedPrepareSessionPointer:
				input.currentCompletedPrepareSessionPointer,
			currentPrepareSessionPointer: input.currentPrepareSessionPointer,
			queryClient: input.queryClient,
			storageScope: input.storageScope,
		});
	};

	const setComputerDisplayName = async (target: {
		deviceId: string;
		displayName: string | null;
	}) => {
		await setLocalRuntimeDisplayName(target);
		await input.queryClient.invalidateQueries({
			queryKey: startQueryKeys.localRuntimes(input.storageScope),
		});
	};

	const setLocalAgentEnabled = async (
		target: PeopleComputerTarget & {
			agentId: string;
			enabled: boolean;
		}
	) => {
		await setPeopleComputerLocalAgentEnabled(target);
		await Promise.all([
			input.queryClient.invalidateQueries({
				queryKey: startQueryKeys.localRuntimes(input.storageScope),
			}),
			input.queryClient.invalidateQueries({
				queryKey: startQueryKeys.currentLocalRuntimeReplyReadiness(
					input.storageScope
				),
			}),
			refreshAgentReadinessSharedCachesForOrganization({
				organizationId: input.organizationId,
				queryClient: input.queryClient,
				storageScope: input.storageScope,
			}),
		]);
	};

	const refreshLocalAgentCatalog = async (target: PeopleComputerTarget) => {
		await refreshPeopleComputerLocalAgentCatalog(target);
		await Promise.all([
			input.queryClient.invalidateQueries({
				queryKey: startQueryKeys.localRuntimes(input.storageScope),
			}),
			input.queryClient.invalidateQueries({
				queryKey: startQueryKeys.currentLocalRuntimeReplyReadiness(
					input.storageScope
				),
			}),
			refreshAgentReadinessSharedCachesForOrganization({
				organizationId: input.organizationId,
				queryClient: input.queryClient,
				storageScope: input.storageScope,
			}),
		]);
	};

	const refreshAll = async () => {
		await refreshLocalAgentRecoveryController(input);
	};

	return {
		forgetComputer,
		forgetThisComputer,
		refreshLocalAgentCatalog,
		refreshAll,
		setLocalAgentEnabled,
		setComputerDisplayName,
	};
}

async function invalidateSetupStateQueries(input: {
	currentCompletedPrepareSessionPointer: PrepareSessionPointer | null;
	currentPrepareSessionPointer: PrepareSessionPointer | null;
	queryClient: QueryClient;
	storageScope: string;
}): Promise<void> {
	const prepareSessionIds = new Set<string>();
	if (input.currentPrepareSessionPointer !== null) {
		prepareSessionIds.add(input.currentPrepareSessionPointer.prepareSessionId);
	}
	if (input.currentCompletedPrepareSessionPointer !== null) {
		prepareSessionIds.add(
			input.currentCompletedPrepareSessionPointer.prepareSessionId
		);
	}
	await Promise.all(
		[...prepareSessionIds].map((prepareSessionId) =>
			input.queryClient.invalidateQueries({
				queryKey: startQueryKeys.prepareSession(
					input.storageScope,
					prepareSessionId
				),
			})
		)
	);
}

function resolveStartLocalPreparationState(input: {
	currentDeviceTarget: CurrentDeviceTargetResponse | undefined;
	localAgentCatalogEntries:
		| LocalRuntimesResponse["localRuntimes"][number]["executionTargets"][number]["localAgentCatalog"]["entries"]
		| null;
	shouldLoadSetupState: boolean;
}): BringAgentsSetupState {
	if (!input.shouldLoadSetupState) {
		return { kind: "none" };
	}
	return resolveBringAgentsSetupState({
		currentDeviceTarget: input.currentDeviceTarget ?? {
			availability: "missing",
		},
		localAgentCatalogEntries: input.localAgentCatalogEntries,
	});
}

function resolveBlockingErrorMessage(input: {
	agentProfilesError: { message: string } | null;
	agentProfilesIsError: boolean;
	currentDeviceTargetError: { message: string } | null;
	currentDeviceTargetIsError: boolean;
	localRuntimesError: { message: string } | null;
	localRuntimesIsError: boolean;
	sessionExpiredState: ReturnType<typeof toSessionExpiredState>;
	shouldLoadAgentProfiles: boolean;
}): string | null {
	if (input.sessionExpiredState) {
		return input.sessionExpiredState.message;
	}
	if (input.currentDeviceTargetIsError) {
		return (
			input.currentDeviceTargetError?.message ??
			"OpenMeld could not load this computer."
		);
	}
	if (input.localRuntimesIsError) {
		return (
			input.localRuntimesError?.message ??
			"OpenMeld could not load local runtimes."
		);
	}
	if (input.shouldLoadAgentProfiles && input.agentProfilesIsError) {
		return (
			input.agentProfilesError?.message ??
			"OpenMeld could not load agent profiles."
		);
	}
	return null;
}

async function refreshLocalAgentRecoveryController(input: {
	agentExecutionReadinessScope: AgentExecutionReadinessScope | undefined;
	currentCompletedPrepareSessionPointer: PrepareSessionPointer | null;
	currentPrepareSessionPointer: PrepareSessionPointer | null;
	queryClient: QueryClient;
	organizationId: string | null;
	sessionExpiredError: unknown | null;
	setSessionExpiredError: (error: unknown) => void;
	shouldLoadAgentExecutionReadiness: boolean;
	shouldLoadAgentProfiles: boolean;
	shouldLoadProductionCliRelease: boolean;
	shouldLoadSetupState: boolean;
	storageScope: string;
}): Promise<void> {
	if (input.sessionExpiredError !== null) {
		return;
	}

	try {
		const currentDeviceTarget = await fetchLocalRuntimeRefreshBase(input);
		const refreshedDeviceId =
			currentDeviceTarget.availability === "resolved"
				? currentDeviceTarget.deviceId
				: null;
		const readinessRefresh = fetchAgentExecutionReadinessRefresh({
			...input,
			currentDeviceTarget,
			refreshedDeviceId,
		});

		if (refreshedDeviceId === null) {
			await readinessRefresh;
			return;
		}

		await Promise.all([
			...buildSetupStateRefreshQueries({
				...input,
			}),
			readinessRefresh,
		]);
	} catch (error) {
		if (isSessionExpiredError(error)) {
			input.setSessionExpiredError(error);
		}
		throw error;
	}
}

async function fetchLocalRuntimeRefreshBase(input: {
	queryClient: QueryClient;
	storageScope: string;
}): Promise<CurrentDeviceTargetResponse> {
	const [currentDeviceTarget] = await Promise.all([
		input.queryClient.fetchQuery(
			currentDeviceTargetQueryOptions({
				enabled: true,
				storageScope: input.storageScope,
			})
		),
		input.queryClient.fetchQuery(
			localRuntimesQueryOptions({
				enabled: true,
				storageScope: input.storageScope,
			})
		),
		input.queryClient.fetchQuery(
			currentLocalRuntimeReplyReadinessQueryOptions({
				enabled: true,
				storageScope: input.storageScope,
			})
		),
	]);
	return currentDeviceTarget;
}

function fetchAgentExecutionReadinessRefresh(input: {
	agentExecutionReadinessScope: AgentExecutionReadinessScope | undefined;
	currentDeviceTarget: CurrentDeviceTargetResponse;
	queryClient: QueryClient;
	organizationId: string | null;
	refreshedDeviceId: string | null;
	shouldLoadAgentExecutionReadiness: boolean;
	shouldLoadAgentProfiles: boolean;
	storageScope: string;
}): Promise<unknown> {
	if (!input.shouldLoadAgentProfiles) {
		return Promise.resolve(null);
	}

	return input.queryClient
		.fetchQuery(
			startProfilesQueryOptions({
				enabled: true,
				storageScope: input.storageScope,
			})
		)
		.then(async (refreshedProfiles) => {
			if (!input.shouldLoadAgentExecutionReadiness) {
				return null;
			}

			const refreshedAgentProfileIds = refreshedProfiles
				.filter(isOrdinaryActiveAgentProfile)
				.map((profile) => profile.openMeldProfileId);
			if (refreshedAgentProfileIds.length === 0) {
				return null;
			}

			const refreshedAgentProfileIdBatches =
				chunkAgentExecutionReadinessProfileIds(
					refreshedAgentProfileIds,
					AGENT_EXECUTION_READINESS_UI_BATCH_SIZE
				);
			const organizationId = input.organizationId;
			if (!organizationId) {
				return null;
			}
			await refreshWebAgentReadinessSharedCaches({
				organizationId,
				queryClient: input.queryClient,
				storageScope: input.storageScope,
			});
			return Promise.all(
				refreshedAgentProfileIdBatches.map((batchProfileIds) =>
					input.queryClient.fetchQuery(
						agentExecutionReadinessBatchQueryOptions({
							agentProfileIds: batchProfileIds,
							enabled: true,
							organizationId,
							storageScope: input.storageScope,
							targetRuntime: resolveAgentExecutionReadinessTargetRuntime({
								currentDeviceTarget: input.currentDeviceTarget,
								scope: input.agentExecutionReadinessScope,
							}),
						})
					)
				)
			);
		});
}

function buildSetupStateRefreshQueries(input: {
	currentCompletedPrepareSessionPointer: PrepareSessionPointer | null;
	currentPrepareSessionPointer: PrepareSessionPointer | null;
	queryClient: QueryClient;
	shouldLoadProductionCliRelease: boolean;
	shouldLoadSetupState: boolean;
	storageScope: string;
}): Promise<unknown>[] {
	const queries: Promise<unknown>[] = [];
	if (input.shouldLoadProductionCliRelease) {
		queries.push(
			input.queryClient.fetchQuery(
				openMeldCliLatestReleaseQueryOptions({ enabled: true })
			)
		);
	}
	if (!input.shouldLoadSetupState) {
		return queries;
	}

	if (input.currentPrepareSessionPointer) {
		queries.push(
			input.queryClient.fetchQuery(
				prepareSessionQueryOptions({
					enabled: true,
					prepareSessionId: input.currentPrepareSessionPointer.prepareSessionId,
					storageScope: input.storageScope,
				})
			)
		);
	}
	if (input.currentCompletedPrepareSessionPointer) {
		queries.push(
			input.queryClient.fetchQuery(
				prepareSessionQueryOptions({
					enabled: true,
					prepareSessionId:
						input.currentCompletedPrepareSessionPointer.prepareSessionId,
					storageScope: input.storageScope,
				})
			)
		);
	}
	return queries;
}

export function resolveAgentExecutionReadinessState(input: {
	agentProfiles: readonly { openMeldProfileId: string }[];
	queryBatches: readonly {
		profileIds: readonly string[];
		query:
			| {
					data?: { items: readonly GetAgentExecutionReadinessResponse[] };
					error: { message: string } | null;
					fetchStatus?: "fetching" | "paused" | "idle";
					isError: boolean;
					isPending: boolean;
			  }
			| undefined;
	}[];
}) {
	const byProfileId = new Map<string, GetAgentExecutionReadinessResponse>();
	const errorByProfileId = new Map<string, string>();
	const pendingProfileIds = new Set<string>();
	const profileIds = new Set(
		input.agentProfiles.map((profile) => profile.openMeldProfileId)
	);

	for (const batch of input.queryBatches) {
		const query = batch.query;
		const readinessByProfileId = new Map(
			(query?.data?.items ?? []).map((item) => [item.agentProfileId, item])
		);
		for (const profileId of batch.profileIds) {
			if (!profileIds.has(profileId)) {
				continue;
			}
			const readiness = readinessByProfileId.get(profileId);
			if (readiness) {
				byProfileId.set(profileId, readiness);
			}
			if (query?.isError) {
				errorByProfileId.set(
					profileId,
					query.error?.message ?? "OpenMeld could not load agent readiness."
				);
			}
			if (
				query?.fetchStatus === "fetching" &&
				!readiness &&
				input.agentProfiles.length > 0
			) {
				pendingProfileIds.add(profileId);
			}
		}
	}

	return {
		byProfileId,
		errorByProfileId,
		pendingProfileIds,
	};
}

function resolveCompletedPrepareSessionSnapshot(input: {
	deviceId: string | null;
	runtimeLane: DaemonServiceLane | null;
	selectedHumanProfileId: string | null;
	snapshot: PrepareSessionSnapshot | null;
}): PrepareSessionSnapshot | null {
	if (
		input.snapshot === null ||
		input.snapshot.lifecycleStatus !== "completed" ||
		input.deviceId === null ||
		input.runtimeLane === null ||
		input.selectedHumanProfileId === null ||
		input.snapshot.humanProfileId !== input.selectedHumanProfileId ||
		input.snapshot.deviceId !== input.deviceId ||
		input.snapshot.runtimeLane !== input.runtimeLane
	) {
		return null;
	}
	return input.snapshot;
}

function resolveReadyBuiltinLocalAgentIdsFromExecutionTarget(
	executionTarget: {
		capabilities: readonly {
			agentControllerRef: string;
			status: string;
		}[];
	} | null
): string[] {
	if (executionTarget === null) {
		return [];
	}

	const localAgentIds: string[] = [];
	for (const capability of executionTarget.capabilities) {
		if (capability.status !== "ready") {
			continue;
		}
		const parsed = parseAgentControllerRef(capability.agentControllerRef);
		if (parsed?.kind !== "builtin") {
			continue;
		}
		if (!localAgentIds.includes(parsed.id)) {
			localAgentIds.push(parsed.id);
		}
	}
	return localAgentIds;
}

function findSessionExpiredError(errors: readonly unknown[]): unknown | null {
	return errors.find((error) => isSessionExpiredError(error)) ?? null;
}
