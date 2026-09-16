import type { GetActiveSpaceWakeProgressResponse } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { OrganizationComputerPickerCard } from "#/components/computers/organization-computer-card";
import { resolveOrganizationComputerGroups } from "#/components/computers/organization-computers";
import { OrganizationInboxRecentItems } from "#/components/inbox/organization-inbox-preview";
import { CenterAgentCompactConversation } from "#/components/organizations/center-agent-compact-conversation";
import { buildConnectComputerPath } from "#/lib/connect/connect-route";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import type { AccountSpaceItem } from "#/lib/spaces/account-spaces";
import { localRuntimesQueryOptions } from "#/query/connect/local-runtimes";
import { organizationProfileDirectoryQueryOptions } from "#/query/organizations/organization-directory";
import { spaceActiveWakeProgressSummaryQueryOptions } from "#/query/spaces/active-wake-progress";
import { DeskProfileCard } from "./desk-profile-card";
import type { DeskWidget } from "./desk-widget-types";

export function DeskWidgetContent(input: {
	widget: DeskWidget;
	spaces: readonly AccountSpaceItem[];
	onChat: (chat: { spaceId: string; profileId: string; title: string }) => void;
	onCenter: () => void;
	onSpace: (space: AccountSpaceItem) => void;
}) {
	const { currentOrganization } = useAppOrganization();
	if (input.widget.kind === "people" && input.widget.targetProfileId) {
		return (
			<div className="@container/profile min-h-0 overflow-auto p-4">
				<DeskProfileCard
					onCenter={input.onCenter}
					onChat={input.onChat}
					profileId={input.widget.targetProfileId}
				/>
			</div>
		);
	}
	if (input.widget.kind === "center") {
		return (
			<CenterAgentCompactConversation organizationId={currentOrganization.id} />
		);
	}
	return (
		<div className="min-h-0 overflow-auto">
			<div className="p-4">
				{input.widget.kind === "inbox" && (
					<OrganizationInboxRecentItems
						currentOrganization={currentOrganization}
					/>
				)}
				{input.widget.kind === "computer" && <DeskComputers />}
				{input.widget.kind === "activity" && (
					<DeskWorkUpdates onSpace={input.onSpace} spaces={input.spaces} />
				)}
			</div>
		</div>
	);
}

function DeskComputers() {
	const { storageScope, currentUserId, currentOrganization } =
		useAppOrganization();
	const computers = useQuery({
		...localRuntimesQueryOptions({ enabled: true, storageScope }),
		refetchInterval: 10_000,
	});
	const directory = useQuery(
		organizationProfileDirectoryQueryOptions({
			enabled: true,
			organizationId: currentOrganization.id,
		})
	);
	const groups = resolveOrganizationComputerGroups({
		currentUserId,
		directory: directory.data ?? null,
		ownedComputers: computers.data?.localRuntimes ?? [],
	});
	if (computers.isPending) {
		return <output>Loading computers…</output>;
	}
	if (computers.isError) {
		return (
			<div role="alert">
				<p>Couldn’t load computers.</p>
				<Button onClick={() => computers.refetch()} variant="outline">
					Try again
				</Button>
			</div>
		);
	}
	return (
		<div className="space-y-3">
			{groups
				.filter((g) => g.isCurrentUser)
				.flatMap((g) => g.computers)
				.map((computer) => {
					const connection = computers.data?.peopleComputers.computers.find(
						(item) => item.deviceId === computer.deviceId
					)?.connection.status;
					return (
						<OrganizationComputerPickerCard
							computer={{
								...computer,
								serviceState:
									connection === "disconnected"
										? "not_connected"
										: (connection ?? "unknown"),
							}}
							key={computer.deviceId}
							orgSlug={currentOrganization.slug}
						/>
					);
				})}
			{!computers.data?.localRuntimes.length && (
				<p className="text-muted-foreground text-sm">
					Connect a computer to see its status here.
				</p>
			)}
			<Link
				className="inline-flex rounded-md border px-3 py-2 text-sm hover:bg-muted"
				to={buildConnectComputerPath({ orgSlug: currentOrganization.slug })}
			>
				Connect computer
			</Link>
		</div>
	);
}

function DeskWorkUpdates(input: {
	spaces: readonly AccountSpaceItem[];
	onSpace: (space: AccountSpaceItem) => void;
}) {
	const { currentOrganization } = useAppOrganization();
	const directory = useQuery(
		organizationProfileDirectoryQueryOptions({
			enabled: true,
			organizationId: currentOrganization.id,
		})
	);
	// Each Space independently authorizes the reader. Never infer private work
	// from Agent ownership or from presence in the organization directory.
	const client = useQueryClient();
	const updates = useQuery({
		queryKey: [
			"desk-work-updates",
			input.spaces.map((s) => [s.spaceId, s.openProfileId]),
		],
		queryFn: async ({ signal }) => {
			const results: PromiseSettledResult<{
				space: AccountSpaceItem;
				data: GetActiveSpaceWakeProgressResponse;
			}>[] = [];
			for (let offset = 0; offset < input.spaces.length; offset += 4) {
				signal.throwIfAborted();
				results.push(
					...(await Promise.allSettled(
						input.spaces.slice(offset, offset + 4).map(async (space) => ({
							space,
							data: await client.fetchQuery({
								...spaceActiveWakeProgressSummaryQueryOptions({
									enabled: true,
									spaceId: space.spaceId,
									openMeldProfileId: space.openProfileId,
								}),
								staleTime: 15_000,
							}),
						}))
					))
				);
			}
			return results;
		},
		refetchInterval: 60_000,
		retry: false,
	});
	const items = (updates.data ?? [])
		.flatMap((result) =>
			result.status === "fulfilled"
				? result.value.data.items.map((item) => ({
						item,
						space: result.value.space,
					}))
				: []
		)
		.sort((a, b) => b.item.updatedAtMs - a.item.updatedAtMs);
	return (
		<div className="space-y-3">
			{(updates.isError ||
				updates.data?.some((q) => q.status === "rejected")) && (
				<div role="alert">
					<p className="text-sm">Some Spaces couldn’t be refreshed.</p>
					<Button onClick={() => updates.refetch()} size="sm" variant="outline">
						Try again
					</Button>
				</div>
			)}
			{updates.isPending && <output className="text-sm">Checking work…</output>}
			{items.length === 0 &&
				updates.isSuccess &&
				updates.data.every((q) => q.status === "fulfilled") && (
					<p className="text-muted-foreground text-sm">
						No agents are working in your Spaces or chats.
					</p>
				)}
			{items.map(({ item, space }) => {
				const owner = directory.data?.agentProfiles.find(
					(agent) => agent.profileId === item.targetProfileId
				)?.ownerName;
				return (
					<Button
						className="h-auto w-full flex-col items-start gap-1 whitespace-normal py-3 text-left"
						key={space.spaceId + item.targetProfileId + item.clientMessageId}
						onClick={() => input.onSpace(space)}
						variant="ghost"
					>
						<span className="font-medium">{item.targetLabel}</span>
						<span className="text-muted-foreground text-xs">
							{owner && `${owner} · `}
							{space.spaceName}
						</span>
						<span className="text-sm">{item.message}</span>
					</Button>
				);
			})}
		</div>
	);
}
