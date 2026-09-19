import { createReasoningStreamApi } from "@openmeld/api-client";
import { Button } from "@openmeld/ui/components/button";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import { SkeletonRegion } from "@openmeld/ui/components/skeleton-content";
import { Switch } from "@openmeld/ui/components/switch";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { createOrganizationScopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";
import { useAppOrganization } from "#/lib/organizations/organization-context";

export function ReasoningStreamSetting() {
	const { currentOrganization, storageScope } = useAppOrganization();
	const client = useQueryClient();
	const key = ["reasoning-stream-preference", storageScope];
	const api = useMemo(
		() =>
			createReasoningStreamApi(
				createOrganizationScopedWebOpenMeldApiFoundation({
					organizationId: currentOrganization.id,
				})
			),
		[currentOrganization.id]
	);
	const query = useQuery({ queryKey: key, queryFn: api.get });
	const readUnavailable = query.isError || query.fetchStatus === "paused";
	const mutation = useMutation({
		mutationFn: api.update,
		onSuccess: (data) => client.setQueryData(key, data),
	});
	const missingControl = readUnavailable ? (
		<span className="text-muted-foreground text-xs">Unavailable</span>
	) : (
		<SkeletonRegion className="shrink-0" label="Loading reasoning preference">
			<Skeleton className="h-5 w-9 rounded-full" />
		</SkeletonRegion>
	);
	return (
		<section className="rounded-md border border-border/70 bg-card px-5 py-4">
			<div className="flex items-start justify-between gap-4">
				<div className="flex flex-col gap-1">
					<label
						className="font-medium text-sm"
						htmlFor="reasoning-stream-enabled"
						id="reasoning-stream-label"
					>
						Stream local Agent reasoning
					</label>
					<p className="max-w-xl text-muted-foreground text-sm">
						Share thinking and reasoning from your local Agents live with people
						in the Space. OpenMeld does not save this text or stream the final
						reply. Applies across your organizations.
					</p>
				</div>
				{query.data ? (
					<Switch
						aria-labelledby="reasoning-stream-label"
						checked={query.data.enabled}
						disabled={mutation.isPending || readUnavailable}
						id="reasoning-stream-enabled"
						onCheckedChange={(enabled) => mutation.mutate(enabled)}
					/>
				) : (
					missingControl
				)}
			</div>
			{readUnavailable || mutation.isError ? (
				<div className="mt-2 flex items-center gap-2" role="alert">
					<p className="text-sm">
						Couldn’t {readUnavailable ? "load" : "save"} this preference.
					</p>
					<Button
						onClick={() =>
							readUnavailable
								? query.refetch()
								: mutation.mutate(mutation.variables ?? false)
						}
						size="sm"
						variant="outline"
					>
						Try again
					</Button>
				</div>
			) : null}
		</section>
	);
}
