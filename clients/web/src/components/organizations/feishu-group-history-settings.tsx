import {
	type FeishuHistoryGroupSetting,
	type FeishuHistoryGroupSettingResult,
	type FeishuHistoryGroups,
	feishuHistoryGroupSettingResultSchema,
	feishuHistoryGroupsSchema,
} from "@openmeld/schemas";
import { Button } from "@openmeld/ui/components/button";
import { Switch } from "@openmeld/ui/components/switch";
import {
	useInfiniteQuery,
	useMutation,
	useQueryClient,
} from "@tanstack/react-query";
import { useState } from "react";
import { AuthorizationLink } from "#/desktop/authorization-link";
import { createOrganizationScopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";

const route =
	"/v1/organizations/current/message-channels/feishu/history-groups";
export function FeishuGroupHistorySettings({
	organizationId,
	connectionId,
}: {
	organizationId: string;
	connectionId: string;
}) {
	const [open, setOpen] = useState(false);
	const client = useQueryClient();
	const queryKey = [
		"feishu-history-groups",
		organizationId,
		connectionId,
	] as const;
	const api = createOrganizationScopedWebOpenMeldApiFoundation({
		organizationId,
	});
	const pages = useInfiniteQuery({
		queryKey,
		enabled: open,
		initialPageParam: undefined as string | undefined,
		queryFn: async ({ pageParam, signal }) => {
			const params = new URLSearchParams({ connectionId });
			if (pageParam) {
				params.set("pageToken", pageParam);
			}
			const page = await api.requestJson<FeishuHistoryGroups>({
				invalidMessage: "Invalid Feishu group list.",
				url: `${route}?${params}`,
				method: "GET",
				schema: feishuHistoryGroupsSchema,
				operation: "feishu.history.groups",
				signal,
			});
			return { ...page, pageToken: pageParam };
		},
		getNextPageParam: (last) => last.nextPageToken ?? undefined,
	});
	const change = useMutation({
		mutationFn: (setting: FeishuHistoryGroupSetting) =>
			api.requestJson<FeishuHistoryGroupSettingResult>({
				invalidMessage: "Invalid Feishu group setting.",
				url: route,
				method: "PUT",
				body: JSON.stringify(setting),
				schema: feishuHistoryGroupSettingResultSchema,
				operation: "feishu.history.set",
			}),
		onSuccess: (result) =>
			"status" in result ? undefined : client.invalidateQueries({ queryKey }),
	});
	return (
		<section className="space-y-2">
			<Button
				aria-expanded={open}
				onClick={() => setOpen(!open)}
				type="button"
				variant="outline"
			>
				Group history
			</Button>
			{open && (
				<div className="space-y-2">
					<p className="text-muted-foreground text-sm">
						Choose which Feishu groups can use earlier messages. When asked
						about another discussion, the Center Agent can look up the
						requester’s own top-level messages. Your Feishu app needs permission
						to read group messages. Enabling history posts a notice in the
						selected group.
					</p>
					{pages.isPending && <output>Loading joined groups…</output>}
					{pages.isError && (
						<p role="alert">
							Could not load Feishu groups.{" "}
							<Button
								onClick={() => pages.refetch()}
								type="button"
								variant="outline"
							>
								Retry
							</Button>
						</p>
					)}
					{pages.data?.pages[0]?.groups.length === 0 && (
						<p>Add the Feishu app to a group to enable history there.</p>
					)}
					{pages.data?.pages.map((p) =>
						p.groups.map((g) => (
							<div
								className="flex items-center justify-between gap-3"
								key={g.chatId}
							>
								<span>{g.name}</span>
								<Switch
									aria-label={`Use group history in ${g.name}`}
									checked={g.enabled}
									disabled={change.isPending || pages.isFetching}
									onCheckedChange={(enabled) =>
										change.mutate({
											connectionId,
											generation: p.generation,
											chatId: g.chatId,
											enabled,
											pageToken: p.pageToken,
										})
									}
								/>
							</div>
						))
					)}
					{pages.hasNextPage && (
						<Button
							disabled={pages.isFetchingNextPage}
							onClick={() => pages.fetchNextPage()}
							type="button"
							variant="outline"
						>
							More groups
						</Button>
					)}
					{change.data && "status" in change.data && change.variables && (
						<div className="space-y-2" role="alert">
							<p>
								Your Feishu app needs permission to read group messages. Approve
								the update for your existing bot, then check again to enable
								this group.
							</p>
							<AuthorizationLink
								className="underline"
								href={change.data.authorizationUrl}
								rel="noopener noreferrer"
								target="_blank"
							>
								Update Feishu permissions
							</AuthorizationLink>
							<Button
								disabled={change.isPending}
								onClick={() => {
									if (change.variables) {
										change.mutate(change.variables);
									}
								}}
								type="button"
								variant="outline"
							>
								I’ve updated permissions. Check again
							</Button>
						</div>
					)}
					{change.isError && (
						<p role="alert">
							The group setting could not be saved. Reload the groups and try
							again.
						</p>
					)}
				</div>
			)}
		</section>
	);
}
