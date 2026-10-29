import {
	createComputerPowerApi,
	toStructuredApiClientFailure,
} from "@openmeld/api-client";
import type {
	ComputerPowerRequest,
	ComputerPowerState,
	PeopleComputerConnection,
	PeopleComputersResponse,
	PeopleComputerTarget,
} from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import { SettingsRow } from "@openmeld/ui/components/settings-row";
import { Switch } from "@openmeld/ui/components/switch";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { createUnscopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";
import { localRuntimesQueryOptions } from "#/query/connect/local-runtimes";

export function ComputerPowerSettings({
	target,
	storageScope,
}: {
	target: PeopleComputerTarget | null;
	storageScope: string;
}) {
	const client = useQueryClient();
	const queryKey = [
		"computer-power",
		storageScope,
		target?.deviceId,
		target?.runtimeLane,
	];
	const targetKey = JSON.stringify(queryKey);
	const inventory = useQuery(
		localRuntimesQueryOptions({ enabled: target !== null, storageScope })
	);
	const connection = selectComputerPowerConnection(
		inventory.isError ? undefined : inventory.data?.peopleComputers,
		target
	);
	const selectedSession = connection.session;
	const [disconnectedConnection, setDisconnectedConnection] = useState<{
		targetKey: string;
		lastHeartbeatMs: number;
	} | null>(null);
	// A refreshed inventory timestamp is not reconnection evidence. Resume only
	// after this Service has supplied a newer heartbeat, or the user retries explicitly.
	const canRead =
		!!selectedSession &&
		!(
			disconnectedConnection?.targetKey === targetKey &&
			selectedSession.lastHeartbeatMs <= disconnectedConnection.lastHeartbeatMs
		);
	const request = async (value: ComputerPowerRequest) => {
		if (!(target && selectedSession)) {
			throw new Error("Reconnect this computer to manage sleep prevention.");
		}
		try {
			return await createComputerPowerApi(
				createUnscopedWebOpenMeldApiFoundation()
			)(target, value);
		} catch (error) {
			const failure = toStructuredApiClientFailure(error);
			if (failure.upstreamCode === "computer.target_disconnected") {
				setDisconnectedConnection({
					targetKey,
					lastHeartbeatMs: selectedSession.lastHeartbeatMs,
				});
			}
			throw failure;
		}
	};
	const query = useQuery({
		queryKey,
		queryFn: () => request({ operation: "read" }),
		enabled: canRead,
		retry: false,
		staleTime: 0,
		refetchOnMount: "always",
		refetchOnWindowFocus: "always",
		refetchInterval: 5000,
	});
	const mutation = useMutation({
		mutationFn: request,
		onMutate: async () => {
			await client.cancelQueries({ queryKey });
		},
		onSuccess: (value) => client.setQueryData(queryKey, value),
		onSettled: (_value, error) => {
			if (
				toStructuredApiClientFailure(error).upstreamCode ===
				"computer.target_disconnected"
			) {
				return;
			}
			return client.invalidateQueries({ queryKey });
		},
	});
	useEffect(() => {
		if (
			canRead &&
			query.isSuccess &&
			!query.isFetching &&
			toStructuredApiClientFailure(mutation.error).upstreamCode ===
				"computer.target_disconnected"
		) {
			mutation.reset();
		}
	}, [
		canRead,
		query.isSuccess,
		query.isFetching,
		mutation.error,
		mutation.reset,
	]);
	const value = query.data;
	const failure = mutation.error ?? query.error ?? inventory.error;
	const message = failure ? failure.message : value?.problem;
	const available = canRead && !query.isError && value?.supported === true;
	const checkingConnection = target !== null && inventory.isPending;
	const statusText = powerStatusText(connection.status, available, value);
	return (
		<div className="scroll-mt-16 py-3" id="computer-power">
			<SettingsRow
				control={
					available ? (
						<Switch
							aria-label="Prevent sleep during tasks"
							checked={value.enabled}
							disabled={mutation.isPending || query.isFetching}
							onCheckedChange={(enabled) =>
								mutation.mutate({
									operation: "update",
									enabled,
									expectedRevision: value.revision,
								})
							}
						/>
					) : (
						<span className="text-muted-foreground text-xs">
							{checkingConnection || (canRead && query.isPending)
								? "Loading…"
								: "Unavailable"}
						</span>
					)
				}
				description="Keep this computer awake during local tasks. The screen can turn off."
				label="Prevent sleep during tasks"
			/>
			{statusText ? (
				<output className="mt-2 block text-muted-foreground text-sm">
					{statusText}
				</output>
			) : null}
			{message ? (
				<div className="mt-2 flex items-center gap-3">
					<p className="text-destructive text-sm" role="alert">
						{message}
					</p>
					<Button
						disabled={query.isFetching || mutation.isPending}
						onClick={() => {
							mutation.reset();
							if (selectedSession) {
								setDisconnectedConnection(null);
								query.refetch();
							} else {
								inventory.refetch();
							}
						}}
						size="sm"
						variant="outline"
					>
						Retry
					</Button>
				</div>
			) : null}
		</div>
	);
}

function selectComputerPowerConnection(
	inventory: PeopleComputersResponse | undefined,
	target: PeopleComputerTarget | null
) {
	const computer = target
		? inventory?.computers.find(
				(entry) =>
					entry.deviceId === target.deviceId ||
					entry.legacyDeviceIds?.includes(target.deviceId) === true
			)
		: undefined;
	const session =
		computer?.connection.status === "connected"
			? computer.connection.sessions.find(
					(entry) =>
						entry.deviceId === target?.deviceId &&
						entry.runtimeLane === target.runtimeLane
				)
			: undefined;
	let status: PeopleComputerConnection["status"] = "unknown";
	if (computer && computer.connection.status !== "unknown") {
		status = session ? "connected" : "disconnected";
	}
	return { status, session };
}

function powerStatusText(
	connectionStatus: PeopleComputerConnection["status"],
	available: boolean,
	value?: ComputerPowerState
) {
	if (connectionStatus === "unknown") {
		return null;
	}
	if (connectionStatus === "disconnected") {
		return "Reconnect this computer to manage sleep prevention.";
	}
	if (value?.supported === false) {
		return "Sleep prevention is not supported on this operating system.";
	}
	if (!(available && value)) {
		return null;
	}
	return value.active ? "Keeping computer awake" : null;
}
