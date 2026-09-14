import { createReasoningStreamApi } from "@openmeld/api-client";
import { Button } from "@openmeld/ui/components/button";
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
	const mutation = useMutation({
		mutationFn: api.update,
		onSuccess: (data) => client.setQueryData(key, data),
	});
	return (
		<section className="rounded-md border border-border/70 bg-card px-5 py-4">
			<div className="flex items-start justify-between gap-4">
				<div className="flex flex-col gap-1">
					<label
						className="font-medium text-sm"
						htmlFor="reasoning-stream-enabled"
					>
						Stream local Agent reasoning
					</label>
					<p className="max-w-xl text-muted-foreground text-sm">
						Share thinking and reasoning from your local Agents live with people
						in the Space. OpenMeld does not save this text or stream the final
						reply. Applies across your organizations.
					</p>
				</div>
				<Switch
					checked={query.data?.enabled ?? false}
					disabled={!query.data || mutation.isPending || query.isError}
					id="reasoning-stream-enabled"
					onCheckedChange={(enabled) => mutation.mutate(enabled)}
				/>
			</div>
			{query.isPending ? (
				<p className="mt-2 text-muted-foreground text-sm">
					Loading preference…
				</p>
			) : null}
			{query.isError || mutation.isError ? (
				<div className="mt-2 flex items-center gap-2" role="alert">
					<p className="text-sm">
						Couldn’t {query.isError ? "load" : "save"} this preference.
					</p>
					<Button
						onClick={() =>
							query.isError
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
