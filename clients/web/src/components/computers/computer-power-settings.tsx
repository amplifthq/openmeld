import {
	createComputerPowerApi,
	toStructuredApiClientFailure,
} from "@openmeld/api-client";
import type {
	ComputerPowerRequest,
	ComputerPowerState,
	PeopleComputerTarget,
} from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import { SettingsRow } from "@openmeld/ui/components/settings-row";
import { SettingsSection } from "@openmeld/ui/components/settings-section";
import { Switch } from "@openmeld/ui/components/switch";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createUnscopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";

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
	const request = async (value: ComputerPowerRequest) => {
		if (!target) {
			throw new Error("Reconnect this computer to manage sleep prevention.");
		}
		try {
			return await createComputerPowerApi(
				createUnscopedWebOpenMeldApiFoundation()
			)(target, value);
		} catch (error) {
			throw toStructuredApiClientFailure(error);
		}
	};
	const query = useQuery({
		queryKey,
		queryFn: () => request({ operation: "read" }),
		enabled: target !== null,
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
		onSettled: () => client.invalidateQueries({ queryKey }),
	});
	const value = query.data;
	const failure = mutation.error ?? query.error;
	const message = failure ? failure.message : value?.problem;
	const available = !!target && !query.isError && value?.supported === true;
	return (
		<SettingsSection id="computer-power" title="Power">
			<SettingsRow
				control={
					available ? (
						<Switch
							aria-label="Prevent sleep while running tasks"
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
							{target && query.isPending ? "Loading…" : "Unavailable"}
						</span>
					)
				}
				description="Keep this computer awake while OpenMeld runs local Agent tasks. The screen can turn off. This works even after you quit the desktop app."
				label="Prevent sleep while running tasks"
			/>
			<output className="mt-2 block text-muted-foreground text-sm">
				{powerStatusText(target, available, value)}
			</output>
			{message ? (
				<div className="mt-2 flex items-center gap-3">
					<p className="text-destructive text-sm" role="alert">
						{message}
					</p>
					<Button
						disabled={query.isFetching || mutation.isPending}
						onClick={() => {
							mutation.reset();
							query.refetch();
						}}
						size="sm"
						variant="outline"
					>
						Retry
					</Button>
				</div>
			) : null}
			<p className="mt-2 text-muted-foreground text-xs">
				Closing the lid or putting the computer to sleep yourself can still
				pause tasks.
			</p>
		</SettingsSection>
	);
}

function powerStatusText(
	target: PeopleComputerTarget | null,
	available: boolean,
	value?: ComputerPowerState
) {
	if (!target) {
		return "Reconnect this computer to manage sleep prevention.";
	}
	if (value?.supported === false) {
		return "Sleep prevention is not supported on this operating system.";
	}
	if (!(available && value)) {
		return null;
	}
	if (value.problem) {
		return "Sleep prevention needs attention.";
	}
	if (value.active) {
		return "Preventing automatic sleep while local tasks run.";
	}
	if (value.enabled) {
		return "On. Waiting for local tasks.";
	}
	return "Off. Your computer follows its normal sleep settings.";
}
