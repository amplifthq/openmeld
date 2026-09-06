"use client";

import type {
	CurrentDeviceTargetResponse,
	DaemonServiceLane,
} from "@openmeld/schemas/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { readCompletedPrepareSessionPointer } from "#/components/connect/prepare-session-pointer";
import { selectPeopleComputerTarget } from "#/lib/connect/people-computer-selection";
import { currentDeviceTargetQueryOptions } from "#/query/connect/current-device-target";
import {
	currentLocalRuntimeReplyReadinessQueryOptions,
	LOCAL_RUNTIME_CATALOG_READY_RECONCILE_DELAY_MS,
	localRuntimesQueryOptions,
	resolveLocalRuntimeCatalogReadyReconcileKey,
} from "#/query/connect/local-runtimes";
import { startQueryKeys } from "#/query/query-keys";
import { useRefreshReplyReadinessOnRefocus } from "./use-refresh-reply-readiness-on-refocus";

export function useLocalRuntimeQueries(input: {
	currentLocalRuntimeReplyReadinessRefetchIntervalMs?: false | number;
	storageScope: string;
	selectedHumanProfileId?: string | null;
	selection?: "browser" | "routing";
}) {
	const queryClient = useQueryClient();
	const lastReadyCatalogReconcileKeyRef = useRef<string | null>(null);
	const lastComputerEvidenceRef = useRef<string | null>(null);
	const currentDeviceTargetQuery = useQuery(
		currentDeviceTargetQueryOptions({
			enabled: true,
			storageScope: input.storageScope,
		})
	);
	const localRuntimesQuery = useQuery(
		localRuntimesQueryOptions({
			enabled: true,
			storageScope: input.storageScope,
		})
	);
	// A completed handoff selects a computer for this browser/account. It does
	// not prove the terminal ran on the same physical machine as the browser.
	const selectedTarget = selectPeopleComputerTarget({
		inventory: localRuntimesQuery.data?.peopleComputers,
		routingPreference: currentDeviceTargetQuery.data,
		completedSetup: readCompletedPrepareSessionPointer(),
		selectedHumanProfileId: input.selectedHumanProfileId,
		selection: input.selection,
	});
	const isReplyReadinessEnabled = selectedTarget !== null;
	const currentLocalRuntimeReplyReadinessQuery = useQuery(
		currentLocalRuntimeReplyReadinessQueryOptions({
			enabled: isReplyReadinessEnabled,
			target: selectedTarget,
			refetchIntervalMs:
				input.currentLocalRuntimeReplyReadinessRefetchIntervalMs,
			storageScope: input.storageScope,
		})
	);
	const selectedComputer = selectedTarget
		? localRuntimesQuery.data?.peopleComputers.computers.find(
				(computer) =>
					computer.deviceId === selectedTarget.deviceId ||
					computer.legacyDeviceIds?.includes(selectedTarget.deviceId) === true
			)
		: null;
	const currentEvidenceKey =
		selectedComputer && selectedTarget
			? JSON.stringify({
					deviceId: selectedTarget.deviceId,
					lane: selectedTarget.runtimeLane,
					connection: selectedComputer.connection.status,
					reasons: selectedComputer.connection.reasonCodes,
					sessions: selectedComputer.connection.sessions.map(
						({ lastHeartbeatMs: _heartbeat, ...session }) => session
					),
					targets: selectedComputer.executionTargets.map((target) => ({
						deviceId: target.deviceId,
						lane: target.runtimeLane,
						observedAt: target.lastObservedAtMs,
						status: target.status,
					})),
				})
			: null;
	useEffect(() => {
		const previous = lastComputerEvidenceRef.current;
		lastComputerEvidenceRef.current = currentEvidenceKey;
		if (!(previous && currentEvidenceKey) || previous === currentEvidenceKey) {
			return;
		}
		// Inventory invalidation changes evidence, never readiness itself. Re-read
		// Core policy for the same explicit target when its connection/report changes.
		queryClient
			.invalidateQueries({
				queryKey: startQueryKeys.currentLocalRuntimeReplyReadiness(
					input.storageScope
				),
			})
			.catch((error: unknown) => {
				console.warn("Could not refresh selected computer readiness.", error);
			});
	}, [currentEvidenceKey, input.storageScope, queryClient]);
	// Reply readiness stops polling once it settles on "Connected", so reconcile
	// it against Core when the tab regains visibility — otherwise a service that
	// dies while the tab is idle leaves a stale "Connected" indicator behind.
	useRefreshReplyReadinessOnRefocus({
		enabled: isReplyReadinessEnabled,
		storageScope: input.storageScope,
	});
	useEffect(() => {
		const reconcileKey = resolveLocalRuntimeCatalogReadyReconcileKey({
			localRuntimes: localRuntimesQuery.data,
			readiness: currentLocalRuntimeReplyReadinessQuery.data,
		});
		if (
			!reconcileKey ||
			lastReadyCatalogReconcileKeyRef.current === reconcileKey
		) {
			return;
		}
		lastReadyCatalogReconcileKeyRef.current = reconcileKey;
		const timeoutId = window.setTimeout(() => {
			queryClient
				.invalidateQueries({
					queryKey: startQueryKeys.localRuntimes(input.storageScope),
				})
				.catch((error: unknown) => {
					console.warn(
						"[openmeld.web.local_runtime_catalog_reconcile_failed]",
						{
							error: error instanceof Error ? error.message : String(error),
							reconcileKey,
						}
					);
				});
		}, LOCAL_RUNTIME_CATALOG_READY_RECONCILE_DELAY_MS);
		return () => {
			window.clearTimeout(timeoutId);
		};
	}, [
		currentLocalRuntimeReplyReadinessQuery.data,
		input.storageScope,
		localRuntimesQuery.data,
		queryClient,
	]);
	const { deviceId, runtimeLane } = resolveCurrentDeviceTargetParts(
		currentDeviceTargetQuery.data
	);

	return {
		currentDeviceTargetQuery,
		currentLocalRuntimeReplyReadinessQuery,
		deviceId,
		localRuntimesQuery,
		runtimeLane,
	};
}

function resolveCurrentDeviceTargetParts(
	currentDeviceTarget: CurrentDeviceTargetResponse | undefined
): {
	deviceId: string | null;
	runtimeLane: DaemonServiceLane | null;
} {
	if (currentDeviceTarget?.availability !== "resolved") {
		return { deviceId: null, runtimeLane: null };
	}
	return {
		deviceId: currentDeviceTarget.deviceId,
		runtimeLane: currentDeviceTarget.runtimeLane ?? null,
	};
}
