import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "@openmeld/ui/components/avatar";
import { Button } from "@openmeld/ui/components/button";
import { Input } from "@openmeld/ui/components/input";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { CenterAgentItem } from "#/components/directory/center-agent-item";
import {
	localAgentSidebarState,
	useAgentSidebarPreviewReady,
} from "#/lib/dev/agent-sidebar-fixtures";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { buildOrganizationPersonPath } from "#/lib/organizations/organization-routes";
import {
	AgentList,
	AgentListControls,
	AgentListFilterChips,
	DEFAULT_AGENT_LIST_VIEW,
} from "./agent-list";
import {
	type AgentListItem,
	buildAgentListItem,
	matchesAgentListItem,
	sortAgentOwnerGroups,
} from "./agent-list-model";
import { AgentProfileSidebarItem } from "./agent-profile-sidebar-item";
import type { AgentProfilesWorkspaceProps } from "./agent-profiles-workspace";

export function AgentDirectoryLists({
	input,
}: {
	input: AgentProfilesWorkspaceProps;
}) {
	const { currentOrganization } = useAppOrganization();
	const previewReady = useAgentSidebarPreviewReady();
	const [search, setSearch] = useState("");
	const [view, setView] = useState(DEFAULT_AGENT_LIST_VIEW);
	const items = useMemo(
		() =>
			input.profiles.map((profile) => {
				const preview = localAgentSidebarState(
					profile.openMeldProfileId,
					previewReady
				);
				return buildAgentListItem({
					profile,
					readiness: input.readinessByProfileId.get(profile.openMeldProfileId),
					agentControllerRef: input.agentControllerRefByProfileId?.get(
						profile.openMeldProfileId
					),
					lastTaskActivityAt: input.lastTaskActivityByProfileId?.get(
						profile.openMeldProfileId
					),
					modelCatalog: input.modelCatalog,
					availability:
						preview === "connect" ? "unavailable" : (preview ?? undefined),
				});
			}),
		[
			input.profiles,
			input.readinessByProfileId,
			input.agentControllerRefByProfileId,
			input.lastTaskActivityByProfileId,
			input.modelCatalog,
			previewReady,
		]
	);
	const renderCard = (item: AgentListItem, index: number) => (
		<AgentProfileSidebarItem
			agentControllerRef={
				input.agentControllerRefByProfileId?.get(
					item.profile.openMeldProfileId
				) ?? null
			}
			index={index}
			isActive={false}
			key={item.profile.openMeldProfileId}
			modelCatalog={input.modelCatalog ?? null}
			onSelectProfile={input.onSelectProfile}
			operationalContext={
				input.operationalContextByProfileId?.get(
					item.profile.openMeldProfileId
				) ?? null
			}
			profile={item.profile}
			readiness={
				input.readinessByProfileId.get(item.profile.openMeldProfileId) ?? null
			}
			readinessErrorMessage={
				input.readinessErrorByProfileId?.get(item.profile.openMeldProfileId) ??
				null
			}
			readinessIsPending={
				input.readinessPendingProfileIds?.has(item.profile.openMeldProfileId) ??
				false
			}
			variant="card"
		/>
	);
	const create =
		input.canCreateAgent !== false ? (
			<Button onClick={input.onCreateAgent} size="sm">
				Create Agent
			</Button>
		) : undefined;
	const center = input.directoryProfiles?.find(
		(profile) => profile.isCenterAgent
	);
	const centerItem = center
		? buildAgentListItem({
				profile: { ...center, openMeldProfileId: center.profileId },
				agentControllerRef: center.agentControllerRef,
				readiness: input.readinessByProfileId.get(center.profileId),
				modelCatalog: input.modelCatalog,
			})
		: null;
	if (centerItem) {
		centerItem.searchText += ` ${currentOrganization.name.toLowerCase()} center agent`;
	}
	const showCenter = centerItem
		? matchesAgentListItem(centerItem, view.filters, search)
		: !search &&
			Object.values(view.filters).every((values) => values.length === 0);
	const activityNote = (
		<p className="text-muted-foreground text-xs">
			{input.taskActivityAvailable === false
				? "Task activity is unavailable. Recent sorting uses creation dates."
				: "Recent includes task activity from the past 30 days and Agent creation."}
		</p>
	);
	const searchControl = (
		<Input
			aria-label={input.person ? "Search Agents" : "Search people or Agents"}
			className="max-w-sm"
			onChange={(event) => setSearch(event.target.value)}
			placeholder={input.person ? "Search Agents" : "Search people or Agents"}
			type="search"
			value={search}
		/>
	);
	if (input.person) {
		return (
			<div className="space-y-3">
				{searchControl}
				{activityNote}
				<AgentList
					emptyAction={create}
					items={items}
					label={`${input.person.name}’s Agents`}
					renderCard={renderCard}
					search={search}
				/>
			</div>
		);
	}
	const groups = sortAgentOwnerGroups(
		(input.members ?? []).map((member) => ({
			ownerUserId: member.userId,
			name: member.user.name,
			member,
			items: items.filter((item) => item.profile.ownerUserId === member.userId),
		})),
		input.currentUserId
	);
	const visibleGroups = groups.filter(
		(group) =>
			group.items.some((item) =>
				matchesAgentListItem(item, view.filters, search)
			) ||
			(!search &&
				group.items.length === 0 &&
				group.ownerUserId === input.currentUserId)
	);
	return (
		<div
			aria-labelledby="team-directory-tab-1"
			className="space-y-6"
			id="team-directory-panel-1"
			role="tabpanel"
		>
			<div className="space-y-3">
				<div className="flex flex-wrap items-center justify-between gap-3">
					{searchControl}
					<AgentListControls
						items={centerItem ? [centerItem, ...items] : items}
						onChange={setView}
						value={view}
					/>
				</div>
				<AgentListFilterChips onChange={setView} value={view} />
				{activityNote}
			</div>
			{showCenter && (
				<section aria-label={currentOrganization.name} className="space-y-3">
					<h2 className="font-medium text-sm">{currentOrganization.name}</h2>
					<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
						<CenterAgentItem presentation="card" />
					</div>
				</section>
			)}
			{visibleGroups.map((group) => (
				<AgentList
					defaults={view}
					emptyAction={
						group.ownerUserId === input.currentUserId ? create : undefined
					}
					heading={
						<div className="flex min-w-0 items-center gap-2">
							<Avatar className="size-7">
								<AvatarImage
									alt=""
									src={group.member.user.image ?? undefined}
								/>
								<AvatarFallback>{group.name.slice(0, 1)}</AvatarFallback>
							</Avatar>
							<h2 className="truncate font-medium text-sm">
								<Link
									to={buildOrganizationPersonPath({
										orgSlug: currentOrganization.slug,
										personId:
											group.member.humanProfile?.profileId ??
											`member:${group.member.memberId}`,
									})}
								>
									{group.name}
								</Link>
								{group.ownerUserId === input.currentUserId && (
									<span className="ml-1 text-muted-foreground">(you)</span>
								)}
							</h2>
							<span className="text-muted-foreground text-xs">
								{group.items.length}
							</span>
							{group.ownerUserId === input.currentUserId &&
								input.pendingRequestCount > 0 && (
									<Button
										onClick={() => input.onViewChange("requests")}
										size="sm"
										variant="ghost"
									>
										Finish setup ({input.pendingRequestCount})
									</Button>
								)}
						</div>
					}
					items={group.items}
					key={group.ownerUserId}
					label={`${group.name}’s Agents`}
					renderCard={renderCard}
					search={search}
				/>
			))}
			{visibleGroups.length === 0 && !showCenter && (
				<p className="text-muted-foreground text-sm">
					No Agents match. Try another search or clear filters.
				</p>
			)}
			{input.isOrganizationContext && (
				<Button
					onClick={() => input.onViewChange("requests")}
					size="sm"
					variant="ghost"
				>
					Setup history
				</Button>
			)}
		</div>
	);
}
