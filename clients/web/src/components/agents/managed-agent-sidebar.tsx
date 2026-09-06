import type {
	AccountSidebarPreferences,
	AuthProfileView,
} from "@openmeld/schemas";
import { FluidNavMenu } from "@openmeld/ui/fluid/nav-menu";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useLayoutEffect, useRef } from "react";
import { toast } from "sonner";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { buildOrganizationDirectMessagePath } from "#/lib/organizations/organization-routes";
import {
	openCurrentDirectMessageSpace,
	resolveDirectMessageOpenErrorMessage,
} from "#/lib/spaces/direct-message";
import { accountSpaceQueryKeys } from "#/query/spaces/account-spaces";
import { AppContextualSidebarNav } from "../app/app-contextual-layout";
import { SidebarDestinationAction } from "../app/sidebar-destination-actions";
import {
	SidebarDrag,
	SidebarDropSection,
	useSortableSidebarItem,
} from "../app/sidebar-drag";
import { moveSidebarGroup } from "../app/sidebar-drop-target";
import { moveSidebarItemIds, sortSidebarManual } from "../app/sidebar-order";
import { SidebarSectionActions } from "../app/sidebar-section-actions";
import { useSidebarPreferences } from "../app/use-sidebar-preferences";
import type { AgentProfileSidebarGroup } from "./agent-profile-sidebar-groups";
import { AgentProfileSidebarItem } from "./agent-profile-sidebar-item";
import type { AgentProfilesWorkspaceProps } from "./agent-profiles-workspace";

type Preferences = NonNullable<AccountSidebarPreferences["agents"]>;
const EMPTY: Preferences = {
	starred: { sort: "priority", itemIds: [] },
	items: { sort: "priority", itemIds: [] },
	groups: [],
};

function sortProfiles(
	profiles: readonly AuthProfileView[],
	settings: Preferences["items"]
) {
	if (settings.sort === "manual") {
		return sortSidebarManual(
			profiles,
			settings.itemIds,
			(p) => p.openMeldProfileId
		);
	}
	if (settings.sort === "name") {
		return [...profiles].sort((a, b) =>
			a.profileName.localeCompare(b.profileName)
		);
	}
	if (settings.sort === "recent") {
		return [...profiles].sort(
			(a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
		);
	}
	return profiles;
}

export function ManagedAgentSidebar({
	input,
	groups,
	activeProfileId,
}: {
	input: AgentProfilesWorkspaceProps;
	groups: readonly AgentProfileSidebarGroup[];
	activeProfileId: string | null;
}) {
	const { account, currentOrganization, currentUserId } = useAppOrganization();
	const sidebar = useSidebarPreferences(currentUserId, currentOrganization.id);
	const preferences = sidebar.preferences?.agents ?? EMPTY;
	const navigate = useNavigate();
	const client = useQueryClient();
	const chat = useMutation({
		mutationFn: (targetProfileId: string) =>
			openCurrentDirectMessageSpace({
				organizationId: currentOrganization.id,
				targetProfileId,
			}),
		onError: (error) =>
			toast.error(resolveDirectMessageOpenErrorMessage(error)),
		onSuccess: async (response) => {
			await client.invalidateQueries({
				queryKey: accountSpaceQueryKeys.all,
				refetchType: "none",
			});
			await navigate({
				to: buildOrganizationDirectMessagePath({
					orgSlug: currentOrganization.slug,
					spaceId: response.spaceId,
					search: { profileId: response.memberProfileId },
				}),
			});
		},
	});
	const save = (agents: Preferences) => {
		if (sidebar.preferences) {
			sidebar.save({ ...sidebar.preferences, agents });
		}
	};
	const assigned = new Set([
		...preferences.starred.itemIds,
		...preferences.groups.flatMap((g) => g.itemIds),
	]);
	const sections = [
		...(input.profiles.some((profile) =>
			preferences.starred.itemIds.includes(profile.openMeldProfileId)
		)
			? [
					{
						id: "starred",
						label: "Starred",
						settings: preferences.starred,
						profiles: input.profiles.filter((p) =>
							preferences.starred.itemIds.includes(p.openMeldProfileId)
						),
					},
				]
			: []),
		...preferences.groups.map((g) => ({
			id: g.id,
			label: g.name,
			settings: g,
			profiles: input.profiles.filter((p) =>
				g.itemIds.includes(p.openMeldProfileId)
			),
		})),
		...(groups.some((group) => group.id === `agent-owner-${currentUserId}`)
			? groups
			: [
					{
						id: `agent-owner-${currentUserId}`,
						label: account.name ? `${account.name} (you)` : "You",
						profiles: [],
					},
					...groups,
				]
		).map((g) => ({
			...g,
			settings: preferences.items,
			profiles: g.profiles.filter((p) => !assigned.has(p.openMeldProfileId)),
		})),
	]
		.filter(
			(section) =>
				(!input.groupFilterIds?.length ||
					input.groupFilterIds.includes(
						section.id.startsWith("agent-owner-") ? "ungrouped" : section.id
					)) &&
				(!section.id.startsWith("agent-owner-") ||
					section.id === `agent-owner-${currentUserId}` ||
					section.profiles.length > 0)
		)
		.map((s) => ({ ...s, profiles: sortProfiles(s.profiles, s.settings) }));
	const move = (sectionId: string, itemId: string, beforeId?: string) => {
		const ownerTarget = groups.some((group) => group.id === sectionId)
			? { settings: preferences.items, profiles: [] }
			: undefined;
		const target =
			sections.find((s) => s.id === sectionId) ??
			(sectionId === "starred"
				? { settings: preferences.starred, profiles: [] }
				: ownerTarget);
		if (!target) {
			return;
		}
		const itemIds = moveSidebarItemIds(
			target.settings.itemIds,
			target.profiles.map((p) => p.openMeldProfileId),
			itemId,
			beforeId
		);
		const next = {
			...preferences,
			starred: {
				...preferences.starred,
				itemIds: preferences.starred.itemIds.filter((id) => id !== itemId),
			},
			groups: preferences.groups.map((g) => ({
				...g,
				itemIds: g.itemIds.filter((id) => id !== itemId),
			})),
		};
		if (sectionId === "starred") {
			next.starred = { sort: "manual", itemIds };
		} else if (preferences.groups.some((g) => g.id === sectionId)) {
			next.groups = next.groups.map((g) =>
				g.id === sectionId ? { ...g, sort: "manual", itemIds } : g
			);
		} else {
			next.items = { sort: "manual", itemIds };
		}
		save(next);
	};
	return (
		<SidebarDrag
			canDrop={(id, section) =>
				!section.startsWith("agent-owner-") ||
				input.profiles.find((p) => p.openMeldProfileId === id)?.ownerUserId ===
					section.slice("agent-owner-".length)
			}
			groupIds={
				sidebar.disabled ? [] : preferences.groups.map((group) => group.id)
			}
			onMove={move}
			onMoveGroup={(id, before) =>
				save({
					...preferences,
					groups: moveSidebarGroup(preferences.groups, id, before),
				})
			}
		>
			<AppContextualSidebarNav
				activeItemId={activeProfileId}
				ariaLabel="Agents"
				groups={sections.map((section, index) => ({
					id: section.id,
					label: section.label,
					onRename: preferences.groups.some((group) => group.id === section.id)
						? (name: string) =>
								save({
									...preferences,
									groups: preferences.groups.map((group) =>
										group.id === section.id ? { ...group, name } : group
									),
								})
						: undefined,
					ariaLabel: `${section.label} Agents`,
					labelAccessory: (
						<SidebarSectionActions
							addLabel="Add Agent or group"
							disabled={sidebar.disabled}
							label={section.label}
							newItemLabel="New Agent"
							onDelete={
								preferences.groups.some((g) => g.id === section.id)
									? () =>
											save({
												...preferences,
												groups: preferences.groups.filter(
													(g) => g.id !== section.id
												),
											})
									: undefined
							}
							onNewGroup={
								index === 0 || section.id === `agent-owner-${currentUserId}`
									? (name) =>
											save({
												...preferences,
												groups: [
													...preferences.groups,
													{
														id: crypto.randomUUID(),
														name,
														sort: "priority",
														itemIds: [],
													},
												],
											})
									: undefined
							}
							onNewItem={
								section.id === `agent-owner-${currentUserId}`
									? input.onCreateAgent
									: undefined
							}
							onSort={(sort) => {
								if (section.id === "starred") {
									save({
										...preferences,
										starred: { ...preferences.starred, sort },
									});
									return;
								}
								if (section.id.startsWith("agent-owner-")) {
									save({
										...preferences,
										items: { ...preferences.items, sort },
									});
									return;
								}
								save({
									...preferences,
									groups: preferences.groups.map((g) =>
										g.id === section.id ? { ...g, sort } : g
									),
								});
							}}
							sort={section.settings.sort}
						/>
					),
					content: (
						<SidebarDropSection
							ids={section.profiles.map((p) => p.openMeldProfileId)}
							section={section.id}
						>
							<FluidNavMenu
								activeValue={activeProfileId}
								aria-label={`${section.label} Agents`}
								className="[&_[data-sidebar=menu]]:gap-0.5"
							>
								{section.profiles.map((profile, index) => (
									<ManagedAgentRow
										activeProfileId={activeProfileId}
										disabled={sidebar.disabled}
										index={index}
										input={input}
										key={profile.openMeldProfileId}
										onChat={() => {
											if (!chat.isPending) {
												chat.mutate(profile.openMeldProfileId);
											}
										}}
										onToggleStar={() =>
											move(
												preferences.starred.itemIds.includes(
													profile.openMeldProfileId
												)
													? `agent-owner-${profile.ownerUserId}`
													: "starred",
												profile.openMeldProfileId
											)
										}
										profile={profile}
										section={section.id}
										starred={preferences.starred.itemIds.includes(
											profile.openMeldProfileId
										)}
									/>
								))}
							</FluidNavMenu>
							{section.profiles.length === 0 && (
								<p className="px-2 py-2 text-muted-foreground text-xs">
									{input.isSearchActive
										? "No Agents match your search or filters."
										: "No Agents yet."}
								</p>
							)}
						</SidebarDropSection>
					),
				}))}
				leadingContent={
					<>
						<div className="flex min-w-0 items-center gap-2">
							<div className="min-w-0 flex-1">{input.searchControl}</div>
							<SidebarDestinationAction destination="agents">
								{input.filterControl}
							</SidebarDestinationAction>
						</div>
						{input.filterBadges}
						{!!input.groupFilterIds?.length &&
							!sections.some((section) => section.profiles.length > 0) && (
								<p className="px-2 py-2 text-muted-foreground text-xs">
									No Agents match your search or filters.
								</p>
							)}
					</>
				}
				onActivate={input.onSelectProfile}
				placement="main"
				title="Agents"
			/>
		</SidebarDrag>
	);
}

function ManagedAgentRow({
	input,
	profile,
	index,
	section,
	activeProfileId,
	disabled,
	starred,
	onToggleStar,
	onChat,
}: {
	input: AgentProfilesWorkspaceProps;
	profile: AuthProfileView;
	index: number;
	section: string;
	activeProfileId: string | null;
	disabled: boolean;
	starred: boolean;
	onToggleStar: () => void;
	onChat: () => void;
}) {
	const actions = useRef({ onChat, onToggleStar });
	useLayoutEffect(() => {
		actions.current = { onChat, onToggleStar };
	}, [onChat, onToggleStar]);
	const chatAction = useCallback(() => actions.current.onChat(), []);
	const starAction = useCallback(() => actions.current.onToggleStar(), []);
	const drag = useSortableSidebarItem({
		section,
		itemId: profile.openMeldProfileId,
		name: profile.profileName,
		disabled,
	});
	return (
		<AgentProfileSidebarItem
			actionsDisabled={disabled}
			agentControllerRef={
				input.agentControllerRefByProfileId?.get(profile.openMeldProfileId) ??
				null
			}
			currentUserId={input.currentUserId}
			drag={drag}
			index={index}
			isActive={profile.openMeldProfileId === activeProfileId}
			modelCatalog={input.modelCatalog ?? null}
			onChat={chatAction}
			onSelectProfile={input.onSelectProfile}
			onToggleStar={starAction}
			operationalContext={
				input.operationalContextByProfileId?.get(profile.openMeldProfileId) ??
				null
			}
			profile={profile}
			readiness={
				input.readinessByProfileId.get(profile.openMeldProfileId) ?? null
			}
			readinessErrorMessage={
				input.readinessErrorByProfileId?.get(profile.openMeldProfileId) ?? null
			}
			readinessIsPending={
				input.readinessPendingProfileIds?.has(profile.openMeldProfileId) ??
				false
			}
			starred={starred}
		/>
	);
}
