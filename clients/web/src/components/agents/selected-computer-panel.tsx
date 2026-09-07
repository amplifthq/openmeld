"use client";

import type {
	CurrentLocalRuntimeReplyReadinessResponse,
	LocalRuntimeComputer,
	PeopleComputerTarget,
} from "@openmeld/schemas/types";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
} from "@openmeld/ui/fluid/select";
import { type QueryClient, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { useLocalAgentRecoveryController } from "#/components/agents/use-local-agent-recovery-controller";
import { mapCurrentLocalRuntimeReplyReadinessQueryState } from "#/lib/connect/current-local-runtime-readiness";
import { refreshWebAgentReadinessSharedCaches } from "#/query/agents/execution-readiness";
import { currentLocalRuntimeReplyReadinessQueryOptions } from "#/query/connect/local-runtimes";
import { formatRuntimeLane } from "./agents-page-formatters";
import { LocalAgentsCard } from "./agents-page-local-agents";
import { OpenMeldServiceCard } from "./agents-page-openmeld-service";
import { ComputerFileAccessCard } from "./computer-file-access-card";

type LocalAgentRecoveryController = ReturnType<
	typeof useLocalAgentRecoveryController
>;
const SETUP_COMPLETE_REFRESH_GRACE_MS = 12_000;

export function SelectedComputerPanel(input: {
	computer: LocalRuntimeComputer;
	focusFileAccess: boolean;
	focusService: boolean;
	isReconcilingStatus: boolean;
	onFocusConsumed?: () => void;
	organizationId: string;
	queryClient: QueryClient;
	recovery: LocalAgentRecoveryController;
	setupCompleteRefreshPending: boolean;
}) {
	const [checkingComputerId, setCheckingComputerId] = useState<string | null>(
		null
	);
	const computerFacts =
		input.recovery.localRuntimesQuery.data?.peopleComputers.computers.find(
			(computer) => computer.deviceId === input.computer.deviceId
		);
	const [selectedEnvironmentKey, setSelectedEnvironmentKey] = useState<
		string | null
	>(null);
	const environments = [
		...new Map(
			[
				...(computerFacts?.connection.sessions ?? []),
				...input.computer.executionTargets,
			].map((entry) => [
				computerEnvironmentKey(entry),
				{ deviceId: entry.deviceId, runtimeLane: entry.runtimeLane },
			])
		).values(),
	];
	const target = selectComputerEnvironment(
		environments,
		selectedEnvironmentKey,
		computerFacts?.connection.sessions
	);
	const reportedTarget =
		input.computer.executionTargets.find(
			(entry) =>
				entry.deviceId === target?.deviceId &&
				entry.runtimeLane === target.runtimeLane
		) ?? null;
	const selectedSession = computerFacts?.connection.sessions.find(
		(entry) =>
			entry.deviceId === target?.deviceId &&
			entry.runtimeLane === target.runtimeLane
	);
	const selectedRecovery = {
		...input.recovery,
		selectedExecutionTarget: reportedTarget,
	};
	const selectedReadinessQuery = useQuery(
		currentLocalRuntimeReplyReadinessQueryOptions({
			storageScope: input.recovery.storageScope,
			enabled: target !== null,
			target: target
				? { deviceId: target.deviceId, runtimeLane: target.runtimeLane }
				: null,
			refetchIntervalMs: 10_000,
		}),
		input.queryClient
	);
	const effectiveReplyReadiness =
		mapCurrentLocalRuntimeReplyReadinessQueryState({
			isPending: target !== null && selectedReadinessQuery.isPending,
			readiness: selectedReadinessQuery.isError
				? null
				: selectedReadinessQuery.data,
		});
	const currentLocalRuntimeReplyReadiness = selectedReadinessQuery.isError
		? null
		: (selectedReadinessQuery.data ?? null);
	const canManageComputerFileAccess =
		selectedSession?.controls?.computerFileAccess?.readPolicy === true &&
		selectedSession.controls.computerFileAccess.updatePolicy === true;
	return (
		<div className="flex flex-col gap-4">
			{environments.length > 1 ? (
				<details className="max-w-sm space-y-3" open={target === null}>
					<summary className="cursor-pointer text-muted-foreground text-sm">
						{target ? "Connection details" : "Choose a connection"}
					</summary>
					<p className="font-medium text-sm">Environment</p>
					<Select
						onValueChange={setSelectedEnvironmentKey}
						value={target ? computerEnvironmentKey(target) : ""}
					>
						<SelectTrigger
							aria-label="Computer environment"
							placeholder="Choose an environment"
						/>
						<SelectContent>
							{environments.map((entry, index) => (
								<SelectItem
									index={index}
									key={computerEnvironmentKey(entry)}
									value={computerEnvironmentKey(entry)}
								>
									{computerEnvironmentLabel(entry, environments)}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<p className="text-muted-foreground text-xs">
						Status and actions apply to the selected environment.
					</p>
				</details>
			) : null}
			<OpenMeldServiceCard
				computer={input.computer}
				currentExpectedServiceVersion={
					input.recovery.expectedServiceVersion ?? null
				}
				currentLocalRuntimeReplyReadiness={currentLocalRuntimeReplyReadiness}
				focusService={input.focusService}
				hasSelectedEnvironment={target !== null}
				isReconcilingStatus={input.isReconcilingStatus}
				key={`service/${target ? computerEnvironmentKey(target) : input.computer.deviceId}`}
				onCheckingStatusChange={(checking) => {
					const deviceId = input.computer.deviceId;
					setCheckingComputerId((current) => {
						if (checking) {
							return deviceId;
						}
						return current === deviceId ? null : current;
					});
				}}
				onFocusConsumed={input.onFocusConsumed}
				organizationId={input.organizationId}
				queryClient={input.queryClient}
				recovery={selectedRecovery}
				replyReadiness={effectiveReplyReadiness}
				setupCompleteRefreshPending={input.setupCompleteRefreshPending}
			/>
			<LocalAgentsCard
				computer={input.computer}
				controlCapabilities={
					selectedSession?.controls?.localAgentControl ?? {
						refreshCatalog: false,
						setEnabled: false,
						setProfileWorkspace: false,
					}
				}
				controlTarget={target}
				hasSelectedEnvironment={target !== null}
				isReconcilingStatus={
					input.isReconcilingStatus ||
					input.setupCompleteRefreshPending ||
					checkingComputerId === input.computer.deviceId
				}
				key={`local-agents/${target ? computerEnvironmentKey(target) : input.computer.deviceId}`}
				recovery={selectedRecovery}
				replyReadiness={effectiveReplyReadiness}
			/>
			{target && canManageComputerFileAccess ? (
				<ComputerFileAccessCard
					canChooseFolders={
						selectedSession?.controls?.localFolderPicker?.selectFolders === true
					}
					canChooseProjects={
						selectedSession?.controls?.localProjectControl?.discoverProjects ===
						true
					}
					deviceId={target.deviceId}
					focusFileAccess={input.focusFileAccess}
					key={`file-access/${computerEnvironmentKey(target)}`}
					onFocusConsumed={input.onFocusConsumed}
					runtimeLane={target.runtimeLane}
					storageScope={input.recovery.storageScope}
				/>
			) : null}
		</div>
	);
}

function computerEnvironmentKey(target: PeopleComputerTarget) {
	return `${target.deviceId}/${target.runtimeLane}`;
}

function selectComputerEnvironment(
	environments: readonly PeopleComputerTarget[],
	selectedKey: string | null,
	liveConnections: readonly PeopleComputerTarget[] = []
): PeopleComputerTarget | null {
	const selected = environments.find(
		(entry) => computerEnvironmentKey(entry) === selectedKey
	);
	if (selectedKey !== null) {
		return selected ?? null;
	}
	// One live connection is an unambiguous management target, even when old
	// device registrations have left historical reports behind. Never use a
	// Binding preference or a historical ready report as connection evidence.
	if (liveConnections.length === 1) {
		const live = liveConnections[0];
		return (
			environments.find(
				(entry) =>
					entry.deviceId === live?.deviceId &&
					entry.runtimeLane === live.runtimeLane
			) ?? null
		);
	}
	return (environments.length === 1 ? environments[0] : null) ?? null;
}

function computerEnvironmentLabel(
	target: PeopleComputerTarget,
	environments: readonly PeopleComputerTarget[]
) {
	const label = formatRuntimeLane(target.runtimeLane);
	return environments.filter(
		(entry) => entry.runtimeLane === target.runtimeLane
	).length > 1
		? `${label} · ${target.deviceId.slice(-8)}`
		: label;
}

type SetupCompleteRefreshStatus = "idle" | "pending" | "ready" | "error";

export function useRefreshComputersAfterSetupComplete(input: {
	enabled: boolean;
	organizationId: string;
	queryClient: QueryClient;
	recovery: LocalAgentRecoveryController;
}): SetupCompleteRefreshStatus {
	const [status, setStatus] = useState<SetupCompleteRefreshStatus>(() =>
		input.enabled ? "pending" : "idle"
	);
	const hasStartedRef = useRef(false);
	const isMountedRef = useRef(true);
	const timeoutIdRef = useRef<number | null>(null);
	const queryClientRef = useRef(input.queryClient);
	const refreshAllRef = useRef(input.recovery.refreshAll);
	const storageScopeRef = useRef(input.recovery.storageScope);
	const organizationIdRef = useRef(input.organizationId);
	const serviceUpdateRequired = isCurrentLocalRuntimeServiceUpdateRequired(
		input.recovery.currentLocalRuntimeReplyReadinessQuery.data ?? null
	);

	useEffect(() => {
		queryClientRef.current = input.queryClient;
		refreshAllRef.current = input.recovery.refreshAll;
		organizationIdRef.current = input.organizationId;
		storageScopeRef.current = input.recovery.storageScope;
	}, [
		input.queryClient,
		input.organizationId,
		input.recovery.refreshAll,
		input.recovery.storageScope,
	]);

	useEffect(() => {
		return () => {
			isMountedRef.current = false;
			if (timeoutIdRef.current !== null) {
				window.clearTimeout(timeoutIdRef.current);
			}
		};
	}, []);

	useEffect(() => {
		if (!input.enabled || hasStartedRef.current) {
			return;
		}

		hasStartedRef.current = true;
		setStatus("pending");
		timeoutIdRef.current = window.setTimeout(() => {
			if (!isMountedRef.current) {
				return;
			}
			setStatus((current) => (current === "pending" ? "ready" : current));
		}, SETUP_COMPLETE_REFRESH_GRACE_MS);

		refreshWebAgentReadinessSharedCaches({
			organizationId: organizationIdRef.current,
			queryClient: queryClientRef.current,
			storageScope: storageScopeRef.current,
		})
			.then(async () => {
				await refreshAllRef.current();
			})
			.catch((error: unknown) => {
				console.error(
					"Failed to refresh Computers after setup completed.",
					error
				);
				if (isMountedRef.current) {
					setStatus("error");
				}
			});
	}, [input.enabled]);

	useEffect(() => {
		if (status !== "pending") {
			return;
		}
		if (serviceUpdateRequired) {
			return;
		}
		setStatus("ready");
	}, [serviceUpdateRequired, status]);

	return status;
}

function isCurrentLocalRuntimeServiceUpdateRequired(
	readiness: CurrentLocalRuntimeReplyReadinessResponse | null
): boolean {
	return (
		readiness?.localComponents.service.wakeBlocked === true ||
		readiness?.primaryBlocker === "service_update_required"
	);
}
