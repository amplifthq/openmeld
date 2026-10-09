import { createSpacePreferencesApi } from "@openmeld/api-client";
import { Button } from "@openmeld/ui/components/button";
import { SettingsRow } from "@openmeld/ui/components/settings-row";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import { Switch } from "@openmeld/ui/components/switch";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { AppPageHeader } from "#/components/app/app-page-header";
import { createOrganizationScopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";
import { useAppOrganization } from "#/lib/organizations/organization-context";

export function SpacesSection() {
	const { currentOrganization, currentUserId } = useAppOrganization();
	const api = useMemo(
		() =>
			createSpacePreferencesApi(
				createOrganizationScopedWebOpenMeldApiFoundation({
					organizationId: currentOrganization.id,
				})
			),
		[currentOrganization.id]
	);
	const queryKey = ["space-preferences", currentUserId];
	const query = useQuery({ queryKey, queryFn: () => api.get() });
	const client = useQueryClient();
	const mutation = useMutation({
		mutationFn: (enabled: boolean) => api.update(enabled),
		onSuccess: async (data) => {
			client.setQueryData(queryKey, data);
			await client.invalidateQueries({ queryKey: ["spaces"] });
		},
	});
	const unavailable = query.isError || query.fetchStatus === "paused";
	const saveStatus = mutation.isPending ? "saving" : "idle";
	const status = unavailable || mutation.isError ? "error" : saveStatus;
	return (
		<>
			<AppPageHeader
				description="Choose how your messages start Agent work. Applies across your organizations."
				title="Spaces"
			/>
			<SettingsRow
				control={
					query.data ? (
						<Switch
							aria-label="Automatically wake the only Agent"
							checked={query.data.automaticWakeEnabled}
							disabled={unavailable || mutation.isPending}
							onCheckedChange={(value) => mutation.mutate(value)}
						/>
					) : (
						<Skeleton className="h-5 w-9 rounded-full" />
					)
				}
				description="When a Space or direct message has only you and one Agent, your messages ask that Agent to work without an @mention. Turn this off to wake the Agent only when you mention it."
				error={
					unavailable
						? "Couldn't load this preference."
						: mutation.error?.message
				}
				label="Automatically wake the only Agent"
				status={status}
			/>
			{unavailable || mutation.isError ? (
				<Button
					className="self-start"
					onClick={() =>
						unavailable
							? query.refetch()
							: mutation.mutate(mutation.variables ?? true)
					}
					size="sm"
					variant="outline"
				>
					Try again
				</Button>
			) : null}
		</>
	);
}
