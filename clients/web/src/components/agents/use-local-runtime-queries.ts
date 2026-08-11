"use client";

import type {
	CurrentDeviceTargetResponse,
	DaemonServiceLane,
} from "@openmeld/schemas/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
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
}) {
	const queryClient = useQueryClient();
	const lastReadyCatalogReconcileKeyRef = useRef<string | null>(null);
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
	// Connectivity is a ServiceRuntime liveness fact, not a Binding fact: reply
	// readiness must be able to report a freshly connected computer even before
	// any Agent Profile is bound (when the Binding-derived current-device target
	// is still "missing"). Enable the query whenever the account has at least one
	// computer; the server answers liveness-first and returns "missing" only when
	// there is genuinely nothing connected.
	const hasLocalRuntimeComputer =
		(localRuntimesQuery.data?.localRuntimes.length ?? 0) > 0;
	const isReplyReadinessEnabled =
		currentDeviceTargetQuery.data?.availability === "resolved" ||
		hasLocalRuntimeComputer;
	const currentLocalRuntimeReplyReadinessQuery = useQuery(
		currentLocalRuntimeReplyReadinessQueryOptions({
			enabled: isReplyReadinessEnabled,
			refetchIntervalMs:
				input.currentLocalRuntimeReplyReadinessRefetchIntervalMs,
			storageScope: input.storageScope,
		})
	);
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
