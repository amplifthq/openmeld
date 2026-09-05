"use client";

import type {
	CurrentLocalRuntimeReplyReadinessResponse,
	LocalRuntimeComputer,
} from "@openmeld/schemas/types";
import type { QueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { useLocalAgentRecoveryController } from "#/components/agents/use-local-agent-recovery-controller";
import { refreshWebAgentReadinessSharedCaches } from "#/query/agents/execution-readiness";
import {
	isSelectedCurrentComputer,
	resolveEffectiveSelectedComputerReplyReadiness,
	resolveSelectedComputerReplyReadiness,
} from "./agents-page-computer";
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
	const isCurrentComputer = isSelectedCurrentComputer({
		computer: input.computer,
		recovery: input.recovery,
	});
	const replyReadiness = resolveSelectedComputerReplyReadiness({
		computer: input.computer,
		isCurrentComputer,
		recovery: input.recovery,
	});
	const hasAvailableAgentProfile = hasCurrentComputerAvailableAgentProfile(
		input.recovery
	);
	const hasPendingAgentProfileReadiness =
		hasCurrentComputerPendingAgentProfileReadiness(input.recovery);
	const effectiveReplyReadiness =
		resolveEffectiveSelectedComputerReplyReadiness({
			hasAvailableAgentProfile,
			hasPendingAgentProfileReadiness,
			replyReadiness,
		});
	const currentLocalRuntimeReplyReadiness =
		resolveSelectedCurrentLocalRuntimeReplyReadiness({
			isCurrentComputer,
			recovery: input.recovery,
		});
	const canManageComputerFileAccess =
		input.computer.computerFileAccess?.readPolicy === true &&
		input.computer.computerFileAccess.updatePolicy === true;
	return (
		<div className="flex flex-col gap-4">
			<OpenMeldServiceCard
				computer={input.computer}
				currentExpectedServiceVersion={
					input.recovery.expectedServiceVersion ?? null
				}
				currentLocalRuntimeReplyReadiness={currentLocalRuntimeReplyReadiness}
				focusService={input.focusService}
				isCurrentComputer={isCurrentComputer}
				isReconcilingStatus={input.isReconcilingStatus}
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
				recovery={input.recovery}
				replyReadiness={effectiveReplyReadiness}
				setupCompleteRefreshPending={input.setupCompleteRefreshPending}
			/>
			<LocalAgentsCard
				computer={input.computer}
				isCurrentComputer={isCurrentComputer}
				isReconcilingStatus={
					input.isReconcilingStatus ||
					input.setupCompleteRefreshPending ||
					checkingComputerId === input.computer.deviceId
				}
				recovery={input.recovery}
				replyReadiness={effectiveReplyReadiness}
			/>
			{isCurrentComputer && canManageComputerFileAccess ? (
				<ComputerFileAccessCard
					canChooseFolders={
						input.computer.localFolderPicker?.selectFolders === true
					}
					deviceId={input.computer.deviceId}
					focusFileAccess={input.focusFileAccess}
					onFocusConsumed={input.onFocusConsumed}
					storageScope={input.recovery.storageScope}
				/>
			) : null}
		</div>
	);
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

function hasCurrentComputerAvailableAgentProfile(
	recovery: LocalAgentRecoveryController
): boolean {
	return recovery.agentProfiles.some((profile) => {
		const readiness = recovery.agentExecutionReadinessByProfileId.get(
			profile.openMeldProfileId
		);
		if (!readiness) {
			return false;
		}
		return readiness.agentWakeAvailability.category === "available";
	});
}

function hasCurrentComputerPendingAgentProfileReadiness(
	recovery: LocalAgentRecoveryController
): boolean {
	return (
		recovery.agentProfilesQuery.isPending ||
		recovery.agentProfiles.some((profile) =>
			recovery.agentExecutionReadinessPendingProfileIds.has(
				profile.openMeldProfileId
			)
		)
	);
}

function resolveSelectedCurrentLocalRuntimeReplyReadiness(input: {
	isCurrentComputer: boolean;
	recovery: LocalAgentRecoveryController;
}): CurrentLocalRuntimeReplyReadinessResponse | null {
	if (!input.isCurrentComputer) {
		return null;
	}
	if (input.recovery.currentLocalRuntimeReplyReadinessQuery.isPending) {
		return null;
	}
	return input.recovery.currentLocalRuntimeReplyReadinessQuery.data ?? null;
}
